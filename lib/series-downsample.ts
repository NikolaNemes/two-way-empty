/**
 * Server-side downsampling of a backtest chart series.
 *
 * WHY: a 30-day Dispatching History window carries ~3,000–3,700 series points
 * (96 frozen 15-min buckets per rolled day + up to 600 engine points per raw
 * day), ~1.4 MB of JSON, into four Recharts panels. The chart cannot show
 * that many points at a useful width anyway, so for windows longer than
 * DOWNSAMPLE_MIN_DAYS the series is bucketed here to ≤ CHART_SERIES_BUDGET
 * points before it crosses the wire.
 *
 * FIDELITY: the bucket rules are exactly those of the frozen 15-min rollup
 * series (lib/rollup-tariff compactSeries15) — power fields are bucket MEANS,
 * SOC / cumulative counters take the LAST sample, price the FIRST — and the
 * step is always a multiple of 15 min aligned to UTC midnight, so raw and
 * rolled days land on the same grid. Timestamps are bucket midpoints, again
 * like expandSeries15. Chart-only: the tariff engine (Financial Breakdown)
 * integrates the FULL series and never sees a downsampled one.
 */

import type { BacktestSeriesPoint } from "@/lib/backtest"

/**
 * KPI-grade stats the Dispatching History card shows next to the chart.
 * Computed on the FULL series before downsampling so a momentary SOC minimum
 * or a single over-cap frame is not averaged away by the chart buckets.
 */
export interface TelemetryStats {
  socMin: number
  socMax: number
  hasSoc: boolean
  /** Frames (or, on rolled days, frozen 15-min buckets) with |import| > cap. */
  breaches: number
  capKw: number
}

export function telemetryStatsFromSeries(
  series: readonly Pick<BacktestSeriesPoint, "actualB1SocPct" | "actualB2SocPct" | "actualGridKw" | "siteGridLimitKw">[],
): TelemetryStats {
  let socMin = Infinity
  let socMax = -Infinity
  let breaches = 0
  let capKw = 0
  const EPS = 0.5 // kW tolerance so float noise doesn't count as a breach
  for (const p of series) {
    for (const soc of [p.actualB1SocPct, p.actualB2SocPct]) {
      if (soc != null && Number.isFinite(soc)) {
        if (soc < socMin) socMin = soc
        if (soc > socMax) socMax = soc
      }
    }
    const lim = p.siteGridLimitKw
    if (lim != null && Number.isFinite(lim)) {
      capKw = Math.max(capKw, lim)
      if (p.actualGridKw != null && Math.abs(p.actualGridKw) > lim + EPS) breaches++
    }
  }
  const hasSoc = socMin !== Infinity
  return { socMin: hasSoc ? socMin : 0, socMax: hasSoc ? socMax : 0, hasSoc, breaches, capKw }
}

/** Max points handed to the chart for long windows. */
export const CHART_SERIES_BUDGET = 2000
/** Windows at or below this many days are sent at native resolution. */
export const DOWNSAMPLE_MIN_DAYS = 3

const STEP_15_MIN = 900_000
const MS_DAY = 86_400_000

/**
 * Smallest multiple of 15 min whose bucket count over `windowMs` fits the
 * budget. Returns 0 when no downsampling is needed (short window).
 */
export function chartStepMs(windowMs: number, maxPoints = CHART_SERIES_BUDGET): number {
  if (windowMs <= DOWNSAMPLE_MIN_DAYS * MS_DAY) return 0
  const raw = Math.ceil(windowMs / maxPoints)
  const step = Math.ceil(raw / STEP_15_MIN) * STEP_15_MIN
  return Math.max(step, STEP_15_MIN)
}

// Field classes — anything not listed falls back to LAST (state-like).
const MEAN_FIELDS = new Set<string>([
  "gridKw",
  "commandedGridKw",
  "actualGridKw",
  "battKw",
  "evKw",
  "evRequestedKw",
  "evServedKw",
  "g1Kw",
  "g2Kw",
  "b1Kw",
  "b2Kw",
  "ev1Kw",
  "ev2Kw",
  "mEv1Kw",
  "mEv2Kw",
  "ev1AcceptKw",
  "ev2AcceptKw",
  "siteGridLimitKw",
  "baseloadKw",
  "evCurtailedKw",
])
const FIRST_FIELDS = new Set<string>(["priceEurMwh"])
/** Handled explicitly, never averaged. */
const SKIP_FIELDS = new Set<string>(["ts", "hour", "segStart", "fromRollup"])

interface Bucket {
  startMs: number
  n: number
  sum: Record<string, number>
  cnt: Record<string, number>
  first: Record<string, number>
  last: Record<string, number>
  /** Non-numeric passthrough (first seen). */
  other: Record<string, unknown>
  segStart: boolean
  allRollup: boolean
}

/**
 * Bucket `series` onto a `stepMs` grid aligned to UTC midnight. `originMs` is
 * the report window start so `hour` stays on the same axis as before.
 * Returns the input untouched when `stepMs` is 0 or the series is already
 * within budget at that step.
 */
export function downsampleSeries(
  series: BacktestSeriesPoint[],
  stepMs: number,
  originMs: number,
): BacktestSeriesPoint[] {
  if (!stepMs || series.length === 0) return series
  const buckets = new Map<number, Bucket>()

  for (const p of series) {
    const ms = new Date(p.ts).getTime()
    if (!Number.isFinite(ms)) continue
    const startMs = Math.floor(ms / stepMs) * stepMs
    let b = buckets.get(startMs)
    if (!b) {
      b = { startMs, n: 0, sum: {}, cnt: {}, first: {}, last: {}, other: {}, segStart: false, allRollup: true }
      buckets.set(startMs, b)
    }
    b.n++
    if (p.segStart) b.segStart = true
    if (!p.fromRollup) b.allRollup = false
    for (const [k, v] of Object.entries(p as unknown as Record<string, unknown>)) {
      if (SKIP_FIELDS.has(k)) continue
      if (typeof v !== "number" || !Number.isFinite(v)) {
        if (v != null && !(k in b.other) && typeof v !== "number") b.other[k] = v
        continue
      }
      if (MEAN_FIELDS.has(k)) {
        b.sum[k] = (b.sum[k] ?? 0) + v
        b.cnt[k] = (b.cnt[k] ?? 0) + 1
      } else if (FIRST_FIELDS.has(k)) {
        if (!(k in b.first)) b.first[k] = v
      } else {
        b.last[k] = v
      }
    }
  }

  if (buckets.size >= series.length) return series

  const out: BacktestSeriesPoint[] = []
  const r2 = (v: number) => Math.round(v * 100) / 100
  for (const startMs of [...buckets.keys()].sort((a, b) => a - b)) {
    const b = buckets.get(startMs)!
    const ms = startMs + stepMs / 2
    const pt: Record<string, unknown> = {
      ...b.other,
      ts: new Date(ms).toISOString(),
      hour: (ms - originMs) / 3_600_000,
    }
    for (const k of Object.keys(b.sum)) pt[k] = r2(b.sum[k] / b.cnt[k])
    for (const k of Object.keys(b.first)) pt[k] = b.first[k]
    for (const k of Object.keys(b.last)) pt[k] = r2(b.last[k])
    if (b.segStart) pt.segStart = true
    if (b.allRollup) pt.fromRollup = true
    out.push(pt as unknown as BacktestSeriesPoint)
  }
  return out
}
