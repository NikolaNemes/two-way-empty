import "server-only"

/**
 * Fleet Monthly Report — SERVER-SIDE builder.
 *
 * Replicates the interactive Fleet Monthly page's pipeline 1:1 (see
 * components/portfolio/fleet-projection-screen.tsx) and freezes the resulting
 * per-station rows into the fleet_month_report table, so the yearly report and
 * the Excel export read PRE-COMPUTED data instead of recomputing on the fly
 * (client feedback aug 20 2026).
 *
 * TWO DATASETS, ONE TABLE, NEVER MIXED (client decision 2 sep 2026):
 *
 *   hist_*        HISTORY ANALYSIS — the pre-system archive (CCR CSV export,
 *                 54 locations). Every row is simulateFleetMonth(month) on the
 *                 station's OWN archive volume, priced with real IDM history.
 *                 No telemetry enters: no Gronau anchor row, no capture
 *                 scaling. `measured` is always false, `capture` always null.
 *   chargepost_*  FLEET (REAL) — the station's own telemetry through the same
 *                 compute() engine as the site financial report
 *                 (fillLiveFleetMonth below). Never simulated.
 *
 * History used to borrow from telemetry in two places — Gronau's month was
 * replaced by its live backtest ("anchor"), and every station's load-shift €
 * was scaled by a real÷simulated ratio measured on Gronau July 2026 (0.968).
 * Both were removed: a history report must not contain real-report data.
 */

import { and, eq, like, notLike, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { fleetMonthReport, stations } from "@/lib/db/schema"
import { simulateFleetMonth } from "@/app/actions/portfolio"
import { isReportableArchiveMonth } from "@/lib/hist-provenance"
import { COUNTER_SESSION_METHOD } from "@/lib/ccr-sessions"
import { DEFAULT_FLAT_CT, DEFAULT_ADDER_CT, DEFAULT_CYCLING_CT } from "@/lib/tariff-compute"
import { berlinMonthWindow } from "@/lib/report-window"
import { settleStationWindow } from "@/lib/settlement"

// First month of the fleet report history (client request aug 21 2026:
// "yearly report should include every month since May 2025"). The cron fills
// and the yearly page reads from this month forward — not a trailing window.
export const FLEET_REPORT_FIRST_MONTH = "2025-05"

/**
 * Stamped on every row (Annex A8: reproducibility). Bump when the settlement
 * math changes.
 *  - 2026-08-31.1: NITES audit — measured rows use ONE volume basis (backtest
 *    kWh, not archive kWh, so Flat € ÷ Import kWh = exactly the flat rate);
 *    anchor gate additionally rejects months whose grid-first counterfactual
 *    collapses to ≤ 0 (SOC true-up clamp — May 2026); audit fields persisted.
 *  - 2026-09-02.1: Gronau defect report — the UTC day is the atomic replay
 *    unit (lossless frozen rollups: grid-first counterfactual, wear bases,
 *    sessions, 15-min series; raw days frozen in memory with the same
 *    function, so a day is identical on every page and every night); the
 *    MPC look-ahead sees the published D+1 curve past a window end; ONE EV
 *    definition — ev_delivered_kwh (metered C1+C2) and aux_kwh persisted,
 *    `ev_kwh` retained as the legacy site-load figure and never labelled EV.
 *  - 2026-09-02.2: History Analysis is archive-only — the Gronau measured
 *    anchor row and the 0.968 capture scaling (both telemetry-derived) are
 *    gone from hist_* rows; load-shift € = the simulator's own value. Archive
 *    sessions persisted as NULL (n/a) until re-derived from the source export.
 *  - (no bump, 2026-09-03) One window rule + one settlement function: month
 *    rows are built by lib/report-window + lib/settlement — the exact path the
 *    Site Financial Report calls — and the Annex euros come from
 *    settlementFigures(). Verified cent-identical to the existing 2026-09-02.2
 *    rows (scripts/verify-fleet-vs-financial.ts), so frozen rows stay valid.
 *    Per-day buckets are now Berlin days on every runtime (presentation only).
 *  - 2026-09-03.1: grid-first counterfactual can no longer import ABOVE the
 *    physical grid cap. Baseline recharge was limited by grid-side headroom in
 *    CELL energy, then grossed up by 1/EFF into grid import — so a recharge
 *    frame projected import up to headroom/EFF over the cap (Gronau 96.7 kW vs
 *    90 kW cap). Recharge cell energy is now capped at headroom×dt×EFF, so the
 *    grossed-up import stays ≤ cap by construction. Volume-neutral (SOC
 *    restoration need unchanged); moves only baseline procurement € by re-timing
 *    recharge under the cap (≤4 ct/station-month observed).
 *  - 2026-09-03.2: baseline peak-shaves against each site's REAL grid import
 *    wall, not the flat operator override (~87-90 kW). The wall is derived from
 *    the window's MEASURED import (p99.9, never above the configured cap). Sites
 *    that use their full headroom (Gronau ~86, Gifhorn ~91) are unchanged; a
 *    site with a lower real ceiling (Norderstedt ~60 kW — sharp measured wall)
 *    now forces the baseline pack to discharge the site load above 60 instead of
 *    above 87, which RAISES baseline cycling/wear and LOWERS the previously
 *    overstated "extra wear from load shifting". Baseline counterfactual only —
 *    as-run and dispatch simulation are untouched.
 *  - 2026-09-03.3: (a) PHYSICS GATE on the residual baseload that feeds the
 *    grid-first counterfactual's must-import floor: a non-dispatchable grid
 *    load can never exceed the grid meter's import in the same frame, so the
 *    residual is capped at the metered import per frame. Removes the battery-
 *    meter phantom (Norderstedt: 927 frames with batt charge > site import) the
 *    baseline was buying at the slot price while as-run never paid for it —
 *    Norderstedt LS gain was overstated by that volume; Gronau/Gifhorn ~0.
 *    (b) AUX (ChargePost self-consumption) is now the WINDOW ENERGY BALANCE
 *    import − export − EV delivered − battery net (glossary A7.2) instead of
 *    the per-frame clamp Σ max(0, siteLoad − meteredEV), and a `battNetKwh`
 *    column is added so every report row closes exactly:
 *    import = EV delivered + AUX + battery net. The clamp rectified meter noise
 *    one-sidedly (+38 Gronau, +103 Norderstedt kWh/month) and let EV + AUX
 *    exceed import (Norderstedt Aug 2026: +374 kWh). Display volumes only for
 *    (b); (a) moves baseline € — Norderstedt down, others ≈ unchanged.
 *  - (no bump, 2026-09-04) Archive SESSIONS. The CCR export has no session
 *    records but a real per-connector power meter; sessions are re-derived as
 *    per-connector power islands with the live path's exact filters
 *    (lib/ccr-sessions.ts → portfolio_session via
 *    scripts/portfolio/import-ccr-sessions.ts) and hist_* rows read the count
 *    from there, stamped `sessions_basis = lp-power-islands-v1`; live rows are
 *    stamped `counters`. Display column only — no euro, no volume changes, so
 *    frozen rows stay valid; a hist refill surfaces the counts. Gronau check:
 *    1 035 sessions, 100.0 % of connector energy, Jul 2026 146 vs live Aug 155.
 *  - 2026-09-04.1: baseline pack ROUND-TRIP EFFICIENCY is MEASURED, not 0.85.
 *    Client escalation (Timon, 4 sep 2026): "without load shifting" import was
 *    ABOVE the as-run import (Gronau Aug 6 883 vs 6 631 kWh) — impossible, LS
 *    only adds cycling losses. Cause: the counterfactual's peak-shave recharge
 *    was grossed up at a fixed 85 % while the battery meter shows the real pack
 *    at ~95 % (Gronau Aug: charged 2 592, discharged 2 466, ΔSOC +8 → 4.6 %
 *    lost); the rest of the real conversion loss sits in AUX, which the baseline
 *    already serves → the 15 % was a double count worth +364 kWh (= the whole
 *    +252 gap after true-up and clamps). Now η = 0.96, the FLEET's metered
 *    round trip (Σdischarge / Σ(charge − ΔSOC) over every raw day at Gronau
 *    0.959 and Gifhorn 0.964; Norderstedt's meter reads > 1, excluded, T4). A
 *    constant, not per-window: a single day's ratio swings 0.58–1.10 with its
 *    SOC movement while the month is stable at 0.955–0.986, and daily frozen
 *    rows must Σ to the month. The window's own meter ratio is frozen per day
 *    (battMeter*) and shown as a DIAGNOSTIC next to the constant. Moves the
 *    baseline € only (LS timing value DOWN, order of €30–45 on Gronau Aug);
 *    procurement saving vs flat and the as-run side are untouched.
 *  - 2026-09-04.2: SUPERSEDED-METHOD days corrected algebraically at read time.
 *    .1 fixed the efficiency going forward, but days frozen BEFORE it (Jun–
 *    Jul 29; raw frames start ~Jul 30, so they can never be re-frozen) still
 *    carried the 0.85 gross-up, and any window containing them — e.g. July —
 *    again showed baseline import ABOVE as-run. The 0.85 term is exact algebra
 *    on the frozen day's cell energy: removed = noArbChargeKwh × (1/0.85 −
 *    1/0.96), capped at the day's baseline import; € repriced at the day's own
 *    average baseline price (approximation — recharge hours are usually
 *    cheaper than the day average — disclosed on the card). Days frozen at
 *    0.96 (noArbRoundTripEff present) pass through untouched, so re-frozen
 *    windows are identical to .1. Windows with corrected days carry
 *    supersededEffDays/Kwh/Eur and an amber badge on the LS card. NO daily
 *    re-freeze needed — the raw-day path never triggers the correction —
 *    only month refills (live + hist) for the version stamp.
 *  - 2026-09-04.3: the counterfactual serves the SIGNED METERED SITE LOAD
 *    (battery − grid per frame), not `baseload + EV`. The old sum was
 *    max(power balance, EV counter) per frame: the connector register books
 *    energy in lumps, so whenever it ran ahead of the balance the baseline
 *    served the counter and whenever it ran behind it served the balance — a
 *    one-sided over-count (raw frames, Aug: Gifhorn +18, Gronau +44,
 *    Norderstedt +224 kWh) that kept Gifhorn's projection 4 kWh ABOVE the
 *    measured import even at the metered efficiency. The signed balance is
 *    energy-conserving (Σ = import − export − battery net), so the two worlds
 *    now differ only by battery-cycling terms; meter-jitter frames stay
 *    negative and cancel instead of rectifying. AUX remains a grid-only floor.
 *    ALSO: settlement freezes now integrate EVERY frame (seriesMaxPoints =
 *    Infinity in rollupStationDay). Until now the tariff engine ran on the
 *    600-point CHART series and scaled the counterfactual by
 *    authImport / sampledImport — a ratio estimate with ± a few kWh/day of
 *    sampling error whose sign depends on the day (Gifhorn Aug 20–31: −2.8 →
 *    −6.6 kWh, Gronau Aug: −76 → −108 kWh vs as-run). As-run import, EV, AUX,
 *    flat € are untouched; as-run DYNAMIC € moves by ~0.1 % (Gronau Aug
 *    −0.87 €, Gifhorn −0.41 €) because the price-weighted integral is now
 *    exact rather than sampled — a precision change, not a method change.
 *    Full daily re-freeze of raw days (Jul 30 →) required.
 *  - 2026-09-04.4: "WITHOUT load shifting" is an ENERGY BALANCE, not a rebuilt
 *    absolute (client rule, 4 sep 2026). .1–.3 each fixed one term of a
 *    per-frame re-simulation whose ~6 000 kWh result was compared with the
 *    ~6 000 kWh grid meter to read off a 0.5–1 % difference; every modelling
 *    choice inside landed on that difference at full weight and the result
 *    still exceeded the meter on legacy windows. Now the two worlds differ
 *    ONLY by battery cycling:  noLS_import = measured_import − LS_LOSS_SHARE ×
 *    max(0, meterCharge − peakShaveCharge), LS_LOSS_SHARE = 3 % (client
 *    choice; fleet meter shows 1.4–4.5 % monthly, mean 4.0 %). Anchored on
 *    the billed meter, ≤ measured import by construction, and a 10 % meter
 *    error moves it ~2 kWh instead of ~200. The per-frame simulation stays as
 *    (a) the peak-shave charge input and (b) the 15-min PRICE SHAPE: no-LS € =
 *    simulated € × rule kWh / simulated kWh, so timing value remains a
 *    price-weighted integral. Applied per SEGMENT (frozen day or raw replay)
 *    at READ time from frozen inputs (import, battMeterChargeKwh,
 *    noArbChargeKwh, sim kWh/€ — freezeDayTariff now stores the SIM as the
 *    shape, ROLLUP_TARIFF_VERSION 2), so a share change is a refill, not a
 *    re-freeze. Days without meter legs keep the .2 fallback + badge. ALSO:
 *    raw frames re-fetched from the Amperio API for Gronau 1 May → 30 Jul and
 *    Norderstedt 18 Jun → 30 Jul (373 k frames; the vendor still serves them
 *    at 30 s), so Jun–Jul are settled on raw days under this method — only
 *    Gronau 3–7 Jun stays on the fallback (upstream gap). ARCHIVE rows: the
 *    greedy shifter charges the same 3 % on every moved kWh in the receiving
 *    hour (saving = q·p_donor − q·1.03·p_cheap). Effect (Gronau Aug): no-LS
 *    6 599 → ~6 6xx kWh (rule), timing value UP (the sim over-deducted losses).
 *    Full daily re-freeze (now May →) + live + hist refills required.
 *
 * The constant itself lives in lib/methodology-version.ts (isomorphic) so the
 * client-side Annex page prints the same string; re-exported here for callers.
 */
export { METHODOLOGY_VERSION } from "@/lib/methodology-version"
import { METHODOLOGY_VERSION } from "@/lib/methodology-version"

/** Every month from FLEET_REPORT_FIRST_MONTH through the current month, oldest first. */
export function fleetReportMonths(throughCurrent = true): string[] {
  const [fy, fm] = FLEET_REPORT_FIRST_MONTH.split("-").map(Number)
  const now = new Date()
  const endY = now.getFullYear()
  const endM = now.getMonth() + (throughCurrent ? 1 : 0) // 1-based; previous month when !throughCurrent
  const out: string[] = []
  let y = fy
  let m = fm
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

const wearEurPerKwh = DEFAULT_CYCLING_CT / 100 // ct/kWh → €/kWh

type MonthRowInsert = typeof fleetMonthReport.$inferInsert

export type FleetMonthFillResult = {
  month: string
  ok: boolean
  rows: number
  /** Station-months dropped for lack of own archive volume (synthesized / zero). */
  skipped?: number
  error?: string
}

/**
 * Berlin-local month boundaries — NOT server-TZ. ROOT CAUSE of the
 * monthly-vs-yearly mismatch (client report aug 25 2026): this used to build
 * the window with `new Date("YYYY-MM-01T00:00:00")`, which on the UTC server
 * meant UTC month boundaries, while the site financial report and the
 * interactive Fleet Monthly both use Berlin-local days (as does the DAM price
 * calendar). The 1–2h boundary shift slices the overnight charge cycle
 * differently and changed Gronau July net 394.61 → 363.22 in the live
 * dataset. Berlin offset by month is static because EU DST
 * switches (last Sun of Mar/Oct) never fall on a month boundary:
 * Apr–Oct = CEST (+2), Nov–Mar = CET (+1).
 */
// The window itself is built by lib/report-window (`berlinMonthWindow`) and the
// pricing by lib/settlement (`settleStationWindow`) — the SAME two functions the
// site Financial Report goes through, so a month row and a "1st → last" report
// are the same computation, not two that happen to agree (client requirement
// sep 3 2026: "method per location must be the same and always match").

/**
 * Build + freeze one HISTORY month (hist_* archive twins). Delete-and-insert
 * per month keeps the fill idempotent (re-running a month replaces its rows
 * atomically). Pure archive simulation — see the file header.
 */
export async function fillFleetMonth(month: string): Promise<FleetMonthFillResult> {
  const simRaw = await simulateFleetMonth({
    month,
    flatEurMwh: DEFAULT_FLAT_CT * 10,
    wearEurMwh: DEFAULT_CYCLING_CT * 10,
  })
  if (!simRaw || "error" in simRaw) {
    return { month, ok: false, rows: 0, error: simRaw?.error ?? "sim failed" }
  }
  const sim = simRaw

  // Constants stamped on every row (Annex A8: reproducibility).
  const auditConstants = {
    methodologyVersion: METHODOLOGY_VERSION,
    flatCt: DEFAULT_FLAT_CT,
    adderCt: DEFAULT_ADDER_CT,
    wearCt: DEFAULT_CYCLING_CT,
  }

  // PROVENANCE (Defect 1, sep 2 2026): a station-month is reported ONLY when
  // the archive has that month's own volume AND the month is inside the
  // station's optimised period (client decision: Gronau starts Dec 2025).
  // Synthesized months (`seasonal` / `recent`) and zero-volume months get NO
  // row — they used to be summed into the yearly Station totals as if they
  // were history.
  const reportable = sim.stations.filter((s) => isReportableArchiveMonth({ ...s, month }))
  const skipped = sim.stations.length - reportable.length

  const rows: MonthRowInsert[] = reportable.map((s) => {
    // The simulator's own load-shift value — NOT scaled by any telemetry-
    // derived ratio. Same identities as the Financial Report blocks.
    const timingEur = s.timingRawEur
    const shiftedKwh = s.shiftedKwhRaw
    const wearEur = shiftedKwh * wearEurPerKwh
    const asRunEur = s.noShiftEur - timingEur
    const procSavingEur = s.flatEur - asRunEur
    const netEur = procSavingEur - wearEur
    return {
      stationId: s.stationId,
      month,
      city: s.city,
      zip: s.zip,
      brand: s.brand,
      volumeSource: s.volumeSource,
      measured: false,
      importKwh: s.importKwh,
      // Archive CSV import carried no per-connector counters → EV delivered /
      // AUX are unknown (NULL), and `evKwh` stays the site-load figure.
      evKwh: s.evKwh,
      evDeliveredKwh: null,
      auxKwh: null,
      battNetKwh: null,
      // Archive sessions (sep 4 2026): the sim already carries the count
      // re-derived from the station's CCR export (lib/archive-sessions →
      // portfolio_session, per-connector power islands) or NULL when that
      // export is not imported for the month → "n/a". The one-time import's
      // 5 kW rising-edge estimate is gone from the sim (client decision 2 sep
      // 2026) so nothing else can leak in here.
      sessions: s.sessions,
      sessionsBasis: s.sessionsBasis,
      flatEur: s.flatEur,
      noShiftEur: s.noShiftEur,
      asRunEur,
      procSavingEur,
      // The archive simulator yields only the EXTRA throughput the load
      // shifting adds (shiftedKwhRaw); it has no measured battery series and
      // therefore no baseline (no-load-shifting) or as-run wear. Both bases
      // are unknown on archive rows and render as "—", never as 0.
      wearNoShiftEur: null,
      wearAsRunEur: null,
      wearEur,
      netEur,
      lsEur: timingEur - wearEur,
      timingEur,
      shiftedKwh,
      capture: null,
      flatCtApplied: s.importKwh > 0 ? (100 * s.flatEur) / s.importKwh : null,
      anchorStatus: "sim",
      dataThrough: null,
      pricedFraction: null,
      idmFraction: null,
      damFraction: null,
      ...auditConstants,
    }
  })

  // Idempotent month replace — HIST rows only. The same table also holds the
  // live dataset (real chargepost_* stations, fillLiveFleetMonth below); the
  // two must never delete each other's rows.
  const histFilter = and(eq(fleetMonthReport.month, month), like(fleetMonthReport.stationId, "hist_%"))
  if (await newerMethodologyPresent(histFilter)) {
    return { month, ok: false, rows: 0, skipped, error: "newer methodology rows present — refusing to downgrade" }
  }
  await db.delete(fleetMonthReport).where(histFilter)
  // Chunked insert (54 stations × ~20 cols is fine in one go, but stay safe).
  const CHUNK = 100
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(fleetMonthReport).values(rows.slice(i, i + CHUNK))
  }

  return { month, ok: true, rows: rows.length, skipped }
}

// ══════════════���════════════════════════════════════════════════════════════
// LIVE fleet dataset — real chargepost_* stations ONLY (never hist_* twins).
// Same fleet_month_report table, disjoint station_id prefix. Every row is
// fully measured: the station's own backtest (rollups → raw frames → live
// Amperio API, retention-aware) priced through the SAME compute() engine used
// by the site financial report. No simulation — months/stations without
// telemetry simply have no row.
// ══════════════════════════════��════════════════════════════════════════════

/**
 * First REPORTABLE live month = June 2026. The Gronau pilot produced May 2026
 * telemetry, but raw frames were only retained from ~Jul 30 onward, so May's
 * daily rollups carry a stale/inverted counterfactual (No-LS priced below
 * as-run) that cannot be re-frozen without frames. Client decision (sep 3 2026):
 * exclude May entirely — reports start at June. May rows stay in the DB but are
 * filtered out by every gte(month, LIVE_FLEET_FIRST_MONTH) query, so this is a
 * single reversible lever for both Fleet Monthly and Fleet Yearly.
 */
export const LIVE_FLEET_FIRST_MONTH = "2026-06"

/** Every month from LIVE_FLEET_FIRST_MONTH through the current month, oldest first. */
export function liveFleetMonths(throughCurrent = true): string[] {
  const [fy, fm] = LIVE_FLEET_FIRST_MONTH.split("-").map(Number)
  const now = new Date()
  const endY = now.getFullYear()
  const endM = now.getMonth() + (throughCurrent ? 1 : 0)
  const out: string[] = []
  let y = fy
  let m = fm
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

/** "Selgros Norderstedt (22848)" → { brand: "Selgros", city: "Norderstedt", zip: "22848" } */
function parseStationName(name: string): { brand: string | null; city: string; zip: string } {
  const zipMatch = /\((\d{4,5})\)/.exec(name)
  const zip = zipMatch ? zipMatch[1] : ""
  const cleaned = name
    .replace(/\(\d{4,5}\)/, "")
    .replace(/\bchargepost\b/i, "")
    .trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return { brand: words.slice(0, -1).join(" "), city: words[words.length - 1], zip }
  return { brand: null, city: cleaned || name, zip }
}

export type LiveFleetFillResult = {
  month: string
  ok: boolean
  rows: number
  /** Per-station outcome: stationId → "measured" | reason it was skipped. */
  stations: Record<string, string>
  error?: string
}

/**
 * Build + freeze one LIVE month. Delete-and-insert scoped to real station
 * ids keeps the fill idempotent without ever touching hist rows.
 */
export async function fillLiveFleetMonth(month: string): Promise<LiveFleetFillResult> {
  const win = berlinMonthWindow(month)
  if (!win) return { month, ok: false, rows: 0, stations: {}, error: "month not started or malformed" }

  const realStations = await db
    .select({ stationId: stations.stationId, name: stations.name, siteClass: stations.siteClass })
    .from(stations)
    .where(and(notLike(stations.stationId, "hist_%"), eq(stations.enabled, true)))

  const auditConstants = {
    methodologyVersion: METHODOLOGY_VERSION,
    flatCt: DEFAULT_FLAT_CT,
    adderCt: DEFAULT_ADDER_CT,
    wearCt: DEFAULT_CYCLING_CT,
  }

  const rows: MonthRowInsert[] = []
  const outcomes: Record<string, string> = {}

  // Sequential on purpose: each backtest may hit the live Amperio API.
  for (const st of realStations) {
    try {
      const s = await settleStationWindow({ stationId: st.stationId, window: win })
      const { bt, c, figures: f } = s
      if (s.reason === "empty" || s.reason === "mpc-unavailable") {
        outcomes[st.stationId] = "no_data"
        continue
      }
      const importKwh = bt.totals?.actualImportKwh ?? 0
      if (!c || !f || importKwh <= 0) {
        outcomes[st.stationId] = !c ? "pricing_unavailable" : "zero_import"
        continue
      }
      const { brand, city, zip } = parseStationName(st.name)
      rows.push({
        stationId: st.stationId,
        month,
        city,
        zip,
        brand,
        volumeSource: "measured",
        measured: true,
        importKwh,
        // ONE EV definition (Gronau defect 3): the legacy `evKwh` is the
        // kernel demand signal (site load = EV + AUX); the report shows
        // METERED EV delivered (C1+C2) and AUX separately — the same numbers
        // as the site Financial KPI and the Annex.
        evKwh: bt.totals?.evKwh ?? 0,
        evDeliveredKwh: (bt.totals?.mEv1Kwh ?? 0) + (bt.totals?.mEv2Kwh ?? 0),
        // Since 2026-09-03.3 AUX is the window energy balance and battNet closes
        // it: importKwh = evDeliveredKwh + auxKwh + battNetKwh on this row.
        auxKwh: bt.totals?.auxKwh ?? 0,
        battNetKwh: bt.totals?.battNetKwh ?? null,
        // Charge events from the per-connector energy counters (deriveSessionsFromRows).
        sessions: bt.sessions?.length ?? 0,
        sessionsBasis: COUNTER_SESSION_METHOD,
        // The Annex euros come from settlementFigures — the same function the
        // site Financial Report renders from. Nothing is re-derived here.
        flatEur: f.flatEur,
        noShiftEur: f.noShiftEur,
        asRunEur: f.asRunEur,
        procSavingEur: f.procSavingEur,
        wearNoShiftEur: f.wearNoShiftEur,
        wearAsRunEur: f.wearAsRunEur,
        wearEur: f.wearEur,
        netEur: f.netEur,
        lsEur: f.lsEur,
        timingEur: f.timingEur,
        shiftedKwh: f.shiftedKwh,
        capture: null, // live rows are never capture-scaled
        flatCtApplied: f.flatCtApplied,
        anchorStatus: "live",
        dataThrough: c.dataThroughIso ? new Date(c.dataThroughIso) : null,
        dataFrom: c.dataFromIso ? new Date(c.dataFromIso) : null,
        coveredDays: c.coveredDays,
        pricedFraction: c.pricedFraction,
        idmFraction: c.idmFraction,
        damFraction: c.damFraction,
        ...auditConstants,
      })
      outcomes[st.stationId] = "measured"
    } catch (err) {
      outcomes[st.stationId] = `error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`
    }
  }

  // Idempotent month replace — LIVE rows only (hist untouched). A writer on an
  // OLDER methodology must never replace rows a newer one produced.
  const liveFilter = and(eq(fleetMonthReport.month, month), notLike(fleetMonthReport.stationId, "hist_%"))
  if (await newerMethodologyPresent(liveFilter)) {
    return { month, ok: false, rows: 0, stations: outcomes, error: "newer methodology rows present — refusing to downgrade" }
  }
  await db.delete(fleetMonthReport).where(liveFilter)
  if (rows.length > 0) await db.insert(fleetMonthReport).values(rows)

  return { month, ok: true, rows: rows.length, stations: outcomes }
}

/**
 * DOWNGRADE GUARD (sep 3 2026). On sep 3 a stale production deployment's
 * nightly cron rewrote the Aug/Sep live rows with a builder that predated the
 * no_shift_eur / sessions / aux_kwh columns; the report then summed
 * timing = 0 − asRun into an −806 € "loss" the Financial Report never showed.
 * Versions are `YYYY-MM-DD.n`, so a plain string compare orders them.
 */
async function newerMethodologyPresent(filter: ReturnType<typeof and>): Promise<boolean> {
  const [r] = await db
    .select({ maxVersion: sql<string | null>`max(${fleetMonthReport.methodologyVersion})` })
    .from(fleetMonthReport)
    .where(filter)
  const max = r?.maxVersion ?? null
  return max != null && max > METHODOLOGY_VERSION
}
