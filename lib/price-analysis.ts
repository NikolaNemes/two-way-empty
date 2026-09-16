/**
 * Price analysis — dynamic-tariff headwind vs flat, per Berlin day.
 *
 * Client request (aug 24 2026, after the Aug-18 loss day): "zelim da znam koje
 * dane i koliko nam dolazi na naplatu to sto smo presli na dinamicku tarifu."
 *
 * Two layers (his explicit choice):
 *  1. MARKET layer — every day with full IDM coverage gets a verdict derived
 *     purely from prices vs the fleet's import-weighted flat rate:
 *       - guaranteed_loss : day MIN >= flat  → no strategy could beat flat
 *                           (the Aug-18 case: min 13,0 ct vs flat 12,5 ct)
 *       - headwind        : day AVG >= flat but min < flat → beating flat
 *                           requires shifting most volume into the cheap tail
 *       - favorable       : day AVG < flat → market level itself beats flat
 *  2. ACTUAL layer — where the telemetry archive has volumes (portfolio_daily,
 *     through Jul 2026), the real euro delta per day:
 *       flatEur  = Σ import_kwh × station.flat_rate_ct_kwh / 100
 *       dynEur   = Σ import_kwh × import_wavg_price / 1000 (per-station wavg
 *                  price is €/MWh), falling back to cost_eur when wavg is null
 *       deltaEur = flatEur − dynEur   (positive → dynamic tariff won that day)
 *
 * Per-station flat rates come from the stations registry (user chose this over
 * a single knob) — the market layer needs ONE reference line, so it uses the
 * import-weighted mean flat across the archive window.
 *
 * IDM has full 15-min coverage from 2025-05 onward; earlier days are sparse
 * samples and are excluded via the slots-per-day threshold below.
 */

import { sql as sq } from "drizzle-orm"
import { db } from "@/lib/db"
import { unstable_cache } from "next/cache"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]> {
  const result = await db.execute(sq(strings, ...values))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (result as unknown as { rows: any[] }).rows
}

/** First month with full IDM 15-min coverage (verified against idm_price). */
export const PRICE_ANALYSIS_FIRST_DAY = "2025-05-01"

/** A Berlin day needs at least this many 15-min slots to be classified —
 * guards against sparse pre-May-2025 sample days and ingestion gaps. */
const MIN_SLOTS_PER_DAY = 90

export type DayVerdict = "guaranteed_loss" | "headwind" | "favorable"

export interface PriceDay {
  day: string // "YYYY-MM-DD" (Europe/Berlin)
  minCt: number
  avgCt: number
  maxCt: number
  spreadCt: number
  verdict: DayVerdict
  /** Actual archive euros — null after the archive window (Jul 2026). */
  importKwh: number | null
  flatEur: number | null
  dynEur: number | null
  /** flatEur − dynEur; positive = dynamic tariff won the day. */
  deltaEur: number | null
}

export interface PriceMonth {
  month: string // "YYYY-MM"
  days: number
  favorableDays: number
  headwindDays: number
  lossDays: number
  avgSpreadCt: number
  avgPriceCt: number
  importKwh: number | null
  flatEur: number | null
  dynEur: number | null
  deltaEur: number | null
  /** Days in the month that have actual archive euros. */
  actualDays: number
}

export interface PriceAnalysis {
  fromDay: string
  toDay: string
  /** Import-weighted mean flat rate used as the market-layer reference. */
  weightedFlatCt: number
  /** Last day with actual archive euros (end of portfolio_daily coverage). */
  actualsThroughDay: string | null
  days: PriceDay[]
  months: PriceMonth[]
  totals: {
    favorableDays: number
    headwindDays: number
    lossDays: number
    actualDeltaEur: number
    actualFlatEur: number
    actualDynEur: number
    actualImportKwh: number
    bestDay: { day: string; deltaEur: number } | null
    worstDay: { day: string; deltaEur: number } | null
  }
}

/** Market context for the Yearly report's Months view (avg spread + loss days). */
export interface MonthPriceContext {
  month: string
  avgSpreadCt: number
  lossDays: number
  headwindDays: number
  days: number
}

function verdictFor(minCt: number, avgCt: number, flatCt: number): DayVerdict {
  if (minCt >= flatCt) return "guaranteed_loss"
  if (avgCt >= flatCt) return "headwind"
  return "favorable"
}

async function computePriceAnalysis(fromDay: string, toDay: string): Promise<PriceAnalysis> {
  // ── Import-weighted mean flat across the archive (market-layer reference).
  //    Weighting by lifetime import makes big consumers dominate the line the
  //    same way they dominate the actual euros. ──
  const flatRows = await sql`
    SELECT COALESCE(sum(d.import_kwh * s.flat_rate_ct_kwh) / NULLIF(sum(d.import_kwh), 0), 12.5) AS wflat
    FROM portfolio_daily d
    JOIN stations s ON s.station_id = d.station_id
    WHERE d.import_kwh > 0
  `
  const weightedFlatCt = Number(flatRows[0]?.wflat ?? 12.5)

  // ── Market layer: per-Berlin-day price stats from idm_price ──
  const marketRows = await sql`
    SELECT (ts AT TIME ZONE 'Europe/Berlin')::date AS day,
           min(price_eur_mwh) AS min_p,
           avg(price_eur_mwh) AS avg_p,
           max(price_eur_mwh) AS max_p,
           count(*)::int AS slots
    FROM idm_price
    WHERE (ts AT TIME ZONE 'Europe/Berlin')::date >= ${fromDay}::date
      AND (ts AT TIME ZONE 'Europe/Berlin')::date <= ${toDay}::date
    GROUP BY 1
    HAVING count(*) >= ${MIN_SLOTS_PER_DAY}
    ORDER BY 1
  `

  // ── Actual layer: fleet-day euros from portfolio_daily × per-station flats.
  //    dyn prefers import_wavg_price (what was actually paid per MWh); rows
  //    with a null wavg fall back to cost_eur so no volume silently drops. ──
  const actualRows = await sql`
    SELECT d.day::date AS day,
           sum(d.import_kwh) AS import_kwh,
           sum(d.import_kwh * s.flat_rate_ct_kwh / 100.0) AS flat_eur,
           sum(
             CASE WHEN d.import_wavg_price IS NOT NULL
                  THEN d.import_kwh * d.import_wavg_price / 1000.0
                  ELSE COALESCE(d.cost_eur, 0) END
           ) AS dyn_eur
    FROM portfolio_daily d
    JOIN stations s ON s.station_id = d.station_id
    WHERE d.day >= ${fromDay}::date AND d.day <= ${toDay}::date AND d.import_kwh > 0
    GROUP BY 1
    ORDER BY 1
  `
  const dayKey = (v: unknown) =>
    v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
  const actualsByDay = new Map<string, { importKwh: number; flatEur: number; dynEur: number }>()
  for (const r of actualRows) {
    actualsByDay.set(dayKey(r.day), {
      importKwh: Number(r.import_kwh ?? 0),
      flatEur: Number(r.flat_eur ?? 0),
      dynEur: Number(r.dyn_eur ?? 0),
    })
  }
  const actualsThroughDay = actualRows.length ? dayKey(actualRows[actualRows.length - 1].day) : null

  // ── Merge into days ──
  const days: PriceDay[] = marketRows.map((r) => {
    const day = dayKey(r.day)
    const minCt = Number(r.min_p) / 10
    const avgCt = Number(r.avg_p) / 10
    const maxCt = Number(r.max_p) / 10
    const act = actualsByDay.get(day)
    return {
      day,
      minCt,
      avgCt,
      maxCt,
      spreadCt: maxCt - minCt,
      verdict: verdictFor(minCt, avgCt, weightedFlatCt),
      importKwh: act ? act.importKwh : null,
      flatEur: act ? act.flatEur : null,
      dynEur: act ? act.dynEur : null,
      deltaEur: act ? act.flatEur - act.dynEur : null,
    }
  })

  // ── Monthly rollup ──
  const byMonth = new Map<string, PriceMonth>()
  for (const d of days) {
    const month = d.day.slice(0, 7)
    let m = byMonth.get(month)
    if (!m) {
      m = {
        month,
        days: 0,
        favorableDays: 0,
        headwindDays: 0,
        lossDays: 0,
        avgSpreadCt: 0,
        avgPriceCt: 0,
        importKwh: null,
        flatEur: null,
        dynEur: null,
        deltaEur: null,
        actualDays: 0,
      }
      byMonth.set(month, m)
    }
    m.days += 1
    if (d.verdict === "favorable") m.favorableDays += 1
    else if (d.verdict === "headwind") m.headwindDays += 1
    else m.lossDays += 1
    // running sums, divided after the loop
    m.avgSpreadCt += d.spreadCt
    m.avgPriceCt += d.avgCt
    if (d.deltaEur != null) {
      m.actualDays += 1
      m.importKwh = (m.importKwh ?? 0) + (d.importKwh ?? 0)
      m.flatEur = (m.flatEur ?? 0) + (d.flatEur ?? 0)
      m.dynEur = (m.dynEur ?? 0) + (d.dynEur ?? 0)
      m.deltaEur = (m.deltaEur ?? 0) + d.deltaEur
    }
  }
  const months = Array.from(byMonth.values())
    .map((m) => ({ ...m, avgSpreadCt: m.avgSpreadCt / m.days, avgPriceCt: m.avgPriceCt / m.days }))
    .sort((a, b) => a.month.localeCompare(b.month))

  // ── Totals ──
  let favorableDays = 0
  let headwindDays = 0
  let lossDays = 0
  let actualDeltaEur = 0
  let actualFlatEur = 0
  let actualDynEur = 0
  let actualImportKwh = 0
  let bestDay: { day: string; deltaEur: number } | null = null
  let worstDay: { day: string; deltaEur: number } | null = null
  for (const d of days) {
    if (d.verdict === "favorable") favorableDays += 1
    else if (d.verdict === "headwind") headwindDays += 1
    else lossDays += 1
    if (d.deltaEur != null) {
      actualDeltaEur += d.deltaEur
      actualFlatEur += d.flatEur ?? 0
      actualDynEur += d.dynEur ?? 0
      actualImportKwh += d.importKwh ?? 0
      if (!bestDay || d.deltaEur > bestDay.deltaEur) bestDay = { day: d.day, deltaEur: d.deltaEur }
      if (!worstDay || d.deltaEur < worstDay.deltaEur) worstDay = { day: d.day, deltaEur: d.deltaEur }
    }
  }

  return {
    fromDay,
    toDay,
    weightedFlatCt,
    actualsThroughDay,
    days,
    months,
    totals: {
      favorableDays,
      headwindDays,
      lossDays,
      actualDeltaEur,
      actualFlatEur,
      actualDynEur,
      actualImportKwh,
      bestDay,
      worstDay,
    },
  }
}

/** Cached: prices never change retroactively; today's partial day is excluded
 * by the slot threshold until it completes, so a 1-hour TTL is plenty. */
export async function getPriceAnalysis(fromDay: string, toDay: string): Promise<PriceAnalysis> {
  const cached = unstable_cache(
    () => computePriceAnalysis(fromDay, toDay),
    ["price-analysis", fromDay, toDay],
    { revalidate: 3600 },
  )
  return cached()
}

/** Slim per-month market context for the Yearly report's Months view. */
export async function getMonthlyPriceContext(months: string[]): Promise<Map<string, MonthPriceContext>> {
  if (months.length === 0) return new Map()
  const sorted = [...months].sort()
  const fromDay = `${sorted[0]}-01`
  // last day of the last month: first day of next month minus one
  const [y, m] = sorted[sorted.length - 1].split("-").map(Number)
  const toDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const analysis = await getPriceAnalysis(fromDay, toDay)
  const out = new Map<string, MonthPriceContext>()
  for (const mo of analysis.months) {
    out.set(mo.month, {
      month: mo.month,
      avgSpreadCt: mo.avgSpreadCt,
      lossDays: mo.lossDays,
      headwindDays: mo.headwindDays,
      days: mo.days,
    })
  }
  return out
}
