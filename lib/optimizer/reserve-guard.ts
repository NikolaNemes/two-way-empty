/**
 * REAL-TIME RESERVE GUARD — shared, pure, price-independent
 * ════════════════════════════════════════════════════════════════════════
 *
 * The ONE implementation of the two hard SOC guardrails, called from BOTH the
 * live engine (lib/dispatch-engine.ts) AND the shared decision core
 * (lib/dispatch-decide.ts → replay + walk-forward sim) so live and replay can
 * never diverge on the rule.
 *
 * The only lever is the grid-import SETPOINT P_grid_request (= clearanceKw). We
 * do NOT route power to the car vs the battery — that split is metered
 * downstream. Both rules simply raise the setpoint to the FULL grid cap
 * ("import the max allowed"); the physical outcome follows from that.
 *
 *   A. CAR-CONNECTED GUARD — measured SOC < CAR_GUARD_FRAC (60%) AND a car is
 *      connected ⇒ setpoint = full cap.
 *
 *   B. NO-CAR RECHARGE — no car connected AND measured SOC <
 *      NOCAR_RECHARGE_TRIGGER_FRAC (40%) ⇒ latch setpoint = full cap, held
 *      (hysteresis) until SOC ≥ NOCAR_RECHARGE_TARGET_FRAC (60%). The latch
 *      lives on the caller's persisted state so it survives across ticks and
 *      doesn't chatter around the 40% edge.
 *
 * We only ever RAISE the setpoint (never reduce a higher optimizer import).
 */

import {
  RESERVE_GUARD_ENABLED,
  CAR_GUARD_FRAC,
  NOCAR_RECHARGE_TRIGGER_FRAC,
  NOCAR_RECHARGE_TARGET_FRAC,
} from "@/lib/optimizer/params"

export interface ReserveGuardInput {
  /** Measured buffer SOC right now (%). */
  avgSocPct: number
  /** True when a car is physically connected right now. */
  carConnected: boolean
  /** Live grid-import ceiling for this tick (kW). */
  gridCapKw: number
  /** The setpoint the optimizer/optimiser wants this tick (kW), before the guard. */
  currentClearanceKw: number
  /** Persisted no-car forced-recharge latch state coming into this tick. */
  forcedRechargeActive: boolean
}

export interface ReserveGuardResult {
  /** The setpoint after the guard (≥ currentClearanceKw). */
  clearanceKw: number
  /** Updated latch state to persist for the next tick. */
  forcedRechargeActive: boolean
  /** True when the guard raised the setpoint this tick. */
  engaged: boolean
  /** Which rule fired (for logging), or null. */
  reason: "car-guard" | "no-car-recharge" | null
}

export function applyReserveGuard(input: ReserveGuardInput): ReserveGuardResult {
  let forcedRechargeActive = input.forcedRechargeActive === true

  if (!RESERVE_GUARD_ENABLED) {
    return { clearanceKw: input.currentClearanceKw, forcedRechargeActive, engaged: false, reason: null }
  }

  // Maintain the no-car recharge latch (Rule B) with hysteresis. Only meaningful
  // when no car is connected; a connected car hands control to Rule A.
  if (!input.carConnected) {
    if (!forcedRechargeActive && input.avgSocPct < NOCAR_RECHARGE_TRIGGER_FRAC * 100) {
      forcedRechargeActive = true
    } else if (forcedRechargeActive && input.avgSocPct >= NOCAR_RECHARGE_TARGET_FRAC * 100) {
      forcedRechargeActive = false
    }
  }

  const carGuardActive = input.carConnected && input.avgSocPct < CAR_GUARD_FRAC * 100
  const noCarRechargeActive = !input.carConnected && forcedRechargeActive

  if ((carGuardActive || noCarRechargeActive) && input.gridCapKw > input.currentClearanceKw + 0.1) {
    return {
      clearanceKw: input.gridCapKw,
      forcedRechargeActive,
      engaged: true,
      reason: carGuardActive ? "car-guard" : "no-car-recharge",
    }
  }

  return { clearanceKw: input.currentClearanceKw, forcedRechargeActive, engaged: false, reason: null }
}
