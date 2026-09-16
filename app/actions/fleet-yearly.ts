"use server"

/**
 * Fleet Yearly Report — reads the PRE-COMPUTED fleet_month_report table.
 *
 * Client feedback (aug 20 2026): the yearly view must NOT calculate on the
 * fly. All heavy lifting (archive simulation for hist_*, telemetry backtest +
 * tariff pricing for chargepost_*) happens in /api/cron/fleet-report which
 * fills fleet_month_report; this action is a plain SELECT + arrangement.
 */

import { db } from "@/lib/db"
import { fleetMonthReport, stations } from "@/lib/db/schema"
import { FLEET_REPORT_FIRST_MONTH, LIVE_FLEET_FIRST_MONTH, METHODOLOGY_VERSION } from "@/lib/fleet-report-builder"
import { isReportableArchiveMonth, reportableSessions } from "@/lib/hist-provenance"
import { getMonthlyPriceContext, type MonthPriceContext } from "@/lib/price-analysis"
import { berlinMonthWindow } from "@/lib/report-window"
import { and, gte, like, lte, notLike } from "drizzle-orm"

/**
 * The fleet_month_report table holds TWO disjoint datasets keyed by
 * station_id prefix, and they are NEVER combined (client instruction
 * sep 1 2026):
 *  - "hist": HISTORY ANALYSIS — hist_* archive twins, pure archive simulation
 *            (no telemetry: no anchor row, no capture scaling)
 *  - "live": FLEET — real chargepost_* stations, every row measured from
 *            telemetry
 */
export type FleetDataset = "hist" | "live"

/** Site classification from the stations registry: 'ev_only' | 'ev_pv',
 * or "unknown" when not classified yet. Manual data — never telemetry-derived. */
export type YearlySiteClass = "ev_only" | "ev_pv" | "unknown"

/**
 * Metered volume split (Gronau defect 3, sep 2 2026). `evKwh` on every row is
 * the LEGACY site-load figure (kernel demand signal = EV + AUX). Reports show
 * EV delivered (C1+C2) from the metered connector counters and AUX
 * (ChargePost) separately. Both are NULL when ANY aggregated row lacks the
 * counters (archive hist_* months) — never mix definitions inside one cell.
 */
export interface MeteredSplit {
  evDeliveredKwh: number | null
  auxKwh: number | null
  /** Battery charge − discharge (kWh); closes importKwh = evDeliveredKwh +
   *  auxKwh + battNetKwh (method 2026-09-03.3). NULL when any aggregated row
   *  predates the column — never a partial sum. */
  battNetKwh: number | null
}

/**
 * Telemetry coverage of an aggregate (Aug 2026 review: Gifhorn 12/31 and
 * Norderstedt 25/31 were presented as ordinary full months). `coveredDays`
 * = Σ distinct Berlin days with frames over the MEASURED station-months
 * (NULL if any of them lacks the stamp); `calendarDays` = Σ SETTLED window
 * length of those same station-months (a running month counts its closed
 * days only), so coveredDays/calendarDays is the share of the priced period
 * that telemetry actually covers. Archive months are complete by
 * construction and excluded from both.
 */
export interface Coverage {
  coveredDays: number | null
  calendarDays: number
}

/**
 * Provenance counters (Defect 1, sep 2 2026). `measuredMonths` rows come from
 * the station's own telemetry (fleet dataset — always 0 in History Analysis);
 * `archiveMonths` are the simulator on the archive's REAL volume for that
 * month (history dataset — always 0 in Fleet). Synthesized / zero months and
 * months before the station's optimiser go-live no longer exist as rows.
 *
 * `sessions` on every aggregate is the sum of counts that rest on a real basis
 * (lib/hist-provenance `sessionsBasisOf`): counter charge events on fleet
 * months, per-connector power islands from the station's CCR export on
 * history months (sep 4 2026). `sessionsNa` = how many of the aggregated
 * station-months have no basis (history months whose export has not been
 * imported). The UI shows "n/a" when every station-month is n/a, otherwise
 * the count with a "k of n station-months" note. Client decision 2 sep 2026:
 * the import's 5 kW rising-edge estimate is never reported.
 */
export interface Provenance {
  measuredMonths: number
  archiveMonths: number
  sessionsNa: number
}

/**
 * The two battery-wear BASES behind the extra-wear figure (client request
 * sep 3 2026: "my wear cost in case of no load shifting" must be a column, not
 * something the reader back-solves). Archive (hist_*) rows have no measured
 * battery series and carry NULL for both; an aggregate is therefore only
 * reported when EVERY contributing row has the basis — never a partial sum.
 *   wearNoShiftEur  A4.2  wear WITHOUT load shifting (forced peak-shaving only)
 *   wearAsRunEur    A4.1  wear WITH load shifting, as run
 *   wearEur (A6.3)  == wearAsRunEur − wearNoShiftEur on every row that has both
 */
export interface WearBases {
  wearNoShiftEur: number | null
  wearAsRunEur: number | null
  /** Contributing rows that lack the bases (0 ⇒ the sums above are complete). */
  wearBasisMissing: number
}

export interface YearlyMonthTotal extends MeteredSplit, Provenance, WearBases, Coverage {
  month: string // "YYYY-MM"
  stations: number
  importKwh: number
  /** Site load (EV + AUX). Label it "Site load", never "EV". */
  evKwh: number
  sessions: number
  flatEur: number
  noShiftEur: number
  asRunEur: number
  procSavingEur: number
  wearEur: number
  netEur: number
  lsEur: number
  timingEur: number
  shiftedKwh: number
  computedAt: string // most recent computed_at in the month batch
}

export interface YearlyStationTotal extends MeteredSplit, Provenance, WearBases, Coverage {
  stationId: string
  city: string
  zip: string
  brand: string | null
  siteClass: YearlySiteClass
  /** Reported months = months with the station's OWN volume (measured or archive). */
  months: number
  importKwh: number
  evKwh: number
  sessions: number
  flatEur: number
  noShiftEur: number
  asRunEur: number
  procSavingEur: number
  wearEur: number
  netEur: number
  lsEur: number
  timingEur: number
  shiftedKwh: number
  anyMeasured: boolean
  /** Earliest telemetry frame across the station's measured months — the day
   *  the system started seeing this site (Gifhorn: 20 Aug 2026). NULL when no
   *  measured month in range carries the stamp. */
  dataFrom: string | null
}

/** Summary numbers for one site class over the whole range — the partner's
 * "which locations go first" view (WhatsApp request aug 24 2026). */
export interface YearlyClassSummary extends MeteredSplit, Provenance, WearBases, Coverage {
  siteClass: YearlySiteClass
  locations: number
  importKwh: number
  evKwh: number
  sessions: number
  flatEur: number
  noShiftEur: number
  asRunEur: number
  procSavingEur: number
  wearEur: number
  netEur: number
  lsEur: number
  timingEur: number
  shiftedKwh: number
}

export interface YearlyReport {
  fromMonth: string
  toMonth: string
  /** Selectable limits for the period picker — the dataset's full history. */
  bounds: { fromMonth: string; toMonth: string }
  months: YearlyMonthTotal[]
  /** Month-by-month totals restricted to one site class — powers the
   * EV-only / EV+PV toggle on the Months view (client request aug 24 2026).
   * Keyed by class; classes with no rows are absent. */
  monthsByClass: Partial<Record<YearlySiteClass, YearlyMonthTotal[]>>
  stations: YearlyStationTotal[]
  classSummaries: YearlyClassSummary[]
  totals: Omit<YearlyMonthTotal, "month" | "stations" | "computedAt"> & { stationMonths: number }
  /** Market context per month from IDM prices (avg spread + guaranteed-loss
   * day counts) — client request aug 24 2026 after the Aug-18 loss day.
   * Months without full IDM coverage are absent (UI shows "—"). */
  priceContext: Record<string, MonthPriceContext>
  /** Station-months present in the table but computed on a methodology other
   * than the current one — EXCLUDED from every figure above and shown as a
   * warning so a stale writer can never silently distort the report. */
  stale: { stationMonths: number; months: string[]; versions: string[] }
  /** The methodology every reported row was computed on. */
  methodologyVersion: string
}

/**
 * Full report history: FLEET_REPORT_FIRST_MONTH (May 2025) through the
 * PREVIOUS month (the running month is incomplete). Client request aug 21
 * 2026 — the yearly view shows every month since the fleet went live, not a
 * trailing-12 window.
 */
function fullHistoryRange(dataset: FleetDataset): { fromMonth: string; toMonth: string } {
  const now = new Date()
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
  // Live telemetry only exists from May 2026 (Gronau pilot); the live report
  // ALSO includes the running month — partial by design, real data only.
  if (dataset === "live") {
    const cur = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
    return { fromMonth: LIVE_FLEET_FIRST_MONTH, toMonth: cur }
  }
  return { fromMonth: FLEET_REPORT_FIRST_MONTH, toMonth: fmt(end) }
}

export async function getFleetYearlyReport(opts?: {
  fromMonth?: string
  toMonth?: string
  /** Which disjoint dataset to read. Defaults to "hist" (existing pages). */
  dataset?: FleetDataset
}): Promise<YearlyReport> {
  const dataset: FleetDataset = opts?.dataset === "live" ? "live" : "hist"
  const bounds = fullHistoryRange(dataset)
  // A requested sub-range (period picker / ?from=&to=) is clamped to the
  // dataset's history and ordered — a bad URL can never widen the report.
  const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
  const clamp = (m: string) => (m < bounds.fromMonth ? bounds.fromMonth : m > bounds.toMonth ? bounds.toMonth : m)
  let range = bounds
  if (isMonth(opts?.fromMonth) && isMonth(opts?.toMonth)) {
    const a = clamp(opts.fromMonth)
    const b = clamp(opts.toMonth)
    range = a <= b ? { fromMonth: a, toMonth: b } : { fromMonth: b, toMonth: a }
  }
  const datasetFilter =
    dataset === "live" ? notLike(fleetMonthReport.stationId, "hist_%") : like(fleetMonthReport.stationId, "hist_%")

  const [allRows, classRows] = await Promise.all([
    db
      .select()
      .from(fleetMonthReport)
      .where(
        and(
          gte(fleetMonthReport.month, range.fromMonth),
          lte(fleetMonthReport.month, range.toMonth),
          datasetFilter,
        ),
      ),
    // Site class lives in the stations registry (manual master data).
    db.select({ stationId: stations.stationId, siteClass: stations.siteClass }).from(stations),
  ])
  const classById = new Map<string, YearlySiteClass>()
  for (const c of classRows) {
    classById.set(c.stationId, (c.siteClass as YearlySiteClass | null) ?? "unknown")
  }
  // METHODOLOGY GUARD (sep 3 2026): a stale deployment's nightly cron rewrote
  // Aug/Sep live rows with an older builder that did not know the
  // no_shift_eur / sessions / aux_kwh columns — they landed as 0 / NULL and the
  // report summed timing = 0 − asRun into an −806 € "loss" that the Financial
  // Report never showed. Rows not on the CURRENT methodology are excluded from
  // every total and surfaced to the UI instead; the cron treats them as
  // unfilled and refreshes them on its next run.
  const staleRows = allRows.filter((r) => r.methodologyVersion !== METHODOLOGY_VERSION)
  const currentRows = allRows.filter((r) => r.methodologyVersion === METHODOLOGY_VERSION)
  const stale: YearlyReport["stale"] = {
    stationMonths: staleRows.length,
    months: [...new Set(staleRows.map((r) => r.month))].sort(),
    versions: [...new Set(staleRows.map((r) => r.methodologyVersion ?? "unknown"))].sort(),
  }
  // Defect 1: the archive report shows ONLY station-months with the station's
  // own volume. The builder no longer persists synthesized / zero months, but
  // rows written before sep 2 2026 may still be there — never let them into a
  // total. Live rows are measured by construction and pass unchanged.
  const rows = dataset === "hist" ? currentRows.filter((r) => isReportableArchiveMonth(r)) : currentRows

  // ── Per-month totals: one map for the fleet, one per site class. The same
  //    row feeds both so the class views always reconcile with the "All" view. ──
  // Metered split adds with NULL propagation: one archive month without
  // connector counters makes the whole aggregate "—" instead of a partial sum
  // that silently mixes metered and derived kWh.
  const addNullable = (acc: number | null, v: number | null | undefined): number | null =>
    acc === null || v == null ? null : acc + v
  const addSplit = (m: MeteredSplit, r: MeteredSplit) => {
    m.evDeliveredKwh = addNullable(m.evDeliveredKwh, r.evDeliveredKwh)
    m.auxKwh = addNullable(m.auxKwh, r.auxKwh)
    m.battNetKwh = addNullable(m.battNetKwh, r.battNetKwh)
  }
  // Coverage from a raw row: only MEASURED station-months count (archive
  // months are complete by construction). NULL-propagating like the wear
  // bases: one unstamped measured month makes the total unknown, not
  // understated. The denominator is the SETTLED window length — the same
  // Berlin-day window the row was priced on (Annex A8.1): a running month is
  // clipped at yesterday, so a fully covered current month is never flagged.
  const calendarDaysOf = (month: string) => berlinMonthWindow(month)?.days ?? 0
  const addRowCoverage = (c: Coverage, r: { measured: boolean | null; month: string; coveredDays: number | null }) => {
    if (!r.measured) return
    c.calendarDays += calendarDaysOf(r.month)
    c.coveredDays = addNullable(c.coveredDays, r.coveredDays)
  }
  const addCoverage = (c: Coverage, q: Coverage) => {
    c.calendarDays += q.calendarDays
    c.coveredDays = addNullable(c.coveredDays, q.coveredDays)
  }
  const emptyCoverage = (): Coverage => ({ coveredDays: 0, calendarDays: 0 })
  // Provenance from a raw row: measured telemetry vs archive export. A row
  // without a real session count (archive) is tallied in sessionsNa and
  // contributes nothing to `sessions`.
  const addRowProvenance = (p: Provenance, r: (typeof rows)[number]) => {
    if (r.measured || r.volumeSource === "measured") p.measuredMonths += 1
    else p.archiveMonths += 1
    if (reportableSessions(r) == null) p.sessionsNa += 1
  }
  const addProvenance = (p: Provenance, q: Provenance) => {
    p.measuredMonths += q.measuredMonths
    p.archiveMonths += q.archiveMonths
    p.sessionsNa += q.sessionsNa
  }
  /** Real charge events on this row, or 0 when the row is n/a. */
  const rowSessions = (r: (typeof rows)[number]) => reportableSessions(r) ?? 0
  // Wear bases add with the same NULL propagation as the metered split: an
  // aggregate is reported only when every contributing row (or sub-aggregate)
  // carries both bases; one archive month makes the whole sum "—". The
  // `wearBasisMissing` count lets the UI say how many rows lacked it.
  const addWear = (t: WearBases, src: { wearNoShiftEur: number | null; wearAsRunEur: number | null } & Partial<Pick<WearBases, "wearBasisMissing">>) => {
    const srcMissing = src.wearBasisMissing ?? (src.wearNoShiftEur == null || src.wearAsRunEur == null ? 1 : 0)
    t.wearBasisMissing += srcMissing
    t.wearNoShiftEur = addNullable(t.wearNoShiftEur, src.wearNoShiftEur)
    t.wearAsRunEur = addNullable(t.wearAsRunEur, src.wearAsRunEur)
  }
  const emptyWear = (): WearBases => ({ wearNoShiftEur: 0, wearAsRunEur: 0, wearBasisMissing: 0 })

  const emptyMonth = (r: (typeof rows)[number]): YearlyMonthTotal => ({
    month: r.month,
    stations: 0,
    importKwh: 0,
    evKwh: 0,
    evDeliveredKwh: 0,
    auxKwh: 0,
    battNetKwh: 0,
    measuredMonths: 0,
    archiveMonths: 0,
    sessionsNa: 0,
    sessions: 0,
    flatEur: 0,
    noShiftEur: 0,
    asRunEur: 0,
    procSavingEur: 0,
    ...emptyWear(),
    ...emptyCoverage(),
    wearEur: 0,
    netEur: 0,
    lsEur: 0,
    timingEur: 0,
    shiftedKwh: 0,
    computedAt: r.computedAt.toISOString(),
  })
  const addToMonth = (m: YearlyMonthTotal, r: (typeof rows)[number]) => {
    m.stations += 1
    m.importKwh += r.importKwh
    m.evKwh += r.evKwh
    addSplit(m, r)
    addRowProvenance(m, r)
    addRowCoverage(m, r)
    m.sessions += rowSessions(r)
    m.flatEur += r.flatEur
    m.noShiftEur += r.noShiftEur
    m.asRunEur += r.asRunEur
    m.procSavingEur += r.procSavingEur
    addWear(m, r)
    m.wearEur += r.wearEur
    m.netEur += r.netEur
    m.lsEur += r.lsEur
    m.timingEur += r.timingEur
    m.shiftedKwh += r.shiftedKwh
    if (r.computedAt.toISOString() > m.computedAt) m.computedAt = r.computedAt.toISOString()
  }

  const byMonth = new Map<string, YearlyMonthTotal>()
  const byMonthClass = new Map<YearlySiteClass, Map<string, YearlyMonthTotal>>()
  // ── Per-station totals ──
  const byStation = new Map<string, YearlyStationTotal>()

  for (const r of rows) {
    let m = byMonth.get(r.month)
    if (!m) {
      m = emptyMonth(r)
      byMonth.set(r.month, m)
    }
    addToMonth(m, r)

    const cls = classById.get(r.stationId) ?? "unknown"
    let clsMonths = byMonthClass.get(cls)
    if (!clsMonths) {
      clsMonths = new Map()
      byMonthClass.set(cls, clsMonths)
    }
    let cm = clsMonths.get(r.month)
    if (!cm) {
      cm = emptyMonth(r)
      clsMonths.set(r.month, cm)
    }
    addToMonth(cm, r)

    let s = byStation.get(r.stationId)
    if (!s) {
      s = {
        stationId: r.stationId,
        city: r.city,
        zip: r.zip,
        brand: r.brand,
        siteClass: classById.get(r.stationId) ?? "unknown",
        months: 0,
        importKwh: 0,
        evKwh: 0,
        evDeliveredKwh: 0,
        auxKwh: 0,
        battNetKwh: 0,
        measuredMonths: 0,
        archiveMonths: 0,
        sessionsNa: 0,
        sessions: 0,
        flatEur: 0,
        noShiftEur: 0,
        asRunEur: 0,
        procSavingEur: 0,
        ...emptyWear(),
        ...emptyCoverage(),
        wearEur: 0,
        netEur: 0,
        lsEur: 0,
        timingEur: 0,
        shiftedKwh: 0,
        anyMeasured: false,
        dataFrom: null,
      }
      byStation.set(r.stationId, s)
    }
    if (r.measured) {
      const from = r.dataFrom ? r.dataFrom.toISOString() : null
      if (from && (s.dataFrom == null || from < s.dataFrom)) s.dataFrom = from
    }
    addRowCoverage(s, r)
    s.months += 1
    s.importKwh += r.importKwh
    s.evKwh += r.evKwh
    addSplit(s, r)
    addRowProvenance(s, r)
    s.sessions += rowSessions(r)
    s.flatEur += r.flatEur
    s.noShiftEur += r.noShiftEur
    s.asRunEur += r.asRunEur
    s.procSavingEur += r.procSavingEur
    addWear(s, r)
    s.wearEur += r.wearEur
    s.netEur += r.netEur
    s.lsEur += r.lsEur
    s.timingEur += r.timingEur
    s.shiftedKwh += r.shiftedKwh
    if (r.measured) s.anyMeasured = true
  }

  const months = Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month))
  const monthsByClass: Partial<Record<YearlySiteClass, YearlyMonthTotal[]>> = {}
  for (const [cls, clsMonths] of byMonthClass) {
    monthsByClass[cls] = Array.from(clsMonths.values()).sort((a, b) => a.month.localeCompare(b.month))
  }
  const stationTotals = Array.from(byStation.values()).sort((a, b) => b.netEur - a.netEur)

  // ── Per-site-class summaries (ev_only / ev_pv / unknown, empty ones skipped) ──
  const byClass = new Map<YearlySiteClass, YearlyClassSummary>()
  for (const s of stationTotals) {
    let c = byClass.get(s.siteClass)
    if (!c) {
      c = {
        siteClass: s.siteClass,
        locations: 0,
        importKwh: 0,
        evKwh: 0,
        evDeliveredKwh: 0,
        auxKwh: 0,
        battNetKwh: 0,
        measuredMonths: 0,
        archiveMonths: 0,
        sessionsNa: 0,
        sessions: 0,
        flatEur: 0,
        noShiftEur: 0,
        asRunEur: 0,
        procSavingEur: 0,
        ...emptyWear(),
        ...emptyCoverage(),
        wearEur: 0,
        netEur: 0,
        lsEur: 0,
        timingEur: 0,
        shiftedKwh: 0,
      }
      byClass.set(s.siteClass, c)
    }
    c.locations += 1
    c.importKwh += s.importKwh
    c.evKwh += s.evKwh
    addSplit(c, s)
    addProvenance(c, s)
    addCoverage(c, s)
    c.sessions += s.sessions
    c.flatEur += s.flatEur
    c.noShiftEur += s.noShiftEur
    c.asRunEur += s.asRunEur
    c.procSavingEur += s.procSavingEur
    addWear(c, s)
    c.wearEur += s.wearEur
    c.netEur += s.netEur
    c.lsEur += s.lsEur
    c.timingEur += s.timingEur
    c.shiftedKwh += s.shiftedKwh
  }
  const classOrder: YearlySiteClass[] = ["ev_pv", "ev_only", "unknown"]
  const classSummaries = classOrder.map((k) => byClass.get(k)).filter((c): c is YearlyClassSummary => Boolean(c))

  const totals: YearlyReport["totals"] = {
    stationMonths: rows.length,
    importKwh: 0,
    evKwh: 0,
    evDeliveredKwh: 0,
    auxKwh: 0,
    battNetKwh: 0,
    measuredMonths: 0,
    archiveMonths: 0,
    sessionsNa: 0,
    sessions: 0,
    flatEur: 0,
    noShiftEur: 0,
    asRunEur: 0,
    procSavingEur: 0,
    ...emptyWear(),
    ...emptyCoverage(),
    wearEur: 0,
    netEur: 0,
    lsEur: 0,
    timingEur: 0,
    shiftedKwh: 0,
  }
  for (const m of months) {
    totals.importKwh += m.importKwh
    totals.evKwh += m.evKwh
    addSplit(totals, m)
    addProvenance(totals, m)
    addCoverage(totals, m)
    totals.sessions += m.sessions
    totals.flatEur += m.flatEur
    totals.noShiftEur += m.noShiftEur
    totals.asRunEur += m.asRunEur
    totals.procSavingEur += m.procSavingEur
    addWear(totals, m)
    totals.wearEur += m.wearEur
    totals.netEur += m.netEur
    totals.lsEur += m.lsEur
    totals.timingEur += m.timingEur
    totals.shiftedKwh += m.shiftedKwh
  }

  // ── Market price context per month (never let a price-side failure take
  //    down the report — it is context, not the report itself) ──
  let priceContext: Record<string, MonthPriceContext> = {}
  try {
    const ctx = await getMonthlyPriceContext(months.map((m) => m.month))
    priceContext = Object.fromEntries(ctx)
  } catch (e) {
    console.error("[fleet-yearly] price context unavailable:", e)
  }

  return {
    ...range,
    bounds,
    months,
    monthsByClass,
    stations: stationTotals,
    classSummaries,
    totals,
    priceContext,
    stale,
    methodologyVersion: METHODOLOGY_VERSION,
  }
}
