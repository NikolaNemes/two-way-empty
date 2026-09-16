/**
 * Excel export of the Fleet Yearly Report (client feedback aug 20 2026:
 * "send us an excel — the numbers are not usable without copying manually").
 *
 * Reads ONLY the pre-computed fleet_month_report table (no on-the-fly
 * simulation). Three sheets:
 *   1. "Monthly totals"   — one row per month (fleet aggregates)
 *   2. "Stations (12mo)"  — one row per station, summed over the range
 *   3. "Station-months"   — the raw grain: one row per station × month
 *
 * Auth: this is a browser route (behind Clerk via proxy.ts — /api/reports is
 * NOT in the machine bypass list), so the signed-in session downloads it
 * directly from the yearly page.
 */

import { NextResponse, type NextRequest } from "next/server"
import ExcelJS from "exceljs"
import { db } from "@/lib/db"
import { fleetMonthReport } from "@/lib/db/schema"
import { and, gte, like, lte, notLike } from "drizzle-orm"
import { getFleetYearlyReport, type FleetDataset } from "@/app/actions/fleet-yearly"
import { METHODOLOGY_VERSION } from "@/lib/fleet-report-builder"
import {
  isReportableArchiveMonth,
  reportableSessions,
  sessionsBasisLabel,
  volumeSourceLabel,
} from "@/lib/hist-provenance"
import { DEFAULT_FLAT_CT, DEFAULT_ADDER_CT, DEFAULT_CYCLING_CT } from "@/lib/tariff-compute"
import { appendDefinitionsSheet } from "@/lib/report-definitions"
import { berlinDayOf as berlinDay } from "@/lib/report-window"

export const maxDuration = 60

const EUR = "#,##0.00\u00a0€"
const KWH = "#,##0"
const NUM0 = "#,##0"

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const fromMonth = url.searchParams.get("from") ?? undefined
  const toMonth = url.searchParams.get("to") ?? undefined
  // Disjoint datasets in one table: hist_* twins vs real chargepost_* stations.
  const dataset: FleetDataset = url.searchParams.get("dataset") === "live" ? "live" : "hist"
  const datasetFilter =
    dataset === "live" ? notLike(fleetMonthReport.stationId, "hist_%") : like(fleetMonthReport.stationId, "hist_%")

  const report = await getFleetYearlyReport(
    fromMonth && toMonth ? { fromMonth, toMonth, dataset } : { dataset },
  )

  const rawAll = await db
    .select()
    .from(fleetMonthReport)
    .where(
      and(
        gte(fleetMonthReport.month, report.fromMonth),
        lte(fleetMonthReport.month, report.toMonth),
        datasetFilter,
      ),
    )
  // Defect 1 (sep 2 2026): the archive export lists ONLY station-months with
  // the station's own volume — the same rule the on-screen report applies —
  // so the Excel grain reconciles with the tables above it.
  const raw = dataset === "hist" ? rawAll.filter((r) => isReportableArchiveMonth(r)) : rawAll
  const droppedRows = rawAll.length - raw.length
  raw.sort((a, b) => a.month.localeCompare(b.month) || a.city.localeCompare(b.city))

  const wb = new ExcelJS.Workbook()
  wb.creator = "enexa fleet reporting"
  wb.created = new Date()

  const headerStyle = (ws: ExcelJS.Worksheet) => {
    const row = ws.getRow(1)
    row.font = { bold: true, size: 10 }
    row.alignment = { vertical: "middle" }
    ws.views = [{ state: "frozen", ySplit: 1 }]
  }

  // ── Sheet 0: Report info (Annex A8 audit header — NITES feedback) ───────
  const s0 = wb.addWorksheet("Report info")
  s0.columns = [
    { header: "Field", key: "k", width: 34 },
    { header: "Value", key: "v", width: 44 },
  ]
  const measuredRows = raw.filter((r) => r.measured)
  const dataThrough = measuredRows.reduce<Date | null>(
    (acc, r) => (r.dataThrough && (!acc || r.dataThrough > acc) ? r.dataThrough : acc),
    null,
  )
  const dataFrom = measuredRows.reduce<Date | null>(
    (acc, r) => (r.dataFrom && (!acc || r.dataFrom < acc) ? r.dataFrom : acc),
    null,
  )
  // Station-months that settled on fewer days than the calendar month has —
  // named explicitly so nobody reads a 12-day row as a full August.
  const partialMonths = measuredRows
    .filter((r) => {
      if (r.coveredDays == null) return false
      const [yy, mm] = r.month.split("-").map(Number)
      return r.coveredDays < new Date(Date.UTC(yy, mm, 0)).getUTCDate()
    })
    .map((r) => {
      const [yy, mm] = r.month.split("-").map(Number)
      return `${r.city} ${r.month}: ${r.coveredDays}/${new Date(Date.UTC(yy, mm, 0)).getUTCDate()} days`
    })
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const idmMix = avg(measuredRows.map((r) => r.idmFraction ?? 0))
  const damMix = avg(measuredRows.map((r) => r.damFraction ?? 0))
  const pct = (x: number | null) => (x == null ? "n/a" : `${(100 * x).toFixed(1)}%`)
  const methodologies = [...new Set(raw.map((r) => r.methodologyVersion).filter(Boolean))]
  const infoRows: Array<[string, string]> = [
    [
      "Dataset",
      dataset === "live"
        ? "FLEET (real) — measured telemetry from live stations only; no simulation, no archive data"
        : "HISTORY ANALYSIS — pre-system archive (CCR export) simulated on each station's own export volume; no telemetry, no measured rows, no calibration against live stations",
    ],
    ["Settlement window", `${report.fromMonth} through ${report.toMonth}`],
    ["Generated at (UTC)", new Date().toISOString().slice(0, 16).replace("T", " ")],
    [
      "Data from (measured rows, first day with data)",
      dataFrom ? berlinDay(dataFrom) : "no measured rows in range",
    ],
    [
      "Data through (measured rows)",
      dataThrough ? dataThrough.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "no measured rows in range",
    ],
    [
      "Partial station-months",
      partialMonths.length
        ? `${partialMonths.join("; ")} — euros cover the days with data only, NOT scaled to a full month`
        : "none (every measured station-month has data on every calendar day)",
    ],
    // Rows filled before the audit fields existed have no stamp — show current.
    ["Methodology version", methodologies.length ? methodologies.join(", ") : `${METHODOLOGY_VERSION} (current)`],
    ["Flat baseline rate", `${DEFAULT_FLAT_CT.toFixed(2)} ct/kWh (Annex: 12.5 unless otherwise agreed)`],
    ["Supplier adder on dynamic price", `${DEFAULT_ADDER_CT.toFixed(2)} ct/kWh — dynamic € figures include NO adder`],
    ["Battery wear rate", `${DEFAULT_CYCLING_CT.toFixed(2)} ct/kWh of shifted throughput`],
    ["Price sources (measured rows)", measuredRows.length ? `IDM ${pct(idmMix)} / DAM fallback ${pct(damMix)}` : "n/a"],
    ...(dataset === "live"
      ? ([
          [
            "Measured months in range",
            measuredRows.length ? measuredRows.map((r) => `${r.month} (${r.city})`).join(", ") : "none",
          ],
        ] as Array<[string, string]>)
      : []),
    [
      "Counterfactual methodology",
      dataset === "live"
        ? "Annex A6 grid-first simulation on the station's own measured frames and market prices; every row is fully measured (no simulation)"
        : "Annex A6 grid-first simulation on the archive's hourly volume and historical market prices; load-shift value is the simulator's own figure (no scaling by any live-station ratio)",
    ],
    [
      "Station-month provenance",
      dataset === "live"
        ? `${raw.length} station-months, all measured from station telemetry`
        : `${report.totals.archiveMonths} station-months, all from the archive's own export volume for that month. Months the archive does not cover, or where the station was not inside its optimised period, are NOT reported${droppedRows > 0 ? ` (${droppedRows} such rows excluded from this range)` : ""}.`,
    ],
    [
      "Sessions",
      dataset === "live"
        ? "Real charge events from the per-connector energy counters"
        : "n/a — the archive import carried no charge events (power and SoC columns only). No estimate is shown; to be re-derived from the source export's per-connector counters.",
    ],
  ]
  for (const [k, v] of infoRows) s0.addRow({ k, v })
  s0.getColumn(2).alignment = { wrapText: true, vertical: "top" }
  headerStyle(s0)

  // ONE volume column set on every sheet (Gronau defect 3, sep 2 2026).
  // Live: Grid import / EV delivered (C1+C2) metered / AUX (ChargePost) /
  // Battery net — since method 2026-09-03.3 the four close exactly per row:
  // import = EV delivered + AUX + battery net.
  // Hist: Grid import / Site load (EV + AUX) — the archive export has no
  // connector counters. "EV kWh" (kernel demand signal incl. AUX) is retired.
  const volumeColumns =
    dataset === "live"
      ? [
          { header: "Grid import kWh", key: "importKwh", width: 14, style: { numFmt: KWH } },
          { header: "EV delivered (C1+C2) kWh", key: "evDeliveredKwh", width: 20, style: { numFmt: KWH } },
          { header: "AUX (ChargePost self-consumption) kWh", key: "auxKwh", width: 22, style: { numFmt: KWH } },
          { header: "Battery net (charge − discharge) kWh", key: "battNetKwh", width: 22, style: { numFmt: KWH } },
        ]
      : [
          { header: "Grid import kWh", key: "importKwh", width: 14, style: { numFmt: KWH } },
          { header: "Site load (EV + AUX) kWh", key: "evKwh", width: 20, style: { numFmt: KWH } },
        ]

  // ── Sheet 1: Monthly totals ────────�����────────────────────────────────────
  const s1 = wb.addWorksheet("Monthly totals")
  // Provenance columns (Defect 1): station-months in the aggregate and how
  // many of them carry no session count (history: all of them).
  const provenanceColumns =
    dataset === "live"
      ? []
      : [
          { header: "Archive station-months", key: "archiveMonths", width: 14, style: { numFmt: NUM0 } },
          { header: "Station-months w/o sessions", key: "sessionsNa", width: 14, style: { numFmt: NUM0 } },
        ]

  // ONE money column set for every sheet — the same six figures, same order,
  // same labels as the Fleet Monthly / Fleet Yearly tables and the Financial
  // Report blocks (client request sep 3 2026: the three procurement costs and
  // the three wear figures must be readable directly, never back-solved).
  // "Dynamic" not "IDM": prices are IDM with DAM fallback + supplier adder
  // (adder currently 0 — stated on the Report info sheet).
  const moneyColumns: Partial<ExcelJS.Column>[] = [
    { header: "Flat €", key: "flatEur", width: 12, style: { numFmt: EUR } },
    // NITES feedback aug 31 2026: the applied rate must be impossible to miss.
    { header: "Flat rate applied ct/kWh", key: "flatCtApplied", width: 20, style: { numFmt: "0.00" } },
    { header: "Dynamic € without load shifting (A6.2)", key: "noShiftEur", width: 22, style: { numFmt: EUR } },
    { header: "Dynamic € as run (A6.1)", key: "asRunEur", width: 20, style: { numFmt: EUR } },
    { header: "Procurement saving €", key: "procSavingEur", width: 18, style: { numFmt: EUR } },
    { header: "Wear € without load shifting (A4.2)", key: "wearNoShiftEur", width: 20, style: { numFmt: EUR } },
    { header: "Wear € as run (A4.1)", key: "wearAsRunEur", width: 18, style: { numFmt: EUR } },
    { header: "Extra wear € (A6.3)", key: "wearEur", width: 16, style: { numFmt: EUR } },
    { header: "Net €", key: "netEur", width: 12, style: { numFmt: EUR } },
    { header: "Load-shift gain €", key: "lsEur", width: 15, style: { numFmt: EUR } },
  ]

  s1.columns = [
    { header: "Month", key: "month", width: 10 },
    { header: "Stations", key: "stations", width: 9, style: { numFmt: NUM0 } },
    ...provenanceColumns,
    ...volumeColumns,
    { header: "Sessions", key: "sessions", width: 10, style: { numFmt: NUM0 } },
    ...moneyColumns,
    { header: "Timing value €", key: "timingEur", width: 14, style: { numFmt: EUR } },
    { header: "Shifted kWh", key: "shiftedKwh", width: 12, style: { numFmt: KWH } },
  ]
  // Sessions cell is blank (not 0) when every station-month in the aggregate
  // is n/a — otherwise it is the sum of real charge events.
  const sessionsCell = (sessions: number, na: number, stationMonths: number) =>
    stationMonths > 0 && na >= stationMonths ? null : sessions
  for (const m of report.months) {
    s1.addRow({
      ...m,
      sessions: sessionsCell(m.sessions, m.sessionsNa, m.measuredMonths + m.archiveMonths),
      flatCtApplied: m.importKwh > 0 ? (100 * m.flatEur) / m.importKwh : null,
    })
  }
  const t = report.totals
  const totalRow = s1.addRow({
    month: "TOTAL",
    stations: report.stations.length,
    archiveMonths: t.archiveMonths,
    sessionsNa: t.sessionsNa,
    // Sessions: sum of REAL charge events; blank (not 0) when every
    // station-month is n/a so Excel users don't read "0 sessions".
    sessions: t.sessionsNa >= t.stationMonths && t.stationMonths > 0 ? null : t.sessions,
    evKwh: t.evKwh,
    importKwh: t.importKwh,
    evDeliveredKwh: t.evDeliveredKwh,
    auxKwh: t.auxKwh,
    battNetKwh: t.battNetKwh,
    flatEur: t.flatEur,
    flatCtApplied: t.importKwh > 0 ? (100 * t.flatEur) / t.importKwh : null,
    noShiftEur: t.noShiftEur,
    asRunEur: t.asRunEur,
    procSavingEur: t.procSavingEur,
    wearNoShiftEur: t.wearNoShiftEur,
    wearAsRunEur: t.wearAsRunEur,
    wearEur: t.wearEur,
    netEur: t.netEur,
    lsEur: t.lsEur,
    timingEur: t.timingEur,
    shiftedKwh: t.shiftedKwh,
  })
  totalRow.font = { bold: true }
  headerStyle(s1)

  // ── Sheet 2: Stations summed over the range ─────────────────────────────
  const s2 = wb.addWorksheet("Stations (range)")
  s2.columns = [
    { header: "Station ID", key: "stationId", width: 26 },
    { header: "City", key: "city", width: 18 },
    { header: "ZIP", key: "zip", width: 8 },
    { header: "Brand", key: "brand", width: 14 },
    { header: "Site class", key: "siteClass", width: 11 },
    { header: "Months reported", key: "months", width: 9, style: { numFmt: NUM0 } },
    ...provenanceColumns,
    // Coverage (Aug 2026 review): a station onboarded mid-month or with a
    // telemetry outage settles on FEWER days than the calendar suggests, and
    // the euros are NOT scaled up. The reader must see this next to the money.
    ...(dataset === "live"
      ? [
          { header: "Data from (first day with data)", key: "dataFrom", width: 20 },
          { header: "Days with data", key: "coveredDays", width: 10, style: { numFmt: NUM0 } },
        ]
      : []),
    ...volumeColumns,
    { header: "Sessions", key: "sessions", width: 10, style: { numFmt: NUM0 } },
    ...moneyColumns,
    { header: "Shifted kWh", key: "shiftedKwh", width: 12, style: { numFmt: KWH } },
    // "Contains measured: yes" (Defect 1) was true for a station with ONE
    // measured month out of 15 and read as "all of this is measured". The
    // provenance columns above (Measured / Archive station-months) carry the
    // exact split, so the boolean is gone.
  ]
  for (const s of report.stations) {
    s2.addRow({
      ...s,
      sessions: sessionsCell(s.sessions, s.sessionsNa, s.months),
      flatCtApplied: s.importKwh > 0 ? (100 * s.flatEur) / s.importKwh : null,
      siteClass: s.siteClass === "ev_pv" ? "EV + PV" : s.siteClass === "ev_only" ? "EV-only" : "",
      dataFrom: s.dataFrom ? berlinDay(new Date(s.dataFrom)) : "",
      coveredDays: s.coveredDays ?? "",
    })
  }
  headerStyle(s2)

  // ── Sheet 3: raw station-month grain ────────────────────────────────────
  const s3 = wb.addWorksheet("Station-months")
  s3.columns = [
    { header: "Month", key: "month", width: 10 },
    { header: "Station ID", key: "stationId", width: 26 },
    { header: "City", key: "city", width: 18 },
    { header: "ZIP", key: "zip", width: 8 },
    { header: "Brand", key: "brand", width: 14 },
    { header: "Volume basis", key: "volumeSource", width: 28 },
    { header: "Measured", key: "measured", width: 10 },
    ...volumeColumns,
    { header: "Sessions", key: "sessions", width: 10, style: { numFmt: NUM0 } },
    { header: "Sessions basis", key: "sessionsBasis", width: 22 },
    ...moneyColumns,
    { header: "Shifted kWh", key: "shiftedKwh", width: 12, style: { numFmt: KWH } },
    // Price-mix / data-through audit columns only exist for telemetry rows;
    // the history dataset has nothing to put in them.
    ...(dataset === "live"
      ? [
          { header: "IDM share", key: "idmFraction", width: 10, style: { numFmt: "0.0%" } },
          { header: "DAM share", key: "damFraction", width: 10, style: { numFmt: "0.0%" } },
          { header: "Data from", key: "dataFrom", width: 17 },
          { header: "Data through", key: "dataThrough", width: 17 },
          { header: "Days with data", key: "coveredDays", width: 10, style: { numFmt: NUM0 } },
          { header: "Days in month", key: "daysInMonth", width: 10, style: { numFmt: NUM0 } },
        ]
      : []),
    { header: "Methodology", key: "methodologyVersion", width: 14 },
    { header: "Computed at", key: "computedAt", width: 20 },
  ]
  for (const r of raw) {
    const realSessions = reportableSessions(r)
    const [yy, mm] = r.month.split("-").map(Number)
    s3.addRow({
      ...r,
      volumeSource: dataset === "live" ? "Measured (telemetry)" : volumeSourceLabel(r.volumeSource),
      sessions: realSessions,
      sessionsBasis: sessionsBasisLabel(r),
      measured: r.measured ? "yes" : "no",
      // Rows filled before the audit columns existed: derive the rate so the
      // column is NEVER blank (the point of the NITES finding).
      flatCtApplied: r.flatCtApplied ?? (r.importKwh > 0 ? (100 * r.flatEur) / r.importKwh : null),
      dataFrom: r.dataFrom ? berlinDay(r.dataFrom) : "",
      dataThrough: r.dataThrough ? r.dataThrough.toISOString().slice(0, 16).replace("T", " ") : "",
      coveredDays: r.coveredDays ?? "",
      daysInMonth: new Date(Date.UTC(yy, mm, 0)).getUTCDate(),
      computedAt: r.computedAt.toISOString().slice(0, 16).replace("T", " "),
    })
  }
  headerStyle(s3)

  // ── Sheet 4: Definitions — the shared Annex glossary (lib/report-definitions) ──
  appendDefinitionsSheet(wb, [
    "site",
    "settlementWindow",
    "measuredMonth",
    "archiveMonth",
    "dataFrom",
    "coveredDays",
    "gridImport",
    "evDelivered",
    "aux",
    "siteLoad",
    "sessions",
    "flatRate",
    "dynamicTariff",
    "priceSourceMix",
    "flatCost",
    "counterfactualImport",
    "counterfactualCost",
    "dynamicCost",
    "procurementSaving",
    "wearNoShift",
    "wearAsRun",
    "extraWear",
    "netTotalSaving",
    "loadShiftingContribution",
    "timingValue",
    "idmSpread",
    "dayVerdict",
    "dataThrough",
  ])

  const buf = await wb.xlsx.writeBuffer()
  const filename =
    dataset === "live"
      ? `fleet-report-real_${report.fromMonth}_${report.toMonth}.xlsx`
      : `fleet-monthly-report_${report.fromMonth}_${report.toMonth}.xlsx`
  return new NextResponse(buf as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
