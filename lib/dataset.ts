// ════════════════════════════════════════════════════════════════════════
// DATASET QUERIES — read stored telemetry for the explorer + data-quality.
// ════════════════════════════════════════════════════════════════════════

import "server-only"
import { db } from "./db"
import { telemetryFrame } from "./db/schema"
import { and, asc, eq, gte, lte } from "drizzle-orm"
import { deriveEvLoadW } from "./telemetry-normalize"
import { getChargerSessions, type ChargerSession } from "./charger-sessions"
import {
  BATT_CAPACITY_KWH,
  BATT_MAX_POWER_KW,
  ROUND_TRIP_EFF,
  WEAR_COST_EUR_PER_MWH,
} from "./dispatch-kernel"

export interface DatasetPoint {
  ts: string
  /** Hours elapsed from the first frame in range — numeric x-axis. */
  hour: number
  socAvg: number | null
  /** Per-pack SOC so B1/B2 can be plotted separately. */
  b1SocPct: number | null
  b2SocPct: number | null
  gridKw: number | null
  /** Grid import as a positive number (= -gridKw, since +gridKw is export). */
  importKw: number | null
  evKw: number | null
  battKw: number | null
  priceEurMwh: number | null
}

export interface EnergyTotals {
  /** Total energy imported from the grid over the window (kWh). */
  importKwh: number
  /** Total EV energy delivered over the window (kWh), from the power balance. */
  evKwh: number
}

// ════════════════════════════════════════════════════════════════════════
// ARBITRAGE KPIs — the three inputs needed for a real estimate:
//   1. Inter-session gap distribution → timeable fraction
//   2. Buffer energy capacity (kWh)
//   3. Day-ahead price series → capturable spread
// ════════════════════════════════════════════════════════════════════════

export interface SessionStats {
  /** Number of charging sessions in the window. */
  sessionCount: number
  /** Average session energy (kWh). */
  avgEnergyKwh: number
  /** Average session duration (hours). */
  avgDurationHours: number
  /** Average session power (kW). */
  avgPowerKw: number
}

export interface GapDistribution {
  /** Total number of inter-session gaps. */
  gapCount: number
  /** Gaps sorted ascending (hours). */
  gapsSortedHours: number[]
  /** Percentiles: p10, p25, p50, p75, p90 (hours). */
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  /** Mean gap duration (hours). */
  meanGapHours: number
  /** Total hours where battery is "free" (no EV session in progress). */
  totalFreeHours: number
  /** Timeable fraction: share of time the battery is available for arbitrage. */
  timeableFraction: number
}

export interface PriceStats {
  /** Number of price slots in the window. */
  slotCount: number
  /** Min price (EUR/MWh). */
  minPrice: number
  /** Max price (EUR/MWh). */
  maxPrice: number
  /** Mean price (EUR/MWh). */
  meanPrice: number
  /** Gross spread: max - min (EUR/MWh). */
  grossSpread: number
  /** Net spread after round-trip efficiency and wear cost (EUR/MWh). */
  netSpread: number
  /** Price standard deviation (EUR/MWh). */
  stdDev: number
}

/**
 * Buffer (battery) energy capacity ESTIMATED FROM METERED DATA, not the spec
 * nameplate. Method: the pack reports both SOC (%) and battery power (W) every
 * frame. Over any segment, the net energy that flows through the terminals,
 * E = ∫P·dt (kWh), must equal Capacity × ΔSOC_fraction. So a sustained
 * charge/discharge of E kWh that moves SOC by ΔSOC% implies a full-range
 * capacity of  Capacity = E / (ΔSOC/100). Computed over many segments → a
 * distribution (min / median / avg / max) that brackets the true usable energy.
 */
export interface BufferCapacityStats {
  /** Spec/nameplate assumption (kWh) = 2 × BATT_CAPACITY_KWH. The OLD value. */
  specCapacityKwh: number
  /** Number of valid SOC-swing segments used to estimate capacity. */
  sampleCount: number
  /** Minimum total-capacity estimate across segments (kWh). */
  estMinKwh: number
  /** Mean total-capacity estimate (kWh). */
  estAvgKwh: number
  /** Median total-capacity estimate (kWh) — the robust headline number. */
  estMedianKwh: number
  /** Maximum total-capacity estimate (kWh). */
  estMaxKwh: number
  /** Std deviation of the estimates (kWh) — lower = higher confidence. */
  estStdDevKwh: number
  /** Lowest SOC observed in the window (%). */
  socMinPct: number
  /** Highest SOC observed in the window (%). */
  socMaxPct: number
  /** Observed SOC span = socMax − socMin (%). Wider = better-conditioned. */
  socSpanPct: number
  /** Which figure the arbitrage estimate uses: "metered" if enough samples. */
  source: "metered" | "spec"
}

/**
 * Battery + EV POWER ("speed") statistics straight from the metered frames —
 * battPowerW (sign: + discharge, − charge) and the reconstructed EV load.
 */
export interface PowerStats {
  /** Peak metered battery CHARGE power (kW). */
  battChargeMaxKw: number
  /** Mean battery CHARGE power over charging frames (kW). */
  battChargeAvgKw: number
  /** Peak metered battery DISCHARGE power (kW). */
  battDischargeMaxKw: number
  /** Mean battery DISCHARGE power over discharging frames (kW). */
  battDischargeAvgKw: number
  /** Spec ceiling for comparison = 2 × BATT_MAX_POWER_KW (kW). */
  battSpecMaxKw: number
  /** Peak metered EV charging power (kW). */
  evMaxKw: number
  /** Mean EV charging power over active frames (kW). */
  evAvgKw: number
  /** Lowest non-zero EV charging power over active frames (kW). */
  evMinKw: number
}

export interface ArbitrageEstimate {
  /** Buffer energy capacity used for the estimate (kWh) — metered when available. */
  bufferCapacityKwh: number
  /** Usable capacity after SOC band constraints (~85% of total). */
  usableCapacityKwh: number
  /** Number of full cycles possible per day given timeable fraction. */
  cyclesPerDay: number
  /** Gross arbitrage potential (EUR) = cycles × usable capacity × gross spread. */
  grossArbitrageEur: number
  /** Net arbitrage after efficiency + wear (EUR). */
  netArbitrageEur: number
  /** Baseline cost: what you'd pay without any optimization (EUR). */
  baselineCostEur: number
  /** Target cost: what you'd pay with perfect arbitrage (EUR). */
  targetCostEur: number
  /** Potential savings (EUR) = baseline - target. */
  potentialSavingsEur: number
  /** Savings as percentage of baseline. */
  savingsPercent: number
}

export interface ArbitrageKpis {
  sessionStats: SessionStats
  gapDistribution: GapDistribution
  priceStats: PriceStats
  bufferCapacity: BufferCapacityStats
  powerStats: PowerStats
  arbitrageEstimate: ArbitrageEstimate
}

export interface DataQuality {
  rowsInRange: number
  expectedStepSeconds: number
  gapCount: number
  largestGapSeconds: number
  duplicateTimestamps: number
  /** Frames where the meter implies grid EXPORT (grid frame: positive = export). */
  observedExportFrames: number
  nullPriceFrames: number
}

export interface DatasetResult {
  points: DatasetPoint[]
  quality: DataQuality
  /** Derived C1/C2 charging sessions (BMS-only, non-optimised). */
  sessions: ChargerSession[]
  totals: EnergyTotals
  /** Arbitrage KPIs: session stats, gap distribution, price stats, estimate. */
  arbitrage: ArbitrageKpis
}

const MAX_POINTS = 800

export async function getDatasetSeries(args: {
  stationId: string
  fromIso: string
  toIso: string
  stepSeconds?: number
}): Promise<DatasetResult> {
  const stepSeconds = args.stepSeconds ?? 15
  const rows = await db
    .select({
      ts: telemetryFrame.ts,
      socAvg: telemetryFrame.socAvg,
      socPackA: telemetryFrame.socPackA,
      socPackB: telemetryFrame.socPackB,
      gridPowerW: telemetryFrame.gridPowerW,
      evLoadW: telemetryFrame.evLoadW,
      battPowerW: telemetryFrame.battPowerW,
      priceEurMwh: telemetryFrame.priceEurMwh,
    })
    .from(telemetryFrame)
    .where(
      and(
        eq(telemetryFrame.stationId, args.stationId),
        gte(telemetryFrame.ts, new Date(args.fromIso)),
        lte(telemetryFrame.ts, new Date(args.toIso)),
      ),
    )
    .orderBy(asc(telemetryFrame.ts))

  // Data-quality scan + energy integration over the full (un-downsampled) set.
  let gapCount = 0
  let largestGapSeconds = 0
  let duplicateTimestamps = 0
  let observedExportFrames = 0
  let nullPriceFrames = 0
  let importKwh = 0
  let evKwh = 0
  let prevMs: number | null = null
  const originMs = rows.length ? new Date(rows[0].ts).getTime() : 0

  // ── Metered POWER ("speed") accumulators ──────────────────────────────────
  let battChargeMaxKw = 0
  let battDischargeMaxKw = 0
  let battChargeSumKw = 0
  let battChargeFrames = 0
  let battDischargeSumKw = 0
  let battDischargeFrames = 0
  let evMaxKw = 0
  let evMinKw = Number.POSITIVE_INFINITY
  let evSumKw = 0
  let evFrames = 0

  // ── Metered CAPACITY-estimation accumulators ──────────────────────────────
  // Estimate full-range pack capacity from the SOC↔energy relation:
  //   Capacity = (net energy through terminals over a segment) / (ΔSOC fraction)
  // We anchor at a SOC, integrate net STORED energy (charge +, discharge −) and
  // gross throughput, and close a segment once SOC has swung past a threshold.
  // Segments must be mostly one-directional (net/gross ≥ ratio) so round-trip
  // loss on back-and-forth cycling doesn't inflate the estimate.
  const SOC_SWING_PCT = 8 // minimum |ΔSOC| to close a capacity segment
  const MONOTONIC_RATIO = 0.6 // |net| / gross floor — rejects noisy segments
  const capEstimates: number[] = []
  let socMinPct = Number.POSITIVE_INFINITY
  let socMaxPct = Number.NEGATIVE_INFINITY
  let anchorSoc: number | null = null
  let segStoredKwh = 0 // net stored energy since anchor (charge +)
  let segGrossKwh = 0 // gross |throughput| since anchor

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const ms = new Date(r.ts).getTime()
    if (prevMs != null) {
      const deltaS = (ms - prevMs) / 1000
      if (deltaS === 0) duplicateTimestamps++
      else if (deltaS > stepSeconds * 2) {
        gapCount++
        if (deltaS > largestGapSeconds) largestGapSeconds = deltaS
      }
    }
    prevMs = ms
    if (r.gridPowerW != null && r.gridPowerW > 1) observedExportFrames++
    if (r.priceEurMwh == null) nullPriceFrames++

    // Integrate energy with dt to the next frame (clamped, 15s fallback).
    const nextMs = i + 1 < rows.length ? new Date(rows[i + 1].ts).getTime() : ms + stepSeconds * 1000
    const dtH = Math.min(Math.max((nextMs - ms) / 3_600_000, 0), 1) || stepSeconds / 3600
    const importKw = r.gridPowerW != null ? -r.gridPowerW / 1000 : 0 // +import
    if (importKw > 0) importKwh += importKw * dtH
    const evW = deriveEvLoadW(r.gridPowerW, r.battPowerW, r.evLoadW)
    if (evW != null && evW > 0) evKwh += (evW / 1000) * dtH

    // Metered battery power "speed" (battPowerW: + discharge, − charge).
    if (r.battPowerW != null) {
      const battKw = r.battPowerW / 1000
      if (battKw < -0.1) {
        const chargeKw = -battKw
        if (chargeKw > battChargeMaxKw) battChargeMaxKw = chargeKw
        battChargeSumKw += chargeKw
        battChargeFrames++
      } else if (battKw > 0.1) {
        if (battKw > battDischargeMaxKw) battDischargeMaxKw = battKw
        battDischargeSumKw += battKw
        battDischargeFrames++
      }
      // Capacity segment integration: stored energy (charge +) and gross.
      segStoredKwh += -battKw * dtH
      segGrossKwh += Math.abs(battKw) * dtH
    }

    // EV charging "speed".
    if (evW != null && evW > 1) {
      const evKw = evW / 1000
      if (evKw > evMaxKw) evMaxKw = evKw
      if (evKw < evMinKw) evMinKw = evKw
      evSumKw += evKw
      evFrames++
    }

    // Capacity segment close-out on a meaningful SOC swing.
    if (r.socAvg != null) {
      if (r.socAvg < socMinPct) socMinPct = r.socAvg
      if (r.socAvg > socMaxPct) socMaxPct = r.socAvg
      if (anchorSoc == null) {
        anchorSoc = r.socAvg
        segStoredKwh = 0
        segGrossKwh = 0
      } else {
        const dSocPct = r.socAvg - anchorSoc
        if (Math.abs(dSocPct) >= SOC_SWING_PCT) {
          const dSocFrac = dSocPct / 100
          // Net stored energy must agree in sign with the SOC change and the
          // segment must be mostly one-directional to trust the estimate.
          const oneDirectional =
            segGrossKwh > 0 && Math.abs(segStoredKwh) / segGrossKwh >= MONOTONIC_RATIO
          const signsAgree = Math.sign(segStoredKwh) === Math.sign(dSocFrac)
          if (oneDirectional && signsAgree) {
            const cap = Math.abs(segStoredKwh) / Math.abs(dSocFrac)
            // Reject physically implausible estimates (noise / clock skew).
            if (cap >= 50 && cap <= 2000) capEstimates.push(cap)
          }
          anchorSoc = r.socAvg
          segStoredKwh = 0
          segGrossKwh = 0
        }
      }
    }
  }

  // Downsample for the chart payload.
  const stride = Math.max(1, Math.floor(rows.length / MAX_POINTS))
  const points: DatasetPoint[] = []
  for (let i = 0; i < rows.length; i++) {
    if (i % stride !== 0 && i !== rows.length - 1) continue
    const r = rows[i]
    // p_ev_w is a known-broken source field (stuck at 0) so the stored
    // evLoadW is unusable for older rows; reconstruct EV load from the
    // metered power balance. See deriveEvLoadW.
    const evW = deriveEvLoadW(r.gridPowerW, r.battPowerW, r.evLoadW)
    const ms = new Date(r.ts).getTime()
    points.push({
      ts: new Date(ms).toISOString(),
      hour: (ms - originMs) / 3_600_000,
      socAvg: r.socAvg,
      b1SocPct: r.socPackA,
      b2SocPct: r.socPackB,
      gridKw: r.gridPowerW != null ? r.gridPowerW / 1000 : null,
      importKw: r.gridPowerW != null ? -r.gridPowerW / 1000 : null,
      evKw: evW != null ? evW / 1000 : null,
      battKw: r.battPowerW != null ? r.battPowerW / 1000 : null,
      priceEurMwh: r.priceEurMwh,
    })
  }

  // Derive C1/C2 charging sessions over the same window (BMS-only, non-optimised).
  const sessions = await getChargerSessions({
    stationId: args.stationId,
    fromIso: args.fromIso,
    toIso: args.toIso,
  })

  // ── Compute arbitrage KPIs ─────────────────────────────────────────────────
  const windowHours = rows.length > 0
    ? (new Date(rows[rows.length - 1].ts).getTime() - originMs) / 3_600_000
    : 0

  // 1. Session stats
  const sessionCount = sessions.length
  const totalSessionEnergy = sessions.reduce((sum, s) => sum + s.energyKwh, 0)
  const totalSessionHours = sessions.reduce((sum, s) => sum + (s.endMs - s.startMs) / 3_600_000, 0)
  const avgEnergyKwh = sessionCount > 0 ? totalSessionEnergy / sessionCount : 0
  const avgDurationHours = sessionCount > 0 ? totalSessionHours / sessionCount : 0
  const avgPowerKw = avgDurationHours > 0 ? avgEnergyKwh / avgDurationHours : 0

  // 2. Inter-session gap distribution (sets the timeable fraction)
  // Sort sessions by start time, compute gaps between consecutive sessions.
  const sortedSessions = [...sessions].sort((a, b) => a.startMs - b.startMs)
  const gaps: number[] = []
  for (let i = 1; i < sortedSessions.length; i++) {
    const gapMs = sortedSessions[i].startMs - sortedSessions[i - 1].endMs
    if (gapMs > 0) gaps.push(gapMs / 3_600_000) // hours
  }
  gaps.sort((a, b) => a - b)

  const percentile = (arr: number[], p: number) => {
    if (arr.length === 0) return 0
    const idx = Math.floor(p * (arr.length - 1))
    return arr[idx]
  }

  const totalFreeHours = gaps.reduce((sum, g) => sum + g, 0)
  const timeableFraction = windowHours > 0 ? totalFreeHours / windowHours : 0

  // 3. Price statistics (day-ahead spread drives capturable arbitrage)
  const prices = points
    .map((p) => p.priceEurMwh)
    .filter((p): p is number => p != null && Number.isFinite(p))
  
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0
  const meanPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
  const grossSpread = maxPrice - minPrice
  // Net spread = gross spread × round-trip efficiency - wear cost
  const netSpread = Math.max(0, grossSpread * ROUND_TRIP_EFF - WEAR_COST_EUR_PER_MWH)
  const variance = prices.length > 0
    ? prices.reduce((sum, p) => sum + (p - meanPrice) ** 2, 0) / prices.length
    : 0
  const stdDev = Math.sqrt(variance)

  // 4a. Buffer capacity — METERED estimate from the SOC↔energy segments.
  const specCapacityKwh = BATT_CAPACITY_KWH * 2 // 2 × 280 = 560 kWh nameplate
  const sortedCaps = [...capEstimates].sort((a, b) => a - b)
  const capCount = sortedCaps.length
  const estAvgKwh = capCount > 0 ? sortedCaps.reduce((a, b) => a + b, 0) / capCount : 0
  const estMedianKwh = capCount > 0 ? percentile(sortedCaps, 0.5) : 0
  const capVariance =
    capCount > 0 ? sortedCaps.reduce((s, c) => s + (c - estAvgKwh) ** 2, 0) / capCount : 0
  const estStdDevKwh = Math.sqrt(capVariance)
  // Need a handful of well-conditioned segments before trusting the meter over
  // the nameplate; otherwise fall back to the spec capacity.
  const MIN_CAP_SAMPLES = 3
  const capacitySource: "metered" | "spec" = capCount >= MIN_CAP_SAMPLES ? "metered" : "spec"
  const bufferCapacityKwh = capacitySource === "metered" ? estMedianKwh : specCapacityKwh

  // 4b. Arbitrage estimate
  // Usable capacity: SOC band 10-95% ≈ 85% of total
  const usableCapacityKwh = bufferCapacityKwh * 0.85
  // Cycles per day: limited by timeable fraction × max cycles (assume 2 cycles/day max)
  const maxCyclesPerDay = 2
  const cyclesPerDay = timeableFraction * maxCyclesPerDay
  // Scale to window duration
  const windowDays = windowHours / 24

  // Gross arbitrage = cycles × usable capacity × gross spread (EUR/MWh → EUR/kWh)
  const grossArbitrageEur = cyclesPerDay * windowDays * usableCapacityKwh * (grossSpread / 1000)
  // Net arbitrage after efficiency + wear
  const netArbitrageEur = cyclesPerDay * windowDays * usableCapacityKwh * (netSpread / 1000)

  // Baseline cost: EV energy × mean price (no optimization)
  const baselineCostEur = evKwh * (meanPrice / 1000)
  // Target cost: EV energy × (mean price - potential savings from arbitrage)
  const targetCostEur = Math.max(0, baselineCostEur - netArbitrageEur)
  const potentialSavingsEur = baselineCostEur - targetCostEur
  const savingsPercent = baselineCostEur > 0 ? (potentialSavingsEur / baselineCostEur) * 100 : 0

  const arbitrage: ArbitrageKpis = {
    sessionStats: {
      sessionCount,
      avgEnergyKwh: Math.round(avgEnergyKwh * 10) / 10,
      avgDurationHours: Math.round(avgDurationHours * 100) / 100,
      avgPowerKw: Math.round(avgPowerKw * 10) / 10,
    },
    gapDistribution: {
      gapCount: gaps.length,
      gapsSortedHours: gaps.map((g) => Math.round(g * 100) / 100),
      p10: Math.round(percentile(gaps, 0.1) * 100) / 100,
      p25: Math.round(percentile(gaps, 0.25) * 100) / 100,
      p50: Math.round(percentile(gaps, 0.5) * 100) / 100,
      p75: Math.round(percentile(gaps, 0.75) * 100) / 100,
      p90: Math.round(percentile(gaps, 0.9) * 100) / 100,
      meanGapHours: gaps.length > 0 ? Math.round((totalFreeHours / gaps.length) * 100) / 100 : 0,
      totalFreeHours: Math.round(totalFreeHours * 10) / 10,
      timeableFraction: Math.round(timeableFraction * 1000) / 1000,
    },
    priceStats: {
      slotCount: prices.length,
      minPrice: Math.round(minPrice * 100) / 100,
      maxPrice: Math.round(maxPrice * 100) / 100,
      meanPrice: Math.round(meanPrice * 100) / 100,
      grossSpread: Math.round(grossSpread * 100) / 100,
      netSpread: Math.round(netSpread * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
    },
    bufferCapacity: {
      specCapacityKwh,
      sampleCount: capCount,
      estMinKwh: capCount > 0 ? Math.round(sortedCaps[0]) : 0,
      estAvgKwh: Math.round(estAvgKwh),
      estMedianKwh: Math.round(estMedianKwh),
      estMaxKwh: capCount > 0 ? Math.round(sortedCaps[capCount - 1]) : 0,
      estStdDevKwh: Math.round(estStdDevKwh),
      socMinPct: Number.isFinite(socMinPct) ? Math.round(socMinPct * 10) / 10 : 0,
      socMaxPct: Number.isFinite(socMaxPct) ? Math.round(socMaxPct * 10) / 10 : 0,
      socSpanPct:
        Number.isFinite(socMinPct) && Number.isFinite(socMaxPct)
          ? Math.round((socMaxPct - socMinPct) * 10) / 10
          : 0,
      source: capacitySource,
    },
    powerStats: {
      battChargeMaxKw: Math.round(battChargeMaxKw * 10) / 10,
      battChargeAvgKw:
        battChargeFrames > 0 ? Math.round((battChargeSumKw / battChargeFrames) * 10) / 10 : 0,
      battDischargeMaxKw: Math.round(battDischargeMaxKw * 10) / 10,
      battDischargeAvgKw:
        battDischargeFrames > 0
          ? Math.round((battDischargeSumKw / battDischargeFrames) * 10) / 10
          : 0,
      battSpecMaxKw: BATT_MAX_POWER_KW * 2,
      evMaxKw: Math.round(evMaxKw * 10) / 10,
      evAvgKw: evFrames > 0 ? Math.round((evSumKw / evFrames) * 10) / 10 : 0,
      evMinKw: Number.isFinite(evMinKw) ? Math.round(evMinKw * 10) / 10 : 0,
    },
    arbitrageEstimate: {
      bufferCapacityKwh: Math.round(bufferCapacityKwh),
      usableCapacityKwh: Math.round(usableCapacityKwh),
      cyclesPerDay: Math.round(cyclesPerDay * 100) / 100,
      grossArbitrageEur: Math.round(grossArbitrageEur * 100) / 100,
      netArbitrageEur: Math.round(netArbitrageEur * 100) / 100,
      baselineCostEur: Math.round(baselineCostEur * 100) / 100,
      targetCostEur: Math.round(targetCostEur * 100) / 100,
      potentialSavingsEur: Math.round(potentialSavingsEur * 100) / 100,
      savingsPercent: Math.round(savingsPercent * 10) / 10,
    },
  }

  return {
    points,
    quality: {
      rowsInRange: rows.length,
      expectedStepSeconds: stepSeconds,
      gapCount,
      largestGapSeconds: Math.round(largestGapSeconds),
      duplicateTimestamps,
      observedExportFrames,
      nullPriceFrames,
    },
    sessions,
    totals: {
      importKwh: Math.round(importKwh * 10) / 10,
      evKwh: Math.round(evKwh * 10) / 10,
    },
    arbitrage,
  }
}
