/**
 * Tariff-comparison pricing engine — EXTRACTED into a pure lib module so BOTH
 * the client report (components/reports/tariff-comparison-report.tsx) and
 * server-side jobs (fleet yearly report builder) price with the EXACT same
 * engine: same counterfactual, same wear model, same defaults.
 *
 * This file must stay free of React / "use client" — it runs inside server
 * routes as well as in the browser.
 */

import { format } from "date-fns"
import type { RangeBacktestResult } from "@/app/actions/backtest"
import { berlinDayOf } from "@/lib/report-window"

/** "Aug 1" for a yyyy-mm-dd report day (tz-free — the day is already Berlin). */
function dayLabel(dayIso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${dayIso}T12:00:00Z`),
  )
}

/**
 * SETTLEMENT FIGURES — the Annex arithmetic that turns one `Computed` into the
 * euros every report prints. This is the ONLY place that derives them: the
 * site Financial Report tiles, the Fleet Monthly row, the Fleet Yearly sums
 * (Σ of monthly rows) and the Excel exports all read these fields, so the same
 * station-window can never show two different numbers on two pages.
 *
 *   flatEur         A5.1  flat-rate cost of the metered import
 *   noShiftEur      A6.2  dynamic procurement WITHOUT load shifting (peak-shave counterfactual)
 *   asRunEur        A6.1  dynamic procurement WITH load shifting (as run)
 *   procSavingEur   A5.3  flatEur − asRunEur
 *   wearNoShiftEur  A4.2  battery wear WITHOUT load shifting (forced peak-shaving cycling only)
 *   wearAsRunEur    A4.1  battery wear WITH load shifting (full as-run throughput)
 *   wearEur         A6.3  wearAsRunEur − wearNoShiftEur (extra wear the load shifting added)
 *   netEur          A5.4  procSavingEur − wearEur
 *   timingEur       A6.4  noShiftEur − asRunEur   (value of WHEN energy was bought)
 *   lsEur           A6.5  timingEur − wearEur     (load-shifting contribution)
 *
 *   Windows with no measured cycling collapse toward identity on their own —
 *   a battery that never shifts has ~0 extra throughput, so wearEur and lsEur
 *   fall to ~0 without special-casing. Telemetry outages contribute no frames
 *   and are shown as "no telemetry" gaps, never bridged into either world.
 *
 * The three procurement costs (flat / without LS / as run) and the three wear
 * figures (without LS / as run / extra) are ALL printed as columns on the
 * Fleet Monthly and Fleet Yearly tables (client request sep 3 2026) — the
 * fleet reader never has to reconstruct a component from a difference.
 */
export interface SettlementFigures {
  importKwh: number
  flatEur: number
  noShiftEur: number
  asRunEur: number
  procSavingEur: number
  wearNoShiftEur: number
  wearAsRunEur: number
  wearEur: number
  netEur: number
  timingEur: number
  lsEur: number
  /** kWh of extra battery throughput the load shifting caused. */
  shiftedKwh: number
  /** Effective flat rate actually applied, ct/kWh (= flatEur / importKwh × 100). */
  flatCtApplied: number
}

export function settlementFigures(c: Computed, wearCtPerKwh: number = DEFAULT_CYCLING_CT): SettlementFigures {
  const wearEurPerKwh = wearCtPerKwh / 100
  return {
    importKwh: c.totalImportKwh,
    flatEur: c.flatCost,
    noShiftEur: c.procurementNoArbCost - c.socEdgeCreditEur,
    asRunEur: c.dynamicCost,
    procSavingEur: c.flatCost - c.dynamicCost,
    wearNoShiftEur: c.wearNoArb,
    wearAsRunEur: c.wearWithArb,
    wearEur: c.arbExtraWear,
    netEur: c.netSaving,
    timingEur: c.timingValue,
    lsEur: c.arbNetContribution,
    shiftedKwh: wearEurPerKwh > 0 ? c.arbExtraWear / wearEurPerKwh : 0,
    flatCtApplied: c.totalImportKwh > 0 ? (100 * c.flatCost) / c.totalImportKwh : 0,
  }
}

// 15-minute dispatch slot in ms — used to align frames to the IDM price grid.
export const SLOT_MS = 900_000

// German market defaults (cents per kWh). Editable via the report sliders.
// Exported so the fleet-projection page prices with identical assumptions.
export const DEFAULT_FLAT_CT = 12.5 // fixed flat energy rate (energy-only, excludes grid fees)
export const DEFAULT_ADDER_CT = 0 // optional non-energy add-on on top of the IDM index
// Battery economics defaults.
export const DEFAULT_CYCLING_CT = 3.5 // €0.035 / kWh of battery throughput (LFP wear / round-trip degradation)

/**
 * ENERGY-BALANCE METHOD for "procurement WITHOUT load shifting"
 * (method 2026-09-04.4, client decision 4 sep 2026).
 *
 * Until .3 the no-LS import was REBUILT from scratch: a per-frame simulation
 * served the site load through the grid wall, peak-shaved with a modelled
 * pack, recharged it at an efficiency, integrated, and the ~6 000 kWh result
 * was compared with the ~6 000 kWh grid meter. The wanted signal is a
 * 0.5–1 % difference of those two absolutes, and every definitional choice
 * inside the rebuild (site-load definition, efficiency, SOC edges, sampling)
 * landed on the difference at full weight — four fixes in two days, and the
 * result still exceeded the meter on legacy windows.
 *
 * The client's rule replaces the rebuilt absolute with the energy balance at
 * the AC bus. Both worlds serve the same site load and start/end at the same
 * SOC; they differ ONLY in how much the battery was cycled:
 *
 *   as-run : import = load + (1−η)·C_asrun  + η_d·ΔSOC
 *   no-LS  : import = load + (1−η)·C_ps     + η_d·ΔSOC
 *   ⇒ noLS_import = measured_import − LS_LOSS_SHARE × max(0, C_asrun − C_ps)
 *
 * C_asrun is the battery METER's gross charge (AC side); C_ps is the charge a
 * peak-shave-only pack needs (the per-frame simulation still supplies it,
 * grid side). Properties: anchored on the billed grid meter; only the
 * DIFFERENCE in cycling is modelled, × 3 %, so a 10 % battery-meter error
 * moves the result ~2 kWh instead of ~200; ≤ measured import by construction.
 *
 * LS_LOSS_SHARE = 3 % is the client's choice (4 sep 2026). Metered fleet
 * round trip: Gronau all-history 0.959, Gifhorn 0.964 (mean 4.0 % loss),
 * monthly range 0.955–0.986 (1.4–4.5 %); 3 % sits inside that band on the
 * favourable side. Norderstedt's meter reads > 1 (vendor T4) and is excluded
 * from the calibration. The window's OWN meter ratio stays frozen per day
 * (battMeter*) and is shown as a diagnostic next to the constant, so the
 * choice is auditable on any window the client picks. Changing the share is a
 * methodology bump + month refills only: the rule is applied at READ time
 * from frozen per-day inputs (import, meter charge, peak-shave charge).
 *
 * The simulation's own total (`sim*`) is kept as a diagnostic and as the
 * 15-min SHAPE for pricing: the no-LS € is the simulated € scaled by
 * rule kWh / sim kWh, so "timing value" remains a price-weighted integral.
 */
export const LS_LOSS_SHARE = 0.03
/** Round trip the peak-shave simulation grosses its recharge with — tied to
 *  the loss share so the sim's grid-side C_ps and the rule use ONE number. */
const NO_ARB_ROUND_TRIP_EFF = 1 - LS_LOSS_SHARE

export interface EnergyBalanceInput {
  /** Measured grid import over the segment (kWh). */
  importKwh: number
  /** Battery METER gross charge over the segment (kWh, AC side). */
  meterChargeKwh: number
  /** Peak-shave-only charge the counterfactual pack needs (kWh, grid side). */
  psChargeGridKwh: number
  /** The per-frame simulation's own no-LS import and € for the segment (shape). */
  simKwh: number
  simEur: number
}
export interface EnergyBalanceResult {
  kwh: number
  eur: number
  /** max(0, meter charge − peak-shave charge): the cycling LS added (kWh). */
  extraChargeKwh: number
}

/**
 * The rule for ONE segment (a raw replay or one frozen day). Pure and shared
 * by compute()'s raw path and the frozen-day recomposition so a Berlin month
 * (2 h raw head + 30 frozen days + 22 h raw tail) settles exactly like a full
 * raw replay would. € = sim € × (rule kWh / sim kWh); when the simulation has
 * no volume the rule kWh is priced at the given fallback rate.
 */
export function energyBalanceNoLs(input: EnergyBalanceInput, fallbackEurPerKwh = 0): EnergyBalanceResult {
  const extraChargeKwh = Math.max(0, input.meterChargeKwh - input.psChargeGridKwh)
  const kwh = Math.max(0, input.importKwh - LS_LOSS_SHARE * extraChargeKwh)
  const eur =
    input.simKwh > 0 && Number.isFinite(input.simEur) ? input.simEur * (kwh / input.simKwh) : kwh * fallbackEurPerKwh
  return { kwh, eur, extraChargeKwh }
}
/** What rows frozen BEFORE 2026-09-04.1 grossed their baseline recharge with.
 *  Those days have no raw frames left (retention starts ~Jul 30 2026), so they
 *  cannot be re-frozen. Their known 0.85 term is removed ALGEBRAICALLY at read
 *  time instead — deterministic from the frozen noArbChargeKwh — and the
 *  affected € repriced at the day's own average baseline price. Windows
 *  containing such days carry `supersededEffDays > 0` and are badged. */
const LEGACY_NO_ARB_EFF = 0.85
/** Below this metered charge (kWh) the window ratio is noise → not reported. */
const BATT_METER_EFF_MIN_CHARGE_KWH = 200

/**
 * The pack's own round-trip ratio over a window, straight from its meter —
 * UNBOUNDED and purely diagnostic (a biased meter shows as > 1, which is the
 * point). `null` when the window carries too little cycling to be meaningful.
 * Pure — shared by the raw path in compute() and the frozen-day recomposition.
 */
export function batteryMeterRoundTripEff(input: {
  chargeKwh: number
  dischargeKwh: number
  socDeltaKwh: number
}): number | null {
  const denom = input.chargeKwh - input.socDeltaKwh
  if (!(input.chargeKwh >= BATT_METER_EFF_MIN_CHARGE_KWH) || !(input.dischargeKwh > 0) || !(denom > 0)) return null
  return input.dischargeKwh / denom
}

export interface DayBucket {
  dayIso: string
  label: string
  importKwh: number
  flatCost: number
  dynamicCost: number
  idmWeightedCt: number // energy-weighted avg IDM index for the day (ct/kWh)
}

/** One point of the battery state-of-charge time series over the window. */
export interface SocPoint {
  label: string // compact x-axis tick label
  fullLabel: string // full timestamp for the tooltip
  arbSoc: number // as-run system SOC (%) — the load shifting trajectory
  noArbSoc: number // grid-first counterfactual SOC (%)
}

export interface BattDetailPoint {
  hour: number
  fullLabel: string
  battKw: number // signed BMS battery power (+charge / −discharge)
  socPct: number // measured SOC (%)
  cumBmsKwh: number // running Σ|battKw|·dt — the wear basis
  cumDeadbandKwh: number // running share of the above accrued at |battKw| < DEADBAND_KW
  cumSocKwh: number // running Σ|ΔSOC|×capacity — what SOC movement implies
  cumNoArbKwh: number // running SIMULATED no-load-shifting throughput (2× forced peak-shave)
}

/** Diagnostics decomposing the measured battery throughput. */
export interface ThroughputDiag {
  bmsKwh: number // Σ|battKw|·dt over this (downsampled) series
  chargeKwh: number // positive-power share
  dischargeKwh: number // negative-power share
  deadbandKwh: number // share accrued at |battKw| < DEADBAND_KW (idle jitter/balancing)
  socImpliedKwh: number // Σ|ΔmeasuredSOC| × capacity — movement the SOC trace can account for
  noArbDischargeKwh: number // simulated counterfactual: forced peak-shave discharge
  noArbChargeKwh: number // simulated counterfactual: recharge from spare headroom (as simulated)
}

/**
 * One point of the grid-import comparison (Dispatching Overview conventions:
 * import below zero, EV above, price on the right axis, shift bands stacked
 * downward between the two import curves).
 */
export interface ImportPoint {
  hour: number // numeric x — hours since window start (same axis as the overview)
  fullLabel: string // full timestamp for the tooltip
  importNegKw: number // measured grid import, drawn below zero
  noArbNegKw: number // counterfactual grid-first import, drawn below zero (dashed)
  /** EV delivered, drawn above zero. METERED per-connector power (C1+C2) when
   *  the series carries connector counters; otherwise the site-load signal
   *  (labelled as such by the UI). Gronau defect 2. */
  evPosKw: number
  /** ChargePost AUX/hotel draw = site load − metered EV; null when the series
   *  has no connector counters. Stacked on evPosKw so the stack top = site load. */
  auxPosKw: number | null
  price: number | null // market price €/MWh (right axis, stepAfter)
  shiftBaseNeg: number // −min(actual, noArb) — transparent stack base
  shiftInNeg: number // actual > baseline: import PULLED INTO this slot (buying cheap)
  shiftOutNeg: number // actual < baseline: import PUSHED OUT (battery served instead)
}

export interface Computed {
  totalImportKwh: number
  flatCost: number
  dynamicCost: number
  diff: number // flat − dynamic (positive ⇒ dynamic is cheaper)
  diffPct: number
  flatBlendedCt: number
  dynamicBlendedCt: number
  avgIdmCt: number
  days: DayBucket[]
  pricedFraction: number // share of import kWh priced by any market price (IDM or DAM)
  idmFraction: number // share priced by a real IDM slot price
  damFraction: number // share priced by the DAM day-ahead fallback
  // ── Battery wear / cycling cost — the two-figure fair-comparison model ──
  throughputWithArbKwh: number
  wearWithArb: number // throughputWithArb × cycling rate (€)
  throughputNoArbKwh: number
  // Measured-overheads decomposition of throughputNoArbKwh:
  // raw ideal round trip (2× forced shave) × (1 + jitterShare + gapShare).
  throughputNoArbRawKwh: number
  noArbJitterShare: number // measured deadband kWh / BMS kWh (e.g. 0.03)
  noArbGapShare: number // measured (BMS − SOC-implied) / BMS kWh, clamped ≥ 0
  noArbOverheadFactor: number // 1 + jitterShare + gapShare
  wearNoArb: number // throughputNoArb × cycling rate (€) — peak-shave-only baseline wear
  arbExtraWear: number // wearWithArb − wearNoArb: extra wear the load shifting adds vs peak-shave
  socSeries: SocPoint[]
  importSeries: ImportPoint[]
  importOriginMs: number
  battDetailSeries: BattDetailPoint[]
  /** Telemetry holes (> GAP_BREAK_H between consecutive samples) as chart-hour
   *  ranges. The chart series above carry null markers inside each hole so no
   *  line bridges it — a gap renders as a gap, never as invented data
   *  (client escalation sep 3 2026: Norderstedt's 24–31 Aug outage was drawn
   *  as a flat bridged line). Chart-only; settlement totals never see these. */
  telemetryGaps: { x1: number; x2: number }[]
  /** Timestamp of the last frame actually included (a "to = today" window is
   *  clipped at the freshest ingested frame). Stamped in the footer. */
  dataThroughIso: string
  /** Timestamp of the FIRST frame actually included. A station onboarded
   *  mid-month (Gifhorn: 20 Aug 2026) has a window that starts here, not on
   *  the 1st — the report must say so instead of implying a full month. */
  dataFromIso: string
  /** Distinct Berlin days that carry at least one frame (or a rollup day).
   *  Gaps inside the window (Norderstedt 24–31 Aug 2026 outage) reduce this
   *  below the calendar day count. */
  coveredDays: number
  throughputDiag: ThroughputDiag
  // Total usable pack capacity (kWh), derived from the engine throughput/cycles.
  totalCapacityKwh: number
  // Net operating cost = energy procurement + actual (with-load shifting) wear.
  flatNet: number
  dynamicNet: number
  // Net total saving = gross energy saving − extra load shifting wear.
  netSaving: number
  netSavingPct: number // netSaving as a share of the flat-tariff net cost
  // ── Informational: load shifting participation in the saving ────────────
  /** Procurement WITHOUT load shifting, kWh — ENERGY-BALANCE rule (method
   *  2026-09-04.4): measured import − LS_LOSS_SHARE × extra battery charge.
   *  ≤ totalImportKwh by construction on every energy-balance segment. */
  noArbImportKwh: number
  /** That volume priced on the simulation's 15-min shape (IDM/DAM + adder), €. */
  procurementNoArbCost: number
  noArbBlendedCt: number // baseline blended ct/kWh (procurementNoArbCost / noArbImportKwh)
  // ── Energy-balance diagnostics (method 2026-09-04.4) ─────────────────────
  /** The loss share applied (LS_LOSS_SHARE). */
  lsLossShare: number
  /** Σ max(0, meter charge − peak-shave charge) over the window (kWh): the
   *  battery cycling the load shifting added. × lsLossShare = kWh removed. */
  lsExtraChargeKwh: number
  /** Peak-shave-only charge the counterfactual pack needed, grid side (kWh). */
  psChargeGridKwh: number
  /** The per-frame simulation's OWN no-LS import / € (the pre-.4 headline),
   *  kept as the pricing shape and as an audit value next to the rule. */
  simNoArbImportKwh: number
  simNoArbCostEur: number
  /** Segments settled with the rule: frozen days + 1 for a raw segment. */
  energyBalanceSegments: number
  /** End-of-window stored-energy difference (baseline − as-run), kWh. The
   *  baseline parks energy in the pack at ~95% — bought but never consumed. */
  storedDiffKwh: number
  // ── Baseline pack efficiency (method 2026-09-04.1) ───────────────────────
  /** Round-trip efficiency the counterfactual recharge was grossed up with:
   *  the fleet's METERED constant (0.96; was an assumed 0.85 before). */
  noArbRoundTripEff: number
  /** What THIS window's battery meter says the pack did — Σdischarge /
   *  Σ(charge − ΔSOC) over raw days + frozen days recomposed; unbounded,
   *  `null` below 200 kWh of cycling. Audit value against the constant. */
  battMeterRoundTripEff: number | null
  /** The three meter inputs behind it (kWh). */
  battMeterChargeKwh: number
  battMeterDischargeKwh: number
  battMeterSocDeltaKwh: number
  /** Frozen days in this window that carry NO energy-balance inputs (frozen
   *  before 2026-09-04.1, no battery-meter legs, no raw frames left to
   *  re-freeze). They fall back to their frozen SIMULATED baseline with the
   *  0.85→η term removed algebraically; the badge on the LS card discloses
   *  them. After the 4 sep 2026 re-hydration only Gronau 3–8 Jun remain. */
  supersededEffDays: number
  /** kWh removed from the baseline import by that correction (≥ 0). */
  supersededEffKwh: number
  /** € removed from the baseline cost by that correction (≥ 0). */
  supersededEffEur: number
  /** € credit for that stored-energy difference (valued at the blended market
   *  rate); already subtracted from timingValue. */
  socEdgeCreditEur: number
  timingValue: number // procurementNoArbCost − dynamicCost: € saved by WHEN energy was bought vs peak-shave baseline
  arbNetContribution: number // timingValue − arbExtraWear (the load-shifting contribution)
  arbShareOfNetPct: number // arbNetContribution / netSaving × 100 (when netSaving > 0)
  // ── Provenance (lossless rollups, sep 2 2026) ────────────────────────────
  /** Frozen days that contributed the full tariff block (counterfactual + wear). */
  rollupTariffDays: number
  /** Frozen days that predate the lossless payload — priced import only. */
  rollupLegacyDays: number
  /** Contiguous raw-frame segments the baseline was trued-up over. */
  rawSegments: number
}

// The full engine — body unchanged from the report component; see the report
// file's header comment for the methodology narrative.
export function compute(
  result: RangeBacktestResult,
  idmBySlot: Map<number, number>,
  flatCt: number,
  adderCt: number,
  cyclingCt: number,
  gridCapKw: number,
): Computed | null {
  const series = result.series ?? []
  // Days older than the raw retention window arrive as frozen daily rollups
  // (no 15s series). They carry importKwh + frozen market energy cost, so the
  // tariff comparison still prices them — at daily granularity — below.
  const rollupDays = result.rollupDays ?? []
  if (series.length === 0 && rollupDays.length === 0) return null

  const flatPerKwh = flatCt / 100
  const adderPerKwh = adderCt / 100
  const cyclingPerKwh = cyclingCt / 100

  const dayMap = new Map<string, DayBucket>()
  let totalImportKwh = 0
  let flatCost = 0
  let dynamicCost = 0
  let idmEnergyCtSum = 0 // Σ import·indexCt (for energy-weighted avg applied index)
  let pricedImportKwh = 0 // kWh priced by any market price (IDM or DAM)
  let idmImportKwh = 0 // kWh priced by a real IDM slot price
  let damImportKwh = 0 // kWh priced by the DAM day-ahead fallback
  let lastMarketEurMwh: number | null = null // last IDM-or-DAM price, for gap carry-forward
  let throughputNoArbKwh = 0
  let noArbImportKwh = 0
  let noArbDynamicCost = 0

  // ── SOC comparison setup ──────���─────────────────────────────────────────
  const kpiThroughput = result.kpis?.batteryThroughputKwh ?? 0
  const kpiCycles = result.kpis?.batteryCycles ?? 0
  let totalCapacityKwh = kpiCycles > 0 ? kpiThroughput / (2 * kpiCycles) : 190
  if (!Number.isFinite(totalCapacityKwh) || totalCapacityKwh <= 0) totalCapacityKwh = 190
  const first = series[0]
  const firstMeasured =
    first?.actualB1SocPct != null && first?.actualB2SocPct != null
      ? (first.actualB1SocPct + first.actualB2SocPct) / 2
      : null
  const firstSocPct = Math.max(0, Math.min(100, firstMeasured ?? first?.socPct ?? 100))
  // SOC-ANCHORED BASELINE (client decision aug 21 2026): the counterfactual
  // pack starts at the MEASURED start SOC, HOLDS that level through the window
  // (discharging only for above-cap surplus and re-buying it back), and is
  // finally TRUED UP to the MEASURED end SOC — both window edges match reality
  // exactly, so procurement totals are directly comparable with NO separate
  // stored-energy credit line. This replaced two earlier conventions that each
  // confused: (a) start-at-measured + fill-to-95% ("phantom top-up" import in
  // quiet hours), (b) start-at-95% + delta credit (opaque "−63 kWh left in
  // pack" settlements).
  const actualStartKwh = (firstSocPct / 100) * totalCapacityKwh
  let socNoArbKwh = actualStartKwh
  // Compact vs full x-axis labels depending on how long the window is.
  // (series can be empty on a pure-rollup range — the loop below just no-ops.)
  const spanMs =
    series.length > 0
      ? new Date(series[series.length - 1].ts).getTime() - new Date(series[0].ts).getTime()
      : 0
  const multiDay = series.length > 0 ? spanMs > 26 * 60 * 60 * 1000 : true
  const socSeries: SocPoint[] = []
  const importSeries: ImportPoint[] = []
  // ONE EV definition (Gronau defect 2): chart "EV delivered" is the METERED
  // connector power when the series has counters; AUX is the residual.
  const hasMeteredEv = series.some((p) => p.mEv1Kw != null || p.mEv2Kw != null)
  const DEADBAND_KW = 2
  const battDetailSeries: BattDetailPoint[] = []
  let diagBmsKwh = 0
  let diagChargeKwh = 0
  let diagDischargeKwh = 0
  let diagDeadbandKwh = 0
  let diagSocImpliedKwh = 0
  let prevDiagSocPct: number | null = null
  let diagNoArbDischargeKwh = 0
  let diagNoArbChargeKwh = 0
  const importOriginMs =
    series.length > 0 ? new Date(series[0].ts).getTime() - series[0].hour * 3_600_000 : 0

  // ── RAW SEGMENTS (lossless rollups, sep 2 2026) ─────────────────────────
  // A hybrid range's raw series is no longer one continuous run: a Berlin
  // month = a 2h raw HEAD (Jul 31 22:00Z→midnight) + 30 frozen rollup days +
  // a 22h raw TAIL. The SOC-anchored baseline must be trued up PER CONTIGUOUS
  // RAW SEGMENT (its own start → end SOC); the rollup days carry their own
  // frozen true-ups. Treating head+tail as one segment would true-up across
  // the rollup days and double count their stored-energy movement. Segment
  // breaks: a `fromRollup` transition or a gap > SEGMENT_GAP_H.
  // `fromRollup` points (expanded 15-min chart series of frozen days) are
  // plotted but NEVER accumulated — their totals are the frozen scalars.
  const SEGMENT_GAP_H = 3
  const measuredSocPctOf = (p: RangeBacktestResult["series"][number]): number | null =>
    p.actualB1SocPct != null && p.actualB2SocPct != null ? (p.actualB1SocPct + p.actualB2SocPct) / 2 : null

  // ── Battery-meter ΔSOC over the RAW segments (diagnostic) ─────────────────
  // Integrated with the SAME segment rule the loop applies (raw points only; a
  // break = fromRollup transition or a gap > SEGMENT_GAP_H) so it pairs with
  // the full-resolution meter legs in `totals` for battMeterRoundTripEff.
  let rawSocDeltaKwh = 0
  {
    let segStartPct: number | null = null
    let segLastPct: number | null = null
    for (let i = 0; i < series.length; i++) {
      const p = series[i]
      if (p.fromRollup === true) continue
      const prevPt = i > 0 ? series[i - 1] : null
      const brk =
        i === 0 ||
        p.segStart === true ||
        prevPt?.fromRollup === true ||
        Math.max(0, p.hour - (prevPt?.hour ?? p.hour)) > SEGMENT_GAP_H
      if (brk) {
        if (segStartPct != null && segLastPct != null) rawSocDeltaKwh += ((segLastPct - segStartPct) / 100) * totalCapacityKwh
        segStartPct = measuredSocPctOf(p) ?? p.socPct ?? null
        segLastPct = segStartPct
      }
      const m = measuredSocPctOf(p)
      if (m != null) segLastPct = m
    }
    if (segStartPct != null && segLastPct != null) rawSocDeltaKwh += ((segLastPct - segStartPct) / 100) * totalCapacityKwh
  }
  const rawMeterChargeKwh = result.totals?.battChargeKwh ?? 0
  const rawMeterDischargeKwh = result.totals?.battDischargeKwh ?? 0
  const noArbEff = NO_ARB_ROUND_TRIP_EFF

  let segStartKwh = actualStartKwh
  let segLastMeasuredSocPct: number | null = null
  let socTrueUpKwh = 0 // Σ per-segment (measured end − baseline end), kWh
  let socTrueUpImportKwh = 0 // grid-meter kWh of those true-ups (signed)
  let rawSegments = 0
  const closeRawSegment = () => {
    if (segLastMeasuredSocPct == null) return
    const endKwh = (Math.max(0, Math.min(100, segLastMeasuredSocPct)) / 100) * totalCapacityKwh
    const delta = endKwh - socNoArbKwh
    socTrueUpKwh += delta
    socTrueUpImportKwh += delta > 0 ? delta / noArbEff : delta * noArbEff
    throughputNoArbKwh += Math.abs(delta)
    if (delta > 0) diagNoArbChargeKwh += delta
    else diagNoArbDischargeKwh += Math.abs(delta)
    if (socSeries.length > 0) {
      socSeries[socSeries.length - 1].noArbSoc = Math.max(0, Math.min(100, segLastMeasuredSocPct))
    }
    if (battDetailSeries.length > 0) {
      battDetailSeries[battDetailSeries.length - 1].cumNoArbKwh += Math.abs(delta)
    }
    segLastMeasuredSocPct = null
  }
  const openSegment = (p: RangeBacktestResult["series"][number]) => {
    const measured =
      p.actualB1SocPct != null && p.actualB2SocPct != null
        ? (p.actualB1SocPct + p.actualB2SocPct) / 2
        : null
    const startPct = Math.max(0, Math.min(100, measured ?? p.socPct ?? firstSocPct))
    segStartKwh = (startPct / 100) * totalCapacityKwh
    socNoArbKwh = segStartKwh
    prevDiagSocPct = null
  }

  // Typical frame stride of THIS series (downsampled to ≤600 points) — clamp
  // frame dt at 2× the median gap so genuine data gaps are capped while the
  // regular stride integrates fully.
  const gaps: number[] = []
  for (let i = 1; i < series.length; i++) {
    const g = series[i].hour - series[i - 1].hour
    if (g > 0) gaps.push(g)
  }
  gaps.sort((a, b) => a - b)
  const medianGapH = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 0.25
  const maxDtH = Math.min(6, Math.max(0.5, 2 * medianGapH))

  // ── REAL GRID IMPORT WALL for the counterfactual (baseline only) ─────────
  // The configured siteGridLimitKw is a flat operator override (aug 21 2026,
  // ~87-90 kW) that ignores each site's real DSO/physical import limit. The
  // grid-first baseline caps import at that value, so at a site whose true
  // ceiling is far lower (Norderstedt: measured import forms a razor-sharp wall
  // at ~60 kW — p99.9 59.5 ≈ max 59.7) the baseline assumes grid headroom that
  // does not physically exist. It then under-discharges the pack and OVERSTATES
  // extra load-shift wear (client escalation sep 3 2026). Derive the wall from
  // THIS window's MEASURED import (import = +actualGridKw, same convention as
  // actualImportKw at line ~529) via a high percentile (single-frame-glitch
  // robust) and NEVER raise it above the configured cap, so sites that truly
  // use their headroom (Gronau ~86, Gifhorn ~91) are unaffected. The sharp-wall
  // sites re-derive the same value every day, so the per-day freeze is stable;
  // quiet-day error is bounded to cents and never breaks the frozen==live
  // invariant (closed days always read their frozen daily scalar). Baseline
  // only — as-run and dispatch planning untouched.
  let configuredCapKw = gridCapKw
  const importSamplesKw: number[] = []
  for (const p of series) {
    const cc = p.siteGridLimitKw != null && p.siteGridLimitKw > 0 ? p.siteGridLimitKw : gridCapKw
    if (cc > configuredCapKw) configuredCapKw = cc
    const impKw = Math.max(0, p.actualGridKw ?? 0)
    if (impKw > 0) importSamplesKw.push(impKw)
  }
  let derivedWallKw = configuredCapKw
  if (importSamplesKw.length >= 20) {
    importSamplesKw.sort((a, b) => a - b)
    const idx = Math.min(importSamplesKw.length - 1, Math.floor(importSamplesKw.length * 0.999))
    derivedWallKw = Math.min(configuredCapKw, Math.max(1, Math.ceil(importSamplesKw[idx])))
  }

  for (let i = 0; i < series.length; i++) {
    const p = series[i]
    const isRollupPt = p.fromRollup === true
    const prevPt = i > 0 ? series[i - 1] : null
    const gapH = prevPt ? Math.max(0, p.hour - prevPt.hour) : 0
    const segmentBreak =
      i === 0 ||
      p.segStart === true ||
      (prevPt?.fromRollup === true) !== isRollupPt ||
      gapH > SEGMENT_GAP_H
    if (segmentBreak) {
      if (prevPt && prevPt.fromRollup !== true) closeRawSegment()
      openSegment(p)
      if (!isRollupPt) rawSegments++
    }
    let dtH = medianGapH
    if (i > 0 && !segmentBreak) dtH = Math.min(maxDtH, gapH)

    // REPORT-DAY bucketing (sep 3 2026): Europe/Berlin calendar day, NOT the
    // runtime's local day. The client (browser) and the fleet builder (server,
    // UTC) used to bucket differently, so the same window printed "over 32
    // days" on one page and 31 on another. Totals were never affected — only
    // the per-day table and its count — but a report must not say two things.
    const d = new Date(p.ts) // chart tick labels only (SOC / import series)
    const dayIso = berlinDayOf(p.ts)
    // Day buckets (Financial "per day" table) come from RAW points only; rollup
    // days are appended from their frozen columns further down.
    let bucket = isRollupPt ? null : (dayMap.get(dayIso) ?? null)
    if (!bucket && !isRollupPt) {
      bucket = {
        dayIso,
        label: dayLabel(dayIso),
        importKwh: 0,
        flatCost: 0,
        dynamicCost: 0,
        idmWeightedCt: 0,
      }
      dayMap.set(dayIso, bucket)
    }

    // NO-ARBITRAGE / GRID-FIRST counterfactual: grid serves everything up to
    // its cap; battery discharges ONLY for EV surplus above headroom.
    const perPointCapKw =
      p.siteGridLimitKw != null && p.siteGridLimitKw > 0 ? p.siteGridLimitKw : gridCapKw
    // Peak-shave against the site's REAL import wall, not the flat override.
    // min() keeps a legit lower per-site config; derivedWallKw is ≤ configured.
    const capKw = Math.min(perPointCapKw, derivedWallKw)
    const baseKw = Math.max(0, p.baseloadKw ?? 0)
    const gridAvail = Math.max(0, capKw - baseKw)
    // ── Load the counterfactual must serve (method 2026-09-04.3) ────────────
    // The SIGNED metered site load (battery − grid), not `baseload + evKw`.
    // The old sum was max(power balance, EV counter) per frame: the EV
    // register books energy in lumps, so whenever it ran AHEAD of the power
    // balance the baseline served the counter, and whenever it ran BEHIND the
    // baseline served the balance — a one-sided over-count (Gifhorn Aug +18,
    // Gronau +44, Norderstedt +224 kWh/month) that put the projection ABOVE
    // the measured import even with a perfect efficiency. Serving the signed
    // balance is energy-conserving (Σ = import − export − battery net), so the
    // two worlds now differ only by what each battery did. AUX stays a
    // grid-only floor (baseKw); the battery-servable remainder is
    // siteLoad − AUX and may go NEGATIVE in meter-jitter frames — kept signed
    // so the jitter cancels rather than rectifies. Series without the field
    // (rollup-expanded chart points, older payloads) fall back to the old sum.
    const servedKw = p.siteLoadKw != null ? p.siteLoadKw : baseKw + Math.max(0, p.evKw ?? 0)
    const evKw = servedKw - baseKw
    const surplusDischargeKwh = Math.max(0, evKw - gridAvail) * dtH
    const noArbFrameKwh = 2 * surplusDischargeKwh
    if (!isRollupPt) throughputNoArbKwh += noArbFrameKwh

    const dischargeKwh = Math.min(surplusDischargeKwh, socNoArbKwh)
    socNoArbKwh -= dischargeKwh
    // Recharge headroom never grows from a negative (jitter) frame load.
    const rechargeHeadroomKw = Math.max(0, gridAvail - Math.max(0, evKw))
    // Hold the MEASURED SEGMENT-START level (not 95%): the baseline only
    // re-buys what peak shaving forced out of the pack, so a quiet day shows
    // ZERO baseline battery activity — no phantom imports (client decision
    // aug 21 2026). Per raw segment since sep 2 2026 (see closeRawSegment).
    const noArbTargetKwh = segStartKwh
    // Recharge headroom is a GRID-side (terminal) power limit, but rechargeKwh
    // is CELL energy that the meter sees grossed up by 1/EFF (line ~513). Limit
    // the cell energy to headroom×dt×EFF so the grossed-up import (rechargeKwh /
    // EFF) can never exceed the grid headroom — otherwise the grid-first
    // projection imports ABOVE the physical cap (Gronau: 96.7 kW vs 90 kW cap,
    // client escalation sep 3 2026). Total import now stays ≤ capKw by
    // construction: site-serve (≤cap) + recharge-import (≤ spare headroom).
    // Volume-neutral over the window (SOC restoration need is unchanged) — it
    // only spreads recharge across enough headroom frames instead of cramming
    // it over the cap in one frame.
    const rechargeKwh = Math.min(
      rechargeHeadroomKw * dtH * noArbEff,
      Math.max(0, noArbTargetKwh - socNoArbKwh),
    )
    socNoArbKwh += rechargeKwh
    const noArbSocPct = totalCapacityKwh > 0 ? (socNoArbKwh / totalCapacityKwh) * 100 : 0
    const measuredSoc =
      p.actualB1SocPct != null && p.actualB2SocPct != null
        ? (p.actualB1SocPct + p.actualB2SocPct) / 2
        : null
    socSeries.push({
      label: multiDay ? format(d, "MMM d") : format(d, "HH:mm"),
      fullLabel: format(d, "MMM d, HH:mm"),
      arbSoc: Math.max(0, Math.min(100, measuredSoc ?? p.socPct ?? 0)),
      noArbSoc: Math.max(0, Math.min(100, noArbSocPct)),
    })

    // ── Throughput drill-down: audit how Σ|battKw|·dt is built ─────────────
    {
      const bKw = p.battKw ?? 0
      const absKwh = Math.abs(bKw) * dtH
      const socHere = measuredSoc ?? p.socPct ?? null
      if (!isRollupPt) {
        diagBmsKwh += absKwh
        if (bKw > 0) diagChargeKwh += absKwh
        else diagDischargeKwh += absKwh
        if (Math.abs(bKw) < DEADBAND_KW) diagDeadbandKwh += absKwh
        if (socHere != null && prevDiagSocPct != null) {
          diagSocImpliedKwh += (Math.abs(socHere - prevDiagSocPct) / 100) * totalCapacityKwh
        }
        if (socHere != null) {
          prevDiagSocPct = socHere
          segLastMeasuredSocPct = socHere
        }
        diagNoArbDischargeKwh += dischargeKwh
        diagNoArbChargeKwh += rechargeKwh
      }
      battDetailSeries.push({
        hour: p.hour,
        fullLabel: format(d, "MMM d, HH:mm"),
        battKw: bKw,
        socPct: Math.max(0, Math.min(100, socHere ?? 0)),
        cumBmsKwh: diagBmsKwh,
        cumDeadbandKwh: diagDeadbandKwh,
        cumSocKwh: diagSocImpliedKwh,
        cumNoArbKwh: diagNoArbDischargeKwh + diagNoArbChargeKwh,
      })
    }

    // Price this frame's 15-min slot: IDM → DAM fallback → carry-forward.
    const slot = Math.floor(new Date(p.ts).getTime() / SLOT_MS)
    const idmHere = idmBySlot.get(slot)
    const damHere = p.priceEurMwh
    let priceEurMwh: number | null = null
    let priceSource: "idm" | "dam" | "carry" = "carry"
    if (idmHere != null && Number.isFinite(idmHere)) {
      priceEurMwh = idmHere
      priceSource = "idm"
    } else if (damHere != null && Number.isFinite(damHere)) {
      priceEurMwh = damHere
      priceSource = "dam"
    } else if (lastMarketEurMwh != null) {
      priceEurMwh = lastMarketEurMwh
      priceSource = "carry"
    }
    if (priceEurMwh != null) lastMarketEurMwh = priceEurMwh

    const hasPrice = priceEurMwh != null
    const indexPerKwh = hasPrice ? (priceEurMwh as number) / 1000 : 0
    const indexCt = indexPerKwh * 100

    // Counterfactual GRID-FIRST import this frame (incl. recharge losses —
    // the grid meter sees terminal energy, not cell energy).
    // Grid serves AUX + the site load up to its headroom (the battery covers the
    // surplus; if the baseline pack is empty the surplus is curtailed, so the
    // import never exceeds the cap), plus the grossed-up recharge. `evKw` is
    // signed: a jitter frame's negative load stays negative and cancels its
    // positive twin instead of rectifying.
    const noArbFrameImportKwh =
      (baseKw + Math.min(evKw, gridAvail)) * dtH + rechargeKwh / noArbEff
    if (!isRollupPt) {
      noArbImportKwh += noArbFrameImportKwh
      noArbDynamicCost += noArbFrameImportKwh * (indexPerKwh + adderPerKwh)
    }

    const actualImportKw = Math.max(0, p.actualGridKw)
    // Chart only: a jitter frame draws as zero, like the as-run import above.
    const noArbImportKw = dtH > 0 ? Math.max(0, noArbFrameImportKwh) / dtH : 0
    // Chart split: `servedKw` is the site load the counterfactual must serve
    // (EV + AUX — correct for the grid-first maths). What the chart calls "EV
    // delivered" is the metered connector power; AUX is what is left.
    const meteredEvKw =
      p.mEv1Kw == null && p.mEv2Kw == null ? null : Math.abs(p.mEv1Kw ?? 0) + Math.abs(p.mEv2Kw ?? 0)
    const chartEvKw = hasMeteredEv ? (meteredEvKw ?? 0) : Math.max(0, servedKw)
    const chartAuxKw = hasMeteredEv ? Math.max(0, servedKw - (meteredEvKw ?? 0)) : null
    importSeries.push({
      hour: p.hour,
      fullLabel: format(d, "MMM d, HH:mm"),
      importNegKw: -actualImportKw,
      noArbNegKw: -noArbImportKw,
      evPosKw: chartEvKw,
      auxPosKw: chartAuxKw,
      price: hasPrice ? (priceEurMwh as number) : null,
      shiftBaseNeg: -Math.min(actualImportKw, noArbImportKw),
      shiftInNeg: -Math.max(0, actualImportKw - noArbImportKw),
      shiftOutNeg: -Math.max(0, noArbImportKw - actualImportKw),
    })

    // Rollup-expanded points end here: chart only, totals are frozen.
    if (isRollupPt || !bucket) continue

    const importKwh = Math.max(0, p.actualGridKw) * dtH
    if (importKwh <= 0) continue

    const frameFlat = importKwh * flatPerKwh
    const frameDynamic = importKwh * (indexPerKwh + adderPerKwh)

    totalImportKwh += importKwh
    flatCost += frameFlat
    dynamicCost += frameDynamic
    if (hasPrice) {
      pricedImportKwh += importKwh
      idmEnergyCtSum += importKwh * indexCt
      if (priceSource === "idm") idmImportKwh += importKwh
      else if (priceSource === "dam") damImportKwh += importKwh
    }

    bucket.importKwh += importKwh
    bucket.flatCost += frameFlat
    bucket.dynamicCost += frameDynamic
    if (hasPrice) bucket.idmWeightedCt += importKwh * indexCt
  }

  if (totalImportKwh <= 0 && rollupDays.length === 0) return null

  // ── END-OF-SEGMENT SOC TRUE-UP (anchor baseline to measured end SOC) ─────
  // The baseline held the measured SEGMENT-START level; reality ended each raw
  // segment at its last measured SOC. Force the baseline to the same end state:
  //   Δ > 0 (reality ended fuller)  → baseline BUYS Δ more (import + wear)
  //   Δ < 0 (reality ended emptier) → baseline DISCHARGES |Δ| into sessions,
  //                                   displacing grid import (less import,
  //                                   but the throughput still wears the pack)
  // Both worlds start AND end each segment at identical stored energy, so
  // procurement totals compare directly — no settlement credit line exists.
  // Segments that ended at a rollup transition were already closed inside the
  // loop; this closes the trailing raw segment (if the series ends raw).
  if (series.length > 0 && series[series.length - 1].fromRollup !== true) closeRawSegment()

  // ── Reconcile to the AUTHORITATIVE full-resolution grid import ──────────
  // `series` is downsampled to ≤600 points; totals.actualImportKwh is summed
  // over EVERY frame in the engine — treat it as ground truth and rescale.
  // HYBRID ranges: subtract the frozen days' energy so the raw part rescales
  // against its OWN authoritative import (else frozen days double-count).
  // Σ rollupDays covers BOTH DB-served rollups and full days frozen in memory
  // by the per-day raw replay (result.rollup only exists for the former).
  const rollupPartImportKwh = rollupDays.reduce((s, rd) => s + Math.max(0, rd.importKwh), 0)
  const seriesImportKwh = totalImportKwh
  const authImportKwh =
    result.totals?.actualImportKwh && result.totals.actualImportKwh > 0
      ? Math.max(0, result.totals.actualImportKwh - rollupPartImportKwh)
      : seriesImportKwh
  const importScale = seriesImportKwh > 0 ? authImportKwh / seriesImportKwh : 1
  totalImportKwh = authImportKwh
  flatCost = authImportKwh * flatPerKwh // exact: rate × authoritative kWh
  dynamicCost = dynamicCost * importScale // blended IDM rate × authoritative kWh
  noArbImportKwh *= importScale
  noArbDynamicCost *= importScale
  pricedImportKwh *= importScale
  idmImportKwh *= importScale
  damImportKwh *= importScale

  let days = Array.from(dayMap.values())
    .sort((a, b) => a.dayIso.localeCompare(b.dayIso))
    .map((b) => ({
      ...b,
      importKwh: b.importKwh * importScale,
      flatCost: b.flatCost * importScale,
      dynamicCost: b.dynamicCost * importScale,
      idmWeightedCt: b.importKwh > 0 ? b.idmWeightedCt / b.importKwh : 0,
    }))

  // ── Fold in frozen rollup days (lossless since sep 2 2026) ──────────────
  // Flat cost recomputed from the CURRENT configurable rate; dynamic side
  // reuses the FROZEN market energy cost + configurable adder at read time.
  // Rows frozen with a `tariff` block also contribute their grid-first
  // counterfactual, wear bases and throughput diagnostics, so a range served
  // from rollups yields the same "Dynamic no-dispatch", timing value and wear
  // as a raw replay of the same days. Legacy rows (no `tariff`) still only
  // price metered import — `rollupLegacyDays` reports how many.
  let rollupNoArbImportKwh = 0
  let rollupNoArbCostEur = 0
  let rollupDeadbandKwh = 0
  let rollupNoArbRawKwh = 0
  let rollupBmsKwh = 0
  let rollupSocImpliedKwh = 0
  let rollupNoArbDischargeKwh = 0
  let rollupNoArbChargeKwh = 0
  let rollupStoredDiffKwh = 0
  let rollupBattMeterChargeKwh = 0
  let rollupBattMeterDischargeKwh = 0
  let rollupBattMeterSocDeltaKwh = 0
  let rollupLegacyDays = 0
  let supersededEffDays = 0
  let supersededEffKwh = 0
  let supersededEffEur = 0
  // Energy-balance accumulators (method 2026-09-04.4) — raw segment joins below.
  let ebExtraChargeKwh = 0
  let ebPsChargeGridKwh = 0
  let ebSegments = 0
  let simNoArbImportKwh = 0
  let simNoArbCostEur = 0
  if (rollupDays.length > 0) {
    const rollupBuckets: typeof days = []
    for (const rd of rollupDays) {
      const t = rd.tariff
      if (t) {
        const daySimKwh = t.noArbImportKwh
        const daySimEur = t.noArbEnergyCostEur + t.noArbImportKwh * adderPerKwh
        if (t.battMeterChargeKwh != null) {
          // ── Energy-balance rule on the frozen day (2026-09-04.4) ─────────
          // Inputs are all frozen scalars: measured import, battery-meter
          // gross charge, the peak-shave pack's charge (cell → grid side at
          // the day's own η) and the simulation's kWh/€ as the price shape.
          // Applied at READ time so a share change is a refill, not a
          // re-freeze; per-day so the month is Σ of its days by construction.
          const dayEff = t.noArbRoundTripEff ?? NO_ARB_ROUND_TRIP_EFF
          const psGrid = t.noArbChargeKwh / dayEff
          const dayAvgEurPerKwh =
            rd.importKwh > 0 ? ((rd.dynamicCostEur ?? 0) + rd.importKwh * adderPerKwh) / rd.importKwh : 0
          const eb = energyBalanceNoLs(
            {
              importKwh: Math.max(0, rd.importKwh),
              meterChargeKwh: t.battMeterChargeKwh,
              psChargeGridKwh: psGrid,
              simKwh: daySimKwh,
              simEur: daySimEur,
            },
            dayAvgEurPerKwh,
          )
          rollupNoArbImportKwh += eb.kwh
          rollupNoArbCostEur += eb.eur
          ebExtraChargeKwh += eb.extraChargeKwh
          ebPsChargeGridKwh += psGrid
          ebSegments++
        } else {
          // ── No meter legs (frozen before 2026-09-04.1, frames gone) ──────
          // The rule needs the battery meter's gross charge; without it the
          // day keeps its frozen SIMULATED baseline with the 0.85 → η gross-up
          // removed algebraically (exact on the frozen cell energy; € leg
          // repriced at the day's average baseline price). The badge on the
          // LS card discloses these days. After the 4 sep 2026 frame
          // re-hydration only Gronau 3–8 Jun 2026 remain on this path.
          let dayNoArbImportKwh = t.noArbImportKwh
          let dayNoArbEnergyCostEur = t.noArbEnergyCostEur
          if (t.noArbRoundTripEff == null && t.noArbChargeKwh > 0 && t.noArbImportKwh > 0) {
            const removedKwh = Math.min(
              t.noArbChargeKwh * (1 / LEGACY_NO_ARB_EFF - 1 / NO_ARB_ROUND_TRIP_EFF),
              t.noArbImportKwh,
            )
            const avgPriceEurPerKwh = t.noArbEnergyCostEur / t.noArbImportKwh
            dayNoArbImportKwh -= removedKwh
            dayNoArbEnergyCostEur -= removedKwh * avgPriceEurPerKwh
            supersededEffKwh += removedKwh
            supersededEffEur += removedKwh * (avgPriceEurPerKwh + adderPerKwh)
          }
          supersededEffDays++
          rollupNoArbImportKwh += dayNoArbImportKwh
          rollupNoArbCostEur += dayNoArbEnergyCostEur + dayNoArbImportKwh * adderPerKwh
        }
        simNoArbImportKwh += daySimKwh
        simNoArbCostEur += daySimEur
        rollupDeadbandKwh += t.deadbandKwh
        rollupNoArbRawKwh += t.throughputNoArbRawKwh
        rollupBmsKwh += t.bmsKwh
        rollupSocImpliedKwh += t.socImpliedKwh
        rollupNoArbDischargeKwh += t.noArbDischargeKwh
        rollupNoArbChargeKwh += t.noArbChargeKwh
        rollupStoredDiffKwh += t.storedDiffKwh
        // Rows frozen before 2026-09-04.1 carry no meter legs (→ 0): the
        // window ratio then rests on the days that do; never on a guess.
        rollupBattMeterChargeKwh += t.battMeterChargeKwh ?? 0
        rollupBattMeterDischargeKwh += t.battMeterDischargeKwh ?? 0
        rollupBattMeterSocDeltaKwh += t.battMeterSocDeltaKwh ?? 0
      } else {
        rollupLegacyDays++
      }
      if (rd.importKwh <= 0) continue
      const rFlat = rd.importKwh * flatPerKwh
      const energyCost = rd.dynamicCostEur ?? 0
      const rDynamic = energyCost + rd.importKwh * adderPerKwh
      const pricedKwh = (rd.pricedFraction ?? 0) * rd.importKwh
      totalImportKwh += rd.importKwh
      flatCost += rFlat
      dynamicCost += rDynamic
      pricedImportKwh += pricedKwh
      idmImportKwh += pricedKwh * (rd.idmFraction ?? 0)
      damImportKwh += pricedKwh * (1 - (rd.idmFraction ?? 0))
      // Σ kWh·indexCt over the priced part collapses to energyCost[€] × 100.
      idmEnergyCtSum += energyCost * 100
      rollupBuckets.push({
        dayIso: rd.day,
        label: dayLabel(rd.day),
        importKwh: rd.importKwh,
        flatCost: rFlat,
        dynamicCost: rDynamic,
        idmWeightedCt: pricedKwh > 0 ? (energyCost / pricedKwh) * 100 : 0,
      })
    }
    // A rollup is a UTC day; a Berlin report window's head (22:00Z → midnight)
    // is raw-replayed and lands on the SAME report day as the first rollup.
    // Merge same-day buckets so "Aug 1–31" lists 31 days, not 32.
    const merged = new Map<string, DayBucket>()
    for (const b of [...rollupBuckets, ...days]) {
      const cur = merged.get(b.dayIso)
      if (!cur) {
        merged.set(b.dayIso, { ...b })
        continue
      }
      const kwh = cur.importKwh + b.importKwh
      cur.idmWeightedCt = kwh > 0 ? (cur.idmWeightedCt * cur.importKwh + b.idmWeightedCt * b.importKwh) / kwh : 0
      cur.importKwh = kwh
      cur.flatCost += b.flatCost
      cur.dynamicCost += b.dynamicCost
    }
    days = [...merged.values()].sort((a, b) => a.dayIso.localeCompare(b.dayIso))
  }

  if (totalImportKwh <= 0) return null

  const diff = flatCost - dynamicCost

  // ── Battery wear — the two-figure fair-comparison model ────────────────
  // SYMMETRIC DEADBAND EXCLUSION (client decision aug 21 2026): idle
  // jitter/balancing below DEADBAND_KW happens REGARDLESS of strategy — a
  // battery that never load-shifts still micro-cycles around the clock. It is
  // therefore EXCLUDED from BOTH wear bases (previously it was left inside
  // the as-run figure and added back to the baseline, inflating both quoted
  // wear totals by the same strategy-independent noise). Only cycling that is
  // actually attributable to a strategy is charged to it.
  // `kpis.batteryThroughputKwh` is the stitched Σ over raw frames AND rollup
  // days (runBacktestForRange sums the frozen kpis), so only the DEADBAND and
  // the diagnostics need the rollup contributions added here.
  const throughputWithArbRawKwh = Math.max(0, result.kpis?.batteryThroughputKwh ?? 0)
  diagDeadbandKwh += rollupDeadbandKwh
  diagBmsKwh += rollupBmsKwh
  diagSocImpliedKwh += rollupSocImpliedKwh
  const throughputWithArbKwh = Math.max(0, throughputWithArbRawKwh - diagDeadbandKwh)
  const wearWithArb = throughputWithArbKwh * cyclingPerKwh
  // MEASURED overhead applied to the no-load-shifting baseline:
  //   noArbThroughput = raw × (1 + gapShare)
  // Gap losses stay proportional — they scale with real energy movement.
  // (noArbJitterShare kept as a diagnostic only; it no longer enters wear.)
  // The window-level gap share is recomputed from the SUMMED diagnostics so a
  // rollup-served month gets the same factor a raw replay would derive.
  const noArbJitterShare = diagBmsKwh > 0 ? diagDeadbandKwh / diagBmsKwh : 0
  const noArbGapShare =
    diagBmsKwh > 0 ? Math.max(0, (diagBmsKwh - diagSocImpliedKwh) / diagBmsKwh) : 0
  const noArbOverheadFactor = 1 + noArbGapShare
  // RAW-segment peak-shave charge (cell side) for the energy-balance rule —
  // captured BEFORE the frozen days are folded in below, since those days have
  // already been settled per day (and the frozen `noArbChargeKwh` already
  // includes each day's own overhead factor).
  const rawPsChargeCellKwh = diagNoArbChargeKwh * noArbOverheadFactor
  throughputNoArbKwh += rollupNoArbRawKwh
  diagNoArbDischargeKwh += rollupNoArbDischargeKwh
  diagNoArbChargeKwh += rollupNoArbChargeKwh
  const throughputNoArbRawKwh = throughputNoArbKwh
  throughputNoArbKwh = throughputNoArbRawKwh * noArbOverheadFactor
  const noArbAppliedFactor =
    throughputNoArbRawKwh > 0 ? throughputNoArbKwh / throughputNoArbRawKwh : 1
  diagNoArbDischargeKwh *= noArbAppliedFactor
  diagNoArbChargeKwh *= noArbAppliedFactor
  for (const pt of battDetailSeries) pt.cumNoArbKwh *= noArbAppliedFactor
  const wearNoArb = throughputNoArbKwh * cyclingPerKwh
  const arbExtraWear = wearWithArb - wearNoArb

  // ── Load shifting participation (informational) ─────────────────────────
  // The true-up import is priced at the window's blended market rate (the
  // baseline would have spread that purchase/displacement across the window).
  // Frozen rollup days arrive with their own true-up already priced (at that
  // day's blended rate, adder added above) — they join as plain sums.
  const blendedMarketPerKwh = totalImportKwh > 0 ? dynamicCost / totalImportKwh : 0
  // The per-frame simulation's own no-LS figures for the RAW segment (the
  // pre-.4 headline). They are the pricing SHAPE for the rule below and are
  // reported as `simNoArb*` next to it.
  const rawSimNoArbKwh = Math.max(0, noArbImportKwh + socTrueUpImportKwh)
  const rawSimNoArbEur = Math.max(0, noArbDynamicCost + socTrueUpImportKwh * blendedMarketPerKwh)
  // ── Energy-balance rule on the raw segment (method 2026-09-04.4) ─────────
  // measured import − LS_LOSS_SHARE × max(0, meter gross charge − peak-shave
  // charge). The peak-shave charge is the simulation's cell recharge (incl.
  // the true-up and the jitter overhead applied above) taken to the grid side
  // so it is AC-for-AC comparable with the battery meter.
  const rawImportKwh = authImportKwh
  let ebNoArbImportKwh = rollupNoArbImportKwh
  let ebNoArbCostEur = rollupNoArbCostEur
  if (rawImportKwh > 0) {
    const rawPsChargeGridKwh = rawPsChargeCellKwh / noArbEff
    const eb = energyBalanceNoLs(
      {
        importKwh: rawImportKwh,
        meterChargeKwh: rawMeterChargeKwh,
        psChargeGridKwh: rawPsChargeGridKwh,
        simKwh: rawSimNoArbKwh,
        simEur: rawSimNoArbEur,
      },
      blendedMarketPerKwh,
    )
    ebNoArbImportKwh += eb.kwh
    ebNoArbCostEur += eb.eur
    ebExtraChargeKwh += eb.extraChargeKwh
    ebPsChargeGridKwh += rawPsChargeGridKwh
    ebSegments++
  }
  simNoArbImportKwh += rawSimNoArbKwh
  simNoArbCostEur += rawSimNoArbEur
  noArbImportKwh = Math.max(0, ebNoArbImportKwh)
  noArbDynamicCost = Math.max(0, ebNoArbCostEur)
  const procurementNoArbCost = noArbDynamicCost
  const noArbBlendedCt = noArbImportKwh > 0 ? (procurementNoArbCost / noArbImportKwh) * 100 : 0
  // Both worlds start and end at the SAME measured SOC, so procurement totals
  // compare directly — the old stored-energy credit is structurally zero.
  const storedDiffKwh = socTrueUpKwh + rollupStoredDiffKwh
  const socEdgeCreditEur = 0
  // The window's own meter ratio — raw segments + frozen days recomposed from
  // the same three inputs (a Berlin month = 2 h raw head + 30 frozen days +
  // 22 h raw tail prints the same ratio a full raw replay would). Diagnostic
  // only; the baseline uses the fleet constant above.
  const battMeterChargeKwh = rawMeterChargeKwh + rollupBattMeterChargeKwh
  const battMeterDischargeKwh = rawMeterDischargeKwh + rollupBattMeterDischargeKwh
  const battMeterSocDeltaKwh = rawSocDeltaKwh + rollupBattMeterSocDeltaKwh
  const battMeterRoundTripEff = batteryMeterRoundTripEff({
    chargeKwh: battMeterChargeKwh,
    dischargeKwh: battMeterDischargeKwh,
    socDeltaKwh: battMeterSocDeltaKwh,
  })
  const timingValue = procurementNoArbCost - dynamicCost
  const arbNetContribution = timingValue - arbExtraWear
  const netSavingForShare = flatCost + wearNoArb - (dynamicCost + wearWithArb)
  const arbShareOfNetPct =
    netSavingForShare > 0 ? (arbNetContribution / netSavingForShare) * 100 : 0

  // ── Telemetry holes must render as HOLES ──────────────────────────────────
  // Client escalation (sep 3 2026, Norderstedt): the import chart drew a
  // straight line across the 24–31 Aug outage (164.8 h, zero frames) and was
  // read as invented data. Insert a null marker between any two consecutive
  // chart points further apart than GAP_BREAK_H so every line/area breaks, and
  // expose the exact hour ranges so the charts can shade "no telemetry".
  // socSeries is pushed 1:1 with importSeries in the loop above, so the same
  // splice index keeps them parallel (guarded in case that ever changes).
  // Markers are BETWEEN existing points — first/last stay real, so
  // freezeDayTariff's socSeries[0]/last reads are unaffected. Chart-only:
  // every settlement total above is already final here.
  const GAP_BREAK_H = 3
  const telemetryGaps: { x1: number; x2: number }[] = []
  const socParallel = socSeries.length === importSeries.length
  for (let i = importSeries.length - 1; i > 0; i--) {
    const prev = importSeries[i - 1]
    const cur = importSeries[i]
    if (cur.hour - prev.hour <= GAP_BREAK_H) continue
    telemetryGaps.unshift({ x1: prev.hour, x2: cur.hour })
    importSeries.splice(i, 0, {
      hour: (prev.hour + cur.hour) / 2,
      fullLabel: "no telemetry",
    } as unknown as ImportPoint)
    if (socParallel)
      socSeries.splice(i, 0, { label: "·", fullLabel: "no telemetry" } as unknown as SocPoint)
  }
  for (let i = battDetailSeries.length - 1; i > 0; i--) {
    const prev = battDetailSeries[i - 1]
    const cur = battDetailSeries[i]
    if (cur.hour - prev.hour <= GAP_BREAK_H) continue
    battDetailSeries.splice(i, 0, {
      hour: (prev.hour + cur.hour) / 2,
      fullLabel: "no telemetry",
    } as unknown as BattDetailPoint)
  }

  return {
    totalImportKwh,
    flatCost,
    dynamicCost,
    diff,
    diffPct: flatCost > 0 ? (diff / flatCost) * 100 : 0,
    flatBlendedCt: (flatCost / totalImportKwh) * 100,
    dynamicBlendedCt: (dynamicCost / totalImportKwh) * 100,
    avgIdmCt: pricedImportKwh > 0 ? idmEnergyCtSum / pricedImportKwh : 0,
    days,
    pricedFraction: totalImportKwh > 0 ? pricedImportKwh / totalImportKwh : 0,
    idmFraction: totalImportKwh > 0 ? idmImportKwh / totalImportKwh : 0,
    damFraction: totalImportKwh > 0 ? damImportKwh / totalImportKwh : 0,
    throughputWithArbKwh,
    wearWithArb,
    throughputNoArbKwh,
    throughputNoArbRawKwh,
    noArbJitterShare,
    noArbGapShare,
    // Report the factor actually applied (raw × (1+gap) + absolute deadband).
    noArbOverheadFactor: noArbAppliedFactor,
    wearNoArb,
    arbExtraWear,
    socSeries,
    importSeries,
    importOriginMs,
    battDetailSeries,
    telemetryGaps,
    dataThroughIso:
      series.length > 0
        ? series[series.length - 1].ts
        : `${rollupDays[rollupDays.length - 1]?.day ?? ""}T23:59:59.000Z`,
    dataFromIso: (() => {
      const firstRaw = series.length > 0 ? series[0].ts : null
      const firstRollup = rollupDays.length > 0 ? `${rollupDays[0].day}T00:00:00.000Z` : null
      if (firstRaw && firstRollup) return firstRaw < firstRollup ? firstRaw : firstRollup
      return firstRaw ?? firstRollup ?? ""
    })(),
    coveredDays: (() => {
      const days = new Set<string>()
      for (const p of series) days.add(berlinDayOf(p.ts))
      for (const rd of rollupDays) days.add(rd.day)
      return days.size
    })(),
    throughputDiag: {
      bmsKwh: diagBmsKwh,
      chargeKwh: diagChargeKwh,
      dischargeKwh: diagDischargeKwh,
      deadbandKwh: diagDeadbandKwh,
      socImpliedKwh: diagSocImpliedKwh,
      noArbDischargeKwh: diagNoArbDischargeKwh,
      noArbChargeKwh: diagNoArbChargeKwh,
    },
    lsLossShare: LS_LOSS_SHARE,
    lsExtraChargeKwh: ebExtraChargeKwh,
    psChargeGridKwh: ebPsChargeGridKwh,
    simNoArbImportKwh,
    simNoArbCostEur,
    energyBalanceSegments: ebSegments,
    totalCapacityKwh,
    // Fair pairing: flat tariff carries only unavoidable peak-shave wear;
    // the IDM-indexed tariff carries the full load shifting strategy's wear.
    flatNet: flatCost + wearNoArb,
    dynamicNet: dynamicCost + wearWithArb,
    netSaving: flatCost + wearNoArb - (dynamicCost + wearWithArb),
    netSavingPct:
      flatCost + wearNoArb > 0
        ? ((flatCost + wearNoArb - (dynamicCost + wearWithArb)) / (flatCost + wearNoArb)) * 100
        : 0,
    noArbImportKwh,
    procurementNoArbCost,
    noArbBlendedCt,
    storedDiffKwh,
    noArbRoundTripEff: noArbEff,
    battMeterRoundTripEff,
    battMeterChargeKwh,
    battMeterDischargeKwh,
    battMeterSocDeltaKwh,
    supersededEffDays,
    supersededEffKwh,
    supersededEffEur,
    socEdgeCreditEur,
    timingValue,
    arbNetContribution,
    arbShareOfNetPct,
    rollupTariffDays: rollupDays.length - rollupLegacyDays,
    rollupLegacyDays,
    rawSegments,
  }
}
