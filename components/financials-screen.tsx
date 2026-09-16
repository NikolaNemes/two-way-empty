"use client"

import { useMemo, useState } from "react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { NumericField } from "@/components/numeric-field"
import { useSimulation } from "@/lib/simulation-store"
import { PageHeader } from "@/components/page-header"
import { SourcesCitation } from "@/components/sources-citation"
import { EnergyRequestedTooltip } from "@/components/energy-requested-tooltip"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Bar,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Area,
  Legend,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { minuteToTimeStr, buildPvProfile1Min, aggregate15Min } from "@/lib/disaggregate"
import {
  Euro,
  Info,
  ArrowDownToLine,
  ArrowUpFromLine,
  Sun,
  Car,
  Battery,
  Zap,
  Gauge,
  TrendingUp,
  TrendingDown,
  Shield,
  Clock,
  BarChart3,
  BarChart2,
  Table2,
} from "lucide-react"

// ── Helpers ──
function fmtCt(v: number): string {
  return (v * 100).toFixed(2)
}
function fmtEur(v: number): string {
  return v.toFixed(2)
}
  function formatHour(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`
  }
  function formatSlot(slotIdx: number): string {
    const h = Math.floor(slotIdx / 4)
    const m = (slotIdx % 4) * 15
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
  }

// ═══════════════════════════════════════════════
// TAB 1: OVERVIEW DASHBOARD
// ═══════════════════════════════════════════════

function OverviewDashboard() {
  const { gridPricing, siteSetup, chargingSessions, gridExport } = useSimulation()
  const { epexSpotPrices, gridFeesAndTaxes, retailPricePerKwh } = gridPricing
  const { wear, battery, pv, grid } = siteSetup

  const pvProfile1Min = useMemo(() => buildPvProfile1Min(pv), [pv])

  const overview = useMemo(() => {
    // ─── COSTS ─── (96 x 15-min slots)
    const slotCount = epexSpotPrices.length // 96
    const avgEpex = epexSpotPrices.reduce((a, b) => a + b, 0) / slotCount
    const avgProcurement = avgEpex + gridFeesAndTaxes
    const minProcurement = Math.min(...epexSpotPrices) + gridFeesAndTaxes
    const maxProcurement = Math.max(...epexSpotPrices) + gridFeesAndTaxes

    // Demand charge (annual, daily)
    const demandChargeAnnual = grid.gridConnectionLimit * gridPricing.annualDemandCharge
    const demandChargeDaily = grid.gridConnectionLimit * gridPricing.dailyDemandCharge

    // Battery wear (daily max)
    const dailyWearCost = wear.maxDailyDischarge * wear.wearCostPerKwh

    // ─── INCOME ───
    const totalKwhRequested = chargingSessions.reduce((s, c) => s + c.energyRequestedKwh, 0)
    const maxGrossRevenue = totalKwhRequested * retailPricePerKwh

    // PV savings (ideal) -- iterate 15-min slots, sum 1-min PV within each
    let pvTotalKwh = 0
    let pvSavingsEur = 0
    for (let s = 0; s < slotCount; s++) {
      const proc = (epexSpotPrices[s] ?? 0) + gridFeesAndTaxes
      const startMin = s * 15
      const endMin = startMin + 15
      for (let m = startMin; m < endMin; m++) {
        const kwh = pvProfile1Min[m] / 60
        pvTotalKwh += kwh
        pvSavingsEur += kwh * proc
      }
    }

    // Grid export revenue
    let avgExportRate = 0
    if (gridExport.mechanism === "eeg-surplus") avgExportRate = gridExport.eegFeedInTariff
    else if (gridExport.mechanism === "direktvermarktung") avgExportRate = Math.max(avgEpex - gridExport.aggregatorFee, 0)
    else avgExportRate = Math.max(avgEpex - gridExport.gridExportFee, 0)

    // ─── MARGINS ───
    // Best case: all kWh from PV (zero procurement)
    const pvMarginPerKwh = retailPricePerKwh
    // Grid-sourced margin (avg)
    const gridMarginPerKwh = retailPricePerKwh - avgProcurement
    // Battery-assisted (grid margin minus wear)
    const batteryMarginPerKwh = gridMarginPerKwh - wear.wearCostPerKwh

    // Total cost estimate (daily)
    const maxGridCost = totalKwhRequested * avgProcurement // worst case: all from grid
    const totalDailyCost = maxGridCost + demandChargeDaily + dailyWearCost
    const netDailyProfit = maxGrossRevenue - totalDailyCost + pvSavingsEur

    return {
      avgProcurement, minProcurement, maxProcurement,
      demandChargeAnnual, demandChargeDaily,
      dailyWearCost, annualWearCost: dailyWearCost * 365,
      totalKwhRequested, maxGrossRevenue,
      pvTotalKwh: Math.round(pvTotalKwh * 10) / 10,
      pvSavingsEur: Math.round(pvSavingsEur * 100) / 100,
      avgExportRate,
      pvMarginPerKwh, gridMarginPerKwh, batteryMarginPerKwh,
      totalDailyCost, netDailyProfit,
    }
  }, [epexSpotPrices, gridFeesAndTaxes, retailPricePerKwh, wear, battery, pv, grid, chargingSessions, gridExport, pvProfile1Min, gridPricing])

  // Waterfall chart data with formulas for tooltip
  const waterfallData = useMemo(() => [
    {
      name: "EV Revenue",
      value: overview.maxGrossRevenue,
      fill: "var(--chart-1)",
      formula: `${overview.totalKwhRequested.toFixed(1)} kWh * ${fmtCt(retailPricePerKwh)} ct/kWh`,
      explanation: "Total energy requested by all EV sessions * flat retail price per kWh",
      inputs: [
        { label: "Energy requested", value: `${overview.totalKwhRequested.toFixed(1)} kWh`, detail: `SUM of ${chargingSessions.length} sessions` },
        { label: "Retail price", value: `${fmtCt(retailPricePerKwh)} ct/kWh`, detail: "Flat ad-hoc rate" },
      ],
    },
    {
      name: "PV Savings",
      value: overview.pvSavingsEur,
      fill: "var(--chart-3)",
      formula: `SUM(PV_kWh(h) * Procurement(h)) over 24h`,
      explanation: "Each kWh from PV avoids buying from grid at that hour's procurement cost",
      inputs: [
        { label: "PV energy (charger share)", value: `${overview.pvTotalKwh} kWh`, detail: `${pv.chargerSharePercent}% of ${pv.installedCapacityKwp} kWp` },
        { label: "Avg avoided cost", value: `${overview.pvTotalKwh > 0 ? fmtCt(overview.pvSavingsEur / overview.pvTotalKwh) : "0"} ct/kWh`, detail: "Weighted avg EPEX + fees" },
      ],
    },
    {
      name: "Grid Import",
      value: -(overview.totalKwhRequested * overview.avgProcurement),
      fill: "var(--chart-2)",
      formula: `${overview.totalKwhRequested.toFixed(1)} kWh * ${fmtCt(overview.avgProcurement)} ct/kWh`,
      explanation: "Worst case: all energy sourced from grid at average procurement cost",
      inputs: [
        { label: "Energy from grid", value: `${overview.totalKwhRequested.toFixed(1)} kWh`, detail: "Assumes 100% grid (worst case)" },
        { label: "Avg EPEX Spot", value: `${fmtCt(epexSpotPrices.reduce((a, b) => a + b, 0) / epexSpotPrices.length)} ct/kWh`, detail: "96-slot average" },
        { label: "Grid fees & taxes", value: `${fmtCt(gridFeesAndTaxes)} ct/kWh`, detail: "Netzentgelt, Stromsteuer, etc." },
        { label: "Total procurement", value: `${fmtCt(overview.avgProcurement)} ct/kWh`, detail: "EPEX + fees" },
      ],
    },
    {
      name: "Demand Charge",
      value: -overview.demandChargeDaily,
      fill: "var(--destructive)",
      formula: `${grid.gridConnectionLimit} kW * ${gridPricing.annualDemandCharge} EUR/kW/yr / 365`,
      explanation: "Annual Leistungspreis allocated to one day based on peak grid connection",
      inputs: [
        { label: "Grid connection", value: `${grid.gridConnectionLimit} kW`, detail: "Peak 15-min draw limit" },
        { label: "Leistungspreis", value: `${gridPricing.annualDemandCharge} EUR/kW/yr`, detail: "Annual demand charge rate" },
        { label: "Daily allocation", value: `${fmtEur(overview.demandChargeDaily)} EUR/day`, detail: `${gridPricing.annualDemandCharge} / 365` },
      ],
    },
    {
      name: "Battery Wear",
      value: -overview.dailyWearCost,
      fill: "hsl(30 80% 55%)",
      formula: `${wear.maxDailyDischarge} kWh * ${fmtCt(wear.wearCostPerKwh)} ct/kWh`,
      explanation: "Maximum daily battery cycling * degradation cost per kWh discharged",
      inputs: [
        { label: "Max daily discharge", value: `${wear.maxDailyDischarge} kWh`, detail: `${(wear.maxDailyDischarge / battery.usableCapacityKwh).toFixed(1)} full cycles` },
        { label: "Wear cost", value: `${fmtCt(wear.wearCostPerKwh)} ct/kWh`, detail: `From ${wear.totalCycleLife} cycle lifetime` },
        { label: "Battery capacity", value: `${battery.usableCapacityKwh} kWh usable`, detail: `${battery.nominalCapacityKwh} kWh nominal` },
      ],
    },
  ], [overview, retailPricePerKwh, chargingSessions.length, pv, epexSpotPrices, gridFeesAndTaxes, grid, gridPricing, wear, battery])

  // Margin comparison bars
  const marginBars = useMemo(() => [
    { source: "PV-sourced", margin: overview.pvMarginPerKwh, fill: "var(--chart-3)" },
    { source: "Grid (direct)", margin: overview.gridMarginPerKwh, fill: "var(--chart-1)" },
    { source: "Grid + Battery", margin: overview.batteryMarginPerKwh, fill: "var(--chart-2)" },
    { source: "Grid Export", margin: overview.avgExportRate, fill: "var(--chart-5)" },
  ], [overview])

  return (
    <div className="space-y-6">
      {/* ── Cost vs Income Summary ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* INCOME side */}
        <Card className="border-chart-3/30">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-chart-3" />
              <CardTitle className="text-sm">Daily Income (Max)</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">EV Charging Revenue</span>
              <span className="font-mono font-bold text-chart-1">{fmtEur(overview.maxGrossRevenue)} EUR</span>
            </div>
            <div className="text-[10px] text-muted-foreground ml-2">
              {overview.totalKwhRequested.toFixed(1)} kWh * {fmtCt(retailPricePerKwh)} ct/kWh flat rate
            </div>
            <div className="ml-2">
              <EnergyRequestedTooltip
                sessions={chargingSessions}
                totalKwh={overview.totalKwhRequested}
                variant="compact"
              />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">PV Savings (ideal)</span>
              <span className="font-mono font-bold text-chart-3">{fmtEur(overview.pvSavingsEur)} EUR</span>
            </div>
            <div className="text-[10px] text-muted-foreground ml-2">
              {overview.pvTotalKwh} kWh PV * avg {fmtCt(overview.avgProcurement)} ct avoided procurement
            </div>
            <div className="border-t pt-2 flex items-baseline justify-between">
              <span className="text-sm font-medium">Total Daily Income</span>
              <span className="text-lg font-mono font-bold text-chart-3">
                {fmtEur(overview.maxGrossRevenue + overview.pvSavingsEur)} EUR
              </span>
            </div>
          </CardContent>
        </Card>

        {/* COST side */}
        <Card className="border-destructive/30">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="size-4 text-destructive" />
              <CardTitle className="text-sm">Daily Costs (Max)</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Grid Import (avg procurement)</span>
              <span className="font-mono font-bold text-chart-2">
                {fmtEur(overview.totalKwhRequested * overview.avgProcurement)} EUR
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground ml-2">
              {overview.totalKwhRequested.toFixed(1)} kWh * avg {fmtCt(overview.avgProcurement)} ct/kWh (EPEX + fees)
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Demand Charge (Leistungspreis)</span>
              <span className="font-mono font-bold text-destructive">{fmtEur(overview.demandChargeDaily)} EUR</span>
            </div>
            <div className="text-[10px] text-muted-foreground ml-2">
              {grid.gridConnectionLimit} kW peak * {gridPricing.dailyDemandCharge} EUR/kW/day
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Battery Wear</span>
              <span className="font-mono font-bold" style={{ color: "hsl(30 80% 55%)" }}>{fmtEur(overview.dailyWearCost)} EUR</span>
            </div>
            <div className="text-[10px] text-muted-foreground ml-2">
              {wear.maxDailyDischarge} kWh max discharge * {fmtCt(wear.wearCostPerKwh)} ct/kWh wear
            </div>
            <div className="border-t pt-2 flex items-baseline justify-between">
              <span className="text-sm font-medium">Total Daily Cost</span>
              <span className="text-lg font-mono font-bold text-destructive">
                {fmtEur(overview.totalDailyCost)} EUR
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Net Daily P&L */}
      <Card className={overview.netDailyProfit >= 0 ? "border-chart-3/40 bg-chart-3/5" : "border-destructive/40 bg-destructive/5"}>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Net Daily P&L (Estimated Max)</p>
              <p className="text-xs text-muted-foreground">Income - Costs (worst case: all energy from grid, max cycling)</p>
            </div>
            <div className="text-right">
              <p className={`text-2xl font-mono font-bold ${overview.netDailyProfit >= 0 ? "text-chart-3" : "text-destructive"}`}>
                {overview.netDailyProfit >= 0 ? "+" : ""}{fmtEur(overview.netDailyProfit)} EUR/day
              </p>
              <p className="text-xs text-muted-foreground font-mono">
                ~{overview.netDailyProfit >= 0 ? "+" : ""}{fmtEur(overview.netDailyProfit * 365)} EUR/year
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Waterfall Chart: Daily P&L Components ── */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            <div>
              <CardTitle className="text-base">Daily P&L Waterfall</CardTitle>
              <CardDescription>Revenue and savings vs costs -- each component's daily EUR contribution</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterfallData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                <YAxis
                  tickLine={false} axisLine={false} tick={{ fontSize: 10 }}
                  tickFormatter={(v) => `${v.toFixed(0)}`}
                  width={40}
                  label={{ value: "EUR", angle: -90, position: "insideLeft", offset: 5, style: { fontSize: 10, fill: "var(--color-muted-foreground)" } }}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null
                    const d = payload[0].payload as (typeof waterfallData)[0]
                    return (
                      <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm max-w-72">
                        <p className="font-semibold text-foreground">{d.name}</p>
                        <p className={`font-mono font-bold text-sm mt-0.5 ${d.value >= 0 ? "text-chart-3" : "text-destructive"}`}>
                          {d.value >= 0 ? "+" : ""}{fmtEur(d.value)} EUR/day
                        </p>
                        <p className="text-muted-foreground mt-1.5 leading-relaxed">{d.explanation}</p>
                        <div className="mt-2 rounded bg-muted/50 p-2 font-mono text-[10px]">
                          <p className="text-muted-foreground mb-1">Formula:</p>
                          <p className="text-foreground">{d.formula}</p>
                        </div>
                        <div className="mt-2 space-y-1">
                          {d.inputs.map((inp, i) => (
                            <div key={i} className="flex justify-between gap-3">
                              <span className="text-muted-foreground truncate">{inp.label}</span>
                              <span className="font-mono font-medium text-foreground shrink-0">{inp.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {waterfallData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* ── Per-kWh Margin by Source ── */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-2">
            <Euro className="size-4 text-primary" />
            <div>
              <CardTitle className="text-base">Per-kWh Margin by Energy Source</CardTitle>
              <CardDescription>
                How much the CPO earns per kWh depending on where the energy comes from
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="space-y-3">
            {marginBars.map((row) => {
              const pct = (row.margin / retailPricePerKwh) * 100
              return (
                <div key={row.source} className="space-y-1">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium text-foreground">{row.source}</span>
                    <span className="font-mono">{fmtCt(row.margin)} ct/kWh ({Math.round(pct)}% of retail)</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(Math.min(pct, 100), 0)}%`,
                        backgroundColor: row.fill,
                        opacity: 0.8,
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {row.source === "PV-sourced" && `Retail ${fmtCt(retailPricePerKwh)}ct - 0 procurement = full margin`}
                    {row.source === "Grid (direct)" && `Retail ${fmtCt(retailPricePerKwh)}ct - avg procurement ${fmtCt(overview.avgProcurement)}ct`}
                    {row.source === "Grid + Battery" && `Retail ${fmtCt(retailPricePerKwh)}ct - procurement ${fmtCt(overview.avgProcurement)}ct - wear ${fmtCt(wear.wearCostPerKwh)}ct`}
                    {row.source === "Grid Export" && `EPEX/Direktvermarktung revenue only -- opportunity cost vs ${fmtCt(retailPricePerKwh)}ct retail`}
                  </p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Margin Over Day (15-min) ── */}
      <MarginChart />
    </div>
  )
}

// ═══════════════════════════════════════════════
// TAB 2: COST DETAILS
// ═══════════════════════════════════════════════

// 1. Grid Import Cost (Dynamic Tariff)
function GridImportCostSection() {
  const { gridPricing, updateGridPricing, siteSetup } = useSimulation()
  const { epexSpotPrices, gridFeesAndTaxes } = gridPricing
  const gridLimit = siteSetup.grid.gridConnectionLimit

  const stats = useMemo(() => {
    const procs = epexSpotPrices.map((p) => p + gridFeesAndTaxes)
    return {
      minEpex: Math.min(...epexSpotPrices),
      maxEpex: Math.max(...epexSpotPrices),
      avgEpex: epexSpotPrices.reduce((a, b) => a + b, 0) / epexSpotPrices.length,
      minProc: Math.min(...procs),
      maxProc: Math.max(...procs),
      avgProc: procs.reduce((a, b) => a + b, 0) / procs.length,
      spread: Math.max(...procs) - Math.min(...procs),
    }
  }, [epexSpotPrices, gridFeesAndTaxes])

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-chart-2/10">
            <ArrowDownToLine className="size-4 text-chart-2" />
          </div>
          <div>
            <CardTitle className="text-base">Grid Import Cost (Dynamic Tariff)</CardTitle>
            <CardDescription>
              CPO purchases electricity at hourly EPEX SPOT DAM price + fixed grid fees
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-xs text-muted-foreground">
          <p>
            As a commercial CPO with 37+ chargers, you operate under a{" "}
            <strong className="text-foreground">dynamic electricity supply contract</strong> (Dynamischer Stromtarif).
            Since January 2025, every German energy supplier must offer at least one dynamic tariff
            to commercial customers (EnWG 41a). Your procurement cost each hour:
          </p>
          <div className="rounded bg-background p-3 font-mono text-[11px]">
            <p>{'Procurement(h) = EPEX_SPOT_DAM(h) + Grid_Fees_and_Taxes'}</p>
            <p className="mt-1 text-muted-foreground">
              {'where Grid_Fees_and_Taxes = Netzentgelt + Stromsteuer + Konzessionsabgabe + Umlagen'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <p className="text-[10px] text-muted-foreground">Grid fees breakdown (approx.)</p>
              <ul className="text-[10px] mt-1 space-y-0.5">
                <li>Netzentgelt (network fee): ~7 ct/kWh</li>
                <li>Stromsteuer (electricity tax): ~2.05 ct/kWh</li>
                <li>Konzessionsabgabe (concession): ~1.5 ct/kWh</li>
                <li>Umlagen (EEG, KWKG, etc.): ~1.5 ct/kWh</li>
              </ul>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">EPEX SPOT DAM pattern</p>
              <ul className="text-[10px] mt-1 space-y-0.5">
                <li>Overnight (00-05): low demand, moderate</li>
                <li>Midday (10-15): solar surplus, cheap</li>
                <li>Evening (17-20): peak demand, expensive</li>
                <li>Summer Saturdays: strong solar dip at noon</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <NumericField
            label="Grid Fees & Taxes (fixed component)"
            value={gridPricing.gridFeesAndTaxes}
            unit="EUR/kWh"
            onChange={(v) => updateGridPricing({ gridFeesAndTaxes: v })}
            step={0.01}
            min={0}
            hint="Netzentgelt + Stromsteuer + Konzession + Umlagen"
          />
          <div className="rounded-md bg-muted p-3 flex flex-col justify-center">
            <p className="text-xs text-muted-foreground">Procurement range today</p>
            <p className="text-lg font-bold font-mono text-foreground">
              {fmtCt(stats.minProc)} -- {fmtCt(stats.maxProc)} ct/kWh
            </p>
            <p className="text-xs text-muted-foreground">
              avg {fmtCt(stats.avgProc)} ct/kWh, spread {fmtCt(stats.spread)} ct
            </p>
          </div>
        </div>

        <div className="grid gap-3 grid-cols-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Cheapest Hour</p>
              <p className="font-mono font-bold text-chart-3">{fmtCt(stats.minProc)} ct/kWh</p>
              <p className="text-[10px] text-muted-foreground">EPEX {fmtCt(stats.minEpex)} + fees</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Average</p>
              <p className="font-mono font-bold">{fmtCt(stats.avgProc)} ct/kWh</p>
              <p className="text-[10px] text-muted-foreground">EPEX {fmtCt(stats.avgEpex)} + fees</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Most Expensive Hour</p>
              <p className="font-mono font-bold text-destructive">{fmtCt(stats.maxProc)} ct/kWh</p>
              <p className="text-[10px] text-muted-foreground">EPEX {fmtCt(stats.maxEpex)} + fees</p>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}

// 2. Demand Charge (Leistungspreis)
function DemandChargeSection() {
  const { gridPricing, updateGridPricing, siteSetup } = useSimulation()
  const gridLimit = siteSetup.grid.gridConnectionLimit

  const demandCalc = useMemo(() => {
    const peakGrid = gridLimit
    const annualCost = peakGrid * gridPricing.annualDemandCharge
    const dailyCost = peakGrid * gridPricing.dailyDemandCharge
    const monthlyCost = annualCost / 12
    const hypotheticalGrid = 150
    const hypotheticalAnnual = hypotheticalGrid * gridPricing.annualDemandCharge
    const savings = hypotheticalAnnual - annualCost

    return { peakGrid, annualCost, dailyCost, monthlyCost, hypotheticalGrid, hypotheticalAnnual, savings }
  }, [gridLimit, gridPricing.annualDemandCharge, gridPricing.dailyDemandCharge])

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-destructive/10">
            <Gauge className="size-4 text-destructive" />
          </div>
          <div>
            <CardTitle className="text-base">Demand Charge (Leistungspreis)</CardTitle>
            <CardDescription>
              Capacity-based annual fee on peak 15-min grid draw
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-xs text-muted-foreground">
          <p>
            The <strong className="text-foreground">Leistungspreis</strong> is the capacity component
            of the German Netzentgelt (network fee). It is billed annually based on the{" "}
            <strong className="text-foreground">highest 15-minute average power drawn from the grid</strong>{" "}
            during the entire billing year. The network operator (Netzbetreiber) measures this via a
            registrierende Leistungsmessung (RLM) meter that records every 15-min interval.
          </p>

          <div className="rounded bg-background p-3 font-mono text-[11px] space-y-1">
            <p>{'Annual_Demand_Cost = Peak_15min_Grid_Draw_kW * Leistungspreis_EUR_per_kW_per_year'}</p>
            <p className="text-muted-foreground mt-1">{'Measured: max( avg_power_kW over any 15-min interval during the year )'}</p>
          </div>

          <div className="space-y-2">
            <p className="font-medium text-foreground">How it works in your setup:</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded border p-2.5 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Shield className="size-3 text-chart-3" />
                  <span className="text-[10px] font-medium text-foreground">With Battery Buffer (current)</span>
                </div>
                <p className="text-[10px]">
                  Grid connection is physically limited to <strong className="text-foreground">{gridLimit} kW</strong>.
                  The ADS-TEC battery buffer absorbs peak demand. The charger delivers up to 320 kW to EVs,
                  but the grid only ever sees max {gridLimit} kW. Your Leistungspreis is{" "}
                  <strong className="text-foreground">inherently capped</strong> by the grid connection.
                </p>
              </div>
              <div className="rounded border border-destructive/20 p-2.5 space-y-1">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="size-3 text-destructive" />
                  <span className="text-[10px] font-medium text-foreground">Without Battery (hypothetical)</span>
                </div>
                <p className="text-[10px]">
                  A direct-to-grid 320 kW HPC charger would need ~{demandCalc.hypotheticalGrid} kW grid.
                  Leistungspreis alone:{" "}
                  <strong className="text-destructive">{fmtEur(demandCalc.hypotheticalAnnual)} EUR/yr</strong>{" "}
                  vs {fmtEur(demandCalc.annualCost)} EUR/yr with battery. Plus expensive grid upgrade.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Typical Leistungspreis rates (Germany 2025):</p>
            <ul className="text-[10px] space-y-0.5">
              <li>Niederspannung (NS, {'<'}100 kW): 25-40 EUR/kW/yr (Westnetz ~32, Bayernwerk ~28, E.DIS ~35)</li>
              <li>Mittelspannung (MS, commercial): 15-25 EUR/kW/yr</li>
              <li>Hochspannung (HS, industrial): 5-15 EUR/kW/yr</li>
              <li>Your setup ({gridLimit} kW at NS): ~30 EUR/kW/yr assumed</li>
            </ul>
            <p className="text-[10px] italic">
              Rate depends on Netzbetreiber, region, and Benutzungsstunden (annual energy / peak power).
            </p>
          </div>

          <div className="rounded bg-chart-3/5 border border-chart-3/20 p-2.5">
            <p className="text-[10px] font-medium text-chart-3">Key savings from battery buffering</p>
            <p className="text-[10px] mt-0.5">
              Grid draw capped at {gridLimit} kW (vs ~{demandCalc.hypotheticalGrid} kW without battery) saves{" "}
              <strong className="text-chart-3">{fmtEur(demandCalc.savings)} EUR/year</strong> on Leistungspreis alone.
              This is a fixed structural saving from the ADS-TEC design. The EMS can further reduce peaks
              within the {gridLimit} kW envelope by pre-charging during cheap hours.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <NumericField
            label="Annual Demand Charge"
            value={gridPricing.annualDemandCharge}
            unit="EUR/kW/yr"
            onChange={(v) => updateGridPricing({
              annualDemandCharge: v,
              dailyDemandCharge: Math.round((v / 365) * 100) / 100,
            })}
            step={5}
            min={0}
            hint="Leistungspreis from your Netzbetreiber"
          />
          <NumericField
            label="Daily Equivalent"
            value={gridPricing.dailyDemandCharge}
            unit="EUR/kW/day"
            onChange={(v) => updateGridPricing({ dailyDemandCharge: v })}
            step={0.01}
            min={0}
            hint="Annual / 365 (for daily simulation)"
          />
        </div>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Peak Grid Draw</p>
              <p className="font-mono font-bold">{demandCalc.peakGrid} kW</p>
              <p className="text-[10px] text-muted-foreground">capped by connection</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Annual Cost</p>
              <p className="font-mono font-bold">{fmtEur(demandCalc.annualCost)} EUR</p>
              <p className="text-[10px] text-muted-foreground">{gridLimit} kW * {gridPricing.annualDemandCharge} EUR</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Monthly Cost</p>
              <p className="font-mono font-bold">{fmtEur(demandCalc.monthlyCost)} EUR</p>
              <p className="text-[10px] text-muted-foreground">annual / 12</p>
            </CardContent>
          </Card>
          <Card className="bg-chart-3/5 border-chart-3/20">
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Annual Saving vs No Battery</p>
              <p className="font-mono font-bold text-chart-3">{fmtEur(demandCalc.savings)} EUR</p>
              <p className="text-[10px] text-muted-foreground">vs {demandCalc.hypotheticalGrid} kW direct</p>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}

// 3. Battery Wear Cost
function BatteryWearCostSection() {
  const { siteSetup, gridPricing } = useSimulation()
  const { wear, battery } = siteSetup

  const financials = useMemo(() => {
    const totalLifetimeKwh = wear.cycleLife * battery.usableCapacity
    const yearlyAtMaxCycles = wear.maxDailyCycles * 365
    const yearsToEol = wear.cycleLife / yearlyAtMaxCycles
    const annualWearCost = wear.maxDailyDischarge * 365 * wear.wearCostPerKwh
    const dailyWearCost = wear.maxDailyDischarge * wear.wearCostPerKwh

    return {
      totalLifetimeKwh,
      yearsToEol: Math.round(yearsToEol * 10) / 10,
      annualWearCost: Math.round(annualWearCost),
      dailyWearCost: Math.round(dailyWearCost * 100) / 100,
      costPer1000Kwh: Math.round(wear.wearCostPerKwh * 1000 * 100) / 100,
    }
  }, [wear, battery])

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-orange-500/10">
            <Battery className="size-4 text-orange-500" />
          </div>
          <div>
            <CardTitle className="text-base">Battery Wear Cost</CardTitle>
            <CardDescription>
              Degradation cost per kWh discharged -- amortized replacement
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-xs text-muted-foreground">
          <p>
            Every charge/discharge cycle degrades the battery. The{" "}
            <strong className="text-foreground">wear cost per kWh</strong> represents the
            amortized share of the eventual battery replacement cost for each kWh discharged.
          </p>

          <div className="rounded bg-background p-3 font-mono text-[11px] space-y-1">
            <p>{'Cost_per_Cycle = Replacement_Cost / Cycle_Life'}</p>
            <p>{'Wear_per_kWh  = Cost_per_Cycle / Usable_Capacity'}</p>
            <p className="text-muted-foreground mt-1">
              {'= '}{fmtEur(wear.batteryReplacementCost)} EUR / {wear.cycleLife} cycles / {battery.usableCapacity} kWh
              {' = '}<span className="text-foreground font-medium">{fmtCt(wear.wearCostPerKwh)} ct/kWh</span>
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Equipment assumptions (ADS-TEC ChargeBox):</p>
            <ul className="text-[10px] space-y-0.5 ml-2">
              <li>Integrated 143 kWh LFP battery pack</li>
              <li>Usable capacity: {battery.usableCapacity} kWh ({battery.socFloor}%-{battery.socCeiling}% SOC window)</li>
              <li>LFP chemistry: ~{wear.cycleLife} full equivalent cycles to 80% capacity retention</li>
              <li>Replacement cost: ~{fmtEur(wear.batteryReplacementCost)} EUR (pack + labour, ex-VAT)</li>
              <li>Based on ~250 EUR/kWh pack cost (2024 LFP pricing, declining ~10%/yr)</li>
              <li>Daily limit: {wear.maxDailyCycles} cycles = {wear.maxDailyDischarge} kWh/day max discharge</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="font-medium text-foreground">Why this matters financially:</p>
            <p className="text-[10px]">
              Wear ({fmtCt(wear.wearCostPerKwh)} ct/kWh) is subtracted from the gross margin on every kWh
              through the battery. The EMS must ensure battery usage adds more value (peak shaving, time-shifting)
              than it costs in wear. If the EPEX delta between charge/discharge hours is less than{" "}
              {fmtCt(wear.wearCostPerKwh)} ct, arbitrage alone does not justify cycling.
            </p>
          </div>
        </div>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Wear Cost</p>
              <p className="font-mono font-bold">{fmtCt(wear.wearCostPerKwh)} ct/kWh</p>
              <p className="text-[10px] text-muted-foreground">{fmtEur(financials.costPer1000Kwh)} EUR/1000 kWh</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Max Daily Wear</p>
              <p className="font-mono font-bold">{fmtEur(financials.dailyWearCost)} EUR</p>
              <p className="text-[10px] text-muted-foreground">at {wear.maxDailyDischarge} kWh/day</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Annual Wear Budget</p>
              <p className="font-mono font-bold">{fmtEur(financials.annualWearCost)} EUR/yr</p>
              <p className="text-[10px] text-muted-foreground">at max daily cycling</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Years to EOL</p>
              <p className="font-mono font-bold">{financials.yearsToEol} years</p>
              <p className="text-[10px] text-muted-foreground">at {wear.maxDailyCycles} cycles/day</p>
            </CardContent>
          </Card>
        </div>

        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          <strong className="text-foreground">Lifetime economics:</strong>{" "}
          Total throughput: {(financials.totalLifetimeKwh / 1000).toFixed(0)} MWh over {financials.yearsToEol} years.
          Replacement at {fmtEur(wear.batteryReplacementCost)} EUR = ~{fmtEur(wear.batteryReplacementCost / financials.yearsToEol)} EUR/year depreciation.
          Partially offset by demand charge savings ({fmtEur(
            siteSetup.grid.gridConnectionLimit * gridPricing.annualDemandCharge
          )} EUR/yr saved vs no-battery scenario).
        </div>
      </CardContent>
    </Card>
  )
}

// EPEX Spot Input Table
function EpexSpotCard() {
  const { gridPricing, updateGridPricing } = useSimulation()
  const { epexSpotPrices, gridFeesAndTaxes, retailPricePerKwh } = gridPricing
  const [view, setView] = useState<"chart" | "table">("chart")

  const updatePrice = (hour: number, value: number) => {
    const updated = [...epexSpotPrices]
    updated[hour] = value
    updateGridPricing({ epexSpotPrices: updated })
  }

  const avgSpot = useMemo(
    () => epexSpotPrices.reduce((a, b) => a + b, 0) / epexSpotPrices.length,
    [epexSpotPrices]
  )
  const minSpot = Math.min(...epexSpotPrices)
  const maxSpot = Math.max(...epexSpotPrices)

  const chartData = useMemo(
    () =>
      epexSpotPrices.map((price, slot) => {
        const procurement = price + gridFeesAndTaxes
        const margin = retailPricePerKwh - procurement
        return {
          slot,
          time: formatSlot(slot),
          epex: Math.round(price * 1000) / 1000,
          procurement: Math.round(procurement * 1000) / 1000,
          margin: Math.round(margin * 1000) / 1000,
          retail: retailPricePerKwh,
        }
      }),
    [epexSpotPrices, gridFeesAndTaxes, retailPricePerKwh]
  )

  const chartConfig = {
    epex: { label: "EPEX Spot", color: "var(--chart-2)" },
    procurement: { label: "Procurement", color: "var(--chart-1)" },
    margin: { label: "Margin", color: "var(--chart-3)" },
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
              <Euro className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">EPEX Spot Prices (15-min Resolution)</CardTitle>
              <CardDescription>
                Intraday wholesale prices -- avg {fmtCt(avgSpot)} ct | min {fmtCt(minSpot)} ct | max {fmtCt(maxSpot)} ct | 96 slots
              </CardDescription>
            </div>
          </div>
          {/* View switcher */}
          <div className="flex items-center rounded-md border bg-muted/50 p-0.5 shrink-0">
            <button
              onClick={() => setView("chart")}
              className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                view === "chart"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <BarChart2 className="size-3.5" />
              Chart
            </button>
            <button
              onClick={() => setView("table")}
              className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                view === "table"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Table2 className="size-3.5" />
              Table
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {view === "chart" ? (
          <div className="space-y-4">
            <ChartContainer config={chartConfig} className="h-72 w-full">
              <ComposedChart
                data={chartData}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10 }}
                  interval={7}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}`}
                  label={{
                    value: "ct/kWh",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 10, fill: "var(--muted-foreground)" },
                  }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null
                    const d = payload[0].payload as (typeof chartData)[0]
                    return (
                      <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm min-w-48">
                        <p className="font-semibold">{d.time}</p>
                        <div className="mt-1.5 space-y-1">
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">EPEX Spot</span>
                            <span className="font-mono font-medium">{fmtCt(d.epex)} ct</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">+ Grid Fees</span>
                            <span className="font-mono">{fmtCt(gridFeesAndTaxes)} ct</span>
                          </div>
                          <div className="flex justify-between gap-4 border-t border-border pt-1">
                            <span className="text-muted-foreground font-medium">Procurement</span>
                            <span className="font-mono font-medium">{fmtCt(d.procurement)} ct</span>
                          </div>
                          <div className="flex justify-between gap-4 border-t border-border pt-1">
                            <span className="text-muted-foreground">Retail</span>
                            <span className="font-mono">{fmtCt(retailPricePerKwh)} ct</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="font-medium">Margin</span>
                            <span className={`font-mono font-bold ${d.margin > 0 ? "text-chart-3" : "text-destructive"}`}>
                              {fmtCt(d.margin)} ct
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  }}
                />
                {/* Margin area between procurement and retail */}
                <Area
                  type="stepAfter"
                  dataKey="procurement"
                  fill="var(--chart-3)"
                  fillOpacity={0.08}
                  stroke="none"
                />
                {/* EPEX area */}
                <Area
                  type="stepAfter"
                  dataKey="epex"
                  fill="var(--chart-2)"
                  fillOpacity={0.2}
                  stroke="var(--chart-2)"
                  strokeWidth={1.5}
                />
                {/* Procurement step line */}
                <Line
                  type="stepAfter"
                  dataKey="procurement"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={false}
                />
                {/* Retail reference */}
                <ReferenceLine
                  y={retailPricePerKwh}
                  stroke="var(--chart-3)"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  label={{
                    value: `Retail ${fmtCt(retailPricePerKwh)} ct`,
                    position: "right",
                    style: { fontSize: 10, fill: "var(--chart-3)" },
                  }}
                />
                {/* Grid fees reference */}
                <ReferenceLine
                  y={gridFeesAndTaxes}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  label={{
                    value: `Fees ${fmtCt(gridFeesAndTaxes)} ct`,
                    position: "left",
                    style: { fontSize: 9, fill: "var(--muted-foreground)" },
                  }}
                />
              </ComposedChart>
            </ChartContainer>
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-sm bg-chart-2 opacity-70" />
                EPEX Spot (15-min)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 bg-chart-1" />
                Procurement (EPEX + fees)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-chart-3" />
                Retail @ {fmtCt(retailPricePerKwh)} ct
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-sm bg-chart-3 opacity-10 border border-chart-3/30" />
                Margin area
              </span>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((col) => (
              <Table key={col}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-14">Time</TableHead>
                    <TableHead className="text-xs">EPEX</TableHead>
                    <TableHead className="text-xs">Proc.</TableHead>
                    <TableHead className="text-xs">Mrgn</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {epexSpotPrices.slice(col * 24, (col + 1) * 24).map((price, i) => {
                    const slot = col * 24 + i
                    const proc = price + gridFeesAndTaxes
                    const margin = retailPricePerKwh - proc
                    return (
                      <TableRow key={slot}>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">
                          {formatSlot(slot)}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={price}
                            onChange={(e) => updatePrice(slot, parseFloat(e.target.value) || 0)}
                            step={0.001}
                            min={0}
                            className="h-6 w-16 font-mono text-[10px] tabular-nums"
                          />
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">
                          {proc.toFixed(3)}
                        </TableCell>
                        <TableCell className={`font-mono text-[10px] font-medium ${margin > 0 ? "text-chart-3" : "text-destructive"}`}>
                          {fmtCt(margin)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}


// ═══════════════════════════════════════════════
// TAB 3: INCOME DETAILS
// ═══════════════════════════════════════════════

// 1. EV Charging Revenue
function EvRevenueSection() {
  const { gridPricing, updateGridPricing, chargingSessions } = useSimulation()
  const retail = gridPricing.retailPricePerKwh

  const stats = useMemo(() => {
    const totalKwhRequested = chargingSessions.reduce((s, c) => s + c.energyRequestedKwh, 0)
    const grossRevenue = totalKwhRequested * retail
    return { totalKwhRequested, grossRevenue, sessionCount: chargingSessions.length }
  }, [chargingSessions, retail])

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-chart-1/10">
            <Car className="size-4 text-chart-1" />
          </div>
          <div>
            <CardTitle className="text-base">EV Charging Revenue</CardTitle>
            <CardDescription>
              Flat rate charged to EV drivers per kWh delivered
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-xs text-muted-foreground">
          <p>
            Under the <strong className="text-foreground">Ladesaulenverordnung (LSV)</strong>,
            public EV chargers must display a transparent ad-hoc price without requiring
            app registration. The rate is a flat per-kWh charge displayed at the charger.
          </p>
          <div className="rounded bg-background p-3 font-mono text-[11px]">
            <p>{'Revenue(day) = Total_kWh_Delivered * Retail_Price_per_kWh'}</p>
          </div>
          <p>
            The 59 ct/kWh rate is competitive in the German HPC market. For reference:
            Ionity ad-hoc 79 ct, EnBW 49-59 ct, ARAL Pulse 59 ct, Allego ~65 ct, Tesla SC ~45 ct (members).
          </p>
        </div>

        <NumericField
          label="Flat Retail Price"
          value={gridPricing.retailPricePerKwh}
          unit="EUR/kWh"
          onChange={(v) => updateGridPricing({ retailPricePerKwh: v })}
          step={0.01}
          min={0}
          hint="Ad-hoc rate displayed at charger per LSV"
        />

        <div className="grid gap-3 grid-cols-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Sessions Today</p>
              <p className="font-mono font-bold">{stats.sessionCount}</p>
              <p className="text-[10px] text-muted-foreground">sequential queue</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Energy Requested</p>
              <p className="font-mono font-bold">{stats.totalKwhRequested.toFixed(1)} kWh</p>
              <EnergyRequestedTooltip
                sessions={chargingSessions}
                totalKwh={stats.totalKwhRequested}
                variant="compact"
              />
            </CardContent>
          </Card>
          <Card className="bg-chart-1/5 border-chart-1/20">
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Max Gross Revenue</p>
              <p className="font-mono font-bold text-chart-1">{fmtEur(stats.grossRevenue)} EUR</p>
              <p className="text-[10px] text-muted-foreground">{stats.totalKwhRequested.toFixed(1)} kWh * {fmtCt(retail)} ct</p>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}

// 2. PV Self-consumption Savings
function PvSavingsSection() {
  const { siteSetup, gridPricing } = useSimulation()
  const { pv } = siteSetup

  const pvProfile1Min = useMemo(() => buildPvProfile1Min(pv), [pv])

  const stats = useMemo(() => {
    let totalKwh = 0
    let totalSavingsEur = 0
    const slotCount = gridPricing.epexSpotPrices.length // 96
    for (let s = 0; s < slotCount; s++) {
      const procurement = (gridPricing.epexSpotPrices[s] ?? 0) + gridPricing.gridFeesAndTaxes
      const startMin = s * 15
      const endMin = startMin + 15
      for (let m = startMin; m < endMin; m++) {
        const kwh = pvProfile1Min[m] / 60
        totalKwh += kwh
        totalSavingsEur += kwh * procurement
      }
    }
    return {
      totalKwh: Math.round(totalKwh * 10) / 10,
      totalSavingsEur: Math.round(totalSavingsEur * 100) / 100,
      avgSavedCtKwh: totalKwh > 0 ? Math.round((totalSavingsEur / totalKwh) * 10000) / 100 : 0,
    }
  }, [pvProfile1Min, gridPricing])

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-chart-3/10">
            <Sun className="size-4 text-chart-3" />
          </div>
          <div>
            <CardTitle className="text-base">PV Self-consumption Savings</CardTitle>
            <CardDescription>
              Avoided grid cost when PV energy is used directly or buffered
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-xs text-muted-foreground">
          <p>
            PV energy has <strong className="text-foreground">zero marginal cost</strong> (CAPEX is amortized
            separately). Every kWh of PV used by the charger displaces a grid import, saving the full
            procurement cost. The kWh is still sold at {fmtCt(gridPricing.retailPricePerKwh)} ct -- so
            the margin on PV-sourced kWh is the full retail price.
          </p>
          <div className="rounded bg-background p-3 font-mono text-[11px]">
            <p>{'PV_Savings(h) = PV_kWh(h) * Procurement(h)'}</p>
            <p>{'PV_Margin(h) = Retail - 0 = '}{fmtCt(gridPricing.retailPricePerKwh)} ct/kWh</p>
          </div>
        </div>

        <div className="grid gap-3 grid-cols-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">PV Available</p>
              <p className="font-mono font-bold">{stats.totalKwh} kWh/day</p>
              <p className="text-[10px] text-muted-foreground">{pv.chargerSharePercent}% of {pv.installedCapacityKwp} kWp</p>
            </CardContent>
          </Card>
          <Card className="bg-chart-3/5 border-chart-3/20">
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Max Daily Savings</p>
              <p className="font-mono font-bold text-chart-3">{fmtEur(stats.totalSavingsEur)} EUR</p>
              <p className="text-[10px] text-muted-foreground">if 100% utilised</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Avg Avoided Cost</p>
              <p className="font-mono font-bold">{stats.avgSavedCtKwh} ct/kWh</p>
              <p className="text-[10px] text-muted-foreground">weighted by PV hours</p>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}

// 3. Grid Export Revenue
function GridExportRevenueSection() {
  const { gridExport, gridPricing } = useSimulation()
  const epex = gridPricing.epexSpotPrices
  const avgEpex = epex.reduce((a, b) => a + b, 0) / epex.length
  const minEpex = Math.min(...epex)
  const maxEpex = Math.max(...epex)
  const retail = gridPricing.retailPricePerKwh

  // Calculate export rate per mechanism
  const isEeg = gridExport.mechanism === "eeg-surplus"
  const isDirekt = gridExport.mechanism === "direktvermarktung"

  let avgExportRate = 0
  let minExportRate = 0
  let maxExportRate = 0
  if (isEeg) {
    avgExportRate = gridExport.eegFeedInTariff
    minExportRate = gridExport.eegFeedInTariff
    maxExportRate = gridExport.eegFeedInTariff
  } else if (isDirekt) {
    avgExportRate = Math.max(avgEpex - gridExport.aggregatorFee, 0)
    minExportRate = Math.max(minEpex - gridExport.aggregatorFee, 0)
    maxExportRate = Math.max(maxEpex - gridExport.aggregatorFee, 0)
  } else {
    avgExportRate = Math.max(avgEpex - gridExport.gridExportFee, 0)
    minExportRate = Math.max(minEpex - gridExport.gridExportFee, 0)
    maxExportRate = Math.max(maxEpex - gridExport.gridExportFee, 0)
  }

  const mechanismLabel = isEeg ? "EEG Surplus (Uberschusseinspeisung)" : isDirekt ? "Direktvermarktung" : "Spot-indexed Export"
  const fee = isDirekt ? gridExport.aggregatorFee : gridExport.gridExportFee

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-chart-5/10">
            <ArrowUpFromLine className="size-4 text-chart-5" />
          </div>
          <div>
            <CardTitle className="text-base">Grid Export Revenue (Last Resort)</CardTitle>
            <CardDescription>
              Revenue from feeding surplus energy back to grid -- worst economic option
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Why export is last resort */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-xs text-muted-foreground">
          <p>
            Grid export is always the{" "}
            <strong className="text-foreground">worst economic option</strong>.
            Selling at {fmtCt(avgExportRate)} ct/kWh vs {fmtCt(retail)} ct/kWh retail ={" "}
            <strong className="text-destructive">{fmtCt(retail - avgExportRate)} ct/kWh lost margin</strong>.
            Only export when: no EV charging, battery SOC at ceiling, PV still producing.
          </p>
        </div>

        {/* Price Formula Section */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Price Calculation</h4>

          {/* Active mechanism */}
          <Card className="bg-chart-5/5 border-chart-5/20">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full bg-chart-5" />
                <p className="text-xs font-semibold text-foreground">
                  Active: {mechanismLabel}
                </p>
              </div>

              {/* Formula box */}
              <div className="rounded-md bg-background p-3 font-mono text-[11px] space-y-1.5 border">
                {isEeg ? (
                  <>
                    <p className="text-muted-foreground">{'// Fixed rate set by EEG 2024/2025 for PV 100-750 kWp'}</p>
                    <p>{'ExportPrice = EEG_FeedInTariff'}</p>
                    <p className="border-t border-border pt-1.5 mt-1.5">
                      {'ExportPrice = '}
                      <span className="text-chart-5 font-medium">{fmtCt(gridExport.eegFeedInTariff)} ct/kWh</span>
                      <span className="text-muted-foreground"> (fixed, degression-adjusted)</span>
                    </p>
                  </>
                ) : isDirekt ? (
                  <>
                    <p className="text-muted-foreground">{'// Sold on EPEX SPOT via licensed aggregator (Direktvermarkter)'}</p>
                    <p>{'ExportPrice(h) = EPEX_Spot(h) - AggregatorFee'}</p>
                    <p className="border-t border-border pt-1.5 mt-1.5">
                      {'ExportPrice(h) = EPEX_Spot(h) - '}
                      <span className="text-muted-foreground">{fmtCt(gridExport.aggregatorFee)} ct</span>
                    </p>
                    <p className="text-muted-foreground mt-1">{'// Hourly example:'}</p>
                    <p>
                      {'Avg: '}<span className="text-chart-5 font-medium">{fmtCt(avgExportRate)} ct</span>
                      {' = '}{fmtCt(avgEpex)} - {fmtCt(gridExport.aggregatorFee)}
                    </p>
                    <p>
                      {'Min: '}<span className="text-chart-5">{fmtCt(minExportRate)} ct</span>
                      {' = '}{fmtCt(minEpex)} - {fmtCt(gridExport.aggregatorFee)}
                      <span className="text-muted-foreground"> (midday solar surplus)</span>
                    </p>
                    <p>
                      {'Max: '}<span className="text-chart-5">{fmtCt(maxExportRate)} ct</span>
                      {' = '}{fmtCt(maxEpex)} - {fmtCt(gridExport.aggregatorFee)}
                      <span className="text-muted-foreground"> (evening peak)</span>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground">{'// Battery-to-grid export at EPEX price minus grid usage fees'}</p>
                    <p>{'ExportPrice(h) = EPEX_Spot(h) - GridExportFee'}</p>
                    <p className="border-t border-border pt-1.5 mt-1.5">
                      {'ExportPrice(h) = EPEX_Spot(h) - '}
                      <span className="text-muted-foreground">{fmtCt(gridExport.gridExportFee)} ct</span>
                    </p>
                    <p className="text-muted-foreground mt-1">{'// Hourly example:'}</p>
                    <p>
                      {'Avg: '}<span className="text-chart-5 font-medium">{fmtCt(avgExportRate)} ct</span>
                      {' = '}{fmtCt(avgEpex)} - {fmtCt(gridExport.gridExportFee)}
                    </p>
                    <p>
                      {'Min: '}<span className="text-chart-5">{fmtCt(minExportRate)} ct</span>
                      {' = '}{fmtCt(minEpex)} - {fmtCt(gridExport.gridExportFee)}
                    </p>
                    <p>
                      {'Max: '}<span className="text-chart-5">{fmtCt(maxExportRate)} ct</span>
                      {' = '}{fmtCt(maxEpex)} - {fmtCt(gridExport.gridExportFee)}
                    </p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* All three mechanisms comparison */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="text-xs font-semibold text-foreground">All Mechanisms Compared</p>
              <div className="space-y-2">
                {/* EEG */}
                <div className={`rounded-md p-2.5 text-xs border ${isEeg ? "bg-chart-5/5 border-chart-5/30" : "bg-muted/30"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isEeg && <div className="size-1.5 rounded-full bg-chart-5" />}
                      <span className="font-medium">EEG Surplus</span>
                    </div>
                    <span className="font-mono font-medium">{fmtCt(gridExport.eegFeedInTariff)} ct/kWh</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Fixed rate for PV {'<'} 750 kWp. No market risk, guaranteed 20 years. EEG 2024: ~5.68 ct/kWh for 100-750 kWp (monthly degression 1%).
                  </p>
                </div>
                {/* Direktvermarktung */}
                <div className={`rounded-md p-2.5 text-xs border ${isDirekt ? "bg-chart-5/5 border-chart-5/30" : "bg-muted/30"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isDirekt && <div className="size-1.5 rounded-full bg-chart-5" />}
                      <span className="font-medium">Direktvermarktung</span>
                    </div>
                    <span className="font-mono font-medium">{fmtCt(Math.max(avgEpex - gridExport.aggregatorFee, 0))} ct/kWh avg</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    EPEX_Spot(h) - Aggregator Fee ({fmtCt(gridExport.aggregatorFee)} ct). Market-dependent, varies hourly. Mandatory for PV {'>'} 100 kWp if claiming Marktpramie.
                  </p>
                </div>
                {/* Spot-indexed */}
                <div className={`rounded-md p-2.5 text-xs border ${!isEeg && !isDirekt ? "bg-chart-5/5 border-chart-5/30" : "bg-muted/30"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {!isEeg && !isDirekt && <div className="size-1.5 rounded-full bg-chart-5" />}
                      <span className="font-medium">Spot-indexed (Battery)</span>
                    </div>
                    <span className="font-mono font-medium">{fmtCt(Math.max(avgEpex - gridExport.gridExportFee, 0))} ct/kWh avg</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    EPEX_Spot(h) - Grid Export Fee ({fmtCt(gridExport.gridExportFee)} ct). Battery-to-grid only. Higher fee includes Netzentgelt for export + metering.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Summary cards */}
        <div className="grid gap-3 grid-cols-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Avg Export Revenue</p>
              <p className="font-mono font-bold">{fmtCt(avgExportRate)} ct/kWh</p>
              <p className="text-[10px] text-muted-foreground">
                {isEeg ? "fixed EEG rate" : `range ${fmtCt(minExportRate)}-${fmtCt(maxExportRate)} ct`}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Opportunity Cost</p>
              <p className="font-mono font-bold text-destructive">{fmtCt(retail - avgExportRate)} ct/kWh</p>
              <p className="text-[10px] text-muted-foreground">lost vs {fmtCt(retail)} ct retail</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground">Max Export Capacity</p>
              <p className="font-mono font-bold">{gridExport.maxExportCapacity} kW</p>
              <p className="text-[10px] text-muted-foreground">grid connection limit</p>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}


// ═══════════════════════════════════════════════
// SHARED: Margin Chart (15-min)
// ═══════════════════════════════════════════════

const marginChartConfig: ChartConfig = {
  procurement: { label: "Procurement Cost", color: "var(--chart-2)" },
  margin: { label: "Gross Margin", color: "var(--chart-3)" },
}

function MarginChart() {
  const { gridPricing, siteSetup } = useSimulation()
  const { epexSpotPrices, gridFeesAndTaxes, retailPricePerKwh } = gridPricing
  const wearCost = siteSetup.wear.wearCostPerKwh

  const chartData = useMemo(() => {
    const INTERVAL = 15
    return Array.from({ length: 1440 / INTERVAL }, (_, i) => {
      const start = i * INTERVAL
  const slot = Math.floor(start / 15) // 15-min EPEX slot index
  const epex = epexSpotPrices[slot] ?? 0
      const procurement = epex + gridFeesAndTaxes
      const margin = retailPricePerKwh - procurement
      return {
        time: minuteToTimeStr(start),
        procurement: Math.round(procurement * 1000) / 1000,
        margin: Math.round(margin * 1000) / 1000,
      }
    })
  }, [epexSpotPrices, gridFeesAndTaxes, retailPricePerKwh])

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
            <TrendingUp className="size-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">Margin Over Day (15-min)</CardTitle>
            <CardDescription>
              Procurement cost (orange) + gross margin (green) stacked to flat
              retail {fmtCt(retailPricePerKwh)} ct
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={marginChartConfig} className="aspect-[2.5/1] w-full">
          <ComposedChart data={chartData} barCategoryGap="20%">
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="time" tickLine={false} axisLine={false} interval={3} tick={{ fontSize: 10 }} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}`}
              width={35}
              domain={[0, "auto"]}
              label={{ value: "ct/kWh", angle: -90, position: "insideLeft", offset: 0, style: { fontSize: 10, fill: "var(--color-muted-foreground)" } }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null
                const d = payload[0].payload as { time: string; procurement: number; margin: number }
                const total = d.procurement + d.margin
                const epex = d.procurement - gridFeesAndTaxes
                return (
                  <div className="rounded-md border bg-background px-3 py-2.5 text-xs shadow-sm min-w-56">
                    <p className="font-semibold text-foreground">{d.time}</p>

                    {/* Visual stacked bar */}
                    <div className="mt-2 flex h-3 w-full rounded overflow-hidden">
                      <div
                        className="bg-chart-2"
                        style={{ width: `${(d.procurement / total) * 100}%`, opacity: 0.7 }}
                      />
                      <div
                        className="bg-chart-3"
                        style={{ width: `${(d.margin / total) * 100}%`, opacity: 0.6 }}
                      />
                    </div>

                    {/* Breakdown */}
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between gap-3">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block size-2 rounded-sm bg-chart-2 opacity-70" />
                          <span className="text-muted-foreground">EPEX Spot</span>
                        </span>
                        <span className="font-mono">{fmtCt(epex)} ct</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block size-2 rounded-sm bg-chart-2 opacity-40" />
                          <span className="text-muted-foreground">Grid Fees</span>
                        </span>
                        <span className="font-mono">{fmtCt(gridFeesAndTaxes)} ct</span>
                      </div>
                      <div className="flex justify-between gap-3 border-t border-border pt-1">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block size-2 rounded-sm bg-chart-2 opacity-70" />
                          <span className="font-medium">Procurement</span>
                        </span>
                        <span className="font-mono font-medium">{fmtCt(d.procurement)} ct</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block size-2 rounded-sm bg-chart-3 opacity-60" />
                          <span className="font-medium">Gross Margin</span>
                        </span>
                        <span className={`font-mono font-medium ${d.margin > 0 ? "text-chart-3" : "text-destructive"}`}>
                          {fmtCt(d.margin)} ct
                        </span>
                      </div>
                      <div className="flex justify-between gap-3 border-t border-border pt-1">
                        <span className="text-muted-foreground">Retail (flat)</span>
                        <span className="font-mono">{fmtCt(retailPricePerKwh)} ct</span>
                      </div>
                    </div>

                    {/* Formula */}
                    <div className="mt-2 rounded bg-muted/50 p-2 font-mono text-[10px] space-y-0.5">
                      <p className="text-muted-foreground">Procurement = EPEX({fmtCt(epex)}) + Fees({fmtCt(gridFeesAndTaxes)}) = {fmtCt(d.procurement)} ct</p>
                      <p className="text-muted-foreground">Margin = Retail({fmtCt(retailPricePerKwh)}) - Procurement({fmtCt(d.procurement)}) = <span className={d.margin > 0 ? "text-chart-3" : "text-destructive"}>{fmtCt(d.margin)} ct</span></p>
                    </div>
                  </div>
                )
              }}
            />
            <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
            <Area
              type="stepAfter"
              dataKey="procurement"
              fill="var(--color-chart-2)"
              fillOpacity={0.25}
              stroke="var(--color-chart-2)"
              strokeWidth={1.5}
              stackId="cost"
              name="Procurement Cost"
            />
            <Area
              type="stepAfter"
              dataKey="margin"
              fill="var(--color-chart-3)"
              fillOpacity={0.2}
              stroke="var(--color-chart-3)"
              strokeWidth={1.5}
              stackId="cost"
              name="Gross Margin"
            />
            <ReferenceLine
              y={retailPricePerKwh}
              stroke="var(--chart-1)"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: `Retail: ${fmtCt(retailPricePerKwh)} ct`, position: "right", style: { fontSize: 9, fill: "var(--chart-1)" } }}
            />
            <ReferenceLine
              y={wearCost}
              stroke="var(--destructive)"
              strokeDasharray="3 3"
              strokeWidth={1}
              label={{ value: `Wear: ${fmtCt(wearCost)} ct`, position: "right", style: { fontSize: 9, fill: "var(--destructive)" } }}
            />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}


// ═══════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════

export function FinancialsScreen() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Price Breakdown"
        description="All energy flow economics -- costs vs income, fully detailed"
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="w-full">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="mb-6 w-full grid grid-cols-3">
              <TabsTrigger value="overview" className="gap-1.5">
                <BarChart3 className="size-3.5" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="costs" className="gap-1.5">
                <TrendingDown className="size-3.5" />
                Costs
              </TabsTrigger>
              <TabsTrigger value="income" className="gap-1.5">
                <TrendingUp className="size-3.5" />
                Income
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: Overview Dashboard */}
            <TabsContent value="overview" className="mt-0">
              <OverviewDashboard />
            </TabsContent>

            {/* TAB 2: Cost Details */}
            <TabsContent value="costs" className="mt-0">
              <div className="flex flex-col gap-6">
                <GridImportCostSection />
                <DemandChargeSection />
                <BatteryWearCostSection />
                <EpexSpotCard />
              </div>
            </TabsContent>

            {/* TAB 3: Income Details */}
            <TabsContent value="income" className="mt-0">
              <div className="flex flex-col gap-6">
                <EvRevenueSection />
                <PvSavingsSection />
                <GridExportRevenueSection />
              </div>
            </TabsContent>
          </Tabs>

          {/* Sources & References */}
          <SourcesCitation
            title="Sources: Pricing, Tariffs & Market Data"
            sources={[
              {
                label: "EPEX SPOT SE -- Market Data (Day-Ahead & Intraday)",
                url: "https://www.epexspot.com/en/market-data",
                detail: "15-min intraday auction prices for Germany/Luxembourg bidding zone. Summer Saturday pattern: midday solar surplus (1-3 ct/kWh), evening peak (12-14 ct/kWh).",
                date: "2024",
              },
              {
                label: "Bundesnetzagentur -- SMARD Strommarktdaten",
                url: "https://www.smard.de/en",
                detail: "Official German electricity market data portal. Day-ahead and intraday prices, generation mix, cross-border flows. Used to validate EPEX price patterns.",
                date: "2024",
              },
              {
                label: "Bundesnetzagentur -- Netzentgelte (Grid Fee Transparency)",
                url: "https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Netzentgelte/start.html",
                detail: "Netzentgelt Arbeitspreis ~5.0 ct/kWh for Niederspannung commercial connections (DSO-dependent). Breakdown of grid fees by voltage level.",
                date: "2024",
              },
              {
                label: "German Federal Law -- Stromsteuergesetz (StromStG) Section 3",
                url: "https://www.gesetze-im-internet.de/stromstg/__3.html",
                detail: "Stromsteuer (electricity tax) fixed at 2.05 ct/kWh for commercial consumers. Legal basis for the grid fee component.",
                date: "2024",
              },
              {
                label: "German Federal Law -- Konzessionsabgabenverordnung (KAV) Section 2",
                url: "https://www.gesetze-im-internet.de/kav/__2.html",
                detail: "Konzessionsabgabe for Sondervertragskunden (special contract customers): 0.11 ct/kWh. Applies to commercial EV charging operators.",
                date: "2024",
              },
              {
                label: "Netztransparenz.de -- Offshore-Netzumlage (Section 17f EnWG)",
                url: "https://www.netztransparenz.de/EnWG/Offshore-Netzumlage",
                detail: "Offshore grid surcharge: 0.66 ct/kWh for 2025. Published quarterly by TSOs.",
                date: "2025",
              },
              {
                label: "EnBW, Ionity, Fastned, ARAL -- Published EV Charging Tariffs",
                url: "https://www.enbw.com/elektromobilitaet/produkte/ladetarife",
                detail: "Retail HPC pricing: EnBW 49-59 ct/kWh, Ionity 79 ct/kWh (ad-hoc), Fastned 69-73 ct/kWh, ARAL Pulse 59 ct/kWh. Used to validate 59 ct/kWh retail assumption.",
                date: "2024",
              },
              {
                label: "Ladesaeulenverordnung (LSV) -- German Charging Station Regulation",
                url: "https://www.gesetze-im-internet.de/lsv/",
                detail: "Regulatory requirements for public EV charging, ad-hoc payment obligations, pricing transparency rules.",
                date: "2024",
              },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
