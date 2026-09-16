// ════════════════════════════════════════════════════════════════════════
// v5.1 — DYNAMIC LOOKAHEAD HORIZON (pure, client-safe).
// ════════════════════════════════════════════════════════════════════════
//
// The LP plans over a fixed 24 h (96-step) horizon. That makes the optimiser
// patient: it will defer charging to the single global-cheapest slot anywhere
// in the next day. When SOC is high that is fine — there is energy to coast on
// while we wait for the trough. When SOC is LOW it is dangerous: waiting 18 h
// for a €2/MWh-cheaper slot risks running the reserve dry and curtailing a car.
//
// This module shrinks the horizon as SOC drops, so a low battery only "sees"
// the nearest few hours and therefore acts on the nearest cheap slot instead of
// holding out for a distant one. The shrink is COUPLED with the eagerness rules
// in cheap-slot.ts / committed-action.ts — a short horizon alone does not import
// (see the 2026-06-28 evidence in the plan), it just narrows WHERE the planner
// is allowed to look for the trade.
// ════════════════════════════════════════════════════════════════════════

import type { OptimizerParams } from "./params"

/**
 * SOC-driven lookahead length (steps).
 *
 * Banded / linear:
 *   socFrac ≥ horizonSocHighFrac (0.70) → horizonMaxSteps (96 = 24 h)  [patient]
 *   socFrac ≤ horizonSocLowFrac  (0.30) → horizonMinSteps (12 =  3 h)  [eager]
 *   between                              → linear interpolation
 *
 * Returns `mpc.horizonSteps` unchanged when `dynamicHorizon` is off, and never
 * exceeds the available price-curve length the caller passes (so we never index
 * past the data). The result is clamped to at least 1 step.
 */
export function dynamicHorizonSteps(
  socFrac: number,
  mpc: OptimizerParams,
  /** Upper bound from the data actually available to the caller (price curve length). */
  availableSteps: number = Number.POSITIVE_INFINITY,
): number {
  const fixed = mpc.horizonSteps
  if (!mpc.dynamicHorizon) return Math.max(1, Math.min(fixed, availableSteps))

  const hi = mpc.horizonSocHighFrac ?? 0.7
  const lo = mpc.horizonSocLowFrac ?? 0.3
  const maxSteps = mpc.horizonMaxSteps ?? fixed
  const minSteps = mpc.horizonMinSteps ?? Math.min(12, fixed)

  // Guard against a degenerate band (hi ≤ lo) — fall back to the full horizon.
  if (!(hi > lo)) return Math.max(1, Math.min(maxSteps, availableSteps))

  let steps: number
  if (socFrac >= hi) {
    steps = maxSteps
  } else if (socFrac <= lo) {
    steps = minSteps
  } else {
    // Linear ramp: fraction of the way from the low band up to the high band.
    const t = (socFrac - lo) / (hi - lo)
    steps = Math.round(minSteps + t * (maxSteps - minSteps))
  }

  // Never exceed the fixed planning horizon or the available data, never < 1.
  return Math.max(1, Math.min(steps, maxSteps, fixed, availableSteps))
}
