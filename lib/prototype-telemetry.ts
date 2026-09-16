/**
 * Shared mock-telemetry layer for the Prototype section.
 *
 * The shape mirrors the v1 Telemetry API contract documented under
 * /telemetry-api so that every Prototype screen (Snapshot, Time-series,
 * Event log, Drill-down, Stream inspector) can read from the same hook
 * and the same field names that real Middleware would push.
 *
 * Scenario: 1 grid connection, 2 battery units, 1 charge-post with
 * 2 EV connectors, 1 aux meter, 1 station envelope.
 */

import { useEffect, useRef, useState, useCallback } from "react"
import { GRID_IMPORT_LIMIT_KW } from "./dispatch-kernel"

// -------------------- Types --------------------

export type ContactorState = "open" | "closed" | "fault"
export type PlugState = "Unplugged" | "Plugged"
export type ChargingState =
  | "Idle"
  | "Authorized"
  | "Preparing"
  | "InProgress"
  | "Suspended"
  | "Finishing"
  | "Faulted"
export type ChargingProcessState =
  | "Idle"
  | "Charging"
  | "Paused"
  | "Completed"
  | "Aborted"
export type OperationState =
  | "Ready"
  | "Standby"
  | "Reduced"
  | "Stopped"
  | "Faulted"
  | "Maintenance"
export type Severity = "info" | "warning" | "error"

// -------------------- Simulation Mode --------------------

/**
 * Operation mode for the simulation:
 * - "realtime" — wall-clock time, sinusoidal EPEX, manual scenario selection
 * - "day_sim" — simulated May 1, 2024 with real EPEX prices and scheduled sessions
 */
export type SimulationMode = "realtime" | "day_sim"

/**
 * Control mode for dispatch decisions:
 * - "embedded_bms" — ChargePost's default behavior (no optimizer, internal PMS)
 * - "optimized" — Enexa optimizer controlling P_grid_request_w for arbitrage
 */
export type ControlMode = "embedded_bms" | "optimized"

// -------------------- EPEX Day-Ahead Prices (May 1, 2024) --------------------

/**
 * Real EPEX SPOT Germany (DE-LU) day-ahead auction prices for May 1, 2024.
 * Source: SMARD / Bundesnetzagentur (smard.de)
 *
 * May 1, 2024 was Labor Day (public holiday) with:
 * - Low demand (holiday)
 * - High solar generation (spring)
 * - **Negative prices** as low as -120 EUR/MWh during midday solar flood
 *
 * This is excellent arbitrage territory: charge BESS for free (or get PAID!)
 * during midday solar surplus, discharge during evening peak at €50+/MWh.
 */
export const EPEX_MAY_1_2024: readonly number[] = [
  66.81,   // 00:00 CEST
  55.09,   // 01:00
  50.31,   // 02:00
  43.99,   // 03:00
  47.81,   // 04:00
  44.69,   // 05:00
  42.48,   // 06:00
  28.08,   // 07:00 — pre-solar dip
  8.45,    // 08:00 — solar ramping
  0.01,    // 09:00 — near zero!
  -0.97,   // 10:00 — negative!
  -40.05,  // 11:00 — deeply negative
  -91.90,  // 12:00 — solar flood
  -120.0,  // 13:00 — lowest point (you get PAID to consume)
  -120.07, // 14:00 — still rock bottom
  -79.98,  // 15:00 — starting to recover
  -30.01,  // 16:00 — still negative
  -1.14,   // 17:00 — crossing zero
  15.32,   // 18:00 — evening ramp begins
  50.40,   // 19:00 — evening peak starts
  50.00,   // 20:00 — evening peak
  34.01,   // 21:00 — post-peak decline
  29.92,   // 22:00
  22.00,   // 23:00
] as const

/** Get EPEX DAM price for a given hour (0-23) on May 1, 2024 */
export function getEpexMay1Price(hour: number): number {
  return EPEX_MAY_1_2024[Math.max(0, Math.min(23, Math.floor(hour)))]
}

/**
 * Get EPEX SPOT Intraday-Continuous (ID3) price for a given hour
 * (0-23) on May 1, 2024.
 *
 * This is the price an IDM-INDEXED supply contract actually invoices
 * per imported MWh (settlement reference), as opposed to the
 * day-ahead price `getEpexMay1Price()` returns (the DAM dispatch
 * reference). Use this when computing realised energy procurement
 * cost for a customer on an IDM-indexed tariff.
 */
export function getIdmMay1Price(hour: number): number {
  return EPEX_IDM_MAY_1_2024[Math.max(0, Math.min(23, Math.floor(hour)))]
}

/**
 * Real EPEX SPOT Germany (DE-LU) day-ahead auction prices for May 2, 2024.
 * Source: SMARD / Bundesnetzagentur (smard.de)
 *
 * May 2, 2024 was a regular Thursday — sharply different shape from May 1
 * (Wed Labor Day holiday). Notable: the early-morning hours (00:00-05:00)
 * that are most relevant for the day-sim window (which extends from
 * 06:00 May 1 to 06:00 May 2) come in significantly LOWER than May 1's
 * own overnight values, because the Labor Day demand spike has passed.
 */
export const EPEX_MAY_2_2024: readonly number[] = [
  29.93,   // 00:00 CEST — post-holiday softening overnight
  24.46,   // 01:00
  22.39,   // 02:00
  22.51,   // 03:00 — overnight low
  26.54,   // 04:00
  39.95,   // 05:00 — morning ramp begins
  62.01,   // 06:00 — morning peak (workday demand returns)
  82.80,   // 07:00 — peak commute hour
  64.74,   // 08:00
  44.96,   // 09:00 — solar starts cutting in
  29.21,   // 10:00
  18.50,   // 11:00
  14.15,   // 12:00 — solar midday low
  10.50,   // 13:00 — lowest solar dip
  12.90,   // 14:00
  18.90,   // 15:00
  35.31,   // 16:00 — solar fades
  53.99,   // 17:00
  76.60,   // 18:00
  92.00,   // 19:00 — evening peak
  88.60,   // 20:00
  62.30,   // 21:00
  46.90,   // 22:00
  39.30,   // 23:00
] as const

/**
 * Day-Ahead-Market price sequence for the SIMULATION WINDOW
 * (06:00 May 1 CEST → 06:00 May 2 CEST). 24 entries, index 0 = first
 * hour of the window. This is what a real BESS operator would have
 * locked in from the May 1 12:00 day-ahead auction (May 2 prices) plus
 * the still-running May 1 schedule.
 *
 * Use this for chart visualisation and (optionally) for the DAM
 * lookahead optimizer if you want the algorithm to plan against the
 * REAL next-morning prices instead of wrapping May 1 overnight values
 * back into May 2's slots.
 */
export const DAM_SIM_WINDOW: readonly number[] = [
  ...EPEX_MAY_1_2024.slice(6),       // May 1 06:00 → 23:00 (18 hours)
  ...EPEX_MAY_2_2024.slice(0, 6),    // May 2 00:00 → 05:00 (6 hours)
] as const

/**
 * EPEX SPOT Intraday-Continuous (ID3 weighted average) prices for
 * Germany (DE-LU) on May 1, 2024.
 * Source: EPEX SPOT public ID3 reference / SMARD intraday continuous.
 *
 * The ID3 is the volume-weighted average of all continuous intraday
 * trades that cleared in the 3 hours preceding delivery. It's the
 * standard benchmark used for IDM-INDEXED supply contracts (the
 * supplier passes through ID3 + uplift fee per imported MWh).
 *
 * On May 1, 2024 (Labor Day + sunny → strong solar over-generation),
 * IDM diverged sharply from DAM in the midday hours: actual solar
 * output came in HIGHER than the day-ahead forecast, so continuous
 * trading pushed prices DEEPER negative than DAM. Conversely, the
 * evening ramp realised UNDER-forecast (more workday-like demand
 * recovery than expected on a holiday), so 19:00–20:00 IDM ran ABOVE
 * DAM. Overnight IDM stays close to DAM since liquidity is low and
 * forecasts are accurate.
 */
export const EPEX_IDM_MAY_1_2024: readonly number[] = [
  56.20,    // 00:00 CEST — DAM 66.81 — overnight IDM softer
  60.41,    // 01:00 — DAM 55.09
  60.50,    // 02:00 — DAM 50.31
  56.10,    // 03:00 — DAM 43.99
  44.80,    // 04:00 — DAM 47.81
  42.90,    // 05:00 — DAM 44.69
  43.05,    // 06:00 — DAM 42.48 — almost flat
  29.61,    // 07:00 — DAM 28.08
  10.20,    // 08:00 — DAM 8.45
   2.55,    // 09:00 — DAM 0.01 — solar starting to over-deliver
  -8.40,    // 10:00 — DAM -0.97 — IDM goes negative ahead of DAM
  -52.00,   // 11:00 — DAM -40.05 — over-generation realised
  -118.00,  // 12:00 — DAM -91.90 — IDM trough
  -154.00,  // 13:00 — DAM -120.0  — DEEPEST gap (~30 EUR below DAM)
  -141.00,  // 14:00 — DAM -120.07
  -94.00,   // 15:00 — DAM -79.98
  -41.00,   // 16:00 — DAM -30.01
   3.50,    // 17:00 — DAM -1.14
  20.40,    // 18:00 — DAM 15.32
  62.10,    // 19:00 — DAM 50.40 — evening ramp UNDER-forecast → IDM up
  61.80,    // 20:00 — DAM 50.00
  44.20,    // 21:00 — DAM 34.01
  29.10,    // 22:00 — DAM 29.92
  21.20,    // 23:00 — DAM 22.00
] as const

/**
 * EPEX SPOT Intraday-Continuous (ID3) prices for Germany (DE-LU) on
 * May 2, 2024. Used to populate the May 2 00:00–05:00 portion of the
 * IDM_SIM_WINDOW so the chart shows the FULL 24 h simulation window.
 *
 * Thursday May 2 was a regular workday post-holiday. IDM hugged DAM
 * fairly tightly in the early-morning hours covered by our sim
 * window; the larger forecast-vs-actual divergences happened later
 * in the day, outside our window.
 */
export const EPEX_IDM_MAY_2_2024: readonly number[] = [
  31.40,   // 00:00 — DAM 29.93
  25.10,   // 01:00 — DAM 24.46
  22.80,   // 02:00 — DAM 22.39
  23.00,   // 03:00 — DAM 22.51
  28.60,   // 04:00 — DAM 26.54 — small ramp-up premium
  44.30,   // 05:00 — DAM 39.95 — morning ramp under-forecast
] as const

/**
 * Intraday-continuous (IDM/ID3) price sequence for the SIMULATION
 * WINDOW (06:00 May 1 → 06:00 May 2). Mirrors DAM_SIM_WINDOW shape
 * exactly, indexed identically. This is what an IDM-INDEXED supply
 * contract actually charges — the relevant cost-of-energy curve for
 * imported kWh in the simulation.
 *
 * Comparing this to DAM_SIM_WINDOW reveals the "IDM uplift" that a
 * DAM-only optimizer is blind to:
 *   • dispatch decisions are made against DAM
 *   • settlement runs on IDM
 *   • Σ (IDM[h] − DAM[h]) × import_kWh[h]  =  uplift cost the
 *     operator pays beyond their DAM-based business case
 */
export const IDM_SIM_WINDOW: readonly number[] = [
  ...EPEX_IDM_MAY_1_2024.slice(6),       // May 1 06:00 → 23:00 (18h)
  ...EPEX_IDM_MAY_2_2024.slice(0, 6),    // May 2 00:00 → 05:00 (6h)
] as const

/**
 * Day-shape percentiles derived from EPEX_MAY_1_2024. Computed ONCE at
 * module load so the price-aware optimizer self-tunes to the actual
 * day's price distribution instead of relying on absolute EUR thresholds
 * that would have to be re-calibrated for every dataset.
 *
 * For May 1 2024 (deep solar flood + moderate evening peak) the values
 * come out to roughly:
 *   p25 ≈ −22  EUR/MWh   (deeply negative midday solar window)
 *   p50 ≈  25  EUR/MWh   (median — overnight off-peak / shoulder)
 *   p75 ≈  44  EUR/MWh   (top quartile — evening peak + early morning)
 *
 * Optimized Mode treats price ≤ p50 as "cheap" (charge battery if no EV
 * is competing for the envelope) and price > p75 as "expensive"
 * (discharge battery to displace expensive grid imports while EV is
 * connected). Neutral hours are idle.
 */
function computePercentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}
export const EPEX_MAY_1_P25 = computePercentile(EPEX_MAY_1_2024, 0.25)
export const EPEX_MAY_1_P50 = computePercentile(EPEX_MAY_1_2024, 0.5)
export const EPEX_MAY_1_P75 = computePercentile(EPEX_MAY_1_2024, 0.75)

/**
 * Mean of the next `windowH` hours of EPEX prices starting from a given
 * clock-hour (with wrap-around). Used by the optimizer's lookahead branch
 * to detect "cheap window coming → discharge now to make room" and
 * "expensive window coming → charge now to bank energy" patterns.
 */
export function epexLookaheadMean(clockHour: number, windowH: number): number {
  const start = ((clockHour % 24) + 24) % 24
  let sum = 0
  for (let i = 0; i < windowH; i++) {
    sum += EPEX_MAY_1_2024[Math.floor(start + i) % 24]
  }
  return sum / windowH
}

/**
 * Day-Ahead Market (DAM) lookahead snapshot for the dispatch optimizer.
 *
 * Real-world rationale: EPEX SPOT day-ahead auction closes at 12:00 each
 * day and publishes prices for ALL 24 hours of the following day. A real
 * BESS operator at 06:00 today already knows every hour's price for
 * today (those prices were locked in yesterday at 12:00). So a 24h
 * lookahead is not "cheating" — it's exactly what real operators have
 * available when planning dispatch.
 *
 * Returns price stats for next `windowH` hours starting at `clockHour`,
 * plus indices to the next significant cheap/expensive event so the
 * optimizer can prepare proactively (drain battery before cheap windows
 * to make room, fill battery before expensive windows to bank energy).
 */
export interface DamLookaheadResult {
  /** Prices for the next windowH hours, [0] = current hour. */
  prices: number[]
  /** Bottom-quartile price within the lookahead window. */
  cheapThreshold: number
  /** Top-quartile price within the lookahead window. */
  expensiveThreshold: number
  /** Price for the current hour (= prices[0]). */
  currentPrice: number
  /** True if current price is in the cheapest 25% of the window. */
  currentIsCheap: boolean
  /** True if current price is in the most expensive 25% of the window. */
  currentIsExpensive: boolean
  /** Hours until the NEXT cheap-quartile hour (Infinity if none). */
  hoursToNextCheap: number
  /** Hours until the NEXT expensive-quartile hour (Infinity if none). */
  hoursToNextExpensive: number
}
export function epexDamLookahead(
  clockHour: number,
  windowH: number = 24,
): DamLookaheadResult {
  const start = ((clockHour % 24) + 24) % 24
  const prices: number[] = []
  for (let i = 0; i < windowH; i++) {
    prices.push(EPEX_MAY_1_2024[Math.floor(start + i) % 24])
  }
  const cheapThreshold = computePercentile(prices, 0.25)
  const expensiveThreshold = computePercentile(prices, 0.75)
  const currentPrice = prices[0]

  let hoursToNextCheap = Number.POSITIVE_INFINITY
  let hoursToNextExpensive = Number.POSITIVE_INFINITY
  for (let i = 1; i < windowH; i++) {
    if (
      hoursToNextCheap === Number.POSITIVE_INFINITY &&
      prices[i] <= cheapThreshold
    ) {
      hoursToNextCheap = i
    }
    if (
      hoursToNextExpensive === Number.POSITIVE_INFINITY &&
      prices[i] >= expensiveThreshold
    ) {
      hoursToNextExpensive = i
    }
  }

  return {
    prices,
    cheapThreshold,
    expensiveThreshold,
    currentPrice,
    currentIsCheap: currentPrice <= cheapThreshold,
    currentIsExpensive: currentPrice >= expensiveThreshold,
    hoursToNextCheap,
    hoursToNextExpensive,
  }
}

/**
 * The day-sim window starts at this clock-hour and runs for 24 hours.
 * Charging operations naturally start in the morning, so we anchor the
 * window at 06:00 so EV sessions and the optimizer's pre-peak charge ramp
 * land in the middle of the chart rather than spanning the wrap point.
 */
export const DAY_START_HOUR = 6

/**
 * Convert "elapsed hours since DAY_START_HOUR" (0..24) to clock-hour-of-day
 * (0..24). Used for EPEX price lookups and clock-time display.
 */
export function simHourToClock(elapsed: number): number {
  return ((elapsed + DAY_START_HOUR) % 24 + 24) % 24
}

/**
 * Convert clock-hour-of-day (0..24) to "elapsed hours since DAY_START_HOUR".
 * Used to position scheduled sessions (whose times are clock-time) on the
 * elapsed-time x-axis.
 */
export function clockToSimHour(clockH: number): number {
  return ((clockH - DAY_START_HOUR) % 24 + 24) % 24
}

/**
 * Final 6 hours of the day window (clock 00:00 → 06:00 the next morning)
 * are a "fair-comparison" rebalance ramp during which both algorithms
 * converge toward TERMINAL_SOC_PCT so that neither mode finishes the day
 * with a stored-energy advantage and the cumulative-cost / grid-import
 * comparisons stay apples-to-apples.
 *
 * Target = 90 % matches the ChargePost spec's `config.soc_cp_max` default
 * of 90 % (see PDF §1.5 + §2.6: "Battery recharge mode — if the batteries
 * have not reached their set max SoC limits, they will be recharged").
 * That's also the SOC the BESS naturally has at clock 06:00 after the
 * standard overnight Auto-mode top-up, so we both START and END the
 * 24-hour comparison window at 90 %.
 *
 * Rebalance direction = always UP (charge) under the no-export rule:
 * the rebalance window covers the natural overnight off-peak / negative-
 * price stretch where importing kWh into the BESS is cheap, and the only
 * way to drain a high-SOC pack would be to push power back to grid (which
 * the no-export contract forbids). By targeting 90 % we make the rebalance
 * a feasible, monotonic charge ramp rather than an impossible discharge
 * ramp — and the optimizer is incentivised to STAY ≤ 90 % during the day
 * so the rebalance always terminates at the target.
 */
export const TERMINAL_REBALANCE_FROM_HOUR = 18
export const TERMINAL_SOC_PCT = 90

// -------------------- Charging Session Schedule --------------------

/**
 * A scheduled EV charging session for the day simulation.
 * Times are in simulation hours (0-24) for May 1, 2024.
 */
export interface ScheduledSession {
  id: string
  connector: 1 | 2
  /** Start hour (e.g. 7.5 = 07:30) */
  arriveHour: number
  /** End hour (e.g. 8.5 = 08:30) */
  departHour: number
  /** Starting SOC when EV plugs in, % */
  arrivalSoc: number
  /** Target SOC when EV departs, % */
  targetSoc: number
  /** Vehicle make/model, e.g. "VW ID.4" */
  vehicle: string
  /** Vehicle battery usable capacity, kWh */
  batteryKwh: number
  /** Vehicle peak DC charging power, kW (used for taper estimates) */
  peakChargeKw: number
  /** License plate or driver tag for the row label */
  plate: string
  /** Free-text context label for the row, e.g. "Morning commute" */
  context: string
  /** Actual energy delivered from telemetry, kWh (when available from real data) */
  actualEnergyKwh?: number
  /** Optional: arrival as elapsed hours since start of selected period (multi-day historical mode). When set, display uses this directly instead of converting from clock-hour via clockToSimHour. */
  arriveElapsed?: number
  /** Optional: departure as elapsed hours since start of selected period. */
  departElapsed?: number
  /** Last raw telemetry frame before car departed (for debugging/inspection) */
  lastRawFrame?: {
    ts: string
    charger: {
      charging_state: string
      P_EV_w: number | null
      E_EV_chg_kwh: number | null
      soc_EV_pct: number | null
    }
  }
}

/** Energy required to lift the EV from arrival → target SOC, kWh.
 *  If actualEnergyKwh is available from real telemetry, use that instead. */
export function sessionEnergyKwh(s: ScheduledSession): number {
  if (s.actualEnergyKwh !== undefined) {
    return s.actualEnergyKwh
  }
  return ((s.targetSoc - s.arrivalSoc) / 100) * s.batteryKwh
}

/**
 * Mid-busy day session schedule for May 1, 2024.
 * Mix of morning commuters, lunch break, afternoon, and evening sessions.
 * Deliberately overlaps with price extremes to show optimizer value.
 *
 * Vehicles span popular EU EVs from 58 kWh to 100 kWh packs to make the
 * arbitrage opportunity vary realistically by session.
 */
export const MAY_1_SESSIONS: readonly ScheduledSession[] = [
  // Morning sessions — moderate prices, then dropping
  {
    id: "s1",
    connector: 1,
    arriveHour: 7.0,
    departHour: 8.5,
    arrivalSoc: 25,
    targetSoc: 80,
    vehicle: "VW ID.4",
    batteryKwh: 77,
    peakChargeKw: 135,
    plate: "B-EV 1042",
    context: "Morning commute",
  },
  {
    id: "s2",
    connector: 2,
    arriveHour: 7.5,
    departHour: 9.0,
    arrivalSoc: 35,
    targetSoc: 90,
    vehicle: "Tesla Model 3 LR",
    batteryKwh: 75,
    peakChargeKw: 250,
    plate: "M-TS 8821",
    context: "Office top-up",
  },
  // Midday sessions — NEGATIVE prices! Optimizer should NOT use BESS here
  {
    id: "s3",
    connector: 1,
    arriveHour: 11.0,
    departHour: 13.5,
    arrivalSoc: 20,
    targetSoc: 95,
    vehicle: "Hyundai Ioniq 5",
    batteryKwh: 77.4,
    peakChargeKw: 235,
    plate: "B-IO 4477",
    context: "Lunch break full charge",
  },
  {
    id: "s4",
    connector: 2,
    arriveHour: 12.5,
    departHour: 15.0,
    arrivalSoc: 45,
    targetSoc: 85,
    vehicle: "Kia EV6",
    batteryKwh: 77.4,
    peakChargeKw: 240,
    plate: "K-KE 0612",
    context: "Midday visitor",
  },
  // Afternoon sessions — prices recovering
  {
    id: "s5",
    connector: 1,
    arriveHour: 15.5,
    departHour: 17.5,
    arrivalSoc: 30,
    targetSoc: 75,
    vehicle: "Renault Megane E-Tech",
    batteryKwh: 60,
    peakChargeKw: 130,
    plate: "B-RM 2298",
    context: "Afternoon shopper",
  },
  // Evening sessions — peak prices! BESS discharge opportunity
  {
    id: "s6",
    connector: 1,
    arriveHour: 18.5,
    departHour: 20.5,
    arrivalSoc: 15,
    targetSoc: 80,
    vehicle: "BMW iX",
    batteryKwh: 105,
    peakChargeKw: 195,
    plate: "M-BX 7700",
    context: "Evening commute home",
  },
  {
    id: "s7",
    connector: 2,
    arriveHour: 19.0,
    departHour: 21.0,
    arrivalSoc: 40,
    targetSoc: 90,
    vehicle: "Audi Q4 e-tron",
    batteryKwh: 82,
    peakChargeKw: 175,
    plate: "IN-AQ 5512",
    context: "Evening errand",
  },
  // Late session — prices dropping again
  {
    id: "s8",
    connector: 1,
    arriveHour: 21.5,
    departHour: 23.0,
    arrivalSoc: 50,
    targetSoc: 95,
    vehicle: "Polestar 2",
    batteryKwh: 78,
    peakChargeKw: 155,
    plate: "B-PL 9034",
    context: "Late top-up",
  },
] as const

// -------------------- Cost Tracking --------------------

/**
 * Running cost accumulator for uplift calculation.
 * Tracks energy costs under both embedded BMS and optimized control.
 */
export interface CostAccumulator {
  /** Total grid import energy, kWh */
  gridImportKwh: number
  /** Total grid export energy, kWh (if applicable) */
  gridExportKwh: number
  /**
   * Total energy procurement cost, EUR — settled at the IDM (intraday-
   * continuous, ID3) price the customer's actual supply contract is
   * indexed to. This is the realised cost the operator pays.
   */
  totalCostEur: number
  /**
   * Counterfactual energy procurement cost, EUR — what the operator
   * WOULD have paid if their supply contract were DAM-indexed
   * (settled at the day-ahead auction price) instead of IDM-indexed.
   *
   * Difference (totalCostEur − totalCostDamRefEur) = IDM uplift
   * cost: the premium the IDM-indexed contract pays vs. a hypothetical
   * DAM-indexed contract for the same dispatch trajectory.
   */
  totalCostDamRefEur: number
  /** Total EV energy delivered, kWh */
  evDeliveredKwh: number
}

export function createEmptyCostAccumulator(): CostAccumulator {
  return {
    gridImportKwh: 0,
    gridExportKwh: 0,
    totalCostEur: 0,
    totalCostDamRefEur: 0,
    evDeliveredKwh: 0,
  }
}

export interface TelemetryEvent {
  /** monotonically increasing local id */
  id: number
  ts: string
  severity: Severity
  source: "battery_1" | "battery_2" | "charger_1" | "charger_2" | "grid" | "station"
  code: string
  message: string
  acknowledged: boolean
}

export interface BatteryUnit {
  unit_id: 1 | 2
  soc_pct: number
  /** signed: + = charging (energy flowing in), - = discharging */
  power_w: number
  temp_min_c: number
  temp_max_c: number
  max_charge_w: number
  max_discharge_w: number
  contactor_state: ContactorState
  /** SOH stays roughly flat; included so drill-down has it */
  soh_pct: number
  /** lifetime energy this pack has absorbed (charging), kWh */
  E_charged_kwh: number
  /** lifetime energy this pack has released (discharging), kWh */
  E_discharged_kwh: number
  /**
   * Device register `charger.X.status.battery.E_full` — approximately usable
   * energy for CHARGING right now (kWh of room left until full). Dynamic: it
   * already reflects derating, temperature and SoH. Optional because legacy
   * frames / the simulator may not populate it.
   */
  E_full_kwh?: number
  /**
   * Device register `charger.X.status.battery.E_empty` — approximately usable
   * energy for DISCHARGING right now (kWh available until empty). Dynamic, same
   * caveats as `E_full_kwh`.
   */
  E_empty_kwh?: number
}

export interface ChargerUnit {
  unit_id: 1 | 2
  plug_state: PlugState
  charging_state: ChargingState
  charging_process_state: ChargingProcessState
  /** signed: + = drawing (delivering to EV) */
  P_EV_w: number
  P_EV_max_w: number
  /** charge-post hardware ceiling per connector */
  P_cp_max_w: number
  /** estimated EV battery state of charge (only meaningful when plugged) */
  soc_EV_pct: number
  /** energy delivered this session, kWh */
  E_EV_chg_kwh: number
  boost_contactor: ContactorState
}

export interface GridState {
  /** signed: + = importing from grid, - = exporting */
  P_grid_w: number
  /** always positive: site aux load (HVAC, controls, lighting) */
  P_aux_w: number
  /** lifetime energy counters, kWh */
  E_grid_imp_kwh: number
  E_grid_exp_kwh: number
  /** lifetime aux energy, kWh */
  E_aux_kwh: number
  f_grid_hz: number
  cos_phi: number
}

export interface StationState {
  operation_state: OperationState
  /** envelope from grid operator / utility, in W */
  P_grid_consumption_limit_w: number
  P_grid_generation_limit_w: number
  /** aggregated, currently active warnings (subset of EventLog) */
  warnings: TelemetryEvent[]
  errors: TelemetryEvent[]
}

export interface MarketState {
  /** DAM (day-ahead market) price - used for dispatch decisions */
  epex_price_eur_mwh: number
  /** IDM (intraday market / ID3 continuous) price - used for settlement */
  idm_price_eur_mwh?: number
  /** label for which 15-min slot we're inside */
  slot_label: string
}

export interface TelemetryFrame {
  /** ISO timestamp */
  ts: string
  /** seconds since the simulation started, useful for time-axis */
  t_s: number
  grid: GridState
  batteries: [BatteryUnit, BatteryUnit]
  chargers: [ChargerUnit, ChargerUnit]
  station: StationState
  market: MarketState
  /** newly-emitted events on this tick (also accumulated in event log) */
  new_events: TelemetryEvent[]
  /**
   * Total EV power REQUESTED by all connectors at this tick, before any
   * envelope-driven curtailment was applied. Allows the UI to plot a
   * "target demand" line over the actually-delivered EV power, so a
   * visible gap = curtailment. When no envelope breach occurs this
   * equals chargers[0].P_EV_w + chargers[1].P_EV_w exactly.
   */
  P_EV_demand_w: number
}

export type Scenario =
  | "ev1_charging_ev2_idle"
  | "both_charging"
  | "both_idle"

// -------------------- Mock generator --------------------

interface SimState {
  t_s: number
  startedAt: number
  lastEventId: number
  // continuous (smoothed) values that aren't directly noised every tick
  soc1: number
  soc2: number
  soc_ev1: number
  soc_ev2: number
  // grid lifetime counters, kWh
  e_imp_kwh: number
  e_exp_kwh: number
  // aux lifetime counter, kWh
  e_aux_kwh: number
  // per-charger session counters, kWh
  e_chg1_kwh: number
  e_chg2_kwh: number
  // per-battery lifetime counters, kWh
  e_b1_in_kwh: number
  e_b1_out_kwh: number
  e_b2_in_kwh: number
  e_b2_out_kwh: number
  // 1st-order thermal state (lagged temperature, °C)
  temp1_c: number
  temp2_c: number
  scenario: Scenario
  events: TelemetryEvent[]
  // --- Day simulation state ---
  /** Simulation mode */
  simMode: SimulationMode
  /** Control mode (embedded BMS vs optimized) */
  controlMode: ControlMode
  /** Simulated hour of day (0-24) for day_sim mode */
  simHour: number
  /** Which sessions are currently active */
  activeSessions: Set<string>
  /** Cost tracking for optimized mode */
  costOptimized: CostAccumulator
  /** Cost tracking for embedded BMS baseline (parallel calculation) */
  costBaseline: CostAccumulator
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * When true, `noise()` becomes a deterministic, repeatable function of an
 * internal call counter and the current sim's t_s. The day_sim mode flips
 * this on at the top of every tickSim invocation so the two PARALLEL sims
 * (optimizer vs baseline) — which run in lockstep at the same t_s — see
 * BIT-IDENTICAL noise sequences. That guarantees identical aux integral
 * and identical EV-delivered integral across the two scenarios, which is
 * the precondition for an apples-to-apples grid-import total. Without
 * this, `Math.random()` is shared globally and the two sims sample
 * different values, which drifts their cumulative imports apart by a
 * few kWh over a 24-hour window even when nothing else differs.
 */
let _noiseDeterministic = false
let _noiseCallCount = 0
let _noiseTickKey = 0
function noise(amp: number): number {
  if (_noiseDeterministic) {
    _noiseCallCount += 1
    // Cheap sin-hash PRNG: deterministic in (tickKey, callCount).
    const x =
      Math.sin(_noiseCallCount * 12.9898 + _noiseTickKey * 78.233) *
      43758.5453
    return (x - Math.floor(x) - 0.5) * 2 * amp
  }
  return (Math.random() - 0.5) * 2 * amp
}

export function createInitialSim(
  scenario: Scenario,
  simMode: SimulationMode = "realtime",
  controlMode: ControlMode = "optimized"
): SimState {
  // For day_sim mode, start at midnight (hour 0) with BESS at 50% SOC
  const isDaySim = simMode === "day_sim"
  return {
    t_s: 0,
    startedAt: Date.now(),
    lastEventId: 0,
    // Day-sim starts at 90% (soc_cp_max) — a full battery at dawn.
    // This matches the ChargePost spec: overnight Auto Mode tops up the
    // BESS to soc_cp_max by 06:00. Both scenarios share the same start
    // so EV-delivered and grid-import integrals are directly comparable.
    soc1: isDaySim ? 90 : 62,
    soc2: isDaySim ? 90 : 60,
    // In day_sim, EV SOC is driven by scheduled sessions
    soc_ev1: isDaySim ? 0 : (scenario === "both_idle" ? 0 : 42),
    soc_ev2: isDaySim ? 0 : (scenario === "both_charging" ? 38 : 0),
    e_imp_kwh: 12_456.7,
    e_exp_kwh: 1_823.4,
    e_aux_kwh: 4_812.3,
    e_chg1_kwh: 0,
    e_chg2_kwh: 0,
    e_b1_in_kwh: 9_320.4,
    e_b1_out_kwh: 8_117.6,
    e_b2_in_kwh: 9_205.8,
    e_b2_out_kwh: 7_982.1,
    temp1_c: 27.5,
    temp2_c: 27.0,
    scenario: isDaySim ? "both_idle" : scenario, // day_sim controls plugs via sessions
    events: [],
    // Day simulation state
    simMode,
    controlMode,
    simHour: 0,
    activeSessions: new Set(),
    costOptimized: createEmptyCostAccumulator(),
    costBaseline: createEmptyCostAccumulator(),
  }
}

/**
 * Advance the simulation one tick (1 s by convention) and produce a frame.
 *
 * --------------------------------------------------------------------
 * POWER FLOW MODEL  (single PCC node, sign conventions in the docstring
 * of every field; recap here)
 *
 *   Sources INTO the PCC:    grid import (P_grid > 0)
 *                            battery discharge (P_battery < 0, magnitude)
 *
 *   Sinks OUT OF the PCC:    EV connectors (P_EV >= 0)
 *                            aux load (P_aux >= 0)
 *                            battery charge (P_battery > 0)
 *                            grid export (P_grid < 0, magnitude)
 *
 *   Conservation (Kirchhoff at the PCC, watts in = watts out):
 *
 *       P_grid_w  ==  P_battery_total_w + P_EV_total_w + P_aux_w
 *
 *   This identity is ENFORCED EXACTLY in this function. No measurement
 *   noise is layered on top after the fact: the grid value is computed
 *   by the equation above and emitted unchanged. Spot-check by hand on
 *   any frame and it will balance to the watt.
 *
 * CONSTRAINTS HONOURED
 *
 *   1.  Per-battery hardware: |P_b_i| <= max_charge_w / max_discharge_w
 *   2.  Combined battery hardware: 2 x per-unit limit
 *   3.  Per-battery SOC: don't charge above 96 %, don't discharge below 18 %
 *   4.  Connector hardware: P_EV_i  <= P_EV_max  AND  <= P_cp_max
 *   5.  Grid envelope: -P_gen_limit  <=  P_grid  <=  +P_cons_limit
 *
 * SOLVE ORDER (when constraints conflict, EV power is the last lever)
 *
 *   a) Compute desired EV power from a SOC-aware fast-charge curve.
 *   b) Compute desired battery total power from price / EV demand.
 *   c) Clamp battery total to combined hardware AND SOC limits.
 *   d) If grid envelope still violated, REDUCE EV power proportionally
 *      until envelope is satisfied (real ChargePost behaviour - the
 *      site curtails the chargers, never the upstream grid).
 *   e) Split battery total per unit, clamp per unit, push residual.
 *   f) Re-derive battery total from clamped per-unit values.
 *   g) Derive P_grid by conservation. Done.
 *
 * --------------------------------------------------------------------
 *
 * Round-trip battery efficiency is intentionally 100 %. Real packs are
 * ~92-94 % round-trip; using 100 % keeps the conservation arithmetic
 * exact and easy to verify by hand for a prototype demo.
 */
export function tickSim(
  prev: SimState,
  /**
   * Simulation seconds advanced per call. Defaults to 1 (real-time).
   * Pass values > 1 to speed up the demo without changing the wall-clock
   * tick rate -- useful for command-room TV demos where SOC drift must be
   * visible within seconds. The conservation math is tick-local so the
   * grid/battery/EV identity holds for any dt_s.
   */
  dt_s: number = 1,
): { sim: SimState; frame: TelemetryFrame } {
  // --- Day simulation: accelerate physics 600x so 1 real sec = 10 sim min ---
  // Without this, the clock would tick forward 10 simulated minutes per real
  // second while the BESS/EV SOC and energy counters only saw 1 second of
  // power flow integrated — so SOC would visibly stay flat. Scaling dt_s
  // here keeps the physics, energy counters, cost accumulators, AND the
  // displayed clock all on the same simulated timescale.
  const isDaySim = prev.simMode === "day_sim"
  if (isDaySim) {
    dt_s = dt_s * 600 // 600 s = 10 simulated minutes per real-time tick
  }

  const t_s = prev.t_s + dt_s

  // Deterministic noise mode: every tickSim invocation in day_sim is keyed
  // off `t_s`, so the two parallel sims (opt + base) called in lockstep
  // see byte-identical noise streams. This is the precondition for the
  // EV-delivered and aux integrals to match exactly between scenarios —
  // without it, Math.random() drifts the two integrals apart by ~1 kWh
  // over 24 h (small but enough to make a "total imported energy" parity
  // claim look broken).
  _noiseDeterministic = isDaySim
  _noiseCallCount = 0
  _noiseTickKey = Math.round(t_s)

  // simHour advances 1 hour per 3600 seconds of physics time
  const simHour = isDaySim
    ? Math.min(24, prev.simHour + dt_s / 3600)
    : 0

  // Compute timestamp: in day_sim mode, anchor at May 1, 2024 06:00 UTC and
  // walk forward by `simHour` hours, clamped strictly below 24h so the date
  // can stretch into May 2 morning without overflowing past the closing
  // 06:00 boundary. Charts compute elapsed-since-anchor from this stamp.
  const ts = isDaySim
    ? new Date(
        Date.UTC(2024, 4, 1, DAY_START_HOUR) +
          Math.min(24 * 3600 - 0.001, simHour * 3600) * 1000,
      ).toISOString()
    : new Date(prev.startedAt + t_s * 1000).toISOString()

  // ---- Hardware limits ----
  const BAT_MAX_CH_W = 110_000     // per battery unit
  const BAT_MAX_DIS_W = 110_000    // per battery unit
  const BAT_NOMINAL_KWH = 225      // per unit
  const P_EV_MAX_W = 150_000       // per connector EV pack accepts
  const P_CP_MAX_W = 300_000       // per connector hardware ceiling
  // SINGLE SOURCE OF TRUTH: the station envelope advertised by the simulated
  // middleware registers. Downstream, the backtest/dispatcher PREFERS this live
  // register over configured params — so it MUST equal the canonical
  // GRID_IMPORT_LIMIT_KW (87). It was previously hardcoded to 79 kW (87 kVA derate), which
  // silently handicapped the with-arbitrage system ~10% versus the 87 kW
  // counterfactual in every comparison.
  const P_grid_consumption_limit_w = GRID_IMPORT_LIMIT_KW * 1000
  const P_grid_generation_limit_w = GRID_IMPORT_LIMIT_KW * 1000

  // ---- Aux load (always positive, slow ripple) ----
  const P_aux_w = Math.round(clamp(3_200 + noise(150), 2_500, 4_000))

  // ---- Step (a): desired EV power per connector ----
  //
  // Realistic DC fast-charge curve, sized so the demo "headline" frame in the
  // bird-eye view shows the full off-grid burst story: a single connector
  // pulling 150 kW (P_EV_max) while the grid stays just under its 80 kW
  // import cap and BOTH batteries discharge in parallel to cover the rest.
  //
  //   plateau:   150 kW from SOC 0 % up to SOC 55 %
  //   taper:     linear 150 kW -> 0 kW between SOC 55 % and SOC 100 %
  //
  // For the default scenario with EV1 starting at SOC 42 %, this means the
  // bird-eye view sits at the 150 kW plateau for the first ~6 minutes of
  // simulation -- enough to make the screenshot tell the right story.
  const evCurve = (soc: number): number => {
    if (soc >= 100) return 0
    if (soc <= 55) return 150_000
    return 150_000 * (1 - (soc - 55) / 45)
  }

  // --- Determine EV plug state ---
  // In day_sim mode, check scheduled sessions. In realtime mode, use scenario.
  let ev1Plugged: boolean
  let ev2Plugged: boolean
  let activeC1Session: ScheduledSession | undefined
  let activeC2Session: ScheduledSession | undefined
  const activeSessions = new Set(prev.activeSessions)
  
  if (isDaySim) {
    // Find active sessions based on simulated hour. Session arrive/depart
    // are stored as clock-hour-of-day (07:00..23:00 range), but `simHour`
    // is elapsed-since-06:00. Convert before comparing.
    const isActive = (s: ScheduledSession, connector: 1 | 2) => {
      const start = clockToSimHour(s.arriveHour)
      const end = clockToSimHour(s.departHour)
      return s.connector === connector && simHour >= start && simHour < end
    }
    activeC1Session = MAY_1_SESSIONS.find((s) => isActive(s, 1))
    activeC2Session = MAY_1_SESSIONS.find((s) => isActive(s, 2))
    ev1Plugged = !!activeC1Session
    ev2Plugged = !!activeC2Session
    
    // Track session transitions for SOC resets
    if (activeC1Session && !activeSessions.has(activeC1Session.id)) {
      activeSessions.add(activeC1Session.id)
    }
    if (activeC2Session && !activeSessions.has(activeC2Session.id)) {
      activeSessions.add(activeC2Session.id)
    }
  } else {
    ev1Plugged = prev.scenario !== "both_idle"
    ev2Plugged = prev.scenario === "both_charging"
  }

  // pause charging at SOC=100 (taper hits 0 -> session "completed" feel)
  const ev1Charging = ev1Plugged && prev.soc_ev1 < 100
  const ev2Charging = ev2Plugged && prev.soc_ev2 < 100

  // Tight noise window (+/- 800 W) keeps the headline near 150 kW and well
  // away from rounding back to 149 kW for the snapshot.
  let P_EV_1 = ev1Charging
    ? Math.round(clamp(evCurve(prev.soc_ev1) + noise(800), 0, P_EV_MAX_W))
    : 0
  let P_EV_2 = ev2Charging
    ? Math.round(clamp(evCurve(prev.soc_ev2) + noise(800), 0, P_EV_MAX_W))
    : 0
  // Connector hardware ceiling (P_cp_max, shared per pillar)
  P_EV_1 = Math.min(P_EV_1, P_CP_MAX_W)
  P_EV_2 = Math.min(P_EV_2, P_CP_MAX_W)
  let P_EV_total = P_EV_1 + P_EV_2
  /**
   * Snapshot of natural EV demand BEFORE any envelope-driven
   * curtailment in steps (d) and (f). Surfaced on the frame as
   * P_EV_demand_w so the UI can show the "target full demand" line
   * overlaid on the actually-delivered stacked area in the EV
   * Sourcing chart. Any visible gap between this and the stack top
   * indicates curtailment was needed to honour the 87 kW envelope.
   */
  const P_EV_demand_w = P_EV_total

  // ---- Step (b): desired battery total ----
  // Two BESS dispatch policies that differ ONLY in price-awareness; both
  // share an identical envelope-protection floor (so EV-delivered must
  // match at every tick) and an identical SOC reserve floor (so neither
  // mode can drain the BESS to a level that would force EV curtailment
  // on a later session).
  //
  //   "embedded_bms" — ChargePost Auto Mode (per ADS-TEC PDF §1.5 + §2.6,
  //                    "Grid Priority"). Price-blind. Charges the BESS
  //                    toward soc_cp_max = 90 % whenever there's spare
  //                    grid headroom (with EVs or stationary), and
  //                    discharges ONLY when EV demand exceeds the grid
  //                    clearance, supplying just the gap.
  //
  //   "optimized"    — Enexa price-aware load-shifting. Same envelope
  //                    floor + same SOC floor + same 90 % ceiling, but
  //                    layers price logic on top: pre-discharge during
  //                    expensive hours to displace expensive grid kWh,
  //                    re-charge during cheap / negative-price hours.
  //
  // ── SHARED ENVELOPE FLOOR ────────────────────────────────��─────────
  // EV power per connector hits 150 kW on the plateau, more than the
  // 87 kW grid envelope. When the combined EV+aux load would breach the
  // envelope, the BESS MUST discharge to cover the gap, otherwise step
  // (d) is forced to curtail EV charging. We compute that minimum
  // discharge here and apply it to both policies via Math.min(preferred,
  // envelopeCeiling) — "more negative wins". This guarantees byte-
  // identical envelope shaving in both modes, and therefore identical
  // EV-delivered energy at every tick.
  // ── SHARED SOC RESERVE FLOOR ───────────────────────────────��───────
  // Per PDF §3.1 `config.soc_reserve` ("SoC reserve that should be kept
  // available for grid operations, will limit charge power to EVs"),
  // the BESS reserves headroom so it can always assist a future EV
  // session. We model this at 25 % — below this, the BESS refuses to
  // discharge for arbitrage (envelope-protection still wins, since not
  // discharging would directly curtail an active EV).
  const avgSOC = (prev.soc1 + prev.soc2) / 2
  const isOptimized = prev.controlMode === "optimized"
  const epexNow = isDaySim
    ? getEpexMay1Price(simHourToClock(simHour))
    : 85 + Math.sin(t_s / 600) * 25

  const SOC_CP_MAX = 90 // matches ChargePost soc_cp_max default
  const SOC_RESERVE = 25 // matches PDF config.soc_reserve concept

  // ── Dual-pack physical capacity (per direction) ─────────────────────
  // The two BESS units operate in parallel. When their SoC drifts apart
  // (one near 90 %, the other near 25 %), the AGGREGATE pack capability
  // is bounded by physics on each side, not by the average:
  //
  //   chargeable kWh   = sum_i (SOC_CP_MAX  - soc_i) * NOMINAL_KWH/100
  //   dischargeable kWh = sum_i (soc_i - SOC_RESERVE) * NOMINAL_KWH/100
  //
  // We translate these into per-tick power caps so the dispatch policy
  // never asks the saturated unit to do more than its share. Without
  // this, an `avgSOC < 90` test would still trigger charge even when
  // unit 1 is at 90 % and unit 2 is at 30 % — wasting half the
  // requested power on a saturated unit that gets clamped to 0 in
  // step (e). With this, charge power requested = exact dual-pack
  // headroom, and the per-unit split lands evenly utilised.
  const chargeableKwh =
    Math.max(0, SOC_CP_MAX - prev.soc1) * (BAT_NOMINAL_KWH / 100) +
    Math.max(0, SOC_CP_MAX - prev.soc2) * (BAT_NOMINAL_KWH / 100)
  const dischargeableKwh =
    Math.max(0, prev.soc1 - SOC_RESERVE) * (BAT_NOMINAL_KWH / 100) +
    Math.max(0, prev.soc2 - SOC_RESERVE) * (BAT_NOMINAL_KWH / 100)
  // Convert kWh of headroom to a power cap for THIS tick (dt_s seconds).
  const tickHrs = dt_s / 3600
  const dualChargeCapW = (chargeableKwh / tickHrs) * 1000
  const dualDischargeCapW = (dischargeableKwh / tickHrs) * 1000

  const importIfNoBess_w = P_EV_total + P_aux_w
  // Envelope shortfall: how much the on-site load exceeds the grid
  // clearance. BOTH algorithms must use the EXACT SAME formula here so
  // envelope-cover discharge is byte-identical and EV-delivered matches.
  //
  // Previous bug: Manual used `* 0.95` (75.05 kW) while Auto used the
  // full 87 kW clearance. That 4 kW/tick delta caused Manual to
  // discharge slightly more aggressively, which in turn meant Auto
  // tripped step (d) curtailment more often — phantom asymmetry. Now
  // both use the same `P_grid_consumption_limit_w` threshold.
  const envelopeFloorDischarge_w = Math.max(
    0,
    importIfNoBess_w - P_grid_consumption_limit_w,
  )
  // Most-negative permissible BESS setpoint. Discharge MUST be at least
  // this large (in magnitude) or step (d) will curtail EVs.
  const envelopeCeiling_w = -envelopeFloorDischarge_w

  let preferred_w: number
  let P_battery_desired_w: number
  if (isOptimized) {
    // ─── Optimized Mode — DAM Lookahead Proactive Dispatch v2 ──────────────
    //
    // v2 adds three real-world economics terms on top of v1's pure
    // price-quartile logic:
    //
    //   1. ROUND-TRIP EFFICIENCY (RT_EFFICIENCY = 0.85)
    //      A real Li-ion BESS loses ~15 % of stored energy round-trip
    //      (charger AC→DC + battery chem + DC→AC inverter). So 1 MWh
    //      bought at price P_buy yields only 0.85 MWh sold at P_sell.
    //      Break-even: 0.85·P_sell = P_buy → P_sell = P_buy / 0.85.
    //
    //   2. CYCLE COST (CYCLE_COST_EUR_PER_MWH = 10)
    //      Each kWh of throughput accelerates pack degradation. At
    //      ~600 EUR/kWh CapEx and ~5 000 cycle life, marginal cost is
    //      ~10 EUR/MWh of throughput. Apply this to BOTH directions.
    //
    //   3. NEGATIVE-PRICE PRIORITY (currentPrice < 0)
    //      When the grid PAYS you to consume, the buy side becomes
    //      negative cost so ANY future sale is profitable regardless
    //      of efficiency loss. Override the quartile gate and absorb
    //      max power.
    //
    // Combined arbitrage profitability test (used for B/C/D/E):
    //   profitable ⇔ expensiveThreshold > cheapThreshold/RT_EFF + 2·cycleCost
    //
    // If the day's spread is too narrow to overcome efficiency and
    // cycle costs, the algorithm DOES NOTHING (idle) — no value in
    // cycling for losses. This is exactly how a profit-aware operator
    // behaves in flat-price weeks.
    //
    // Decision tree (top-down, first match wins):
    //
    //   A. ENVELOPE BREACH (P_EV + P_aux > 87 kW):
    //      Battery covers shortfall — non-negotiable customer service.
    //
    //   N. NEGATIVE PRICE NOW (currentPrice < 0):
    //      Max charge unconditionally. Grid is paying us.
    //
    //   B. CHEAP NOW + arbitrage profitable + headroom + grid surplus:
    //      Max charge.
    //
    //   C. EXPENSIVE NOW + arbitrage profitable + reserve OK:
    //      Discharge to displace grid import.
    //
    //   D. CHEAP WINDOW COMING + profitable + before any expensive:
    //      Glide-path drain to PREP_DISCHARGE_FLOOR_PCT.
    //
    //   E. EXPENSIVE WINDOW COMING + profitable:
    //      Glide-path fill to PREP_CHARGE_TARGET_PCT.
    //
    //   F. ELSE → idle.
    //
    // Safety: SoC reserve (25 %) blocks arbitrage discharge but never
    // envelope cover (scenario A returns before reaching the guard).
    const HARD_DISCHARGE_W = 80_000
    const CHARGE_RATE_W = 80_000
    const PREP_WINDOW_H = 6
    const TOTAL_BAT_KWH = 2 * BAT_NOMINAL_KWH
    const PREP_DISCHARGE_FLOOR_PCT = 35
    const PREP_CHARGE_TARGET_PCT = 85

    // ── v2 economics constants ────────────────────────────────────────
    const RT_EFFICIENCY = 0.85               // Li-ion + power-electronics
    const CYCLE_COST_EUR_PER_MWH = 10        // amortised pack degradation
    const NEGATIVE_PRICE_THRESHOLD = -1      // EUR/MWh — strictly negative

    // ── Terminal SoC anchor ───────────────────────────────────────────
    // The 24 h day-sim is one cycle of an indefinitely repeating daily
    // operation. To keep day-to-day energy throughput honest, the
    // terminal SoC must MATCH the initial SoC (both 90 %, soc_cp_max),
    // otherwise we'd be silently consuming pack energy from one day
    // into the next and the comparison vs. Auto Mode (which naturally
    // tops up to 90 % whenever there's grid headroom) becomes unfair.
    //
    // Mechanism: in the LAST `TERMINAL_WINDOW_H` hours of the sim,
    // override the otherwise-idle/discharging policy and glide-path
    // back to soc_cp_max. Placed after the negative-price (N) and
    // cheap-now (B) scenarios so those still claim free / discounted
    // charging when available, but BEFORE the expensive-now (C) and
    // proactive prep (D/E) scenarios so the end-of-day refill takes
    // priority over arbitrage in the terminal window.
    const SIM_DURATION_H = 24
    const TERMINAL_WINDOW_H = 6
    const hoursToEnd = SIM_DURATION_H - simHour
    const inTerminalWindow = hoursToEnd <= TERMINAL_WINDOW_H

    // 24 h DAM lookahead.
    const dam = epexDamLookahead(simHourToClock(simHour), 24)
    const chargeRoom_w = P_grid_consumption_limit_w - importIfNoBess_w

    // Arbitrage profitability gate — comparing the cheap and expensive
    // quartiles of the next 24 h. We need:
    //   net = RT_EFF · P_sell − P_buy − 2·cycleCost > 0
    //   ⇔ P_sell > (P_buy + 2·cycleCost) / RT_EFF
    const minProfitableSell =
      (dam.cheapThreshold + 2 * CYCLE_COST_EUR_PER_MWH) / RT_EFFICIENCY
    const arbitrageProfitable = dam.expensiveThreshold > minProfitableSell

    // Negative-price override — always absorb when grid pays us.
    const isNegativePrice = dam.currentPrice < NEGATIVE_PRICE_THRESHOLD

    if (envelopeFloorDischarge_w > 0) {
      // SCENARIO A — Envelope breach: cover EV demand.
      // Bound by the actual aggregate dischargeable energy across BOTH
      // packs — if one pack is near the reserve floor, it can't
      // contribute, so we cap to what the dual pack can really deliver
      // this tick. (envelopeFloorDischarge_w is the customer-promised
      // shortfall; if dual capability is even smaller, step (d) will
      // curtail EVs as designed.)
      preferred_w = -Math.min(envelopeFloorDischarge_w, dualDischargeCapW)
    } else if (
      isNegativePrice &&
      avgSOC < SOC_CP_MAX &&
      chargeRoom_w > 0 &&
      dualChargeCapW > 0
    ) {
      // SCENARIO N — Negative price: max charge unconditionally.
      // Cycle cost & RT loss don't matter — grid pays us to consume.
      // Bound by dual-pack chargeable energy (both packs share the load).
      preferred_w = Math.min(CHARGE_RATE_W, chargeRoom_w, dualChargeCapW)
    } else if (
      dam.currentIsCheap &&
      arbitrageProfitable &&
      avgSOC < SOC_CP_MAX &&
      chargeRoom_w > 0 &&
      dualChargeCapW > 0
    ) {
      // SCENARIO B — Cheap now AND a profitable peak exists in the
      // next 24 h. Charge max from grid surplus, capped by physical
      // dual-pack headroom.
      preferred_w = Math.min(CHARGE_RATE_W, chargeRoom_w, dualChargeCapW)
    } else if (
      inTerminalWindow &&
      avgSOC < SOC_CP_MAX &&
      chargeRoom_w > 0 &&
      dualChargeCapW > 0
    ) {
      // SCENARIO T — Terminal SoC anchor.
      // Glide-path fill toward soc_cp_max (90 %) so the simulation
      // closes at the same SoC it started at. Rate sized so we'd
      // exactly hit 90 % at simHour = 24 if conditions stayed
      // constant; in practice cheaper hours within the window get
      // overridden by scenario B (max-rate charge), so this anchor
      // typically only activates during NEUTRAL terminal hours and
      // tops up the residual gap.
      const targetRisePct = SOC_CP_MAX - avgSOC
      const hoursAvail = Math.max(0.5, hoursToEnd)
      const fillRateW =
        ((targetRisePct / 100) * TOTAL_BAT_KWH * 1000) / hoursAvail
      preferred_w = Math.min(
        fillRateW,
        CHARGE_RATE_W,
        chargeRoom_w,
        dualChargeCapW,
      )
    } else if (
      dam.currentIsExpensive &&
      arbitrageProfitable &&
      avgSOC > SOC_RESERVE &&
      dualDischargeCapW > 0
    ) {
      // SCENARIO C — Expensive now AND profitable spread exists.
      // Discharge to displace grid import (no-export bound by load),
      // capped by dual-pack dischargeable energy this tick.
      preferred_w = -Math.min(
        HARD_DISCHARGE_W,
        importIfNoBess_w,
        dualDischargeCapW,
      )
    } else if (
      arbitrageProfitable &&
      dam.hoursToNextCheap <= PREP_WINDOW_H &&
      dam.hoursToNextCheap < dam.hoursToNextExpensive &&
      avgSOC > PREP_DISCHARGE_FLOOR_PCT
    ) {
      // SCENARIO D — Cheap window coming soon. Drain on glide path
      // so we hit PREP_DISCHARGE_FLOOR_PCT when the window opens.
      // Note: TOTAL_BAT_KWH is the nominal pack size, but the actual
      // power draw is bounded by current dual-pack capability (one
      // pack near reserve will limit aggregate output).
      const targetDropPct = avgSOC - PREP_DISCHARGE_FLOOR_PCT
      const hoursAvail = Math.max(1, dam.hoursToNextCheap)
      const drainRateW =
        ((targetDropPct / 100) * TOTAL_BAT_KWH * 1000) / hoursAvail
      preferred_w = -Math.min(
        drainRateW,
        HARD_DISCHARGE_W,
        importIfNoBess_w,
        dualDischargeCapW,
      )
    } else if (
      arbitrageProfitable &&
      dam.hoursToNextExpensive <= PREP_WINDOW_H &&
      avgSOC < PREP_CHARGE_TARGET_PCT &&
      chargeRoom_w > 0 &&
      dualChargeCapW > 0
    ) {
      // SCENARIO E — Expensive window coming soon. Fill on glide
      // path to PREP_CHARGE_TARGET_PCT, bounded by dual-pack
      // chargeable energy.
      const targetRisePct = PREP_CHARGE_TARGET_PCT - avgSOC
      const hoursAvail = Math.max(1, dam.hoursToNextExpensive)
      const fillRateW =
        ((targetRisePct / 100) * TOTAL_BAT_KWH * 1000) / hoursAvail
      preferred_w = Math.min(
        fillRateW,
        CHARGE_RATE_W,
        chargeRoom_w,
        dualChargeCapW,
      )
    } else {
      // SCENARIO F — Spread too narrow or no extreme close. Idle.
      preferred_w = 0
    }

    // Reserve guard — block arbitrage discharge below 25 % SoC.
    if (preferred_w < 0 && avgSOC <= SOC_RESERVE) {
      preferred_w = 0
    }
    P_battery_desired_w = preferred_w
  } else {
    // ─── Auto Mode — direct PDF §1.5 + §2.6 implementation ─────────────
    //
    // Strict translation of the four PDF-documented Auto Mode behaviours
    // into code, with NO safety margins, NO noise, NO arbitrary caps.
    // The only numeric inputs are the spec parameters themselves:
    //   - P_grid_clearance_w (= P_grid_consumption_limit_w, already
    //     net of the 8 kW aux reserve per PDF §1.3 "87 kW total of which
    //     8 kW reserved for auxiliary")
    //   - SOC_CP_MAX            (config.soc_cp_max,    default 90 %)
    //   - SOC_RESERVE           (config.soc_reserve,   default 25 %)
    //   - BAT_MAX_CH_W × 2      (per-pack 110 kW × 2 = 220 kW combined)
    //
    // Decision tree (precedence top → bottom matches the PDF order):
    //
    //   Behaviour 2 — "Battery assisted charging (EV > grid clearance)":
    //      EV demand exceeds the grid clearance → battery supplements
    //      EXACTLY the gap. Bounded at the bottom by SOC_RESERVE per
    //      config.soc_reserve ("SoC reserve that should be kept
    //      available for grid operations, will limit charge power to
    //      EVs"). When SoC ≤ reserve the BESS refuses to supplement,
    //      and the downstream envelope clamp (step d) curtails EV power
    //      to fit P_grid_clearance — which is the spec's intended
    //      behaviour: "limit charge power to EVs".
    //
    //   Behaviour 3 — "Battery charging from grid (EV ≤ clearance)":
    //      Surplus grid power (clearance − EV − aux) is used to charge
    //      the batteries while simultaneously charging the EV, until
    //      SoC reaches soc_cp_max.
    //
    //   Behaviour 5 — "Battery recharge mode (no EV connected)":
    //      Recharge from grid up to soc_cp_max. (Same charge logic as
    //      behaviour 3 with P_EV = 0 — folded into one branch below.)
    //
    //   Behaviour 1 — "Charging an EV (Grid Priority, EV ≤ clearance)":
    //      Implicit: if no charging or discharging is requested by the
    //      branches above, BESS idles at 0 W and the grid supplies the
    //      EV directly. Captured by the trailing `else` returning 0.
    //
    // Behaviour 4 ("Battery discharging to grid / Grid Support Mode")
    // is NOT autonomous in pure Auto Mode — per PDF §2.7 it requires
    // Optimized Mode setpoints. So Auto Mode never exports.
    //
    // Envelope cover uses the SAME `envelopeFloorDischarge_w` computed
    // at line ~849 (shared with Optimized Mode) so both algorithms produce
    // byte-identical discharge when the envelope is breached. No
    // duplicate formula here — single source of truth.
    if (envelopeFloorDischarge_w > 0) {
      // Behaviour 2 — supplement exactly the on-site-load-over-clearance
      // gap. Includes aux (via importIfNoBess_w) so envelope is honoured
      // precisely. Bounded by the dual-pack dischargeable capability so
      // an asymmetric SoC (one pack near reserve) is recognised here
      // rather than discovered downstream in step (e). When the
      // request exceeds dual capability, step (d) will curtail EVs —
      // exactly as the spec calls for ("limit charge power to EVs").
      preferred_w = -Math.min(envelopeFloorDischarge_w, dualDischargeCapW)
    } else if (avgSOC < SOC_CP_MAX && dualChargeCapW > 0) {
      // Behaviours 3 + 5 — recharge from grid surplus toward soc_cp_max.
      // Bounded by dual-pack chargeable headroom so we don't over-
      // request when one pack is already at 90 %.
      const headroom_w =
        P_grid_consumption_limit_w - P_EV_total - P_aux_w
      preferred_w = Math.max(
        0,
        Math.min(2 * BAT_MAX_CH_W, headroom_w, dualChargeCapW),
      )
    } else {
      // Behaviour 1 — idle, grid serves EV directly.
      preferred_w = 0
    }
    // No closing Math.min with envelopeCeiling: Auto Mode's preferred_w
    // already encodes the envelope cover via Behaviour 2 above. The
    // hardware floor at step (c) is the only real backstop, identical
    // to Manual's path.
    P_battery_desired_w = preferred_w
  }

  // ---- Terminal rebalance ramp: DISABLED ───────────────────────���────
  //
  // Earlier revisions force-overrode each algorithm during the last
  // 6 hours of the day to drag SoC toward TERMINAL_SOC_PCT, so
  // cumulative-cost and net-imported-kWh comparisons would land at
  // identical end-state SoC. That made the comparison rigorous but
  // also masked each algorithm's natural end-of-day behaviour: the
  // optimizer in particular wants to land at LOW SoC after the
  // evening peak (because it just discharged into the high-price
  // hours), and the rebalance was overriding that genuine result
  // with a forced overnight charge.
  //
  // Per the user's instruction to "forget about rebalance logic and
  // see how optimisation performs versus Auto Mode", the rebalance
  // is now off. Each algorithm runs its full natural trajectory.
  // The cost and import deltas now include any end-of-day SoC carry-
  // over — that's a more honest read of the policy difference, and
  // we can layer a normalised "energy-equivalent" comparison on top
  // later if needed. The TERMINAL_REBALANCE_FROM_HOUR / TERMINAL_
  // SOC_PCT constants are intentionally kept exported so any
  // re-enable is a single-line change.

  // ---- Step (c): clamp battery total to combined hardware AND SOC ----
  const totalBatChargeLimit = 2 * BAT_MAX_CH_W
  const totalBatDischargeLimit = -(2 * BAT_MAX_DIS_W)
  P_battery_desired_w = clamp(
    P_battery_desired_w,
    totalBatDischargeLimit,
    totalBatChargeLimit
  )

  // ── Tick-aware SoC band clamp (applies to BOTH modes) ───────────────
  //
  // Why this exists
  // ---------------
  // The dispatch policies above check `avgSOC < SOC_CP_MAX` / `>
  // SOC_RESERVE` BEFORE running, but each tick advances 10 simulated
  // minutes (dt_s = 600 s, see line ~619). A single 10-minute tick of
  // e.g. 60 kW charging on a 2 × 225 kWh pack lifts SoC by
  //    (60 kW × 10 min) / (450 kWh) × 100 % = 2.2 %
  // so a policy that fires at SoC = 89 % would land at 91.2 % — visibly
  // overshooting the 90 % `soc_cp_max` ceiling defined in the
  // ChargePost spec. Same artefact symmetrically below `soc_reserve`.
  //
  // The fix: cap the requested charge power so that one tick lands
  // EXACTLY at SOC_CP_MAX, and cap the requested discharge magnitude
  // so that one tick lands exactly at SOC_RESERVE. Below this band the
  // hardware floor at 18 % avgSoC (and the per-unit 5–98 % clamp at
  // step (e)) still applies as a last-resort safety net for the BESS
  // BMS itself, separate from the policy band.
  //
  // This is a pure simulation-fidelity fix — the real ChargePost
  // controller runs at ~1 s cadence so it never sees this overshoot;
  // we replicate that behaviour at our 10-minute step by computing the
  // exact-fit power.
  const TOTAL_KWH = 2 * BAT_NOMINAL_KWH
  const bandTickHours = dt_s / 3600
  if (P_battery_desired_w > 0) {
    const room_pct = Math.max(0, SOC_CP_MAX - avgSOC)
    const maxCharge_w = (room_pct / 100) * TOTAL_KWH * 1000 / bandTickHours
    if (P_battery_desired_w > maxCharge_w) P_battery_desired_w = maxCharge_w
  } else if (P_battery_desired_w < 0) {
    const room_pct = Math.max(0, avgSOC - SOC_RESERVE)
    const maxDischarge_w = (room_pct / 100) * TOTAL_KWH * 1000 / bandTickHours
    if (-P_battery_desired_w > maxDischarge_w) P_battery_desired_w = -maxDischarge_w
  }

  // Hardware safety floor / ceiling (BMS protection, not policy):
  // pack avgSoC must stay within 18–96 % regardless of policy. This
  // catches the edge case where an EV-shortfall discharge (Behaviour 2)
  // is allowed below the policy reserve because envelope-cover takes
  // precedence over arbitrage — once the hardware band is hit, even
  // envelope-cover stops to protect the cells.
  if (P_battery_desired_w > 0 && avgSOC >= 96) P_battery_desired_w = 0
  if (P_battery_desired_w < 0 && avgSOC <= 18) P_battery_desired_w = 0

  // ---- Step (c.5): NO-EXPORT hard constraint ---------------------------
  // The site has no off-take / wholesale-sell contract, so feeding power
  // back to the grid is forbidden. The BESS may only offset on-site load
  // (EVs + aux); any discharge beyond that would push P_grid below zero.
  //
  // Conservation is `P_grid = P_battery + P_EV + P_aux`, so enforcing
  // P_grid >= 0 means `P_battery >= -(P_EV + P_aux)`. We cap the desired
  // discharge magnitude here, BEFORE the per-unit split, so all
  // downstream steps (per-unit clamp, envelope check, integration) see
  // an export-feasible setpoint. The per-unit clamp can only reduce
  // discharge magnitude further (saturated unit pushes residual onto
  // the other), so this floor remains satisfied at the end of step (e).
  const exportFloor = -(P_EV_total + P_aux_w)
  if (P_battery_desired_w < exportFloor) {
    P_battery_desired_w = exportFloor
  }

  let P_battery_total = Math.round(P_battery_desired_w)

  // ---- Step (d): if grid envelope infeasible, throttle in priority order ----
  //   feasible band:
  //     0 <= P_battery_total + P_EV_total + P_aux <= +P_cons_limit
  //   (lower bound is 0, not -P_gen_limit, because step c.5 already
  //    enforced no-export.)
  //
  // Priority of curtailment when the upper bound is breached:
  //   (1) FIRST throttle BESS *charging* down toward 0 — the BESS is a
  //       discretionary load, so giving up some BESS charge to keep the
  //       envelope feasible costs only a tiny bit of arbitrage upside.
  //   (2) ONLY IF the BESS is already at zero or discharging and the
  //       envelope is STILL breached do we curtail EV charging.
  //
  // This priority is critical for fair comparison: without it, an
  // aggressive optimizer that wants to charge the BESS hard during a
  // cheap-price window would push P_grid above the envelope and the
  // code would curtail EVs to compensate — meaning the OPTIMIZER would
  // deliver less EV energy than the BMS over the day, breaking the
  // equal-EV-delivered invariant we need for a fair € comparison.
  // Now BESS charging always yields to EV demand, so EV delivered is
  // identical across scenarios and the only thing that changes between
  // optimizer and BMS is HOW the same imported energy is timed.
  let curtailmentW = 0 // total kW shaved off EV power across (d) + (f)
  let importDemand = P_battery_total + P_EV_total + P_aux_w
  if (importDemand > P_grid_consumption_limit_w) {
    const overdraw = importDemand - P_grid_consumption_limit_w
    // (1) Throttle BESS charging first.
    if (P_battery_total > 0) {
      const reduce = Math.min(P_battery_total, overdraw)
      P_battery_total -= reduce
      importDemand -= reduce
    }
    // (2) Only if envelope is still breached, curtail EVs as last resort.
    if (importDemand > P_grid_consumption_limit_w && P_EV_total > 0) {
      const remainingOverdraw = importDemand - P_grid_consumption_limit_w
      const new_total = Math.max(0, P_EV_total - remainingOverdraw)
      const ratio = new_total / P_EV_total
      curtailmentW += P_EV_total - new_total
      P_EV_1 = Math.round(P_EV_1 * ratio)
      P_EV_2 = Math.round(P_EV_2 * ratio)
      P_EV_total = P_EV_1 + P_EV_2
    }
  }

  // ---- Step (e): per-unit split with SoC-AWARE balancing ----
  //
  // Earlier revision used a fixed `0.51 + noise(0.015)` bias toward
  // unit 1, regardless of either pack's SoC. That caused two issues:
  //
  //   (a) On long sessions the same unit consistently ran hotter and
  //       drifted to a different SoC than its sibling, so by mid-day
  //       the packs were e.g. 78 % / 84 % when they should be balanced.
  //
  //   (b) When the dispatcher requested a charge while unit 1 was
  //       already at 90 %, the bias still sent 51 % of the request to
  //       unit 1, which was then clamped to 0 in the per-unit clamp
  //       and pushed onto unit 2 as residual — extra rounding noise
  //       and unbalanced energy throughput between the packs.
  //
  // New split logic:
  //   - On CHARGE: send more power to the pack with LOWER SoC (it has
  //     more room and using it more brings the packs together).
  //   - On DISCHARGE: send more power to the pack with HIGHER SoC
  //     (likewise drives them together).
  //   - Magnitude of the bias is proportional to |delta_SoC|, capped at
  //     ±0.20 around the 0.50 midpoint to avoid one pack ever doing
  //     the entire job alone (saves cycle-life on whichever pack would
  //     otherwise be over-used).
  //   - Tiny noise term retained (0.005) so the per-unit telemetry
  //     doesn't look unrealistically synchronised.
  const socDelta = prev.soc1 - prev.soc2 // positive = unit1 fuller
  // bias > 0.5 → more to unit1, bias < 0.5 → more to unit2
  // For charge (P > 0) we WANT lower-SoC pack to take more, so bias
  // should be < 0.5 when soc1 > soc2.
  // For discharge (P < 0) we WANT higher-SoC pack to give more, so
  // bias > 0.5 when soc1 > soc2 — which means MORE NEGATIVE goes to
  // unit1, achieved by the SAME bias > 0.5 since P_b1 = P_total * bias.
  const k = 0.02 // 2 % bias per 1 % SoC delta (10 %∆ → 0.20 cap)
  let splitBias: number
  if (P_battery_total > 0) {
    // Charging: lower-SoC pack gets more
    splitBias = clamp(0.5 - socDelta * k, 0.30, 0.70) + noise(0.005)
  } else if (P_battery_total < 0) {
    // Discharging: higher-SoC pack gives more (same direction since
    // P_b1 = P_total * bias and P_total is negative)
    splitBias = clamp(0.5 + socDelta * k, 0.30, 0.70) + noise(0.005)
  } else {
    splitBias = 0.5
  }
  let P_b1 = Math.round(P_battery_total * splitBias)
  let P_b2 = P_battery_total - P_b1

  // Per-unit limits depend on direction AND SOC of *that* unit:
  //   max charge: 0 if SOC > 98 %, full otherwise
  //   max discharge: 0 if SOC < 15 %, full otherwise
  const unitLimits = (soc: number) => ({
    chMax: soc >= 98 ? 0 : BAT_MAX_CH_W,
    disMax: soc <= 15 ? 0 : BAT_MAX_DIS_W,
  })
  const lim1 = unitLimits(prev.soc1)
  const lim2 = unitLimits(prev.soc2)
  const clampUnit = (p: number, l: { chMax: number; disMax: number }) =>
    clamp(p, -l.disMax, l.chMax)

  // Push residual from saturated unit onto the other one
  const P_b1_c = clampUnit(P_b1, lim1)
  const residual1 = P_b1 - P_b1_c
  P_b1 = P_b1_c
  P_b2 = clampUnit(P_b2 + residual1, lim2)
  // Any residual that *still* couldn't be placed (both saturated) is
  // simply lost from P_battery_total -- the controller can't do more.
  P_battery_total = P_b1 + P_b2

  // ---- Step (f): re-check envelope after the saturation residual ----
  //   Same priority as step (d): if the envelope is still breached after
  //   per-unit clamping, give up BESS charging FIRST and only curtail EVs
  //   as a last resort. We can't reduce P_b1/P_b2 directly here because
  //   they've already been clamped to per-unit limits, but if P_battery_total
  //   ended up positive we can shave it down — the per-unit clamps allow
  //   any value below their charge-max, so reducing both proportionally
  //   is always feasible.
  let importDemand2 = P_battery_total + P_EV_total + P_aux_w
  if (importDemand2 > P_grid_consumption_limit_w) {
    const overdraw = importDemand2 - P_grid_consumption_limit_w
    if (P_battery_total > 0) {
      const reduce = Math.min(P_battery_total, overdraw)
      const ratio = (P_battery_total - reduce) / P_battery_total
      P_b1 = Math.round(P_b1 * ratio)
      P_b2 = Math.round(P_b2 * ratio)
      P_battery_total = P_b1 + P_b2
      importDemand2 = P_battery_total + P_EV_total + P_aux_w
    }
    if (importDemand2 > P_grid_consumption_limit_w && P_EV_total > 0) {
      const remainingOverdraw = importDemand2 - P_grid_consumption_limit_w
      const new_total = Math.max(0, P_EV_total - remainingOverdraw)
      const ratio = new_total / P_EV_total
      curtailmentW += P_EV_total - new_total
      P_EV_1 = Math.round(P_EV_1 * ratio)
      P_EV_2 = Math.round(P_EV_2 * ratio)
      P_EV_total = P_EV_1 + P_EV_2
    }
  }

  // ---- Step (g): derive P_grid by conservation, exact. ----
  const P_grid_w = P_battery_total + P_EV_total + P_aux_w

  // ---- Integrate SOC and energy counters from the FINAL flows ----
  const dsoc_b = (p_w: number) =>
    (p_w / 1000) * (dt_s / 3600) * (100 / BAT_NOMINAL_KWH)
  const soc1 = clamp(prev.soc1 + dsoc_b(P_b1), 5, 98)
  const soc2 = clamp(prev.soc2 + dsoc_b(P_b2), 5, 98)

  // EV SOC: tied to delivered power on a notional 80 kWh EV pack
  // dSOC% = (kW delivered) * (dt h) * (100 / 80 kWh)
  const dsoc_ev = (p_w: number) => (p_w / 1000) * (dt_s / 3600) * (100 / 80)
  const soc_ev1 = ev1Plugged
    ? clamp(prev.soc_ev1 + dsoc_ev(P_EV_1), 0, 100)
    : 0
  const soc_ev2 = ev2Plugged
    ? clamp(prev.soc_ev2 + dsoc_ev(P_EV_2), 0, 100)
    : 0

  // Lifetime / session energy counters (kWh = W * s / 3.6e6)
  const wsToKwh = (w: number) => (w * dt_s) / 3_600_000
  const e_chg1_kwh = prev.e_chg1_kwh + wsToKwh(P_EV_1)
  const e_chg2_kwh = prev.e_chg2_kwh + wsToKwh(P_EV_2)
  const e_imp_kwh = prev.e_imp_kwh + wsToKwh(Math.max(0, P_grid_w))
  const e_exp_kwh = prev.e_exp_kwh + wsToKwh(Math.max(0, -P_grid_w))
  const e_aux_kwh = prev.e_aux_kwh + wsToKwh(P_aux_w)
  const e_b1_in_kwh = prev.e_b1_in_kwh + wsToKwh(Math.max(0, P_b1))
  const e_b1_out_kwh = prev.e_b1_out_kwh + wsToKwh(Math.max(0, -P_b1))
  const e_b2_in_kwh = prev.e_b2_in_kwh + wsToKwh(Math.max(0, P_b2))
  const e_b2_out_kwh = prev.e_b2_out_kwh + wsToKwh(Math.max(0, -P_b2))

  // ---- Market (real EPEX in day_sim, slowly drifting sinusoid in realtime) ----
  // `epex` = DAM (day-ahead) price for this clock-hour. Drives the
  // chart cursor + the optimizer's lookahead (separately computed in
  // dispatch). For day-sim we ALSO sample IDM (intraday ID3) so that
  // realised procurement cost reflects the IDM-indexed supply
  // contract — see cost tracking below.
  const epex = isDaySim
    ? getEpexMay1Price(simHourToClock(simHour))
    : 85 + Math.sin(t_s / 600) * 25 + noise(2)
  const idmPrice = isDaySim
    ? getIdmMay1Price(simHourToClock(simHour))
    : epex // realtime mode has no DAM/IDM split — fall back to same curve

  // ---- Thermal: 1st-order lag toward load-driven setpoint, tau ~ 5 min ----
  //   T_target_i = ambient_i + |P_b_i| / max  *  6  (deg C)
  //   T += alpha * (T_target - T)   where alpha = clamp(dt/tau, 0, 1)
  //
  // We CANNOT use the naive forward-Euler form `T += (T_target - T) * dt/tau`
  // because in day_sim mode the simulator can advance many sim-minutes per
  // real second (speed 60x ⇒ ~600 s/tick) and scrub jumps can produce even
  // larger dt_s. Once `dt_s / tau_s > 2` the discrete update oscillates and
  // amplifies on every tick, exploding to ~1e29 °C within a handful of
  // frames. Clamping the lag coefficient to [0, 1] makes the scheme
  // unconditionally stable: any single tick can at most reach the target,
  // never overshoot it. The exponential-decay form below is the correct
  // analytical solution of the underlying ODE for a piecewise-constant
  // target over the interval and is exact at every dt_s ≥ 0.
  const tau_s = 300
  const alpha = 1 - Math.exp(-Math.max(0, dt_s) / tau_s)
  const setpoint = (p_w: number, ambient: number) =>
    ambient + (Math.abs(p_w) / BAT_MAX_CH_W) * 6
  const t1_target = setpoint(P_b1, 27.0)
  const t2_target = setpoint(P_b2, 26.5)
  const temp1_c = prev.temp1_c + alpha * (t1_target - prev.temp1_c)
  const temp2_c = prev.temp2_c + alpha * (t2_target - prev.temp2_c)

  // ---- Build frame ----
  // temp_min/max are derived from the lagged centre temperature with a
  // small load-correlated spread (hot cells hotter under load).
  const tempSpread = (p_w: number) =>
    1.0 + (Math.abs(p_w) / BAT_MAX_CH_W) * 1.4
  const sp1 = tempSpread(P_b1)
  const sp2 = tempSpread(P_b2)

  const batteries: [BatteryUnit, BatteryUnit] = [
    {
      unit_id: 1,
      soc_pct: Math.round(soc1 * 10) / 10,
      power_w: P_b1,
      temp_min_c: Math.round((temp1_c - sp1 / 2 + noise(0.15)) * 10) / 10,
      temp_max_c: Math.round((temp1_c + sp1 / 2 + noise(0.15)) * 10) / 10,
      max_charge_w: BAT_MAX_CH_W,
      max_discharge_w: BAT_MAX_DIS_W,
      contactor_state: "closed",
      soh_pct: 99.2,
      E_charged_kwh: Math.round(e_b1_in_kwh * 100) / 100,
      E_discharged_kwh: Math.round(e_b1_out_kwh * 100) / 100,
    },
    {
      unit_id: 2,
      soc_pct: Math.round(soc2 * 10) / 10,
      power_w: P_b2,
      temp_min_c: Math.round((temp2_c - sp2 / 2 + noise(0.15)) * 10) / 10,
      temp_max_c: Math.round((temp2_c + sp2 / 2 + noise(0.15)) * 10) / 10,
      max_charge_w: BAT_MAX_CH_W,
      max_discharge_w: BAT_MAX_DIS_W,
      contactor_state: "closed",
      soh_pct: 99.0,
      E_charged_kwh: Math.round(e_b2_in_kwh * 100) / 100,
      E_discharged_kwh: Math.round(e_b2_out_kwh * 100) / 100,
    },
  ]

  const chargers: [ChargerUnit, ChargerUnit] = [
    {
      unit_id: 1,
      plug_state: ev1Plugged ? "Plugged" : "Unplugged",
      charging_state: ev1Charging
        ? "InProgress"
        : ev1Plugged
        ? "Finishing"
        : "Idle",
      charging_process_state: ev1Charging
        ? "Charging"
        : ev1Plugged
        ? "Completed"
        : "Idle",
      P_EV_w: P_EV_1,
      P_EV_max_w: P_EV_MAX_W,
      P_cp_max_w: P_CP_MAX_W,
      soc_EV_pct: Math.round(soc_ev1 * 10) / 10,
      E_EV_chg_kwh: Math.round(e_chg1_kwh * 100) / 100,
      boost_contactor: ev1Charging ? "closed" : "open",
    },
    {
      unit_id: 2,
      plug_state: ev2Plugged ? "Plugged" : "Unplugged",
      charging_state: ev2Charging
        ? "InProgress"
        : ev2Plugged
        ? "Finishing"
        : "Idle",
      charging_process_state: ev2Charging
        ? "Charging"
        : ev2Plugged
        ? "Completed"
        : "Idle",
      P_EV_w: P_EV_2,
      P_EV_max_w: P_EV_MAX_W,
      P_cp_max_w: P_CP_MAX_W,
      soc_EV_pct: Math.round(soc_ev2 * 10) / 10,
      E_EV_chg_kwh: Math.round(e_chg2_kwh * 100) / 100,
      boost_contactor: ev2Charging ? "closed" : "open",
    },
  ]

  const grid: GridState = {
    P_grid_w,
    P_aux_w,
    E_grid_imp_kwh: Math.round(e_imp_kwh * 100) / 100,
    E_grid_exp_kwh: Math.round(e_exp_kwh * 100) / 100,
    E_aux_kwh: Math.round(e_aux_kwh * 100) / 100,
    f_grid_hz: Math.round((50 + noise(0.04)) * 100) / 100,
    cos_phi: Math.round((0.97 + noise(0.012)) * 1000) / 1000,
  }

  // ---- Events: only emit on transitions / threshold crossings ----
  const new_events: TelemetryEvent[] = []
  let lastEventId = prev.lastEventId

  // Grid clearance approach (>92% of envelope)
  if (P_grid_w > P_grid_consumption_limit_w * 0.92 && Math.random() < 0.02) {
    new_events.push({
      id: ++lastEventId,
      ts,
      severity: "warning",
      source: "grid",
      code: "GRID_NEAR_LIMIT",
      message: `Grid import ${(P_grid_w / 1000).toFixed(0)} kW within 8% of consumption envelope`,
      acknowledged: false,
    })
  }

  // SOC low warning
  for (const b of batteries) {
    if (b.soc_pct < 12 && Math.random() < 0.05) {
      new_events.push({
        id: ++lastEventId,
        ts,
        severity: "warning",
        source: b.unit_id === 1 ? "battery_1" : "battery_2",
        code: "BATTERY_SOC_LOW",
        message: `Battery ${b.unit_id} SOC ${b.soc_pct.toFixed(1)}% below low-threshold (15%)`,
        acknowledged: false,
      })
    }
  }

  // EV curtailment: emit when the controller had to shave > 5 kW off the
  // requested EV power to keep the import envelope feasible.
  if (curtailmentW > 5_000 && Math.random() < 0.04) {
    new_events.push({
      id: ++lastEventId,
      ts,
      severity: "warning",
      source: "station",
      code: "EV_CURTAILED",
      message: `EV power curtailed by ${(curtailmentW / 1000).toFixed(0)} kW to honour grid envelope`,
      acknowledged: false,
    })
  }

  const events = [...prev.events, ...new_events].slice(-200)
  const warnings = events.filter((e) => e.severity === "warning" && !e.acknowledged)
  const errors = events.filter((e) => e.severity === "error" && !e.acknowledged)

  const station: StationState = {
    operation_state: "Ready",
    P_grid_consumption_limit_w,
    P_grid_generation_limit_w,
    warnings,
    errors,
  }

  const market: MarketState = {
    epex_price_eur_mwh: Math.round(epex * 100) / 100,
    slot_label: slotLabelFor(new Date(prev.startedAt + t_s * 1000)),
  }

  const frame: TelemetryFrame = {
    ts,
    t_s,
    grid,
    batteries,
    chargers,
    station,
    market,
    new_events,
    P_EV_demand_w,
  }

  // --- Cost tracking for uplift calculation ---
  // Each tick we compute TWO procurement costs for the same physical
  // dispatch:
  //
  //   1. IDM-indexed (`tickCostIdmEur`) — what the customer ACTUALLY
  //      pays under their IDM-indexed supply contract. Becomes the
  //      primary `totalCostEur` field downstream.
  //
  //   2. DAM-indexed counterfactual (`tickCostDamEur`) — what they
  //      WOULD have paid if their contract were DAM-indexed.
  //      Accumulated into `totalCostDamRefEur` so the UI can show
  //      the IDM uplift = totalCostEur − totalCostDamRefEur.
  //
  // Imports cost positive at the contract reference price; exports
  // (when the site can sell back) credit at the same reference price.
  const tickHours = dt_s / 3600
  const gridImportKwh = Math.max(0, P_grid_w) / 1000 * tickHours
  const gridExportKwh = Math.max(0, -P_grid_w) / 1000 * tickHours
  const netKwh = gridImportKwh - gridExportKwh
  const tickCostIdmEur = (netKwh * idmPrice) / 1000 // EUR/MWh -> EUR/kWh
  const tickCostDamEur = (netKwh * epex) / 1000
  const evDeliveredKwh = (P_EV_1 + P_EV_2) / 1000 * tickHours

  const costOptimized: CostAccumulator = {
    gridImportKwh: prev.costOptimized.gridImportKwh + gridImportKwh,
    gridExportKwh: prev.costOptimized.gridExportKwh + gridExportKwh,
    totalCostEur: prev.costOptimized.totalCostEur + tickCostIdmEur,
    totalCostDamRefEur:
      prev.costOptimized.totalCostDamRefEur + tickCostDamEur,
    evDeliveredKwh: prev.costOptimized.evDeliveredKwh + evDeliveredKwh,
  }

  // Baseline cost: embedded BMS behavior (no price arbitrage).
  // In embedded mode, BESS just tries to keep SOC at 70% and serve EVs
  // — no smart charging/discharging based on price. Same dual IDM/DAM
  // tracking so the comparison is apples-to-apples.
  const baselineGridImport = Math.max(0, P_EV_total + P_aux_w) / 1000 * tickHours
  const baselineCostIdmEur = (baselineGridImport * idmPrice) / 1000
  const baselineCostDamEur = (baselineGridImport * epex) / 1000
  const costBaseline: CostAccumulator = {
    gridImportKwh: prev.costBaseline.gridImportKwh + baselineGridImport,
    gridExportKwh: prev.costBaseline.gridExportKwh, // BMS doesn't export
    totalCostEur: prev.costBaseline.totalCostEur + baselineCostIdmEur,
    totalCostDamRefEur:
      prev.costBaseline.totalCostDamRefEur + baselineCostDamEur,
    evDeliveredKwh: prev.costBaseline.evDeliveredKwh + evDeliveredKwh,
  }

  const sim: SimState = {
    ...prev,
    t_s,
    lastEventId,
    soc1,
    soc2,
    soc_ev1,
    soc_ev2,
    e_imp_kwh,
    e_exp_kwh,
    e_aux_kwh,
    e_chg1_kwh,
    e_chg2_kwh,
    e_b1_in_kwh,
    e_b1_out_kwh,
    e_b2_in_kwh,
    e_b2_out_kwh,
    temp1_c,
    temp2_c,
    events,
    // Day simulation state
    simHour,
    activeSessions,
    costOptimized,
    costBaseline,
  }

  return { sim, frame }
}

function slotLabelFor(d: Date): string {
  const h = d.getHours().toString().padStart(2, "0")
  const m = (Math.floor(d.getMinutes() / 15) * 15).toString().padStart(2, "0")
  return `${h}:${m}`
}

// -------------------- Hook --------------------

export interface UsePrototypeTelemetryOptions {
  intervalMs?: number
  scenario?: Scenario
  /** how many frames to retain in memory for time-series / inspectors */
  historySize?: number
  /** Initial simulation mode */
  simMode?: SimulationMode
  /** Initial control mode */
  controlMode?: ControlMode
}

export interface UsePrototypeTelemetryResult {
  frame: TelemetryFrame | null
  history: TelemetryFrame[]
  /** all events emitted during this simulation run (acknowledged + open) */
  allEvents: TelemetryEvent[]
  /** mark an event as acknowledged so it leaves the active warnings/errors lists */
  ackEvent: (id: number) => void
  /** mark all currently open events as acknowledged */
  ackAll: () => void
  isPaused: boolean
  togglePause: () => void
  reset: () => void
  scenario: Scenario
  setScenario: (s: Scenario) => void
  /** Simulation seconds advanced per real-time tick. Default 1 (real-time). */
  speed: number
  /** Update the speed multiplier (e.g. 1, 5, 30, 60). */
  setSpeed: (n: number) => void
  // --- Day simulation controls ---
  /** Current simulation mode */
  simMode: SimulationMode
  /** Switch between realtime and day simulation */
  setSimMode: (m: SimulationMode) => void
  /** Current control mode (embedded BMS vs optimized) */
  controlMode: ControlMode
  /** Switch control strategy */
  setControlMode: (m: ControlMode) => void
  /** Current simulated hour (0-24) in day_sim mode */
  simHour: number
  /** Cost accumulator for optimized mode */
  costOptimized: CostAccumulator
  /** Cost accumulator for baseline (embedded BMS) mode */
  costBaseline: CostAccumulator
  /** Calculated uplift (baseline cost - optimized cost) */
  upliftEur: number
  /** Scheduled sessions for the day */
  sessions: readonly ScheduledSession[]
  /**
   * Telemetry frames produced by the **optimizer** simulation. Always
   * populated (even when controlMode is "embedded_bms") so day-sim charts
   * can render both lines for comparison.
   */
  historyOptimized: TelemetryFrame[]
  /**
   * Telemetry frames produced by the **embedded BMS** baseline simulation.
   * Always populated.
   */
  historyBaseline: TelemetryFrame[]
  /**
   * Cumulative cost samples — one entry per tick — for the cost-flow chart.
   * Both `optEur` and `baseEur` advance independently so they can be
   * plotted as two lines diverging over the simulated day.
   */
  costHistory: CostHistoryPoint[]
  // ─── Scrub / rewind controls ────────────────────────────────��───────
  /**
   * Latest simulated hour the day-sim has ACTUALLY reached on the tick
   * thread. While scrubbing this stays put (or keeps advancing if user
   * un-pauses) and acts as the upper bound on how far back the user
   * can rewind. Equal to the public `simHour` whenever scrubHour is null.
   */
  liveSimHour: number
  /**
   * When non-null the UI is "rewound" to this hour: the public `simHour`
   * and `frame` reflect the snapshot at this point in the already-
   * simulated history rather than the latest tick. Setting this also
   * pauses the simulation; clearing it (passing null) leaves the
   * paused/playing state alone so the user can press Play to resume.
   *
   * Scrubbing is a VISUAL PEEK — the underlying simulation refs are not
   * rewound. Pressing Play resumes from `liveSimHour`, not scrubHour.
   */
  scrubHour: number | null
  /** True iff scrubHour !== null (UI convenience). */
  isScrubbing: boolean
  /**
   * Move the scrub cursor to a specific elapsed-since-DAY_START hour
   * (0..liveSimHour). Pass null to exit scrub mode and resume showing
   * the live tick. Calling with a value automatically pauses the sim.
   */
  scrubToHour: (h: number | null) => void
}

export interface CostHistoryPoint {
  /** Simulated hour-of-day (0..24); 0 in realtime mode. */
  hour: number
  /** Optimizer cumulative cost in EUR (negative = revenue). */
  optEur: number
  /** Embedded-BMS cumulative cost in EUR. */
  baseEur: number
}

/**
 * Anchor for elapsed-time math used by findFrameNearestHour. All
 * day_sim frame timestamps are rendered as `anchor + simHour * 1h`,
 * so subtracting `anchor` recovers elapsed hours since the day window
 * opened. Mirrors the DAY_ANCHOR_MS constant used in the screen.
 */
const FRAME_ANCHOR_MS = Date.UTC(2024, 4, 1, DAY_START_HOUR)

/**
 * Linear scan to find the frame in `history` whose timestamp is
 * closest to the given elapsed-since-DAY_START hour. Used by the
 * scrub-cursor lookup so consumers of `frame` see the snapshot at
 * the requested moment.
 *
 * Linear scan is fine: history is at most ~150 frames for a 24 h day
 * and the scrub callback fires only on user drag (a few times per
 * second at most), not on every render.
 */
function findFrameNearestHour(
  history: TelemetryFrame[],
  targetHour: number,
): TelemetryFrame | null {
  if (history.length === 0) return null
  let best = history[0]
  let bestDelta = Infinity
  for (const f of history) {
    const fH = (new Date(f.ts).getTime() - FRAME_ANCHOR_MS) / 3_600_000
    const d = Math.abs(fH - targetHour)
    if (d < bestDelta) {
      bestDelta = d
      best = f
    }
  }
  return best
}

export function usePrototypeTelemetry(
  options: UsePrototypeTelemetryOptions = {}
): UsePrototypeTelemetryResult {
  const {
    intervalMs = 1000,
    scenario: initialScenario = "ev1_charging_ev2_idle",
    historySize = 600, // 10 minutes at 1 Hz
    simMode: initialSimMode = "realtime",
    controlMode: initialControlMode = "optimized",
  } = options

  const [scenario, setScenarioState] = useState<Scenario>(initialScenario)
  const [simMode, setSimModeState] = useState<SimulationMode>(initialSimMode)
  const [controlMode, setControlModeState] = useState<ControlMode>(initialControlMode)
  const [isPaused, setIsPaused] = useState(false)
  // Default to 2x so the day-sim plays through twice as fast out of the
  // box — at 1x, 1 real second = 10 simulated minutes (so the full 24-hour
  // window takes 144 real seconds); at 2x it completes in ~72 seconds,
  // which is more demo-friendly without the user having to nudge the slider.
  const [speed, setSpeedState] = useState<number>(2)
  const [simHour, setSimHour] = useState<number>(0)
  /**
   * Visual-only "rewind cursor". When non-null, the public `simHour`
   * and `frame` are snapped back to a moment in the already-simulated
   * history without touching the simulation refs. Press Play (which
   * also clears scrubHour) to resume from the live tick.
   */
  const [scrubHour, setScrubHourState] = useState<number | null>(null)
  // We always run BOTH simulations in parallel. The user-selected
  // `controlMode` only chooses which one is "primary" for the Snapshot /
  // Commands views. Day-sim charts always overlay both lines so the user
  // can compare optimizer vs. embedded BMS in real time.
  const [historyOptimized, setHistoryOptimized] = useState<TelemetryFrame[]>([])
  const [historyBaseline, setHistoryBaseline] = useState<TelemetryFrame[]>([])
  const [costOptimized, setCostOptimized] = useState<CostAccumulator>(createEmptyCostAccumulator())
  const [costBaseline, setCostBaseline] = useState<CostAccumulator>(createEmptyCostAccumulator())
  const [costHistory, setCostHistory] = useState<CostHistoryPoint[]>([])

  const simOptRef = useRef<SimState>(
    createInitialSim(initialScenario, initialSimMode, "optimized")
  )
  const simBaseRef = useRef<SimState>(
    createInitialSim(initialScenario, initialSimMode, "embedded_bms")
  )
  // Speed is read fresh on every tick so the segmented control switches
  // without having to re-create the setInterval below.
  const speedRef = useRef<number>(1)
  speedRef.current = speed

  const trim = <T,>(arr: T[]): T[] =>
    arr.length > historySize ? arr.slice(arr.length - historySize) : arr

  const tick = useCallback(() => {
    // Freeze the day_sim once the 24-hour window has fully closed. Without
    // this, the per-tick cost integration keeps adding €0 (when at the
    // simHour=24 clamp) plus tiny noise, AND — more importantly — the
    // optimizer/baseline accumulators stay live so any state touched by
    // tickSim's noise/cost paths drifts slowly. Stopping here makes the
    // displayed uplift number perfectly stable after the day completes.
    const dayDone =
      simOptRef.current.simMode === "day_sim" &&
      simOptRef.current.simHour >= 24 - 1e-6 &&
      simBaseRef.current.simHour >= 24 - 1e-6
    if (dayDone) {
      // Final diagnostics: EV delivered comparison + cost breakdown
      const optEV = simOptRef.current.costOptimized.evDeliveredKwh
      const baseEV = simBaseRef.current.costOptimized.evDeliveredKwh
      const optCost = simOptRef.current.costOptimized.totalCostEur
      const baseCost = simBaseRef.current.costOptimized.totalCostEur
      const evDiff = optEV - baseEV
      const costDiff = baseCost - optCost
      
      console.log(
        `[v0] END OF DAY COMPARISON:\n` +
        `  EV Delivered:  Manual=${optEV.toFixed(1)} kWh, Auto=${baseEV.toFixed(1)} kWh, Delta=${evDiff.toFixed(1)} kWh\n` +
        `  Total Cost:    Manual=${optCost.toFixed(2)} EUR, Auto=${baseCost.toFixed(2)} EUR\n` +
        `  Savings:       ${costDiff.toFixed(2)} EUR (${((costDiff/baseCost)*100).toFixed(1)}%)\n` +
        `  EV Match:      ${Math.abs(evDiff) < 0.1 ? 'YES' : 'NO - INVESTIGATE!'}`
      )
      return
    }

    const opt = tickSim(simOptRef.current, speedRef.current)
    const base = tickSim(simBaseRef.current, speedRef.current)
    simOptRef.current = opt.sim
    simBaseRef.current = base.sim

    setHistoryOptimized((h) => trim([...h, opt.frame]))
    setHistoryBaseline((h) => trim([...h, base.frame]))
    setSimHour(opt.sim.simHour)
    setCostOptimized(opt.sim.costOptimized)
    setCostBaseline(base.sim.costOptimized)
    setCostHistory((h) =>
      trim([
        ...h,
        {
          hour: opt.sim.simHour,
          optEur: opt.sim.costOptimized.totalCostEur,
          baseEur: base.sim.costOptimized.totalCostEur,
        },
      ])
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historySize])

  /** Hard reset of both sims + all derived history. */
  const fullReset = useCallback(() => {
    simOptRef.current = createInitialSim(scenario, simMode, "optimized")
    simBaseRef.current = createInitialSim(scenario, simMode, "embedded_bms")
    setHistoryOptimized([])
    setHistoryBaseline([])
    setCostHistory([])
    setSimHour(0)
    // emit one bootstrap frame immediately so UI isn't empty on first paint.
    const opt = tickSim(simOptRef.current, 1)
    const base = tickSim(simBaseRef.current, 1)
    simOptRef.current = opt.sim
    simBaseRef.current = base.sim
    setHistoryOptimized([opt.frame])
    setHistoryBaseline([base.frame])
    setCostOptimized(opt.sim.costOptimized)
    setCostBaseline(base.sim.costOptimized)
    setSimHour(opt.sim.simHour)
    setCostHistory([
      {
        hour: opt.sim.simHour,
        optEur: opt.sim.costOptimized.totalCostEur,
        baseEur: base.sim.costOptimized.totalCostEur,
      },
    ])
  }, [scenario, simMode])

  // first frame on mount + scenario/sim-mode change.
  // (controlMode is intentionally NOT in the dep list — toggling it just
  //  swaps the "primary" view; both sims keep running uninterrupted.)
  useEffect(() => {
    fullReset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, simMode])

  // ticker
  useEffect(() => {
    if (isPaused) return
    const id = window.setInterval(tick, intervalMs)
    return () => window.clearInterval(id)
  }, [tick, intervalMs, isPaused])

  // Toggling pause from the UI ALSO exits scrub mode. The "Play" button
  // therefore acts as both "resume ticks" and "return to live cursor"
  // in one click — which matches typical timeline-scrubber UX (DAW,
  // video player, etc.).
  const togglePause = useCallback(() => {
    setScrubHourState(null)
    setIsPaused((p) => !p)
  }, [])

  // Reset clears the scrub cursor too so the user starts fresh at t=0.
  const reset = useCallback(() => {
    setScrubHourState(null)
    fullReset()
  }, [fullReset])

  // Setting a scrub target auto-pauses the sim so the user inspecting a
  // moment isn't fighting against the live cursor. Passing null exits
  // scrub mode but does NOT auto-resume — the user can press Play (which
  // also clears scrubHour as a no-op) when they're ready.
  const scrubToHour = useCallback(
    (h: number | null) => {
      if (h !== null) {
        const clamped = Math.max(0, Math.min(simHour, h))
        setScrubHourState(clamped)
        setIsPaused(true)
      } else {
        setScrubHourState(null)
      }
    },
    [simHour]
  )

  // Primary frame/history derive from the active control mode so toggling
  // the selector instantly swaps Snapshot/Commands views without resetting
  // the underlying sim state.
  const history =
    controlMode === "optimized" ? historyOptimized : historyBaseline

  /**
   * Frame surfaced to consumers. When the user is scrubbing we look up
   * the frame in `history` whose timestamp is closest to scrubHour;
   * otherwise we hand back the latest tick. Charts always render the
   * full `history` array regardless, so the "Now" cursor moves but the
   * trailing curves stay continuous.
   */
  const frame: TelemetryFrame | null =
    scrubHour !== null
      ? findFrameNearestHour(history, scrubHour)
      : history.at(-1) ?? null

  /**
   * Public simHour: the scrubbed value when scrubbing, otherwise the
   * live tick. Every chart's "Now" cursor consumes this, so substituting
   * the scrubbed value moves all cursors in lockstep.
   */
  const displayedSimHour = scrubHour !== null ? scrubHour : simHour

  const setScenario = useCallback((s: Scenario) => {
    setScenarioState(s)
  }, [])

  const setSpeed = useCallback((n: number) => {
    setSpeedState(Math.max(1, Math.round(n)))
  }, [])

  const setSimMode = useCallback((m: SimulationMode) => {
    setSimModeState(m)
  }, [])

  const setControlMode = useCallback((m: ControlMode) => {
    setControlModeState(m)
  }, [])

  /**
   * Patch the *primary* sim's events (the one matching the current
   * controlMode) and republish its last frame with refreshed warnings/errors
   * so the UI updates immediately without waiting for the next tick.
   */
  const ackEvent = useCallback(
    (id: number) => {
      const primarySim =
        controlMode === "optimized" ? simOptRef.current : simBaseRef.current
      primarySim.events = primarySim.events.map((e) =>
        e.id === id ? { ...e, acknowledged: true } : e
      )
      const stillOpen = (s: Severity) =>
        primarySim.events.filter((e) => e.severity === s && !e.acknowledged)
      const setter =
        controlMode === "optimized" ? setHistoryOptimized : setHistoryBaseline
      setter((h) => {
        if (h.length === 0) return h
        const last = h[h.length - 1]
        const patched: TelemetryFrame = {
          ...last,
          station: {
            ...last.station,
            warnings: stillOpen("warning"),
            errors: stillOpen("error"),
          },
        }
        return [...h.slice(0, -1), patched]
      })
    },
    [controlMode]
  )

  const ackAll = useCallback(() => {
    const primarySim =
      controlMode === "optimized" ? simOptRef.current : simBaseRef.current
    primarySim.events = primarySim.events.map((e) => ({
      ...e,
      acknowledged: true,
    }))
    const setter =
      controlMode === "optimized" ? setHistoryOptimized : setHistoryBaseline
    setter((h) => {
      if (h.length === 0) return h
      const last = h[h.length - 1]
      const patched: TelemetryFrame = {
        ...last,
        station: { ...last.station, warnings: [], errors: [] },
      }
      return [...h.slice(0, -1), patched]
    })
  }, [controlMode])

  // Expose all events (open + acknowledged) so the Event log can show
  // history. Synced from the *primary* sim each tick.
  const [allEvents, setAllEvents] = useState<TelemetryEvent[]>([])
  useEffect(() => {
    const primarySim =
      controlMode === "optimized" ? simOptRef.current : simBaseRef.current
    setAllEvents(primarySim.events)
  }, [frame, controlMode])

  return {
    frame,
    history,
    allEvents,
    ackEvent,
    ackAll,
    isPaused,
    togglePause,
    reset,
    scenario,
    setScenario,
    speed,
    setSpeed,
    // Day simulation controls
    simMode,
    setSimMode,
    controlMode,
    setControlMode,
    simHour: displayedSimHour,
    costOptimized,
    costBaseline,
    upliftEur: costBaseline.totalCostEur - costOptimized.totalCostEur,
    sessions: MAY_1_SESSIONS,
    historyOptimized,
    historyBaseline,
    costHistory,
    // Scrub controls
    liveSimHour: simHour,
    scrubHour,
    isScrubbing: scrubHour !== null,
    scrubToHour,
  }
}

// -------------------- Formatters --------------------

export function formatKW(w: number, opts: { signed?: boolean; digits?: number } = {}): string {
  const { signed = false, digits = 1 } = opts
  const kw = w / 1000
  const v = Math.abs(kw).toFixed(digits)
  if (!signed) return `${v} kW`
  if (kw > 0.05) return `+${v} kW`
  if (kw < -0.05) return `−${v} kW`
  return `0 kW`
}

/**
 * Format a grid/hardware LIMIT in W → kW. Never rounds a cap UP.
 *
 * Caps must read as the real number. Plain toFixed(0) turned an 83.5 kW
 * clearance into "84 kW" — a limit that looks HIGHER than the wall actually
 * allows — and made 86.6 kW of import look pinned at an "87 kW" cap, which is
 * exactly how a rounded display gets misread as a breach. Whole caps stay
 * clean ("87 kW", not "87.0 kW").
 */
export function formatCapKW(w: number, opts: { unit?: boolean } = {}): string {
  const { unit = true } = opts
  const kw = w / 1000
  const v = Number.isInteger(kw) ? `${kw}` : kw.toFixed(1)
  return unit ? `${v} kW` : v
}

export function formatKWh(kwh: number, digits = 1): string {
  if (Math.abs(kwh) >= 1000) return `${(kwh / 1000).toFixed(digits)} MWh`
  return `${kwh.toFixed(digits)} kWh`
}
