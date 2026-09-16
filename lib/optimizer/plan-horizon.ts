/**
 * LIVE DISPATCH PLANNER
 * ════════════════════════════════════════════════════════════════════════
 *
 * Runs the SAME optimizer LP the backtest uses (`solveHorizon` + the shared
 * `sizeAdaptiveReserveKwh` uncertainty reserve), but against the LIVE inputs
 * available at a replan: the current buffer SOC, the cached forward DA price
 * curve, and a P90 demand forecast built from recent metered sessions.
 *
 * It returns a serializable PLAN SNAPSHOT — the full receding-horizon grid
 * schedule plus a reconstructed projected SOC trajectory and the per-step
 * reserve floor — so the Dispatcher Status page can render the plan and diff it
 * against the previous one on each replan. The committed first step (g[0]) is
 * what actually feeds the wire payload; the rest is the optimizer's intent.
 *
 * IMPORTANT: this does NOT change the wire contract. The caller still maps the
 * committed clearance through `toDispatchPayload`, exactly as before.
 */

import { solveHorizon, getGlpk } from "./solver"
import { sizeAdaptiveReserveKwh, decideStandDown } from "./reserve"
import { dynamicHorizonSteps } from "./horizon"
import { decideBuyNow, arbitrageWorthIt } from "./cheap-slot"
import { applyFirmCommit, type FirmCommitReason } from "./committed-action"
import {
  OPTIMIZER_DEFAULTS,
  BATTERY_CAPACITY_KWH,
  GRID_MAX_KW,
  type OptimizerParams,
  AUX_RESERVE_FLOOR_KW,
  AUX_RESERVE_CAP_KW,
} from "./params"
import {
  buildHourlyDemandProfile,
  demandKwAt,
  demandHiKwAt,
  type HourlyDemandProfile,
} from "../demand-forecast"
import { getChargerSessions } from "../charger-sessions"
import { slotStartMs } from "../price-supply"
import { commandedGridImportKw } from "../dispatch-kernel"
import type { PlanSnapshot, PlanStep } from "../dispatcher-status"

/** How far back to look when building the live P90 demand profile. */
const DEMAND_LOOKBACK_DAYS = 14

export interface LiveMpcInput {
  stationId: string
  /** Current slot index (epoch-anchored, 15-min). */
  currentSlot: number
  /** Average buffer SOC right now (%), used to anchor E[0]. */
  avgSocPct: number
  /**
   * SOC of the WEAKEST battery string (%), when per-battery telemetry is
   * available. Risk-side decisions (dynamic horizon shrink, firm buy-now
   * urgency) key off min(avg, this) — the average masks imbalance:
   * live-diagnosed Jul 17 2026, B1 85% / B2 41% averaged to 63%, so the
   * planner idled through cheap afternoon hours deferring recharge to the
   * next day while one string sat at 41%. Energy accounting (energyKwh)
   * stays on the average — total stored energy IS the average; only RISK is
   * per-string. Null/undefined ⇒ avg only (mono-battery or missing registers).
   */
  minSocPct?: number | null
  /**
   * Site grid-import ceiling for THIS tick, in kW. Callers (dispatch-engine,
   * backtest) now ALWAYS pass the configured cap (GRID_IMPORT_LIMIT_KW /
   * params.gridImportLimitKw = 87) — NEVER the reg-2010 register, which merely
   * echoes the clearance we previously commanded and once created a
   * self-ratcheting 79 kW derate (~10% arbitrage handicap). Kept as an input
   * so tests/scenarios can exercise constrained ceilings. Undefined/0 ⇒ static
   * `mpc.gridMaxKw` fallback.
   */
  gridLimitKw?: number | null
  /** Forward DA price curve as { slot -> €/MWh }. Gaps stop the horizon. */
  priceBySlot: Record<string, number>
  /**
   * LIVE measured EV demand on-site RIGHT NOW (kW), reconstructed from the power
   * balance (`deriveEvLoadW`), NOT the broken `p_ev_w` register. When provided
   * and > 0 it OVERRIDES the committed step's forecast demand so the committed
   * clearance reflects the cars actually charging this instant.
   *
   * WHY THIS MATTERS: the `demandKw` vector the LP solves is built from the
   * historical session forecast, which says ~0 for a quiet hour. Without this
   * override, a real session at the reserve floor leaves `demand[0]≈0`, so the
   * LP satisfies its balance with `g[0]=0` (NO grid import) even though the
   * battery is tapped out — the cars then get throttled instead of grid-served.
   * Injecting the live load forces the committed step to import at the floor.
   */
  liveDemandKw?: number | null
  /**
   * LIVE-measured aux/hotel load right now (kW), from the tick's power balance
   * (import − battery charge − EV). When present the aux reserve becomes
   * clamp(liveAux, AUX_RESERVE_FLOOR_KW, AUX_RESERVE_CAP_KW) instead of the
   * fixed `mpc.auxReserveKw`. Live-diagnosed (Jul 17 2026): actual aux ≈ 0 kW
   * while the fixed 8 kW reserve capped every charging hour at 79 kW — a
   * standing ~6 kW derate for a load that wasn't there. Null/undefined ⇒
   * fixed fallback (aux unmeasurable this tick).
   */
  liveAuxKw?: number | null
  /** Trigger that fired this replan (echoed into the snapshot). */
  eventType?: string
  /** Override the optimizer params (defaults to the production v5 block). */
  mpc?: OptimizerParams
}

/**
 * Solve the live the optimizer and return a plan snapshot, or null when no forward
 * prices are visible (caller then falls back to the per-tick heuristic).
 */
export async function planHorizon(input: LiveMpcInput): Promise<PlanSnapshot | null> {
  const mpc = input.mpc ?? OPTIMIZER_DEFAULTS
  const capKwh = mpc.usableEnergyKwh || BATTERY_CAPACITY_KWH

  // 0. v5.1 DYNAMIC HORIZON: shrink the lookahead as SOC drops so a low pack acts
  //    on the NEAREST cheap slot instead of holding out for a distant trough. At
  //    high SOC this is the full 24 h (unchanged). socFrac comes from the live
  //    avg SOC; the effective horizon also bounds the price loop below.
  const socFrac0 = Math.min(Math.max(input.avgSocPct, 0), 100) / 100
  // RISK SOC: the weakest string when known (see LiveMpcInput.minSocPct) — the
  // dynamic horizon and buy-now urgency must react to the emptiest battery,
  // not the imbalance-masking average.
  const riskSocFrac =
    input.minSocPct != null && Number.isFinite(input.minSocPct)
      ? Math.min(socFrac0, Math.min(Math.max(input.minSocPct, 0), 100) / 100)
      : socFrac0
  const effHorizonSteps = dynamicHorizonSteps(riskSocFrac, mpc, mpc.horizonSteps)

  // 1. Forward DA price curve from the current slot to the horizon end. Stop at
  //    the first missing slot so we never plan on a gap (mirrors the backtest).
  const pricesEurMwh: number[] = []
  const slots: number[] = []
  for (let h = 0; h < effHorizonSteps; h++) {
    const slot = input.currentSlot + h
    const p = input.priceBySlot[String(slot)]
    if (p == null || !Number.isFinite(p)) break
    pricesEurMwh.push(p)
    slots.push(slot)
  }
  if (pricesEurMwh.length < 1) return null

  // 2. P90 demand forecast from recent metered sessions (mean + high estimate).
  let profile: HourlyDemandProfile
  try {
    const toMs = slotStartMs(input.currentSlot)
    const fromMs = toMs - DEMAND_LOOKBACK_DAYS * 86_400_000
    const sessions = await getChargerSessions({
      stationId: input.stationId,
      fromIso: new Date(fromMs).toISOString(),
      toIso: new Date(toMs).toISOString(),
    })
    profile = buildHourlyDemandProfile(sessions, fromMs, toMs, mpc.dailyDemandCapKwh)
  } catch {
    // No session history → flat fallback profile (modest high estimate).
    profile = buildHourlyDemandProfile([], 0, 86_400_000, mpc.dailyDemandCapKwh)
  }

  const demandKw = slots.map((s) => demandKwAt(profile, slotStartMs(s)))
  const demandHiKw = slots.map((s) => demandHiKwAt(profile, slotStartMs(s)))

  // 2b. Inject the LIVE measured demand into the COMMITTED step. The forecast
  //     reflects historical sessions, not the cars plugged in this instant — so
  //     a real session at the reserve floor would otherwise leave demand[0]≈0
  //     and the LP would commit g[0]=0 (no grid import). We take the max so we
  //     never plan to serve LESS than the load already on-site, and mirror it
  //     into the high estimate so the adaptive reserve / stand-down logic sees
  //     the real load too. Future steps stay on the forecast (the receding
  //     horizon re-solves every tick).
  const liveDemandKw = input.liveDemandKw
  if (liveDemandKw != null && Number.isFinite(liveDemandKw) && liveDemandKw > 0 && demandKw.length > 0) {
    demandKw[0] = Math.max(demandKw[0], liveDemandKw)
    if (demandHiKw.length > 0) demandHiKw[0] = Math.max(demandHiKw[0], liveDemandKw)
  }

  // 3. v5 adaptive (uncertainty-sized) reserve floor — shared helper.
  let reserveFloorKwh: number[] | undefined
  let step1ReservePct = mpc.socFloorFrac * 100
  if (mpc.adaptiveReserve) {
    const sized = sizeAdaptiveReserveKwh({ capacityKwh: capKwh, demandKw, demandHiKw, mpc })
    reserveFloorKwh = sized.reserveFloorKwh
    step1ReservePct = sized.step1FloorPct
  }

  // 4. Solve the LP.
  //
  //    SITE CEILING = the LIVE site grid-import ceiling for this tick when the
  //    telemetry register reports one (> 0), else the static model cap. This is
  //    the TOTAL allowed import (controllable + aux) and becomes the wire's
  //    P_grid_clearance envelope — it is NOT reduced by aux.
  //
  //    CONTROLLABLE HEADROOM = site ceiling − aux/hotel baseload. AUX is a
  //    non-dispatchable grid draw the battery cannot offset (live-tested), so it
  //    permanently consumes part of the ceiling. The LP's `demand` vector is
  //    EV-only and aux is folded into the headroom on g — exactly as
  //    `solveHorizon`'s contract specifies and exactly as the backtest does
  //    (`headroomKw = siteGridLimitKw − residualBaseloadKw`). Passing the full
  //    ceiling here (the previous behaviour) let the LP believe it had ~aux kW
  //    more controllable grid than physically exists, biasing its projected SOC
  //    optimistic and breaking backtest↔live parity. This restores it.
  const glpk = await getGlpk()
  const energyKwh = (Math.min(Math.max(input.avgSocPct, 0), 100) / 100) * capKwh
  const staticCapKw = mpc.gridMaxKw || GRID_MAX_KW
  const siteCeilingKw =
    input.gridLimitKw != null && Number.isFinite(input.gridLimitKw) && input.gridLimitKw > 0
      ? input.gridLimitKw
      : staticCapKw
  // DYNAMIC AUX RESERVE: prefer the tick's measured aux (clamped to
  // [floor, cap]) over the fixed model constant — reserving a fixed 8 kW when
  // measured aux is ~0 derated every charging hour to 79 kW (see LiveMpcInput
  // docs). The backtest achieves the same via per-frame residualBaseloadKw.
  const auxKw0 =
    input.liveAuxKw != null && Number.isFinite(input.liveAuxKw)
      ? Math.min(Math.max(input.liveAuxKw, AUX_RESERVE_FLOOR_KW), AUX_RESERVE_CAP_KW)
      : mpc.auxReserveKw || 0
  const headroomKw = Math.max(0, siteCeilingKw - auxKw0)
  const dailyCapKwh = profile.dailyKwh > 0 ? profile.dailyKwh : mpc.dailyDemandCapKwh

  // v5 arbitrage stand-down: in a low/very-risky scenario, suspend planned
  // arbitrage discharge (cap → 0) so the LP just covers demand from the grid and
  // holds/opportunistically refills the pack, leaving it free for the real-time
  // emergency tap. No-op unless mpc.standDownEnabled.
  const standDown = decideStandDown({ capacityKwh: capKwh, energyKwh, demandHiKw, headroomKw, mpc })
  const effectiveDailyCapKwh = standDown.standDown ? 0 : dailyCapKwh

  // RISK REFILL DEFICIT: energy needed to lift the WEAKEST string to the refill
  // target (kWh), assuming two equal strings (cap/2 each). Feeds the solver's
  // cheap-slot-gated risk incentive so the PLAN shows the future refill — the
  // step-0 firm rule alone recharges correctly but invisibly (the plan showed
  // aux-only through the trough and the operator rightly lost trust in it).
  const riskRefillKwh =
    input.minSocPct != null &&
    Number.isFinite(input.minSocPct) &&
    mpc.lowSocRefillEnabled &&
    input.minSocPct / 100 < (mpc.lowSocRefillTargetFrac ?? 0.6)
      ? ((mpc.lowSocRefillTargetFrac ?? 0.6) - input.minSocPct / 100) * (capKwh / 2)
      : 0

  const res = await solveHorizon({
    glpk,
    energyKwh,
    capacityKwh: capKwh,
    pricesEurMwh,
    demandKw,
    headroomKw,
    dailyCapKwh: effectiveDailyCapKwh,
    reserveFloorKwh,
    riskRefillKwh,
    mpc,
  })

  // 4b. v5.1 FIRM COMMITTED ACTION. The LP commits only g[0]; because "now" is
  //     rarely the global optimum, g[0] is often 0 even when the firm intent is
  //     obvious (cheap slot + car plugged in, or low pack + cheap now). Run the
  //     risk-aware buy-now test on the visible curve, then override ONLY the
  //     committed clearance — the planned schedule/objective stay as solved.
  // Urgency keyed to the weakest string (riskSocFrac): with B2 at 41% the firm
  // buy-now must fire on today's cheap slots even though the average looks safe.
  const buy = decideBuyNow(pricesEurMwh, riskSocFrac, mpc)
  // Is there a horizon price spread that beats the round-trip cycling cost? If
  // not, discharging the pack to serve a car loses money vs grid import.
  const arb = arbitrageWorthIt(pricesEurMwh, mpc)
  // "Car connected" comes ONLY from live measured demand (trueDemandKw =
  // max(served, plugged-car accept) — detects even a throttled plugged car),
  // exactly like the backtest (`evConnected = evLoadKw > threshold`). The
  // FORECAST demand must NOT count: a historical-profile forecast can predict
  // demand with both connectors unplugged, which previously fired the firm
  // car-serve rules (e.g. firm_no_arb_car_grid importing forecast demand + aux
  // at expensive prices for a car that isn't there). The forecast still shapes
  // the LP's demand vector — it just can't claim a car is physically present.
  const evConnected0 =
    input.liveDemandKw != null &&
    Number.isFinite(input.liveDemandKw) &&
    input.liveDemandKw > mpc.evConnectThresholdKw
  const firm = applyFirmCommit({
    lpClearanceKw: res.clearanceKw,
    demandKw: demandKw[0] ?? 0,
    auxKw: auxKw0,
    headroomKw,
    // Weakest-string SOC: the refill rule must fire (and size its gap) on the
    // emptiest battery, and the high-SOC defer must NOT hold back charging
    // unless the weakest string is genuinely high.
    socFrac: riskSocFrac,
    evConnected: evConnected0,
    buyNow: buy.buyNow,
    cheapNow: buy.cheapNow,
    // NOW is the genuinely best visible slot → refill charges to the FULL
    // target instead of the SOC-scaled ramp (see FirmCommitInput.buyNowCheapest).
    buyNowCheapest: buy.reason === "buy_now_cheapest",
    materialCheaperAhead: buy.materialCheaperAhead,
    arbitrageWorthIt: arb.worthIt,
    mpc,
  })
  // The firm rule raises the COMMITTED clearance only; clamp to headroom.
  const committedClearanceKw = firm.clearanceKw
  const firmReason: FirmCommitReason = firm.reason

  // 5. Reconstruct the planned SOC trajectory from the grid schedule. The LP's
  //    energy balance is g[t] − c[t] + d[t] = demand[t], so the battery net is
  //    (g − demand): positive ⇒ charging (η_c), negative ⇒ discharging (1/η_d).
  //    Step 0 uses the firm-adjusted committed clearance so the projected SOC
  //    matches what we actually command now.
  const grid = res.gridScheduleKw.length ? res.gridScheduleKw : pricesEurMwh.map(() => res.clearanceKw)
  if (grid.length > 0) grid[0] = committedClearanceKw
  const dt = mpc.stepHours
  const ceil = mpc.socMaxFrac * capKwh
  const floorAbs = 0
  const steps: PlanStep[] = []
  let e = Math.min(Math.max(energyKwh, 0), ceil)
  for (let t = 0; t < grid.length; t++) {
    const socPct = capKwh > 0 ? (e / capKwh) * 100 : 0
    const reservePct =
      reserveFloorKwh && reserveFloorKwh[t] != null
        ? (reserveFloorKwh[t] / capKwh) * 100
        : mpc.socFloorFrac * 100
    steps.push({
      slot: slots[t],
      ts: new Date(slotStartMs(slots[t])).toISOString(),
      priceEurMwh: pricesEurMwh[t],
      // The COMMANDED grid request (P_grid_request) for this slot: the full
      // FULL planned import g[t] whenever the plan imports (g > eps), else 0.
      // Live BMS evidence showed request≈0 makes the station serve load from
      // the BATTERY, so cheap g≈demand slots must command g — not collapse to 0.
      // NOTE: SOC below still advances on the RAW g[t] (same value here now).
      gridKw: Math.round(commandedGridImportKw(grid[t], demandKw[t]) * 10) / 10,
      demandKw: Math.round(demandKw[t] * 10) / 10,
      socPct: Math.round(socPct * 10) / 10,
      reserveFloorPct: Math.round(reservePct * 10) / 10,
    })
    // Advance the buffer energy to the start of the next step on the RAW grid
    // draw (aux + EV + charge), NOT the commanded value.
    const net = grid[t] - demandKw[t]
    e += net >= 0 ? mpc.chargeEff * net * dt : (1 / mpc.dischargeEff) * net * dt
    e = Math.min(Math.max(e, floorAbs), ceil)
  }

  return {
    solvedAt: Date.now(),
    baseSlot: input.currentSlot,
    stepHours: dt,
    capacityKwh: capKwh,
    horizonSteps: grid.length,
    eventType: input.eventType,
    status: res.status,
    objectiveEur: res.z ?? null,
    // Committed grid REQUEST (P_grid_request): the FIRM-adjusted committed
    // clearance, passed through commandedGridImportKw (full g when the plan
    // imports, 0 only for intentional battery-serve/idle slots). The firm
    // layer raises the committed clearance for cheap+car / low-SOC-refill slots.
    clearanceKw: Math.round(commandedGridImportKw(committedClearanceKw, demandKw[0] ?? 0) * 10) / 10,
    // RAW planned grid draw g[0] (pre wire-reduction) for the dispatch sim's
    // physics — the firm committed clearance. In cheap slots it equals the load
    // served from grid (battery spared) and in expensive slots it drops toward 0.
    plannedGridKw: Math.round(Math.max(0, committedClearanceKw) * 10) / 10,
    // The SITE grid-import ceiling = the envelope for P_grid_clearance_w in
    // every scheduled command (live consumption limit or static cap). This is
    // the TOTAL allowed import (controllable + aux), NOT the aux-reduced LP
    // headroom the optimizer solved g against — the wire limit must remain the
    // full site allowance so aux is never double-charged against the device.
    gridImportLimitKw: Math.round(siteCeilingKw * 10) / 10,
    reserveFloorStep1Pct: Math.round(step1ReservePct * 10) / 10,
    // Authoritative SOC ceiling/floor for the wire, straight from the optimizer model
    // params — no heuristic target. socMaxFrac drives soc_cp_max_pct; the
    // emergency floor is the safe-mode reserve when a tick can't solve.
    socCeilingPct: Math.round(mpc.socMaxFrac * 1000) / 10,
    socFloorPct: Math.round(mpc.emergencyFloorFrac * 1000) / 10,
    adaptiveReserve: Boolean(mpc.adaptiveReserve),
    standDown: mpc.standDownEnabled ? standDown.standDown : undefined,
    standDownReason: standDown.standDown ? standDown.reason : undefined,
    // v5.1: the firm rule that set the committed clearance, and the SOC-shrunk
    // lookahead actually used. Report the REALIZED window length (after the SOC
    // shrink AND the DAM publish-gate truncation), matching the header's step
    // count ��� not the requested cap, which can overstate what the LP actually saw.
    firmCommitReason: firmReason,
    effectiveHorizonSteps: Math.min(effHorizonSteps, pricesEurMwh.length),
    steps,
  }
}
