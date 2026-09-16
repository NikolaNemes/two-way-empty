// ════════════════════════════════════════════════════════════════════════
// DAM PRICE SOURCES — concrete NamedSource adapters for the supply chain.
// ════════════════════════════════════════════════════════════════════════
//
//   • Amperio  — primary, true 15-min DAM (DE-LU). fetch fn injected so the
//                worker (direct upstream) and the app (proxy) reuse one adapter.
//   • aWATTar  — free public EPEX SPOT German day-ahead, no API key. Hourly,
//                resampled to 15-min (each hour repeated across its 4 slots,
//                flagged `resampled`).
//
// Both return PricePoint[] with absolute epoch-ms `ts` at slot start, so the
// orchestrator can index them onto the shared 15-min slot grid.
// ════════════════════════════════════════════════════════════════════════

import { SLOT_MS } from "./dispatch-kernel"
import type { NamedSource, PricePoint } from "./price-supply"

export const AWATTAR_DE_BASE_URL = "https://api.awattar.de"
const SLOTS_PER_HOUR = 4

// ── Amperio adapter ─────────────────────────────────────────────────────────
/** Shape the orchestrator needs from any Amperio price fetcher (worker or proxy). */
export type AmperioPricesFetcher = (
  fromIso: string,
  toIso: string,
) => Promise<{ prices: { ts: string; price_eur_mwh: number }[] }>

/** Build the primary Amperio source from an injected price fetcher. */
export function makeAmperioSource(fetchPrices: AmperioPricesFetcher): NamedSource {
  return {
    name: "amperio",
    fetch: async (fromMs, toMs): Promise<PricePoint[]> => {
      const res = await fetchPrices(new Date(fromMs).toISOString(), new Date(toMs).toISOString())
      const out: PricePoint[] = []
      for (const p of res.prices ?? []) {
        const ts = new Date(p.ts).getTime()
        if (!Number.isFinite(ts) || !Number.isFinite(p.price_eur_mwh)) continue
        out.push({ ts, priceEurMwh: p.price_eur_mwh })
      }
      return out
    },
  }
}

// ── aWATTar DE adapter ───────────────────────────────────────────────────────
interface AwattarEntry {
  start_timestamp: number // epoch ms
  end_timestamp: number // epoch ms
  marketprice: number // €/MWh
  unit: string
}
interface AwattarResponse {
  data: AwattarEntry[]
}

/**
 * aWATTar DE market data, resampled to 15-min. Hourly entries are split into 4
 * equal slots carrying the same price (flagged `resampled`). The API accepts
 * `start`/`end` epoch-ms query params.
 */
export function awattarSource(opts?: { baseUrl?: string; fetchImpl?: typeof fetch }): NamedSource {
  const baseUrl = opts?.baseUrl ?? AWATTAR_DE_BASE_URL
  const doFetch = opts?.fetchImpl ?? fetch
  return {
    name: "awattar",
    fetch: async (fromMs, toMs): Promise<PricePoint[]> => {
      const url = new URL(`${baseUrl}/v1/marketdata`)
      url.searchParams.set("start", String(Math.floor(fromMs)))
      url.searchParams.set("end", String(Math.ceil(toMs)))
      const res = await doFetch(url.toString(), { headers: { Accept: "application/json" } })
      if (!res.ok) throw new Error(`aWATTar GET /v1/marketdata → ${res.status}`)
      const body = (await res.json()) as AwattarResponse
      const out: PricePoint[] = []
      for (const e of body.data ?? []) {
        if (!Number.isFinite(e.marketprice) || !Number.isFinite(e.start_timestamp)) continue
        // Resample the hour into its constituent 15-min slots.
        const spanMs = e.end_timestamp - e.start_timestamp
        const nSlots = spanMs > 0 ? Math.max(1, Math.round(spanMs / SLOT_MS)) : SLOTS_PER_HOUR
        for (let i = 0; i < nSlots; i++) {
          out.push({
            ts: e.start_timestamp + i * SLOT_MS,
            priceEurMwh: e.marketprice,
            resampled: nSlots > 1,
          })
        }
      }
      return out
    },
  }
}
