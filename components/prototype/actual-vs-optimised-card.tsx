"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Activity, AlertTriangle, RefreshCw, ShieldCheck, TrendingDown } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TelemetryLoader } from "@/components/prototype/telemetry-loader"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  runBacktestForRange,
  type RangeBacktestResult,
} from "@/app/actions/backtest"
import { getDayAheadPrices, type DayPricePoint } from "@/app/actions/prices"
import { useStation } from "@/components/station-context"
import { beginReport } from "@/lib/report-progress"
import { formatCapKW } from "@/lib/prototype-telemetry"
import type { DailySaving } from "@/lib/backtest"
import { DispatchingOverview, type DispatchPoint } from "@/components/lab/dispatching-overview"
import { TermLabel } from "@/components/reports/term"
import type { ReportTermKey } from "@/lib/report-definitions"

/**
 * Actual vs optimised card.
 *
 * Runs the SAME Neon-backed backtest engine as the Backtest Lab over the
 * report's date range, using the default production model version.
 *
 * Two variants:
 *  • "counterfactual" (default, Data Analytics): contrasts what the meter
 *    actually recorded against what the kernel would have commanded tick-by-tick
 *    — dashed optimised overlays + savings KPIs.
 *  • "telemetry" (Dispatching Timeline): the optimiser is now in production, so
 *    the metered series IS the optimiser's behaviour. Drops the counterfactual
 *    overlays/KPIs and shows pure real-telemetry evidence (measured SOC, grid
 *    import, EV delivered, grid-cap breaches).
 */
export function ActualVsOptimisedCard({
  from,
  to,
  variant = "counterfactual",
  refreshMs,
  live = true,
  registerExport,
}: {
  from: Date
  to: Date
  variant?: "counterfactual" | "telemetry"
  /**
   * Lets the page host the shared "Export Excel" button in its period header.
   * Called with an export function once a result is on screen, with `null`
   * while loading / empty / on unmount. Telemetry variant only.
   */
  registerExport?: (fn: (() => Promise<void>) | null) => void
  /**
   * When set (and > 0), the card silently re-runs the backtest on this cadence
   * so the view stays live as new telemetry frames land — without tearing down
   * the chart or showing the full-page spinner. Used by the Dispatching Timeline
   * ("today") view. Refreshes also fire when the tab regains focus, pause while
   * the tab is hidden, and never overlap (an in-flight run is skipped).
   */
  refreshMs?: number
  /**
   * Live "today" mode (default). When true the telemetry variant pins its chart
   * to the full 24h calendar day with a sweeping NOW cursor and pulls the whole
   * day's day-ahead price curve (Live Dispatching). Set false for a HISTORICAL
   * range (Dispatching History): the x-axis then spans the entire selected
   * window with dated ticks so multi-day curves render, the NOW cursor is
   * dropped, and the label reads "Telemetry history" instead of "Live telemetry".
   * Only affects the telemetry variant.
   */
  live?: boolean
}) {
  const isTelemetry = variant === "telemetry"
  // The full-day axis + live day-ahead price extension only make sense for the
  // live "today" telemetry view. A historical range spans many days, so it must
  // use the data-spanning axis instead (fullDayAxis off).
  const liveToday = isTelemetry && live
  // MULTI-LOCATION: the replay targets the sidebar-selected station.
  const { stationId, station } = useStation()
  const [result, setResult] = useState<RangeBacktestResult | null>(null)
  const [dayPrices, setDayPrices] = useState<DayPricePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Build a UTC-midnight calendar-day window that EXACTLY matches the
  // Backtest Lab convention (`${date}T00:00:00Z` → next-day UTC midnight,
  // end-exclusive). `from`/`to` arrive as LOCAL-midnight Dates, so we read
  // their calendar Y/M/D and re-anchor to UTC midnight. This guarantees the
  // same calendar day produces identical optimised results here and in the
  // Backtest Lab (which also runs the published default model via runBacktest).
  const fromIso = new Date(
    Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()),
  ).toISOString()
  // End-exclusive: next UTC midnight after the final selected day.
  const toIso = new Date(
    Date.UTC(to.getFullYear(), to.getMonth(), to.getDate() + 1),
  ).toISOString()

  // LOCAL-midnight calendar-day window — the same origin the live overview's
  // x-axis uses (`localMidnight(firstFrame)`). The UTC window above would shift
  // every slot by the local UTC offset (e.g. the 00:00Z frame lands at hour 2 in
  // UTC+2), which made BOTH the price line AND the grid/EV telemetry curves
  // appear to start at ~02:00 instead of midnight. A local-midnight Date
  // serialized via toISOString() is the correct instant for the first local slot.
  const localFromIso = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
  ).toISOString()
  const localToIso = new Date(
    to.getFullYear(),
    to.getMonth(),
    to.getDate() + 1,
  ).toISOString()

  // The live "today" view is anchored to the LOCAL calendar day, so it fetches
  // telemetry frames + prices over the local window (covering the first local
  // hours that fall on the previous UTC day). The counterfactual report keeps
  // the UTC window for exact Backtest Lab parity.
  const backtestFromIso = isTelemetry ? localFromIso : fromIso
  const backtestToIso = isTelemetry ? localToIso : toIso

  // Guard so a slow backtest never overlaps with the next scheduled refresh.
  const inFlightRef = useRef(false)

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      const silent = opts?.silent ?? false
      if (silent) setRefreshing(true)
      else {
        setLoading(true)
        // Reset the shared progress timeline for a fresh, non-silent load.
        // `runBacktestForRange` runs server-side, so its per-day cache events
        // don't reach the client emitter here — clearing the timeline lets the
        // loader show an honest elapsed-time progress bar for this run instead
        // of leftover events (or an accumulated day-count) from a previous
        // client-driven report on another screen.
        beginReport()
      }
      setError(null)
      try {
        // Telemetry (live) variant also pulls the full-day day-ahead price
        // curve so the overview can draw price + cheap/expensive bands across
        // the whole day (incl. future slots), not just where frames exist.
        // chartOnly: this card only charts the series and reads totals/KPIs/
        // sessions — for windows > 3 days the server buckets the series to
        // ≤ 2,000 points and drops the tariff-engine payload (rollupDays), so
        // a 30-day Dispatching History ships ~1/3 of the bytes it used to.
        const [r, prices] = await Promise.all([
          runBacktestForRange({ stationId, fromIso: backtestFromIso, toIso: backtestToIso, chartOnly: true }),
          liveToday
            ? getDayAheadPrices({ fromIso: localFromIso, toIso: localToIso })
            : Promise.resolve([]),
        ])
        setResult(r)
        if (liveToday) setDayPrices(prices)
        setLastUpdated(Date.now())
      } catch (e) {
        // On a background refresh, keep the last good chart and don't surface a
        // hard error; only the initial load replaces the view with an error.
        if (!silent) setError(e instanceof Error ? e.message : "Backtest failed")
      } finally {
        inFlightRef.current = false
        if (silent) setRefreshing(false)
        else setLoading(false)
      }
    },
    [backtestFromIso, backtestToIso, localFromIso, localToIso, liveToday, stationId],
  )

  // Initial load (and reload when the window changes, e.g. midnight rollover).
  useEffect(() => {
    void load()
  }, [load])

  // Live auto-refresh: poll on a cadence, refresh on tab focus, pause when
  // hidden. Disabled unless refreshMs is provided (Dispatching Timeline only).
  useEffect(() => {
    if (!refreshMs || refreshMs <= 0) return
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return
      void load({ silent: true })
    }
    const id = setInterval(tick, refreshMs)
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) void load({ silent: true })
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refreshMs, load])

  // Hand the page an "Export Excel" action for the result on screen (telemetry
  // variant). Re-registered on every render so it always closes over the latest
  // result; the host stores it in a ref, so this never causes a render loop.
  const stationLabel = station?.name ?? stationId
  const fromDay = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`
  const toDay = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, "0")}-${String(to.getDate()).padStart(2, "0")}`
  useEffect(() => {
    if (!registerExport || !isTelemetry) return
    if (loading || error || !result || result.empty || result.mpcStatus === "unavailable") {
      registerExport(null)
      return
    }
    const r = result
    registerExport(async () => {
      const { exportDispatchingHistoryXlsx } = await import("@/components/reports/dispatching-history-export")
      // Same full-resolution stats the KPI tiles show (server-side, computed
      // before chart downsampling) so the workbook matches the screen.
      const tele = r.chartStats ?? computeTelemetryStats(toDispatchPoints(r, true))
      await exportDispatchingHistoryXlsx(r, {
        stationLabel,
        fromDay,
        toDay,
        capKw: tele.capKw > 0 ? tele.capKw : undefined,
        breaches: tele.capKw > 0 ? tele.breaches : undefined,
        batterySoc: tele.hasSoc ? { min: tele.socMin, max: tele.socMax } : undefined,
      })
    })
  })
  useEffect(() => () => registerExport?.(null), [registerExport])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              {isTelemetry ? (
                <Activity className="size-5 text-teal-600" />
              ) : (
                <TrendingDown className="size-5 text-teal-600" />
              )}
              {isTelemetry ? (liveToday ? "Live telemetry" : "Telemetry history") : "Actual vs optimised"}
            </CardTitle>
            <CardDescription>
              {isTelemetry ? (
                <>
                  Real metered evidence from the production optimizer
                  {result?.versionLabel ? ` (${result.versionLabel})` : ""} — what the site actually
                  did over {liveToday ? "today" : "this window"}. No counterfactual simulation is
                  overlaid.
                  {result?.frameSource === "live"
                    ? ` Telemetry pulled live from the API for ${liveToday ? "this day" : "this range"}.`
                    : ""}
                </>
              ) : (
                <>
                  The production optimizer{result?.versionLabel ? ` (${result.versionLabel})` : ""} replayed
                  over this range — real metered grid cost (BMS as-is) against the production optimizer.
                  {result?.frameSource === "live"
                    ? " Telemetry pulled live from the API for this day."
                    : ""}
                </>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {refreshMs && refreshMs > 0 ? (
              <Badge
                variant="outline"
                className="gap-1.5 border-emerald-500/40 text-emerald-600"
                title={
                  lastUpdated
                    ? `Last updated ${new Date(lastUpdated).toLocaleTimeString()}`
                    : "Auto-refreshing"
                }
              >
                {refreshing ? (
                  <RefreshCw className="size-3 animate-spin" />
                ) : (
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/70" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                  </span>
                )}
                {refreshing
                  ? "Updating…"
                  : lastUpdated
                    ? `Live · ${new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : "Live"}
              </Badge>
            ) : null}
            {result && !result.empty ? (
              <Badge
                variant="outline"
                className="gap-1 border-teal-500/40 text-teal-600"
              >
                {result.frameSource === "live" ? "Live optimizer" : "Stored optimizer"}
              </Badge>
            ) : null}
            {!isTelemetry && result && !result.empty ? (
              result.kpis.exportViolations === 0 ? (
                <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
                  <ShieldCheck className="size-3" /> No-export verified
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="size-3" /> {result.kpis.exportViolations} export clamps
                </Badge>
              )
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <TelemetryLoader
            mode={liveToday ? "live" : "historical"}
            title={
              isTelemetry
                ? liveToday
                  ? "Connecting to Today's Telemetry"
                  : "Loading Historical Telemetry"
                : "Running optimizer"
            }
            subtitle={
              isTelemetry
                ? liveToday
                  ? "Establishing real-time API connection"
                  : "Replaying metered frames over the selected range"
                : "Replaying the production optimizer over telemetry"
            }
          />
        ) : error ? (
          <div className="py-10 text-center text-sm text-destructive">{error}</div>
        ) : !result || result.empty || result.mpcStatus === "unavailable" ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <AlertTriangle className="size-5 text-amber-500" />
            <p className="text-sm font-medium text-foreground">
              {isTelemetry ? "No telemetry for this range" : "Optimizer unavailable for this range"}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              {result?.mpcMessage ??
                (isTelemetry
                  ? "No telemetry frames are available for this window yet (the day may not have started, or the API returned no data)."
                  : "The production optimizer could not run over this window (no telemetry, infeasible plan, or prices not yet published). No heuristic fallback is shown.")}
            </p>
          </div>
        ) : (
          <Report
            result={result}
            variant={variant}
            dayPrices={dayPrices}
            fullDayAxis={liveToday}
            // Historical range pin: local-midnight window (end exclusive) so
            // every chart panel spans exactly the picked range on every station.
            rangeStartMs={liveToday ? undefined : Date.parse(localFromIso)}
            rangeEndMs={liveToday ? undefined : Date.parse(localToIso)}
          />
        )}
      </CardContent>
    </Card>
  )
}

function Report({
  result,
  variant,
  dayPrices = [],
  fullDayAxis = false,
  rangeStartMs,
  rangeEndMs,
}: {
  result: RangeBacktestResult
  variant: "counterfactual" | "telemetry"
  dayPrices?: DayPricePoint[]
  /** Pin the telemetry chart to a single 24h day with a NOW cursor (live today). */
  fullDayAxis?: boolean
  /** Historical mode: pin every chart's x-axis to the selected window (epoch ms, end exclusive). */
  rangeStartMs?: number
  rangeEndMs?: number
}) {
  const k = result.kpis
  const isTelemetry = variant === "telemetry"
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  // Multi-day windows break down by day; a single day breaks down by hour.
  const isMultiDay = (result.daily?.length ?? 0) > 1
  const breakdownRows = isMultiDay ? (result.daily ?? []) : (result.hourly ?? [])
  const breakdownGranularity: "day" | "hour" = isMultiDay ? "day" : "hour"
  const hasBreakdown = breakdownRows.length > 0

  const dispatchPoints = toDispatchPoints(result, isTelemetry)

  // ── Telemetry-only evidence view ────────────────────────────────────────
  if (isTelemetry) {
    // Server stats are computed on the full series before chart downsampling
    // (frame-resolution SOC extremes and breach count); the local fallback
    // only serves results that predate `chartStats`.
    const tele = result.chartStats ?? computeTelemetryStats(dispatchPoints)
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi term="gridImport" value={`${result.totals.actualImportKwh.toFixed(1)} kWh`} />
          {/* TRUE EV delivered = metered per-connector counter energy (C1+C2).
              NOT totals.evKwh, which is the power-balance signal that absorbs the
              ChargePost/hotel aux load and phantom-inflates EV when no car charges. */}
          <Kpi
            term="evDelivered"
            value={`${((result.totals.mEv1Kwh ?? 0) + (result.totals.mEv2Kwh ?? 0)).toFixed(1)} kWh`}
          />
          {/* AUX = ChargePost/hotel baseload — non-dispatchable grid draw the
              battery cannot offset. Reported separately so it is never mistaken
              for EV energy. */}
          <Kpi term="aux" value={`${(result.totals.auxKwh ?? 0).toFixed(1)} kWh`} />
          <Kpi
            label="Measured SOC"
            value={tele.hasSoc ? `${tele.socMin.toFixed(0)}–${tele.socMax.toFixed(0)}%` : "—"}
          />
          <Kpi
            term="gridCap"
            label="Grid-cap breaches"
            value={tele.capKw > 0 ? `${tele.breaches}` : "n/a"}
            tone={tele.breaches > 0 ? "warn" : tele.capKw > 0 ? "ok" : "default"}
          />
        </div>

        {dispatchPoints.length > 0 ? (
          <DispatchingOverview
            mode="bms-only"
            points={dispatchPoints}
            sessions={result.sessions}
            totals={result.totals}
            fullDayAxis={fullDayAxis}
            dayPrices={dayPrices}
            rangeStartMs={rangeStartMs}
            rangeEndMs={rangeEndMs}
          />
        ) : null}

        <p className="text-xs text-muted-foreground">
          {k.frames.toLocaleString()} frames · {k.durationHours.toFixed(1)}h
          {tele.hasSoc ? ` · measured SOC ${tele.socMin.toFixed(0)}–${tele.socMax.toFixed(0)}%` : ""}
          {tele.capKw > 0 ? ` · grid cap ${formatCapKW(tele.capKw * 1000)}` : ""}
          {/* Long windows are charted as bucket means (server-side downsampling).
              Say so — the KPIs above (SOC range, breaches) and all totals still
              come from the full-resolution data. */}
          {result.seriesStepMs
            ? ` · chart at ${Math.round(result.seriesStepMs / 60_000)}-min means (${dispatchPoints.length.toLocaleString()} points; KPIs and totals from full data)`
            : ""}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          label="Savings"
          value={`€${k.savingsEur.toFixed(2)}`}
          tone={k.savingsEur >= 0 ? "ok" : "warn"}
          onClick={hasBreakdown ? () => setBreakdownOpen(true) : undefined}
          hint={hasBreakdown ? `Breakdown by ${breakdownGranularity}` : undefined}
        />
        <Kpi
          label="Savings %"
          value={`${k.savingsPct.toFixed(1)}%`}
          tone={k.savingsPct >= 0 ? "ok" : "warn"}
        />
        <Kpi label="Actual cost" value={`€${k.actualCostEur.toFixed(2)}`} />
        <Kpi label="Optimized cost" value={`€${k.optimizedCostEur.toFixed(2)}`} />
      </div>

      {/* Inline per-day breakdown stays for multi-day ranges; the popup offers
          the same (and the hourly view for single days) on demand. */}
      {isMultiDay ? (
        <SavingsBreakdown rows={breakdownRows} granularity="day" totalSavingsEur={k.savingsEur} />
      ) : null}

      <Dialog open={breakdownOpen} onOpenChange={setBreakdownOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Savings breakdown</DialogTitle>
            <DialogDescription>
              {breakdownGranularity === "day"
                ? "Net savings per operating day. Rows sum to the headline figure."
                : "Net savings per hour for this day. Rows sum to the headline figure."}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto">
            <SavingsBreakdown
              rows={breakdownRows}
              granularity={breakdownGranularity}
              totalSavingsEur={k.savingsEur}
            />
          </div>
        </DialogContent>
      </Dialog>

      {dispatchPoints.length > 0 ? (
        <DispatchingOverview
          mode="optimized"
          points={dispatchPoints}
          sessions={result.sessions}
          totals={result.totals}
          rangeStartMs={rangeStartMs}
          rangeEndMs={rangeEndMs}
        />
      ) : null}

      <p className="text-xs text-muted-foreground">
        {k.frames.toLocaleString()} frames · {k.durationHours.toFixed(1)}h · SOC{" "}
        {k.socMinPct.toFixed(0)}–{k.socMaxPct.toFixed(0)}% · {k.batteryCycles.toFixed(2)} cycles
      </p>
    </div>
  )
}

/**
 * Real-telemetry summary stats derived straight from the metered dispatch
 * points — measured SOC range (across both packs) and grid-cap breaches (frames
 * where actual import exceeded the applicable site grid limit). No optimiser
 * counterfactual is involved.
 */
function computeTelemetryStats(points: DispatchPoint[]): {
  socMin: number
  socMax: number
  hasSoc: boolean
  breaches: number
  capKw: number
} {
  let socMin = Infinity
  let socMax = -Infinity
  let breaches = 0
  let capKw = 0
  const EPS = 0.5 // kW tolerance so float noise doesn't count as a breach
  for (const p of points) {
    for (const soc of [p.actualB1SocPct, p.actualB2SocPct]) {
      if (soc != null && Number.isFinite(soc)) {
        if (soc < socMin) socMin = soc
        if (soc > socMax) socMax = soc
      }
    }
    const lim = p.siteGridLimitKw
    if (lim != null && Number.isFinite(lim)) {
      capKw = Math.max(capKw, lim)
      if (p.actualImportKw != null && Math.abs(p.actualImportKw) > lim + EPS) breaches++
    }
  }
  const hasSoc = socMin !== Infinity
  return { socMin: hasSoc ? socMin : 0, socMax: hasSoc ? socMax : 0, hasSoc, breaches, capKw }
}

/**
 * Savings breakdown table — one row per time bucket (operating day for multi-day
 * windows, hour for a single day). Each row has a diverging bar (emerald =
 * optimizer saved money, amber = it cost more) sized relative to the biggest
 * |savings| in the set, plus the exact €/% and the bucket's actual → optimized
 * cost. Rows sum exactly to the headline savings KPI. Used inline (multi-day)
 * and inside the Savings popup.
 */
function SavingsBreakdown({
  rows,
  granularity,
  totalSavingsEur,
}: {
  rows: DailySaving[]
  granularity: "day" | "hour"
  totalSavingsEur: number
}) {
  const maxAbs = Math.max(...rows.map((d) => Math.abs(d.savingsEur)), 0.01)
  const fmtBucket = (iso: string) =>
    granularity === "day"
      ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })
      : // iso is "YYYY-MM-DDTHH" for hourly buckets.
        new Date(`${iso}:00:00Z`).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "UTC",
        })

  const unitLabel = granularity === "day" ? "days" : "hours"

  return (
    <div className="rounded-lg border bg-muted/20">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">
          {granularity === "day" ? "Savings by day" : "Savings by hour"}
        </h3>
        <span className="text-xs text-muted-foreground">
          {rows.length} {unitLabel} · total{" "}
          <span className={totalSavingsEur >= 0 ? "text-emerald-600" : "text-amber-600"}>
            €{totalSavingsEur.toFixed(2)}
          </span>
        </span>
      </div>
      <div className="divide-y">
        {rows.map((d) => {
          const positive = d.savingsEur >= 0
          const frac = Math.min(Math.abs(d.savingsEur) / maxAbs, 1)
          const widthPct = frac * 50
          return (
            <div key={d.bucketIso} className="flex items-center gap-3 px-4 py-2">
              <span className="w-20 shrink-0 text-xs font-medium tabular-nums text-foreground">
                {fmtBucket(d.bucketIso)}
              </span>
              {/* Diverging bar: center line = €0; right = saved, left = lost. */}
              <div className="relative h-4 flex-1">
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden />
                <div
                  className={`absolute inset-y-0.5 rounded-sm ${positive ? "bg-emerald-500" : "bg-amber-500"}`}
                  style={
                    positive
                      ? { left: "50%", width: `${widthPct}%` }
                      : { right: "50%", width: `${widthPct}%` }
                  }
                  title={`€${d.savingsEur.toFixed(2)} (${d.savingsPct.toFixed(1)}%)`}
                />
              </div>
              <div className="flex w-32 shrink-0 flex-col items-end">
                <span
                  className={`text-sm font-semibold tabular-nums ${positive ? "text-emerald-600" : "text-amber-600"}`}
                >
                  {positive ? "+" : "−"}€{Math.abs(d.savingsEur).toFixed(2)}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {d.savingsPct.toFixed(1)}% · €{d.actualCostEur.toFixed(2)} → €{d.optimizedCostEur.toFixed(2)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Map a backtest series onto the overview's DispatchPoint shape. Shared by the
 * on-screen Report and the Excel export so both see the same numbers.
 */
function toDispatchPoints(result: RangeBacktestResult, isTelemetry: boolean): DispatchPoint[] {
  return result.series.map((p) => ({
    ts: p.ts,
    hour: p.hour ?? 0,
    priceEurMwh: p.priceEurMwh,
    actualImportKw: p.actualGridKw,
    // Telemetry view shows ONLY the metered reality — no optimised counterfactual.
    optimizedImportKw: isTelemetry ? null : p.gridKw,
    evKw: p.evKw ?? 0,
    evRequestedKw: p.evRequestedKw ?? p.evKw ?? null,
    evServedKw: p.evServedKw ?? null,
    // Per-connector acceptance ceiling, car SoC and charger ETA-to-full.
    ev1AcceptKw: p.ev1AcceptKw ?? null,
    ev2AcceptKw: p.ev2AcceptKw ?? null,
    ev1SocCarPct: p.ev1SocCarPct ?? null,
    ev2SocCarPct: p.ev2SocCarPct ?? null,
    ev1FullS: p.ev1FullS ?? null,
    ev2FullS: p.ev2FullS ?? null,
    siteGridLimitKw: p.siteGridLimitKw ?? null,
    // In telemetry mode the SOC panel (non-opt) reads b1/b2SocPct, so feed the
    // MEASURED pack SOC into those keys; otherwise feed the simulated-forward
    // SOC (dashed) and keep the measured SOC as the solid baseline overlay.
    b1SocPct: isTelemetry ? (p.actualB1SocPct ?? p.socPct ?? null) : (p.b1SocPct ?? p.socPct ?? null),
    b2SocPct: isTelemetry ? (p.actualB2SocPct ?? p.socPct ?? null) : (p.b2SocPct ?? p.socPct ?? null),
    actualB1SocPct: p.actualB1SocPct ?? null,
    actualB2SocPct: p.actualB2SocPct ?? null,
    g1Kw: p.g1Kw ?? null,
    g2Kw: p.g2Kw ?? null,
    b1Kw: p.b1Kw ?? null,
    b2Kw: p.b2Kw ?? null,
    mEv1Kw: p.mEv1Kw ?? null,
    mEv2Kw: p.mEv2Kw ?? null,
    mEv1Kwh: p.mEv1Kwh ?? null,
    mEv2Kwh: p.mEv2Kwh ?? null,
    sEv1Kwh: p.sEv1Kwh ?? null,
    sEv2Kwh: p.sEv2Kwh ?? null,
  }))
}

function Kpi({
  label,
  term,
  value,
  tone = "default",
  onClick,
  hint,
}: {
  /** Visible label. Defaults to the Annex term's canonical label when `term` is set. */
  label?: string
  /** Annex glossary key — adds the shared definition tooltip (lib/report-definitions). */
  term?: ReportTermKey
  value: string
  tone?: "default" | "ok" | "warn"
  onClick?: () => void
  hint?: string
}) {
  const toneClass =
    tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-foreground"
  const body = (
    <>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {term ? <TermLabel term={term}>{label}</TermLabel> : label}
        {hint ? <TrendingDown className="size-3 opacity-60" aria-hidden /> : null}
      </div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-muted-foreground">{hint} →</div> : null}
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={hint}
        className="rounded-lg border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {body}
      </button>
    )
  }
  return <div className="rounded-lg border bg-muted/30 px-3 py-2.5">{body}</div>
}
