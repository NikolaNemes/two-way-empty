// ════════════════════════════════════════════════════════════════════════
// IDM (INTRADAY) PRICE SOURCES — concrete NamedSource adapters for the supply
// chain, mirroring lib/price-sources.ts (DAM) so both reuse resolvePriceCurve.
// ════════════════════════════════════════════════════════════════════════
//
// The German continuous intraday market clears separately from the day-ahead
// auction; its average cleared price (the "ID Continuous Average Price") hovers
// around the DAM curve and deviates when short-term supply/demand shifts. That
// deviation is exactly the signal the v4 MPC uses to (a) re-plan and (b) value
// the immediate, tradeable slot at its true near-term price.
//
//   Source chain (priority order), all real, free, German DE/LU intraday:
//     1. SMARD intraday continuous avg @ 15-min  (filter 5078, smard.de) — primary.
//     2. SMARD intraday continuous avg @ hourly  (filter 5078, smard.de) — fills
//        15-min gaps when the quarter-hour file is delayed; resampled→4 slots.
//     3. ENTSO-E Transparency price (optional)   — DISTINCT provider, requires
//        ENTSOE_API_TOKEN; gracefully skipped (throws → isolated) when absent.
//   Downstream, resolvePriceCurve adds the Neon idm_price cache + synthetic
//   day-before fill, identical to the DAM chain.
//
// All adapters return PricePoint[] with absolute epoch-ms `ts` at slot start so
// the orchestrator can index them onto the shared 15-min slot grid.
// ════════════════════════════════════════════════════════════════════════

import { SLOT_MS } from "./dispatch-kernel"
import type { NamedSource, PricePoint } from "./price-supply"

const SLOTS_PER_HOUR = 4
const WEEK_MS = 7 * 24 * 3600_000
/** Cap on weekly SMARD files fetched per resolve (safety against huge ranges). */
const MAX_SMARD_WEEKS = 10
/** SMARD region code for the German/Luxembourg bidding zone. */
export const SMARD_REGION_DE = "DE"
/** SMARD filter id for "Intraday Continuous Average Price" (DE/LU). Verified to
 *  track the day-ahead curve with realistic intraday deviations. */
export const SMARD_IDM_AVG_FILTER = 5078
export const SMARD_BASE_URL = "https://www.smard.de/app/chart_data"

// Plausibility band for a cleared €/MWh intraday price. Continuous intraday can
// spike hard, but values outside this are almost certainly a different unit or
// a bad record and are dropped so they never poison the planner.
const MIN_PLAUSIBLE_EUR_MWH = -500
const MAX_PLAUSIBLE_EUR_MWH = 4000

type SmardResolution = "quarterhour" | "hour"

interface SmardIndex {
  timestamps: number[] // weekly anchor instants (epoch ms)
}
interface SmardSeries {
  series: [number, number | null][] // [ts_ms, value]
}

/**
 * Build a SMARD intraday-continuous-average source at a given resolution.
 * Fetches only the weekly files overlapping [fromMs, toMs], then flattens the
 * non-null series onto the 15-min slot grid (hourly values resampled ×4).
 */
export function smardIntradaySource(opts?: {
  resolution?: SmardResolution
  filter?: number
  region?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}): NamedSource {
  const resolution: SmardResolution = opts?.resolution ?? "quarterhour"
  const filter = opts?.filter ?? SMARD_IDM_AVG_FILTER
  const region = opts?.region ?? SMARD_REGION_DE
  const baseUrl = opts?.baseUrl ?? SMARD_BASE_URL
  const doFetch = opts?.fetchImpl ?? fetch
  const name = resolution === "hour" ? "smard-hourly" : "smard"

  return {
    name,
    fetch: async (fromMs, toMs): Promise<PricePoint[]> => {
      // 1. Which weekly anchors cover [fromMs, toMs]?
      const idxUrl = `${baseUrl}/${filter}/${region}/index_${resolution}.json`
      const idxRes = await doFetch(idxUrl, { headers: { Accept: "application/json" } })
      if (!idxRes.ok) throw new Error(`SMARD index ${filter}/${resolution} → ${idxRes.status}`)
      const idx = (await idxRes.json()) as SmardIndex
      const anchors = (idx.timestamps ?? [])
        .filter((a) => a <= toMs && a + WEEK_MS >= fromMs)
        .sort((x, y) => x - y)
        .slice(-MAX_SMARD_WEEKS)
      if (anchors.length === 0) return []

      // 2. Fetch each weekly data file and flatten onto the slot grid.
      const out: PricePoint[] = []
      const span = resolution === "hour" ? SLOTS_PER_HOUR : 1
      for (const anchor of anchors) {
        const dataUrl = `${baseUrl}/${filter}/${region}/${filter}_${region}_${resolution}_${anchor}.json`
        const res = await doFetch(dataUrl, { headers: { Accept: "application/json" } })
        if (!res.ok) continue // skip a single bad week; other weeks still load
        const body = (await res.json()) as SmardSeries
        for (const [ts, value] of body.series ?? []) {
          if (value == null || !Number.isFinite(value)) continue
          if (value < MIN_PLAUSIBLE_EUR_MWH || value > MAX_PLAUSIBLE_EUR_MWH) continue
          if (ts < fromMs - WEEK_MS || ts > toMs) continue
          // Hourly points fan out across their 4 constituent 15-min slots.
          for (let i = 0; i < span; i++) {
            out.push({ ts: ts + i * SLOT_MS, priceEurMwh: value, resampled: span > 1 })
          }
        }
      }
      return out
    },
  }
}

// ── ENTSO-E Transparency adapter (optional, distinct provider) ───────────────
/** DE-LU bidding-zone EIC code on the ENTSO-E Transparency Platform. */
export const ENTSOE_DE_LU_DOMAIN = "10Y1001A1001A82H"
export const ENTSOE_BASE_URL = "https://web-api.tp.entsoe.eu/api"

function entsoeStamp(ms: number): string {
  // ENTSO-E wants UTC "yyyyMMddHHmm".
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
}

/**
 * ENTSO-E Transparency price source (documentType A44). A genuinely different
 * provider/host for redundancy. Requires a free ENTSOE_API_TOKEN; when the
 * token is absent this throws so the orchestrator isolates it and falls through
 * to the cache/synthetic tiers. Used as a cross-provider intraday fallback.
 */
export function entsoeIntradaySource(opts?: {
  token?: string
  domain?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}): NamedSource {
  const token = opts?.token ?? process.env.ENTSOE_API_TOKEN
  const domain = opts?.domain ?? ENTSOE_DE_LU_DOMAIN
  const baseUrl = opts?.baseUrl ?? ENTSOE_BASE_URL
  const doFetch = opts?.fetchImpl ?? fetch
  return {
    name: "entsoe",
    fetch: async (fromMs, toMs): Promise<PricePoint[]> => {
      if (!token) throw new Error("ENTSOE_API_TOKEN not set — skipping ENTSO-E source")
      const url = new URL(baseUrl)
      url.searchParams.set("securityToken", token)
      url.searchParams.set("documentType", "A44") // price document
      url.searchParams.set("in_Domain", domain)
      url.searchParams.set("out_Domain", domain)
      url.searchParams.set("periodStart", entsoeStamp(fromMs))
      url.searchParams.set("periodEnd", entsoeStamp(toMs))
      const res = await doFetch(url.toString(), { headers: { Accept: "application/xml" } })
      if (!res.ok) throw new Error(`ENTSO-E A44 → ${res.status}`)
      const xml = await res.text()
      return parseEntsoePriceXml(xml, fromMs, toMs)
    },
  }
}

/**
 * Minimal ENTSO-E A44 XML parser: walks each <TimeSeries><Period> block, reads
 * the period start + resolution, and maps each <Point>(position, price) onto a
 * slot-grid PricePoint. Dependency-free (regex/scan) to avoid an XML lib.
 */
export function parseEntsoePriceXml(xml: string, fromMs: number, toMs: number): PricePoint[] {
  const out: PricePoint[] = []
  const periodRe = /<Period>([\s\S]*?)<\/Period>/g
  let pm: RegExpExecArray | null
  while ((pm = periodRe.exec(xml))) {
    const block = pm[1]
    const startIso = /<timeInterval>[\s\S]*?<start>(.*?)<\/start>/.exec(block)?.[1]
    const resol = /<resolution>(.*?)<\/resolution>/.exec(block)?.[1] ?? "PT60M"
    if (!startIso) continue
    const startMs = Date.parse(startIso)
    if (!Number.isFinite(startMs)) continue
    const stepMin = resol.includes("15M") ? 15 : resol.includes("30M") ? 30 : 60
    const stepMs = stepMin * 60_000
    const span = Math.max(1, Math.round(stepMs / SLOT_MS)) // 60M → 4 slots
    const pointRe = /<Point>\s*<position>(\d+)<\/position>\s*<price\.amount>([\d.]+)<\/price\.amount>/g
    let qm: RegExpExecArray | null
    while ((qm = pointRe.exec(block))) {
      const position = Number(qm[1])
      const price = Number(qm[2])
      if (!Number.isFinite(position) || !Number.isFinite(price)) continue
      const baseTs = startMs + (position - 1) * stepMs
      for (let i = 0; i < span; i++) {
        const ts = baseTs + i * SLOT_MS
        if (ts < fromMs - WEEK_MS || ts > toMs) continue
        out.push({ ts, priceEurMwh: price, resampled: span > 1 })
      }
    }
  }
  return out
}

/**
 * The default IDM source chain (priority order). Tokenless SMARD sources work
 * out of the box; ENTSO-E joins automatically when ENTSOE_API_TOKEN is set.
 */
export function defaultIdmSources(opts?: { fetchImpl?: typeof fetch }): NamedSource[] {
  const fetchImpl = opts?.fetchImpl
  return [
    smardIntradaySource({ resolution: "quarterhour", fetchImpl }),
    smardIntradaySource({ resolution: "hour", fetchImpl }),
    entsoeIntradaySource({ fetchImpl }),
  ]
}
