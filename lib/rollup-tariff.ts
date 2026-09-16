/**
 * LOSSLESS ROLLUP PAYLOAD — everything a frozen (station, UTC day) row must
 * carry so a report served from rollups is NUMERICALLY EQUIVALENT to the same
 * range replayed from raw frames (Gronau defect report, sep 2 2026).
 *
 * Before this module a rollup row only froze import kWh + the IDM-priced
 * energy cost. Reports stitched over rollups therefore LOST the grid-first
 * counterfactual (→ "Dynamic no-dispatch" = 0, timing value negative), the
 * wear diagnostics (→ as-run wear only from the raw tail) and the charging
 * sessions (→ 100 → 32 sessions for the same closed month). Now each day
 * freezes:
 *
 *   1. `tariff`   — the tariff engine's per-day scalars (compute() run on the
 *                   day itself, adder = 0, default grid cap). Read time adds the
 *                   configurable adder / cycling rate on top of the frozen kWh.
 *   2. `sessions` — the day's derived C1/C2 sessions (merged across midnight at
 *                   read time, so a car plugged in 23:50 → 00:20 counts once).
 *   3. `series15` — a compact 15-minute series for charts (96 points/day), so
 *                   Dispatching History renders a full-month chart from rollups
 *                   without replaying ~170k frames.
 *
 * This file is framework-free (no React, no "server-only") because compute()
 * consumes the frozen values in the browser as well as in server jobs.
 */

import type { BacktestSeriesPoint } from "@/lib/backtest"
import type { ChargerSession } from "@/lib/charger-sessions"
import type { Computed } from "@/lib/tariff-compute"

// ── 1. Frozen tariff scalars ────────────────────────────────────────────────

/** Version stamp — bump when the frozen field set changes (read path tolerates missing = legacy row). */
export const ROLLUP_TARIFF_VERSION = 2

export interface RollupTariffFrozen {
  v: number
  /** Grid import cap (kW) the counterfactual was frozen with. */
  gridCapKw: number
  /**
   * The per-frame SIMULATION's grid-first import over the day incl. SOC
   * true-up (kWh). Since method 2026-09-04.4 this is the PRICING SHAPE only:
   * the headline "procurement without load shifting" is the energy-balance
   * rule, applied at READ time in compute() from `import_kwh`,
   * `battMeterChargeKwh` and `noArbChargeKwh` (v ≥ 2 rows freeze the sim
   * here explicitly; v 1 rows froze the same quantity under its old name).
   */
  noArbImportKwh: number
  /** That simulated import priced per 15-min slot on IDM (DAM fallback), adder = 0 (€). */
  noArbEnergyCostEur: number
  /** As-run battery throughput Σ|P_batt|·dt BEFORE deadband exclusion (kWh) = kpis.batteryThroughputKwh. */
  throughputRawKwh: number
  /** Idle jitter/balancing share (|P| < 2 kW) — strategy-independent, excluded from wear (kWh). */
  deadbandKwh: number
  /** As-run wear basis = throughputRaw − deadband (kWh). */
  throughputWithArbKwh: number
  /** Baseline wear basis before measured overhead: 2× forced peak-shave + |true-up| (kWh). */
  throughputNoArbRawKwh: number
  /** Baseline wear basis after × (1 + gapShare) (kWh). */
  throughputNoArbKwh: number
  // Diagnostics (window-level ratios are recomputed from these sums at read time)
  bmsKwh: number
  socImpliedKwh: number
  noArbDischargeKwh: number
  noArbChargeKwh: number
  /** Measured pack SOC at the first / last frame of the day (%). */
  socStartPct: number
  socEndPct: number
  /** End-of-day stored-energy true-up applied to the baseline (kWh, signed). */
  storedDiffKwh: number
  totalCapacityKwh: number
  /** Battery-meter legs + measured SOC movement for the day (kWh). Their Σ
   *  over a window gives the pack's OWN round-trip ratio — the diagnostic
   *  shown next to the fleet constant (method 2026-09-04.1). Absent on rows
   *  frozen before → read as 0. */
  battMeterChargeKwh?: number
  battMeterDischargeKwh?: number
  battMeterSocDeltaKwh?: number
  /** The round-trip efficiency this day's baseline recharge was grossed up with
   *  (fleet constant; 0.85 on rows frozen before 2026-09-04.1, where absent). */
  noArbRoundTripEff?: number
  /** compute()'s own IDM-priced import cost from the downsampled series — diagnostic vs the frame-exact `dynamic_cost_eur` column. */
  dynamicCostComputeEur: number
}

/**
 * Reduce a single-day compute() result to the frozen scalar set. The
 * compute() call MUST have been made with adderCt = 0 (energy-only cost) so
 * the read path can add the configurable adder as `noArbImportKwh × adder`.
 */
export function freezeDayTariff(c: Computed, gridCapKw: number): RollupTariffFrozen {
  const first = c.socSeries[0]
  const last = c.socSeries[c.socSeries.length - 1]
  return {
    v: ROLLUP_TARIFF_VERSION,
    gridCapKw,
    // The SIMULATION's own figures (shape) — never the rule result, so the
    // read path can re-apply the rule with any loss share without drift.
    noArbImportKwh: c.simNoArbImportKwh,
    noArbEnergyCostEur: c.simNoArbCostEur,
    throughputRawKwh: c.throughputWithArbKwh + c.throughputDiag.deadbandKwh,
    deadbandKwh: c.throughputDiag.deadbandKwh,
    throughputWithArbKwh: c.throughputWithArbKwh,
    throughputNoArbRawKwh: c.throughputNoArbRawKwh,
    throughputNoArbKwh: c.throughputNoArbKwh,
    bmsKwh: c.throughputDiag.bmsKwh,
    socImpliedKwh: c.throughputDiag.socImpliedKwh,
    noArbDischargeKwh: c.throughputDiag.noArbDischargeKwh,
    noArbChargeKwh: c.throughputDiag.noArbChargeKwh,
    socStartPct: first?.arbSoc ?? 0,
    socEndPct: last?.arbSoc ?? 0,
    storedDiffKwh: c.storedDiffKwh,
    totalCapacityKwh: c.totalCapacityKwh,
    battMeterChargeKwh: c.battMeterChargeKwh,
    battMeterDischargeKwh: c.battMeterDischargeKwh,
    battMeterSocDeltaKwh: c.battMeterSocDeltaKwh,
    noArbRoundTripEff: c.noArbRoundTripEff,
    dynamicCostComputeEur: c.dynamicCost,
  }
}

// ── 2. Sessions across day boundaries ───────────────────────────────────────

/**
 * Mirror of deriveSessionsFromRows' GAP_MS: two sessions on the same
 * connector whose gap is ≤ this are one charge that a day boundary split.
 */
export const SESSION_MERGE_GAP_MS = 8 * 60_000

/**
 * Merge sessions that were derived per UTC day (rollups) and per raw segment
 * back into the list a single continuous replay would have produced. Same
 * connector + gap ≤ SESSION_MERGE_GAP_MS ⇒ merge (energy/frames summed,
 * end-side fields from the later part). Output sorted by start time.
 */
export function mergeSessions(parts: ChargerSession[]): ChargerSession[] {
  const byUnit = new Map<string, ChargerSession[]>()
  for (const s of parts) {
    const list = byUnit.get(s.unitId) ?? []
    list.push(s)
    byUnit.set(s.unitId, list)
  }
  const out: ChargerSession[] = []
  for (const list of byUnit.values()) {
    list.sort((a, b) => a.startMs - b.startMs)
    let cur: ChargerSession | null = null
    for (const s of list) {
      if (cur !== null && s.startMs - cur.endMs <= SESSION_MERGE_GAP_MS) {
        const prev: ChargerSession = cur
        const mergedKwh: number = Math.round((prev.energyKwh + s.energyKwh) * 100) / 100
        const endMs: number = Math.max(prev.endMs, s.endMs)
        const hours: number = Math.max((endMs - prev.startMs) / 3_600_000, 1 / 240)
        const next: ChargerSession = {
          ...prev,
          endMs,
          endIso: new Date(endMs).toISOString(),
          energyKwh: mergedKwh,
          avgKw: Math.round((mergedKwh / hours) * 10) / 10,
          frames: prev.frames + s.frames,
          endSocPct: s.endSocPct ?? prev.endSocPct,
          etaFullS: s.etaFullS ?? prev.etaFullS,
        }
        cur = next
      } else {
        if (cur !== null) out.push(cur)
        cur = { ...s }
      }
    }
    if (cur !== null) out.push(cur)
  }
  return out.sort((a, b) => a.startMs - b.startMs)
}

// ── 3. Compact 15-minute chart series ───────────────────────────────────────

export const SERIES15_STEP_MS = 900_000

/** Column order of `rows` — power fields are bucket means, SOC = last sample, price = first non-null. */
export const SERIES15_COLS = [
  "socPct",
  "b1SocPct",
  "b2SocPct",
  "actualB1SocPct",
  "actualB2SocPct",
  "gridKw",
  "actualGridKw",
  "battKw",
  "evKw",
  "mEv1Kw",
  "mEv2Kw",
  "priceEurMwh",
  "siteGridLimitKw",
  "baseloadKw",
] as const

export interface RollupSeries15 {
  /** Epoch ms of the first bucket start (UTC day start). */
  t0: number
  step: number
  cols: readonly string[]
  /** One row per bucket that had ≥1 source point; `null` cells = no data. Row[0] is the bucket index. */
  rows: (number | null)[][]
}

const MEAN_COLS = new Set<string>(["gridKw", "actualGridKw", "battKw", "evKw", "mEv1Kw", "mEv2Kw", "siteGridLimitKw", "baseloadKw"])

/** Downsample the engine's ≤600-point day series to 15-min buckets. */
export function compactSeries15(series: BacktestSeriesPoint[], dayIso: string): RollupSeries15 {
  const t0 = Date.parse(`${dayIso}T00:00:00.000Z`)
  const acc = new Map<number, { sum: Record<string, number>; n: Record<string, number>; last: Record<string, number | null>; first: Record<string, number | null> }>()
  for (const p of series) {
    const ms = new Date(p.ts).getTime()
    const idx = Math.floor((ms - t0) / SERIES15_STEP_MS)
    if (idx < 0 || idx >= 96) continue
    let b = acc.get(idx)
    if (!b) {
      b = { sum: {}, n: {}, last: {}, first: {} }
      acc.set(idx, b)
    }
    for (const col of SERIES15_COLS) {
      const v = (p as unknown as Record<string, number | null | undefined>)[col]
      if (v == null || !Number.isFinite(v)) continue
      if (MEAN_COLS.has(col)) {
        b.sum[col] = (b.sum[col] ?? 0) + v
        b.n[col] = (b.n[col] ?? 0) + 1
      } else if (col === "priceEurMwh") {
        if (b.first[col] == null) b.first[col] = v
      } else {
        b.last[col] = v
      }
    }
  }
  const rows: (number | null)[][] = []
  for (const idx of [...acc.keys()].sort((a, b) => a - b)) {
    const b = acc.get(idx)!
    const row: (number | null)[] = [idx]
    for (const col of SERIES15_COLS) {
      let v: number | null = null
      if (MEAN_COLS.has(col)) v = b.n[col] ? b.sum[col] / b.n[col] : null
      else if (col === "priceEurMwh") v = b.first[col] ?? null
      else v = b.last[col] ?? null
      row.push(v == null ? null : Math.round(v * 100) / 100)
    }
    rows.push(row)
  }
  return { t0, step: SERIES15_STEP_MS, cols: SERIES15_COLS, rows }
}

/**
 * Expand a frozen day series back into chart points. `originMs` is the report
 * window start so `hour` lines up with the raw-replayed segments on one axis.
 * Points are tagged `fromRollup` so compute() charts them but never folds them
 * into totals (those come from the frozen scalars).
 */
export function expandSeries15(s: RollupSeries15, originMs: number): BacktestSeriesPoint[] {
  const out: BacktestSeriesPoint[] = []
  const colIdx = new Map<string, number>()
  s.cols.forEach((c, i) => colIdx.set(c, i + 1))
  const get = (row: (number | null)[], col: string): number | null => {
    const i = colIdx.get(col)
    return i == null ? null : (row[i] ?? null)
  }
  for (const row of s.rows) {
    const idx = row[0] ?? 0
    // Bucket midpoint keeps means centred; SOC (last sample) is close enough at 15-min grain.
    const ms = s.t0 + idx * s.step + s.step / 2
    const soc = get(row, "socPct") ?? 0
    out.push({
      ts: new Date(ms).toISOString(),
      hour: (ms - originMs) / 3_600_000,
      socPct: soc,
      b1SocPct: get(row, "b1SocPct") ?? soc,
      b2SocPct: get(row, "b2SocPct") ?? soc,
      actualB1SocPct: get(row, "actualB1SocPct"),
      actualB2SocPct: get(row, "actualB2SocPct"),
      gridKw: get(row, "gridKw") ?? 0,
      actualGridKw: get(row, "actualGridKw") ?? 0,
      battKw: get(row, "battKw") ?? 0,
      evKw: get(row, "evKw") ?? 0,
      mEv1Kw: get(row, "mEv1Kw"),
      mEv2Kw: get(row, "mEv2Kw"),
      priceEurMwh: get(row, "priceEurMwh"),
      siteGridLimitKw: get(row, "siteGridLimitKw"),
      baseloadKw: get(row, "baseloadKw"),
      fromRollup: true,
    })
  }
  return out
}

// ── Shape of the jsonb `detail` column on station_day_report ────────────────

export interface RollupDetail {
  daily?: unknown
  totals?: {
    actualImportKwh?: number
    optimizedImportKwh?: number
    evKwh?: number
    mEv1Kwh?: number
    mEv2Kwh?: number
    auxKwh?: number
    /** Energy-balance closers, frozen since method 2026-09-03.3 (absent before). */
    battNetKwh?: number | null
    exportKwh?: number | null
    /** Legacy per-frame clamped AUX and the physics-gated residual — reconciliation only. */
    auxClampedKwh?: number | null
    auxGatedKwh?: number | null
  }
  kpis?: { savingsPct?: number; batteryThroughputKwh?: number; batteryCycles?: number; durationHours?: number }
  /** Present on rows frozen by the lossless rollup (v ≥ 1). */
  tariff?: RollupTariffFrozen
  sessions?: ChargerSession[]
  series15?: RollupSeries15
  /** Where the day's frames came from when it was frozen. */
  frameSource?: "stored" | "live" | "hybrid"
}
