// ════════════════════════════════════════════════════════════════════════
// DISPATCH OPTIMIZER SOLVER — the LP core. THIS IS THE LOGIC (no if/then dispatch).
// ════════════════════════════════════════════════════════════════════════
//
// Implements the ChargePost optimizer spec (Sec 3): a linear program that minimizes
// energy purchase cost subject to HARD constraints that structurally enforce
// the non-negotiable priority order —
//   (1) Protect EV demand   → baked into the energy-balance equality + bounds
//                              (feasibility guarantees the car is served;
//                               infeasible ⇒ caller falls back to max import).
//   (2) No grid export       → g[t] ≥ 0 lower bound.
//   (3) Minimize cost        → the objective (never a penalty).
//
// THE KEY CONSTRAINT (Sec 0b): a hard daily self-consumption throughput cap —
// total buffer discharge over a day ≤ forecast car demand. Under no-export,
// every discharged kWh must go into a car, so this caps realizable arbitrage.
// Without it the optimizer overstates savings ~15–30×.
//
// Decision variables (per horizon step t): grid import g[t], buffer charge
// c[t] ≥ 0, buffer discharge d[t] ≥ 0, and buffer energy state E[t]. Only g[0]
// is applied each cycle (the rest is plan); the caller writes it as the grid
// import ceiling and the station's internal control handles the real-time
// EV/buffer split underneath (spec Sec 5, Loop 3).
//
// Solver: GLPK simplex (glpk.js, wasm) via the synchronous Node entry. ~100
// steps × 1 state ⇒ a few hundred vars; solves in milliseconds.
// ════════════════════════════════════════════════════════════════════════

import "server-only"
import GLPK from "glpk.js/node"
import type { GLPK as GLPKInstance, LP } from "glpk.js/node"
import type { OptimizerParams } from "./params"

// Singleton GLPK instance (the factory is async; solve() is then synchronous).
let _glpk: Promise<GLPKInstance> | null = null
export function getGlpk(): Promise<GLPKInstance> {
  if (!_glpk) _glpk = GLPK()
  return _glpk
}

export interface SolveInput {
  /** Initialized GLPK instance (from getGlpk()). */
  glpk: GLPKInstance
  /** Current buffer energy E[0] (kWh). */
  energyKwh: number
  /** Usable buffer capacity E_max (kWh) — device-grounded when available. */
  capacityKwh: number
  /** Horizon DA prices (€/MWh), length H ≥ 1. */
  pricesEurMwh: number[]
  /** Forecast EV demand per step (kW), length H. */
  demandKw: number[]
  /** Controllable grid import headroom this horizon (kW) = grid cap − aux/baseload. */
  headroomKw: number
  /** Daily self-consumption discharge cap D_day (kWh). */
  dailyCapKwh: number
  /**
   * v5 ADAPTIVE RESERVE (optional). Per-step buffer-energy lower bound (kWh),
   * aligned to steps t=1..H (index 0 ⇒ E[1]). When present, each step's reserve
   * floor is raised to this value (clamped to the usable band), replacing the
   * flat `socFloorFrac` floor with an uncertainty-sized one. When ABSENT, the
   * solver uses the flat floor exactly as v4 does (byte-identical behaviour).
   */
  reserveFloorKwh?: number[]
  /**
   * RISK REFILL (optional): energy deficit of the WEAKEST battery string below
   * the refill target (kWh). When > 0, a dedicated cheap-slot-gated incentive
   * (rc[t] ≤ c[t], Σ η_c·dt·rc ≤ this) guarantees the LP schedules exactly this
   * much charging into the horizon's cheapest slots. Exists because the comfort
   * reward alone provably never fires for a de-risking refill: the earliness
   * surcharge decays it to zero ~22 slots out (before a typical overnight
   * trough) and even undlecayed it loses to price + wear + arb hurdle − λ
   * (live-diagnosed Jul 28 2026: B2 at 44%, plan showed aux-only 5.5 kW through
   * a 134 €/MWh trough — the user saw "no plan to refill B2" and was right).
   * Unlike comfort this is a NEED, so its reward is set above the cheap-set
   * price ceiling — the LP cannot decline it, and the price term steers it to
   * the cheapest eligible slots. Bounded by this cap, it can never overbuy.
   */
  riskRefillKwh?: number
  /** The optimizer parameter block. */
  mpc: OptimizerParams
}

export interface SolveResult {
  status: "optimal" | "infeasible" | "error"
  /** g[0] — the grid import ceiling to apply this cycle (kW). */
  clearanceKw: number
  /**
   * The full planned grid-import ceiling trajectory g[0..H-1] (kW), one entry
   * per horizon step. Event-driven replanning follows g[k] for the k-th step
   * after the last solve (instead of re-applying g[0] every held slot), so the
   * plan is tracked faithfully between replans. Empty on non-optimal solves.
   */
  gridScheduleKw: number[]
  /** Objective value (€) when optimal. */
  z?: number
  /** Planned end-of-step-0 buffer energy (kWh), for diagnostics. */
  plannedE1Kwh?: number
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Solve the optimizer horizon and return g[0] (the grid import ceiling to apply).
 *
 * Energy balance (per step): g[t] − c[t] + d[t] = demand[t]
 *   (grid import minus buffer charge plus buffer discharge serves demand;
 *    aux is folded into the headroom on g).
 * Dynamics: E[t+1] = E[t] + η_c·c[t]·dt − (1/η_d)·d[t]·dt.
 */
export async function solveHorizon(input: SolveInput): Promise<SolveResult> {
  const { glpk, pricesEurMwh, demandKw, headroomKw, dailyCapKwh, mpc } = input
  const H = pricesEurMwh.length
  if (H < 1) return { status: "error", clearanceKw: Math.max(0, headroomKw), gridScheduleKw: [] }

  const dt = mpc.stepHours
  const etaC = mpc.chargeEff
  const etaD = mpc.dischargeEff
  const capKwh = input.capacityKwh > 0 ? input.capacityKwh : mpc.usableEnergyKwh
  const floor = mpc.socFloorFrac * capKwh
  const ceil = mpc.socMaxFrac * capKwh
  // Clamp the starting energy into the physical band for a feasible anchor.
  const e0 = Math.min(Math.max(input.energyKwh, 0), ceil)

  // Terminal SoC value λ (€/kWh): AUTO = the horizon's median price (the
  // expected refill cost), lightly discounted so it doesn't over-hoard; the
  // degradation cost tempers it further. Banks cheap energy below this anchor.
  const lambda =
    mpc.lambdaTerminalEurPerKwh != null
      ? mpc.lambdaTerminalEurPerKwh
      : Math.max(0, (median(pricesEurMwh) / 1000) * 0.9)

  // PLANNING wear price = true degradation + arbitrage profit hurdle. The
  // hurdle (see ARB_PROFIT_MARGIN_EUR_PER_MWH_PER_DIRECTION) stops the LP from
  // taking marginal spread ≈ cost trades that earn ≈ €0 after wear, efficiency
  // losses and forecast error. Reports/accounting keep the true degCost only.
  const degPerKwh = (mpc.degCostEurPerMwh + (mpc.arbMarginEurPerMwh ?? 0)) / 1000

  // ── COMFORT TOP-UP, PRICE-GATED TO THE CHEAPEST SLOTS (optional) ──────────
  // Proactively refill the buffer UP TO a target above the hard floor, but ONLY
  // by charging inside the horizon's cheapest slots — never in expensive hours.
  // Implemented as a per-slot charge INCENTIVE (a reward on a comfort-charge
  // variable cc[t] ≤ c[t]) that exists only for the N lowest-priced slots, with a
  // single global cap so the rewarded charging can only lift SOC to the target.
  // This replaces the old per-step "penalise SOC below target" slack, which paid
  // ANY price (even expensive slots) to reach the target. It never relaxes the
  // hard floor and, being an incentive (not a constraint), never causes
  // infeasibility.
  const comfortOn = mpc.comfortBandEnabled === true && (mpc.comfortPenaltyEurPerKwh ?? 0) > 0
  // Target clamped into the usable band; at/below the hard floor it's a no-op.
  const comfortTarget = comfortOn ? Math.min((mpc.comfortTargetFrac ?? 0) * capKwh, ceil) : 0
  const comfortBonus = comfortOn ? (mpc.comfortPenaltyEurPerKwh ?? 0) : 0
  // ELIGIBILITY GATE — the dispatch algorithm's own day-spread cheap rule, NOT a
  // fixed "N cheapest" rank: a slot is comfort-eligible when its price is within
  // the bottom `cheapSpreadFrac` of the horizon's min→max spread (same cutoff the
  // planner/UI use to classify a slot "cheap"). With a fixed-N gate a long cheap
  // trough (e.g. a near-zero afternoon) concentrated eligibility on the absolute
  // trough only, so the LP DEFERRED the de-risking refill past hours that were a
  // mere ~2 €/MWh dearer — leaving the buffer low for no real saving. With the
  // spread rule EVERY genuinely-cheap slot is eligible and the earliness premium
  // below picks the EARLIEST of them unless waiting saves > effEarlyRate per
  // slot of delay. Falls back to the cheapest-N rank on a flat horizon
  // (spread ≈ 0) where the spread rule cannot discriminate.
  const minP = Math.min(...pricesEurMwh)
  const maxP = Math.max(...pricesEurMwh)
  const spreadP = maxP - minP
  const cheapFrac = Math.max(0, Math.min(1, mpc.cheapSpreadFrac ?? 0.3))
  const cheapCutoff = minP + cheapFrac * spreadP
  const cheapN = Math.max(0, Math.min(H, Math.round(mpc.comfortCheapSlotsN ?? H)))
  const cheapSet = new Set<number>(
    spreadP > 1e-9
      ? pricesEurMwh.map((p, t) => ({ p, t })).filter((x) => x.p <= cheapCutoff).map((x) => x.t)
      : pricesEurMwh
          .map((p, t) => ({ p, t }))
          .sort((a, b) => a.p - b.p)
          .slice(0, cheapN)
          .map((x) => x.t),
  )
  // Headroom from the current SOC up to the comfort target (kWh). Comfort charging
  // is globally capped to this so it tops up toward — never beyond — the target.
  const comfortHeadroomKwh = Math.max(0, comfortTarget - e0)
  const comfortActive = comfortOn && comfortBonus > 0 && cheapSet.size > 0 && comfortHeadroomKwh > 0

  // ── RISK REFILL (weakest-string de-risking, cheap-slot-gated) ─────────────
  // See SolveInput.riskRefillKwh. Reward is pinned ABOVE the worst cheap-set
  // price + wear so the LP always takes the full capped amount somewhere in
  // the cheap set; minimizing Σ price·g then places it in the cheapest slots.
  const riskRefillKwh = Math.max(0, input.riskRefillKwh ?? 0)
  const riskActive = riskRefillKwh > 0.05 && cheapSet.size > 0
  const riskReward = riskActive ? cheapCutoff / 1000 + degPerKwh + 0.01 : 0

  const gName = (t: number) => `g${t}`
  const cName = (t: number) => `c${t}`
  const dName = (t: number) => `d${t}`
  const eName = (t: number) => `e${t}`
  const ccName = (t: number) => `cc${t}`
  const rcName = (t: number) => `rc${t}`

  // Charge front-loading tie-break: a microscopic, time-graded surcharge on the
  // charge term so that among EQUAL-price slots the LP banks cheap energy NOW
  // (earlier t) rather than deferring to an arbitrary later slot of the same
  // price. Far smaller than any real price difference, so it only resolves ties
  // and never changes the optimal cost or genuine arbitrage choices.
  const chargeTieBreak = Math.max(0, mpc.chargeTieBreakEurPerKwhStep ?? 0)

  // ── RISK-AWARE EARLINESS PREMIUM (comfort charging only) ─────────────────
  // The comfort reward is otherwise FLAT across the cheapest-N slots, so the LP
  // would defer a top-up to a slot that is even a hair cheaper — leaving the
  // battery low longer for no real saving. We add a monotonic per-slot surcharge
  // on the comfort-charge reward so a LATER cheap slot is preferred ONLY if it
  // beats an earlier eligible slot by more than `effEarlyRate` €/MWh per slot of
  // delay. The rate scales UP as SOC sits further below the comfort target, so a
  // depleted pack grabs the nearest cheap slot while a nearly-full one can still
  // shop for the cheapest. This touches comfort top-up only — never the grid/
  // arbitrage terms — so genuine price arbitrage is unaffected.
  const earlyBaseEurMwhPerSlot = Math.max(0, mpc.comfortEarlinessEurPerMwhPerSlot ?? 0)
  const earlyRiskGain = Math.max(0, mpc.comfortEarlinessRiskGain ?? 0)
  // depletionFrac ∈ [0,1]: how far the current SOC sits below the comfort target.
  const depletionFrac =
    comfortTarget > 0 ? Math.max(0, Math.min(1, comfortHeadroomKwh / comfortTarget)) : 0
  // €/kWh per slot deferred (÷1000 to convert €/MWh → €/kWh).
  const earlinessPerKwhPerSlot =
    (earlyBaseEurMwhPerSlot / 1000) * (1 + earlyRiskGain * depletionFrac)

  // ── Objective: min Σ price·g·dt + Σ deg·(c+d)·dt − λ·E[H] (+ comfort) ─────
  const objVars: { name: string; coef: number }[] = []
  for (let t = 0; t < H; t++) {
    objVars.push({ name: gName(t), coef: (pricesEurMwh[t] / 1000) * dt })
    objVars.push({ name: cName(t), coef: degPerKwh * dt + chargeTieBreak * t })
    objVars.push({ name: dName(t), coef: degPerKwh * dt })
  }
  objVars.push({ name: eName(H), coef: -lambda })
  // Comfort top-up reward: pay a `comfortBonus` €/kWh CREDIT for charging inside
  // the cheapest-N slots (cc[t] ≤ c[t]). Because it exists only for cheap slots
  // and is globally capped to the target headroom, it fills the buffer toward the
  // target using cheap energy and is structurally unable to charge expensive hours.
  if (comfortActive) {
    for (const t of cheapSet) {
      // Net reward = flat comfort bonus MINUS an earliness surcharge growing with
      // the slot's distance from now (t). Clamped at 0 so a far slot is at worst
      // neutral (never a penalty that would suppress a needed top-up); the
      // earliest eligible cheap slot always keeps the most reward, so ties and
      // near-ties resolve to charging sooner.
      const reward = Math.max(0, comfortBonus - earlinessPerKwhPerSlot * t)
      objVars.push({ name: ccName(t), coef: -(reward * dt) })
    }
  }
  // Risk refill reward: FLAT (no earliness decay — an overnight trough must not
  // out-decay a NEED) and pinned above the cheap-set price ceiling + wear, so
  // the capped amount is always taken; Σ price·g minimization places it in the
  // cheapest eligible slots.
  if (riskActive) {
    for (const t of cheapSet) {
      objVars.push({ name: rcName(t), coef: -(riskReward * dt) })
    }
  }

  const subjectTo: LP["subjectTo"] = []

  // Energy balance (hard, equality): g[t] − c[t] + d[t] = demand[t].
  for (let t = 0; t < H; t++) {
    subjectTo.push({
      name: `bal${t}`,
      vars: [
        { name: gName(t), coef: 1 },
        { name: cName(t), coef: -1 },
        { name: dName(t), coef: 1 },
      ],
      bnds: { type: glpk.GLP_FX, lb: demandKw[t] ?? 0, ub: demandKw[t] ?? 0 },
    })
  }

  // Buffer dynamics (hard, equality):
  //   E[t+1] − E[t] − η_c·dt·c[t] + (dt/η_d)·d[t] = 0.
  for (let t = 0; t < H; t++) {
    subjectTo.push({
      name: `dyn${t}`,
      vars: [
        { name: eName(t + 1), coef: 1 },
        { name: eName(t), coef: -1 },
        { name: cName(t), coef: -(etaC * dt) },
        { name: dName(t), coef: dt / etaD },
      ],
      bnds: { type: glpk.GLP_FX, lb: 0, ub: 0 },
    })
  }

  // Self-consumption throughput cap (hard) — per rolling 24 h (96-step) block:
  //   Σ d[t]·dt ≤ D_day.  THE key no-export constraint (Sec 0b).
  const stepsPerDay = Math.max(1, Math.round(24 / dt))
  for (let blockStart = 0; blockStart < H; blockStart += stepsPerDay) {
    const blockEnd = Math.min(blockStart + stepsPerDay, H)
    const vars: { name: string; coef: number }[] = []
    for (let t = blockStart; t < blockEnd; t++) vars.push({ name: dName(t), coef: dt })
    // Scale the cap to the (possibly partial) block length so a short tail
    // block isn't allowed a full day's discharge.
    const frac = (blockEnd - blockStart) / stepsPerDay
    subjectTo.push({
      name: `selfcap${blockStart}`,
      vars,
      bnds: { type: glpk.GLP_UP, lb: 0, ub: Math.max(0, dailyCapKwh) * frac },
    })
  }

  // Comfort top-up (cheap-slot-gated incentive). For each cheapest-N slot, the
  // rewarded comfort-charge cc[t] can be at most the actual charge c[t] scheduled
  // that slot (cc[t] − c[t] ≤ 0), so the reward only accrues when we genuinely
  // charge. A single global cap limits the total comfort-charged ENERGY delivered
  // to the target headroom (Σ η_c·dt·cc[t] ≤ comfortTarget − E[0]), so the plan
  // tops up toward — never beyond — the target, and only ever in cheap slots.
  if (comfortActive) {
    for (const t of cheapSet) {
      // When risk refill is also active, the SAME physical charge must not earn
      // both rewards: cc[t] + rc[t] ≤ c[t] splits c between the two incentives.
      subjectTo.push({
        name: `ccle${t}`,
        vars: [
          { name: ccName(t), coef: 1 },
          ...(riskActive ? [{ name: rcName(t), coef: 1 }] : []),
          { name: cName(t), coef: -1 },
        ],
        bnds: { type: glpk.GLP_UP, lb: 0, ub: 0 },
      })
    }
    subjectTo.push({
      name: "comfortcap",
      vars: [...cheapSet].map((t) => ({ name: ccName(t), coef: etaC * dt })),
      bnds: { type: glpk.GLP_UP, lb: 0, ub: comfortHeadroomKwh },
    })
  }
  // Risk refill: rewarded charge only when genuinely charging (rc ≤ c when
  // comfort is off — otherwise the shared cc + rc ≤ c above already binds),
  // globally capped at the weakest string's deficit so it can never overbuy.
  if (riskActive) {
    if (!comfortActive) {
      for (const t of cheapSet) {
        subjectTo.push({
          name: `rcle${t}`,
          vars: [
            { name: rcName(t), coef: 1 },
            { name: cName(t), coef: -1 },
          ],
          bnds: { type: glpk.GLP_UP, lb: 0, ub: 0 },
        })
      }
    }
    subjectTo.push({
      name: "riskcap",
      vars: [...cheapSet].map((t) => ({ name: rcName(t), coef: etaC * dt })),
      bnds: { type: glpk.GLP_UP, lb: 0, ub: riskRefillKwh },
    })
  }

  // ── Variable bounds ─────────��─────────────────────────────────────────────
  const bounds: NonNullable<LP["bounds"]> = []
  const hr = Math.max(0, headroomKw)
  for (let t = 0; t < H; t++) {
    // No export: g ≥ 0. Grid cap: g ≤ headroom.
    bounds.push({ name: gName(t), type: glpk.GLP_DB, lb: 0, ub: hr })
    bounds.push({ name: cName(t), type: glpk.GLP_DB, lb: 0, ub: mpc.maxChargeKw })
    bounds.push({ name: dName(t), type: glpk.GLP_DB, lb: 0, ub: mpc.maxDischargeKw })
  }
  // Energy state: E[0] fixed at the measured value; E[1..H] within the reserve
  // band. The reserve floor lower bound IS the EV-protection guarantee (Sec 3).
  // If the live SoC is already below floor, let it recover from there rather
  // than declaring the whole horizon infeasible.
  bounds.push({ name: eName(0), type: glpk.GLP_FX, lb: e0, ub: e0 })
  const adaptive = input.reserveFloorKwh
  for (let t = 1; t <= H; t++) {
    let lb: number
    if (!adaptive) {
      // v4 path — flat floor, unchanged. Recover from below-floor states.
      lb = Math.min(floor, e0)
    } else {
      // v5 path — uncertainty-sized floor. Never exceed the usable ceiling.
      const stepFloor = Math.min(Math.max(floor, adaptive[t - 1] ?? floor), ceil)
      // FEASIBILITY: the immediate step (t=1) cannot exceed the current state in
      // a single control cycle, so clamp it to e0; later steps can recharge to
      // the full reserve, so the cushion binds from t≥2. If the LP still can't
      // reach it, GLPK returns non-optimal and the caller safely falls back.
      lb = t === 1 ? Math.min(stepFloor, e0) : stepFloor
    }
    bounds.push({ name: eName(t), type: glpk.GLP_DB, lb, ub: ceil })
  }
  // Comfort-charge cc[t] ∈ [0, maxChargeKw] for cheap slots (bounded above by the
  // actual charge via the ccle constraint, and in aggregate by the comfort cap).
  if (comfortActive) {
    for (const t of cheapSet) {
      bounds.push({ name: ccName(t), type: glpk.GLP_DB, lb: 0, ub: mpc.maxChargeKw })
    }
  }
  if (riskActive) {
    for (const t of cheapSet) {
      bounds.push({ name: rcName(t), type: glpk.GLP_DB, lb: 0, ub: mpc.maxChargeKw })
    }
  }

  const lp: LP = {
    name: "dispatch-horizon",
    objective: { direction: glpk.GLP_MIN, name: "cost", vars: objVars },
    subjectTo,
    bounds,
  }

  try {
    const res = await glpk.solve(lp, { msglev: glpk.GLP_MSG_OFF, presol: true })
    const st = res.result.status
    const ok = st === glpk.GLP_OPT || st === glpk.GLP_FEAS
    if (!ok) return { status: "infeasible", clearanceKw: hr, gridScheduleKw: [] }
    const g0 = res.result.vars[gName(0)] ?? 0
    const e1 = res.result.vars[eName(1)]
    // Extract the full planned grid trajectory g[0..H-1] for plan-tracking
    // between event-driven replans.
    const gridScheduleKw: number[] = new Array(H)
    for (let t = 0; t < H; t++) gridScheduleKw[t] = Math.max(0, res.result.vars[gName(t)] ?? 0)
    return {
      status: "optimal",
      clearanceKw: Math.max(0, g0),
      gridScheduleKw,
      z: res.result.z,
      plannedE1Kwh: e1,
    }
  } catch {
    // Any solver failure → safe degradation: allow max import so the EV (the
    // top priority) is never starved. Mirrors the watchdog fallback (Sec 5).
    return { status: "error", clearanceKw: hr, gridScheduleKw: [] }
  }
}
