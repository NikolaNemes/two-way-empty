// ════════════════════════════════════════════════════════════════════════
// v5.1 — FIRM COMMITTED-ACTION POLICY (pure, client-safe).
// ════════════════════════════════════════════════════════════════════════
//
// The LP is a GLOBAL planner and we only ever commit g[0] (the grid setpoint for
// "now"). Because "now" is rarely the global optimum, the LP's committed g[0] is
// often 0 even when the firm operating intent is obvious — a car is plugged in
// during a cheap slot, or the pack is low and energy is cheap right now. This is
// exactly what forced the constant manual overrides.
//
// `applyFirmCommit` runs AFTER the solve and adjusts ONLY the committed clearance
// (the grid envelope the device/physics consume), leaving the LP's objective and
// the rest of the planned schedule untouched. Two firm rules:
//
//   1. Car connected + (cheap now OR no beneficial arbitrage on the horizon) →
//      serve the car fully from GRID (clearance ≥ car + aux) and SPARE the
//      battery. Battery cycling costs ~7 ct/kWh, so discharging the pack to serve
//      a car only pays when the horizon price spread beats that round-trip wear.
//      When it does not, importing from grid is strictly cheaper than burning a
//      cycle — so we serve the car from the grid. We never force EXTRA battery
//      charging here (that would itself cycle the pack).
//        • cheap now            → reason "firm_cheap_car_import"
//        • not cheap, no arb    → reason "firm_no_arb_car_grid"
//
//   2. Low SOC + no car + buy-now  → import to refill the pack toward a target
//      that RISES as SOC drops, acting in the nearest cheap slot (not just the
//      global trough).
//
//   3. HIGH SOC + no car + materially-cheaper slot ahead → DEFER grid charging:
//      strip the battery-charging portion of the committed clearance (cover only
//      load + aux) and wait for the cheaper slot. The mirror image of Rule 2 — a
//      full pack can afford to wait, so it should NOT top up in a marginally-
//      cheaper slot when the real trough is still ahead. Eagerness ↔ SOC coupling.
//        • reason "wait_high_soc"
//
// Everything is clamped to [0, headroomKw]; otherwise the LP value is preserved.
// ════════════════════════════════════════════════════════════════════════

import type { OptimizerParams } from "./params"

export type FirmCommitReason =
  | "firm_cheap_car_import"
  | "firm_no_arb_car_grid"
  | "low_soc_refill"
  | "wait_high_soc"
  | "lp" // no override — LP committed action preserved

export interface FirmCommitInput {
  /** The LP's committed grid clearance for now (kW). */
  lpClearanceKw: number
  /** Current EV demand at the connector(s) (kW). */
  demandKw: number
  /** Non-dispatchable aux/hotel load (kW). */
  auxKw: number
  /** Max grid power available to command now (kW) — the clamp ceiling. */
  headroomKw: number
  /** Current pack SOC (fraction of E_max). */
  socFrac: number
  /** Is a car connected right now? */
  evConnected: boolean
  /** Risk-aware decision from decideBuyNow(). */
  buyNow: boolean
  cheapNow: boolean
  /**
   * True when decideBuyNow() fired with reason "buy_now_cheapest" — NOW is the
   * genuinely best visible slot (no cheaper slot ahead worth waiting for). In
   * that case the refill rule charges to the FULL refill target instead of the
   * SOC-scaled ramp: live-diagnosed Jul 28 2026, pack at risk-SOC 44% never
   * recovered because the ramp target (~41.5%) sat BELOW current SOC even in
   * the night trough — equilibrium hovered just above 40% indefinitely.
   */
  buyNowCheapest?: boolean
  /**
   * Is a materially-cheaper slot still ahead (savings ≥ the SOC-scaled worth-
   * waiting threshold)? From decideBuyNow().materialCheaperAhead. Drives the
   * high-SOC defer rule: don't top up now when a better slot is coming.
   */
  materialCheaperAhead: boolean
  /**
   * Does the visible horizon contain an arbitrage spread that beats the round-trip
   * cycling cost? From arbitrageWorthIt(). When false, discharging the pack to
   * serve a car loses money vs grid import, so we serve the car from grid.
   */
  arbitrageWorthIt: boolean
  mpc: OptimizerParams
}

export interface FirmCommitResult {
  clearanceKw: number
  reason: FirmCommitReason
}

/**
 * Effective low-SOC refill target (fraction of E_max). Ramps from the comfort
 * target (at/above the high horizon band) UP toward lowSocRefillTargetFrac as SOC
 * approaches the emergency floor — i.e. the lower we are, the fuller we aim.
 */
function lowSocRefillTarget(socFrac: number, mpc: OptimizerParams): number {
  const ceiling = mpc.lowSocRefillTargetFrac ?? 0.6
  const comfort = mpc.comfortTargetFrac ?? 0.25
  const hiBand = mpc.horizonSocHighFrac ?? 0.7
  const floor = mpc.emergencyFloorFrac ?? 0.15
  if (!(hiBand > floor)) return ceiling
  // 0 at/above the high band, 1 at/below the floor.
  const scale = Math.min(1, Math.max(0, (hiBand - socFrac) / (hiBand - floor)))
  return comfort + scale * (ceiling - comfort)
}

export function applyFirmCommit(input: FirmCommitInput): FirmCommitResult {
  const {
    lpClearanceKw,
    demandKw,
    auxKw,
    headroomKw,
    socFrac,
    evConnected,
    buyNow,
    cheapNow,
    buyNowCheapest,
    materialCheaperAhead,
    arbitrageWorthIt,
    mpc,
  } = input

  const clamp = (kw: number) => Math.max(0, Math.min(kw, headroomKw))
  let clearanceKw = lpClearanceKw
  let reason: FirmCommitReason = "lp"

  // ── Rule 1: car connected → grid serves the car, spare the battery, whenever
  //    (a) NOW is cheap, or (b) no horizon arbitrage beats the cycling cost. In
  //    both cases discharging the pack to serve the car is uneconomic (case a we
  //    charge cheaply instead of cycling; case b the spread can't repay the wear).
  if (evConnected && mpc.firmCheapCarImport && (cheapNow || !arbitrageWorthIt)) {
    // Cover the whole car + aux from the grid. We do NOT exceed this to force
    // battery charging (that would cycle the pack while the car is charging);
    // the LP can still have asked for more, in which case we keep its larger value.
    const serveFromGrid = demandKw + auxKw
    clearanceKw = Math.max(lpClearanceKw, serveFromGrid)
    reason = cheapNow ? "firm_cheap_car_import" : "firm_no_arb_car_grid"
    return { clearanceKw: clamp(clearanceKw), reason }
  }

  // ── Rule 2: low SOC + no car + buy-now → proactively refill ──────────────────
  if (!evConnected && mpc.lowSocRefillEnabled && buyNow) {
    // In the genuinely cheapest visible slot, refill to the FULL target — the
    // SOC-scaled ramp exists to avoid full top-ups in merely-marginal slots,
    // but applying it here left the pack in a permanent ~40% equilibrium: at
    // risk-SOC 0.44 the ramp target (~0.415) was BELOW current SOC, so even
    // the night trough never recharged the weak string (live, Jul 28 2026).
    // Buying to the full target in the trough IS the point of load shifting.
    const rampTarget = lowSocRefillTarget(socFrac, mpc)
    const target = buyNowCheapest
      ? Math.max(rampTarget, mpc.lowSocRefillTargetFrac ?? 0.6)
      : rampTarget
    if (socFrac < target) {
      // Energy gap to the target, converted to a one-slot charge power, bounded by
      // the charger's max charge rate. Grid must also cover aux on top.
      const usableKwh = mpc.usableEnergyKwh
      const stepH = mpc.stepHours
      const eta = mpc.chargeEff || 1
      const gapKwh = Math.max(0, (target - socFrac) * usableKwh)
      // kW drawn from the grid to charge: account for charge efficiency.
      const chargeKw = Math.min(mpc.maxChargeKw, gapKwh / Math.max(stepH, 1e-6) / eta)
      const refillClearance = auxKw + chargeKw
      clearanceKw = Math.max(lpClearanceKw, refillClearance)
      reason = "low_soc_refill"
      return { clearanceKw: clamp(clearanceKw), reason }
    }
  }

  // ── Rule 3: high SOC + no car + cheaper slot ahead → defer grid charging ─────
  // A full pack can afford to wait. If the LP wanted to top the battery up from
  // the grid now (committed clearance > load + aux) but a materially-cheaper slot
  // is still ahead, strip the charging portion: command only enough to cover load
  // + aux and let the refill happen in the cheaper slot. We use Math.min so we
  // NEVER increase discharge — if the LP already planned to discharge (clearance ≤
  // load+aux) we leave it untouched; we only remove speculative early charging.
  const hiBand = mpc.horizonSocHighFrac ?? 0.7
  if (!evConnected && mpc.highSocDeferEnabled && socFrac >= hiBand && materialCheaperAhead) {
    const coverLoadKw = demandKw + auxKw
    if (lpClearanceKw > coverLoadKw) {
      clearanceKw = Math.min(lpClearanceKw, coverLoadKw)
      reason = "wait_high_soc"
      return { clearanceKw: clamp(clearanceKw), reason }
    }
  }

  // ── Default: preserve the LP's committed action ──────────────────────────────
  return { clearanceKw: clamp(clearanceKw), reason }
}
