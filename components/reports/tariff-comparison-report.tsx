"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import useSWR from "swr"
import { format } from "date-fns"
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  Legend,
  ComposedChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import { computePriceBands, BAND_GREEN, BAND_RED } from "@/components/lab/dispatching-overview"
import { formatCapKW } from "@/lib/prototype-telemetry"
import {
  TrendingDown,
  TrendingUp,
  Zap,
  Euro,
  Gauge,
  RefreshCw,
  BatteryCharging,
  Lock,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react"
import Link from "next/link"
import type { Reconciliation } from "@/app/actions/settlement"
import { Button } from "@/components/ui/button"
import { TermLabel } from "@/components/reports/term"
import {
  DEFINITIONS_SHEET_HEADER,
  DEFINITIONS_SHEET_WIDTHS,
  definitionsSheetRows,
  termHeader,
  type ReportTermKey,
} from "@/lib/report-definitions"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Badge } from "@/components/ui/badge"
import { TelemetryLoader } from "@/components/prototype/telemetry-loader"
import { useStation } from "@/components/station-context"
import { settleStationRange } from "@/app/actions/settlement"
import { monthLabel as fleetMonthLabel } from "@/lib/report-window"

/**
 * Flat rate vs. dynamic (IDM-indexed) tariff comparison for the German market.
 *
 * Pulls the metered grid-import series for the window (runBacktestForRange →
 * series[].actualGridKw) and the INTRADAY (IDM) price curve for the same window
 * (getIdmPricesForRange → Neon idm_price cache, with a live SMARD fetch when the
 * cache is cold) and prices every imported kWh two ways:
 *   • Flat tariff   — one fixed €/kWh for every kWh, regardless of hour
 *                     (defaults to 12.5 ct/kWh).
 *   • Dynamic tariff — the IDM intraday-indexed price for that 15-min slot, plus
 *                      an optional fixed adder for non-energy components (grid
 *                      fees, taxes, levies, supplier margin). This is how
 *                      Tibber / aWATTar style dynamic tariffs are billed.
 *
 * The interesting result is whether the dispatch strategy (which shifts load
 * into cheap intraday windows) makes the IDM-indexed tariff cheaper than a flat
 * rate over the chosen window.
 */

// This component does NOT import the pricing engine or its defaults any more.
// It renders `settlement.c` / `settlement.params` exactly as the server action
// (app/actions/settlement → lib/settlement) returned them — the same call the
// Fleet Monthly builder makes. No client-side recompute, no editable
// parameters, no way to display a figure the Fleet reports would not.
import type { Computed, DayBucket, SocPoint, ImportPoint, BattDetailPoint } from "@/lib/tariff-compute"

// The methodology version is NOT declared here: the server action returns the
// single METHODOLOGY_VERSION (lib/methodology-version) and the footer prints it.

const eur = (v: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v)
const eur2 = (v: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v)
const kwh = (v: number) =>
  `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(v)} kWh`
const ctPerKwh = (v: number) =>
  `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(v)} ct/kWh`
// Plain 2-decimal number for Excel cells (keeps them numeric, not formatted text).
const round2 = (v: number) => Math.round(v * 100) / 100

export function TariffComparisonReport({
  from,
  to,
  registerExport,
}: {
  from: Date
  to: Date
  /**
   * Lets the page host the shared "Export Excel" button in its period header.
   * Called with the export function once figures are on screen, with `null`
   * while loading / errored / on unmount.
   */
  registerExport?: (fn: (() => Promise<void>) | null) => void
}) {
  // `from` / `to` are local-midnight DAY markers from the picker. Only the
  // calendar day travels to the server; lib/report-window turns it into Berlin
  // instants there — identically for this report and the Fleet Monthly cron —
  // so the browser's timezone can no longer shift the window.
  const fromDay = useMemo(() => format(from, "yyyy-MM-dd"), [from])
  const toDay = useMemo(() => format(to, "yyyy-MM-dd"), [to])
  // Battery-wear panel (incl. SOC trajectories) is detail-on-demand: collapsed
  // by default since the hero already carries the net wear figure.
  const [wearOpen, setWearOpen] = useState(false)
  const [battDetailOpen, setBattDetailOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  // MULTI-LOCATION: the report is computed for the sidebar-selected station;
  // stationId in the SWR key re-runs the report when the operator switches.
  const { stationId, station } = useStation()
  const stationLabel = station?.name ?? stationId
  // ONE call — lib/settlement.settleStationWindow — the same function that
  // writes the Fleet Monthly rows (and therefore the Fleet Yearly sums). The
  // server returns the replay, the price curve, the engine output AND the
  // Annex euros; this component only renders them.
  const {
    data: settlement,
    error,
    isLoading,
  } = useSWR(
    ["station-settlement", stationId, fromDay, toDay],
    () => settleStationRange({ stationId, fromDay, toDay }),
    { revalidateOnFocus: false, keepPreviousData: true },
  )
  const data = settlement?.bt
  const idm = settlement?.idm ?? null

  // Export hand-off to the page header. `exportFnRef` is (re)assigned during
  // render — null on the loading/error paths, the workbook builder once figures
  // exist — and the effect publishes it after every render. The host keeps it in
  // a ref and only flips a boolean, so this can't loop.
  const exportFnRef = useRef<(() => Promise<void>) | null>(null)
  exportFnRef.current = null
  useEffect(() => {
    registerExport?.(exportFnRef.current)
  })
  useEffect(() => () => registerExport?.(null), [registerExport])

  if (isLoading || (!settlement && !error)) {
    return (
      <Card className="overflow-hidden">
        <TelemetryLoader
          mode="historical"
          bare
          title="Pricing Grid Import"
          subtitle="Replaying metered grid import and resolving IDM intraday prices over the range"
          endpoint="POST settleStationRange"
          footer="Comparing flat rate vs IDM-indexed tariff"
        />
      </Card>
    )
  }

  if (error || !settlement || !data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Could not load grid-import telemetry for this range. Please try again.
        </CardContent>
      </Card>
    )
  }

  if (data.empty || data.mpcStatus === "unavailable") {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {data.mpcMessage ?? "No metered grid import available for this range yet."}
        </CardContent>
      </Card>
    )
  }

  // IDM may be entirely unavailable for the window; that's no longer fatal — the
  // IDM-indexed tariff falls back to the DAM day-ahead price per slot (see compute).
  const idmBySlot = new Map<number, number>(
    (idm?.prices ?? []).map((p) => [p.slot, p.priceEurMwh]),
  )
  // This report renders the SERVER's engine output and nothing else — the same
  // `Computed` the Fleet Monthly row was frozen from. The settlement parameters
  // are not editable anywhere (client decision sep 3 2026: defaults always, for
  // every report), so there is no what-if branch and no way for this page to
  // show a figure the Fleet reports would not.
  const c = settlement.c
  const { flatCt, adderCt, wearCt: cyclingCt, gridCapKw } = settlement.params
  if (!c) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No grid import was drawn in this window, so there is nothing to price.
        </CardContent>
      </Card>
    )
  }

  // Verdict is driven by the NET saving (energy saving minus the extra battery
  // wear load shifting incurs), not the gross energy saving alone — the wear can
  // erase, or even reverse, a favourable procurement number.
  const netPositive = c.netSaving > 0
  const energySavesButWearWins = c.diff > 0 && !netPositive
  const chartConfig: ChartConfig = {
    flatCost: { label: "Flat rate", color: "var(--chart-5)" },
    dynamicCost: { label: "IDM-indexed tariff", color: "var(--chart-1)" },
    idmWeightedCt: { label: "Avg IDM", color: "var(--chart-3)" },
  }

  const socConfig: ChartConfig = {
    arbSoc: { label: "With load shifting (as run)", color: "var(--chart-1)" },
    noArbSoc: { label: "No load shifting (grid-first)", color: "var(--chart-5)" },
  }

  // ONE EV definition (Gronau defect 2): the engine splits the chart's load
  // band into metered EV (C1+C2) + AUX whenever connector counters exist.
  const hasAuxSplit = c.importSeries.some((p) => p.auxPosKw != null)

  // Same palette semantics as the live Dispatching Overview: chart-5 = grid
  // import, chart-4 = EV delivered, chart-1 = price, chart-2 = the dashed
  // comparison overlay (here: projected import if no load shifting).
  const importConfig: ChartConfig = {
    importNegKw: { label: "Grid import (measured)", color: "var(--chart-5)" },
    noArbNegKw: { label: "Projected import if no load shifting", color: "var(--chart-2)" },
    evPosKw: { label: hasAuxSplit ? "EV delivered (metered C1+C2)" : "Site load", color: "var(--chart-4)" },
    auxPosKw: { label: "AUX (ChargePost)", color: "var(--muted-foreground)" },
    price: { label: "Price €/MWh", color: "var(--chart-1)" },
  }

  const battDetailConfig: ChartConfig = {
    battKw: { label: "Battery power (BMS)", color: "var(--chart-4)" },
    cumBmsKwh: { label: "Cumulative BMS throughput", color: "var(--chart-1)" },
    cumSocKwh: { label: "Cumulative SOC-implied", color: "var(--chart-2)" },
    cumNoArbKwh: { label: "Cumulative no-load-shifting (simulated)", color: "var(--chart-5)" },
    extraCyclingKwh: { label: "Extra cycling vs baseline", color: "var(--destructive)" },
  }

  // THE "when do we over-cycle" answer (client request aug 21 2026): signed
  // running gap between the as-run wear basis and the simulated baseline.
  // Idle deadband jitter is subtracted from the as-run side — it is
  // strategy-independent and excluded from BOTH quoted wear totals, so the
  // band matches the € figures. Above zero = load shifting has cycled the
  // pack MORE than a grid-first device would have by that moment (the slope
  // shows the exact hours it accrues); below zero = cycling LESS.
  const battDetailWithExtra = c.battDetailSeries.map((p) => ({
    ...p,
    // Gap markers carry null cumulatives — keep them null (NaN would draw).
    extraCyclingKwh:
      p.cumBmsKwh == null ? null : p.cumBmsKwh - (p.cumDeadbandKwh ?? 0) - p.cumNoArbKwh,
  }))

  // Derived inputs for the overview-styled import chart: the dispatch-rule
  // cheap/peak bands (same algorithm and colors as the live overview), the
  // numeric-hour span, and symmetric axis domains so 0 kW aligns with 0 €/MWh.
  const importBands = computePriceBands(
    c.importSeries.map((p) => ({ hour: p.hour, price: p.price })),
  )
  const importHours: [number, number] = [
    c.importSeries[0]?.hour ?? 0,
    c.importSeries[c.importSeries.length - 1]?.hour ?? 24,
  ]
  const importKwMax = (() => {
    let m = gridCapKw
    // Skip the engine's "no telemetry" gap markers (all-null values — a null
    // in Math.max would poison the whole axis domain into NaN).
    for (const p of c.importSeries) {
      if (p.importNegKw == null) continue
      m = Math.max(m, -p.importNegKw, -p.noArbNegKw, p.evPosKw + (p.auxPosKw ?? 0))
    }
    return Math.max(25, Math.ceil(m / 25) * 25)
  })()
  const importPriceMax = (() => {
    let m = 0
    for (const p of c.importSeries) if (p.price != null) m = Math.max(m, Math.abs(p.price))
    return Math.max(50, Math.ceil(m / 50) * 50)
  })()
  const fmtImportTick = (h: number) =>
    new Date(c.importOriginMs + h * 3_600_000).toLocaleString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      ...(importHours[1] - importHours[0] > 26 ? { month: "short", day: "numeric" } : {}),
    })

  /** Build and download the full report as an .xlsx workbook (Summary,
   *  Daily breakdown, Assumptions). xlsx is loaded on demand so it never
   *  weighs down the page bundle. */
  async function exportExcel() {
    if (exporting || !c) return
    setExporting(true)
    try {
      const XLSX = await import("xlsx")
      const wb = XLSX.utils.book_new()
      const th = termHeader

      // ── Sheet 1: Summary — mirrors the hero + breakdown table, Annex labels ──
      const summaryRows: (string | number)[][] = [
        ["Financial Report — flat vs IDM-indexed tariff"],
        [],
        [th("site"), stationLabel],
        [th("settlementWindow"), `${c.days[0]?.dayIso ?? ""} → ${c.days[c.days.length - 1]?.dayIso ?? ""}`],
        ["Days", c.days.length],
        [th("gridImport", { unit: "kWh" }), round2(c.totalImportKwh)],
        [th("priceSourceMix"), `${round2(c.idmFraction * 100)} % live IDM · ${round2(c.damFraction * 100)} % DAM fallback`],
        ["Price sources", idm?.sources?.join(", ") || "DAM day-ahead"],
        [],
        ["Energy procurement", "", ""],
        [th("flatCost", { unit: "EUR" }), round2(c.flatCost), `${round2(c.flatBlendedCt)} ct/kWh effective`],
        [th("dynamicCost", { unit: "EUR" }), round2(c.dynamicCost), `${round2(c.dynamicBlendedCt)} ct/kWh effective`],
        [th("procurementSaving", { unit: "EUR" }), round2(c.diff), `${round2(c.diffPct)} % vs flat`],
        [],
        ["Battery wear / cycling cost", "", ""],
        [`${th("batteryThroughput", { unit: "kWh" })} — with load shifting`, round2(c.throughputWithArbKwh)],
        [`${th("batteryThroughput", { unit: "kWh" })} — without load shifting`, round2(c.throughputNoArbKwh)],
        [`${th("wear", { unit: "EUR" })} — with load shifting`, round2(c.wearWithArb)],
        [`${th("wear", { unit: "EUR" })} — without load shifting`, round2(c.wearNoArb)],
        [th("extraWear", { unit: "EUR" }), round2(c.arbExtraWear)],
        [],
        ["Net result", "", ""],
        ["Flat net operating cost (EUR)", round2(c.flatNet)],
        ["Dynamic net operating cost (EUR)", round2(c.dynamicNet)],
        [th("netTotalSaving", { unit: "EUR" }), round2(c.netSaving), `${round2(c.netSavingPct)} % vs flat net`],
        [],
        ["Load shifting participation", "", ""],
        [th("counterfactualImport", { unit: "kWh" }), round2(c.noArbImportKwh)],
        ["Procurement without load shifting (EUR)", round2(c.procurementNoArbCost)],
        [th("timingValue", { unit: "EUR" }), round2(c.timingValue)],
        [th("loadShiftingContribution", { unit: "EUR" }), round2(c.arbNetContribution)],
      ]
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows)
      wsSummary["!cols"] = [{ wch: 44 }, { wch: 18 }, { wch: 34 }]
      XLSX.utils.book_append_sheet(wb, wsSummary, "Summary")

      // ── Sheet 2: Daily breakdown — mirrors the daily-cost chart ──
      const wsDaily = XLSX.utils.json_to_sheet(
        c.days.map((d) => ({
          Date: d.dayIso,
          [th("gridImport", { unit: "kWh" })]: round2(d.importKwh),
          [th("flatCost", { unit: "EUR" })]: round2(d.flatCost),
          [th("dynamicCost", { unit: "EUR" })]: round2(d.dynamicCost),
          [th("procurementSaving", { unit: "EUR" })]: round2(d.flatCost - d.dynamicCost),
          [th("effectiveCt")]: round2(d.idmWeightedCt),
        })),
      )
      wsDaily["!cols"] = [{ wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 24 }, { wch: 22 }]
      XLSX.utils.book_append_sheet(wb, wsDaily, "Daily breakdown")

      // ── Sheet 3: Settlement parameters — fixed by the Annex, identical in
      // every report (never user-adjusted) ──
      const wsAssumptions = XLSX.utils.aoa_to_sheet([
        ["Settlement parameters (fixed by Settlement Methodology Annex)"],
        [],
        [th("flatRate"), flatCt, "Annex"],
        ["Fixed adder on IDM (ct/kWh)", adderCt, "Annex"],
        ["Battery cycling cost (ct/kWh throughput)", cyclingCt, "Annex"],
        [th("gridCap"), gridCapKw, "Annex"],
        ["Methodology version", settlement?.methodologyVersion ?? "", ""],
      ])
      wsAssumptions["!cols"] = [{ wch: 38 }, { wch: 14 }, { wch: 10 }]
      XLSX.utils.book_append_sheet(wb, wsAssumptions, "Parameters")

      // ── Sheet 4: Definitions — the shared Annex glossary ──
      const wsDefs = XLSX.utils.aoa_to_sheet([
        [...DEFINITIONS_SHEET_HEADER],
        ...definitionsSheetRows([
          "site",
          "settlementWindow",
          "slot",
          "gridImport",
          "flatRate",
          "dynamicTariff",
          "priceSourceMix",
          "flatCost",
          "dynamicCost",
          "effectiveCt",
          "procurementSaving",
          "batteryThroughput",
          "wear",
          "extraWear",
          "netTotalSaving",
          "counterfactualImport",
          "timingValue",
          "loadShiftingContribution",
          "gridCap",
        ]),
      ])
      wsDefs["!cols"] = DEFINITIONS_SHEET_WIDTHS.map((wch) => ({ wch }))
      XLSX.utils.book_append_sheet(wb, wsDefs, "Definitions")

      const from = c.days[0]?.dayIso ?? "from"
      const to = c.days[c.days.length - 1]?.dayIso ?? "to"
      XLSX.writeFile(wb, `financial-report_${stationLabel.replace(/\s+/g, "-")}_${from}_${to}.xlsx`)
    } finally {
      setExporting(false)
    }
  }
  // Publish to the page header's Export Excel button (see effect above).
  exportFnRef.current = exportExcel

  return (
    <div className="flex flex-col gap-4">
      {/* ── HERO: NET TOTAL SAVING — the single most important number on the
             page. It is the gross energy-procurement saving MINUS the extra
             battery wear the load shifting strategy incurs, so the wear penalty is
             baked into the headline rather than buried in a table below. */}
      <Card
        className={`overflow-hidden ${
          netPositive ? "border-emerald-500/40" : "border-amber-500/40"
        }`}
      >
        <CardContent
          className={`flex flex-col gap-5 p-5 sm:p-6 ${
            netPositive ? "bg-emerald-500/5" : "bg-amber-500/5"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div
                className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
                  netPositive
                    ? "bg-emerald-500/15 text-emerald-600"
                    : "bg-amber-500/15 text-amber-600"
                }`}
              >
                {netPositive ? <TrendingDown className="size-6" /> : <TrendingUp className="size-6" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {netPositive ? "Net total saving" : "Net extra cost"}
                  <span className="ml-1.5 normal-case text-muted-foreground/70">
                    · after battery wear
                  </span>
                </p>
                <p
                  className={`mt-0.5 text-4xl font-bold tabular-nums leading-none sm:text-5xl ${
                    netPositive ? "text-emerald-600" : "text-amber-600"
                  }`}
                >
                  {/* Explicit sign (user review aug 24 2026): a loss day must
                      read −6,79 €, not 6,79 € with the sign only in the label. */}
                  {netPositive ? "+" : "−"}
                  {eur(Math.abs(c.netSaving))}
                </p>
                <p className="mt-2 max-w-xl text-sm text-muted-foreground text-pretty">
                  {netPositive
                    ? `Running the dynamic (IDM-indexed) tariff with battery load shifting nets this much after charging the extra cycling wear against the energy saving`
                    : energySavesButWearWins
                      ? `The dynamic tariff saves ${eur(c.diff)} on energy, but the extra battery wear from load shifting (${eur(c.arbExtraWear)}) outweighs it — a flat rate wins on net`
                      : `A flat rate would have been cheaper on net`}{" "}
                  over {settlement.window.days} day{settlement.window.days === 1 ? "" : "s"}.
                </p>
              </div>
            </div>
            <Badge
              className={`shrink-0 gap-1 px-2.5 py-1 text-sm tabular-nums ${
                netPositive
                  ? "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400"
                  : "bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400"
              }`}
            >
              {netPositive ? <TrendingDown className="size-3.5" /> : <TrendingUp className="size-3.5" />}
              {Math.abs(c.netSavingPct).toFixed(1)}% vs flat net
            </Badge>
          </div>

          {/* Savings equation — makes the battery-wear subtraction explicit:
              energy saving − extra load shifting wear = net total saving. */}
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
            <HeroStat
                icon={<Euro className="size-4" />}
                label="Energy procurement saving"
                term="procurementSaving"
              value={`${c.diff >= 0 ? "+" : "−"}${eur(Math.abs(c.diff))}`}
              sub={`flat ${eur(c.flatCost)} vs IDM ${eur(c.dynamicCost)}`}
              tone={c.diff >= 0 ? "positive" : "negative"}
            />
            <HeroStat
                icon={<BatteryCharging className="size-4" />}
                label="Extra battery wear"
                term="extraWear"
              value={`−${eur(Math.abs(c.arbExtraWear))}`}
              sub={`${kwh(Math.max(0, c.throughputWithArbKwh - c.throughputNoArbKwh))} extra cycling`}
              tone="negative"
            />
            <HeroStat
                icon={netPositive ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}
                label="Net total saving"
                term="netTotalSaving"
              value={`${c.netSaving >= 0 ? "+" : "−"}${eur(Math.abs(c.netSaving))}`}
              sub="energy saving − wear"
              tone={netPositive ? "positive" : "negative"}
              highlight
            />
          </div>

          {/* RECONCILIATION (client requirement sep 3 2026): when the window is
              exactly a fleet month, show the frozen Fleet Monthly row for this
              station next to the live figure. Same function on both sides, so
              this is a visible proof, not a hope. A what-if overrides it. */}
          <ReconciliationNote
            reconciliation={settlement.reconciliation}
            stationLabel={stationLabel}
            liveNet={c.netSaving}
            liveLs={c.arbNetContribution}
          />

          {/* Informational KPI: procurement cost with vs without load shifting,
              and how much of the net saving load shifting timing contributed. The
              baseline is the grid-first counterfactual curve (grid serves all
              it can, battery only above cap, immediate recharge to 95% SOC),
              priced at the same per-slot market prices. Always visible
              (previously easter-egg gated) — user-requested promotion to a
              first-class report figure. */}
          <div className="rounded-lg border border-dashed bg-muted/20 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <div className="flex items-center gap-2">
                <Zap className="size-4 shrink-0 text-sky-600" />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Load shifting participation
                </span>
                {/* Attribution honesty (client escalation sep 3 2026, Norderstedt
                    Aug): the as-run side is MEASURED BMS cycling, and before
                    Amperio dispatch is active on a site that cycling is the
                    unit's LOCAL controller — this figure must not read as "the
                    Algorithm did this". */}
                <span className="text-[10px] text-muted-foreground">
                  measured battery behaviour vs peak-shave-only baseline — includes the unit&apos;s own local-controller
                  shifting, not only Amperio dispatch
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold tabular-nums leading-none text-foreground">
                  {c.arbNetContribution >= 0 ? "+" : "−"}
                  {eur(Math.abs(c.arbNetContribution))}
                </span>
                {netPositive && (
                  <span className="text-sm font-medium tabular-nums text-sky-600">
                    {Math.max(0, Math.min(999, c.arbShareOfNetPct)).toFixed(0)}% of net saving
                  </span>
                )}
              </div>
            </div>
            <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-3">
              <div className="flex items-baseline justify-between gap-2 sm:flex-col sm:justify-start">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Procurement — without load shifting
                </span>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {eur(c.procurementNoArbCost)}
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                    {ctPerKwh(c.noArbBlendedCt)} · {kwh(c.noArbImportKwh)}
                  </span>
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 sm:flex-col sm:justify-start">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Procurement — with load shifting (as run)
                </span>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {eur(c.dynamicCost)}
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                    {ctPerKwh(c.dynamicBlendedCt)} · {kwh(c.totalImportKwh)}
                  </span>
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2 sm:flex-col sm:justify-start">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Timing value − extra wear
                </span>
                <span className="text-sm font-semibold tabular-nums text-sky-600">
                  {c.timingValue >= 0 ? "" : "−"}
                  {eur(Math.abs(c.timingValue))} − {eur(Math.abs(c.arbExtraWear))} ={" "}
                  {c.arbNetContribution >= 0 ? "+" : "−"}
                  {eur(Math.abs(c.arbNetContribution))}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  energy balance: measured import − {(c.lsLossShare * 100).toFixed(0)} % ×{" "}
                  {kwh(c.lsExtraChargeKwh)} extra battery charge added by load shifting (battery meter{" "}
                  {kwh(c.battMeterChargeKwh)} − peak-shave need {kwh(c.psChargeGridKwh)})
                  {c.battMeterRoundTripEff != null
                    ? ` · this window's own meter round trip: ${(c.battMeterRoundTripEff * 100).toFixed(1)} %`
                    : ""}
                  {" · "}baseline SOC anchored to measured start &amp; end
                  {Math.abs(c.storedDiffKwh) > 0.05 ? (
                    <>
                      {" "}({c.storedDiffKwh >= 0 ? "+" : "−"}
                      {kwh(Math.abs(c.storedDiffKwh))} end true-up)
                    </>
                  ) : null}
                  {" · "}priced on the simulated 15-min shape ({kwh(c.simNoArbImportKwh)} /{" "}
                  {eur(c.simNoArbCostEur)} simulated)
                </span>
                {c.supersededEffDays > 0 ? (
                  <span className="inline-flex w-fit items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] tabular-nums text-amber-700 dark:text-amber-400">
                    {c.supersededEffDays} day{c.supersededEffDays === 1 ? "" : "s"} without battery-meter
                    legs (frozen before 4 Sep 2026, no raw data left) — the energy-balance rule cannot be
                    applied there; these days keep their simulated baseline
                    {c.supersededEffKwh > 0.05 ? (
                      <>
                        {" "}
                        with the superseded 85 % gross-up removed algebraically (−{kwh(c.supersededEffKwh)}{" "}
                        / −{eur(c.supersededEffEur)})
                      </>
                    ) : null}
                  </span>
                ) : null}
                {c.noArbImportKwh > c.totalImportKwh + 0.05 ? (
                  <span className="inline-flex w-fit items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] tabular-nums text-amber-700 dark:text-amber-400">
                    projection above measured import by {kwh(c.noArbImportKwh - c.totalImportKwh)} — only
                    possible on days without battery-meter legs (simulated baseline); read the
                    load-shifting figure for this window as indicative only
                  </span>
                ) : null}
                {c.battMeterRoundTripEff != null && c.battMeterRoundTripEff > 1 ? (
                  <span className="inline-flex w-fit items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] tabular-nums text-amber-700 dark:text-amber-400">
                    battery meter inconsistent: reports {(c.battMeterRoundTripEff * 100).toFixed(1)} %
                    round trip ({'>'}100 % — more discharged than charged); the energy-balance rule uses
                    only its charge leg, so the extra-charge figure above may be understated (vendor
                    issue T4)
                  </span>
                ) : null}
              </div>
            </div>
            {/* Grid-import comparison in the SAME visual language as the live
                Dispatching Overview: import below zero, EV delivered above,
                price €/MWh on the right axis (stepAfter stairway), cheap/peak
                dispatch-rule bands, dashed grid cap at −cap — plus the extra
                dashed "projected import if no load shifting" curve. The downward-
                stacked shift bands shade WHERE load moved between the curves. */}
            <div className="mt-3 space-y-1.5 border-t border-dashed pt-3">
              <p className="text-xs font-medium">
                Grid import — measured vs projected if no load shifting
              </p>
              <ChartContainer config={importConfig} className="h-64 w-full">
                <ComposedChart data={c.importSeries} margin={{ left: 4, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  {importBands.map((b, i) => (
                    <ReferenceArea
                      key={`iband-${i}`}
                      yAxisId="kw"
                      x1={b.x1}
                      x2={b.x2}
                      fill={b.fill}
                      fillOpacity={b.opacity}
                      stroke="none"
                      ifOverflow="extendDomain"
                    />
                  ))}
                  {/* Telemetry holes: hatched-gray, labelled, and the series
                      break inside them (engine gap markers) — a gap must never
                      read as measured zeros or a bridged line. */}
                  {c.telemetryGaps.map((g, i) => (
                    <ReferenceArea
                      key={`igap-${i}`}
                      yAxisId="kw"
                      x1={g.x1}
                      x2={g.x2}
                      fill="var(--muted-foreground)"
                      fillOpacity={0.09}
                      stroke="var(--muted-foreground)"
                      strokeOpacity={0.35}
                      strokeDasharray="4 4"
                      label={{
                        value: "no telemetry",
                        position: "center",
                        fontSize: 10,
                        fill: "var(--muted-foreground)",
                      }}
                    />
                  ))}
                  <XAxis
                    dataKey="hour"
                    type="number"
                    domain={importHours}
                    tickFormatter={fmtImportTick}
                    fontSize={10}
                    tickLine={false}
                    minTickGap={56}
                    allowDataOverflow
                  />
                  {/* Symmetric domains keep 0 kW aligned with 0 €/MWh */}
                  <YAxis
                    yAxisId="kw"
                    domain={[-importKwMax, importKwMax]}
                    tickCount={5}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    unit="kW"
                  />
                  <YAxis
                    yAxisId="price"
                    orientation="right"
                    domain={[-importPriceMax, importPriceMax]}
                    tickCount={5}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  <ReferenceLine yAxisId="kw" y={0} stroke="var(--foreground)" strokeOpacity={0.25} />
                  {gridCapKw > 0 ? (
                    <ReferenceLine
                      yAxisId="kw"
                      y={-gridCapKw}
                      stroke="var(--destructive)"
                      strokeDasharray="4 4"
                      strokeOpacity={0.7}
                      label={{
                        value: `Grid cap ${formatCapKW(gridCapKw * 1000)}`,
                        position: "insideBottomLeft",
                        fontSize: 10,
                        fill: "var(--destructive)",
                      }}
                    />
                  ) : null}
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_l, payload) => payload?.[0]?.payload?.fullLabel ?? _l}
                        formatter={(value, _name, item) => {
                          const key = String(item?.dataKey ?? "")
                          if (key === "shiftBaseNeg") return null
                          const v = Number(value)
                          if (key === "shiftInNeg" || key === "shiftOutNeg") {
                            if (v > -0.05) return null
                            return [
                              ` +${Math.abs(v).toFixed(1)} kW`,
                              key === "shiftInNeg"
                                ? "Shifted in (buying cheap)"
                                : "Shifted out (avoiding expensive)",
                            ]
                          }
                          if (key === "price") return [` ${v.toFixed(1)} €/MWh`, "Price"]
                          const label =
                            key === "importNegKw"
                              ? "Grid import (measured)"
                              : key === "noArbNegKw"
                                ? "Projected import if no load shifting"
                                : key === "auxPosKw"
                                  ? "AUX ChargePost (non-dispatchable)"
                                  : hasAuxSplit
                                    ? "EV delivered (metered C1+C2)"
                                    : "Site load"
                          return [` ${Math.abs(v).toFixed(1)} kW`, label]
                        }}
                      />
                    }
                  />
                  {/* shift highlight stacked DOWNWARD between the two import curves */}
                  <Area
                    yAxisId="kw"
                    dataKey="shiftBaseNeg"
                    stackId="shift"
                    stroke="none"
                    fill="transparent"
                    isAnimationActive={false}
                    legendType="none"
                    tooltipType="none"
                  />
                  <Area
                    yAxisId="kw"
                    dataKey="shiftInNeg"
                    name="Shifted in (buying cheap)"
                    stackId="shift"
                    stroke="none"
                    fill="var(--chart-1)"
                    fillOpacity={0.3}
                    isAnimationActive={false}
                    legendType="none"
                  />
                  <Area
                    yAxisId="kw"
                    dataKey="shiftOutNeg"
                    name="Shifted out (avoiding expensive)"
                    stackId="shift"
                    stroke="none"
                    fill="var(--chart-2)"
                    fillOpacity={0.3}
                    isAnimationActive={false}
                    legendType="none"
                  />
                  {/* grid import drawn below zero (consumption) — as the overview */}
                  <Area
                    yAxisId="kw"
                    dataKey="importNegKw"
                    name="Grid import (measured)"
                    stroke="var(--chart-5)"
                    fill="var(--chart-5)"
                    fillOpacity={0.2}
                    strokeWidth={1.5}
                    dot={false}
                  />
                  {/* EV delivered (metered C1+C2) above zero, AUX stacked on
                      top — the stack top is the site load served. */}
                  <Area
                    yAxisId="kw"
                    dataKey="evPosKw"
                    name={hasAuxSplit ? "EV delivered (metered C1+C2)" : "Site load"}
                    stackId="load"
                    stroke="var(--chart-4)"
                    fill="var(--chart-4)"
                    fillOpacity={0.18}
                    strokeWidth={1.5}
                    dot={false}
                  />
                  {hasAuxSplit ? (
                    <Area
                      yAxisId="kw"
                      dataKey="auxPosKw"
                      name="AUX (ChargePost)"
                      stackId="load"
                      stroke="var(--muted-foreground)"
                      fill="var(--muted-foreground)"
                      fillOpacity={0.12}
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      dot={false}
                    />
                  ) : null}
                  {/* the one extra curve: projected import if no load shifting */}
                  <Line
                    yAxisId="kw"
                    dataKey="noArbNegKw"
                    name="Projected import if no load shifting"
                    stroke="var(--chart-2)"
                    strokeWidth={1.75}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                  {/* price stairway on the right axis, drawn last so it sits on top */}
                  <Line
                    yAxisId="price"
                    type="stepAfter"
                    dataKey="price"
                    name="Price €/MWh"
                    stroke="var(--chart-1)"
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Legend />
                </ComposedChart>
              </ChartContainer>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Same conventions as the live Dispatching Overview: import below zero,{" "}
                {hasAuxSplit
                  ? "metered EV delivered (C1+C2) above with the ChargePost AUX draw stacked on top (the stack top is the site load served; EV is exactly zero outside sessions)"
                  : "site load above"}
                , price on the right axis, green/red dispatch-rule bands, dashed grid cap. The
                dashed line is the projected import without load shifting; shaded gaps between the two
                import curves are the shifted load — deeper than baseline = pulled in (buying
                cheap), shallower = pushed out (battery serving instead). Volumes:{" "}
                {kwh(c.totalImportKwh)} measured vs {kwh(c.noArbImportKwh)} baseline — the baseline
                pack starts at the measured start SOC, holds it (re-buying only what peak shaving
                forces out), and is trued up to the measured end SOC, so both worlds start and end
                with identical stored energy and the {c.timingValue >= 0 ? "" : "−"}
                {eur(Math.abs(c.timingValue))} timing value is a direct procurement difference.
              </p>
            </div>

            <p className="mt-2 text-[11px] leading-snug text-muted-foreground text-pretty">
              &ldquo;Without load shifting&rdquo; is a grid-first baseline anchored to reality at
              both ends: the packs start at the measured start SOC, every session is served from
              the grid up to its cap (battery only covers demand above it, then re-buys exactly
              that energy), and at window close the baseline is trued up to the measured end SOC —
              its import curve is priced at the same per-slot market prices as the actual one.
              Because stored energy matches at both edges, the difference is purely the value of
              WHEN the software bought energy; the remainder of the saving comes from the market
              price level vs the flat rate.
            </p>
          </div>

          {/* Provenance stamp: data-through + model version make any two report
              runs comparable at a glance — a window ending "today" keeps
              filling, and figures also legitimately change when the accounting
              model is updated. Identical period + version + data-through ⇒
              identical figures. */}
          <p className="text-[11px] text-muted-foreground">
            {kwh(c.totalImportKwh)} imported · wear at {ctPerKwh(cyclingCt)} throughput · source:{" "}
            {idm?.sources?.join(", ") || "DAM day-ahead"} · data through{" "}
            {format(new Date(c.dataThroughIso), "MMM d, HH:mm")} · methodology {settlement.methodologyVersion} —
            the same engine, window rule and parameters as Fleet Monthly and Fleet Yearly.
          </p>
        </CardContent>
      </Card>

      {/* Tariff assumptions — read-only summary by default; a small Edit
          toggle reveals the sliders for what-if tuning. */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="size-4 text-muted-foreground" />
                Settlement parameters
              </CardTitle>
              <CardDescription className="mt-1.5">
                The dynamic tariff is indexed to the German intraday (IDM) continuous-average price
                for each slot, resolved from the price cache or fetched live from SMARD. The flat
                rate is energy-only (grid fees excluded); the fixed adder covers non-energy
                components on the IDM index. The grid-import cap is the maximum grid draw assumed in
                the no-load-shifting counterfactual. These parameters are fixed by the Settlement
                Methodology Annex and are identical in every report — Site Financial, Fleet Monthly
                and Fleet Yearly — so they cannot be adjusted here.
              </CardDescription>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground">
              <Lock className="size-3" />
              Fixed by Annex
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
            <AssumptionStat label="Flat rate" value={ctPerKwh(flatCt)} />
            <AssumptionStat label="Fixed adder on IDM" value={ctPerKwh(adderCt)} />
            <AssumptionStat label="Battery cycling cost" value={ctPerKwh(cyclingCt)} />
            <AssumptionStat label="Grid import cap" value={`${gridCapKw.toFixed(0)} kW`} />
          </div>
        </CardContent>
      </Card>

      {/* Net operating cost breakdown — energy + battery economics */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Euro className="size-4 text-muted-foreground" />
            Net operating cost breakdown
          </CardTitle>
          <CardDescription>
            Energy procurement under each tariff plus the battery wear that tariff&apos;s strategy
            incurs — peak-shave-only under flat, with-load shifting under IDM. The two-figure wear
            comparison is broken out in the card below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Line item</th>
                  <th className="px-3 py-2 text-right font-medium">Flat rate</th>
                  <th className="px-3 py-2 text-right font-medium">IDM-indexed tariff</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <BreakdownRow
                    icon={<Zap className="size-3.5" />}
                    label="Energy procurement"
                    term="dynamicCost"
                  detail={`${kwh(c.totalImportKwh)} grid import`}
                  flat={c.flatCost}
                  dynamic={c.dynamicCost}
                />
                <BreakdownRow
                    icon={<RefreshCw className="size-3.5" />}
                    label="Battery wear"
                    term="wear"
                  detail={`flat: ${kwh(c.throughputNoArbKwh)} peak-shave-only · IDM: ${kwh(c.throughputWithArbKwh)} with load shifting × ${ctPerKwh(cyclingCt)}`}
                  flat={c.wearNoArb}
                  dynamic={c.wearWithArb}
                />
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="px-3 py-2.5">Net operating cost</td>
                  <td className="px-3 py-2.5 text-right">{eur(c.flatNet)}</td>
                  <td className="px-3 py-2.5 text-right text-foreground">{eur(c.dynamicNet)}</td>
                </tr>
                <tr className="border-t-2 border-foreground/10 bg-muted/50">
                  <td className="px-3 py-2.5 font-semibold">
                    Net total saving
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      (flat − IDM, incl. wear)
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground" colSpan={1} />
                  <td
                    className={`px-3 py-2.5 text-right text-base font-bold tabular-nums ${
                      netPositive ? "text-emerald-600" : "text-amber-600"
                    }`}
                  >
                    {c.netSaving >= 0 ? "+" : "−"}
                    {eur(Math.abs(c.netSaving))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-3 rounded-lg border bg-muted/20 p-3">
            <p className="mb-2 text-xs font-medium">How procurement is calculated</p>
            <dl className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <CalcLine
                term="Grid import"
                expr={`metered over ${data.kpis.frames.toLocaleString()} frames · ${data.kpis.durationHours.toFixed(1)} h (full resolution, incl. EV, baseload & battery charging)`}
                result={kwh(c.totalImportKwh)}
              />
              <CalcLine
                term="Flat rate"
                expr={`${kwh(c.totalImportKwh)} × ${ctPerKwh(flatCt)}`}
                result={eur(c.flatCost)}
              />
              {/* The Σ is the ACTUAL calculation (each frame's kWh × its own
                  15-min slot price, summed); the ct/kWh figure is DERIVED from
                  that result (cost ÷ kWh) for context — never an input. Framed
                  that way so the derived average can't read as a shortcut. */}
              <CalcLine
                term="IDM-indexed"
                expr={`Σ over each 15-min slot (slot kWh × that slot's price${
                  adderCt > 0 ? ` + ${ctPerKwh(adderCt)} adder` : ""
                }) · ${Math.min(100, c.idmFraction * 100).toFixed(0)}% of kWh on live IDM prices${
                  c.damFraction > 0.005
                    ? `, ${Math.min(100, c.damFraction * 100).toFixed(0)}% on DAM fallback`
                    : ""
                } → works out to ${c.avgIdmCt.toFixed(2)} ct/kWh energy-weighted`}
                result={eur(c.dynamicCost)}
              />
            </dl>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            Each tariff carries the wear its strategy would actually incur: under a flat rate there
            is no price spread to load shifting, so only unavoidable peak-shaving cycling counts; under
            the IDM-indexed tariff the battery also cycles for load shifting, so its full as-run
            throughput is priced. Net cost = energy procurement + that tariff&apos;s wear. Import
            kWh is the engine&apos;s full-resolution meter total; the daily chart re-samples it for
            context.
          </p>
        </CardContent>
      </Card>

      {/* Battery wear — with vs without load shifting (the two-figure fair model).
          Collapsed by default: the net-saving hero already surfaces the wear
          number, so the full model (figures + calc + SOC trajectories) is
          detail-on-demand. The SOC chart lives INSIDE this panel because it is
          the visual evidence for the wear gap. */}
      <Collapsible open={wearOpen} onOpenChange={setWearOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer select-none pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BatteryCharging className="size-4 text-muted-foreground" />
                    Battery wear / cycling cost — with vs without load shifting
                  </CardTitle>
                  <CardDescription className="mt-1.5">
                    {wearOpen ? (
                      <>
                        Both figures price battery throughput at {ctPerKwh(cyclingCt)}, where
                        throughput counts energy moved in <em>both</em> directions (charge +
                        discharge) — so the headline kWh is ~2× the energy actually delivered, and
                        the effective cost is {ctPerKwh(cyclingCt * 2)} per delivered kWh. This is
                        the same per-direction degradation cost the optimizer plans against.
                        &ldquo;With load shifting&rdquo; is the wear that actually occurred;
                        &ldquo;without load shifting&rdquo; is the unavoidable floor — the grid pinned at{" "}
                        {gridCapKw.toFixed(0)} kW and the battery discharging only to cover EV demand
                        above the cap, plus the recharge that discharge requires. The gap is the
                        extra wear the load shifting strategy adds.
                      </>
                    ) : (
                      <>
                        Extra wear from load shifting: {eur(c.arbExtraWear)} (
                        {kwh(Math.max(0, c.throughputWithArbKwh - c.throughputNoArbKwh))} extra
                        cycling at {ctPerKwh(cyclingCt)}) — expand for the full model and SOC
                        trajectories.
                      </>
                    )}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* stopPropagation: the whole header toggles the collapsible,
                      so the dialog trigger must not double as a toggle. */}
                  <span onClick={(e) => e.stopPropagation()}>
                    <WearFormulaDialog c={c} cyclingCt={cyclingCt} gridCapKw={gridCapKw} cycles={data.kpis.batteryCycles} />
                  </span>
                  <ChevronDown
                    className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${
                      wearOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <WearFigure
              label="With load shifting (as run)"
              throughputKwh={c.throughputWithArbKwh}
              cost={c.wearWithArb}
              tone="primary"
            />
            <WearFigure
              label="Without load shifting (peak-shaving floor)"
              throughputKwh={c.throughputNoArbKwh}
              cost={c.wearNoArb}
              tone="muted"
            />
            <WearFigure
              label="Extra wear from load shifting"
              throughputKwh={Math.max(0, c.throughputWithArbKwh - c.throughputNoArbKwh)}
              cost={c.arbExtraWear}
              tone="delta"
            />
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="mb-2 text-xs font-medium">How each figure is calculated</p>
            <dl className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <CalcLine
                term="With load shifting"
                expr={`${kwh(c.throughputWithArbKwh)} throughput (measured BMS cycling − ${kwh(c.throughputDiag.deadbandKwh)} idle jitter below 2 kW, which is strategy-independent and excluded from BOTH figures) × ${ctPerKwh(cyclingCt)}`}
                result={eur(c.wearWithArb)}
              />
              <CalcLine
                term="Without load shifting"
                expr={`${kwh(c.throughputNoArbRawKwh)} simulated cycling (peak shaving + re-buy + end SOC true-up) × (1 + ${(c.noArbGapShare * 100).toFixed(0)}% measured BMS→SOC gap) = ${kwh(c.throughputNoArbKwh)} × ${ctPerKwh(cyclingCt)}`}
                result={eur(c.wearNoArb)}
              />
              <CalcLine
                term="Extra from load shifting"
                expr={`${eur(c.wearWithArb)} − ${eur(c.wearNoArb)}`}
                result={`${c.arbExtraWear >= 0 ? "+" : ""}${eur(c.arbExtraWear)}`}
                emphasize
              />
            </dl>
          </div>

          {/* SOC trajectories — the visual evidence behind the wear figures:
              the deeper/more frequent with-arb swings ARE the extra cycling. */}
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">
              Battery state of charge ��� load shifting vs no load shifting
            </p>
            <p className="text-xs text-muted-foreground">
              System SOC across the window. &ldquo;With load shifting&rdquo; is the as-run trajectory
              (the packs swing deeply to buy cheap and shave peaks). &ldquo;No load shifting
              (grid-first)&rdquo; is the counterfactual where the grid serves all demand it can
              (pinned at {gridCapKw.toFixed(0)} kW) and the battery only dips to shave the surplus it
              physically cannot, recharging from spare grid headroom — so it stays close to full.
              Both start from the same SOC.
            </p>
            <ChartContainer config={socConfig} className="h-72 w-full">
              <ComposedChart data={c.socSeries} margin={{ left: 4, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                />
                <YAxis
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_l, payload) => payload?.[0]?.payload?.fullLabel ?? _l}
                      formatter={(value, _name, item) => {
                        const key = String(item?.dataKey ?? "")
                        const v = Number(value)
                        const label =
                          key === "arbSoc" ? "With load shifting" : "No load shifting (grid-first)"
                        return [` ${v.toFixed(0)}%`, label]
                      }}
                    />
                  }
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="noArbSoc"
                  name="No load shifting (grid-first)"
                  stroke="var(--chart-5)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="arbSoc"
                  name="With load shifting (as run)"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ChartContainer>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Note: wear is priced on TOTAL battery movement (Σ|power|·dt from the BMS), not on the
              visible dip depth — a flat-looking line is not an idle battery. Most of the extra{" "}
              {kwh(c.throughputWithArbKwh - c.throughputNoArbKwh)} of throughput ({eur(c.arbExtraWear)}{" "}
              wear at {ctPerKwh(cyclingCt)}) accrues in shallow swings of a few percent SOC — each
              ~1% wiggle on the ~{Math.round(c.totalCapacityKwh)} kWh system is ~
              {Math.round(c.totalCapacityKwh / 100)} kWh of movement, sub-pixel at this axis scale.
              The deep dips are only the largest single contributions, not the whole story.
            </p>

            {/* ── Throughput drill-down: audit the wear integral ─────────────
                Shows the raw BMS power the wear KPI integrates, the cumulative
                Σ|battKw|·dt vs the SOC-implied movement, and the decomposition
                (charge/discharge/idle-deadband). If the BMS integral runs well
                ahead of the SOC-implied one, power that never moved state of
                charge (balancing / aux via inverter / sensor offset) is being
                priced as load shifting cycling — i.e. the extra-wear figure is
                overstated, exactly the suspicion this panel exists to test. */}
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setBattDetailOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                aria-expanded={battDetailOpen}
              >
                {battDetailOpen ? (
                  <ChevronUp className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                )}
                {battDetailOpen ? "Hide throughput details" : "Show throughput details"}
                <span className="font-normal">— how the cycled kWh are integrated</span>
              </button>

              {battDetailOpen && (
                <div className="mt-2 space-y-2 rounded-lg border bg-muted/10 p-3">
                  <div className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3 lg:grid-cols-6">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        BMS throughput
                      </p>
                      <p className="font-semibold tabular-nums">{kwh(c.throughputDiag.bmsKwh)}</p>
                      <p className="text-[10px] text-muted-foreground">Σ|power|·dt (wear basis)</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        SOC-implied
                      </p>
                      <p className="font-semibold tabular-nums">
                        {kwh(c.throughputDiag.socImpliedKwh)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Σ|ΔSOC| × capacity</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Charge / discharge
                      </p>
                      <p className="font-semibold tabular-nums">
                        {kwh(c.throughputDiag.chargeKwh)} / {kwh(c.throughputDiag.dischargeKwh)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        balanced ≈ closed loop cycling
                      </p>
                    </div>
                    {/* Simulated counterfactual split, taken from the same SOC
                        simulation the SOC chart draws: discharge = forced
                        peak-shave, charge = recharge from spare grid headroom
                        as it actually accrues in the sim (headroom-limited, so
                        it can lag the shave and trail slightly at window end). */}
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        No-arb chg / dis (sim.)
                      </p>
                      <p className="font-semibold tabular-nums">
                        {kwh(c.throughputDiag.noArbChargeKwh)} /{" "}
                        {kwh(c.throughputDiag.noArbDischargeKwh)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        SOC sim × {c.noArbOverheadFactor.toFixed(2)} measured overheads
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {"Idle jitter (<2 kW)"}
                      </p>
                      <p className="font-semibold tabular-nums">
                        {kwh(c.throughputDiag.deadbandKwh)}
                        <span className="ml-1 font-normal text-muted-foreground">
                          (
                          {c.throughputDiag.bmsKwh > 0
                            ? Math.round(
                                (c.throughputDiag.deadbandKwh / c.throughputDiag.bmsKwh) * 100,
                              )
                            : 0}
                          %)
                        </span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        accrued below the 2 kW deadband
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        BMS − SOC gap
                      </p>
                      {/* Losses (~10-15%) + sampling cancellation are EXPECTED
                          to sit in this gap, so only flag it red when it
                          exceeds what a ~85% round trip alone would explain
                          AND the idle-jitter share is material. */}
                      <p
                        className={`font-semibold tabular-nums ${
                          c.throughputDiag.bmsKwh - c.throughputDiag.socImpliedKwh >
                            0.3 * c.throughputDiag.bmsKwh &&
                          c.throughputDiag.deadbandKwh > 0.1 * c.throughputDiag.bmsKwh
                            ? "text-destructive"
                            : ""
                        }`}
                      >
                        {kwh(Math.abs(c.throughputDiag.bmsKwh - c.throughputDiag.socImpliedKwh))}
                        <span className="ml-1 font-normal text-muted-foreground">
                          (
                          {c.throughputDiag.bmsKwh > 0
                            ? Math.round(
                                ((c.throughputDiag.bmsKwh - c.throughputDiag.socImpliedKwh) /
                                  c.throughputDiag.bmsKwh) *
                                  100,
                              )
                            : 0}
                          %)
                        </span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        mostly conversion losses + sampling — see note below
                      </p>
                    </div>
                  </div>

                  <ChartContainer config={battDetailConfig} className="h-56 w-full">
                    <ComposedChart data={battDetailWithExtra} margin={{ left: 4, right: 8, top: 8 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      {/* Same "no telemetry" holes as the import chart — the
                          cumulative curves stop at the last frame and resume
                          at the next, never bridging the outage. */}
                      {c.telemetryGaps.map((g, i) => (
                        <ReferenceArea
                          key={`bgap-${i}`}
                          yAxisId="kw"
                          x1={g.x1}
                          x2={g.x2}
                          fill="var(--muted-foreground)"
                          fillOpacity={0.09}
                          stroke="var(--muted-foreground)"
                          strokeOpacity={0.35}
                          strokeDasharray="4 4"
                          label={{
                            value: "no telemetry",
                            position: "center",
                            fontSize: 10,
                            fill: "var(--muted-foreground)",
                          }}
                        />
                      ))}
                      <XAxis
                        dataKey="hour"
                        type="number"
                        domain={importHours}
                        tickFormatter={fmtImportTick}
                        fontSize={10}
                        tickLine={false}
                        minTickGap={56}
                        allowDataOverflow
                      />
                      <YAxis
                        yAxisId="kw"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        width={48}
                        unit="kW"
                      />
                      <YAxis
                        yAxisId="kwh"
                        orientation="right"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        width={48}
                        unit="kWh"
                      />
                      <ReferenceLine
                        yAxisId="kw"
                        y={0}
                        stroke="var(--foreground)"
                        strokeOpacity={0.25}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            labelFormatter={(_l, payload) =>
                              payload?.[0]?.payload?.fullLabel ?? _l
                            }
                            formatter={(value, _name, item) => {
                              const key = String(item?.dataKey ?? "")
                              const v = Number(value)
                              if (key === "battKw")
                                return [
                                  ` ${v.toFixed(2)} kW`,
                                  v >= 0 ? "Battery charging" : "Battery discharging",
                                ]
                              if (key === "cumBmsKwh")
                                return [` ${v.toFixed(1)} kWh`, "Cumulative BMS throughput"]
                              if (key === "cumSocKwh")
                                return [` ${v.toFixed(1)} kWh`, "Cumulative SOC-implied"]
                              if (key === "cumNoArbKwh")
                                return [` ${v.toFixed(1)} kWh`, "Cumulative no-load-shifting (simulated)"]
                              if (key === "extraCyclingKwh")
                                return [
                                  ` ${v >= 0 ? "+" : ""}${v.toFixed(1)} kWh`,
                                  v >= 0 ? "Extra cycling vs baseline" : "Less cycling than baseline",
                                ]
                              return [` ${v.toFixed(1)}`, key]
                            }}
                          />
                        }
                      />
                      {/* THE over-cycling moments: signed gap cumBms − cumNoArb.
                          Red area above zero = pack has been cycled more than
                          the grid-first baseline by that time — its slope marks
                          exactly WHEN the extra wear accrues. */}
                      <Area
                        yAxisId="kwh"
                        dataKey="extraCyclingKwh"
                        name="Extra cycling vs baseline"
                        stroke="var(--destructive)"
                        fill="var(--destructive)"
                        fillOpacity={0.14}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Area
                        yAxisId="kw"
                        dataKey="battKw"
                        name="Battery power (BMS)"
                        stroke="var(--chart-4)"
                        fill="var(--chart-4)"
                        fillOpacity={0.25}
                        strokeWidth={1}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="kwh"
                        dataKey="cumBmsKwh"
                        name="Cumulative BMS throughput"
                        stroke="var(--chart-1)"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="kwh"
                        dataKey="cumSocKwh"
                        name="Cumulative SOC-implied"
                        stroke="var(--chart-2)"
                        strokeWidth={2}
                        strokeDasharray="5 3"
                        dot={false}
                        isAnimationActive={false}
                      />
                      {/* the comparison the wear KPI actually makes: the simulated
                          grid-first throughput accumulating on the same axis */}
                      <Line
                        yAxisId="kwh"
                        dataKey="cumNoArbKwh"
                        name="Cumulative no-load-shifting (simulated)"
                        stroke="var(--chart-5)"
                        strokeWidth={2}
                        strokeDasharray="2 3"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Legend />
                    </ComposedChart>
                  </ChartContainer>

                  <div className="space-y-1.5 text-[10px] leading-relaxed text-muted-foreground">
                    <p className="text-pretty">
                      How to read this, in order: <span className="text-foreground">(a)</span> the
                      shaded trace is the raw signed BMS power the wear KPI integrates (charge
                      above zero, discharge below); the{" "}
                      <span className="text-destructive">red band</span> is the running gap
                      &ldquo;as-run − baseline&rdquo; cycling: wherever its slope rises, load
                      shifting is wearing the pack MORE than a grid-first device would at that
                      exact moment (below zero = less);{" "}
                      <span className="text-foreground">(b)</span>{" "}
                      the solid line accumulates Σ|power|·dt — the exact &ldquo;with
                      load shifting&rdquo; wear basis, ending at {kwh(c.throughputDiag.bmsKwh)};{" "}
                      <span className="text-foreground">(c)</span> the dotted line is the SIMULATED
                      no-load-shifting throughput, accumulated from the same SOC simulation drawn on
                      the chart above: forced peak-shave discharge at shave time, recharge as the
                      spare grid headroom actually allows — so it climbs during BOTH the dip and
                      the recovery of the grid-first SOC trace, ending at{" "}
                      {kwh(c.throughputDiag.noArbDischargeKwh + c.throughputDiag.noArbChargeKwh)}{" "}
                      — both this line and the wear KPI&apos;s {kwh(c.throughputNoArbKwh)} carry
                      the measured ×(1 + {(c.noArbGapShare * 100).toFixed(0)}% BMS−SOC gap)
                      overhead; idle jitter ({kwh(c.throughputDiag.deadbandKwh)} below 2 kW) is
                      strategy-independent and EXCLUDED from both wear bases, differing only in WHEN
                      the recharge is booked (per-frame here, at shave time in the KPI). The
                      vertical gap between
                      (b) and (c) at the right edge IS the extra-cycling claim, and you can see
                      exactly WHICH hours created it: wherever the solid line climbs but the dotted
                      line stays flat, the battery was moving energy the grid-first world would not
                      have moved. <span className="text-foreground">(d)</span> the dashed
                      SOC-implied line (Σ|ΔSOC| × ~{Math.round(c.totalCapacityKwh)} kWh) is the
                      plausibility check on (b).
                    </p>
                    <p className="text-pretty">
                      A BMS−SOC gap is NOT automatically phantom wear — it has three expected
                      components, in order of size: <span className="text-foreground">(1)
                      conversion losses</span> — power is metered at the terminals but SOC only
                      registers what lands in the cells, so a ~90% one-way efficiency alone makes
                      the dashed line run ~10–15% low across every real cycle; <span
                      className="text-foreground">(2) sampling cancellation</span> — this panel
                      integrates the downsampled report series, and any swing that goes down and
                      back up between two SOC samples cancels out of |ΔSOC| while Σ|power|·dt still
                      counts it (short deep bursts, like forced peak-shaves, land here);{" "}
                      <span className="text-foreground">(3) idle-state activity</span> — balancing
                      / aux / sensor offset, which the &ldquo;idle jitter&rdquo; stat above bounds
                      directly. Only (3) is arguably mis-billed wear; if the jitter share is a few
                      percent, the wear figure is honest and the gap is losses + sampling.
                    </p>
                    <p className="text-pretty">
                      Fairness: SOC-implied is never used to price wear directly — but its MEASURED
                      overheads feed the baseline. The &ldquo;without load shifting&rdquo; figure is
                      the simulated cycling ({kwh(c.throughputNoArbRawKwh)}: peak shaving + re-buy +
                      end SOC true-up) × (1 + {(c.noArbGapShare * 100).toFixed(1)}% measured
                      BMS−SOC gap: losses + sampling). Idle balancing jitter (
                      {kwh(c.throughputDiag.deadbandKwh)} below 2 kW) happens around the clock
                      regardless of strategy, so it is EXCLUDED from both wear figures — neither
                      billed to load shifting nor to the baseline. Whatever overheads the real
                      hardware demonstrably pays on real energy movement, the counterfactual
                      battery pays identically — neither world cycles cleaner than the physical
                      system.
                    </p>
                    <p className="text-pretty">
                      Charge ≈ discharge means closed-loop cycling (energy went out and came back —
                      the packs ended where they started); a large imbalance would instead indicate
                      one-way drift. Totals here can differ a few percent from the full-resolution
                      wear KPI ({kwh(c.throughputWithArbKwh)}) because of the downsampling.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Daily comparison chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daily cost — flat vs IDM-indexed</CardTitle>
          <CardDescription>
            Cost of grid import each day under both tariffs (bars, left scale, €), with the
            energy-weighted average IDM intraday price for context (line, right scale, ct/kWh).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-72 w-full">
            <ComposedChart data={c.days} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                yAxisId="eur"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(v) => `€${v.toFixed(0)}`}
              />
              <YAxis
                yAxisId="ct"
                orientation="right"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v) => `${v.toFixed(0)} ct`}
                label={{
                  value: "ct/kWh",
                  angle: 90,
                  position: "insideRight",
                  fontSize: 11,
                  fill: "var(--muted-foreground)",
                  offset: -2,
                }}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, _name, item) => {
                      // recharts passes the series display `name`; key off the
                      // stable dataKey instead so each row is labelled correctly.
                      const key = String(item?.dataKey ?? "")
                      const v = Number(value)
                      if (key === "idmWeightedCt") return [` ${ctPerKwh(v)}`, "Avg IDM price"]
                      return [` ${eur2(v)}`, key === "flatCost" ? "Flat rate" : "IDM-indexed tariff"]
                    }}
                  />
                }
              />
              <Legend />
              <Bar
                yAxisId="eur"
                dataKey="flatCost"
                name="Flat rate"
                fill="var(--chart-5)"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                yAxisId="eur"
                dataKey="dynamicCost"
                name="IDM-indexed tariff"
                fill="var(--chart-1)"
                radius={[3, 3, 0, 0]}
              />
              <Line
                yAxisId="ct"
                type="monotone"
                dataKey="idmWeightedCt"
                name="Avg IDM"
                stroke="var(--chart-3)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ChartContainer>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            Flat cost = imported kWh × flat rate. IDM-indexed cost = Σ (slot import × (slot market
            price + fixed adder)), priced per 15-min slot: the live IDM intraday price where
            published, otherwise the DAM day-ahead price for that slot. Flat-rate billing is
            identical regardless of hour.
          </p>
        </CardContent>
      </Card>


    </div>
  )
}

/**
 * Compact supporting stat rendered inside the hero panel's segmented grid.
 * Borderless (the grid draws hairline dividers via `gap-px` on a bordered
 * parent) so the three context figures read as one unit beneath the headline
 * saving rather than competing four-up cards.
 */
/**
 * "Does this page agree with the Fleet reports?" — answered on the page.
 *
 * - Fleet month window + frozen row present  → green: identical to the cent
 *   (or amber with the difference — which would mean a stale row, since both
 *   sides run lib/settlement; the nightly cron refreshes it).
 * - Fleet month window, no row yet            → neutral: not frozen yet.
 * - Any other window                          → renders nothing.
 *
 * There is no what-if branch: settlement parameters are fixed by the Annex and
 * not editable anywhere, so this page can only ever show settlement figures.
 */
function ReconciliationNote({
  reconciliation,
  stationLabel,
  liveNet,
  liveLs,
}: {
  reconciliation: Reconciliation | null
  stationLabel: string
  liveNet: number
  liveLs: number
}) {
  if (!reconciliation) return null
  const { month, fleet, matches, maxDiffEur } = reconciliation
  const label = fleetMonthLabel(month)
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${eur(Math.abs(v))}`
  if (!fleet) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-dashed px-3.5 py-2.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <p className="text-pretty">
          <span className="font-semibold text-foreground">Fleet Monthly · {label}</span> — this station-month is
          not frozen into the fleet reports yet (the nightly build adds it). It will use exactly this
          computation.
        </p>
      </div>
    )
  }
  const ok = matches === true
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-lg border px-3.5 py-2.5 text-xs ${
        ok
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300"
          : "border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-300"
      }`}
    >
      <div className="flex items-start gap-2">
        {ok ? <ShieldCheck className="mt-0.5 size-4 shrink-0" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0" />}
        <p className="text-pretty">
          <span className="font-semibold">Fleet Monthly · {label} · {stationLabel}</span>
          <span className="ml-1.5 tabular-nums">
            net {signed(fleet.netEur)} · load shifting {signed(fleet.lsEur)}
          </span>
          {ok ? (
            <span className="ml-1.5">— identical to this report.</span>
          ) : (
            <span className="ml-1.5">
              — differs from this report by {eur(maxDiffEur ?? 0)} (live {signed(liveNet)} / {signed(liveLs)}).
              The frozen row predates the latest data or methodology; the nightly build refreshes it.
            </span>
          )}
        </p>
      </div>
      <Link
        href={`/fleet-reports/monthly?month=${month}`}
        className="shrink-0 font-medium underline-offset-2 hover:underline"
      >
        Open Fleet Monthly
      </Link>
    </div>
  )
}

function HeroStat({
  icon,
  label,
  term,
  value,
  sub,
  highlight = false,
  tone = "neutral",
}: {
  icon: React.ReactNode
  label: string
  /** Annex glossary key — adds the shared definition tooltip (lib/report-definitions). */
  term?: ReportTermKey
  value: string
  sub?: string
  highlight?: boolean
  tone?: "neutral" | "positive" | "negative"
}) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-600"
      : tone === "negative"
        ? "text-amber-600"
        : highlight
          ? "text-primary"
          : "text-foreground"
  return (
    <div
      className={`flex flex-col gap-1 bg-card p-3.5 ${
        highlight
          ? tone === "negative"
            ? "ring-1 ring-inset ring-amber-500/25"
            : "ring-1 ring-inset ring-emerald-500/25"
          : ""
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {term ? <TermLabel term={term}>{label}</TermLabel> : label}
      </div>
      <span className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</span>
      {sub ? <span className="text-[11px] text-muted-foreground tabular-nums">{sub}</span> : null}
    </div>
  )
}

function CalcLine({
  term,
  expr,
  result,
  emphasize,
}: {
  term: string
  expr: string
  result: string
  emphasize?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 font-medium text-foreground">{term}</dt>
      <dd className="flex-1 text-right text-pretty">
        <span className="text-muted-foreground">{expr}</span>{" "}
        <span className={`tabular-nums ${emphasize ? "font-semibold text-amber-600" : "font-medium text-foreground"}`}>
          = {result}
        </span>
      </dd>
    </div>
  )
}

/**
 * "Show formula" popup: the exact wear-cost math with every number
 * substituted, so the figure can be audited at a glance without expanding
 * the full wear panel. eur2 (cent precision) is used so the difference line
 * visibly reconciles: wearWithArb − wearNoArb = arbExtraWear.
 */
function WearFormulaDialog({
  c,
  cyclingCt,
  gridCapKw,
  cycles,
}: {
  c: {
    throughputWithArbKwh: number
    throughputNoArbKwh: number
    throughputNoArbRawKwh: number
    noArbJitterShare: number
    noArbGapShare: number
    noArbOverheadFactor: number
    throughputDiag: { deadbandKwh: number }
    wearWithArb: number
    wearNoArb: number
    arbExtraWear: number
  }
  cyclingCt: number
  gridCapKw: number
  cycles: number
}) {
  const rate = cyclingCt / 100 // €/kWh
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs bg-transparent">
          <Gauge className="size-3.5" />
          Show formula
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>How battery wear cost is calculated</DialogTitle>
          <DialogDescription>
            Every number below is from this report window — nothing is estimated outside the
            engine&apos;s own telemetry.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              General formula
            </p>
            <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
              <p>throughput = Σ |P_battery| · Δt {"  "}(charge + discharge, every frame)</p>
              <p className="mt-1">wear € = throughput (kWh) × {ctPerKwh(cyclingCt)}</p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Throughput is bidirectional: 1 kWh delivered to a car costs ~2 kWh of throughput
              (charge in + discharge out), so the effective rate is {ctPerKwh(cyclingCt * 2)} per
              delivered kWh. The rate is the same per-direction degradation cost the optimizer
              plans against — report and dispatch decisions never disagree.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              1 · With load shifting (as run)
            </p>
            <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
              <p>
                {c.throughputWithArbKwh.toFixed(1)} kWh × {rate.toFixed(3)} €/kWh ={" "}
                <span className="font-semibold text-foreground">{eur2(c.wearWithArb)}</span>
              </p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Measured battery throughput from the engine minus{" "}
              {c.throughputDiag.deadbandKwh.toFixed(1)} kWh of idle jitter (balancing/aux churn
              below the 2 kW deadband — it runs around the clock regardless of strategy, so it is
              excluded from BOTH wear figures). ≈ {cycles} full cycles of real energy movement.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              2 · Without load shifting (counterfactual floor)
            </p>
            <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
              <p>
                {c.throughputNoArbRawKwh.toFixed(1)} kWh simulated cycling (peak shaving + re-buy
                + end SOC true-up)
              </p>
              <p className="mt-1">
                × (1 + {(c.noArbGapShare * 100).toFixed(1)}% BMS−SOC gap) ={" "}
                {c.throughputNoArbKwh.toFixed(1)} kWh
              </p>
              <p className="mt-1">
                {c.throughputNoArbKwh.toFixed(1)} kWh × {rate.toFixed(3)} €/kWh ={" "}
                <span className="font-semibold text-foreground">{eur2(c.wearNoArb)}</span>
              </p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Only unavoidable cycling: the grid pinned at {gridCapKw.toFixed(0)} kW serves all it
              can, the battery discharges solely for EV demand above that cap (every shaved kWh
              must be recharged), and the window closes with a true-up to the measured end SOC.
              That simulated figure then carries the MEASURED {(c.noArbGapShare * 100).toFixed(1)}%
              BMS−SOC gap (conversion losses + sampling) from this same window — a bare simulation
              would let the counterfactual cycle overhead-free and overstate the extra wear billed
              to load shifting. Idle jitter is excluded here exactly as it is in figure 1, so the
              comparison is symmetric.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              3 · Difference — extra wear charged to load shifting
            </p>
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 font-mono text-xs leading-relaxed">
              <p>
                {eur2(c.wearWithArb)} − {eur2(c.wearNoArb)} ={" "}
                <span className="font-semibold text-amber-600">
                  {c.arbExtraWear >= 0 ? "+" : ""}
                  {eur2(c.arbExtraWear)}
                </span>
              </p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              This difference is what the net-saving figure deducts from the gross energy saving:
              the flat tariff carries the floor wear ({eur2(c.wearNoArb)}), the dynamic tariff
              carries the as-run wear ({eur2(c.wearWithArb)}), so only the extra cycling caused by
              load shifting counts against the strategy.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function WearFigure({
  label,
  throughputKwh,
  cost,
  tone,
}: {
  label: string
  throughputKwh: number
  cost: number
  tone: "primary" | "muted" | "delta"
}) {
  const valueClass =
    tone === "primary" ? "text-foreground" : tone === "delta" ? "text-amber-600" : "text-muted-foreground"
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-muted/20 px-3 py-3">
      <span className="text-xs text-muted-foreground text-pretty">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${valueClass}`}>
        {tone === "delta" && cost > 0 ? "+" : ""}
        {eur(cost)}
      </span>
      <span className="text-[11px] text-muted-foreground tabular-nums">{kwh(throughputKwh)} cycled</span>
    </div>
  )
}

function BreakdownRow({
  icon,
  label,
  term,
  detail,
  flat,
  dynamic,
  signed = false,
}: {
  icon: React.ReactNode
  label: string
  /** Annex glossary key — adds the shared definition tooltip (lib/report-definitions). */
  term?: ReportTermKey
  detail: string
  flat: number
  dynamic: number
  signed?: boolean
}) {
  // For signed (credit/cost) rows, show a leading + or − and tint credits.
  const fmt = (v: number) => {
    if (!signed) return eur(v)
    const sign = v >= 0 ? "+" : "−"
    return `${sign}${eur(Math.abs(v))}`
  }
  const toneClass = signed && dynamic < 0 ? "text-emerald-600" : "text-foreground"
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <div>
            <div className="font-medium text-foreground">
              {term ? <TermLabel term={term}>{label}</TermLabel> : label}
            </div>
            <div className="text-[11px] text-muted-foreground">{detail}</div>
          </div>
        </div>
      </td>
      <td className={`px-3 py-2.5 text-right ${toneClass}`}>{fmt(flat)}</td>
      <td className={`px-3 py-2.5 text-right ${toneClass}`}>{fmt(dynamic)}</td>
    </tr>
  )
}

/** Read-only cell in the settlement-parameters grid: label + the Annex value. */
function AssumptionStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-card p-3.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}
