/**
 * PURE DISPATCH DECISION CORE
 * ════════════════════════════════════════════════════════════════════════
 *
 * `decideDispatch()` is the SINGLE decision the production engine makes each
 * tick, extracted out of `runOneTick` (lib/dispatch-engine.ts) so it can be
 * driven head-lessly — with no Amperio I/O, no Redis, no logging, no network.
 *
 * It is the EXACT live decision path:
 *
 *     planHorizon  →  decision (committed step or safe fallback)  →
 *     toDispatchPayload  →  committed grid-import command (P_grid_request_w)
 *
 * `runOneTick` (lib/dispatch-engine.ts) calls this and then does all the side
 * effects around it (plan rotation, activity log, the POST, planner/heartbeat
 * persistence, command-vs-meter recording). The walk-forward replay
 * (lib/backtest.ts, engine mode) calls the SAME function to drive a simulated
 * chargepost, so the replay and the live service can never silently diverge
 * on the decision itself.
 *
 * The only non-pure thing this touches is `planHorizon`'s read-only,
 * backward-looking session fetch (14-day demand profile) — leak-free for a
 * walk-forward replay because it never reads past `currentSlot`.
 */

import {
  toDispatchPayload,
  GRID_IMPORT_LIMIT_KW,
  type DispatchPayload,
  type DispatchPayloadContext,
  type DecideTickResult,
} from "@/lib/dispatch-kernel"
import { planHorizon } from "@/lib/optimizer/plan-horizon"
import { OPTIMIZER_DEFAULTS, type OptimizerParams } from "@/lib/optimizer/params"
import { applyReserveGuard } from "@/lib/optimizer/reserve-guard"
import type { PlanSnapshot } from "@/lib/dispatcher-status"

export interface DecideDispatchInput {
  stationId: string
  siteId: string
  assetId: string
  /** Current epoch-anchored 15-min slot index. */
  currentSlot: number
  /** Wall-clock (ms) stamped onto the command + used for `valid_until`. */
  timestampMs: number
  /** How long the commanded setpoint stays valid on the device (ms). */
  commandValidMs: number
  /** Triggering event type (echoed into the payload metadata). */
  eventType?: string
  /** Buffer SOC right now (%), anchors E[0] in the optimizer. */
  avgSocPct: number
  /**
   * LIVE measured EV demand on-site right now (kW) — reconstructed from the
   * power balance, NOT the broken `p_ev_w`. Injected into the committed step so
   * the command imports to serve the cars actually plugged in this instant.
   */
  trueDemandKw: number
  /** Live site grid-import ceiling for this tick (kW), or null for the static cap. */
  gridLimitKw: number | null
  /**
   * Station's full kVA import ENVELOPE (kW) advertised via P_grid_clearance_w
   * (multi-location: per-station nameplate). Defaults to the Gronau kernel
   * constant GRID_IMPORT_LIMIT_KW when omitted.
   */
  gridImportEnvelopeKw?: number
  /**
   * LIVE-measured aux/hotel load this tick (kW) from the power balance, or
   * null when unmeasurable. Drives the planner's dynamic aux reserve
   * (headroom = ceiling − max(liveAux, 2 kW floor)) instead of the fixed 8 kW.
   */
  liveAuxKw?: number | null
  /**
   * SOC of the weakest battery string (%), when per-battery telemetry exists.
   * The planner keys RISK decisions (horizon shrink, buy-now urgency, refill
   * trigger + gap sizing, high-SOC defer) and the reserve guard to
   * min(avg, this) — imbalance (e.g. B1 85% / B2 41%) must not hide behind a
   * comfortable-looking average. Energy math stays on avgSocPct.
   */
  minSocPct?: number | null
  /** Forward DA price curve as { slot -> €/MWh }. */
  priceBySlot: Record<string, number>
  /** Charger unit ids present on the asset, ordered (defaults to [1, 2]). */
  chargerUnitIds?: number[]
  /** Live per-unit topology + EV-accept state for charging_mode + safety clamp. */
  perUnitState?: DispatchPayloadContext["perUnitState"]
  /** Optional optimizer param override (defaults to the production block). */
  mpc?: OptimizerParams
  /**
   * True when a car is physically connected right now — drives the real-time
   * RESERVE GUARD (Rule A). Defaults to false.
   */
  carConnected?: boolean
  /**
   * Persisted no-car forced-recharge latch (Rule B) coming into this tick. The
   * caller passes its stored value and persists the returned value. Defaults to
   * false.
   */
  forcedRechargeActive?: boolean
  /**
   * Apply the real-time reserve guard inline (default true). The replay disables
   * this because it re-evaluates the guard EVERY frame (live's ~15 s cadence)
   * rather than only at the slot-boundary solve this function represents.
   */
  applyReserveGuardInline?: boolean
}

export type DecideSolveStatus = "ok" | "no-plan" | "error"

export interface DecideDispatchResult {
  /** Committed plan snapshot (null when the optimizer could not solve this tick). */
  snapshot: PlanSnapshot | null
  /** The committed levers fed to the wire payload. */
  decision: DecideTickResult
  /** The full wire command the engine would POST to Amperio. */
  payload: DispatchPayload
  /** True when the optimizer produced a usable plan (false ⇒ safe fallback command). */
  mpcOk: boolean
  /** Outcome of the plan solve, for the caller's activity log. */
  solveStatus: DecideSolveStatus
  /** Error message when `solveStatus === "error"`. */
  solveError?: string
  /** Committed grid-import setpoint magnitude (W), 0 when idle/discharging. */
  commandW: number | null
  /** Same as commandW in kW, rounded to 0.1. */
  commandKw: number | null
  /**
   * RAW planned grid draw g[0] (kW) for the committed step — the physical grid
   * the LP intends to serve demand + charge, BEFORE the wire reduction that
   * zeroes the setpoint when not charging. The dispatch SIMULATION feeds this
   * (not `decision.clearanceKw`) into the BMS physics so the grid serves demand
   * in cheap slots instead of needlessly cycling the battery. Equals the full
   * grid clearance on a safe fallback (EVs always served from grid).
   */
  plannedGridKw: number
  /** Step-1 reserve floor (%). */
  reserveFloorPct: number
  /** Charge SOC ceiling (%). */
  socCeilingPct: number
  /** DA price for the current slot (€/MWh), if known. */
  priceEurMwh: number | undefined
  /** True when the real-time reserve guard raised the setpoint this tick. */
  reserveGuardEngaged: boolean
  /** Which guard rule fired ("car-guard" | "no-car-recharge"), or null. */
  reserveGuardReason: "car-guard" | "no-car-recharge" | null
  /** Updated no-car forced-recharge latch to persist for the next tick. */
  forcedRechargeActive: boolean
}

/**
 * Run the production dispatch decision for one tick. Side-effect free except
 * for `planHorizon`'s read-only backward session fetch.
 */
export async function decideDispatch(input: DecideDispatchInput): Promise<DecideDispatchResult> {
  const priceEurMwh = input.priceBySlot[String(input.currentSlot)]

  // ── the optimizer: the ONLY engine that decides dispatch ─────────────────────────
  let snapshot: PlanSnapshot | null = null
  let solveStatus: DecideSolveStatus = "no-plan"
  let solveError: string | undefined
  try {
    const s = await planHorizon({
      stationId: input.stationId,
      currentSlot: input.currentSlot,
      avgSocPct: input.avgSocPct,
      gridLimitKw: input.gridLimitKw,
      // Live demand → committed step. max(served, car-accept) so the optimizer imports
      // to serve the FULL demand of plugged cars right now, even when this hour's
      // forecast is ~0 and the buffer is at the reserve floor.
      liveDemandKw: input.trueDemandKw,
      liveAuxKw: input.liveAuxKw,
      minSocPct: input.minSocPct,
      priceBySlot: input.priceBySlot,
      eventType: input.eventType,
      mpc: input.mpc,
    })
    if (s && s.status !== "error" && s.steps.length > 0) {
      snapshot = s
      solveStatus = "ok"
    } else {
      solveStatus = "no-plan"
    }
  } catch (err) {
    solveStatus = "error"
    solveError = (err as Error).message
  }

  // Build the levers. When the plan solved, EVERY lever comes from it — no
  // heuristic blend. Otherwise a SAFE self-protecting command: full grid
  // clearance (EVs always served), reserve = the model's hard EMERGENCY floor,
  // charge ceiling = the model's max SOC. Grid-import ceiling respects the live
  // register when present. These fallback constants intentionally use the
  // production V5 defaults regardless of any param override, matching live.
  const mpcOk = snapshot != null
  const decision: DecideTickResult = mpcOk
    ? {
        clearanceKw: snapshot!.clearanceKw,
        reserveSocPct: snapshot!.reserveFloorStep1Pct,
        targetSocPct: snapshot!.socCeilingPct,
        eagerness: 0,
        anticipatedEvKwh: 0,
        expensiveThresholdEurMwh: 0,
      }
    : {
        clearanceKw: input.gridLimitKw ?? OPTIMIZER_DEFAULTS.gridMaxKw,
        reserveSocPct: OPTIMIZER_DEFAULTS.emergencyFloorFrac * 100,
        targetSocPct: OPTIMIZER_DEFAULTS.socMaxFrac * 100,
        eagerness: 0,
        anticipatedEvKwh: 0,
        expensiveThresholdEurMwh: 0,
      }

  // ── REAL-TIME RESERVE GUARD (price-independent, post-optimizer) ───────────────────
  // Hard SOC guardrails applied to the setpoint BEFORE it becomes the wire
  // command, so both the live engine and the replay/sim honour them identically.
  // See lib/optimizer/reserve-guard.ts for the two rules. Only ever RAISES the setpoint.
  const guard =
    input.applyReserveGuardInline === false
      ? { clearanceKw: decision.clearanceKw, forcedRechargeActive: input.forcedRechargeActive === true, engaged: false, reason: null as null | "car-guard" | "no-car-recharge" }
      : applyReserveGuard({
          // The emergency guardrails protect the WEAKEST string when known —
          // an average of 63% must not mask one battery at 41%.
          avgSocPct:
            input.minSocPct != null && Number.isFinite(input.minSocPct)
              ? Math.min(input.avgSocPct, input.minSocPct)
              : input.avgSocPct,
          carConnected: input.carConnected === true,
          gridCapKw: input.gridLimitKw ?? OPTIMIZER_DEFAULTS.gridMaxKw,
          currentClearanceKw: decision.clearanceKw,
          forcedRechargeActive: input.forcedRechargeActive === true,
        })
  if (guard.engaged) decision.clearanceKw = guard.clearanceKw

  const payload = toDispatchPayload(decision, {
    siteId: input.siteId,
    assetId: input.assetId,
    timestamp: new Date(input.timestampMs).toISOString(),
    validForMs: input.commandValidMs,
    priceEurMwh,
    chargerUnitIds:
      input.chargerUnitIds && input.chargerUnitIds.length ? input.chargerUnitIds : undefined,
    perUnitState: input.perUnitState,
    eventType: input.eventType,
    // Import ENVELOPE for P_grid_clearance_w — the device's full kVA clearance
    // (per-station nameplate, 87 for Gronau), NOT the (lower) real-power
    // planning ceiling in input.gridLimitKw and NOT the active setpoint. The
    // device is allowed the whole apparent-power envelope; PLANNING (setpoints,
    // headroom) is bounded by the real-power cap. The setpoint is carried
    // separately in P_grid_request_w from clearanceKw.
    gridImportLimitKw: input.gridImportEnvelopeKw ?? GRID_IMPORT_LIMIT_KW,
  })

  // Committed grid-import setpoint (P_grid_request_w): negative for import,
  // 0 when idle/discharging. We report its magnitude (unsigned import).
  const requestW = payload.station.P_grid_request_w ?? null
  const commandW = requestW != null ? Math.abs(requestW) : null
  const commandKw = commandW != null ? Math.round((commandW / 1000) * 10) / 10 : null

  return {
    snapshot,
    decision,
    payload,
    mpcOk,
    solveStatus,
    solveError,
    commandW,
    commandKw,
    // Raw planned grid draw for the sim physics. From the optimizer when it solved;
    // on a safe fallback the grid serves the EV at full clearance. When the
    // reserve guard engaged, the physical grid draw IS the forced full-cap
    // setpoint — override so the replay/sim physics imports at the cap too
    // (otherwise the guard would move the wire command but not the sim outcome).
    plannedGridKw: guard.engaged
      ? decision.clearanceKw
      : mpcOk
        ? snapshot!.plannedGridKw
        : decision.clearanceKw,
    reserveFloorPct: decision.reserveSocPct,
    socCeilingPct: decision.targetSocPct,
    priceEurMwh,
    reserveGuardEngaged: guard.engaged,
    reserveGuardReason: guard.reason,
    forcedRechargeActive: guard.forcedRechargeActive,
  }
}
