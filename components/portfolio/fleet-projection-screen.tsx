"use client"

import { useMemo, useState } from "react"

import useSWR from "swr"
import { endOfDay, endOfMonth, format, startOfMonth, subDays } from "date-fns"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { BatteryWarning, Landmark, Loader2, Play, TrendingDown, Zap } from "lucide-react"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ExportExcelButton } from "@/components/reports/export-excel-button"
import { ReportMonthPicker } from "@/components/reports/report-month-picker"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { TelemetryLoader } from "@/components/prototype/telemetry-loader"
import { runBacktestForRange } from "@/app/actions/backtest"
import { getIdmPricesForRange } from "@/app/actions/idm-prices"
import {
  getPortfolioSummary,
  getStationSeasonalRates,
  simulateFleetMonth,
  type FleetMonthSim,
} from "@/app/actions/portfolio"
import {
  compute,
  DEFAULT_ADDER_CT,
  DEFAULT_CYCLING_CT,
  DEFAULT_FLAT_CT,
} from "@/lib/tariff-compute"
import { GRID_REAL_POWER_CAP_KW, SLOT_MS } from "@/lib/dispatch-kernel"
import { isReportableArchiveMonth } from "@/lib/hist-provenance"
import { TermLabel } from "@/components/reports/term"
import { fmtEur, fmtInt } from "./format"

/**
 * In-bar € label for a stacked segment. Rendered only when the segment is wide
 * enough to hold its number — narrow slivers stay clean and the tooltip still
 * carries the exact value.
 */
function renderSegmentLabel(props: {
  x?: number | string
  y?: number | string
  width?: number | string
  height?: number | string
  value?: number | string
}) {
  const x = Number(props.x ?? 0)
  const y = Number(props.y ?? 0)
  const width = Number(props.width ?? 0)
  const height = Number(props.height ?? 0)
  const value = Number(props.value ?? 0)
  if (!value) return null
  const label = `${Math.round(value)} €`
  // ~6.2 px per character at 10.5px font + padding; hide when it can't fit.
  if (width < label.length * 6.2 + 8) return null
  return (
    <text
      x={x + width / 2}
      y={y + height / 2}
      textAnchor="middle"
      dominantBaseline="central"
      style={{ fontSize: 10.5, fontWeight: 600, fill: "#fff", pointerEvents: "none" }}
    >
      {label}
    </text>
  )
}

/**
 * History Analysis — Monthly Report. Pick a month of the PRE-SYSTEM archive,
 * see what the whole fleet would have earned had every location run the
 * dispatching system.
 *
 * ARCHIVE ONLY (client decision 2 sep 2026): nothing on this page comes from
 * live telemetry. It used to (a) replace Gronau's row with its real Financial
 * Report month and (b) scale every site's load-shift € by a real ÷ simulated
 * "capture rate" measured on Gronau July 2026. Both were removed — a history
 * report must not contain real-report data. Real stations live under Fleet.
 *
 * The calculation mirrors the Financial Report block-for-block, PER LOCATION:
 *  1. Procurement WITHOUT load shifting — the site's REAL archive import for
 *     the month, spread over its own hourly load shape and priced hour-by-hour
 *     with the month's REAL IDM history. (The archive world has no dispatcher,
 *     so its real import IS the no-shifting baseline.)
 *  2. Flat cost — the same real kWh × the flat contract rate.
 *  3. Load shifting — a greedy dispatcher moves energy from each day's
 *     expensive hours into its cheapest hours where the spread beats the
 *     battery wear cost. The simulator's own value, unscaled.
 *  4. Extra battery wear — shifted kWh × the cycling rate; net total saving =
 *     procurement saving − wear; LS participation = timing value − wear.
 */

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  tone?: "positive" | "negative"
  hint?: string
}) {
  const card = (
    <Card className={`flex flex-row items-center gap-3 p-4 ${hint ? "cursor-help" : ""}`}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">{label}</span>
        <span
          className={`text-xl font-semibold tabular-nums leading-tight ${
            tone === "positive"
              ? "text-emerald-600 dark:text-emerald-500"
              : tone === "negative"
                ? "text-amber-600 dark:text-amber-500"
                : ""
          }`}
        >
          {value}
        </span>
        {sub ? <span className="text-xs text-muted-foreground truncate">{sub}</span> : null}
      </div>
    </Card>
  )
  if (!hint) return card
  return (
    <TooltipProvider delayDuration={150}>
      <UiTooltip>
        <TooltipTrigger asChild>{card}</TooltipTrigger>
        <TooltipContent className="max-w-xs text-pretty">{hint}</TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  )
}

/**
 * 3-tier hour-mix bar: where this site's charging historically lands.
 *  - emerald: CHEAP hours (below the site's median price).
 *  - sky: EXPENSIVE, WORTH SHIFTING — premium over the site's cheap-hour
 *    average exceeds the battery wear cost.
 *  - gray: EXPENSIVE, NOT WORTH IT — premium below the wear cost.
 */
function TierBar({
  cheap,
  worth,
  notWorth,
}: {
  cheap: number | null
  worth: number | null
  notWorth: number | null
}) {
  if (cheap == null || worth == null || notWorth == null) {
    return <span className="text-muted-foreground">—</span>
  }
  const c = Math.max(0, cheap)
  const w = Math.max(0, worth)
  const n = Math.max(0, notWorth)
  return (
    <TooltipProvider delayDuration={150}>
      <UiTooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-2 cursor-help">
            <span className="inline-flex h-2 w-20 overflow-hidden rounded-full">
              <span className="h-full bg-emerald-500/85" style={{ width: `${c}%` }} />
              <span className="h-full bg-sky-500/85" style={{ width: `${w}%` }} />
              <span className="h-full bg-muted-foreground/30" style={{ width: `${n}%` }} />
            </span>
            <span className="tabular-nums text-xs whitespace-nowrap">
              {c.toFixed(0)}/{w.toFixed(0)}/{n.toFixed(0)}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-pretty text-xs">
          <p className="font-medium mb-1">Where this site&apos;s charging historically lands:</p>
          <p>
            <span className="text-emerald-500 font-medium">{c.toFixed(0)}% cheap hours</span> — below the site&apos;s
            median price, already where the dispatcher wants it.
          </p>
          <p>
            <span className="text-sky-500 font-medium">{w.toFixed(0)}% expensive, worth shifting</span> — premium over
            cheap hours exceeds the {(DEFAULT_CYCLING_CT * 10).toFixed(0)} €/MWh battery wear; the dispatcher earns by
            moving this load.
          </p>
          <p>
            <span className="font-medium">{n.toFixed(0)}% expensive, not worth it</span> — premium below the wear
            cost; shifting would cost more battery than it saves.
          </p>
        </TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  )
}

/** One location's FinReport-style month result from the archive simulation. */
type LocationRow = {
  stationId: string
  city: string
  zip: string
  brand: string
  volumeSource: "month" | "seasonal" | "recent"
  importKwh: number
  evKwh: number
  /** Charging sessions re-derived from the station's CCR export (per-connector
   * power islands); null = no basis for this month → "n/a", never estimated. */
  sessions: number | null
  flatEur: number
  noShiftEur: number
  asRunEur: number
  procSavingEur: number
  wearEur: number
  netEur: number
  /** LS participation = timing value − wear (FinReport rule). */
  lsEur: number
  timingEur: number
  shiftedKwh: number
}

const SESSIONS_HINT =
  "Charging sessions re-derived from the station's CCR export as per-connector power islands (same filters as the live counter method: idle ≤ 8 min bridged, ≥ 2 frames, > 0.1 kWh). n/a = that station's export has not been imported for this month; no estimate is shown."

export function FleetProjectionScreen() {
  const now = new Date()
  const [pickedMonth, setPickedMonth] = useState("")
  // The picker edits a DRAFT — nothing recomputes until Run is pressed.
  const [draftMonth, setDraftMonth] = useState("")

  // Real archive bounds — the month picker only allows months where the fleet
  // actually reported data.
  const { data: summary } = useSWR("portfolio-summary", () => getPortfolioSummary(), {
    revalidateOnFocus: false,
  })
  const minMonth = summary?.firstDay?.slice(0, 7) ?? null
  const maxMonth = summary?.lastDay?.slice(0, 7) ?? null
  // Default month: June 2026 (client request) — clamped into the real archive
  // bounds, so if the archive doesn't cover it we fall back gracefully.
  const DEFAULT_MONTH = "2026-06"
  const simMonth = useMemo(() => {
    const v = pickedMonth || DEFAULT_MONTH
    if (minMonth && v < minMonth) return minMonth
    if (maxMonth && v > maxMonth) return maxMonth
    return minMonth || maxMonth ? v : ""
  }, [pickedMonth, minMonth, maxMonth])

  const monthDate = useMemo(() => (simMonth ? new Date(`${simMonth}-01T00:00:00`) : null), [simMonth])
  const monthName = monthDate ? format(monthDate, "MMMM yyyy") : "…"
  const rangeMonth = monthDate ? monthDate.getMonth() + 1 : new Date().getMonth() + 1

  // ── Per-location hourly simulation for the month ───────────────────────────
  // The ONLY data source on this page: the archive's own hourly volumes priced
  // with the month's real IDM history. No live-station backtest is run here.
  const { data: simRaw, isLoading: simLoading } = useSWR(
    simMonth ? ["fmr-sim", simMonth] : null,
    () => simulateFleetMonth({ month: simMonth, flatEurMwh: DEFAULT_FLAT_CT * 10, wearEurMwh: DEFAULT_CYCLING_CT * 10 }),
    { revalidateOnFocus: false, keepPreviousData: true },
  )
  const sim: FleetMonthSim | null = simRaw && !("error" in simRaw) ? simRaw : null
  const simError = simRaw && "error" in simRaw ? simRaw.error : null

  // 3-tier hour mix (informational column).
  const { data: rates } = useSWR(
    ["fleet-projection-rates", rangeMonth],
    () => getStationSeasonalRates(rangeMonth, DEFAULT_CYCLING_CT * 10),
    { revalidateOnFocus: false, keepPreviousData: true },
  )
  const tiersById = useMemo(() => {
    const map = new Map<string, { cheap: number | null; worth: number | null; notWorth: number | null }>()
    for (const r of rates ?? []) {
      map.set(r.stationId, { cheap: r.cheapSharePct, worth: r.worthSharePct, notWorth: r.notWorthSharePct })
    }
    return map
  }, [rates])

  const wearEurPerKwh = DEFAULT_CYCLING_CT / 100 // ct/kWh → €/kWh

  // PROVENANCE (Defect 1, sep 2 2026): a REPORT lists only station-months the
  // archive actually holds. Synthesized volumes (seasonal / recent proxies)
  // and zero months are a projection aid — off by default, one click to show,
  // and never silently inside the fleet total.
  const [showProjected, setShowProjected] = useState(false)
  const projectedCount = useMemo(
    () => (sim ? sim.stations.filter((s) => !isReportableArchiveMonth({ ...s, month: simMonth })).length : 0),
    [sim, simMonth],
  )

  const rows: LocationRow[] | null = useMemo(() => {
    if (!sim) return null
    const visible = showProjected
      ? sim.stations
      : sim.stations.filter((s) => isReportableArchiveMonth({ ...s, month: simMonth }))
    return visible.map((s) => {
      // The simulator's own load-shift value — the same identities as the
      // Financial Report blocks, no scaling by any live-station ratio.
      const timingEur = s.timingRawEur
      const shiftedKwh = s.shiftedKwhRaw
      const wearEur = shiftedKwh * wearEurPerKwh
      const asRunEur = s.noShiftEur - timingEur
      const procSavingEur = s.flatEur - asRunEur
      const netEur = procSavingEur - wearEur
      return {
        stationId: s.stationId,
        city: s.city,
        zip: s.zip,
        brand: s.brand,
        volumeSource: s.volumeSource,
        importKwh: s.importKwh,
        evKwh: s.evKwh,
        sessions: s.sessions,
        flatEur: s.flatEur,
        noShiftEur: s.noShiftEur,
        asRunEur,
        procSavingEur,
        wearEur,
        netEur,
        lsEur: timingEur - wearEur,
        timingEur,
        shiftedKwh,
      }
    })
  }, [sim, simMonth, wearEurPerKwh, showProjected])

  const fleet = useMemo(() => {
    if (!rows) return null
    return rows.reduce(
      (a, r) => ({
        importKwh: a.importKwh + r.importKwh,
        evKwh: a.evKwh + r.evKwh,
        // Σ over locations WITH a basis; sessionsNa counts those without, so the
        // footer can say "k of n locations" instead of passing a partial sum
        // off as the fleet figure.
        sessions: a.sessions + (r.sessions ?? 0),
        sessionsNa: a.sessionsNa + (r.sessions == null ? 1 : 0),
        flatEur: a.flatEur + r.flatEur,
        noShiftEur: a.noShiftEur + r.noShiftEur,
        asRunEur: a.asRunEur + r.asRunEur,
        procSavingEur: a.procSavingEur + r.procSavingEur,
        wearEur: a.wearEur + r.wearEur,
        netEur: a.netEur + r.netEur,
        lsEur: a.lsEur + r.lsEur,
        timingEur: a.timingEur + r.timingEur,
        shiftedKwh: a.shiftedKwh + r.shiftedKwh,
      }),
      {
        importKwh: 0,
        evKwh: 0,
        sessions: 0,
        sessionsNa: 0,
        flatEur: 0,
        noShiftEur: 0,
        asRunEur: 0,
        procSavingEur: 0,
        wearEur: 0,
        netEur: 0,
        lsEur: 0,
        timingEur: 0,
        shiftedKwh: 0,
      },
    )
  }, [rows])

  // Business ranking: site load served (kWh is complete for every location;
  // session counts can be n/a where an export is not imported).
  const ranked = useMemo(
    () => (rows ? [...rows].sort((a, b) => b.evKwh - a.evKwh || b.importKwh - a.importKwh) : null),
    [rows],
  )

  // Chart: top 25 by NET SAVING, sorted by net saving, so bar length order is
  // monotonic and matches the € numbers in the table below one-for-one.
  const chartData = useMemo(
    () =>
      rows
        ? [...rows]
            .sort((a, b) => b.netEur - a.netEur)
            .slice(0, 25)
            .map((r) => ({
              name: r.city.length > 14 ? `${r.city.slice(0, 13)}…` : r.city,
              tariff: +(r.netEur - r.lsEur).toFixed(0),
              shift: +r.lsEur.toFixed(0),
              total: +r.netEur.toFixed(0),
            }))
        : [],
    [rows],
  )

  const loading = !summary || simLoading || (!simRaw && !!simMonth)

  const fmtCt = (eur: number, kwh: number) => (kwh > 0 ? ((eur / kwh) * 100).toFixed(1) : "—")

  return (
    <main className="flex w-full flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">History Analysis — Monthly Report</h1>
          {/* The month is the picker's job — shown as a live chip, not baked into the title. */}
          <Badge className="font-mono">{monthName}</Badge>
          <Badge variant="outline">archive simulation · no telemetry</Badge>
          {/* Excel export (restored — it moved to the yearly screen when that
              was built). Reuses the pre-computed report route with a
              single-month range, so the workbook matches the snapshot the
              yearly report is built from. */}
          {simMonth ? (
            <ExportExcelButton
              href={`/api/reports/fleet-yearly/xlsx?from=${simMonth}&to=${simMonth}`}
              disabled={loading}
              className="ml-auto"
            />
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground text-pretty max-w-3xl">
          What the fleet&apos;s electricity procurement would have looked like in {monthName} had every location run
          the dispatching system — each site&apos;s REAL pre-system archive volumes and hourly load shape, priced with
          that month&apos;s REAL IDM history, block-for-block like the Financial Report. Nothing here comes from live
          telemetry; real stations are reported under Fleet.
        </p>
      </header>

      {/* THE input: the historical month. Everything else is informational. */}
      <Card className="flex flex-row flex-wrap items-start gap-x-8 gap-y-4 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fp-sim-month" className="text-sm font-medium">
            Report month (historical)
          </Label>
          <div className="flex items-center gap-2">
            <ReportMonthPicker
              id="fp-sim-month"
              value={draftMonth || simMonth}
              onChange={setDraftMonth}
              min={minMonth ?? simMonth}
              max={maxMonth ?? simMonth}
              // Locked while a simulation is in flight — changing the month
              // mid-run would silently retarget every SWR key.
              disabled={!summary || loading}
            />
            <Button
              size="sm"
              onClick={() => {
                if (draftMonth) setPickedMonth(draftMonth)
              }}
              disabled={loading || !draftMonth || draftMonth === simMonth}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <Play className="mr-1.5 size-3.5" />
                  Run
                </>
              )}
            </Button>
          </div>
          {minMonth && maxMonth ? (
            <p className="text-[10px] text-muted-foreground">
              real fleet history: {minMonth} → {maxMonth}
              {draftMonth && draftMonth !== simMonth && !loading ? (
                <span className="text-amber-600 font-medium"> · press Run to compute {draftMonth}</span>
              ) : null}
            </p>
          ) : null}
        </div>
        {/* Informational: what is fixed, what is real, what is measured */}
        <div className="flex flex-col gap-1 text-xs text-muted-foreground max-w-xl text-pretty pt-0.5">
          <p>
            <span className="text-foreground font-medium">Flat tariff:</span> {(DEFAULT_FLAT_CT * 10).toFixed(0)}{" "}
            €/MWh ({DEFAULT_FLAT_CT} ct/kWh) — the Financial Report&apos;s contract rate, applied to each site&apos;s
            real grid import.
          </p>
          <p>
            <span className="text-foreground font-medium">IDM prices:</span> the month&apos;s REAL hourly intraday
            history (SMARD via the price cache{sim ? ` — ${sim.pricedDays} priced days` : ""}), per day and hour — not
            DAM, not an average.
          </p>
          <p>
            <span className="text-foreground font-medium">Volumes:</span> each site&apos;s REAL archive import for the
            month, spread over its own hourly load shape from the export.
          </p>
          <p>
            <span className="text-foreground font-medium">Shifting capability:</span> the simulated dispatcher&apos;s
            own result — energy moved out of each day&apos;s expensive hours into its cheapest hours where the spread
            beats battery wear, bounded by battery physics. No scaling against any live station.
          </p>
        </div>
      </Card>

      {loading ? (
        <Card className="overflow-hidden">
          <TelemetryLoader
            mode="historical"
            bare
            title="Simulating the Selected Month"
            subtitle="Pricing every location's archive volumes with the month's real IDM history"
            endpoint="POST simulateFleetMonth"
            footer="archive data only — no live-station telemetry"
          />
        </Card>
      ) : simError || !sim || !rows || !fleet ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {simError ?? `Simulation unavailable for ${monthName} — try a different month.`}
        </Card>
      ) : (
        <>
          {/* HEADLINE: the FinReport blocks at fleet level */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              icon={Zap}
              label="Fleet net total saving"
              value={fmtEur(fleet.netEur)}
              sub={`after battery wear · ${fleet.flatEur > 0 ? ((fleet.netEur / fleet.flatEur) * 100).toFixed(1) : "—"}% vs flat`}
              tone="positive"
              hint="Energy procurement saving minus extra battery wear, summed over every location — the same NET TOTAL SAVING block as the Financial Report."
            />
            <Kpi
              icon={Landmark}
              label="Energy procurement saving"
              value={`+${fmtEur(fleet.procSavingEur)}`}
              sub={`flat ${fmtEur(fleet.flatEur)} vs IDM ${fmtEur(fleet.asRunEur)}`}
              tone="positive"
              hint="Buying every site's real import at the flat contract vs the dynamic IDM (dispatch) cost — the IDM-indexed tariff with the dispatcher shifting load. Same block as the Financial Report."
            />
            <Kpi
              icon={BatteryWarning}
              label="Extra battery wear"
              value={`−${fmtEur(fleet.wearEur)}`}
              sub={`${fmtInt(fleet.shiftedKwh)} kWh extra cycling`}
              tone="negative"
              hint="The shifted energy cycles through the battery — extra throughput × the cycling rate. Anticipated from the same greedy dispatch that produced the shifting gain, calibrated by Gronau."
            />
            <Kpi
              icon={TrendingDown}
              label="Load shifting gain"
              value={`+${fmtEur(fleet.lsEur)}`}
              sub={`${fleet.netEur > 0 ? ((fleet.lsEur / fleet.netEur) * 100).toFixed(0) : "—"}% of net saving`}
              tone="positive"
              hint="Load shifting saving − battery wear cost (shifting cycles the battery more, so its wear is charged against it). Net total saving = tariff saving + this gain. The rest of the net comes from the tariff price level itself."
            />
          </div>

          {/* Methodology */}
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-md border bg-muted/30 px-4 py-2.5 text-xs">
              <span className="font-medium text-sm">Data basis: pre-system archive only</span>
              <span className="text-muted-foreground">
                {sim.stations.filter((s) => isReportableArchiveMonth({ ...s, month: simMonth })).length} locations
                with their own {monthName} export volume · {sim.pricedDays} priced days of IDM history
              </span>
              <span className="text-muted-foreground">
                no measured rows, no calibration against live stations
              </span>
            </div>
            <h2 className="text-sm font-semibold mb-2">How each location is simulated</h2>
            <ol className="list-decimal list-inside flex flex-col gap-1.5 text-sm text-muted-foreground text-pretty leading-relaxed">
              <li>
                <span className="text-foreground font-medium">Procurement without load shifting:</span> the
                site&apos;s REAL {monthName} grid import, day by day, spread across hours with its own measured load
                shape and priced with that day&apos;s REAL hourly IDM prices. The archive world has no dispatcher — its
                real import IS the no-shifting baseline. Flat cost = the same kWh ×{" "}
                {(DEFAULT_FLAT_CT * 10).toFixed(0)} €/MWh.
              </li>
              <li>
                <span className="text-foreground font-medium">Procurement with load shifting:</span> a dispatcher
                moves each day&apos;s energy out of expensive hours into that day&apos;s cheapest hours — only where
                the spread beats the {(DEFAULT_CYCLING_CT * 10).toFixed(0)} €/MWh wear cost, bounded by battery
                physics (max 30% of a day&apos;s import).
              </li>
              <li>
                <span className="text-foreground font-medium">Financial Report blocks per site:</span> procurement
                saving = flat − IDM (dispatch); extra wear = shifted kWh × {(DEFAULT_CYCLING_CT * 10).toFixed(0)}{" "}
                €/MWh; net total saving = tariff saving + load shifting gain; load shifting gain = shifting saving −
                wear cost (shifting cycles the battery more).
              </li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground text-pretty">
              The report lists only locations whose archive holds {format(monthDate!, "MMMM yyyy")} itself. Sites
              without archive data for the month can be shown as a projection aid (same calendar month of another
              year, then most recent days — flagged and never inside the total). Energy timing + tariff choice only
              — no grid fees, levies, or site-specific constraints.
            </p>
          </Card>

          {/* Per-location net saving, stacked tariff + shifting */}
          <Card className="p-5">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
              <div>
                <h2 className="text-sm font-semibold">{monthName} net saving per location — top 25 by net saving</h2>
                <p className="text-xs text-muted-foreground">
                  each bar = the site&apos;s net saving for the month, split into its two sources; the number at the bar
                  end is the total, identical to the Net € column in the table below
                </p>
              </div>
              {/* Explicit legend — the two stack segments */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="size-3 rounded-sm bg-primary/60" />
                  Tariff saving <span className="text-muted-foreground">(flat vs IDM-indexed)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-3 rounded-sm" style={{ background: "var(--color-chart-2)" }} />
                  Load shifting gain <span className="text-muted-foreground">(shifting saving − wear)</span>
                </span>
              </div>
            </div>
            <div className="h-[560px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 0, right: 64, left: 8, bottom: 0 }}
                  barCategoryGap="18%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => `${v} €`}
                    domain={[0, (dataMax: number) => Math.ceil((dataMax * 1.05) / 50) * 50]}
                  />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} interval={0} />
                  <Tooltip
                    cursor={{ fill: "var(--color-muted)", fillOpacity: 0.35 }}
                    contentStyle={{ fontSize: 12 }}
                    formatter={(v: number, name: string) => [
                      fmtEur(v),
                      name === "shift" ? "Load shifting gain" : "Tariff saving",
                    ]}
                  />
                  <Bar dataKey="tariff" stackId="a" radius={[0, 0, 0, 0]} fill="var(--color-primary)" fillOpacity={0.6}>
                    {/* In-segment € value, hidden when the segment is too narrow to hold it */}
                    <LabelList dataKey="tariff" content={renderSegmentLabel} />
                  </Bar>
                  <Bar dataKey="shift" stackId="a" radius={[0, 3, 3, 0]} fill="var(--color-chart-2)" fillOpacity={0.8}>
                    <LabelList dataKey="shift" content={renderSegmentLabel} />
                    <LabelList
                      dataKey="total"
                      position="right"
                      formatter={(v: number) => `${v} €`}
                      style={{ fontSize: 11, fontWeight: 600, fill: "var(--color-foreground)" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Reading example: a bar of 300&nbsp;€ + 100&nbsp;€ = 400&nbsp;€ means switching that site to the
              IDM-indexed tariff saved 300&nbsp;€ on its real consumption, and running the dispatcher on top added
              another 100&nbsp;€ net of battery wear.
            </p>
          </Card>

          {/* Per-location FinReport table */}
          <Card className="overflow-hidden p-0">
            <div className="flex flex-col gap-3 p-5 pb-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-sm font-semibold">Per-location Financial Report — {monthName}</h2>
                <p className="text-xs text-muted-foreground text-pretty max-w-3xl">
                  Ranked by business (site load served — the archive export carries no per-connector counters, so EV
                  delivered and ChargePost AUX cannot be separated here). <b>Dynamic no-dispatch</b> = the site&apos;s
                  real import priced hour-by-hour with the month&apos;s real IDM curve, dispatcher off.{" "}
                  <b>Dynamic procurement</b> = the same month with the simulated dispatcher shifting load. <b>Net</b> =
                  tariff saving + LS gain.{" "}
                  <b>LS gain</b> = shifting saving − wear cost (shifting cycles the battery more).{" "}
                  <b>Hour mix</b>: green cheap / blue worth shifting / gray not worth it. <b>Sessions</b> are
                  re-derived from each station&apos;s CCR export (per-connector power islands, same filters as the
                  live counter method); n/a = export not imported for this month, never an estimate.
                </p>
              </div>
              {projectedCount > 0 ? (
                <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <Switch checked={showProjected} onCheckedChange={setShowProjected} aria-label="Show projected volumes" />
                  <span className="text-pretty">
                    Show {projectedCount} projected {projectedCount === 1 ? "location" : "locations"}
                    <span className="block text-[10px]">
                      no archive volume for {monthName} — excluded from the report and its total
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    {/* Column names come from lib/report-definitions (the Annex) —
                        identical label + tooltip on every report page. */}
                    <th className="py-2 px-5 font-medium">#</th>
                    <th className="py-2 px-3 font-medium">
                      <TermLabel term="site">Location</TermLabel>
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      <TermLabel term="siteLoad" unit="kWh" />
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      <TermLabel term="gridImport" unit="kWh" />
                    </th>
                    <th className="py-2 px-3 font-medium text-right" title={SESSIONS_HINT}>
                      <TermLabel term="sessions" />
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      <TermLabel term="flatCost" unit="€">
                        Flat €
                      </TermLabel>
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      <TermLabel term="counterfactualImport">Dynamic no-dispatch €</TermLabel>
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      <TermLabel term="dynamicCost">Dynamic procurement €</TermLabel>
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      <TermLabel term="extraWear">Wear €</TermLabel>
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      <TermLabel term="netTotalSaving">Net €</TermLabel>
                    </th>
                    <th className="py-2 px-3 font-medium text-right">
                      <TermLabel term="loadShiftingContribution">LS gain €</TermLabel>
                    </th>
                    <th className="py-2 px-3 font-medium text-right">Hour mix</th>
                  </tr>
                </thead>
                <tbody>
                  {(ranked ?? []).map((r, i) => {
                    const tiers = tiersById.get(r.stationId)
                    return (
                      <tr key={r.stationId} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="py-2 px-5 tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="py-2 px-3">
                          <span className="font-medium">{r.city}</span>
                          <span className="text-muted-foreground text-xs ml-1.5">{r.zip}</span>
                          {r.volumeSource !== "month" ? (
                            <TooltipProvider delayDuration={150}>
                              <UiTooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="ml-2 text-[10px] font-normal cursor-help border-dashed text-muted-foreground"
                                  >
                                    {r.volumeSource === "seasonal"
                                      ? "projected · other-year volumes"
                                      : "projected · recent-days volumes"}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-pretty text-xs">
                                  {r.volumeSource === "seasonal"
                                    ? `No archive data for ${monthName} at this site — the same calendar month of another archive year is used, priced with ${monthName}'s real IDM history.`
                                    : `No archive data for this calendar month in any year — the site's most recent days are used, priced with ${monthName}'s real IDM history.`}
                                </TooltipContent>
                              </UiTooltip>
                            </TooltipProvider>
                          ) : null}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{fmtInt(r.evKwh)}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                          {fmtInt(r.importKwh)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {r.sessions == null ? <span className="text-muted-foreground">n/a</span> : fmtInt(r.sessions)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                          {fmtEur(r.flatEur)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                          {fmtEur(r.noShiftEur)}
                          <span className="text-muted-foreground text-xs ml-1">
                            ({fmtCt(r.noShiftEur, r.importKwh)})
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                          {fmtEur(r.asRunEur)}
                          <span className="text-muted-foreground text-xs ml-1">({fmtCt(r.asRunEur, r.importKwh)})</span>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-amber-600 dark:text-amber-500 whitespace-nowrap">
                          −{fmtEur(r.wearEur)}
                        </td>
                        <td
                          className={`py-2 px-3 text-right tabular-nums font-medium whitespace-nowrap ${r.netEur >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"}`}
                        >
                          {fmtEur(r.netEur)}
                          <span className="text-muted-foreground font-normal ml-1">
                            ({r.flatEur > 0 ? ((r.netEur / r.flatEur) * 100).toFixed(0) : "—"}%)
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                          {fmtEur(r.lsEur)}
                          <span className="text-muted-foreground text-xs ml-1">
                            ({r.netEur > 0 ? ((r.lsEur / r.netEur) * 100).toFixed(0) : "—"}%)
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <TierBar
                            cheap={tiers?.cheap ?? null}
                            worth={tiers?.worth ?? null}
                            notWorth={tiers?.notWorth ?? null}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/40 font-medium">
                    <td className="py-2.5 px-5" colSpan={2}>
                      Fleet total — {rows.length} locations
                      {showProjected && rows.some((r) => !isReportableArchiveMonth({ ...r, month: simMonth }))
                        ? ` (incl. ${rows.filter((r) => !isReportableArchiveMonth({ ...r, month: simMonth })).length} projected)`
                        : projectedCount > 0
                          ? ` (${projectedCount} without archive volume excluded)`
                          : ""}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtInt(fleet.evKwh)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtInt(fleet.importKwh)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {rows.length > 0 && fleet.sessionsNa >= rows.length ? (
                        <span className="text-muted-foreground">n/a</span>
                      ) : (
                        <>
                          {fmtInt(fleet.sessions)}
                          {fleet.sessionsNa > 0 ? (
                            <span className="block text-[10px] font-normal text-muted-foreground">
                              {rows.length - fleet.sessionsNa} of {rows.length} locations
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtEur(fleet.flatEur)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtEur(fleet.noShiftEur)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtEur(fleet.asRunEur)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-amber-600 dark:text-amber-500">
                      −{fmtEur(fleet.wearEur)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right tabular-nums ${fleet.netEur >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"}`}
                    >
                      {fmtEur(fleet.netEur)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtEur(fleet.lsEur)}</td>
                    <td className="py-2.5 px-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <p className="text-xs text-muted-foreground text-pretty max-w-4xl">
            Historical simulation, not a guarantee: each location&apos;s result comes from its own pre-system archive
            volumes and hourly load shape under {monthName}&apos;s real market prices. No live-station data enters
            this page — the real fleet is reported separately under Fleet.
          </p>
        </>
      )}
    </main>
  )
}
