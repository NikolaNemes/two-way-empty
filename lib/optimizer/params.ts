// ════════════════════════════════════════════════════════════════════════
// DISPATCH OPTIMIZER — PHYSICAL CONSTANTS & PARAMETER SURFACE (pure, client-safe).
// ════════════════════════════════════════════════════════════════════════
//
// These are the METERED ChargePost parameters from the v4 implementation spec
// (Sec 1.1). They are kept in a dependency-free module so the model registry
// (which is bundled to the client) can import them WITHOUT pulling in the GLPK
// wasm solver. The solver itself lives in lib/optimizer/solver.ts ("server-only").
//
// Where these differ from the shared v1–v3 kernel constants, the v4 values win
// for the v4 engine only — v4 carries its own block instead of mutating the
// kernel, so v1–v3 behaviour stays byte-for-byte unchanged.
// ════════════════════════════════════════════════════════════════════════

import { GRID_IMPORT_LIMIT_KW } from "../dispatch-kernel"

/** Usable buffer energy (kWh). METERED: ~223 kWh raw median × 0.85 ≈ 190.
 *  NOT the 560 kWh nameplate nor the optimistic 476 kWh figure. */
export const BATTERY_CAPACITY_KWH = 190
/** Reserve floor as a fraction of E_max. POLICY — kept conservatively high
 *  while session data is thin (1 site, 1 month). Lower later as data justifies.
 *  This is the LP's PLANNING floor: the optimiser never schedules the battery
 *  below it, so this band of energy is held in reserve.
 *  RAISED 0.35 → 0.45 (2026-06 SoC-risk sweep): keeping the pack fuller is the
 *  lever that actually de-risks EV demand. On the May 1–15 window it lifted the
 *  min-SoC trough 10% → 15%, cut time-below-20%-SoC 3.5% → 1.2%, AND slightly
 *  REDUCED curtailment (more banked energy to ride out spikes), for ~4 pts of
 *  arbitrage give-back. Note: raising the EMERGENCY floor alone does the
 *  opposite — it starves the battery mid-spike and increases curtailment. */
export const LEGACY_SOC_FLOOR_FRAC = 0.45
/** Physical EMERGENCY floor (fraction of E_max). The real-time controller is
 *  allowed to discharge into the reserve band (below the LP planning floor)
 *  ONLY to serve a real car when grid + planned discharge fall short. Without
 *  this, the "reserve" can never be tapped and demand spikes above the grid cap
 *  get curtailed. The next plan solve refills the band.
 *  RAISED 0.10 → 0.15: a modest hard-stop lift so emergency taps bottom out with
 *  a real cushion, without choking the battery during the largest spikes (the
 *  heavy lifting is done by the higher planning floor above). */
export const EMERGENCY_FLOOR_FRAC = 0.15
/** ── REAL-TIME RESERVE GUARD (engine-level, price-independent) ──────────────
 *  Hard safety net evaluated every replan on the LATEST telemetry frame, AFTER
 *  the optimiser. The LP's floors are PLANNING constraints on its predicted
 *  trajectory; they were never enforced as a hard real-time setpoint, so on
 *  2026-07-02 the optimizer kept choosing a near-zero import setpoint to dodge a
 *  high-price morning and the metered result drained the pack 51% → 3% under a
 *  157 kW car while ~77 kW of grid import sat unused.
 *
 *  The ONLY lever is the grid-import setpoint P_grid_request (= clearanceKw). We
 *  do NOT control the car/battery split — that is metered downstream. Both rules
 *  set the setpoint to the FULL grid cap ("import the max allowed"), overriding
 *  the optimizer/price; the physical outcome follows from that.
 *
 *   A. CAR-CONNECTED GUARD — measured SOC < CAR_GUARD_FRAC (60%) AND a car is
 *      connected ⇒ setpoint = full cap.
 *
 *   B. NO-CAR RECHARGE — no car connected AND measured SOC < V5_NOCAR_RECHARGE_TRIGGER
 *      (40%) ⇒ latch setpoint = full cap, held (with hysteresis) until SOC climbs
 *      to V5_NOCAR_RECHARGE_TARGET (60%). The latch is persisted on
 *      PlannerState.forcedRechargeActive so it survives across ticks and doesn't
 *      chatter around the 40% edge. */
export const RESERVE_GUARD_ENABLED = true
/** A: force full grid import while a car draws and SOC is below this. */
export const CAR_GUARD_FRAC = 0.6
/** B: below this (no car) start an immediate full-power recharge. */
export const NOCAR_RECHARGE_TRIGGER_FRAC = 0.4
/** B: hold the full-power recharge until SOC reaches this, then release. */
export const NOCAR_RECHARGE_TARGET_FRAC = 0.6
/** Max usable SoC fraction. Capped at 0.95 so the plan never charges the battery
 *  beyond 95% — the LP's energy ceiling = socMaxFrac·E_max, and socMaxFrac also
 *  drives the wire `soc_cp_max_pct`. Once SOC reaches this ceiling the LP stops
 *  charging (g no longer exceeds demand), so grid import is naturally downsized. */
export const SOC_MAX_FRAC = 0.95
/** Charge efficiency. */
export const CHARGE_EFFICIENCY = 0.94
/** Discharge efficiency (round-trip ≈ 0.88). */
export const DISCHARGE_EFFICIENCY = 0.94
/** Grid import hard cap (kW) — connection/operating limit. This is the FULL
 *  grid import the plan may request (aux + EV + battery charge all draw from it);
 *  the device auto-draws aux+EV within it and we only command it when charging.
 *  SINGLE-SOURCED from the dispatch kernel's GRID_IMPORT_LIMIT_KW (87) so the
 *  planner, dispatcher, telemetry sim, and every UI screen share ONE value —
 *  a 79-vs-87 split here previously cost the arbitrage side ~10% headroom. */
export const GRID_MAX_KW = GRID_IMPORT_LIMIT_KW
/** Fixed aux reserve (kW) used when live aux is unavailable. */
export const AUX_LOAD_KW = 8
/** Floor (kW) under the LIVE-measured aux reserve: headroom = cap − max(liveAux,
 *  this). Live-diagnosed (Jul 17 2026): measured aux is ~0–0.1 kW while the fixed
 *  8 kW reserve derated every charging hour to 79 kW — ~5–6 kW of headroom wasted
 *  on a load that wasn't there. 2 kW keeps a safety margin for aux spikes
 *  (contactors, HVAC bursts) without the standing 9% derate. */
export const AUX_RESERVE_FLOOR_KW = 2
/** Sanity ceiling (kW) on the live-measured aux reserve — a mis-derived power
 *  balance (e.g. one-frame EV ramp misalignment) must not eat half the
 *  connection. Mirrors the backtest's EMA×3 residual-baseload cap. */
export const AUX_RESERVE_CAP_KW = 16
/** Max buffer charge power (kW) — metered peak 83.2, bounded by grid headroom. */
export const CHARGE_MAX_KW = 85
/** Max buffer discharge power (kW) — metered peak 217.9 (spec ceiling 240). */
export const DISCHARGE_MAX_KW = 218
/** Control step length (h) — 15-min resolution. */
export const SLOT_DT_H = 0.25
/** Horizon length (steps). 96 = 24 h; spec allows 96–144. */
export const HORIZON_STEPS = 96
/**
 * Per-throughput battery degradation / cycling cost (EUR/MWh), applied by the LP
 * to BOTH charge and discharge energy. Real pack cycling cost is ~7 ct/kWh per
 * FULL cycle (charge + discharge), so each direction carries half = 3.5 ct/kWh =
 * 35 EUR/MWh; a full charge→discharge round-trip is then penalised ~70 EUR/MWh.
 *
 * WHY THIS MATTERS: the old value (8) under-priced cycling ~9×, so the optimiser
 * happily discharged the pack to shave tiny price spreads — cycling the battery
 * for a few euros of arbitrage that the wear cost more than wiped out. With the
 * real cost, the LP only discharges when the horizon spread genuinely beats
 * ~7 ct/kWh, and otherwise prefers serving load straight from the grid (incl.
 * grid-charging the pack in cheap slots) rather than burning cycles.
 */
export const CYCLE_COST_EUR_PER_MWH_PER_DIRECTION = 35
/**
 * ARBITRAGE PROFIT HURDLE (EUR/MWh, per direction) — added ON TOP of the true
 * degradation cost in the PLANNING objective only (never in reports, which
 * price actual wear at the true cost above).
 *
 * WHY: a cost-minimising LP takes EVERY trade whose spread ≥ round-trip wear —
 * including marginal ones at spread = cost + ε that earn ≈ €0 each. The
 * optimiser therefore cycles right up to the indifference point, and on
 * low-spread days the measured outcome is timing value ≈ wear (break-even),
 * exactly as the arbitrage-participation KPI showed (Jul 13: +2.84 € timing vs
 * 2.87 € wear). The hurdle makes the plan demand REAL profit before burning a
 * cycle: with 10 €/MWh per direction the round-trip gate rises 70 → 90 €/MWh,
 * which also absorbs the ~10–15% efficiency losses and forecast error the
 * simple spread gate ignores. Marginal trades are skipped; genuinely profitable
 * ones (solar troughs, negative prices, evening peaks) still clear easily.
 *
 * Forced peak-shave discharge (EV demand above the grid cap) is constraint-
 * driven, so the hurdle cannot block it — it only tempers DISCRETIONARY cycling.
 * Set to 0 to restore pure cost-indifference planning.
 */
export const ARB_PROFIT_MARGIN_EUR_PER_MWH_PER_DIRECTION = 10
/** Forecast total daily car demand (kWh) for the self-consumption cap (Sec 0b).
 *  Metered ≈ 133 kWh/day. Used as a fallback when the live session-derived
 *  forecast is empty. */
export const DAILY_DEMAND_CAP_KWH = 133
/** Setpoint smoothness penalty (anti-chatter). 0 = off (LP, not QP). */
export const SMOOTH_PENALTY = 0
/**
 * Charge FRONT-LOADING tie-break (EUR/kWh per horizon step). A microscopic,
 * time-graded surcharge added to the charge term c[t] so that among slots of
 * EQUAL price the LP prefers to charge NOW (earlier t) rather than defer.
 *
 * WHY: when several upcoming slots share the cheapest price (a flat plateau),
 * the objective is indifferent about WHICH of them banks the cheap energy, so
 * the simplex picks arbitrarily — often a later slot. Under event-driven
 * replanning we only ever commit g[0], so a perpetually-deferred cheap charge
 * means the committed slot just serves the car (grid import looks "off") and the
 * cheap window can close before we act. This term breaks the tie toward t0.
 *
 * MAGNITUDE: 1e-6 €/kWh/step. Over the full 96-step horizon the accumulated bias
 * is ≤ ~1e-4 €/kWh — smaller than a €0.5/MWh price difference — so it ONLY
 * resolves genuine ties and never overrides real arbitrage economics. The
 * optimal-cost solution is unchanged; only the slot CHOICE among equal-cost
 * options shifts earlier. Set to 0 to disable.
 */
export const CHARGE_TIEBREAK_EUR_PER_KWH_STEP = 1e-6
/**
 * Terminal SoC value weight (EUR/kWh) — controls how eagerly the solver banks
 * cheap energy (it charges extra whenever current price < ��·η_c·1000 − deg).
 *
 * AUTO mode (null): λ floats at 90% of the horizon's MEDIAN price (see
 * solveHorizon), so the recharge gate tracks the day — in a €70/MWh regime the
 * gate sits near €63/MWh and the plan WILL schedule cheap-hour recharge, not
 * just hold the floor. The fixed λ = 0.05 (≈€39/MWh gate) saved ~2% cost in the
 * May-2026 sweep but planned NO proactive recharge during elevated-price days,
 * letting SOC drift down with no rebuild. We run AUTO so the plan rebuilds the
 * buffer in the cheapest upcoming slots. Set to a number to pin a fixed anchor.
 */
export const LAMBDA_TERMINAL_EUR_PER_KWH: number | null = null

// ── EVENT-DRIVEN REPLANNING + INTRADAY (IDM) SIGNAL ─────────────────────────
/**
 * Replan policy. A classic receding-horizon controller re-solves the LP every control slot ("every-
 * slot"). "event-driven" (the new default) instead HOLDS the last plan and only
 * re-solves on a *relevant* event from the telemetry/price feed — a car
 * connecting or disconnecting, or the live intraday price diverging materially
 * from day-ahead — plus a safety re-solve at most every
 * `replanMaxIntervalSlots`. This avoids re-optimising on every tick when
 * nothing actionable has changed, while still reacting immediately when it has.
 */
export type ReplanMode = "event-driven" | "every-slot"
export const REPLAN_MODE: ReplanMode = "event-driven"
/** Safety cap: re-solve at least this often (slots) even with no event. 4 = 1h. */
export const REPLAN_MAX_INTERVAL_SLOTS = 4
/** Absolute IDM↔DAM deviation (€/MWh) on the current slot that forces a replan. */
export const IDM_TRIGGER_EUR_MWH = 15
/** Relative IDM↔DAM deviation (fraction of |DAM|) that forces a replan. */
export const IDM_TRIGGER_PCT = 0.2
/** Use the live IDM price for the committed first step + that slot's realized
 *  cost (planning of the rest of the horizon still uses the DAM curve). */
export const USE_IDM_NEAR_TERM = true
/** EV load (kW) above which a connector counts as "a car is connected", so a
 *  crossing of this threshold is a connect/disconnect replan event. */
export const EV_CONNECT_THRESHOLD_KW = 1.0

// ── v5: ADAPTIVE (UNCERTAINTY-SIZED) RESERVE ────────────────────────────────
/**
 * v5 replaces v4's flat planning floor with a TIME-VARYING one: a small base
 * floor plus a cushion sized by the demand-forecast UNCERTAINTY over the next
 * few hours. The risk being hedged is realized EV demand exceeding the grid cap
 * for longer than forecast and draining the pack — so the cushion is the extra
 * energy that the P90 demand would draw beyond the mean across a protective
 * lookahead window. Off in v4; on in v5.
 */
export const ADAPTIVE_RESERVE = true
/** v5 BASE planning floor (fraction of E_max). Lower than v4's flat 0.45 because
 *  the adaptive cushion adds on top only when uncertainty warrants it — quiet,
 *  predictable hours can safely sit near this hard minimum. */
export const SOC_FLOOR_FRAC = 0.2
/** Fraction of the forecast demand-uncertainty energy to actually bank as
 *  reserve. 1.0 = hold the full P90−mean gap over the lookahead window.
 *  TUNED to 0.7 (2026-06 coverage sweep): on May 1–8 this point strictly
 *  DOMINATED the v4 flat 0.45 floor — cheaper (€48.35 vs €51.06, 43.5% vs 40.4%
 *  savings) AND safer (unserved 3.36 vs 6.54 kWh, 18 vs 26 emergency taps). Full
 *  coverage (1.0) over-insures (zero unserved but ~7 pts more give-back); ≤0.5
 *  under-insures (cheaper but more unserved than v4). 0.7 is the sweet spot. */
export const RESERVE_COVERAGE_FRAC = 0.7
/** Protective lookahead (hours) the uncertainty reserve integrates over. The
 *  cushion at step t covers demand surprises across roughly the next this-many
 *  hours — long enough to refill between solves, short enough to stay lean. */
export const RESERVE_LOOKAHEAD_H = 3
/** Hard cap on the adaptive reserve as a fraction of E_max, so the cushion can
 *  never crowd out the whole pack (and the LP stays feasible). */
export const RESERVE_MAX_FRAC = 0.6

// ── v5: SOFT COMFORT BAND (anti-"lazy refill") ──────────────────────────────
/**
 * The HARD reserve floor (socFloorFrac + adaptive cushion) guarantees the plan
 * never DISCHARGES the pack below it for arbitrage. But between that floor and
 * the ceiling the LP only rebuilds when price beats the λ gate, so SOC can
 * COAST DOWN toward the floor without proactively refilling — the "lazy" drift.
 *
 * The comfort band fixes that WITHOUT touching the hard floor. We add a soft
 * target a band above the hard floor and a slack variable s[t] ≥ 0 measuring
 * how far E[t] sits below that target. A small per-kWh penalty on s[t] is added
 * to the objective, so whenever SOC is inside the band the optimiser prefers to
 * top it back up — and because it's in the SAME cost objective, it does so in
 * the CHEAPEST reachable slots, not lazily at the last moment. The target is a
 * SOFT goal (slack absorbs it) so it NEVER causes infeasibility, and it can
 * never pull SOC below the hard floor (that bound still dominates).
 */
export const COMFORT_BAND_ENABLED = true
/** Comfort top-up target as a fraction of E_max. The plan proactively refills the
 *  battery UP TO this level, but ONLY by charging inside the cheapest slots of the
 *  horizon (see COMFORT_CHEAP_SLOTS_N) — never in expensive hours. 0.95 = the
 *  usable ceiling: bank resilience against large unforecast sessions when (and
 *  only when) cheap energy is available. It is a SOFT goal (never infeasible) and
 *  can never pull SOC below the hard reserve floor. */
export const COMFORT_TARGET_FRAC = 0.95
/** PRICE GATE FALLBACK — comfort top-up eligibility is normally the day-spread
 *  cheap rule (price ≤ min + cheapSpreadFrac·(max−min) — the SAME cutoff the
 *  dispatch rule and the UI use to classify a slot "cheap"), so EVERY genuinely
 *  cheap slot is eligible and the earliness premium fills the EARLIEST one: the
 *  buffer de-risks as soon as prices are cheap instead of deferring hours for a
 *  couple of €/MWh (Jul 3: refill waited for the 12:45 trough while 11:00 slots
 *  were ~2 €/MWh dearer). This fixed-N rank is only the FALLBACK for a flat
 *  horizon (spread ≈ 0) where the spread rule cannot discriminate. At 15-min
 *  steps, 16 slots = the 4 cheapest hours. */
export const COMFORT_CHEAP_SLOTS_N = 16
/** Incentive (EUR/kWh) rewarding comfort top-up charging inside the cheap-slot
 *  window. Sized to comfortably exceed typical cheap-slot prices + round-trip
 *  degradation so the eligible cheap slots do get filled toward the target, while
 *  the cheap-slot gate above guarantees it can never spill into expensive hours.
 *  ~€0.06/kWh ≈ €60/MWh: a slot in the cheapest-N window is filled when its price
 *  is below roughly this level, so genuinely-expensive days simply don't top up. */
export const COMFORT_PENALTY_EUR_PER_KWH = 0.06
/** RISK-AWARE EARLINESS PREMIUM (€/MWh per 15-min slot deferred). Among the
 *  cheapest-N comfort slots the reward is otherwise FLAT, so the LP would defer a
 *  recharge to a slot that is even 0.1 €/MWh cheaper — leaving the battery low for
 *  longer with negligible saving. This premium makes a later slot worth waiting for
 *  ONLY if it beats an earlier eligible slot by more than this per slot of delay,
 *  so with no car connected and cheap hours happening the pack tops up NOW. ~2 €/MWh
 *  per slot ⇒ a slot 1 h later must be >8 €/MWh cheaper to be preferred. */
export const COMFORT_EARLINESS_EUR_PER_MWH_PER_SLOT = 2
/** Depletion sensitivity of the earliness premium. effectiveRate = base·(1 + k·f),
 *  f = comfort headroom / target ∈ [0,1] (how far SOC sits below the comfort target).
 *  k = 1 ⇒ a fully-depleted pack applies up to 2× the base premium (grabs the nearest
 *  cheap slot), while a nearly-full pack applies ~1× (still free to shop for cheapest). */
export const COMFORT_EARLINESS_RISK_GAIN = 1

// ── v5: ARBITRAGE STAND-DOWN (rare high-risk demand hedge) ──────────────────
/**
 * "Stand down from arbitrage" mode. The adaptive reserve handles *characterizable*
 * variability, but a genuinely low / very-risky scenario (battery near the floor,
 * or a forecast P90 demand spike the grid alone can't cover) warrants a stronger
 * stance: for THAT solve, dispatch AS IF there were no arbitrage opportunity —
 * suspend planned buffer discharge entirely (self-consumption cap → 0) so the LP
 * just covers demand from the grid and holds / opportunistically refills the pack,
 * leaving the full battery available for the real-time emergency tap. It does NOT
 * touch the wire contract or the LP structure — it only zeroes one input
 * (dailyCapKwh) when the trigger fires.
 *
 * OFF by default everywhere (incl. v5) — enable via params and validate with a
 * walk-forward backtest sweep before trusting it live.
 */
export const STANDDOWN_ENABLED = false
/** Low-SOC trigger: stand down when current SOC ≤ planning floor + this fraction
 *  of E_max. A small band above the floor so we pre-empt a drain, not react to it. */
export const STANDDOWN_SOC_MARGIN_FRAC = 0.05
/** Demand-risk trigger: stand down when forecast P90 demand at ANY step within the
 *  reserve lookahead ≥ this fraction of grid headroom. 1.0 ⇒ P90 meets/exceeds the
 *  grid import cap, i.e. the grid alone can't cover the spike and the battery would
 *  have to be tapped — exactly the rare scenario we want to bank energy for. */
export const STANDDOWN_HEADROOM_FRAC = 1.0

/**
 * The optimizer parameter block stored on a model version. Distinct from the
 * heuristic kernel knobs — these are the LP's physical model + tuning.
 */
// ── v5.1: DYNAMIC HORIZON + RISK-AWARE, FIRM COMMITTED ACTION ───────────────
// The LP is a GLOBAL planner that commits only g[0]; "now" is rarely the global
// optimum, so the firm intent (refill when cheap, import for a connected car) is
// never expressed in the committed action and the operator overrides by hand.
// These levers add a deterministic committed-action policy ON TOP of the planner
// (the LP objective/physics are untouched). All default ON in v5; A/B-able.

/** Master switch: shrink the lookahead horizon as SOC drops. OFF ⇒ fixed horizonSteps. */
export const DYNAMIC_HORIZON = true
/** SOC fraction at/above which the full horizon is used (patient, can wait for the trough). */
export const HORIZON_SOC_HIGH_FRAC = 0.7
/** SOC fraction at/below which the horizon collapses to its minimum (eager, act now). */
export const HORIZON_SOC_LOW_FRAC = 0.3
/** Full horizon length (steps) at high SOC. 96 = 24 h. */
export const HORIZON_MAX_STEPS = 96
/** Collapsed horizon length (steps) at low SOC. 12 = 3 h. */
export const HORIZON_MIN_STEPS = 12

/** "Cheap" cutoff anchored to the DAY SPREAD: price ≤ min + frac·(max−min).
 *  0.30 ⇒ the cheapest 30% of the day's price RANGE counts as cheap. */
export const CHEAP_SPREAD_FRAC = 0.3
/** SIGNIFICANCE GUARD for the day-spread cheap rule: the relative cutoff is only
 *  trusted when at least this many price slots are visible. At day-end the window
 *  can shrink to 2–3 slots whose min is "cheap" by construction even at peak
 *  prices; below this count the rule reports not-cheap (a ≤ 0 €/MWh price is
 *  always cheap regardless). 8 slots = 2 h of 15-min prices. */
export const CHEAP_MIN_VISIBLE_SLOTS = 8
/** Second half of the significance guard: the visible max−min spread must be at
 *  least this wide (€/MWh) for "cheap relative to the spread" to mean anything.
 *  On a near-flat curve (e.g. 94–97 €/MWh) NOTHING is meaningfully cheap. */
export const CHEAP_MIN_SPREAD_EUR_MWH = 20
/** Risk-aware wait test: a future slot must be at least this much cheaper than NOW
 *  (€/kWh) to be worth holding SOC and waiting for. Below this, buy now. 0.015
 *  €/kWh = 15 €/MWh — a marginal few-euro saving is NOT worth deferring a refill. */
export const WORTH_WAITING_EUR_PER_KWH = 0.015
/** At low SOC, deferring is riskier — scale the worth-waiting threshold UP (so the
 *  future slot must be MUCH cheaper to justify waiting). Applied linearly from 1×
 *  at the high band to this multiple at the emergency floor. */
export const WORTH_WAITING_LOW_SOC_MULT = 2.0
/** At HIGH SOC the pack has a big buffer, so waiting is cheap — be MORE patient
 *  and hold out for even a small extra saving rather than topping up in a
 *  marginally-cheaper slot. Scales the worth-waiting threshold DOWN, linearly from
 *  1× at the high band (horizonSocHighFrac) to this multiple at a full pack.
 *  0.4 ⇒ at 100% SOC a future slot only needs to save 40% of the base threshold
 *  to justify waiting. Together with the low-SOC multiplier this makes eagerness a
 *  smooth, monotonic function of SOC: full pack = patient, empty pack = eager. */
export const WORTH_WAITING_HIGH_SOC_MULT = 0.4

/** Firm rule: when it is a cheap slot AND a car is connected, serve the car fully
 *  from the GRID (committed clearance ≥ car+aux) and spare the battery (no arbitrage
 *  discharge while a car charges at a cheap price). */
export const FIRM_CHEAP_CAR_IMPORT = true

/** Firm rule mirroring low-SOC refill at the OTHER end of the SOC range: when SOC
 *  is HIGH (≥ horizonSocHighFrac), NO car is connected, and a materially-cheaper
 *  slot is still ahead, DON'T top the pack up from the grid now — strip the
 *  battery-charging portion of the committed clearance and wait for the cheaper
 *  slot. A full pack can afford to wait; this stops the "charge in a not-quite-
 *  cheapest slot while SOC is already high and the trough is an hour away" case. */
export const HIGH_SOC_DEFER_ENABLED = true

/** Proactive low-SOC refill when NO car is connected: in a cheap+buy-now slot,
 *  import to rebuild the pack toward a target that RISES as SOC drops. */
export const LOW_SOC_REFILL_ENABLED = true
/** Ceiling the low-SOC refill aims for (fraction of E_max). The effective target
 *  ramps from the comfort target (high SOC) up toward this as SOC → emergency floor. */
export const LOW_SOC_REFILL_TARGET_FRAC = 0.6

export interface OptimizerParams {
  /** Usable buffer energy E_max (kWh). */
  usableEnergyKwh: number
  /** Reserve floor (fraction of E_max) — the LP's conservative planning floor. */
  socFloorFrac: number
  /** Physical emergency floor (fraction of E_max) — the real-time controller may
   *  dip into the reserve band down to here to serve a real car spike. */
  emergencyFloorFrac: number
  /** Max usable SoC (fraction of E_max). */
  socMaxFrac: number
  /** Charge efficiency η_c. */
  chargeEff: number
  /** Discharge efficiency η_d. */
  dischargeEff: number
  /** Max buffer charge power (kW). */
  maxChargeKw: number
  /** Max buffer discharge power (kW). */
  maxDischargeKw: number
  /** Grid import hard cap (kW). */
  gridMaxKw: number
  /** Fixed aux reserve (kW). */
  auxReserveKw: number
  /** Horizon length (steps). */
  horizonSteps: number
  /** Control step length (h). */
  stepHours: number
  /** Per-throughput degradation cost (EUR/MWh). */
  degCostEurPerMwh: number
  /** Arbitrage profit hurdle (EUR/MWh per direction) added to degCost in the
   *  PLANNING objective only — the LP skips marginal ≈zero-profit trades.
   *  Reports keep pricing actual wear at degCostEurPerMwh. 0 = off. */
  arbMarginEurPerMwh?: number
  /** Self-consumption daily discharge cap fallback (kWh). */
  dailyDemandCapKwh: number
  /**
   * Terminal SoC value weight (EUR/kWh). Anchors how eagerly the solver banks
   * cheap energy: it charges extra whenever current price < this. `null` = AUTO
   * (anchor to the horizon's median price, the expected refill cost).
   */
  lambdaTerminalEurPerKwh: number | null
  /** Anti-chatter setpoint smoothness penalty (0 = off). */
  smoothPenalty: number
  /** Charge front-loading tie-break (EUR/kWh per horizon step): a microscopic
   *  time-graded surcharge on c[t] so equal-price slots charge NOW vs deferring.
   *  Cost-neutral (only resolves ties); 0 = off. */
  chargeTieBreakEurPerKwhStep?: number
  /**
   * Replan policy: "event-driven" (default) re-solves only on relevant events
   * (car connect/disconnect, IDM↔DAM divergence) plus a safety interval;
   * "every-slot" reproduces the classic re-solve-every-control-slot policy.
   */
  replanMode: ReplanMode
  /** Safety cap — re-solve at least this often (control slots), even with no event. */
  replanMaxIntervalSlots: number
  /** Absolute IDM↔DAM deviation (€/MWh) on the current slot that forces a replan. */
  idmTriggerEurMwh: number
  /** Relative IDM↔DAM deviation (fraction of |DAM|) that forces a replan. */
  idmTriggerPct: number
  /** Value the committed first step + that slot's realized cost at the live IDM
   *  price (the rest of the horizon is still planned on the DAM curve). */
  useIdmNearTerm: boolean
  /** EV load (kW) above which a connector counts as connected (connect/disconnect
   *  crossings of this are replan events). */
  evConnectThresholdKw: number

  // ── v5: adaptive (uncertainty-sized) reserve ──────────────────────────────
  /** v5 ON: replace the flat planning floor with a time-varying floor sized by
   *  demand-forecast uncertainty. v4: OFF/undefined ⇒ flat `socFloorFrac`. */
  adaptiveReserve?: boolean
  /** Fraction of the forecast P90−mean demand energy to bank as cushion. */
  reserveCoverageFrac?: number
  /** Protective lookahead (hours) the uncertainty reserve integrates over. */
  reserveLookaheadH?: number
  /** Hard cap on the adaptive reserve as a fraction of E_max. */
  reserveMaxFrac?: number

  // ── v5: arbitrage stand-down (rare high-risk demand hedge) ────────────────
  /** v5: suspend planned arbitrage discharge (cover demand from grid, hold/refill
   *  the pack) when a low/very-risky scenario is detected. OFF/undefined ⇒ never. */
  standDownEnabled?: boolean
  /** Low-SOC trigger margin (fraction of E_max above the planning floor). */
  standDownSocMarginFrac?: number
  /** Demand-risk trigger: P90 demand within the lookahead ≥ this × grid headroom. */
  standDownHeadroomFrac?: number

  // ── v5: soft comfort band (anti-"lazy refill") ────────────────────────────
  /** v5: enable the soft comfort target above the hard floor. OFF/undefined ⇒
   *  no comfort penalty (pure hard-floor behaviour). */
  comfortBandEnabled?: boolean
  /** Comfort top-up target (fraction of E_max). The LP fills UP TO this level, but
   *  only inside the cheapest-N slots; never relaxes the hard floor below it. */
  comfortTargetFrac?: number
  /** Incentive weight (EUR/kWh) rewarding comfort top-up charging in the cheap-slot
   *  window. (Field name kept for back-compat; now an incentive, not a penalty.) */
  comfortPenaltyEurPerKwh?: number
  /** PRICE GATE: comfort top-up charging is confined to the N cheapest slots of the
   *  horizon, so it can never charge expensive hours. Undefined ⇒ no gate (legacy). */
  comfortCheapSlotsN?: number
  /** RISK-AWARE EARLINESS: minimum €/MWh a LATER cheap slot must beat an earlier one by,
   *  PER 15-min slot deferred, before the comfort top-up will wait for it. Kills marginal
   *  deferral among similar prices — recharge NOW when a car is absent and cheap hours are
   *  happening. Applied only to comfort charging (never real arbitrage). 0/undefined ⇒ off. */
  comfortEarlinessEurPerMwhPerSlot?: number
  /** How strongly the earliness premium scales with battery depletion below the comfort
   *  target: effectiveRate = base·(1 + k·depletionFrac), depletionFrac = headroom/target ∈[0,1].
   *  A low battery grabs the nearest cheap slot; a nearly-full one can still shop. 0 ⇒ flat. */
  comfortEarlinessRiskGain?: number

  // ── v5.1: dynamic horizon ─────────────────────────────────────────────────
  /** Shrink the lookahead horizon as SOC drops (eager at low SOC). OFF/undefined
   *  ⇒ fixed `horizonSteps`. */
  dynamicHorizon?: boolean
  /** SOC fraction at/above which the full horizon (`horizonMaxSteps`) is used. */
  horizonSocHighFrac?: number
  /** SOC fraction at/below which the horizon collapses to `horizonMinSteps`. */
  horizonSocLowFrac?: number
  /** Full horizon length (steps) at high SOC. */
  horizonMaxSteps?: number
  /** Collapsed horizon length (steps) at low SOC. */
  horizonMinSteps?: number

  // ── v5.1: risk-aware "is waiting worth it" ────────────────────────────────
  /** "Cheap" cutoff as a fraction of the day price spread: min + frac·(max−min). */
  cheapSpreadFrac?: number
  /** Min visible price slots before the relative cheap rule is trusted. */
  cheapMinVisibleSlots?: number
  /** Min visible max−min spread (€/MWh) before the relative cheap rule is trusted. */
  cheapMinSpreadEurMwh?: number
  /** Minimum €/kWh a future slot must beat NOW by to justify waiting (else buy now). */
  worthWaitingEurPerKwh?: number
  /** Multiplier raising the worth-waiting threshold as SOC drops (more eager when low). */
  worthWaitingLowSocMult?: number
  /** Multiplier LOWERING the worth-waiting threshold as SOC rises (more patient when high). */
  worthWaitingHighSocMult?: number

  // ── v5.1: firm committed-action rules ─────────────────────────────────────
  /** Cheap slot + car connected ⇒ serve the car fully from grid, spare the battery. */
  firmCheapCarImport?: boolean
  /** High SOC + no car + cheaper slot ahead ⇒ defer grid charging (wait for it). */
  highSocDeferEnabled?: boolean
  /** Low SOC + no car + cheap/buy-now ⇒ proactively import to refill the pack. */
  lowSocRefillEnabled?: boolean
  /** Ceiling (fraction of E_max) the low-SOC refill ramps toward as SOC drops. */
  lowSocRefillTargetFrac?: number
}

/** Default optimizer params — the metered ChargePost model from the spec. */
export const LEGACY_FIXED_RESERVE_DEFAULTS: OptimizerParams = {
  usableEnergyKwh: BATTERY_CAPACITY_KWH,
  socFloorFrac: LEGACY_SOC_FLOOR_FRAC,
  emergencyFloorFrac: EMERGENCY_FLOOR_FRAC,
  socMaxFrac: SOC_MAX_FRAC,
  chargeEff: CHARGE_EFFICIENCY,
  dischargeEff: DISCHARGE_EFFICIENCY,
  maxChargeKw: CHARGE_MAX_KW,
  maxDischargeKw: DISCHARGE_MAX_KW,
  gridMaxKw: GRID_MAX_KW,
  auxReserveKw: AUX_LOAD_KW,
  horizonSteps: HORIZON_STEPS,
  stepHours: SLOT_DT_H,
  degCostEurPerMwh: CYCLE_COST_EUR_PER_MWH_PER_DIRECTION,
  arbMarginEurPerMwh: ARB_PROFIT_MARGIN_EUR_PER_MWH_PER_DIRECTION,
  dailyDemandCapKwh: DAILY_DEMAND_CAP_KWH,
  lambdaTerminalEurPerKwh: LAMBDA_TERMINAL_EUR_PER_KWH,
  smoothPenalty: SMOOTH_PENALTY,
  chargeTieBreakEurPerKwhStep: CHARGE_TIEBREAK_EUR_PER_KWH_STEP,
  replanMode: REPLAN_MODE,
  replanMaxIntervalSlots: REPLAN_MAX_INTERVAL_SLOTS,
  idmTriggerEurMwh: IDM_TRIGGER_EUR_MWH,
  idmTriggerPct: IDM_TRIGGER_PCT,
  useIdmNearTerm: USE_IDM_NEAR_TERM,
  evConnectThresholdKw: EV_CONNECT_THRESHOLD_KW,
  // v4 keeps the flat planning floor — adaptive reserve is OFF here.
  adaptiveReserve: false,
  reserveCoverageFrac: RESERVE_COVERAGE_FRAC,
  reserveLookaheadH: RESERVE_LOOKAHEAD_H,
  reserveMaxFrac: RESERVE_MAX_FRAC,
  // Arbitrage stand-down OFF by default (carry thresholds so sweeps can flip it on).
  standDownEnabled: STANDDOWN_ENABLED,
  standDownSocMarginFrac: STANDDOWN_SOC_MARGIN_FRAC,
  standDownHeadroomFrac: STANDDOWN_HEADROOM_FRAC,
  // v4 keeps pure hard-floor behaviour — comfort band is OFF here.
  comfortBandEnabled: false,
  comfortTargetFrac: COMFORT_TARGET_FRAC,
  comfortPenaltyEurPerKwh: COMFORT_PENALTY_EUR_PER_KWH,
  // v4 keeps the fixed horizon and pure-LP committed action — v5.1 layer OFF.
  dynamicHorizon: false,
  horizonSocHighFrac: HORIZON_SOC_HIGH_FRAC,
  horizonSocLowFrac: HORIZON_SOC_LOW_FRAC,
  horizonMaxSteps: HORIZON_MAX_STEPS,
  horizonMinSteps: HORIZON_MIN_STEPS,
  cheapSpreadFrac: CHEAP_SPREAD_FRAC,
  cheapMinVisibleSlots: CHEAP_MIN_VISIBLE_SLOTS,
  cheapMinSpreadEurMwh: CHEAP_MIN_SPREAD_EUR_MWH,
  worthWaitingEurPerKwh: WORTH_WAITING_EUR_PER_KWH,
  worthWaitingLowSocMult: WORTH_WAITING_LOW_SOC_MULT,
  worthWaitingHighSocMult: WORTH_WAITING_HIGH_SOC_MULT,
  firmCheapCarImport: false,
  highSocDeferEnabled: false,
  lowSocRefillEnabled: false,
  lowSocRefillTargetFrac: LOW_SOC_REFILL_TARGET_FRAC,
}

/** Default the optimizer params — v4 plus the adaptive uncertainty-sized reserve, with
 *  a lower BASE floor (the cushion adds on top only when uncertainty warrants). */
export const OPTIMIZER_DEFAULTS: OptimizerParams = {
  ...LEGACY_FIXED_RESERVE_DEFAULTS,
  socFloorFrac: SOC_FLOOR_FRAC,
  adaptiveReserve: ADAPTIVE_RESERVE,
  reserveCoverageFrac: RESERVE_COVERAGE_FRAC,
  reserveLookaheadH: RESERVE_LOOKAHEAD_H,
  reserveMaxFrac: RESERVE_MAX_FRAC,
  // v5 ON: comfort tops up toward the target, gated to the cheapest-N slots so it
  // only ever charges cheap hours (never expensive ones).
  comfortBandEnabled: COMFORT_BAND_ENABLED,
  comfortTargetFrac: COMFORT_TARGET_FRAC,
  comfortPenaltyEurPerKwh: COMFORT_PENALTY_EUR_PER_KWH,
  comfortCheapSlotsN: COMFORT_CHEAP_SLOTS_N,
  comfortEarlinessEurPerMwhPerSlot: COMFORT_EARLINESS_EUR_PER_MWH_PER_SLOT,
  comfortEarlinessRiskGain: COMFORT_EARLINESS_RISK_GAIN,
  // v5.1 ON: dynamic SOC-driven horizon + risk-aware, firm committed action.
  dynamicHorizon: DYNAMIC_HORIZON,
  horizonSocHighFrac: HORIZON_SOC_HIGH_FRAC,
  horizonSocLowFrac: HORIZON_SOC_LOW_FRAC,
  horizonMaxSteps: HORIZON_MAX_STEPS,
  horizonMinSteps: HORIZON_MIN_STEPS,
  cheapSpreadFrac: CHEAP_SPREAD_FRAC,
  cheapMinVisibleSlots: CHEAP_MIN_VISIBLE_SLOTS,
  cheapMinSpreadEurMwh: CHEAP_MIN_SPREAD_EUR_MWH,
  worthWaitingEurPerKwh: WORTH_WAITING_EUR_PER_KWH,
  worthWaitingLowSocMult: WORTH_WAITING_LOW_SOC_MULT,
  worthWaitingHighSocMult: WORTH_WAITING_HIGH_SOC_MULT,
  firmCheapCarImport: FIRM_CHEAP_CAR_IMPORT,
  highSocDeferEnabled: HIGH_SOC_DEFER_ENABLED,
  lowSocRefillEnabled: LOW_SOC_REFILL_ENABLED,
  lowSocRefillTargetFrac: LOW_SOC_REFILL_TARGET_FRAC,
}

/** UI metadata for rendering the optimizer params table. */
export interface OptimizerParamMeta {
  key: keyof OptimizerParams
  label: string
  unit: string
}

export const OPTIMIZER_PARAM_META: OptimizerParamMeta[] = [
  { key: "usableEnergyKwh", label: "Usable energy (E_max)", unit: "kWh" },
  { key: "socFloorFrac", label: "Reserve floor (planning)", unit: "× E_max" },
  { key: "emergencyFloorFrac", label: "Emergency floor (physical)", unit: "× E_max" },
  { key: "socMaxFrac", label: "Max SoC", unit: "× E_max" },
  { key: "chargeEff", label: "Charge efficiency η_c", unit: "" },
  { key: "dischargeEff", label: "Discharge efficiency η_d", unit: "" },
  { key: "maxChargeKw", label: "Max charge power", unit: "kW" },
  { key: "maxDischargeKw", label: "Max discharge power", unit: "kW" },
  { key: "gridMaxKw", label: "Grid import cap", unit: "kW" },
  { key: "auxReserveKw", label: "Aux reserve", unit: "kW" },
  { key: "horizonSteps", label: "Horizon length", unit: "steps" },
  { key: "stepHours", label: "Step length", unit: "h" },
  { key: "degCostEurPerMwh", label: "Degradation cost", unit: "€/MWh" },
  { key: "dailyDemandCapKwh", label: "Self-consumption cap", unit: "kWh/day" },
  { key: "lambdaTerminalEurPerKwh", label: "Terminal value λ", unit: "€/kWh" },
  { key: "smoothPenalty", label: "Smoothness penalty", unit: "" },
  { key: "chargeTieBreakEurPerKwhStep", label: "Charge front-load tie-break", unit: "€/kWh·step" },
  { key: "replanMode", label: "Replan policy", unit: "" },
  { key: "replanMaxIntervalSlots", label: "Max replan interval", unit: "slots" },
  { key: "idmTriggerEurMwh", label: "IDM replan trigger (abs)", unit: "€/MWh" },
  { key: "idmTriggerPct", label: "IDM replan trigger (rel)", unit: "× DAM" },
  { key: "useIdmNearTerm", label: "IDM near-term pricing", unit: "" },
  { key: "evConnectThresholdKw", label: "Connect threshold", unit: "kW" },
  { key: "adaptiveReserve", label: "Adaptive reserve", unit: "" },
  { key: "reserveCoverageFrac", label: "Reserve coverage", unit: "× P90 gap" },
  { key: "reserveLookaheadH", label: "Reserve lookahead", unit: "h" },
  { key: "reserveMaxFrac", label: "Reserve cap", unit: "× E_max" },
  { key: "standDownEnabled", label: "Arbitrage stand-down", unit: "" },
  { key: "standDownSocMarginFrac", label: "Stand-down SOC margin", unit: "× E_max" },
  { key: "standDownHeadroomFrac", label: "Stand-down demand risk", unit: "× headroom" },
  { key: "comfortBandEnabled", label: "Comfort band", unit: "" },
  { key: "comfortTargetFrac", label: "Comfort target", unit: "× E_max" },
  { key: "comfortPenaltyEurPerKwh", label: "Comfort penalty", unit: "€/kWh" },
  { key: "comfortEarlinessEurPerMwhPerSlot", label: "Comfort earliness premium", unit: "€/MWh·slot" },
  { key: "comfortEarlinessRiskGain", label: "Earliness risk gain", unit: "× depletion" },
  { key: "dynamicHorizon", label: "Dynamic horizon", unit: "" },
  { key: "horizonSocHighFrac", label: "Horizon full above SOC", unit: "× E_max" },
  { key: "horizonSocLowFrac", label: "Horizon min below SOC", unit: "× E_max" },
  { key: "horizonMaxSteps", label: "Horizon max", unit: "steps" },
  { key: "horizonMinSteps", label: "Horizon min", unit: "steps" },
  { key: "cheapSpreadFrac", label: "Cheap cutoff (of spread)", unit: "× range" },
  { key: "worthWaitingEurPerKwh", label: "Worth-waiting threshold", unit: "€/kWh" },
  { key: "worthWaitingLowSocMult", label: "Worth-waiting low-SOC ×", unit: "×" },
  { key: "worthWaitingHighSocMult", label: "Worth-waiting high-SOC ×", unit: "×" },
  { key: "firmCheapCarImport", label: "Firm cheap+car import", unit: "" },
  { key: "highSocDeferEnabled", label: "High-SOC defer charge", unit: "" },
  { key: "lowSocRefillEnabled", label: "Low-SOC refill", unit: "" },
  { key: "lowSocRefillTargetFrac", label: "Low-SOC refill target", unit: "× E_max" },
]
