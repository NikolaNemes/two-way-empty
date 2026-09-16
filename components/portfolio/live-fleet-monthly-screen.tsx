"use client"

/**
 * Live Fleet Monthly Report — real chargepost_* stations ONLY, measured
 * telemetry. Renders pre-computed fleet_month_report rows (anchor_status
 * 'live'); the admin Refresh action recomputes the selected month from the
 * station's own backtest + market prices. hist_* twins never appear here.
 */

import { useMemo, useState, useTransition } from "react"
import { Database, RefreshCw, AlertTriangle, ExternalLink } from "lucide-react"
import Link from "next/link"
import { berlinMonthWindow, monthDays } from "@/lib/report-window"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ExportExcelButton } from "@/components/reports/export-excel-button"
import { ReportMonthPicker, monthLabel as monthLabelShared } from "@/components/reports/report-month-picker"
import { TermHead } from "@/components/reports/term"
import { ColumnModeTabs, SETTLEMENT_TABLE_CLASS, showColumn, type ColumnMode } from "@/components/reports/column-mode"
import { CoverageBadge } from "@/components/reports/coverage-badge"
import { refreshLiveFleetMonth, type LiveMonthlyReport } from "@/app/actions/live-fleet-monthly"
import { useRouter } from "next/navigation"

const fmtEur = (v: number) =>
  v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 })
const fmtNum = (v: number) => Math.round(v).toLocaleString("de-DE")
/** Battery net is signed: "+120" = pack absorbed, "−45" = pack released. */
const fmtSigned = (v: number) => {
  const r = Math.round(v)
  return r === 0 ? "0" : `${r > 0 ? "+" : "−"}${Math.abs(r).toLocaleString("de-DE")}`
}
const monthLabel = (m: string) => monthLabelShared(m, "long")
/** "20.08. 14:36" in Berlin time — the audit stamps are compact by design. */
const fmtStamp = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("de-DE", {
        timeZone: "Europe/Berlin",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—"
/** "20.08." — Data-from is day-granular (completed days settle from the daily
 *  rollup, which has no intra-day start time). */
const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" }) : "—"
/** Calendar length of "YYYY-MM" — the denominator of "days with data". */
const daysInMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number)
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

/** Deep link to the Financial Report for exactly the window this row priced. */
function financialReportHref(stationId: string, month: string): string {
  const w = berlinMonthWindow(month)
  const md = monthDays(month)
  const from = md?.first ?? `${month}-01`
  const to = w?.toDay ?? md?.last ?? from
  const q = new URLSearchParams({ stationId, from, to })
  return `/reports/financial-breakdown?${q.toString()}`
}

export function LiveFleetMonthlyScreen({
  report,
  isAdmin,
  initialMonth,
}: {
  report: LiveMonthlyReport
  isAdmin: boolean
  /** `?month=yyyy-mm` deep link (the Financial Report's "Open Fleet Monthly"). */
  initialMonth?: string
}) {
  // Default to the newest month that actually has rows (else current month).
  const monthsDesc = useMemo(() => [...report.months].reverse(), [report.months])
  const newestWithData = useMemo(
    () => monthsDesc.find((m) => (report.rowsByMonth[m]?.length ?? 0) > 0) ?? monthsDesc[0],
    [monthsDesc, report.rowsByMonth],
  )
  const [month, setMonth] = useState(
    initialMonth && report.months.includes(initialMonth) ? initialMonth : newestWithData,
  )
  const [isRefreshing, startRefresh] = useTransition()
  const [refreshNote, setRefreshNote] = useState<string | null>(null)
  // Screen-width control only — the Excel export always carries every column.
  const [columnMode, setColumnMode] = useState<ColumnMode>("essential")
  const all = (col: Parameters<typeof showColumn>[1]) => showColumn(columnMode, col)
  const router = useRouter()

  const rows = report.rowsByMonth[month] ?? []

  const totals = useMemo(() => {
    const t: {
      importKwh: number
      evDeliveredKwh: number | null
      auxKwh: number | null
      battNetKwh: number | null
      sessions: number
      flatEur: number
      noShiftEur: number
      asRunEur: number
      procSavingEur: number
      wearNoShiftEur: number | null
      wearAsRunEur: number | null
      wearEur: number
      netEur: number
      lsEur: number
      coveredDays: number | null
    } = {
      importKwh: 0,
      evDeliveredKwh: 0,
      auxKwh: 0,
      battNetKwh: 0,
      sessions: 0,
      flatEur: 0,
      noShiftEur: 0,
      asRunEur: 0,
      procSavingEur: 0,
      wearNoShiftEur: 0,
      wearAsRunEur: 0,
      wearEur: 0,
      netEur: 0,
      lsEur: 0,
      coveredDays: 0,
    }
    for (const r of rows) {
      t.coveredDays = t.coveredDays === null || r.coveredDays == null ? null : t.coveredDays + r.coveredDays
      t.importKwh += r.importKwh
      // Metered split: a row computed before the counters were stored makes
      // the total "—" rather than a partial sum.
      t.evDeliveredKwh = t.evDeliveredKwh === null || r.evDeliveredKwh == null ? null : t.evDeliveredKwh + r.evDeliveredKwh
      t.auxKwh = t.auxKwh === null || r.auxKwh == null ? null : t.auxKwh + r.auxKwh
      t.battNetKwh = t.battNetKwh === null || r.battNetKwh == null ? null : t.battNetKwh + r.battNetKwh
      t.sessions += r.sessions
      t.flatEur += r.flatEur
      t.noShiftEur += r.noShiftEur
      t.asRunEur += r.asRunEur
      t.procSavingEur += r.procSavingEur
      // Same NULL-propagation as the metered split: both wear bases were added
      // to the frozen row on 2026-09-03; a row from before then shows "—".
      t.wearNoShiftEur = t.wearNoShiftEur === null || r.wearNoShiftEur == null ? null : t.wearNoShiftEur + r.wearNoShiftEur
      t.wearAsRunEur = t.wearAsRunEur === null || r.wearAsRunEur == null ? null : t.wearAsRunEur + r.wearAsRunEur
      t.wearEur += r.wearEur
      t.netEur += r.netEur
      t.lsEur += r.lsEur
    }
    return t
  }, [rows])

  const freshest = useMemo(() => {
    let latest = ""
    for (const r of rows) if (r.computedAt > latest) latest = r.computedAt
    return latest
      ? new Date(latest).toLocaleString("de-DE", {
          timeZone: "Europe/Berlin",
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null
  }, [rows])

  const xlsxHref = `/api/reports/fleet-yearly/xlsx?from=${month}&to=${month}&dataset=live`

  const onRefresh = () => {
    setRefreshNote(null)
    startRefresh(async () => {
      const res = await refreshLiveFleetMonth(month)
      if (!res.ok) {
        setRefreshNote(res.error ?? "refresh failed")
        return
      }
      const skippedCount = Object.values(res.stations).filter((s) => s !== "measured").length
      setRefreshNote(
        `Recomputed: ${res.rows} station${res.rows === 1 ? "" : "s"} written` +
          (skippedCount > 0 ? `, ${skippedCount} without data` : ""),
      )
      router.refresh()
    })
  }

  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      {/* ── Header ── */}
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-balance">Fleet Monthly Report</h1>
          <p className="text-sm text-muted-foreground max-w-2xl text-pretty">
            Real stations only — every row is measured from the station&apos;s own telemetry and priced on the
            IDM/DAM market curves. No simulation, no historical twins.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Badge variant="outline" className="gap-1.5 font-normal">
              <Database className="size-3" />
              measured telemetry
            </Badge>
            {freshest ? <span className="text-xs text-muted-foreground">computed {freshest}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <ReportMonthPicker
            value={month}
            onChange={setMonth}
            min={report.months[0] ?? month}
            max={monthsDesc[0] ?? month}
            annotate={(m) => ((report.rowsByMonth[m]?.length ?? 0) === 0 ? "— no data" : null)}
          />
          {isAdmin ? (
            <Button variant="outline" onClick={onRefresh} disabled={isRefreshing} className="gap-2 bg-transparent">
              <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Recomputing…" : "Refresh month"}
            </Button>
          ) : null}
          <ExportExcelButton href={xlsxHref} disabled={rows.length === 0} />
        </div>
      </header>

      {refreshNote ? <p className="text-sm text-muted-foreground -mt-3">{refreshNote}</p> : null}

      {(report.staleByMonth[month] ?? 0) > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-xs text-foreground"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <p className="text-pretty">
            <span className="font-medium">{report.staleByMonth[month]} station row(s) hidden</span> for{" "}
            {monthLabel(month)} — computed on an older methodology than the current {report.methodologyVersion}, so
            their figures would not match the site Financial Report.{" "}
            {isAdmin ? "Use “Refresh month” to recompute them now." : "They are recomputed by the nightly job."}
          </p>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No measured data for {monthLabel(month)}.
            {isAdmin
              ? " Use “Refresh month” to compute it from telemetry, or pick another month."
              : " Pick another month."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
            <CardTitle className="text-base">
              {monthLabel(month)} — {rows.length} station{rows.length === 1 ? "" : "s"} with measured data
            </CardTitle>
            <ColumnModeTabs value={columnMode} onChange={setColumnMode} />
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className={SETTLEMENT_TABLE_CLASS}>
              <TableHeader>
                <TableRow>
                  <TermHead term="site">Station</TermHead>
                  {all("volumes") ? (
                    <>
                      <TermHead term="gridImport" unit="kWh" className="text-right" />
                      <TermHead term="evDelivered" unit="kWh" className="text-right" />
                      <TermHead term="aux" unit="kWh" className="text-right" />
                      {/* Closes the row: import = EV + AUX + batt net (2026-09-03.3). */}
                      <TermHead term="battNet" unit="kWh" className="text-right" />
                    </>
                  ) : null}
                  {all("sessions") ? <TermHead term="sessions" className="text-right" /> : null}
                  <TermHead term="flatCost" className="text-right">
                    Flat €
                  </TermHead>
                  {all("flatRate") ? (
                    <TermHead term="flatRate" className="text-right">
                      Flat ct/kWh
                    </TermHead>
                  ) : null}
                  {/* The three procurement costs (flat / without LS / as run)
                      and the three wear figures (without LS / as run / extra)
                      are all printed — same labels as the Financial Report
                      blocks, so nothing has to be back-solved from a saving.
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
                      {/* Coverage — Aug 2026 review: Gifhorn's row was 20–31 Aug
                          and Norderstedt lost 24–31 Aug, and nothing on the
                          table said so. From / through / days-with-data make a
                          partial month visible next to its euros. */}
                      <TermHead term="dataFrom" short className="text-right" />
                      <TermHead term="dataThrough" className="text-right" />
                      <TermHead term="coveredDays" short className="text-right" />
                    </>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.stationId}>
                    <TableCell className="whitespace-normal font-medium">
                      {/* Same station, same window (lib/report-window), same
                          engine (lib/settlement): the linked Financial Report
                          MUST print these euros — and shows a reconciliation
                          badge proving it. The name may wrap: the money
                          columns are the fixed-width part of this table. */}
                      <Link
                        href={financialReportHref(r.stationId, month)}
                        className="group inline-flex items-center gap-1.5 text-pretty underline-offset-2 hover:underline"
                        title="Open this station-month in the Financial Report (same computation)"
                      >
                        <span>
                          {r.brand ? `${r.brand} ` : ""}
                          {r.city}
                          {r.zip ? <span className="text-muted-foreground"> ({r.zip})</span> : null}
                        </span>
                        <ExternalLink className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                      {/* COVERAGE — always visible, not only in the audit
                          column set. A partial month (onboarding mid-month,
                          telemetry outage) sits right under the station name
                          so its volumes and euros are never read as a full
                          month. Aug 2026: Gifhorn 12/31, Norderstedt 25/31. */}
                      <CoverageBadge coveredDays={r.coveredDays} month={month} dataFrom={r.dataFrom} dataThrough={r.dataThrough} />
                    </TableCell>
                    {all("volumes") ? (
                      <>
                        <TableCell className="text-right tabular-nums">{fmtNum(r.importKwh)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.evDeliveredKwh != null ? fmtNum(r.evDeliveredKwh) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {r.auxKwh != null ? fmtNum(r.auxKwh) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {r.battNetKwh != null ? fmtSigned(r.battNetKwh) : "—"}
                        </TableCell>
                      </>
                    ) : null}
                    {all("sessions") ? <TableCell className="text-right tabular-nums">{r.sessions}</TableCell> : null}
                    <TableCell className="text-right tabular-nums">{fmtEur(r.flatEur)}</TableCell>
                    {all("flatRate") ? (
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.flatCtApplied != null ? r.flatCtApplied.toFixed(2) : "—"}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right tabular-nums">{fmtEur(r.noShiftEur)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtEur(r.asRunEur)}</TableCell>
                    {all("procurementSaving") ? (
                      <TableCell className="text-right tabular-nums">{fmtEur(r.procSavingEur)}</TableCell>
                    ) : null}
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.wearNoShiftEur != null ? fmtEur(r.wearNoShiftEur) : "—"}
                    </TableCell>
                    {all("wearAsRun") ? (
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.wearAsRunEur != null ? fmtEur(r.wearAsRunEur) : "—"}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      −{fmtEur(r.wearEur)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium tabular-nums ${r.netEur < 0 ? "text-destructive" : ""}`}
                    >
                      {fmtEur(r.netEur)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtEur(r.lsEur)}</TableCell>
                    {all("audit") ? (
                      <>
                        <TableCell className="text-right tabular-nums text-muted-foreground text-xs">
                          {fmtDay(r.dataFrom)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground text-xs">
                          {fmtStamp(r.dataThrough)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums text-xs ${
                            r.coveredDays != null && r.coveredDays < daysInMonth(month)
                              ? "font-medium text-destructive"
                              : "text-muted-foreground"
                          }`}
                          title={
                            r.coveredDays != null && r.coveredDays < daysInMonth(month)
                              ? "Partial month: euros cover only the days with data — not scaled up"
                              : undefined
                          }
                        >
                          {r.coveredDays != null ? `${r.coveredDays}/${daysInMonth(month)}` : "—"}
                        </TableCell>
                      </>
                    ) : null}
                  </TableRow>
                ))}
                {rows.length > 1 ? (
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell>FLEET TOTAL</TableCell>
                    {all("volumes") ? (
                      <>
                        <TableCell className="text-right tabular-nums">{fmtNum(totals.importKwh)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {totals.evDeliveredKwh != null ? fmtNum(totals.evDeliveredKwh) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {totals.auxKwh != null ? fmtNum(totals.auxKwh) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {totals.battNetKwh != null ? fmtSigned(totals.battNetKwh) : "—"}
                        </TableCell>
                      </>
                    ) : null}
                    {all("sessions") ? <TableCell className="text-right tabular-nums">{totals.sessions}</TableCell> : null}
                    <TableCell className="text-right tabular-nums">{fmtEur(totals.flatEur)}</TableCell>
                    {all("flatRate") ? (
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {totals.importKwh > 0 ? ((100 * totals.flatEur) / totals.importKwh).toFixed(2) : "—"}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right tabular-nums">{fmtEur(totals.noShiftEur)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtEur(totals.asRunEur)}</TableCell>
                    {all("procurementSaving") ? (
                      <TableCell className="text-right tabular-nums">{fmtEur(totals.procSavingEur)}</TableCell>
                    ) : null}
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {totals.wearNoShiftEur != null ? fmtEur(totals.wearNoShiftEur) : "—"}
                    </TableCell>
                    {all("wearAsRun") ? (
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {totals.wearAsRunEur != null ? fmtEur(totals.wearAsRunEur) : "—"}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right tabular-nums">−{fmtEur(totals.wearEur)}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${totals.netEur < 0 ? "text-destructive" : ""}`}
                    >
                      {fmtEur(totals.netEur)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtEur(totals.lsEur)}</TableCell>
                    {all("audit") ? (
                      <>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground text-xs">
                          {totals.coveredDays != null ? `${totals.coveredDays}/${rows.length * daysInMonth(month)}` : "—"}
                        </TableCell>
                      </>
                    ) : null}
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
