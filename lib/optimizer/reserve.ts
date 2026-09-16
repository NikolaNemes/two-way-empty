// ════════════════════════════════════════════════════════════════════════
// v5 ADAPTIVE (uncertainty-sized) RESERVE — shared helper.
// ════════════════════════════════════════════════════════════════════════
//
// Extracted verbatim from the backtest's inline v5 block so the LIVE dispatch
// engine and the offline backtest size the reserve floor identically. The math
// is unchanged — this is a pure refactor.
//
// For each horizon step i we bank a per-step buffer-energy floor:
//
//   reserveFloorKwh[i] = clamp(
//       baseFloorKwh + coverageFrac · Σ_{j=i..i+win-1} max(0, P90[j] − mean[j])·dt,
//       baseFloorKwh,                       // never below the flat planning floor
//       reserveMaxFrac · E_max )            // never hoard more than the hard cap
//
// i.e. a small base floor PLUS the energy the P90 demand would draw beyond the
// mean across the next `reserveLookaheadH`, so the battery is kept fuller
// exactly when arrival uncertainty is high.
// ════════════════════════════════════════════════════════════════════════

import type { OptimizerParams } from "./params"

export interface AdaptiveReserveInput {
  /** Usable buffer capacity E_max (kWh) the floor is sized against. */
  capacityKwh: number
  /** Forecast mean EV demand per horizon step (kW), length H. */
  demandKw: number[]
  /** Forecast P90 EV demand per horizon step (kW), length H (same length as demandKw). */
  demandHiKw: number[]
  /** The optimizer parameter block (reads socFloorFrac, stepHours + v5 knobs). */
  mpc: OptimizerParams
}

export interface AdaptiveReserveResult {
  /** Per-step buffer-energy floor (kWh), aligned to steps t=1..H (index 0 ⇒ E[1]). */
  reserveFloorKwh: number[]
  /** The applied step-1 floor as a % of E_max (observability). */
  step1FloorPct: number
}

/**
 * Size the v5 adaptive reserve floor from demand-forecast uncertainty.
 * Behaviour-identical to the original inline backtest implementation.
 */
export function sizeAdaptiveReserveKwh(input: AdaptiveReserveInput): AdaptiveReserveResult {
  const { capacityKwh, demandKw, demandHiKw, mpc } = input
  const len = Math.min(demandKw.length, demandHiKw.length)

  const baseFloorKwh = mpc.socFloorFrac * capacityKwh
  const capFloorKwh = (mpc.reserveMaxFrac ?? 0.6) * capacityKwh
  const coverageFrac = mpc.reserveCoverageFrac ?? 1.0
  const lookaheadH = mpc.reserveLookaheadH ?? 3
  const stepHrs = mpc.stepHours
  const win = Math.max(1, Math.round(lookaheadH / stepHrs))

  const reserveFloorKwh = new Array<number>(len)
  for (let i = 0; i < len; i++) {
    let uncertaintyKwh = 0
    for (let j = i; j < Math.min(i + win, len); j++) {
      uncertaintyKwh += Math.max(0, demandHiKw[j] - demandKw[j]) * stepHrs
    }
    const desired = baseFloorKwh + coverageFrac * uncertaintyKwh
    reserveFloorKwh[i] = Math.min(Math.max(desired, baseFloorKwh), capFloorKwh)
  }

  const step1FloorPct = len > 0 && capacityKwh > 0 ? (reserveFloorKwh[0] / capacityKwh) * 100 : 0
  return { reserveFloorKwh, step1FloorPct }
}

// ════════════════════════════════════════════════════════════════════════
// v5 ARBITRAGE STAND-DOWN — rare high-risk demand hedge (shared helper).
// ════════════════════════════════════════════════════════════════════════
//
// The adaptive reserve covers *characterizable* variability, but a genuinely
// low / very-risky scenario warrants standing down from arbitrage altogether:
// dispatch AS IF there were no price opportunity, so the planner just covers
// demand from the grid and holds / opportunistically refills the pack, keeping
// the full battery available for the real-time emergency tap. Mechanically this
// is achieved by the CALLER zeroing the self-consumption cap (dailyCapKwh → 0)
// for that solve — this helper only decides WHEN, identically for the live
// engine and the backtest. It is a no-op unless `mpc.standDownEnabled`.

export interface StandDownInput {
  /** Usable buffer capacity E_max (kWh). */
  capacityKwh: number
  /** Current buffer energy E[0] (kWh) — anchors the low-SOC test. */
  energyKwh: number
  /** Forecast P90 EV demand per horizon step (kW), aligned to the solve horizon. */
  demandHiKw: number[]
  /** Controllable grid-import headroom this horizon (kW) = grid cap − baseload. */
  headroomKw: number
  /** The optimizer parameter block (reads stand-down knobs + reserveLookaheadH/stepHours). */
  mpc: OptimizerParams
}

export interface StandDownDecision {
  /** Suspend planned arbitrage discharge for this solve. */
  standDown: boolean
  /** SOC is at/near the planning floor. */
  lowSoc: boolean
  /** Forecast P90 demand within the lookahead rivals/exceeds grid headroom. */
  demandRisk: boolean
  /** Why it fired (for logging / the plan snapshot). */
  reason: "off" | "none" | "low_soc" | "demand_risk" | "low_soc+demand_risk"
  /** Peak P90 demand over the lookahead window (kW). */
  peakHiKw: number
  /** Current energy above the planning floor (kWh) — negative ⇒ below floor. */
  socMarginKwh: number
}

/**
 * Decide whether to stand down from arbitrage. Fires when SOC is near the
 * planning floor OR a forecast P90 demand spike within the protective lookahead
 * rivals the grid import cap. Pure + behaviour-identical across live & backtest.
 */
export function decideStandDown(input: StandDownInput): StandDownDecision {
  const { capacityKwh, energyKwh, demandHiKw, headroomKw, mpc } = input
  const planningFloorKwh = mpc.socFloorFrac * capacityKwh
  const socMarginKwh = energyKwh - planningFloorKwh

  if (!mpc.standDownEnabled) {
    return { standDown: false, lowSoc: false, demandRisk: false, reason: "off", peakHiKw: 0, socMarginKwh }
  }

  // Low-SOC trigger: at/near (within margin of) the planning floor.
  const socMarginFrac = mpc.standDownSocMarginFrac ?? 0.05
  const lowSoc = energyKwh <= planningFloorKwh + socMarginFrac * capacityKwh

  // Demand-risk trigger: peak P90 demand over the lookahead window ≥ frac × headroom.
  const lookaheadH = mpc.reserveLookaheadH ?? 3
  const win = Math.max(1, Math.round(lookaheadH / mpc.stepHours))
  let peakHiKw = 0
  for (let j = 0; j < Math.min(win, demandHiKw.length); j++) {
    if (demandHiKw[j] > peakHiKw) peakHiKw = demandHiKw[j]
  }
  const headroomFrac = mpc.standDownHeadroomFrac ?? 1.0
  const demandRisk = headroomKw > 0 && peakHiKw >= headroomFrac * headroomKw

  const standDown = lowSoc || demandRisk
  const reason: StandDownDecision["reason"] = !standDown
    ? "none"
    : lowSoc && demandRisk
      ? "low_soc+demand_risk"
      : lowSoc
        ? "low_soc"
        : "demand_risk"

  return { standDown, lowSoc, demandRisk, reason, peakHiKw, socMarginKwh }
}
