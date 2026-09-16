/**
 * Shared TYPES for the Dispatcher Status page + a thin re-export of the durable
 * store implementation.
 *
 * The state itself now lives in Upstash Redis (see `lib/dispatcher-store.ts`),
 * so it survives serverless cold starts and is shared consistently across every
 * instance — fixing the "Dispatching disconnected" flicker that the old
 * in-memory `globalThis` singleton caused on refresh.
 *
 * This module remains the single import entry point: it owns the display/report
 * types and re-exports the async, Redis-backed read/write helpers. All store
 * functions are now ASYNC (they hit Redis), so callers must `await` them.
 *
 * IMPORTANT: this layer does NOT store the command list. Amperio is the master
 * record for commands — the page reads them directly from GET /api/v1/commands.
 * Here we only track worker liveness and the desired-state (Start/Stop).
 */

import type { ApiTelemetryFrame } from "./amperio-api"

/** Metadata about the running worker, refreshed on every report. */
export interface WorkerMeta {
  stationId: string
  siteId: string
  assetId: string
  tickMs: number
  priceSource: string
  baseUrl: string
  /** ISO timestamp of when the worker process started. */
  startedAt: string
}

/** Lifecycle phase reported by the worker. */
export type WorkerPhase = "starting" | "running" | "stopping" | "paused"

/**
 * The fine-grained step the worker is performing within a single tick. This is
 * what powers the live "what is it doing right now" activity feed.
 */
export type ActivityStep =
  | "idle"
  | "telemetry"
  | "prices"
  | "planning"
  | "deciding"
  | "dispatching"
  | "done"
  | "error"

/** A single timestamped activity entry emitted by the worker. */
export interface WorkerActivity {
  /** ISO timestamp (worker clock) when the step happened. */
  ts: string
  step: ActivityStep
  message: string
  level: "info" | "warn" | "error"
  /** Monotonic tick number this entry belongs to (for grouping in the UI). */
  tick?: number
}

/**
 * Operator desired-state for the dispatch loop. The cron-driven engine reads
 * this flag at the start of every invocation: "running" = dispatch normally,
 * "stopped" = stay idle (no telemetry decisions, no commands sent).
 */
export type ControlState = "running" | "stopped"

/**
 * One step of the receding-horizon the optimizer plan. The trajectory is anchored at
 * `baseSlot` (step 0 = the committed control step) and extends across the
 * horizon; `gridKw` is the planned grid-import ceiling, `socPct` the
 * reconstructed projected buffer state, `reserveFloorPct` the uncertainty-sized
 * floor the LP planned against at that step.
 */
export interface PlanStep {
  /** Epoch-anchored 15-min slot index for this step. */
  slot: number
  /** ISO timestamp of the slot start. */
  ts: string
  /** DA price used for this step (€/MWh). */
  priceEurMwh: number
  /** Planned grid-import ceiling (kW). */
  gridKw: number
  /** Forecast EV demand for this step (kW). */
  demandKw: number
  /** Projected buffer SOC at the start of this step (%). */
  socPct: number
  /** v5 adaptive reserve floor planned for this step (% of E_max). */
  reserveFloorPct: number
}

/**
 * A full the optimizer plan produced on a replan event. Persisted so the page can show
 * the current plan and diff it against the previous one ("what changed on this
 * replan"). The committed first step (`clearanceKw`) is what feeds the wire.
 */
export interface PlanSnapshot {
  /** Epoch ms the plan was solved. */
  solvedAt: number
  /** Slot index step 0 is anchored at. */
  baseSlot: number
  /** Control step length (h). */
  stepHours: number
  /** Usable buffer capacity E_max the plan was sized against (kWh). */
  capacityKwh: number
  /** Number of horizon steps actually planned (bounded by visible prices). */
  horizonSteps: number
  /** Trigger that fired this replan (connect/disconnect/idm/safety/manual/…). */
  eventType?: string
  /** LP status. */
  status: "optimal" | "infeasible" | "error"
  /** Objective value (€) when optimal. */
  objectiveEur: number | null
  /** Committed first-step grid-import ceiling (kW). */
  clearanceKw: number
  /**
   * RAW planned grid draw for the committed step (kW) = the LP's g[0] BEFORE the
   * `commandedGridImportKw` wire mapping. Since the full-g command rule these two
   * coincide whenever the plan imports (`clearanceKw` = the P_grid_request
   * setpoint = full g[0]; it is 0 only for intentional battery-serve/idle slots).
   * This is the LP's intended PHYSICAL grid draw to serve demand + any charge.
   * It is what the dispatch SIMULATION must feed into the BMS physics as
   * the grid-serve ceiling, so the sim doesn't force the battery to cover load
   * that the grid would actually serve (parity with the LP backtest path, which
   * already tracks the raw g[t] schedule). The live wire contract is unchanged.
   */
  plannedGridKw: number
  /**
   * Grid import ENVELOPE (kW) the solve used as headroom — the live
   * `p_grid_consumption_limit` register when reported, else the static cap. This
   * is what each scheduled command's `P_grid_clearance_w` ceiling should reflect
   * (NOT the per-slot setpoint, which is `steps[].gridKw` → `P_grid_request_w`).
   * Persisted so the external command builder renders the SAME envelope the live
   * committed command used. Undefined ⇒ builder falls back to the static default.
   */
  gridImportLimitKw?: number
  /** Applied step-1 reserve floor (% of E_max) — the v5 cushion that "breathes". */
  reserveFloorStep1Pct: number
  /**
   * SOC ceiling the dispatch plans against (% of E_max), from the model's socMaxFrac.
   * This — not the heuristic charge target — is the authoritative `soc_cp_max_pct`
   * sent to the wire, so the live charge ceiling matches the backtest engine.
   */
  socCeilingPct: number
  /**
   * Hard physical SOC floor (% of E_max), from the model's emergencyFloorFrac.
   * Used as the safe-mode reserve when the optimizer can't solve a tick.
   */
  socFloorPct: number
  /** Whether the adaptive (uncertainty-sized) reserve was active. */
  adaptiveReserve: boolean
  /**
   * v5 arbitrage stand-down: true when this solve suspended planned arbitrage
   * (covered demand from grid, held/refilled the pack) because the scenario was
   * low/risky. Undefined ⇒ the feature was off. `standDownReason` says why.
   */
  standDown?: boolean
  /** Why stand-down fired (low_soc / demand_risk / both), for the status page. */
  standDownReason?: string
  /**
   * v5.1 firm committed-action rule that adjusted the committed clearance:
   * "firm_cheap_car_import" (cheap slot + car → grid serves car, battery spared),
   * "low_soc_refill" (low pack + cheap now → proactive grid refill), or "lp"
   * (no override — the LP's committed action was kept). For the status page's
   * "Why this command" explanation.
   */
  firmCommitReason?: string
  /**
   * v5.1 effective lookahead horizon (steps) actually used this solve after the
   * SOC-driven dynamic-horizon shrink. Equals horizonSteps when dynamic horizon
   * is off or SOC is high.
   */
  effectiveHorizonSteps?: number
  /**
   * REAL-TIME RESERVE GUARD override on the COMMITTED step. When true, the
   * price-independent reserve guard (lib/optimizer/reserve-guard.ts) raised the committed
   * grid-import setpoint above the LP's own choice this tick (car connected + SOC
   * below the guard floor, or the no-car forced-recharge latch). In that case
   * `clearanceKw` and `steps[0].gridKw` reflect the ACTUAL committed/wire setpoint
   * (full cap), while `lpClearanceKw` preserves what the LP alone would have sent,
   * so the plan view can show "LP intent → guard-forced" honestly. Undefined/false
   * ⇒ the committed step is the pure LP decision.
   */
  reserveGuardEngaged?: boolean
  /** Which guard rule fired: "car-guard" (car + low SOC) or "no-car-recharge". */
  reserveGuardReason?: "car-guard" | "no-car-recharge"
  /** The LP's own committed grid-import (kW) before any reserve-guard override. */
  lpClearanceKw?: number
  /** The receding-horizon trajectory. */
  steps: PlanStep[]
}

/** Current + previous dispatch plan snapshots, for rendering the plan and its diff. */
export interface PlanState {
  current: PlanSnapshot | null
  previous: PlanSnapshot | null
}

/**
 * One row in the replan history table — a record of every time the optimizer
 * re-solved a horizon, answering WHEN it fired, WHY (the trigger + note), the
 * resulting OUTPUT COMMAND that was dispatched, and how the solve went. Newest
 * first. Appended AFTER the dispatch completes so `command*`/`dispatched` are
 * the real outcome, not an intent.
 */
export interface ReplanLogEntry {
  /** Epoch ms the plan was solved. */
  solvedAt: number
  /** Trigger that fired the replan (manual/price_update/ev_plug_event/…). */
  eventType?: string
  /** Human-readable reason/source for the replan (the note + source name). */
  trigger?: string
  /** LP status. */
  status: "optimal" | "infeasible" | "error"
  /** Committed first-step grid-import ceiling (kW). */
  clearanceKw: number
  /** Applied step-1 adaptive reserve floor (% of E_max). */
  reserveFloorStep1Pct: number
  /** Objective value (€) when optimal. */
  objectiveEur: number | null
  /** Steps in the solved horizon. */
  horizonSteps: number
  /** The actual grid-import setpoint dispatched (P_grid_request, unsigned W). */
  commandW?: number | null
  /** The same import command expressed in kW (convenience for display). */
  commandKw?: number | null
  /** True if the dispatch POST to Amperio succeeded. */
  dispatched?: boolean
  /** True if this was an inert test/liveness probe (no actuation). */
  isTest?: boolean
  /**
   * Full plan snapshot for this replan, so the history row can drill down into
   * its own Plan Input (per-step price/demand/SOC/reserve, anchor SOC, capacity)
   * and Plan Output (committed horizon). Optional for backward-compat with older
   * rows that predate snapshot embedding.
   */
  snapshot?: PlanSnapshot
}

/**
 * One row in the TICK LOGGER — a record of every call to /api/dispatcher/tick
 * (the steady pinger endpoint), the counterpart to ReplanLogEntry for the
 * regular scheduled cadence. Unlike the replan log (one row per genuine
 * re-solve), this logs EVERY tick API call including the ones that did no work
 * (locked by another pinger, cooldown spacing, stopped), so an operator can see
 * the raw cadence and exactly what each call did. Newest first.
 */
export interface TickLogEntry {
  /** Epoch ms the tick API call was handled. */
  at: number
  /** Caller name declared on the tick (X-Dispatch-Name / ?name=), if any. */
  source?: string | null
  /** Caller class — dashboard tab vs external pinger. */
  sourceKind?: SourceKind
  /** How many sub-ticks the window actually ran (0 when it no-op'd). */
  subTicks: number
  /** Did the window do any work at all? False for locked/stopped no-ops. */
  ran: boolean
  /**
   * Outcome of the last sub-tick in the window:
   *  • "dispatched" — a setpoint was POSTed to Amperio.
   *  • "skipped"    — ran but committed nothing (e.g. cooldown spacing).
   *  • "locked"     — another pinger held the run-lock; this call did nothing.
   *  • "stopped"    — operator intent not running.
   *  • "error"      — the dispatch POST failed.
   */
  outcome: "dispatched" | "skipped" | "locked" | "stopped" | "error"
  /** Short reason (engine `reason` for no-ops, or last phase message). */
  reason?: string | null
  /** The actual grid-import setpoint committed this tick (P_grid_request, unsigned W). */
  commandW?: number | null
  /** Same import setpoint in kW (convenience for display). */
  commandKw?: number | null
  /** Applied step-1 reserve floor (%) on the committed plan, when dispatched. */
  reserveFloorPct?: number | null
  /** Charge ceiling (%) on the committed plan, when dispatched. */
  socCeilingPct?: number | null
  /** DA price (€/MWh) seen at dispatch, when available. */
  priceEurMwh?: number | null
  /** True when this tick re-solved + rotated the plan (a replan happened). */
  wasReplan?: boolean
  /** True if the optimizer produced a usable plan (vs the safe full-clearance fallback). */
  mpcOk?: boolean
  /**
   * Committed plan snapshot for this tick, so a Tick-logger row can drill down
   * into its Plan Input (per-step price/demand/SOC) and Plan Output (committed
   * horizon), exactly like the replan history rows. Present on dispatched ticks
   * that produced a usable dispatch plan; absent for skips/fallback/test probes.
   */
  snapshot?: PlanSnapshot
}

/**
 * The body the worker/engine writes as a heartbeat. Carries a heartbeat
 * (worker + phase) and, optionally, one activity entry describing the step the
 * worker just performed.
 */
export interface DispatcherReport {
  worker: WorkerMeta
  phase: WorkerPhase
  activity?: WorkerActivity | null
  /**
   * The raw Amperio telemetry frame the worker fetched on this tick. Surfaced
   * verbatim so the page's bird's-eye view renders *exactly* what the dispatch
   * loop saw and acted on (same timestamp, same SOC/plug/power state) instead
   * of an independent client-side poll that could drift out of sync.
   */
  telemetryFrame?: ApiTelemetryFrame | null
}

/** What /api/dispatcher/status returns to the page. */
export interface DispatcherStatusResponse {
  /** True if a worker has ever reported a heartbeat. */
  hasWorker: boolean
  /** Derived liveness: online if intent is running AND a report arrived within the window. */
  online: boolean
  /** Last reported lifecycle phase. */
  phase: WorkerPhase | null
  worker: WorkerMeta | null
  /** ISO timestamp of the most recent report. */
  lastReportAt: string | null
  /** Milliseconds since the last report (server-computed convenience). */
  msSinceLastReport: number | null
  /** Liveness window used to compute `online` (ms). */
  livenessWindowMs: number
  /** Operator desired-state: what the worker should be doing. */
  control: ControlState
  /** ISO timestamp the control flag was last changed. */
  controlUpdatedAt: string | null
  /** The step the worker is currently on (for the live activity indicator). */
  currentStep: ActivityStep | null
  /** Recent activity entries, newest first (rolling window). */
  activity: WorkerActivity[]
  /**
   * The most recent raw Amperio telemetry frame the worker fetched, so the
   * page can render the bird's-eye view from the exact frame the dispatch loop
   * acted on. Null until the first tick fetches one.
   */
  telemetryFrame: ApiTelemetryFrame | null
  /** ISO timestamp of when `telemetryFrame` was captured by the worker. */
  telemetryFrameAt: string | null
  /**
   * Multi-pinger guardrail summary: which callers are currently driving ticks,
   * the observed vs configured dispatch cadence, and whether duplicate pingers
   * are over-driving the loop. Powers the "Pingers" monitor + dashboard
   * yield-to-other-pinger logic.
   */
  dispatchGuard: DispatchGuard
  /**
   * Operator "clear commands" marker (ISO). The command list is sourced from
   * Amperio (the master record) which has no delete API, so clearing only hides
   * commands issued at/before this timestamp from the dashboard view. Persisted
   * in Redis so the cleared view stays consistent across refreshes and tabs.
   */
  commandsClearedAt: string | null
  /**
   * The current + previous the optimizer plan snapshots. `current` is the most recent
   * receding-horizon solve; `previous` lets the page show how the replan
   * shifted the plan. Null entries until the first replan solves a plan.
   */
  plan: PlanState
  /**
   * Rolling log of recent the optimizer replans (newest first), independent of the
   * current/previous plan snapshots. Lets the page show the cadence and reason
   * for every recent re-solve even after the snapshots have rotated past them.
   */
  replanLog: ReplanLogEntry[]
  /**
   * Rolling log of recent /api/dispatcher/tick calls (newest first) — the
   * scheduled-cadence counterpart to `replanLog`. Includes no-op ticks (locked,
   * cooldown, stopped) so the Tick logger can show the raw pinger cadence and
   * what each call actually did.
   */
  tickLog: TickLogEntry[]
  /**
   * Human-readable reason the backing data store (Upstash Redis) could not be
   * read for this snapshot — e.g. the monthly request quota was exhausted. Null
   * when all reads succeeded. The dashboard surfaces this so a store outage is
   * diagnosed accurately instead of being misreported as the app being down.
   */
  storeError?: string | null
}

/** Where a tick/presence ping came from. */
export type SourceKind = "dashboard" | "external"

/** A caller that has recently pinged the dispatcher (dashboard tab or pinger). */
export interface ActiveSource {
  /** Caller id: `dash:<uuid>` for dashboard tabs, `ext:<…>` for pingers. */
  id: string
  /**
   * Human-meaningful name for the caller (mandatory on the tick API). Dashboard
   * tabs send e.g. "Chrome · macOS (dashboard tab)"; external pingers send
   * whatever they declare (cron job name, host, script, …). Falls back to the
   * id only for legacy callers that predate the required name.
   */
  name: string
  kind: SourceKind
  firstSeenAt: string
  lastSeenAt: string
  /** ISO of the last actual tick call (null if it only registered presence). */
  lastTickAt: string | null
  /** Total tick calls observed from this source. */
  tickCount: number
  /** True if it has triggered a tick within the active window (a live pinger). */
  ticking: boolean
  /**
   * ISO timestamp when the current *uninterrupted* pinging streak began. Resets
   * whenever the source goes quiet for longer than the active window and then
   * returns, so this marks continuous presence — not the all-time first sighting.
   */
  streakStartedAt: string
  /** Continuous uptime in ms = lastSeenAt − streakStartedAt. */
  uptimeMs: number
}

/**
 * Snapshot of who is driving dispatch and how fast. `observedIntervalMs` is the
 * median spacing between recent real dispatches; when it falls well below the
 * configured interval, multiple pingers are issuing commands more frequently
 * than intended (the symptom: duplicate Amperio commands).
 */
export interface DispatchGuard {
  configuredIntervalMs: number
  /** Median spacing between recent dispatches (null until ≥2 samples). */
  observedIntervalMs: number | null
  lastDispatchAt: string | null
  /** All callers active within the window (dashboard tabs + pingers). */
  activeSources: ActiveSource[]
  /** How many sources are actively triggering ticks right now. */
  pingerCount: number
  /** True if an external (non-dashboard) pinger is currently driving. */
  externalActive: boolean
  /** True if more than one source is triggering ticks (the thing to avoid). */
  multiplePingers: boolean
  /** True if observed cadence is materially faster than configured. */
  overFrequency: boolean
}

/** One time bucket in the 24h ticking report (fixed-width, oldest → newest). */
export interface TickBucket {
  /** ISO timestamp of the bucket's start. */
  startAt: string
  /** Number of ticks observed in this bucket. */
  count: number
}

/**
 * 24-hour ticking history — proof of how continuously the dispatch loop has
 * been driven (by this dashboard or any external pinger). Built from durable,
 * fixed-width buckets so an operator can see coverage, gaps, and total volume
 * at a glance.
 */
export interface TickReport {
  /** Fixed bucket width in ms (e.g. 5 min). */
  bucketMs: number
  /** Window covered in ms (24h). */
  windowMs: number
  /** Oldest → newest buckets spanning the window. */
  buckets: TickBucket[]
  /** Total ticks across the window. */
  totalTicks: number
  /** Buckets that saw ≥1 tick. */
  activeBuckets: number
  /** Total buckets in the window. */
  totalBuckets: number
  /** activeBuckets / totalBuckets, 0..100. */
  coveragePct: number
  /** Longest run of consecutive empty buckets (the biggest gap), in ms. */
  longestGapMs: number
  /** ISO of the most recent bucket that saw a tick, or null. */
  lastTickBucketAt: string | null
}

// ─────────────────────────────────────────────────────────────────────────
// Durable store implementation (Upstash Redis). Re-exported here so existing
// importers keep `@/lib/dispatcher-status` as their entry point. NOTE: every
// re-exported function is ASYNC — callers must `await`.
// ─────────────────────────────────────────────────────────────────────────

export {
  getControl,
  setControl,
  getStatus,
  recordReport,
  clearActivity,
  getLiveness,
  isStoreConfigured,
  recordSourcePresence,
  recordTickSource,
  recordTickEvent,
  getTickReport,
  getDispatchGuard,
  getCommandsClearedAt,
  setCommandsClearedAt,
  readPlan,
  writePlan,
  readReplanLog,
  appendReplanLog,
  readTickLog,
  appendTickLog,
  withStationScope,
  scopedStationId,
} from "./dispatcher-store"
