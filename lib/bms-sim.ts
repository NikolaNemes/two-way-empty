/**
 * AUTOMATIC-MODE BMS PHYSICS (single source of truth)
 * ════════════════════════════════════════════════════════════════════════
 *
 * Given the two levers a dispatch decision emits for one frame —
 *   • clearanceKw   — the grid-import ceiling/target for this frame
 *   • reserveSocPct — the SoC floor the battery won't discharge below
 * — this resolves how the chargepost, running in automatic mode under
 * P_grid_clearance, actually serves the EV and moves the battery:
 *
 *   • EV demand ≤ clearance: grid serves the EV, remaining headroom charges
 *     the battery (opportunistic, cheap-hour charge).
 *   • EV demand > clearance: grid imports up to clearance, the battery covers
 *     the gap down to the reserve floor, and the grid backstops anything the
 *     battery can't — serving the car always beats arbitrage. Curtail only
 *     when demand exceeds physical grid + available discharge.
 *   • No EV: charge the battery up to clearance (if cheap) or idle.
 *
 * This was extracted verbatim from the backtest loop so the backtest, the
 * Data Analysis report, and the walk-forward dispatch simulator all share ONE
 * physics implementation — a parallel copy is exactly the drift bug class we
 * fixed before (commanded-import vs metered-served). Keep it that way: change
 * the physics here, never in a caller.
 *
 * Conventions: positive grid = import; positive batt = charge, negative =
 * discharge; all power in kW, energy in kWh, durations in hours.
 */

import { clampNoExport } from "@/lib/dispatch-kernel"

export interface BmsSimStepInput {
  /** Decision clearance for this frame (kW) — the grid import ceiling/target. */
  clearanceKw: number
  /** Decision reserve floor (%) — battery won't discharge below this SoC. */
  reserveSocPct: number
  /** EV demand on-site this frame (kW). 0 ⇒ no car plugged. */
  evLoadKw: number
  /** Average buffer SoC at the START of this frame (%). */
  socPct: number
  /** Site-wide grid-import ceiling that applies this frame (kW). */
  siteGridLimitKw: number
  /**
   * Uncontrollable, non-EV baseload that must be imported regardless (kW).
   * Subtracted from the controllable headroom, then added back into the
   * metered grid total so the site energy balance / cost stays whole.
   */
  baseloadKw: number
  /** Frame duration (hours). */
  dtHours: number
  /** Total usable battery capacity across both packs (kWh). */
  capacityKwh: number
  /** Max battery charge/discharge power (kW). */
  battMaxPowerKw: number
  /** Opportunistic charge ceiling (%) — the SOC_TRADING_HIGH band. */
  socTradingHighPct: number
}

export interface BmsSimStepResult {
  /** Metered grid import (kW, positive = import) incl. baseload, post no-export clamp. */
  gridKw: number
  /** Battery power (kW): positive = charge, negative = discharge. */
  battKw: number
  /** EV power actually served this frame (kW). */
  evServedKw: number
  /** EV power that could not be served — genuine physical shortfall (kW). */
  evCurtailedKw: number
  /** True if the controllable grid setpoint implied export and was clamped to 0. */
  exportClamped: boolean
}

/**
 * Resolve one automatic-mode BMS frame. Pure: no I/O, no shared state.
 * Callers own any aggregate counters (export violations, unserved energy).
 */
export function simulateAutomaticModeStep(input: BmsSimStepInput): BmsSimStepResult {
  const {
    evLoadKw,
    socPct,
    siteGridLimitKw,
    baseloadKw,
    dtHours,
    capacityKwh,
    battMaxPowerKw,
    socTradingHighPct,
  } = input

  // Effective grid ceiling for controllable load (minus baseload).
  const effectiveGridLimitKw = Math.max(0, siteGridLimitKw - baseloadKw)
  const clearanceKw = Math.min(input.clearanceKw, effectiveGridLimitKw)
  const reserveFloor = input.reserveSocPct

  // Available discharge energy above the reserve floor.
  const dischargeAvailKwh = Math.max(0, ((socPct - reserveFloor) / 100) * capacityKwh)
  const maxDischargeKw = Math.min(battMaxPowerKw, dischargeAvailKwh / dtHours)

  // Charge headroom below the opportunistic ceiling.
  const chargeAvailKwh = Math.max(0, ((socTradingHighPct - socPct) / 100) * capacityKwh)
  const maxChargeKw = Math.min(battMaxPowerKw, chargeAvailKwh / dtHours)

  let gridKw: number
  let battKw: number // positive = charging, negative = discharging
  let evServedKw: number
  let evCurtailedKw = 0

  if (evLoadKw > 0) {
    // EV is plugged in: station must serve it.
    if (evLoadKw <= clearanceKw) {
      // EV demand fits under clearance: grid serves EV, charge battery with headroom.
      const gridHeadroom = Math.max(0, Math.min(effectiveGridLimitKw, clearanceKw) - evLoadKw)
      const chargeKw = Math.min(gridHeadroom, maxChargeKw)
      gridKw = evLoadKw + chargeKw
      battKw = chargeKw
      evServedKw = evLoadKw
    } else {
      // EV demand exceeds the (economic) clearance ceiling. The clearance is an
      // arbitrage preference, NOT a hard cap on serving real cars — priority-1
      // is always to serve the EV. Order of supply:
      //   1. Grid imports up to clearance (the preferred cheap level).
      //   2. Battery covers the remaining gap (discharge down to reserve floor).
      //   3. If the battery can't cover it, the GRID backstops the rest up to
      //      the physical connection limit. Serving the car beats arbitrage.
      //   4. Curtail ONLY when demand exceeds physical grid + available
      //      discharge — a genuine physical impossibility.
      const evGapKw = evLoadKw - clearanceKw
      const battDischargeKw = Math.min(evGapKw, maxDischargeKw)
      const remainingGapKw = evGapKw - battDischargeKw
      // Extra grid above clearance, bounded by physical headroom.
      const gridBackstopKw = Math.min(remainingGapKw, Math.max(0, effectiveGridLimitKw - clearanceKw))
      evCurtailedKw = Math.max(0, remainingGapKw - gridBackstopKw)
      gridKw = Math.min(clearanceKw + gridBackstopKw, effectiveGridLimitKw)
      battKw = -battDischargeKw
      evServedKw = gridKw + battDischargeKw
    }
  } else {
    // No EV: station charges battery up to clearance (if cheap) or idles.
    // In automatic mode, the station charges when clearance is high (cheap hours).
    const chargeKw = Math.min(clearanceKw, effectiveGridLimitKw, maxChargeKw)
    gridKw = chargeKw
    battKw = chargeKw
    evServedKw = 0
  }

  // NO-EXPORT guard. The engine never commands export; flag any clamp.
  const guarded = clampNoExport(gridKw)
  // Residual baseload (metered mode) is must-import: add it back so the
  // optimised counterfactual still pays for the same total site consumption.
  gridKw = guarded.gridKw + baseloadKw

  return {
    gridKw,
    battKw,
    evServedKw,
    evCurtailedKw,
    exportClamped: guarded.clamped,
  }
}
