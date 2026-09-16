"use client"

/**
 * Fleet Yearly Report — renders PRE-COMPUTED fleet_month_report data.
 * No simulation happens here (client feedback aug 20 2026): the page is a
 * plain view over the background table filled by /api/cron/fleet-report.
 */

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Database, CalendarRange, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExportExcelButton } from "@/components/reports/export-excel-button"
import { ColumnModeTabs, SETTLEMENT_TABLE_CLASS, showColumn, type ColumnMode } from "@/components/reports/column-mode"
import { ReportMonthRangePicker } from "@/components/reports/report-month-picker"
import { TermHead, TermLabel } from "@/components/reports/term"
import { CoverageBadge } from "@/components/reports/coverage-badge"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { YearlyReport, YearlySiteClass } from "@/app/actions/fleet-yearly"

const CLASS_LABEL: Record<YearlySiteClass, string> = {
  ev_only: "EV-only",
  ev_pv: "EV + PV",
  unknown: "Unclassified",
}
const CLASS_BADGE_CLS: Record<YearlySiteClass, string> = {
  ev_only: "border-transparent bg-secondary text-secondary-foreground",
  ev_pv: "border-transparent bg-primary/10 text-primary",
  unknown: "text-muted-foreground",
}

const fmtEur = (v: number) =>
  v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
const fmtKwh = (v: number) => `${Math.round(v).toLocaleString("de-DE")} kWh`
const fmtNum = (v: number) => Math.round(v).toLocaleString("de-DE")

/**
 * Sessions provenance (Defect 1, client decision 2 sep 2026): a count is shown
 * only where it rests on a real basis (lib/hist-provenance `sessionsBasisOf`).
 *   Fleet dataset      — charge events from the per-connector energy counters.
 *   History Analysis   — per-connector power islands re-derived from the
 *                        station's CCR export (sep 4 2026); a station-month is
 *                        n/a until that station's export has been imported.
 * The one-time import's 5 kW rising-edge estimate is never shown. An aggregate
 * is "n/a" when every station-month is n/a; otherwise it is the count over the
 * station-months that have one ("k of n" in the sub-line).
 */
const fmtSessions = (sessions: number, na: number, stationMonths: number) =>
  stationMonths > 0 && na >= stationMonths ? "n/a" : fmtNum(sessions)

/** "3 of 8 station-months" — only when some, not all, contributing rows are n/a.
 *  On a single month row the contributing rows are stations, so the caller
 *  passes unit="stations". */
const fmtSessionsCoverage = (na: number, stationMonths: number, unit = "station-months") =>
  na > 0 && na < stationMonths ? `${stationMonths - na} of ${stationMonths} ${unit}` : null

const SESSIONS_HINT_LIVE = "Real charge events from the per-connector energy counters."
const SESSIONS_HINT_HIST =
  "Charging sessions re-derived from the station's CCR export as per-connector power islands (same filters as the live counter method: idle ≤ 8 min bridged, ≥ 2 frames, > 0.1 kWh). n/a = that station's export has not been imported yet; no estimate is shown."

/** Battery net is signed: "+120" = pack absorbed, "−45" = pack released. */
const fmtSigned = (v: number) => {
  const r = Math.round(v)
  return r === 0 ? "0" : `${r > 0 ? "+" : "−"}${Math.abs(r).toLocaleString("de-DE")}`
}

/**
 * ONE volume column set for every table on this page (Gronau defect 3).
 * Live: Grid import / EV delivered (C1+C2) metered / AUX (ChargePost) /
 * Battery net — the four close exactly per row since method 2026-09-03.3:
 * import = EV delivered + AUX + battery net.
 * Hist (archive export, no connector counters): Grid import / Site load.
 * "EV kWh" — the kernel demand signal that absorbed AUX — is retired.
 */
function VolumeHeads({ isLive }: { isLive: boolean }) {
  return (
    <>
      <TermHead term="gridImport" unit="kWh" className="text-right" />
      {isLive ? (
        <>
          <TermHead term="evDelivered" unit="kWh" className="text-right" />
          <TermHead term="aux" unit="kWh" className="text-right" />
          <TermHead term="battNet" unit="kWh" className="text-right" />
        </>
      ) : (
        <TermHead term="siteLoad" unit="kWh" className="text-right" />
      )}
    </>
  )
}

function VolumeCells({
  isLive,
  importKwh,
  evKwh,
  evDeliveredKwh,
  auxKwh,
  battNetKwh,
}: {
  isLive: boolean
  importKwh: number
  evKwh: number
  evDeliveredKwh: number | null
  auxKwh: number | null
  battNetKwh: number | null
}) {
  return (
    <>
      <TableCell className="text-right tabular-nums">{fmtNum(importKwh)}</TableCell>
      {isLive ? (
        <>
          <TableCell className="text-right tabular-nums">
            {evDeliveredKwh != null ? fmtNum(evDeliveredKwh) : "—"}
          </TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">
            {auxKwh != null ? fmtNum(auxKwh) : "—"}
          </TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">
            {battNetKwh != null ? fmtSigned(battNetKwh) : "—"}
          </TableCell>
        </>
      ) : (
        <TableCell className="text-right tabular-nums">{fmtNum(evKwh)}</TableCell>
      )}
    </>
  )
}

const monthLabel = (m: string) => {
  const [y, mm] = m.split("-").map(Number)
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function FleetYearlyScreen({
  report,
  dataset = "hist",
}: {
  report: YearlyReport
  /** "hist" = archive-twin simulation (default); "live" = real stations only. */
  dataset?: "hist" | "live"
}) {
  const isLive = dataset === "live"
  const [view, setView] = useState<"months" | "stations">("months")
  const [classFilter, setClassFilter] = useState<YearlySiteClass | "all">("all")
  // Screen-width control only — the Excel export always carries every column.
  const [columnMode, setColumnMode] = useState<ColumnMode>("essential")
  const all = (col: Parameters<typeof showColumn>[1]) => showColumn(columnMode, col)

  const filteredStations = useMemo(
    () => (classFilter === "all" ? report.stations : report.stations.filter((s) => s.siteClass === classFilter)),
    [report.stations, classFilter],
  )
  // Months view honours the same class toggle (client request aug 24 2026):
  // per-class month rows are pre-aggregated server-side from the same
  // station-month grain, so class views always reconcile with "All".
  const filteredMonths = useMemo(
    () => (classFilter === "all" ? report.months : (report.monthsByClass[classFilter] ?? [])),
    [report.months, report.monthsByClass, classFilter],
  )
  // TOTAL row must follow the active filter — summed from the visible months.
  const monthTotals = useMemo(() => {
    const t: {
      evKwh: number
      importKwh: number
      evDeliveredKwh: number | null
      auxKwh: number | null
      battNetKwh: number | null
      flatEur: number
      noShiftEur: number
      asRunEur: number
      procSavingEur: number
      wearNoShiftEur: number | null
      wearAsRunEur: number | null
      wearEur: number
      netEur: number
      lsEur: number
      /** Σ sessions over station-months WITH a basis; sessionsNa = station-
       *  months without one, stationMonths = all — same triple the Stations
       *  view and the KPI strip use, so fmtSessions applies unchanged. */
      sessions: number
      sessionsNa: number
      stationMonths: number
    } = {
      evKwh: 0,
      importKwh: 0,
      evDeliveredKwh: 0,
      auxKwh: 0,
      battNetKwh: 0,
      flatEur: 0,
      noShiftEur: 0,
      asRunEur: 0,
      procSavingEur: 0,
      wearNoShiftEur: 0,
      wearAsRunEur: 0,
      wearEur: 0,
      netEur: 0,
      lsEur: 0,
      sessions: 0,
      sessionsNa: 0,
      stationMonths: 0,
    }
    for (const m of filteredMonths) {
      t.evKwh += m.evKwh
      t.importKwh += m.importKwh
      t.sessions += m.sessions
      t.sessionsNa += m.sessionsNa
      t.stationMonths += m.stations
      t.evDeliveredKwh = t.evDeliveredKwh === null || m.evDeliveredKwh == null ? null : t.evDeliveredKwh + m.evDeliveredKwh
      t.auxKwh = t.auxKwh === null || m.auxKwh == null ? null : t.auxKwh + m.auxKwh
      t.battNetKwh = t.battNetKwh === null || m.battNetKwh == null ? null : t.battNetKwh + m.battNetKwh
      t.flatEur += m.flatEur
      t.noShiftEur += m.noShiftEur
      t.asRunEur += m.asRunEur
      t.procSavingEur += m.procSavingEur
      t.wearNoShiftEur = t.wearNoShiftEur === null || m.wearNoShiftEur == null ? null : t.wearNoShiftEur + m.wearNoShiftEur
      t.wearAsRunEur = t.wearAsRunEur === null || m.wearAsRunEur == null ? null : t.wearAsRunEur + m.wearAsRunEur
      t.wearEur += m.wearEur
      t.netEur += m.netEur
      t.lsEur += m.lsEur
    }
    return t
  }, [filteredMonths])
  // True once anything is classified — before that the class UI stays hidden
  // (all rows are "unknown", the split would be noise).
  const anyClassified = useMemo(() => report.stations.some((s) => s.siteClass !== "unknown"), [report.stations])

  const freshest = useMemo(() => {
    let latest = ""
    for (const m of report.months) if (m.computedAt > latest) latest = m.computedAt
    return latest ? new Date(latest).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : null
  }, [report.months])

  const xlsxHref = `/api/reports/fleet-yearly/xlsx?from=${report.fromMonth}&to=${report.toMonth}&dataset=${dataset}`
  const empty = report.months.length === 0

  // Period picker → URL (?from=&to=) → server re-render. The report itself is
  // fetched server-side, so the picker only navigates; the transition keeps
  // the current table visible (dimmed) until the new one arrives.
  const router = useRouter()
  const pathname = usePathname()
  const [isNavigating, startNavigate] = useTransition()
  const onRangeChange = (r: { from: string; to: string }) => {
    const q = new URLSearchParams({ from: r.from, to: r.to })
    startNavigate(() => router.push(`${pathname}?${q.toString()}`))
  }
  const isFullHistory = report.fromMonth === report.bounds.fromMonth && report.toMonth === report.bounds.toMonth

  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      {/* ── Header ── */}
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            {isLive ? "Fleet Yearly Report" : "History Analysis — Yearly Report"}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
            {monthLabel(report.fromMonth)} — {monthLabel(report.toMonth)} ·{" "}
            {isLive
              ? "real stations only — every row measured from the station's own telemetry. No simulation, no archive data."
              : "pre-system archive only — every row simulated on the station's own export volume. No telemetry, no live-station calibration. Read from the pre-computed report table (filled nightly)."}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Badge variant="outline" className="gap-1.5 font-normal">
              <Database className="size-3" />
              {isLive ? "measured telemetry" : "archive simulation"}
            </Badge>
            {freshest ? (
              <span className="text-xs text-muted-foreground">last refreshed {freshest}</span>
            ) : null}
            {!isLive ? (
              <Link
                href="/portfolio/prices"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Price analysis →
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <ReportMonthRangePicker
              from={report.fromMonth}
              to={report.toMonth}
              min={report.bounds.fromMonth}
              max={report.bounds.toMonth}
              onChange={onRangeChange}
              disabled={isNavigating}
            />
            <ExportExcelButton href={xlsxHref} disabled={empty || isNavigating} />
          </div>
          {!isFullHistory ? (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => onRangeChange({ from: report.bounds.fromMonth, to: report.bounds.toMonth })}
              disabled={isNavigating}
            >
              Show full history ({monthLabel(report.bounds.fromMonth)} — {monthLabel(report.bounds.toMonth)})
            </button>
          ) : null}
        </div>
      </header>

      {report.stale.stationMonths > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-xs text-foreground"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <p className="text-pretty">
            <span className="font-medium">
              {report.stale.stationMonths} station-month{report.stale.stationMonths === 1 ? "" : "s"} excluded
            </span>{" "}
            ({report.stale.months.map(monthLabel).join(", ")}) — computed on methodology{" "}
            {report.stale.versions.join(", ")} instead of the current {report.methodologyVersion}. They are not in
            any figure on this page. The nightly job recomputes them; an admin can trigger it with{" "}
            <code>/api/cron/fleet-report?dataset={isLive ? "live" : "hist"}&amp;force=1</code>.
          </p>
        </div>
      ) : null}

      {empty ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <CalendarRange className="mx-auto mb-3 size-6 opacity-50" />
            The background table has no rows for this range yet. It fills automatically overnight, or an
            admin can trigger <code className="text-xs">/api/cron/fleet-report</code>.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Fleet totals ── */}
          <section aria-label="Fleet totals" className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            {[
              { label: "Grid import", value: fmtKwh(report.totals.importKwh) },
              // ONE EV definition (Gronau defect 3): live rows carry the METERED
              // connector energy; the archive only has site load (EV + AUX).
              isLive
                ? {
                    label: "EV delivered (C1+C2)",
                    value: report.totals.evDeliveredKwh != null ? fmtKwh(report.totals.evDeliveredKwh) : "—",
                  }
                : { label: "Site load (EV + AUX)", value: fmtKwh(report.totals.evKwh) },
              {
                label: "Sessions",
                value: fmtSessions(report.totals.sessions, report.totals.sessionsNa, report.totals.stationMonths),
                sub: fmtSessionsCoverage(report.totals.sessionsNa, report.totals.stationMonths) ?? undefined,
                hint: isLive ? SESSIONS_HINT_LIVE : SESSIONS_HINT_HIST,
              },
              { label: "Procurement saving", value: fmtEur(report.totals.procSavingEur) },
              { label: "Battery wear", value: `−${fmtEur(report.totals.wearEur)}` },
              { label: "Net benefit", value: fmtEur(report.totals.netEur), accent: true },
            ].map((kpi: { label: string; value: string; accent?: boolean; hint?: string; sub?: string }) => (
              <Card key={kpi.label} className={kpi.accent ? "border-primary/40" : undefined} title={kpi.hint}>
                <CardContent className="p-4">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {kpi.label}
                  </div>
                  <div className={`pt-1 text-lg font-semibold tabular-nums ${kpi.accent ? "text-primary" : ""}`}>
                    {kpi.value}
                  </div>
                  {kpi.sub ? <div className="text-[11px] text-muted-foreground tabular-nums">{kpi.sub}</div> : null}
                </CardContent>
              </Card>
            ))}
          </section>

          {/* "By site class" summary cards removed on client request
               (sep 3 2026). Class filter + per-row badges are kept. */}

          {/* ── Detail table ── */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
              <CardTitle className="text-base">
                {view === "months" ? "Month by month" : "Station totals over the range"}
                {classFilter !== "all" ? (
                  <Badge variant="outline" className={`ml-2 align-middle ${CLASS_BADGE_CLS[classFilter]}`}>
                    {CLASS_LABEL[classFilter]}
                  </Badge>
                ) : null}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {anyClassified ? (
                  <Tabs value={classFilter} onValueChange={(v) => setClassFilter(v as typeof classFilter)}>
                    <TabsList className="h-8">
                      <TabsTrigger value="all" className="text-xs px-3">
                        All
                      </TabsTrigger>
                      <TabsTrigger value="ev_pv" className="text-xs px-3">
                        EV + PV
                      </TabsTrigger>
                      <TabsTrigger value="ev_only" className="text-xs px-3">
                        EV-only
                      </TabsTrigger>
                      <TabsTrigger value="unknown" className="text-xs px-3">
                        Unclassified
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                ) : null}
                <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
                  <TabsList className="h-8">
                    <TabsTrigger value="months" className="text-xs px-3">
                      Months
                    </TabsTrigger>
                    <TabsTrigger value="stations" className="text-xs px-3">
                      Stations
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <ColumnModeTabs value={columnMode} onChange={setColumnMode} />
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {view === "months" ? (
                <Table className={SETTLEMENT_TABLE_CLASS}>
                  <TableHeader>
                    <TableRow>
                      <TermHead term={isLive ? "measuredMonth" : "archiveMonth"}>Month</TermHead>
                      <TermHead term="site" className="text-right">
                        Stations
                      </TermHead>
                      {all("volumes") ? <VolumeHeads isLive={isLive} /> : null}
                      {/* Same column, same position and same n/a rule as the
                          Stations view below — a month's figure is the Σ of
                          its station rows, so the two views reconcile. */}
                      {all("sessions") ? (
                        <TableHead className="text-right" title={isLive ? SESSIONS_HINT_LIVE : SESSIONS_HINT_HIST}>
                          <TermLabel term="sessions" />
                        </TableHead>
                      ) : null}
                      <TermHead term="flatCost" className="text-right">
                        Flat €
                      </TermHead>
                      {all("flatRate") ? (
                        <TermHead term="flatRate" className="text-right">
                          Flat ct/kWh
                        </TermHead>
                      ) : null}
                      {/* Same six money columns, same order, same terms as the
                          Fleet Monthly table and the Financial Report blocks.
                          "Essential" keeps the closed set (see column-mode.tsx). */}
                      <TermHead term="counterfactualCost" short className="text-right" />
                      <TermHead term="dynamicCost" short className="text-right" />
                      {all("procurementSaving") ? (
                        <TermHead term="procurementSaving" className="text-right">
                          Saving €
                        </TermHead>
                      ) : null}
                      <TermHead term="wearNoShift" short className="text-right" />
                      {all("wearAsRun") ? <TermHead term="wearAsRun" short className="text-right" /> : null}
                      <TermHead term="extraWear" short className="text-right" />
                      <TermHead term="netTotalSaving" className="text-right">
                        Net €
                      </TermHead>
                      <TermHead term="loadShiftingContribution" className="text-right">
                        LS gain €
                      </TermHead>
                      {all("audit") ? (
                        <>
                          <TermHead term="idmSpread" className="text-right">
                            Avg spread
                          </TermHead>
                          <TermHead term="dayVerdict" className="text-right">
                            Loss days
                          </TermHead>
                        </>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMonths.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell className="font-medium">
                          {monthLabel(m.month)}
                          {/* Σ station-days with telemetry over Σ station-days
                              in the month — a month where any station was
                              onboarded late or lost frames is flagged here,
                              beside the figures it qualifies. */}
                          {isLive ? (
                            <CoverageBadge coveredDays={m.coveredDays} totalDays={m.calendarDays} className="ml-2" />
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{m.stations}</TableCell>
                        {all("volumes") ? (
                          <VolumeCells
                            isLive={isLive}
                            importKwh={m.importKwh}
                            evKwh={m.evKwh}
                            evDeliveredKwh={m.evDeliveredKwh}
                            auxKwh={m.auxKwh}
                            battNetKwh={m.battNetKwh}
                          />
                        ) : null}
                        {all("sessions") ? (
                          <TableCell className="text-right tabular-nums">
                            {fmtSessions(m.sessions, m.sessionsNa, m.stations)}
                            {fmtSessionsCoverage(m.sessionsNa, m.stations, "stations") ? (
                              <span className="block text-[10px] text-muted-foreground">
                                {fmtSessionsCoverage(m.sessionsNa, m.stations, "stations")}
                              </span>
                            ) : null}
                          </TableCell>
                        ) : null}
                        <TableCell className="text-right tabular-nums">{fmtEur(m.flatEur)}</TableCell>
                        {all("flatRate") ? (
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {m.importKwh > 0 ? ((100 * m.flatEur) / m.importKwh).toFixed(2) : "—"}
                          </TableCell>
                        ) : null}
                        <TableCell className="text-right tabular-nums">{fmtEur(m.noShiftEur)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtEur(m.asRunEur)}</TableCell>
                        {all("procurementSaving") ? (
                          <TableCell className="text-right tabular-nums">{fmtEur(m.procSavingEur)}</TableCell>
                        ) : null}
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {m.wearNoShiftEur != null ? fmtEur(m.wearNoShiftEur) : "—"}
                        </TableCell>
                        {all("wearAsRun") ? (
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {m.wearAsRunEur != null ? fmtEur(m.wearAsRunEur) : "—"}
                          </TableCell>
                        ) : null}
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          −{fmtEur(m.wearEur)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium tabular-nums ${m.netEur < 0 ? "text-destructive" : ""}`}
                        >
                          {fmtEur(m.netEur)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtEur(m.lsEur)}</TableCell>
                        {all("audit") ? (() => {
                          const ctx = report.priceContext[m.month]
                          return (
                            <>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {ctx ? `${ctx.avgSpreadCt.toLocaleString("de-DE", { maximumFractionDigits: 1 })} ct` : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {ctx ? (
                                  ctx.lossDays > 0 ? (
                                    <span className="font-semibold text-destructive">{ctx.lossDays}</span>
                                  ) : (
                                    <span className="text-muted-foreground">0</span>
                                  )
                                ) : (
                                  "��"
                                )}
                              </TableCell>
                            </>
                          )
                        })() : null}
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-semibold">
                      <TableCell>TOTAL</TableCell>
                      <TableCell className="text-right tabular-nums">{filteredStations.length}</TableCell>
                      {all("volumes") ? (
                        <VolumeCells
                          isLive={isLive}
                          importKwh={monthTotals.importKwh}
                          evKwh={monthTotals.evKwh}
                          evDeliveredKwh={monthTotals.evDeliveredKwh}
                          auxKwh={monthTotals.auxKwh}
                          battNetKwh={monthTotals.battNetKwh}
                        />
                      ) : null}
                      {all("sessions") ? (
                        <TableCell className="text-right tabular-nums">
                          {fmtSessions(monthTotals.sessions, monthTotals.sessionsNa, monthTotals.stationMonths)}
                          {fmtSessionsCoverage(monthTotals.sessionsNa, monthTotals.stationMonths) ? (
                            <span className="block text-[10px] font-normal text-muted-foreground">
                              {fmtSessionsCoverage(monthTotals.sessionsNa, monthTotals.stationMonths)}
                            </span>
                          ) : null}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right tabular-nums">{fmtEur(monthTotals.flatEur)}</TableCell>
                      {all("flatRate") ? (
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {monthTotals.importKwh > 0 ? ((100 * monthTotals.flatEur) / monthTotals.importKwh).toFixed(2) : "—"}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right tabular-nums">{fmtEur(monthTotals.noShiftEur)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtEur(monthTotals.asRunEur)}</TableCell>
                      {all("procurementSaving") ? (
                        <TableCell className="text-right tabular-nums">{fmtEur(monthTotals.procSavingEur)}</TableCell>
                      ) : null}
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {monthTotals.wearNoShiftEur != null ? fmtEur(monthTotals.wearNoShiftEur) : "—"}
                      </TableCell>
                      {all("wearAsRun") ? (
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {monthTotals.wearAsRunEur != null ? fmtEur(monthTotals.wearAsRunEur) : "—"}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right tabular-nums">−{fmtEur(monthTotals.wearEur)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtEur(monthTotals.netEur)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtEur(monthTotals.lsEur)}</TableCell>
                      {all("audit") ? (
                        <>
                          <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {(() => {
                              const totalLoss = filteredMonths.reduce(
                                (acc, m) => acc + (report.priceContext[m.month]?.lossDays ?? 0),
                                0,
                              )
                              return totalLoss > 0 ? <span className="text-destructive">{totalLoss}</span> : totalLoss
                            })()}
                          </TableCell>
                        </>
                      ) : null}
                    </TableRow>
                  </TableBody>
                </Table>
              ) : (
                <Table className={SETTLEMENT_TABLE_CLASS}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TermHead term="site">Location</TermHead>
                      <TableHead className="text-right">
                        <TermLabel term="measuredMonth">Months</TermLabel>
                        <span className="block text-[10px] font-normal text-muted-foreground">measured · archive</span>
                      </TableHead>
                      {all("audit") && isLive ? (
                        <TableHead className="text-right">
                          <TermLabel term="dataFrom">Data from</TermLabel>
                          <span className="block text-[10px] font-normal text-muted-foreground">
                            <TermLabel term="coveredDays">days with data</TermLabel>
                          </span>
                        </TableHead>
                      ) : null}
                      {all("volumes") ? <VolumeHeads isLive={isLive} /> : null}
                      {all("sessions") ? (
                        <TableHead className="text-right" title={isLive ? SESSIONS_HINT_LIVE : SESSIONS_HINT_HIST}>
                          <TermLabel term="sessions" />
                        </TableHead>
                      ) : null}
                      <TermHead term="flatCost" className="text-right">
                        Flat €
                      </TermHead>
                      {/* Same six money columns, same order, same terms as the
                          Months table above, the Fleet Monthly table and the
                          Financial Report blocks — a station's row is the Σ of
                          its frozen monthly rows, column by column.
                          "Essential" keeps the closed set (see column-mode.tsx). */}
                      <TermHead term="counterfactualCost" short className="text-right" />
                      <TermHead term="dynamicCost" short className="text-right" />
                      {all("procurementSaving") ? (
                        <TermHead term="procurementSaving" className="text-right">
                          Saving €
                        </TermHead>
                      ) : null}
                      <TermHead term="wearNoShift" short className="text-right" />
                      {all("wearAsRun") ? <TermHead term="wearAsRun" short className="text-right" /> : null}
                      <TermHead term="extraWear" short className="text-right" />
                      <TermHead term="netTotalSaving" className="text-right">
                        Net €
                      </TermHead>
                      <TermHead term="loadShiftingContribution" className="text-right">
                        LS gain €
                      </TermHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStations.map((s, i) => (
                      <TableRow key={s.stationId}>
                        <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-medium">{s.city}</span>
                            <span className="text-xs text-muted-foreground">{s.zip}</span>
                            {anyClassified && s.siteClass !== "unknown" ? (
                              <Badge
                                variant="outline"
                                className={`h-5 px-1.5 text-[10px] font-normal ${CLASS_BADGE_CLS[s.siteClass]}`}
                              >
                                {CLASS_LABEL[s.siteClass]}
                              </Badge>
                            ) : null}
                            {s.anyMeasured ? (
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal text-primary">
                                measured (FinReport)
                              </Badge>
                            ) : null}
                            {/* Always visible (not only in the audit column
                                set): Σ days with telemetry over the calendar
                                length of this station's measured months. */}
                            {isLive ? (
                              <CoverageBadge
                                coveredDays={s.coveredDays}
                                totalDays={s.calendarDays}
                                dataFrom={s.dataFrom}
                                className="mt-0"
                              />
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.months}
                          <span className="block text-[10px] text-muted-foreground">
                            {s.measuredMonths} · {s.archiveMonths}
                          </span>
                        </TableCell>
                        {all("audit") && isLive ? (
                          <TableCell className="text-right tabular-nums text-xs">
                            {s.dataFrom
                              ? new Date(s.dataFrom).toLocaleDateString("de-DE", {
                                  timeZone: "Europe/Berlin",
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                })
                              : "—"}
                            <span className="block text-[10px] text-muted-foreground">
                              {s.coveredDays != null ? `${s.coveredDays} d` : "—"}
                            </span>
                          </TableCell>
                        ) : null}
                        {all("volumes") ? (
                          <VolumeCells
                            isLive={isLive}
                            importKwh={s.importKwh}
                            evKwh={s.evKwh}
                            evDeliveredKwh={s.evDeliveredKwh}
                            auxKwh={s.auxKwh}
                            battNetKwh={s.battNetKwh}
                          />
                        ) : null}
                        {all("sessions") ? (
                          <TableCell className="text-right tabular-nums">
                            {fmtSessions(s.sessions, s.sessionsNa, s.months)}
                            {fmtSessionsCoverage(s.sessionsNa, s.months) ? (
                              <span className="block text-[10px] text-muted-foreground">
                                {fmtSessionsCoverage(s.sessionsNa, s.months)}
                              </span>
                            ) : null}
                          </TableCell>
                        ) : null}
                        <TableCell className="text-right tabular-nums">{fmtEur(s.flatEur)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtEur(s.noShiftEur)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtEur(s.asRunEur)}</TableCell>
                        {all("procurementSaving") ? (
                          <TableCell className="text-right tabular-nums">{fmtEur(s.procSavingEur)}</TableCell>
                        ) : null}
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {s.wearNoShiftEur != null ? fmtEur(s.wearNoShiftEur) : "—"}
                        </TableCell>
                        {all("wearAsRun") ? (
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {s.wearAsRunEur != null ? fmtEur(s.wearAsRunEur) : "—"}
                          </TableCell>
                        ) : null}
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          −{fmtEur(s.wearEur)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium tabular-nums ${s.netEur < 0 ? "text-destructive" : ""}`}
                        >
                          {fmtEur(s.netEur)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtEur(s.lsEur)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground max-w-3xl text-pretty">
            {isLive
              ? "Every row is measured from the station's own telemetry through the same engine as the site Financial Report, then frozen into the background table by the nightly job. No simulation, no archive data."
              : "Every row is the archive simulation on the station's own export volume for that month, priced with historical market prices, and frozen into the background table by the nightly job. No telemetry enters this report — no measured rows, no calibration against live stations. A station-month appears only when the archive holds that month's own volume and the station was inside its optimised period; other months are not reported and not summed. Sessions are n/a: the archive import carried no charge events."}{" "}
            The Excel download contains three sheets: monthly totals, station totals, and the raw station-month
            grain.
          </p>
        </>
      )}
    </main>
  )
}
