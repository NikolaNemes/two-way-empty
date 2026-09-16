// ════════════════════════════════════════════════════════════════════════
// BACKTEST ENGINE — replay the dispatch optimizer over stored telemetry.
// ════════════════════════════════════════════════════════════════════════
//
// Forward simulation seeded by the first stored frame's SOC. For each stored
// 15s frame we: derive the slot, re-solve the LP on the receding horizon
// when a replan fires, apply the NO-EXPORT clamp, evolve pack SOC from the
// commanded battery power, and accumulate cost / throughput / SOC-envelope KPIs.
//
// Exogenous inputs come from the real data: EV load and the DAM price curve.
// (Backtest reports procurement COST SAVINGS only — never modeled revenue.)
// Endogenous state (SOC, battery power, grid setpoint) is simulated, so this is
// a true "what would the optimizer have done" counterfactual, not a passive replay.
//
// SINGLE ENGINE: every version label runs the SAME LP (lib/optimizer/solver) with its stored parameter block. The legacy
// v1–v3 heuristic (decideTick / merit-order) has been removed.
// ════════════════════════════════════════════════════════════════════════

import "server-only"
import { db } from "./db"
import { telemetryFrame } from "./db/schema"
import {
  SLOT_MS,
  BATT_CAPACITY_KWH,
  SOC_TRADING_HIGH,
  GRID_REAL_POWER_CAP_KW,
  type SlotPrice,
} from "./dispatch-kernel"
import { simulateAutomaticModeStep } from "./bms-sim"
import { decideDispatch } from "./dispatch-decide"
import { applyReserveGuard } from "./optimizer/reserve-guard"
import { DEFAULT_STATION_ID } from "./amperio-api"
import { resolveParams, type KernelParams } from "./model-registry"
import { deriveEvLoadW } from "./telemetry-normalize"
import { getChargerSessions, type ChargerSession } from "./charger-sessions"
import { visibleHorizonMs, slotStartMs, DEFAULT_ZONE } from "./price-supply"
import { createNeonIdmStore, createNeonPriceStore } from "./price-store"
import { loadLiveBacktestFrames } from "./ingestion"
import { solveHorizon, getGlpk } from "./optimizer/solver"
import { OPTIMIZER_DEFAULTS, EMERGENCY_FLOOR_FRAC } from "./optimizer/params"
import { buildHourlyDemandProfile, demandKwAt, demandHiKwAt } from "./demand-forecast"
  import { sizeAdaptiveReserveKwh, decideStandDown } from "./optimizer/reserve"
import { dynamicHorizonSteps } from "./optimizer/horizon"
import { decideBuyNow, arbitrageWorthIt } from "./optimizer/cheap-slot"
import { applyFirmCommit } from "./optimizer/committed-action"
import { maybeGc } from "./gc-nudge"
import { and, asc, eq, gte, lte, sql } from "drizzle-orm"

const slotOf = (ms: number) => Math.floor(ms / SLOT_MS)

/**
 * Mid-slot SESSION replan threshold (kW): while a car is connected, re-solve the
 * LP when the live EV draw has moved at least this far from the draw the last
 * solve planned around. Big enough to ignore charger jitter, small enough to
 * catch a car ramping from its connect trickle toward full acceptance.
 */
const V4_SESSION_DEMAND_JUMP_KW = 5

/** Force a GC pass roughly every this-many replans during a backtest. Each
 * replan leaves ~4–5 MB of native GLPK memory that's only reclaimed on GC, so
 * ~250 replans ≈ ~1 GB between collections — keeps RSS bounded without GC churn. */
const GC_NUDGE_EVERY_REPLANS = 250

export interface BacktestKpis {
  frames: number
  durationHours: number
  /** Counterfactual cost if the kernel had re-decided every tick. */
  optimizedCostEur: number
  /** Real metered grid cost that actually occurred over the window. */
  actualCostEur: number
  savingsEur: number
  savingsPct: number
  batteryThroughputKwh: number
  batteryCycles: number
  exportViolations: number
  observedExportFrames: number
  socMinPct: number
  socAvgPct: number
  socMaxPct: number
  emergencyTicks: number
  /** Which dispatch engine produced this run. Always the LP optimizer (single engine). */
  engine: "v4-mpc"
  /** v4 only: control slots where the LP returned non-optimal (fell back). */
  mpcInfeasibleSlots?: number
  /** v4 only: total LP solves (replans) performed over the window. */
  mpcReplans?: number
  /** v4 only: LP solves avoided vs the classic re-solve-every-control-slot policy. */
  mpcReplansSaved?: number
  /** v4 only: replan trigger breakdown. */
  mpcReplanTriggers?: {
    init: number
    connect: number
    disconnect: number
    /** Re-solves while a car is on-site: slot rolls and material demand moves. */
    session: number
    idm: number
    safety: number
  }
  /** v4 only: slots whose realized cost used a live IDM price (vs DAM). */
  mpcIdmPricedSlots?: number
  /** v5 only: mean applied planning floor (% of E_max) across solves — shows
   *  the adaptive reserve "breathing" vs v4's flat floor. */
  mpcReserveFloorAvgPct?: number
  /** v5 only: peak applied planning floor (% of E_max) across solves. */
  mpcReserveFloorMaxPct?: number
  /** v5 only: solves where arbitrage stand-down fired (planned discharge suspended). */
  mpcStandDownSolves?: number
}

export interface BacktestSeriesPoint {
  ts: string
  /** Hours elapsed from the first frame — numeric x-axis. */
  hour: number
  socPct: number
  /** Simulated per-pack SOC under the optimized policy. */
  b1SocPct: number
  b2SocPct: number
  /** Actual measured per-pack SOC from telemetry (null on older runs). */
  actualB1SocPct?: number | null
  actualB2SocPct?: number | null
  /** Optimized counterfactual grid power (positive = import). */
  gridKw: number
  /**
   * COMMANDED grid import (P_grid_request, positive = import) for engine-mode
   * runs — the setpoint the kernel actually sends the hardware: the FULL
   * planned grid draw g[t] whenever the plan imports (g > eps), 0 only for
   * intentional battery-serve/idle slots (see `commandedGridImportKw`). This is
   * what the LIVE worker reports as "grid import", so plotting it makes the
   * replay apples-to-apples with live. `gridKw` above is the raw
   * clearance-ENVELOPE-driven physical draw. Null on LP-path / older runs.
   */
  commandedGridKw?: number | null
  /** Real metered grid power (positive = import). */
  actualGridKw: number
  battKw: number
  /**
   * EV demand on-site this frame (kW) — what the car(s) asked for. This is the
   * REQUESTED load fed into the dispatch decision and physics. Kept as `evKw`
   * for backward compatibility (older charts plot it as "EV delivered").
   */
  evKw: number
  /** Alias of evKw with explicit naming: the EV charge REQUESTED this frame (kW). */
  evRequestedKw?: number | null
  /**
   * EV charge actually SERVED by our dispatch this frame (kW) = requested minus
   * any physical curtailment. The always-serve invariant means this should
   * equal evRequestedKw on every frame; a gap is genuine physical curtailment
   * (demand exceeded grid limit + available battery discharge). Powers the
   * Served-vs-Requested verification panel. Null on older runs.
   */
  evServedKw?: number | null
  priceEurMwh: number | null
  /**
   * Optimized per-unit setpoints (null on older runs). Index 0 = Unit 1 →
   * Connector A, index 1 = Unit 2 → Connector B.
   * `gXKw` = grid import at that unit (positive = import).
   * `bXKw` = battery power (positive = charge, negative = discharge).
   * Per-unit energy balance: EV delivered at connector = gXKw − bXKw.
   */
  g1Kw?: number | null
  g2Kw?: number | null
  b1Kw?: number | null
  b2Kw?: number | null
  /**
   * SIMULATED EV charge delivered per connector this frame (kW). Connector A =
   * unit 1, B = unit 2. Demand-weighted split of served EV; ev1Kw + ev2Kw =
   * total served. Powers the per-session supply breakdown popover. Null on
   * older runs.
   */
  ev1Kw?: number | null
  ev2Kw?: number | null
  /**
   * METERED per-connector EV power (kW), from differencing each unit's
   * cumulative `e_ev_chg_kwh` counter. Connector A = unit 1, B = unit 2.
   * This is the real measured split — the ground truth for the simulated
   * per-connector dispatch (g − b). Null on older runs that lack counters.
   */
  mEv1Kw?: number | null
  mEv2Kw?: number | null
  /** METERED cumulative EV energy delivered per connector within the window (kWh). */
  mEv1Kwh?: number | null
  mEv2Kwh?: number | null
  /**
   * METERED site load this frame (kW), SIGNED power balance of the two site
   * meters: battery (+ = discharge) − grid (− = import) = everything the site
   * consumed (EV + AUX + conversion loss). This is the load the grid-first
   * counterfactual must serve (method 2026-09-04.3). Unlike `evKw + baseloadKw`
   * — which is max(power balance, EV counter) per frame and therefore
   * one-sided — it is energy-conserving: Σ siteLoadKw·dt = import − export −
   * battery net, so the counterfactual's import differs from as-run ONLY by
   * battery-cycling terms. Negative in meter-jitter / phantom frames (battery
   * charging more than the site imports); kept signed so the jitter cancels
   * instead of rectifying into phantom load. Null when a meter is missing.
   */
  siteLoadKw?: number | null
  /**
   * Per-connector EV ACCEPTANCE CEILING this frame (kW) = min(p_ev_max_w,
   * p_cp_max_w). The most THAT car would take at full power. Null when the car
   * does not report an acceptance limit (e.g. connector 1 today), so the chart
   * hides the ceiling line for that connector rather than inventing one.
   */
  ev1AcceptKw?: number | null
  ev2AcceptKw?: number | null
  /** Per-connector CAR state-of-charge this frame (%). Null when no car / not reported. */
  ev1SocCarPct?: number | null
  ev2SocCarPct?: number | null
  /** Per-connector charger-reported time-to-full this frame (seconds). Null/0 when idle. */
  ev1FullS?: number | null
  ev2FullS?: number | null
  /** SIMULATED (optimised) cumulative EV energy delivered per connector within the window (kWh). */
  sEv1Kwh?: number | null
  sEv2Kwh?: number | null
  /** Site-wide grid import ceiling that applied this frame (kW). Compliance: gridKw ≤ this. */
  siteGridLimitKw?: number | null
  /** Uncontrollable non-EV baseload included in gridKw (kW). */
  baseloadKw?: number | null
  /**
   * True when this point was expanded from a frozen daily rollup's 15-minute
   * series (chart-only). The tariff engine plots such points but NEVER folds
   * them into totals — those come from the day's frozen scalars, so a rollup-
   * served range equals the raw replay instead of double counting.
   */
  fromRollup?: boolean
  /**
   * First point of an independently replayed raw segment (one UTC day since
   * sep 2 2026). The tariff engine trues-up its SOC-anchored baseline per
   * segment, so a raw day and the same day served from its frozen rollup agree.
   */
  segStart?: boolean
}

/**
 * Per-operating-day savings breakdown. The report shows this when a multi-day
 * range is selected so the user can see which days the optimizer won/lost on,
 * rather than a single blended number. Costs use the SAME realized price and
 * dt integration as the aggregate KPI, accumulated per UTC calendar day, so the
 * rows sum exactly to the headline savings.
 */
export interface DailySaving {
  /** Bucket key: UTC day "YYYY-MM-DD" (daily) or UTC hour "YYYY-MM-DDTHH" (hourly). */
  bucketIso: string
  /** Real metered grid cost on this day (€). */
  actualCostEur: number
  /** Counterfactual optimized cost on this day (€). */
  optimizedCostEur: number
  /** actualCostEur − optimizedCostEur (€). Positive = optimizer saved money. */
  savingsEur: number
  /** Savings as a % of |actual cost| for the day. */
  savingsPct: number
  /** EV energy delivered on this day (kWh) — context for the savings. */
  evKwh: number
  /** Frames that fell on this day. */
  frames: number
}

/**
 * One production-engine decision, captured per replanned slot when
 * `decisionSource: "engine"`. This is the audit trail the Backtesting page
 * renders — exactly what the live engine would have committed each slot, so a
 * suspicious dispatch can be traced back to the levers that produced it.
 */
export interface EngineCommandTraceEntry {
  ts: string
  /** Hours elapsed from the first frame (matches the series x-axis). */
  hour: number
  /** Epoch-anchored 15-min slot index. */
  slot: number
  /** Simulated buffer SoC at decision time (%). */
  socPct: number
  /** DA price for the slot (€/MWh), if known. */
  priceEurMwh: number | null
  /** EV demand proxy fed to the decision (kW, post demand-scale). */
  demandKw: number
  /** Committed grid-import clearance/target for the slot (kW). */
  clearanceKw: number
  /** Committed reserve SoC floor (%) — battery won't discharge below this. */
  reserveFloorPct: number
  /** Committed charge SoC ceiling (%). */
  socCeilingPct: number
  /** Signed-magnitude committed import setpoint P_grid_request_w (kW), or null. */
  commandKw: number | null
  /** True when the optimizer solved; false ⇒ safe full-clearance fallback was sent. */
  mpcOk: boolean
  /** Optimizer solve outcome for this slot. */
  solveStatus: "ok" | "no-plan" | "error"
}

export interface BacktestResult {
  kpis: BacktestKpis
  series: BacktestSeriesPoint[]
  params: KernelParams
  /**
   * Per-slot production-engine command trace. Present only on runs with
   * `decisionSource: "engine"` (the Backtesting harness); undefined for the LP
   * path so existing callers and persisted runs are unaffected.
   */
  commandTrace?: EngineCommandTraceEntry[]
  /** Derived C1/C2 charging sessions over the window (from real telemetry). */
  sessions: ChargerSession[]
  /** Per-day savings breakdown (one entry per UTC day the window spans). */
  daily: DailySaving[]
  /** Per-hour savings breakdown (one entry per UTC hour) — powers the single-day popup. */
  hourly: DailySaving[]
  /**
   * Actual vs optimized imported energy + EV delivered (kWh).
   * - evKwh: total EV energy fed to the kernel (the signal selected by evSource).
   * - mEv1Kwh/mEv2Kwh: METERED per-connector EV energy (counter delta), ground truth.
   * - auxKwh: NON-EV ChargePost self-consumption (conversion loss, cooling,
   *   idle connectors, resting battery). Since 2026-09-03.3 this is the WINDOW
   *   ENERGY BALANCE, not a per-frame clamp:
   *       auxKwh = actualImportKwh − exportKwh − (mEv1Kwh + mEv2Kwh) − battNetKwh
   *   so the identity  import − export = EV delivered + AUX + battery net  holds
   *   exactly on every window and every report row. The old per-frame
   *   Σ max(0, siteLoad − meteredEV) rectified meter noise one-sidedly (+38 kWh
   *   Gronau, +103 kWh Norderstedt per month) and dropped the frames where the
   *   battery meter showed charge > import, so EV + AUX could EXCEED import
   *   (Norderstedt Aug 2026: by 374 kWh). It is kept as auxClampedKwh for
   *   reconciliation only — never report it. AUX is NON-DISPATCHABLE grid draw
   *   the battery cannot offset, so it is reported SEPARATELY from EV delivered.
   * - battNetKwh: metered battery charge − discharge over the window (kWh,
   *   positive = the pack absorbed net energy from the site). Carries the
   *   battery meter's own bias — Norderstedt Aug 2026 shows net −149 kWh while
   *   the SOC moved only ~−16 kWh, so a large |battNet| with a small ��SOC is a
   *   meter-quality flag, not real energy.
   * - exportKwh: metered grid export (kWh). ~0 on these sites (no PV).
   * - auxGatedKwh: the part of the per-frame residual baseload the PHYSICS GATE
   *   removed from the kernel / counterfactual must-import floor because it
   *   exceeded what the grid meter actually imported in that frame (diagnostic).
   * - evUnservedKwh: HARD-RULE guard. EV is must-serve, so this must be ~0.
   */
  totals: {
    actualImportKwh: number
    optimizedImportKwh: number
    evKwh: number
    mEv1Kwh: number
    mEv2Kwh: number
    auxKwh: number
    battNetKwh?: number | null
    /** The two legs of battNetKwh at the battery meter (kWh, both ≥ 0). The
     *  tariff baseline derives the pack's MEASURED round-trip efficiency from
     *  these + the SOC movement (method 2026-09-04.1) instead of assuming 85 %. */
    battChargeKwh?: number | null
    battDischargeKwh?: number | null
    exportKwh?: number | null
    auxClampedKwh?: number | null
    auxGatedKwh?: number | null
    evUnservedKwh: number
    /**
     * PER-CONNECTOR "could I serve more?" accounting. Only populated for a
     * connector when its car actually reported an acceptance limit
     * (p_ev_max_w > 0); null/0 otherwise (so we never compare a served value
     * against a missing ceiling). servedKwh here is the METERED per-connector
     * energy (e_ev_chg_kwh deltas), the matching basis for the ceiling.
     */
    ev1AcceptableKwh: number | null
    ev2AcceptableKwh: number | null
    ev1ServedKwh: number | null
    ev2ServedKwh: number | null
    ev1HeadroomKwh: number | null
    ev2HeadroomKwh: number | null
  }
}

const MAX_SERIES_POINTS = 600 // downsample for chart payloads

/**
 * EV demand signal source for the counterfactual:
 * - "powerbalance" (default, legacy): evLoad = max(0, batt − grid). Absorbs aux
 *   baseload and reads as "charging" in ~100% of frames — phantom-inflated.
 * - "metered": evLoad = per-connector `e_ev_chg_kwh` counter delta (true EV).
 *   The residual (powerbalance − metered) is fed back as a non-arbitrageable
 *   must-import baseload so the site energy balance — and the actual cost — stay
 *   whole; only the EV vs aux SPLIT changes, isolating the signal's effect.
 */
export type EvSource = "powerbalance" | "metered"

/**
 * One telemetry frame in the exact shape the backtest loop consumes.
 *
 * Normally these are loaded from Neon (`loadFramesFromDb`), but the Data
 * Analysis report runs on LIVE-pulled days that were never persisted, so the
 * server action can build these rows directly from the live Amperio frames +
 * DAM price curve and inject them via `runBacktest({ frames })`. That lets the
 * production optimizer run on any window — stored or not — instead of falling back
 * to a separate client-side heuristic.
 */
export interface BacktestFrameRow {
  ts: Date | string
  socAvg: number | null
  socPackA: number | null
  socPackB: number | null
  evLoadW: number | null
  gridPowerW: number | null
  battPowerW: number | null
  priceEurMwh: number | null
  gridImportLimitW: number | null
  b1Efull: number | null
  b1Eempty: number | null
  b2Efull: number | null
  b2Eempty: number | null
  ev1Cum: number | null
  ev2Cum: number | null
  /**
   * Per-connector EV ACCEPTANCE CEILING this frame (W) = min(p_ev_max_w,
   * p_cp_max_w): the most power the car would accept (its ISO-15118/control-pilot
   * offer), hardware-capped by the connector. This is what a greedy "always offer
   * full power the car can take" policy could have delivered at this connector.
   * Naturally 0 when no car is plugged (p_ev_max_w is 0 when Unplugged). Null on
   * older runs / sources that don't carry the field.
   */
  ev1AcceptW: number | null
  ev2AcceptW: number | null
  /**
   * Per-connector CAR state-of-charge this frame (%, the vehicle's own SoC, not
   * the stationary battery). Reliable on both connectors even though p_ev_w is
   * broken. Null when no car / not reported.
   */
  ev1SocCar: number | null
  ev2SocCar: number | null
  /**
   * Per-connector charger-reported time-to-FULL (seconds, t_full_s) — the EVSE's
   * own ETA estimate. 0/null when idle or not estimated.
   */
  ev1FullS: number | null
  ev2FullS: number | null
}

/**
 * Load the window's frames from Neon in the exact shape the loop consumes.
 * Exported so runBacktestForRange can detect a stale stored TAIL (a backfill
 * that ended days ago) and stitch live API frames onto the stored ones.
 */
export async function loadFramesFromDb(
  stationId: string,
  fromTs: Date,
  toTs: Date,
): Promise<BacktestFrameRow[]> {
  return db
    .select({
      ts: telemetryFrame.ts,
      socAvg: telemetryFrame.socAvg,
      socPackA: telemetryFrame.socPackA,
      socPackB: telemetryFrame.socPackB,
      evLoadW: telemetryFrame.evLoadW,
      gridPowerW: telemetryFrame.gridPowerW,
      battPowerW: telemetryFrame.battPowerW,
      priceEurMwh: telemetryFrame.priceEurMwh,
      // Recorded live grid-import ceiling register (P_grid_consumption_limit,
      // reg 2010). Often 0/unset in the dataset — buildLiveLimits self-guards
      // (only >0 overrides), so 0 frames fall back to the configured limit.
      gridImportLimitW: telemetryFrame.gridImportLimitW,
      // Device-reported per-pack usable-energy registers (E_full / E_empty,
      // regs 7018/7016, kWh). Their sum is the live usable capacity (~95 kWh
      // when active) — used to anchor SoC evolution to the device instead of
      // the static BATT_CAPACITY_KWH assumption when present.
      b1Efull: sql<number | null>`(${telemetryFrame.raw}->'batteries'->0->>'energy_full_kwh')::float`,
      b1Eempty: sql<number | null>`(${telemetryFrame.raw}->'batteries'->0->>'energy_empty_kwh')::float`,
      b2Efull: sql<number | null>`(${telemetryFrame.raw}->'batteries'->1->>'energy_full_kwh')::float`,
      b2Eempty: sql<number | null>`(${telemetryFrame.raw}->'batteries'->1->>'energy_empty_kwh')::float`,
      // Per-connector METERED cumulative EV energy counters (lifetime odometer,
      // kWh). p_ev_w is broken (stuck at 0) but e_ev_chg_kwh increments, so
      // differencing it frame-to-frame recovers true per-connector EV power.
      // Extracted as scalars to avoid loading the full `raw` jsonb per frame.
      ev1Cum: sql<number | null>`(SELECT (e->>'e_ev_chg_kwh')::float FROM jsonb_array_elements(${telemetryFrame.raw}->'chargers') e WHERE e->>'unit_id' = '1' LIMIT 1)`,
      ev2Cum: sql<number | null>`(SELECT (e->>'e_ev_chg_kwh')::float FROM jsonb_array_elements(${telemetryFrame.raw}->'chargers') e WHERE e->>'unit_id' = '2' LIMIT 1)`,
      // Per-connector acceptance ceiling = LEAST(p_ev_max_w, p_cp_max_w). LEAST
      // ignores NULLs (returns the smaller present value); p_ev_max_w is 0 when
      // Unplugged so the ceiling is naturally 0 with no car connected.
      ev1AcceptW: sql<number | null>`(SELECT LEAST((e->>'p_ev_max_w')::float, (e->>'p_cp_max_w')::float) FROM jsonb_array_elements(${telemetryFrame.raw}->'chargers') e WHERE e->>'unit_id' = '1' LIMIT 1)`,
      ev2AcceptW: sql<number | null>`(SELECT LEAST((e->>'p_ev_max_w')::float, (e->>'p_cp_max_w')::float) FROM jsonb_array_elements(${telemetryFrame.raw}->'chargers') e WHERE e->>'unit_id' = '2' LIMIT 1)`,
      // Per-connector CAR SoC (soc_ev_pct) and charger-reported time-to-full
      // (t_full_s). Both extracted as scalars to avoid loading full raw jsonb.
      ev1SocCar: sql<number | null>`(SELECT (e->>'soc_ev_pct')::float FROM jsonb_array_elements(${telemetryFrame.raw}->'chargers') e WHERE e->>'unit_id' = '1' LIMIT 1)`,
      ev2SocCar: sql<number | null>`(SELECT (e->>'soc_ev_pct')::float FROM jsonb_array_elements(${telemetryFrame.raw}->'chargers') e WHERE e->>'unit_id' = '2' LIMIT 1)`,
      ev1FullS: sql<number | null>`(SELECT (e->>'t_full_s')::float FROM jsonb_array_elements(${telemetryFrame.raw}->'chargers') e WHERE e->>'unit_id' = '1' LIMIT 1)`,
      ev2FullS: sql<number | null>`(SELECT (e->>'t_full_s')::float FROM jsonb_array_elements(${telemetryFrame.raw}->'chargers') e WHERE e->>'unit_id' = '2' LIMIT 1)`,
    })
    .from(telemetryFrame)
    .where(
      and(
        eq(telemetryFrame.stationId, stationId),
        gte(telemetryFrame.ts, fromTs),
        lte(telemetryFrame.ts, toTs),
      ),
    )
    .orderBy(asc(telemetryFrame.ts))
}

export async function runBacktest(args: {
  stationId: string
  fromTs: Date
  toTs: Date
  paramOverride?: Partial<KernelParams>
  /**
   * Pre-built frames to replay instead of loading from Neon. Used by the live
   * Data Analysis report so the same optimizer engine runs on non-stored days.
   * When omitted, frames are loaded from the telemetry_frame table.
   */
  frames?: BacktestFrameRow[]
  /** Experiment knob; defaults to the legacy power-balance signal. */
  evSource?: EvSource
  /**
   * No-leakage guard. When true (default), the planner may only see prices
   * that would actually have been published at each simulated tick (German DAM
   * clears 12:00 CET, published ~13:00 Europe/Berlin): everything through
   * end-of-today, plus end-of-tomorrow once past 13:00 local. Set false to
   * reproduce the legacy full-month-visibility behavior (optimistic, leaky).
   */
  simulateDamPublishGate?: boolean
  /**
   * Which path produces the per-slot dispatch decision:
   * - "lp" (default): the inline walk-forward LP (solveHorizon). The historical
   *   behavior — Backtest Lab + Data Analysis are unchanged.
   * - "engine": the PRODUCTION decision core (decideDispatch → planHorizon →
   *   commandedGridImport), the exact path live `runOneTick` takes. Powers the
   *   Backtesting harness so the test mirrors live dispatch, not a parallel LP.
   * Either way the decision emits { clearanceKw, reserveSocPct } and the shared
   * BMS physics + cost/KPI machinery downstream is identical.
   */
  decisionSource?: "lp" | "engine"
  /**
   * Editable EV-demand lever for the simulator. The reconstructed historical
   * demand proxy (max(0, batt − grid)) is multiplied by this before it drives
   * BOTH the decision and the BMS physics, so you can stress dispatch against
   * heavier/lighter demand than actually occurred. Defaults to 1 (use history
   * as-is) — leaving every existing caller unchanged.
   */
  demandScaleProxy?: number
  /**
   * Cap on `series` points. Defaults to MAX_SERIES_POINTS (600) — a CHART
   * payload budget. Settlement freezes (rollupStationDay) pass Infinity so the
   * tariff engine integrates every frame: on the sampled series the
   * counterfactual is a ratio estimate (baseline_sample × authImport /
   * import_sample) that inherits ± a few kWh/day of sampling error with a
   * sign that depends on the day; at full resolution importScale ≡ 1 and the
   * day's baseline, as-run dynamic € and battery legs are exact.
   */
  seriesMaxPoints?: number
}): Promise<BacktestResult> {
  const publishGate = args.simulateDamPublishGate ?? true
  const isEngine = (args.decisionSource ?? "lp") === "engine"
  const demandScaleProxy =
    Number.isFinite(args.demandScaleProxy) && (args.demandScaleProxy as number) >= 0
      ? (args.demandScaleProxy as number)
      : 1
  const params = resolveParams(args.paramOverride)

  // Replay injected live frames when provided (Data Analysis report on a
  // non-stored day); otherwise load the window from Neon (Backtest Lab).
  const rows: BacktestFrameRow[] =
    args.frames ?? (await loadFramesFromDb(args.stationId, args.fromTs, args.toTs))

  if (rows.length === 0) {
    throw new Error("No stored frames in the selected range — run a backfill first.")
  }

  // ── EV-demand source selection ─────────────────────────────────────���───────
  // TRUE forward simulation (engine replay): the demand handed to the dispatch
  // engine MUST be exogenous — the cars' real draw — and must NOT be reconstructed
  // from the historical metered grid/battery, or the engine's own decision would
  // be circularly contaminated by the dispatch that actually ran that day. So the
  // engine replay defaults to the METERED EV counters (ev1Cum/ev2Cum deltas =
  // exactly the energy the cars received, independent of any dispatch). The leftover
  // site load becomes `residualBaseloadKw` — a non-dispatchable must-import floor
  // (AUX/hotel; the battery can't offset it), kept faithful but separate.
  //   • The LP backtest (Data Analysis) keeps "powerbalance" for backward-compat.
  //   • A caller can still force either source via `args.evSource`.
  //   • Safety: if a window carries NO EV counters at all, metered demand would be
  //     a flat 0, so we fall back to "powerbalance" rather than simulate a dead site.
  const hasEvCounters = rows.some((r) => r.ev1Cum != null || r.ev2Cum != null)
  const evSource: EvSource =
    args.evSource ?? (isEngine && hasEvCounters ? "metered" : "powerbalance")

  // Build the price curve (slot → €/MWh) from the stored frames.
  const priceBySlot = new Map<number, number>()
  for (const r of rows) {
    if (r.priceEurMwh != null && Number.isFinite(r.priceEurMwh)) {
      priceBySlot.set(slotOf(new Date(r.ts).getTime()), r.priceEurMwh)
    }
  }
  // ── LOOK-AHEAD PAST THE WINDOW END (lossless daily rollups, sep 2 2026) ──
  // The day is now the atomic replay unit (one frozen number per day, same on
  // every page). A curve that ends with the last frame would blind the MPC at
  // 22:00 (2 h horizon, "stop at first gap") and make every day's last hours
  // dispatch worse than live, which sees the published D+1 curve. Extend the
  // curve 36 h past the window from the same DA price the frames carry
  // (station price column: stored frames first, Amperio API at 15-min step
  // when the station has no local frames), then the durable DAM cache for any
  // holes. The publish gate (visibleHorizonMs) still decides what the
  // optimizer may actually see.
  try {
    const lastFrameSlot = rows.length > 0 ? slotOf(new Date(rows[rows.length - 1].ts).getTime()) : null
    if (lastFrameSlot != null) {
      const aheadFromMs = slotStartMs(lastFrameSlot + 1)
      const aheadToMs = slotStartMs(lastFrameSlot + 36 * 4 + 1)
      const stored = await db.execute(sql`
        SELECT floor(extract(epoch FROM ts) / 900)::bigint AS slot, avg(price_eur_mwh) AS p
        FROM telemetry_frame
        WHERE station_id = ${args.stationId}
          AND ts >= ${new Date(aheadFromMs).toISOString()}::timestamptz
          AND ts < ${new Date(aheadToMs).toISOString()}::timestamptz
          AND price_eur_mwh IS NOT NULL
        GROUP BY 1
      `)
      let added = 0
      for (const r of stored.rows as { slot: string | number; p: string | number }[]) {
        const slot = Number(r.slot)
        const p = Number(r.p)
        if (Number.isFinite(p) && !priceBySlot.has(slot)) {
          priceBySlot.set(slot, p)
          added++
        }
      }
      // No local frames ahead (Gronau / past retention) → one cheap API page.
      if (added < 8 && aheadToMs <= Date.now()) {
        try {
          const apiRows = await loadLiveBacktestFrames({
            stationId: args.stationId,
            fromIso: new Date(aheadFromMs).toISOString(),
            toIso: new Date(aheadToMs).toISOString(),
            stepSeconds: 900,
          })
          for (const r of apiRows) {
            const slot = slotOf(new Date(r.ts).getTime())
            if (r.priceEurMwh != null && Number.isFinite(r.priceEurMwh) && !priceBySlot.has(slot)) {
              priceBySlot.set(slot, r.priceEurMwh)
            }
          }
        } catch (apiErr) {
          console.log(`[v0] backtest: API look-ahead failed: ${(apiErr as Error)?.message ?? apiErr}`)
        }
      }
      const ahead = await createNeonPriceStore().getRange(DEFAULT_ZONE, lastFrameSlot + 1, lastFrameSlot + 36 * 4)
      for (const p of ahead) {
        if (Number.isFinite(p.priceEurMwh) && !priceBySlot.has(p.slot)) priceBySlot.set(p.slot, p.priceEurMwh)
      }
    }
  } catch (err) {
    console.log(`[v0] backtest: DA look-ahead load failed (window-only curve): ${(err as Error)?.message ?? err}`)
  }
  const pricedSlots: SlotPrice[] = Array.from(priceBySlot.entries())
    .map(([slot, priceEurMwh]) => ({ slot, priceEurMwh }))
    .sort((a, b) => a.slot - b.slot)

  // ── Hoisted price arrays (PERF) ──────────────────────────────��───────────
  // The optimizer reads the SAME full-window day-price array every frame; only
  // the "current slot index" advances. Rebuilding this array inside the per-
  // frame loop was O(frames × slots) — the quadratic blowup that made a
  // month-long backtest (~170k frames × ~2,880 slots ≈ 500M iterations) time
  // out. pricedSlots is ascending by slot (Map insertion order over ascending
  // frames), so a single monotonic pointer yields currentSlotIdx in amortized
  // O(1) per frame. The array content never changes, so we build it once.
  const dayPrices: number[] = pricedSlots.map((p) => p.priceEurMwh)
  const slotNums: number[] = pricedSlots.map((p) => p.slot)
  let slotIdxPtr = 0

  // Seed simulated SOC from the first frame.
  const first = rows[0]
  let socB1 = first.socPackA ?? first.socAvg ?? 50
  let socB2 = first.socPackB ?? socB1

  // ── Device-grounded usable capacity (regs 7018/7016: E_full + E_empty) ──────
  // The kernel's static BATT_CAPACITY_KWH (280 kWh/pack) is an assumption. The
  // device reports its true usable energy live: E_full (room to full) + E_empty
  // (energy to empty) ≈ the usable capacity. Idle/derated frames collapse this
  // to a few kWh, so we take the MAX of the sane (≥ SANE_MIN) per-pack sums as
  // the nameplate usable capacity — in this dataset that lands at ~95 kWh/pack,
  // i.e. the 280 constant is ~3× too high. Falls back to the constant when the
  // registers are absent (e.g. simulator-sourced frames).
  const SANE_MIN_KWH = 40
  const deriveCap = (pick: (r: (typeof rows)[number]) => number | null): number => {
    let max = 0
    for (const r of rows) {
      const v = pick(r)
      if (v != null && Number.isFinite(v) && v >= SANE_MIN_KWH) max = Math.max(max, v)
    }
    return max > 0 ? max : BATT_CAPACITY_KWH
  }
  const capB1Kwh = deriveCap((r) => (r.b1Efull ?? 0) + (r.b1Eempty ?? 0) || null)
  const capB2Kwh = deriveCap((r) => (r.b2Efull ?? 0) + (r.b2Eempty ?? 0) || null)
  const capAvgKwh = (capB1Kwh + capB2Kwh) / 2

  // v3: No merit-order planning. The kernel handles clearance + reserve per-tick
  // based on price and session energy-to-go. We just need the total capacity for
  // SOC evolution.
  const realTotalCapKwh = capB1Kwh + capB2Kwh

  // ── optimizer engine setup ────────────────────────────────────────────────────
  // When the version runs the LP engine we precompute the demand forecast and
  // init the GLPK solver once. The LP re-solves per 15-min control step (the
  // receding horizon), cached across the ~60 frames inside each slot.
  // SINGLE ENGINE: every version runs the LP. Guard defensively in case a
  // legacy row with a stale engine tag is ever replayed.
  if (params.engine !== "v4-mpc") {
    throw new Error(`Unsupported dispatch engine "${params.engine}" — only the LP optimizer engine remains.`)
  }
  const isV4 = true
  // Defensive fallback only — resolveParams already supplies the v5 block. If a
  // stored row somehow lacks an mpc block, fall back to the single engine's
  // production defaults (v5: adaptive reserve + comfort band on).
  const mpc = params.mpc ?? OPTIMIZER_DEFAULTS
  const fromMs = args.fromTs.getTime()
  const toMs = args.toTs.getTime()
  let v4Glpk: Awaited<ReturnType<typeof getGlpk>> | null = null
  let v4DemandProfile: ReturnType<typeof buildHourlyDemandProfile> | null = null
  // The buffer-energy band uses the optimizer's own usable-energy figure (the
  // metered ~190 kWh), NOT the per-pack register sum, so the LP's E_max matches
  // the published model. SoC% is converted against this same capacity below.
  const v4CapKwh = mpc.usableEnergyKwh
  // Physical emergency floor for the real-time sim (may dip below the LP's
  // planning floor to serve a real car). Falls back to the constant for stored
  // versions created before this param existed.
  const v4EmergencyFloorPct = (mpc.emergencyFloorFrac ?? EMERGENCY_FLOOR_FRAC) * 100
  // Backward-compat: stored versions predate event-driven replanning + IDM.
  const replanMode = mpc.replanMode ?? "every-slot"
  const replanMaxIntervalSlots = mpc.replanMaxIntervalSlots ?? 1
  const idmTriggerEurMwh = mpc.idmTriggerEurMwh ?? Number.POSITIVE_INFINITY
  const idmTriggerPct = mpc.idmTriggerPct ?? Number.POSITIVE_INFINITY
  const useIdmNearTerm = mpc.useIdmNearTerm ?? false
  const evConnectThresholdKw = mpc.evConnectThresholdKw ?? 1.0
  // v5 adaptive (uncertainty-sized) reserve. Off for v4 and stored pre-v5 rows.
  // The coverage/lookahead/cap knobs live on `mpc` and are read by
  // sizeAdaptiveReserveKwh (lib/optimizer/reserve.ts) at solve time.
  const adaptiveReserve = mpc.adaptiveReserve ?? false

  // Live intraday (IDM) curve for v4: slot → €/MWh, read from the durable Neon
  // idm_price cache (warmed by scripts/backfill-idm.ts). Used only for the
  // CURRENT slot at each tick (near-term pricing + replan triggers), so there is
  // no future leakage. Empty when v4 is off, IDM is disabled, or no IDM data has
  // been backfilled yet — in which case v4 transparently behaves as DAM-only.
  const idmBySlot = new Map<number, number>()
  if (isV4 && useIdmNearTerm) {
    try {
      const idmStore = createNeonIdmStore()
      const fromSlot = slotOf(fromMs)
      const toSlot = slotOf(toMs)
      const idmRows = await idmStore.getRange(DEFAULT_ZONE, fromSlot, toSlot)
      for (const row of idmRows) {
        if (Number.isFinite(row.priceEurMwh)) idmBySlot.set(row.slot, row.priceEurMwh)
      }
      console.log(`[v0] backtest: loaded ${idmBySlot.size} IDM slots for the window`)
    } catch (err) {
      console.log(`[v0] backtest: IDM load failed (DAM-only): ${(err as Error)?.message ?? err}`)
    }
  }

  if (isV4) {
    v4Glpk = await getGlpk()
    // Demand forecast from the window's real sessions (per-hour profile).
    const fcSessions = await getChargerSessions({
      stationId: args.stationId,
      fromIso: args.fromTs.toISOString(),
      toIso: args.toTs.toISOString(),
    })
    v4DemandProfile = buildHourlyDemandProfile(fcSessions, fromMs, toMs, mpc.dailyDemandCapKwh)
  }
  // Memoized last LP result, refreshed only when a replan fires (event-driven)
  // or every slot (every-slot mode). Held between replans otherwise.
  let v4ClearanceKw = 0
  let v4ReserveFloorPct = v4EmergencyFloorPct
  let v4InfeasibleSlots = 0
  // Planned grid trajectory from the last solve + the slot it was anchored at.
  // Between replans we FOLLOW g[currentSlot - base] rather than re-applying g[0],
  // so a held plan tracks the optimizer's intended schedule (the receding-horizon
  // step that "should" execute now), not a stale first-step ceiling.
  let v4Schedule: number[] = []
  let v4ScheduleBaseSlot = -1
  let v4FallbackClearanceKw = 0 // used when no prices were visible at solve time
  // Event-driven replanning state + observability counters.
  let v4LastReplanSlot = -1 // slot of the last LP solve (-1 = none yet)
  let v4PrevEvConnected = false // EV-connected state at the previous frame
  let v4Replans = 0
  // GC-nudge bookkeeping: force a GC roughly every this-many replans so native
  // GLPK memory doesn't accumulate across a long window (see lib/gc-nudge.ts).
  let lastGcAtReplans = 0
  let v4SlotChanges = 0 // distinct control slots seen (= every-slot solve count)
  const v4ReplanTriggers = { init: 0, connect: 0, disconnect: 0, session: 0, idm: 0, safety: 0 }
  // EV load (kW) at the last LP solve — drives the mid-slot "session" replan
  // trigger: a car ramps up over its first minutes (connect fires while it draws
  // only a few kW), so the firm clearance snapshotted at connect goes stale and
  // the battery quietly serves the rest. Re-solve when the live draw moves
  // materially from what the last solve planned around.
  let v4LastSolveEvLoadKw = 0
  let v4IdmPricedSlots = 0
  let v4PrevPricedSlot = -1 // last distinct slot seen (for the every-slot baseline)
  let v4LastIdmSlot = -1 // last slot whose realized cost used an IDM price
  // v5 adaptive-reserve observability: average/peak of the applied step-1 floor
  // (% of E_max), so we can see the reserve "breathe" vs v4's flat planning floor.
  let v5ReserveSumPct = 0
  let v5ReserveSolves = 0
  let v5ReserveMaxPct = 0
  // v5 arbitrage stand-down: solves where planned arbitrage was suspended.
  let v5StandDownSolves = 0

  // Accumulators
  let optimizedCostEur = 0
  let actualCostEur = 0
  let actualImportKwh = 0
  let optimizedImportKwh = 0
  let evKwh = 0
  // LEGACY per-frame AUX: Σ max(0, siteLoad − meteredEV)·dt. Kept ONLY for
  // reconciliation against the energy-balance figure (see totals.auxKwh doc);
  // the reported AUX is derived from the window balance after the loop.
  let auxClampedKwh = 0
  // Metered battery + grid-export energy for the window energy balance
  // (raw API signs: battPowerW > 0 = DISCHARGE, gridPowerW > 0 = EXPORT).
  let battChargeKwh = 0
  let battDischargeKwh = 0
  let exportKwh = 0
  // Residual baseload the physics gate refused (exceeded the metered import).
  let auxGatedKwh = 0
  // Savings breakdown buckets. Same realized price + dt integration as the
  // aggregate, just grouped by time bucket. We keep BOTH granularities:
  //   • dailyAcc  (UTC calendar day) → powers the multi-day report + popup.
  //   • hourlyAcc (UTC hour)         → powers the single-day savings popup.
  // Bucketing the exact per-frame steps (not the downsampled `series`) means the
  // rows always sum back to the headline savings KPI.
  type SaveAcc = { actualCostEur: number; optimizedCostEur: number; evKwh: number; frames: number }
  const dailyAcc = new Map<string, SaveAcc>()
  const hourlyAcc = new Map<string, SaveAcc>()
  const bucketInto = (map: Map<string, SaveAcc>, key: string): SaveAcc => {
    let b = map.get(key)
    if (!b) {
      b = { actualCostEur: 0, optimizedCostEur: 0, evKwh: 0, frames: 0 }
      map.set(key, b)
    }
    return b
  }
  const buckets = (ms: number): SaveAcc[] => {
    const iso = new Date(ms).toISOString()
    return [bucketInto(dailyAcc, iso.slice(0, 10)), bucketInto(hourlyAcc, iso.slice(0, 13))]
  }
  let throughputKwh = 0
  const originMs = new Date(first.ts).getTime()
  let exportViolations = 0
  let observedExportFrames = 0
  let emergencyTicks = 0
  let socSum = 0
  let socMin = Number.POSITIVE_INFINITY
  let socMax = Number.NEGATIVE_INFINITY
  let durationHours = 0

  // Per-connector METERED EV: track previous cumulative counter to difference,
  // and running in-window kWh totals. SIMULATED kWh accumulate from (g − b).
  // Each counter also tracks WHEN its previous reading was captured: the delta
  // is energy accumulated over that BACKWARD window, so the power derivation
  // must divide by that same window — not the forward dt_h used for physics
  // integration. Dividing by forward dt compounded a telemetry gap's worth of
  // energy into one 15s frame (live-hit Aug 20: a ~1-min gap before session
  // end showed as a physically impossible 452 kW spike on the session chart).
  let prevEv1Cum: number | null = null
  let prevEv2Cum: number | null = null
  let prevEv1CumMs: number | null = null
  let prevEv2CumMs: number | null = null
  // Slow EMA of the accepted residual baseload (AUX/hotel load, ~0.2 kW here).
  // Used to cap how much of pbEv−meteredEv may be classified as baseload; the
  // excess is EV ramp misalignment and is routed to the EV load instead.
  let residualBaseloadEmaKw = 0.5
  let mEv1Kwh = 0
  let mEv2Kwh = 0
  let sEv1Kwh = 0
  let sEv2Kwh = 0
  // HARD RULE guard: EV is must-serve; any frame where the kernel delivers less
  // than the demanded EV accrues here. Expected to stay 0.
  let evUnservedKwh = 0
  // PER-CONNECTOR "could I serve more?" accounting. We compare the METERED
  // per-connector served energy against that connector's acceptance ceiling, but
  // ONLY accumulate while the car reports a ceiling (>0) — otherwise the
  // comparison is meaningless. `reported` flags whether any ceiling was seen.
  let ev1AcceptableKwh = 0
  let ev2AcceptableKwh = 0
  let ev1ServedAtCeilKwh = 0
  let ev2ServedAtCeilKwh = 0
  let ev1HeadroomKwh = 0
  let ev2HeadroomKwh = 0
  let ev1CeilReported = false
  let ev2CeilReported = false

  const series: BacktestSeriesPoint[] = []
  const seriesMaxPoints =
    Number.isFinite(args.seriesMaxPoints) && (args.seriesMaxPoints as number) > 0
      ? (args.seriesMaxPoints as number)
      : args.seriesMaxPoints === Infinity
        ? Infinity
        : MAX_SERIES_POINTS
  const seriesStride = Math.max(1, Math.floor(rows.length / seriesMaxPoints))

  // ── Production-engine decision path (decisionSource: "engine") ─────────────
  // The forward DA curve as a slot→€/MWh record, the shape planHorizon/
  // decideDispatch expects. Built once; it covers the whole replay window so the
  // The optimizer sees the same forward horizon the LP path does (and truncates at the
  // window edge exactly like live truncates at the published-price edge).
  const priceRecord: Record<string, number> = {}
  if (isEngine) for (const [slot, p] of priceBySlot) priceRecord[String(slot)] = p
  // Held levers between slot-boundary replans (the committed step drives the
  // whole 15-min slot, mirroring live where g[0] holds until the next tick).
  let engineLastSlot = -1
  // EV draw (kW) at the engine's last decideDispatch solve — drives the mid-slot
  // demand-jump re-solve (see the engine path below) for parity with live's tick cadence.
  let engineLastSolveEvKw = 0
  let engineClearanceKw = 0
  // Committed P_grid_request setpoint (gated command) held across the slot, so
  // every frame in the slot reports the same wire command live would have sent.
  let engineCommandKw = 0
  let engineReservePct = 0
  let engineReplans = 0
  // Reserve-guard no-car recharge latch (Rule B), carried across replays exactly
  // like the persisted PlannerState.forcedRechargeActive does live.
  let engineForcedRechargeActive = false
  const commandTrace: EngineCommandTraceEntry[] = []
  // Faithful engine metadata (affects only payload labels, not the decision).
  const engineSiteId = process.env.SITE_ID?.trim() || "site_gronau_01"
  const engineAssetId = process.env.ASSET_ID?.trim() || args.stationId || DEFAULT_STATION_ID

  for (let i = 0; i < rows.length; i++) {
    // MEMORY SAFETY (long windows): the GLPK solver allocates native memory that
    // V8 only frees when each solve's JS wrapper is GC'd. The JS heap stays tiny,
    // so V8 never feels pressure to run a major GC and the native memory piles up
    // until the OS OOM-kills the process. Nudge GC periodically (by replan count,
    // since replans are what allocate) to keep RSS flat. No-op if gc is unavailable.
    if (v4Replans - lastGcAtReplans >= GC_NUDGE_EVERY_REPLANS) {
      lastGcAtReplans = v4Replans
      maybeGc()
    }
    const r = rows[i]
    const tsMs = new Date(r.ts).getTime()
    const currentSlot = slotOf(tsMs)

    // dt from the gap to the next frame (fallback 15s for the last frame).
    const nextMs = i + 1 < rows.length ? new Date(rows[i + 1].ts).getTime() : tsMs + 15_000
    const dt_h = Math.min(Math.max((nextMs - tsMs) / 3_600_000, 0), 1) || 15 / 3600

    // ── EV demand signal (two sources; see EvSource) ──��───────────────────
    // (1) Power-balance reconstruction: max(0, batt − grid). Absorbs aux load.
    const pbEvKw = (deriveEvLoadW(r.gridPowerW, r.battPowerW, r.evLoadW) ?? 0) / 1000
    // SIGNED metered site load (no clamp) — what the grid-first counterfactual
    // serves (see SeriesPoint.siteLoadKw). Same two meters as pbEvKw, minus the
    // rectification.
    const siteLoadKw =
      r.gridPowerW != null || r.battPowerW != null ? ((r.battPowerW ?? 0) - (r.gridPowerW ?? 0)) / 1000 : null
    // (2) Metered per-connector EV from cumulative-counter deltas (true EV).
    // POWER = delta / BACKWARD window (time since the previous counter reading,
    // clamped to ≥1s against clock jitter). The delta IS the energy of that
    // backward window; dividing by the forward dt_h compounded gap energy into
    // one frame (see prevEv*CumMs note above). kWh totals are unaffected —
    // they always accumulated the raw delta.
    let mEv1Kw: number | null = null
    let mEv2Kw: number | null = null
    if (r.ev1Cum != null) {
      if (prevEv1Cum != null && prevEv1CumMs != null) {
        const d = Math.max(0, r.ev1Cum - prevEv1Cum)
        const back_h = Math.max((tsMs - prevEv1CumMs) / 3_600_000, 1 / 3600)
        mEv1Kw = d / back_h
        mEv1Kwh += d
      } else mEv1Kw = 0
      prevEv1Cum = r.ev1Cum
      prevEv1CumMs = tsMs
    }
    if (r.ev2Cum != null) {
      if (prevEv2Cum != null && prevEv2CumMs != null) {
        const d = Math.max(0, r.ev2Cum - prevEv2Cum)
        const back_h = Math.max((tsMs - prevEv2CumMs) / 3_600_000, 1 / 3600)
        mEv2Kw = d / back_h
        mEv2Kwh += d
      } else mEv2Kw = 0
      prevEv2Cum = r.ev2Cum
      prevEv2CumMs = tsMs
    }
    const meteredEvKw = (mEv1Kw ?? 0) + (mEv2Kw ?? 0)

    // The EV signal handed to the kernel, plus any residual baseload that must
    // still be imported (only non-zero in "metered" mode — keeps cost whole).
    // `demandScaleProxy` (1 by default) is the Backtesting harness's editable
    // demand lever — it scales the reconstructed historical EV demand fed to
    // BOTH the decision and the BMS physics, leaving the residual baseload (an
    // uncontrollable must-import) untouched so only the EV scenario changes.
    //
    // CLASSIFICATION GUARD (live-diagnosed, Jul 3 06:33): pbEvKw ����� meteredEvKw
    // mixes two very different things. The genuine AUX/hotel baseload is tiny
    // and slow-varying (~0.2 kW here). But at session ramps the playback proxy
    // and the charger meter can misalign by one frame (proxy sees the car at
    // ~140 kW while the cumulative-energy meter still reads ~48 kW), producing
    // a one-frame 90+ kW "residual". Routing that through baseload forces the
    // physics to GRID-IMPORT it (battery can't serve baseload) — a fake spike
    // above the grid cap at peak price, contradicting clearance=0 and the real
    // meter. The excess over a slow-EMA cap is really EV power the car drew,
    // so it is reattributed to the EV load where the battery may serve it —
    // exactly what the real BMS did (actual metered import stayed ~0.4 kW).
    const rawResidualKw = evSource === "metered" ? Math.max(0, pbEvKw - meteredEvKw) : 0
    const baseloadCapKw = Math.max(1, residualBaseloadEmaKw * 3)
    const emaCappedResidualKw = Math.min(rawResidualKw, baseloadCapKw)
    const evRampMisalignKw = rawResidualKw - emaCappedResidualKw
    // PHYSICS GATE (Norderstedt audit, sep 3 2026). The residual is, by
    // definition, NON-DISPATCHABLE GRID DRAW (live-tested: P_grid_request = 0
    // does not zero it; the battery cannot serve it). A grid-only load can
    // therefore never exceed what the grid meter imported in the SAME frame.
    // Whenever the power balance says "baseload X" while the grid meter shows
    // import < X, the excess is battery-meter phantom (Norderstedt: 927 frames
    // with batt charge > site import, net discharge 149 kWh against a −16 kWh
    // SOC move), not load — and it must not become a must-import floor that the
    // grid-first counterfactual buys at the slot price (baseKw in
    // tariff-compute) while as-run never paid for it. The excess is DROPPED,
    // not re-attributed to EV: the EMA cap above already separated genuine
    // session-ramp misalignment (car really drawing, meter lagging), and a
    // phantom re-routed to EV would be imported by the baseline all the same.
    //
    // VERIFIED INERT (sep 3 2026, full re-freeze Jul 30 – Sep 2, all 3 sites):
    // auxGatedKwh = 0.0 everywhere and no € moved. Reason: the phantom frames
    // have batt charge > import, so the power-balance load is NEGATIVE and the
    // max(0, ·) in pbEvKw already zeroes them before they reach this line. The
    // counterfactual was therefore never exposed; the "~€40/month Norderstedt
    // overstatement" hypothesis is DISPROVEN. This gate is kept as a stated
    // invariant (residual ≤ metered import), not as a fix.
    const meteredImportKwNow = r.gridPowerW != null ? Math.max(0, -r.gridPowerW) / 1000 : null
    const residualBaseloadKw =
      meteredImportKwNow != null ? Math.min(emaCappedResidualKw, meteredImportKwNow) : emaCappedResidualKw
    auxGatedKwh += (emaCappedResidualKw - residualBaseloadKw) * dt_h
    residualBaseloadEmaKw = residualBaseloadEmaKw * 0.98 + residualBaseloadKw * 0.02
    const evLoadKw =
      ((evSource === "metered" ? meteredEvKw : pbEvKw) + evRampMisalignKw) * demandScaleProxy

    const price = priceBySlot.get(currentSlot) ?? null

    // Detect observed export in the raw meter (grid frame: positive = export).
    if (r.gridPowerW != null && r.gridPowerW > 1) observedExportFrames++

    // Replan when the slot changes (seeded with simulated SOC).
    // v3: We no longer use merit-order planning. The clearance + reserve are
    // computed per-tick by decideTick based on price and session energy-to-go.
    const avgSoc = (socB1 + socB2) / 2
    // Weakest simulated string — same risk input the live engine now feeds the
    // planner/guard, so replay and live can't diverge on imbalance handling.
    const minSoc = Math.min(socB1, socB2)

    // Advance the monotonic pointer to count priced slots strictly before the
    // current slot (currentSlot is non-decreasing across frames). Amortized
    // O(1); replaces the old O(slots) per-frame array rebuild. `dayPrices` and
    // `slotNums` are hoisted above the loop (their content never changes).
    while (slotIdxPtr < slotNums.length && slotNums[slotIdxPtr] < currentSlot) slotIdxPtr++
    const currentSlotIdx = slotIdxPtr

    // The SITE-WIDE applicable grid ceiling for this frame: the configured
    // param bounded by the REAL-power cap (~83.5 kW; the 87 is kVA at PF≈0.96,
    // live-measured plateau 83.0–83.5 during a ~190 kW session — same rule as
    // live dispatch-engine). The recorded register (r.gridImportLimitW,
    // reg 2010) is deliberately IGNORED: it echoes the clearance the dispatcher
    // itself commanded, so historical frames carry the old self-ratcheted
    // 79 kW derate. Total import (controllable+baseload) must stay under this;
    // the kernel is handed this minus baseload below.
    const siteGridLimitKw = Math.min(
      params.gridImportLimitKw,
      params.gridRealPowerCapKw ?? GRID_REAL_POWER_CAP_KW,
    )

    // ── DECISION: engine-specific clearance + reserve floor ──────────────────
    // Both engines emit the SAME two outputs the BMS sim below consumes:
    //   • clearanceKw    — the grid import ceiling for this frame
    //   • reserveSocPct  — the SoC floor the battery won't discharge below
    // so the entire downstream simulation/cost/KPI machinery is shared.
    let decision: { clearanceKw: number; reserveSocPct: number }

    if (isEngine) {
      // ── PRODUCTION ENGINE PATH ───────────────────────────────────────────
      // Drive the EXACT live decision core (decideDispatch → planHorizon →
      // commandedGridImport) once per slot boundary — PLUS whenever the live EV
      // draw has moved materially since the last solve. Live re-solves every
      // ~15 s tick, so it reacts to a mid-slot car connect/ramp within seconds;
      // a slot-boundary-only replay instead freezes the pre-connect committed
      // step (planned around forecast demand ≈ 0) for up to 15 minutes, letting
      // the battery serve the car even in negative-price slots. The demand-jump
      // re-solve restores parity with live's reaction cadence.
      const engineEvMoved = Math.abs(evLoadKw - engineLastSolveEvKw) >= V4_SESSION_DEMAND_JUMP_KW
      if (currentSlot !== engineLastSlot || engineEvMoved) {
        engineLastSlot = currentSlot
        engineLastSolveEvKw = evLoadKw
        engineReplans++
        // Same single-parameter rule as live dispatch-engine: the real-power
        // planning cap, never the echoed register (see siteGridLimitKw above).
        const gridLimitKw = siteGridLimitKw
        const dec = await decideDispatch({
          stationId: args.stationId,
          siteId: engineSiteId,
          assetId: engineAssetId,
          currentSlot,
          timestampMs: tsMs,
          commandValidMs: SLOT_MS,
          avgSocPct: avgSoc,
          minSocPct: minSoc,
          // Live demand → committed step: the scaled historical proxy is what
          // the cars are "drawing" this slot in the simulated world.
          trueDemandKw: evLoadKw,
          gridLimitKw,
          priceBySlot: priceRecord,
          chargerUnitIds: [1, 2],
          mpc,
          // The reserve guard is NOT applied at this slot-boundary solve — it runs
          // EVERY frame below so a mid-slot car connect is caught immediately,
          // matching live's ~15 s replan cadence.
          applyReserveGuardInline: false,
        })
        // Feed the RAW planned grid draw g[0] (not the wire setpoint, which is 0
        // whenever we aren't charging the battery from grid) into the physics as
        // the grid-serve ceiling. This matches the LP backtest path (which tracks
        // the raw g[t] schedule) and the real device, whose clearance ENVELOPE is
        // the full import cap: in cheap slots the grid serves the cars and the
        // battery is spared; in expensive slots g[0]→0 and the battery discharges.
        engineClearanceKw = dec.plannedGridKw
        // The gated wire command (P_grid_request): 0 unless charging the battery
        // from grid above demand. Same value the live worker commits each tick.
        engineCommandKw = dec.commandKw != null && Number.isFinite(dec.commandKw) ? Math.max(0, dec.commandKw) : 0
        engineReservePct = dec.decision.reserveSocPct
        commandTrace.push({
          ts: new Date(tsMs).toISOString(),
          hour: (tsMs - originMs) / 3_600_000,
          slot: currentSlot,
          socPct: round(avgSoc, 1),
          priceEurMwh: price != null ? round(price, 2) : null,
          demandKw: round(evLoadKw, 2),
          clearanceKw: round(engineClearanceKw, 2),
          reserveFloorPct: round(engineReservePct, 1),
          socCeilingPct: round(dec.socCeilingPct, 1),
          commandKw: dec.commandKw != null ? round(dec.commandKw, 2) : null,
          mpcOk: dec.mpcOk,
          solveStatus: dec.solveStatus,
        })
      }
      decision = { clearanceKw: engineClearanceKw, reserveSocPct: engineReservePct }

      // ── REAL-TIME RESERVE GUARD — evaluated EVERY frame ──────────────────────
      // The engine re-solves at slot boundaries and on material demand jumps, but
      // live replans ~every 15 s, so the price-independent SOC guardrails must
      // still react per-frame here (a fast SOC drop between solves is caught
      // immediately, not up to 15 min late). Shared rule with the live engine
      // (lib/optimizer/reserve-guard.ts); it only ever RAISES the grid-import ceiling that
      // drives the BMS physics below.
      const fg = applyReserveGuard({
        // Weakest simulated string — mirrors the live decide path's guard input.
        avgSocPct: minSoc,
        carConnected: evLoadKw > evConnectThresholdKw,
        gridCapKw: siteGridLimitKw,
        currentClearanceKw: decision.clearanceKw,
        forcedRechargeActive: engineForcedRechargeActive,
      })
      engineForcedRechargeActive = fg.forcedRechargeActive
      if (fg.engaged) decision = { clearanceKw: fg.clearanceKw, reserveSocPct: decision.reserveSocPct }
    } else if (isV4 && v4Glpk && v4DemandProfile) {
      const slotChanged = currentSlot !== v4LastReplanSlot
      // Count distinct control slots seen = the solve count the classic
      // "every-slot" policy would have incurred (baseline for "solves saved").
      if (currentSlot !== v4PrevPricedSlot) {
        v4SlotChanges++
        v4PrevPricedSlot = currentSlot
      }

      // Live EV-connected state from the telemetry feed (evaluated every frame
      // so a connect/disconnect is caught the instant it happens, mid-slot).
      const evConnected = evLoadKw > evConnectThresholdKw

      // ── REPLAN TRIGGER: should this tick re-solve the LP? ─────────────────
      // event-driven (default): only on a relevant event — car connect/
      // disconnect, intraday price diverging from day-ahead — plus a safety
      // re-solve at most every `replanMaxIntervalSlots`. every-slot: classic
      // re-solve on every new control slot (reproduces the classic every-slot policy).
      let replanReason: keyof typeof v4ReplanTriggers | null = null
      if (v4LastReplanSlot < 0) {
        replanReason = "init" // always solve on the very first frame
      } else if (replanMode === "every-slot") {
        if (slotChanged) replanReason = "safety"
      } else {
        if (evConnected !== v4PrevEvConnected) {
          replanReason = evConnected ? "connect" : "disconnect"
        } else if (
          evConnected &&
          Math.abs(evLoadKw - v4LastSolveEvLoadKw) >= V4_SESSION_DEMAND_JUMP_KW
        ) {
          // Mid-slot SESSION trigger: the car's draw moved materially since the
          // last solve. Cars ramp up over their first minutes, so the connect
          // replan often fires while the car pulls only a few kW — freezing a
          // tiny firm clearance for the whole session while the battery covers
          // the real draw (even in negative-price slots). Also catches taper-down.
          replanReason = "session"
        } else if (slotChanged) {
          if (evConnected) {
            // SESSION slot roll: while a car is on-site, re-solve every control
            // slot. Held slots otherwise follow g[k] from a plan whose demand
            // vector was the P90 forecast (~0 for a surprise session), so the
            // commanded import collapses and the battery serves the car
            // regardless of price. Sessions are short — a few extra solves.
            replanReason = "session"
          } else {
            // Slot-scoped triggers, evaluated once per new slot.
            const dam = priceBySlot.get(currentSlot)
            const idm = idmBySlot.get(currentSlot)
            const dev = dam != null && idm != null ? Math.abs(idm - dam) : 0
            const diverged =
              dam != null &&
              idm != null &&
              (dev >= idmTriggerEurMwh || dev >= idmTriggerPct * Math.abs(dam))
            if (diverged) replanReason = "idm"
            else if (currentSlot - v4LastReplanSlot >= replanMaxIntervalSlots) replanReason = "safety"
          }
        }
      }
      v4PrevEvConnected = evConnected

      // Re-solve the LP only when a replan is triggered (receding horizon).
      if (replanReason) {
        v4LastReplanSlot = currentSlot
        v4Replans++
        v4ReplanTriggers[replanReason]++
        // Anchor the mid-slot session trigger to the demand this solve saw.
        v4LastSolveEvLoadKw = evLoadKw
        // Forward DA price curve from this slot to the horizon end, honoring the
        // same publish gate as v3 (no look-ahead beyond what would be published).
        const horizonEndMs = publishGate ? visibleHorizonMs(tsMs) : Number.POSITIVE_INFINITY
        const pricesEurMwh: number[] = []
        const demandKw: number[] = []
        const demandHiKw: number[] = [] // P90 demand per step (v5 reserve sizing)
        // v5.1 DYNAMIC HORIZON: shrink the lookahead as SOC drops so a low pack
        // acts on the nearest cheap slot rather than holding out for a distant
        // trough. Capped at the static horizon; full length at high SOC. Mirrors
        // the live path (planHorizon) for replay parity.
        const effHorizonSteps = dynamicHorizonSteps(avgSoc / 100, mpc, mpc.horizonSteps)
        for (let h = 0; h < effHorizonSteps; h++) {
          const stepMs = slotStartMs(currentSlot + h)
          if (stepMs >= horizonEndMs) break
          const p = priceBySlot.get(currentSlot + h)
          if (p == null || !Number.isFinite(p)) break // stop at first gap
          pricesEurMwh.push(p)
          demandKw.push(demandKwAt(v4DemandProfile, stepMs))
          demandHiKw.push(demandHiKwAt(v4DemandProfile, stepMs))
        }
        // Inject the LIVE on-site EV draw into the COMMITTED step (mirrors
        // planHorizon 2b). The vectors above are the P90 session forecast, which
        // says ~0 for a surprise session — without this the LP "sees" no car,
        // plans g[0]≈aux, and only the post-hoc firm commit knows the truth. With
        // it, the LP itself weighs serving the real car from grid vs battery at
        // this slot's price. Future steps stay on the forecast (receding horizon).
        if (evConnected && evLoadKw > 0 && demandKw.length > 0) {
          demandKw[0] = Math.max(demandKw[0], evLoadKw)
          if (demandHiKw.length > 0) demandHiKw[0] = Math.max(demandHiKw[0], evLoadKw)
        }
        // v5: size a per-step reserve floor from the demand-forecast uncertainty.
        // reserveFloorKwh[i] is the floor for E[i+1] (start of step i+1): a small
        // base floor PLUS the energy the P90 demand would draw beyond the mean
        // across the next `reserveLookaheadH`, clamped to [base, reserveMaxFrac].
        let reserveFloorKwh: number[] | undefined
        if (adaptiveReserve && pricesEurMwh.length >= 1) {
          // Shared helper (see lib/optimizer/reserve.ts) — identical math used by the
          // live engine. Demand arrays are sliced to the visible price horizon.
          const sized = sizeAdaptiveReserveKwh({
            capacityKwh: v4CapKwh,
            demandKw,
            demandHiKw,
            mpc,
          })
          reserveFloorKwh = sized.reserveFloorKwh
          // Observability: record the applied step-1 floor as % of E_max.
          const pct = sized.step1FloorPct
          v5ReserveSumPct += pct
          v5ReserveSolves++
          if (pct > v5ReserveMaxPct) v5ReserveMaxPct = pct
        }
        if (pricesEurMwh.length >= 1) {
          // Buffer energy from the simulated SoC against the optimizer's E_max.
          const energyKwh = (avgSoc / 100) * v4CapKwh
          // Controllable grid headroom = site ceiling − uncontrollable baseload.
          const headroomKw = Math.max(0, siteGridLimitKw - residualBaseloadKw)
          // Daily self-consumption cap: the forecast car demand (Sec 0b).
          const dailyCapKwh = v4DemandProfile.dailyKwh > 0 ? v4DemandProfile.dailyKwh : mpc.dailyDemandCapKwh
          // v5 arbitrage stand-down: in a low/very-risky scenario, suspend planned
          // arbitrage discharge (cap → 0) so the plan just covers demand from the
          // grid and holds/refills the pack. Same shared decision as the live engine.
          const standDown = decideStandDown({
            capacityKwh: v4CapKwh,
            energyKwh,
            demandHiKw,
            headroomKw,
            mpc,
          })
          if (standDown.standDown) v5StandDownSolves++
          const res = await solveHorizon({
            glpk: v4Glpk,
            energyKwh,
            capacityKwh: v4CapKwh,
            pricesEurMwh,
            demandKw,
            headroomKw,
            dailyCapKwh: standDown.standDown ? 0 : dailyCapKwh,
            reserveFloorKwh,
            mpc,
          })
          if (res.status !== "optimal") v4InfeasibleSlots++

          // v5.1 FIRM COMMITTED ACTION (mirrors planHorizon). The LP commits only
          // g[0]; because "now" is rarely the global optimum, g[0] is often 0 even
          // when the firm intent is obvious (cheap slot + car plugged in, or low
          // pack + cheap now). Run the risk-aware buy-now test on the visible
          // curve, then override ONLY the committed clearance — the rest of the
          // planned schedule (held slots follow g[k]) is left as solved.
          const buy = decideBuyNow(pricesEurMwh, avgSoc / 100, mpc)
          // No horizon arbitrage spread beats the cycling cost ⇒ serving a car
          // from the battery loses money vs grid import (mirrors planHorizon).
          const arb = arbitrageWorthIt(pricesEurMwh, mpc)
          const firm = applyFirmCommit({
            lpClearanceKw: res.clearanceKw,
            demandKw: evLoadKw, // the cars actually on-site this slot
            auxKw: residualBaseloadKw,
            headroomKw,
            socFrac: avgSoc / 100,
            evConnected,
            buyNow: buy.buyNow,
            cheapNow: buy.cheapNow,
            materialCheaperAhead: buy.materialCheaperAhead,
            arbitrageWorthIt: arb.worthIt,
            mpc,
          })
          v4ClearanceKw = firm.clearanceKw
          // Store the full planned trajectory so held slots can follow g[k]; the
          // committed step (now) carries the firm-adjusted clearance.
          v4Schedule = res.gridScheduleKw
          if (v4Schedule.length > 0) v4Schedule[0] = firm.clearanceKw
          v4ScheduleBaseSlot = currentSlot
          v4FallbackClearanceKw = firm.clearanceKw
          // Sim discharge floor = physical emergency floor (reserve is tappable
          // for real cars); the LP itself planned against the higher socFloorFrac.
          v4ReserveFloorPct = v4EmergencyFloorPct
        } else {
          // No visible prices → safe fallback: allow full import (protect EV).
          v4ClearanceKw = Math.max(0, siteGridLimitKw - residualBaseloadKw)
          v4Schedule = []
          v4ScheduleBaseSlot = currentSlot
          v4FallbackClearanceKw = v4ClearanceKw
          v4ReserveFloorPct = v4EmergencyFloorPct
        }
      }
      // Follow the planned trajectory: on a held slot, apply the step the plan
      // intended for *now* (g[currentSlot − base]); clamp past the plan's end.
      const planIdx = v4ScheduleBaseSlot >= 0 ? currentSlot - v4ScheduleBaseSlot : 0
      const appliedClearanceKw =
        v4Schedule.length > 0
          ? v4Schedule[Math.min(Math.max(planIdx, 0), v4Schedule.length - 1)]
          : v4FallbackClearanceKw
      decision = { clearanceKw: appliedClearanceKw, reserveSocPct: v4ReserveFloorPct }
    } else {
      // Single engine: the LP optimizer is the only dispatch path. We only reach here if
      // the GLPK solver or demand forecast failed to initialise.
      throw new Error("Backtest optimizer engine not initialised (GLPK / demand forecast unavailable)")
    }

    // ════════════════════════════════════════════════════���════════════════════
    // AUTOMATIC-MODE BMS SIMULATION
    // ═════════════════════════════════════════════════════════════════════════
    // The station operates in automatic mode with P_grid_clearance. It decides:
    //   • If EV demand ≤ clearance: grid serves EV, remaining headroom charges battery
    //   • If EV demand > clearance: grid provides clearance, battery covers the gap
    // The reserve floor is respected: battery won't discharge below it.
    //
    // Resolve the automatic-mode BMS frame via the SHARED physics (lib/bms-sim).
    // The walk-forward dispatch simulator drives the exact same function, so the
    // backtest and the test harness can never diverge on physics.
    const bms = simulateAutomaticModeStep({
      clearanceKw: decision.clearanceKw,
      reserveSocPct: decision.reserveSocPct,
      evLoadKw,
      socPct: avgSoc,
      siteGridLimitKw,
      baseloadKw: residualBaseloadKw,
      dtHours: dt_h,
      capacityKwh: capB1Kwh + capB2Kwh,
      battMaxPowerKw: params.battMaxPowerKw ?? 240,
      socTradingHighPct: SOC_TRADING_HIGH,
    })

    const gridKw = bms.gridKw
    const battKw = bms.battKw // positive = charging, negative = discharging
    const evServedKw = bms.evServedKw
    const evCurtailedKw = bms.evCurtailedKw

    // No-export clamp is counted as a violation by the harness.
    if (bms.exportClamped) exportViolations++

    // Track curtailment.
    if (evCurtailedKw > 0.01) {
      evUnservedKwh += evCurtailedKw * dt_h
      emergencyTicks++
    }

    // ��─ PER-CONNECTOR "max possible charging" this frame ──────────────────
    // The raw register min(p_ev_max_w, p_cp_max_w) is a STATIC handshake
    // maximum, not live acceptance — live-audited Jul 23 2026: it read a flat
    // 250 kW for an entire session while served power tapered 169→106 kW as
    // the car's SOC climbed 18→54% (the car's own CC/CV curve). Billing that
    // gap as "could have delivered more" is fiction: the dispatcher never
    // curtails EV (EV-first policy), so the car takes what it takes.
    //
    // Honest ceiling = min(car register, SITE deliverable), where deliverable
    // this frame = grid headroom (site limit − non-EV baseload) + SOC-limited
    // battery discharge capability. And HEADROOM (energy we actually failed
    // to deliver) accrues ONLY in site-limited frames — served pinned at the
    // site's own ceiling while the car asked for more. In car-limited frames
    // (site had spare capacity, car tapered) headroom is zero by definition.
    const battAvailDischargeKw = Math.min(
      params.battMaxPowerKw ?? 240,
      Math.max(0, ((avgSoc - decision.reserveSocPct) / 100) * (capB1Kwh + capB2Kwh)) / dt_h,
    )
    const siteEvCapKw = Math.max(0, siteGridLimitKw - residualBaseloadKw) + battAvailDischargeKw
    const SITE_LIMIT_TOL_KW = 2
    const ev1AcceptRawKw = r.ev1AcceptW != null ? r.ev1AcceptW / 1000 : null
    const ev2AcceptRawKw = r.ev2AcceptW != null ? r.ev2AcceptW / 1000 : null
    const ev1AcceptKw = ev1AcceptRawKw != null ? Math.min(ev1AcceptRawKw, siteEvCapKw) : null
    const ev2AcceptKw = ev2AcceptRawKw != null ? Math.min(ev2AcceptRawKw, siteEvCapKw) : null
    if (ev1AcceptKw != null && ev1AcceptKw > 0.01) {
      ev1CeilReported = true
      const served1 = Math.max(0, mEv1Kw ?? 0)
      ev1AcceptableKwh += ev1AcceptKw * dt_h
      ev1ServedAtCeilKwh += Math.min(served1, ev1AcceptKw) * dt_h
      // Site-limited: served is pinned at the deliverable ceiling while the
      // car's register asked for more — that deficit is real missed delivery.
      if (served1 >= siteEvCapKw - SITE_LIMIT_TOL_KW && (ev1AcceptRawKw ?? 0) > served1) {
        ev1HeadroomKwh += Math.max(0, (ev1AcceptRawKw ?? 0) - served1) * dt_h
      }
    }
    if (ev2AcceptKw != null && ev2AcceptKw > 0.01) {
      ev2CeilReported = true
      const served2 = Math.max(0, mEv2Kw ?? 0)
      ev2AcceptableKwh += ev2AcceptKw * dt_h
      ev2ServedAtCeilKwh += Math.min(served2, ev2AcceptKw) * dt_h
      if (served2 >= siteEvCapKw - SITE_LIMIT_TOL_KW && (ev2AcceptRawKw ?? 0) > served2) {
        ev2HeadroomKwh += Math.max(0, (ev2AcceptRawKw ?? 0) - served2) * dt_h
      }
    }

    // Actual metered grid power. Stored convention: positive = export,
    // negative = import. Flip so positive = import (matches optimized gridKw)
    // so the two curves are directly comparable.
    const actualGridKw = -((r.gridPowerW ?? 0) / 1000)

    // Costs (€): money spent importing minus money earned exporting, valued at
    // the slot price. Optimized = what the kernel would have commanded; actual
    // = what the real meter recorded. Savings = actual − optimized.
    //
    // REALIZED price: for v4 with near-term IDM enabled, the CURRENT slot is the
    // committed/tradeable step, so its realized cost settles at the live intraday
    // price when available (the rest of the horizon was still PLANNED on DAM).
    // Both optimized and actual use the same realized price, keeping savings an
    // apples-to-apples delta. v1–v3 always use the DAM price (idmBySlot empty).
    const idmNow = isV4 && useIdmNearTerm ? idmBySlot.get(currentSlot) : undefined
    const realizedPrice = idmNow ?? price
    if (idmNow != null && currentSlot !== v4LastIdmSlot) {
      v4IdmPricedSlots++
      v4LastIdmSlot = currentSlot
    }
    const acc = buckets(tsMs)
    for (const b of acc) b.frames++
    if (realizedPrice != null) {
      const optStep = (gridKw * dt_h * realizedPrice) / 1000
      const actStep = (actualGridKw * dt_h * realizedPrice) / 1000
      optimizedCostEur += optStep
      actualCostEur += actStep
      for (const b of acc) {
        b.optimizedCostEur += optStep
        b.actualCostEur += actStep
      }
    }

    // Integrate imported / delivered energy (kWh) for the totals readout.
    if (actualGridKw > 0) actualImportKwh += actualGridKw * dt_h
    if (gridKw > 0) optimizedImportKwh += gridKw * dt_h
    if (evLoadKw > 0) {
      evKwh += evLoadKw * dt_h
      for (const b of acc) b.evKwh += evLoadKw * dt_h
    }
    // LEGACY per-frame AUX (reconciliation only — see totals.auxKwh): the
    // power-balance load (max(0, batt−grid) = pbEvKw) the metered EV connectors
    // do NOT account for, clamped at 0 per frame.
    const auxKw = Math.max(0, pbEvKw - meteredEvKw)
    if (auxKw > 0) auxClampedKwh += auxKw * dt_h
    // Window ENERGY BALANCE inputs — the raw meters, unclamped, so the frames
    // where the battery meter shows charge > site import (impossible without
    // PV; Norderstedt Aug 2026: 927 frames / 121 kWh) offset the frames where
    // it shows the opposite, instead of being silently dropped.
    if (r.battPowerW != null) {
      if (r.battPowerW > 0) battDischargeKwh += (r.battPowerW / 1000) * dt_h
      else battChargeKwh += (-r.battPowerW / 1000) * dt_h
    }
    if (r.gridPowerW != null && r.gridPowerW > 0) exportKwh += (r.gridPowerW / 1000) * dt_h

    // ─�� Two-pack / two-connector decomposition ──��──────────────────��──────
    // Single-mode coupling: pack 1 ↔ connector C1, pack 2 ↔ connector C2.
    // Demand share for THIS frame comes from the metered per-connector EV shape
    // (mEv1Kw / mEv2Kw); when neither connector is drawing (or counters are
    // absent) we fall back to an even 50/50 split.
    const dem1 = Math.max(0, mEv1Kw ?? 0)
    const dem2 = Math.max(0, mEv2Kw ?? 0)
    const demTot = dem1 + dem2
    const f1 = demTot > 0.01 ? dem1 / demTot : 0.5
    const f2 = demTot > 0.01 ? dem2 / demTot : 0.5

    // Battery power per pack — DUAL MODE. The real hardware runs BOTH packs in
    // parallel for any session (it never couples one pack to a single
    // connector), and the balancing BMS pushes the packs toward equal SoC. We
    // model that by splitting the station battery power so the packs CONVERGE:
    // on DISCHARGE (battKw < 0) the fuller pack carries more (weight by stored
    // energy above empty); on CHARGE (battKw > 0) the emptier pack takes more
    // (weight by headroom below full). This is independent of which connector
    // is active, so a single-car session no longer drains just one pack. The
    // split always preserves b1Kw + b2Kw === battKw, so the aggregate SoC
    // trajectory and every KPI derived from it are unchanged.
    let b1Kw: number
    let b2Kw: number
    if (battKw < 0) {
      const a1 = Math.max(0, socB1)
      const a2 = Math.max(0, socB2)
      const aw = a1 + a2
      const w1 = aw > 0.01 ? a1 / aw : 0.5
      b1Kw = battKw * w1
      b2Kw = battKw * (1 - w1)
    } else {
      const h1 = Math.max(0, 100 - socB1)
      const h2 = Math.max(0, 100 - socB2)
      const hw = h1 + h2
      const w1 = hw > 0.01 ? h1 / hw : 0.5
      b1Kw = battKw * w1
      b2Kw = battKw * (1 - w1)
    }
    socB1 = clampSoc(socB1 + (b1Kw * dt_h * 100) / capB1Kwh)
    socB2 = clampSoc(socB2 + (b2Kw * dt_h * 100) / capB2Kwh)

    // Simulated per-connector EV delivered + grid import, split by the same
    // demand share (sum preserved). evServed_i = g_i − b_i holds per the
    // documented per-unit energy balance.
    const ev1Kw = evServedKw * f1
    const ev2Kw = evServedKw * f2
    const g1Kw = gridKw * f1
    const g2Kw = gridKw * f2
    sEv1Kwh += ev1Kw * dt_h
    sEv2Kwh += ev2Kw * dt_h

    throughputKwh += Math.abs(battKw) * dt_h
    // emergencyTicks already incremented above when evCurtailedKw > 0
    durationHours += dt_h

    const simAvgSoc = (socB1 + socB2) / 2
    socSum += simAvgSoc
    if (simAvgSoc < socMin) socMin = simAvgSoc
    if (simAvgSoc > socMax) socMax = simAvgSoc

    if (i % seriesStride === 0 || i === rows.length - 1) {
      series.push({
        ts: new Date(r.ts).toISOString(),
        hour: (tsMs - originMs) / 3_600_000,
        socPct: round(simAvgSoc, 2),
        b1SocPct: round(socB1, 2),
        b2SocPct: round(socB2, 2),
        actualB1SocPct: r.socPackA != null ? round(r.socPackA, 2) : null,
        actualB2SocPct: r.socPackB != null ? round(r.socPackB, 2) : null,
        gridKw: round(gridKw, 2),
        // Gated wire command (engine mode only) — what live actually sends.
        commandedGridKw: isEngine ? round(engineCommandKw, 2) : null,
        actualGridKw: round(actualGridKw, 2),
        battKw: round(battKw, 2),
        evKw: round(evLoadKw, 2),
        // Served-vs-Requested verification: requested = the demand fed in;
        // served = what the shared BMS physics actually delivered. Equal unless
        // physical curtailment (the always-serve invariant made visible).
        evRequestedKw: round(evLoadKw, 2),
        evServedKw: round(evServedKw, 2),
        priceEurMwh: price != null ? round(price, 2) : null,
        // Per-connector decomposition (demand-weighted): grid, battery and EV
        // served split by each connector's metered demand share so a
        // single-connector session shows on its own pack/connector only.
        g1Kw: round(g1Kw, 2),
        g2Kw: round(g2Kw, 2),
        b1Kw: round(b1Kw, 2),
        b2Kw: round(b2Kw, 2),
        ev1Kw: round(ev1Kw, 2),
        ev2Kw: round(ev2Kw, 2),
        // Metered per-connector EV (ground truth) + cumulative comparison.
        mEv1Kw: mEv1Kw != null ? round(mEv1Kw, 2) : null,
        mEv2Kw: mEv2Kw != null ? round(mEv2Kw, 2) : null,
        mEv1Kwh: round(mEv1Kwh, 2),
        mEv2Kwh: round(mEv2Kwh, 2),
        sEv1Kwh: round(sEv1Kwh, 2),
        sEv2Kwh: round(sEv2Kwh, 2),
        // Per-connector acceptance ceiling (null when the car reports no limit,
        // so the chart hides the line for that connector), car SoC %, and the
        // charger's own time-to-full ETA (seconds).
        ev1AcceptKw: ev1AcceptKw != null ? round(ev1AcceptKw, 2) : null,
        ev2AcceptKw: ev2AcceptKw != null ? round(ev2AcceptKw, 2) : null,
        // Guard against the 0xFFFF (65535) "not available" SoC sentinel and any
        // out-of-range value — only 0–100 % is a real reading.
        ev1SocCarPct: validSocPct(r.ev1SocCar),
        ev2SocCarPct: validSocPct(r.ev2SocCar),
        ev1FullS: r.ev1FullS != null && r.ev1FullS > 0 ? r.ev1FullS : null,
        ev2FullS: r.ev2FullS != null && r.ev2FullS > 0 ? r.ev2FullS : null,
        // Grid-limit diagnostics: the site ceiling that applied this frame and
        // the uncontrollable baseload included in gridKw. A frame is compliant
        // when gridKw ≤ siteGridLimitKw (the kernel guarantees controllable ≤
        // siteGridLimitKw − baseload, so any residual overshoot is baseload the
        // controller physically cannot shed).
        siteGridLimitKw: round(siteGridLimitKw, 2),
        baseloadKw: round(residualBaseloadKw, 2),
        siteLoadKw: siteLoadKw != null ? round(siteLoadKw, 3) : null,
      })
    }
  }

  const savingsEur = actualCostEur - optimizedCostEur

  const kpis: BacktestKpis = {
    frames: rows.length,
    durationHours: round(durationHours, 2),
    optimizedCostEur: round(optimizedCostEur, 2),
    actualCostEur: round(actualCostEur, 2),
    savingsEur: round(savingsEur, 2),
    savingsPct: Math.abs(actualCostEur) > 0 ? round((savingsEur / Math.abs(actualCostEur)) * 100, 2) : 0,
    batteryThroughputKwh: round(throughputKwh, 1),
    // Equivalent full cycles (EFC) over the device-grounded total usable capacity
    // (both packs, ~190 kWh) instead of the 280 kWh/pack assumption. throughputKwh
    // is BIDIRECTIONAL (Σ|battKw|·dt = charge + discharge), so one full cycle =
    // discharge the whole system once (realTotalCapKwh) + recharge it (again
    // realTotalCapKwh) = 2 × realTotalCapKwh of throughput. Dividing by only
    // realTotalCapKwh (the old `capAvgKwh * 2`) double-counted and reported ~2×
    // too many cycles.
    batteryCycles: round(throughputKwh / (realTotalCapKwh * 2), 2),
    exportViolations,
    observedExportFrames,
    socMinPct: Number.isFinite(socMin) ? round(socMin, 1) : 0,
    socAvgPct: rows.length ? round(socSum / rows.length, 1) : 0,
    socMaxPct: Number.isFinite(socMax) ? round(socMax, 1) : 0,
    emergencyTicks,
    engine: "v4-mpc",
    ...(isV4
      ? {
          mpcInfeasibleSlots: v4InfeasibleSlots,
          mpcReplans: v4Replans,
          // How many LP solves event-driven mode saved vs solving every slot.
          mpcReplansSaved: Math.max(0, v4SlotChanges - v4Replans),
          mpcReplanTriggers: { ...v4ReplanTriggers },
          mpcIdmPricedSlots: v4IdmPricedSlots,
          ...(v5ReserveSolves > 0
            ? {
                mpcReserveFloorAvgPct: round(v5ReserveSumPct / v5ReserveSolves, 1),
                mpcReserveFloorMaxPct: round(v5ReserveMaxPct, 1),
              }
            : {}),
          ...(mpc.standDownEnabled ? { mpcStandDownSolves: v5StandDownSolves } : {}),
        }
      : {}),
  }

  // Derive C1/C2 charging sessions from the EXACT frames the engine replayed
  // (`rows`), not a separate DB query. This is the only way the strip works for
  // LIVE report days, whose frames were injected and never persisted to Neon
  // (the old getChargerSessions query found nothing → empty strip). It also
  // guarantees the Backtest Lab (stored) and the report (live) derive sessions
  // identically. We use the per-connector cumulative energy counter
  // (e_ev_chg_kwh, carried as ev1Cum/ev2Cum): a session is a contiguous run of
  // frames where that counter advances. (p_ev_w is broken/stuck at 0.)
  const sessions = deriveSessionsFromRows(rows)

  // Materialize a savings breakdown from a bucket map, sorted chronologically.
  // `bucketIso` carries the bucket key (UTC day "YYYY-MM-DD" for daily, UTC hour
  // "YYYY-MM-DDTHH" for hourly); the UI formats it per granularity.
  const materializeBreakdown = (map: Map<string, SaveAcc>): DailySaving[] =>
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucketIso, b]) => {
        const savings = b.actualCostEur - b.optimizedCostEur
        return {
          bucketIso,
          actualCostEur: round(b.actualCostEur, 2),
          optimizedCostEur: round(b.optimizedCostEur, 2),
          savingsEur: round(savings, 2),
          savingsPct: Math.abs(b.actualCostEur) > 0 ? round((savings / Math.abs(b.actualCostEur)) * 100, 2) : 0,
          evKwh: round(b.evKwh, 1),
          frames: b.frames,
        }
      })

  const daily = materializeBreakdown(dailyAcc)
  const hourly = materializeBreakdown(hourlyAcc)

  return {
    kpis,
    series,
    params,
    // Only the engine harness produces a trace; LP runs omit it (undefined).
    ...(isEngine ? { commandTrace } : {}),
    sessions,
    daily,
    hourly,
    totals: {
      actualImportKwh: round(actualImportKwh, 1),
      optimizedImportKwh: round(optimizedImportKwh, 1),
      evKwh: round(evKwh, 1),
      mEv1Kwh: round(mEv1Kwh, 1),
      mEv2Kwh: round(mEv2Kwh, 1),
      // WINDOW ENERGY BALANCE (glossary A7.2, method 2026-09-03.3):
      //   AUX = import − export − EV delivered − battery net
      // so import − export == EV + AUX + battNet closes exactly on every row.
      // Metered-EV windows only; without connector counters the balance has no
      // EV term and the whole residual site load is AUX (same as before).
      auxKwh: round(actualImportKwh - exportKwh - (mEv1Kwh + mEv2Kwh) - (battChargeKwh - battDischargeKwh), 1),
      battNetKwh: round(battChargeKwh - battDischargeKwh, 1),
      battChargeKwh: round(battChargeKwh, 1),
      battDischargeKwh: round(battDischargeKwh, 1),
      exportKwh: round(exportKwh, 1),
      auxClampedKwh: round(auxClampedKwh, 1),
      auxGatedKwh: round(auxGatedKwh, 1),
      evUnservedKwh: round(evUnservedKwh, 2),
      // Per-connector headroom — null when that car never reported a ceiling, so
      // the UI shows "no acceptance limit reported" instead of a misleading %.
      ev1AcceptableKwh: ev1CeilReported ? round(ev1AcceptableKwh, 1) : null,
      ev2AcceptableKwh: ev2CeilReported ? round(ev2AcceptableKwh, 1) : null,
      ev1ServedKwh: ev1CeilReported ? round(ev1ServedAtCeilKwh, 1) : null,
      ev2ServedKwh: ev2CeilReported ? round(ev2ServedAtCeilKwh, 1) : null,
      ev1HeadroomKwh: ev1CeilReported ? round(ev1HeadroomKwh, 1) : null,
      ev2HeadroomKwh: ev2CeilReported ? round(ev2HeadroomKwh, 1) : null,
    },
  }
}

/**
 * Reconstruct C1/C2 charging sessions from the replayed frames' per-connector
 * cumulative energy counters (e_ev_chg_kwh → ev1Cum/ev2Cum). A session is a
 * maximal run of frames over which the counter advances; idle gaps shorter than
 * GAP_MS are bridged so a brief pause doesn't split one charge into many. Mirror
 * of the DB query's filters (≥2 frames AND >0.1 kWh delivered) so stored and
 * live days look the same — but driven purely by the frames in memory.
 */
function deriveSessionsFromRows(rows: BacktestFrameRow[]): ChargerSession[] {
  const GAP_MS = 8 * 60_000 // bridge ≤8 min idle within a session
  const EPS_KWH = 0.001 // ignore counter jitter
  const out: ChargerSession[] = []

  for (const unit of ["1", "2"] as const) {
    const pick = (r: BacktestFrameRow) => (unit === "1" ? r.ev1Cum : r.ev2Cum)
    const pickSoc = (r: BacktestFrameRow) => (unit === "1" ? r.ev1SocCar : r.ev2SocCar)
    const pickEta = (r: BacktestFrameRow) => (unit === "1" ? r.ev1FullS : r.ev2FullS)
    let prevMs: number | null = null
    let prevCum: number | null = null
    let cur:
      | {
          startMs: number
          endMs: number
          energyKwh: number
          frames: number
          startSoc: number | null
          endSoc: number | null
          etaFullS: number | null
        }
      | null = null

    const flush = () => {
      if (cur && cur.energyKwh > 0.1 && cur.frames >= 2) {
        const hours = Math.max((cur.endMs - cur.startMs) / 3_600_000, 1 / 240)
        out.push({
          unitId: unit,
          label: `C${unit}`,
          startIso: new Date(cur.startMs).toISOString(),
          endIso: new Date(cur.endMs).toISOString(),
          startMs: cur.startMs,
          endMs: cur.endMs,
          energyKwh: Math.round(cur.energyKwh * 100) / 100,
          avgKw: Math.round((cur.energyKwh / hours) * 10) / 10,
          frames: cur.frames,
          startSocPct: cur.startSoc != null ? Math.round(cur.startSoc * 10) / 10 : null,
          endSocPct: cur.endSoc != null ? Math.round(cur.endSoc * 10) / 10 : null,
          etaFullS: cur.etaFullS,
        })
      }
      cur = null
    }

    const validSoc = (s: number | null | undefined): number | null =>
      typeof s === "number" && s >= 0 && s <= 100 ? s : null

    for (const r of rows) {
      const ms = new Date(r.ts).getTime()
      const cum = pick(r)
      if (cum == null || !Number.isFinite(cum)) {
        prevMs = ms
        continue
      }
      if (prevCum != null && prevMs != null) {
        const delta = cum - prevCum
        if (delta > EPS_KWH) {
          // Charging happened between prevMs and ms.
          if (cur && ms - cur.endMs > GAP_MS) flush()
          if (!cur)
            cur = {
              startMs: prevMs,
              endMs: ms,
              energyKwh: 0,
              frames: 1,
              startSoc: validSoc(pickSoc(r)),
              endSoc: null,
              etaFullS: null,
            }
          cur.endMs = ms
          cur.energyKwh += delta
          cur.frames += 1
          const soc = validSoc(pickSoc(r))
          if (soc != null) {
            if (cur.startSoc == null) cur.startSoc = soc
            cur.endSoc = soc
          }
          const eta = pickEta(r)
          if (typeof eta === "number" && eta > 0) cur.etaFullS = eta
        }
      }
      prevMs = ms
      prevCum = cum
    }
    flush()
  }

  out.sort((a, b) => a.unitId.localeCompare(b.unitId) || a.startMs - b.startMs)
  return out
}

function clampSoc(soc: number): number {
  return Math.min(100, Math.max(0, soc))
}

function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/**
 * A car SoC reading is only valid in [0, 100] %. The charger emits 0xFFFF
 * (65535) — and occasionally other out-of-range values — to mean "not
 * available"; map all of those to null so charts/stats never plot a sentinel.
 */
function validSocPct(s: number | null | undefined): number | null {
  if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > 100) return null
  return round(s, 1)
}
