"use client"

import { useMemo } from "react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { NumericField } from "@/components/numeric-field"
import { Label } from "@/components/ui/label"
import { useSimulation } from "@/lib/simulation-store"
import { PageHeader } from "@/components/page-header"
import { SourcesCitation } from "@/components/sources-citation"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Area,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Bar,
  BarChart,
} from "recharts"
import { buildPvProfile1Min, aggregate15Min } from "@/lib/disaggregate"
import {
  ArrowUpFromLine,
  Info,
  Sun,
  TrendingUp,
  TrendingDown,
  Euro,
  Zap,
  ArrowRightLeft,
} from "lucide-react"

// ── Mechanism explainers ──
const MECHANISMS = {
  "eeg-surplus": {
    title: "EEG Surplus Feed-in (Uberschusseinspeisung)",
    desc: "Fixed tariff paid by TSO for surplus PV energy not self-consumed. Available for plants up to 750 kWp under the Renewable Energy Sources Act (EEG 2023). Rate is set at commissioning and guaranteed for 20 years, but subject to monthly degression (~1% per half-year). For a 150 kWp plant commissioned in 2025, the partial-surplus rate is approximately 5.68 ct/kWh.",
    formula: "Revenue = Surplus kWh x EEG Feed-in Tariff",
    pros: ["Guaranteed fixed rate for 20 years", "No market risk", "Simple metering"],
    cons: ["Low rate (~5.7 ct/kWh)", "No benefit from high spot prices", "Only PV surplus, not battery"],
  },
  "direktvermarktung": {
    title: "Direct Marketing (Direktvermarktung)",
    desc: "PV surplus is sold on the EPEX SPOT day-ahead market through an aggregator (Direktvermarkter). The aggregator bids your forecasted production into hourly auctions. You receive the realized EPEX hourly price minus their management fee. A Marktpramie (market premium) from the TSO bridges the gap to the EEG reference rate, ensuring total income >= EEG tariff. Mandatory for new PV > 100 kWp since EEG 2017.",
    formula: "Revenue = (EPEX Spot Price - Aggregator Fee) x kWh + Marktpramie",
    pros: ["Higher revenue in high-price hours", "Market premium guarantees EEG floor", "Can include battery export"],
    cons: ["Aggregator fee (0.3-0.5 ct/kWh)", "Forecast deviation penalties", "More complex metering"],
  },
  "spot-indexed": {
    title: "Spot-indexed Battery Export",
    desc: "Battery storage exports to the grid at real-time EPEX SPOT prices when spot prices are high enough to be profitable after accounting for grid export fees, battery wear, and the floor price threshold. This is a last-resort strategy -- only used when surplus PV or battery charge would otherwise be curtailed, and the arbitrage opportunity exceeds all costs. In Germany (EnWG 2024), battery storage operators pay reduced grid fees (vermiedene Netzentgelte phasing out by 2029).",
    formula: "Net Revenue = (EPEX Spot - Grid Export Fee - Battery Wear) x kWh",
    pros: ["Monetize surplus during price spikes", "Reduce curtailment losses", "Flexible timing"],
    cons: ["Grid export fees (~2.5 ct/kWh)", "Battery wear cost", "BNetzA phasing out avoided-network tariffs by 2029", "Last resort only"],
  },
}

export function GridExportScreen() {
  const {
    gridExport,
    updateGridExport,
    gridPricing,
    siteSetup,
  } = useSimulation()

  const { pv } = siteSetup

  // Compute PV production profile for the charger's share
  const pvData = useMemo(() => {
    const effectiveKwp = pv.installedCapacityKwp * (pv.chargerSharePercent / 100) * (1 - pv.systemLossPercent / 100)
    return pv.hourlyCapacityFactors.map((cf, hour) => {
      const pvKw = Math.round(effectiveKwp * cf * 10) / 10
      // Use the first 15-min slot of this hour for the EPEX price
      const epex = gridPricing.epexSpotPrices[hour * 4] || 0
      const procurementCost = epex + gridPricing.gridFeesAndTaxes

      // Revenue per kWh at this hour by mechanism
      let exportRevenue = 0
      let exportLabel = ""
      if (gridExport.mechanism === "eeg-surplus") {
        exportRevenue = gridExport.eegFeedInTariff
        exportLabel = "EEG Tariff"
      } else if (gridExport.mechanism === "direktvermarktung") {
        exportRevenue = Math.max(epex - gridExport.aggregatorFee, 0)
        exportLabel = "EPEX - Aggregator"
      } else {
        exportRevenue = Math.max(epex - gridExport.gridExportFee, 0)
        exportLabel = "EPEX - Grid Fee"
      }

      const aboveFloor = exportRevenue >= gridExport.exportFloorPrice
      const effectiveRevenue = aboveFloor ? exportRevenue : 0

      return {
        hour,
        time: `${String(hour).padStart(2, "0")}:00`,
        pvKw,
        epex: Math.round(epex * 1000) / 10, // ct/kWh
        procurementCost: Math.round(procurementCost * 1000) / 10,
        exportRevenue: Math.round(exportRevenue * 1000) / 10,
        effectiveRevenue: Math.round(effectiveRevenue * 1000) / 10,
        aboveFloor,
        exportLabel,
        // Avoided cost: if PV is used to charge EVs instead of grid import
        avoidedCost: Math.round(procurementCost * 1000) / 10,
      }
    })
  }, [pv, gridPricing, gridExport])

  // 15-min PV chart data (from 1-min profile)
  const pvProfile1Min = useMemo(() => buildPvProfile1Min(pv), [pv])
  const pvChart15Min = useMemo(() => {
    const agg = aggregate15Min(pvProfile1Min)
    return agg.map((bin) => ({
      minute: bin.minute,
      time: bin.time,
      pvKw: Math.round(bin.avg * 100) / 100,
    }))
  }, [pvProfile1Min])

  // Summary stats
  const summary = useMemo(() => {
    const effectiveKwp = pv.installedCapacityKwp * (pv.chargerSharePercent / 100) * (1 - pv.systemLossPercent / 100)
    const totalPvKwh = pv.hourlyCapacityFactors.reduce((s, cf) => s + effectiveKwp * cf, 0)
    const peakPvKw = Math.max(...pvData.map((d) => d.pvKw))
    const avgExportRevenue = pvData.filter((d) => d.pvKw > 0 && d.aboveFloor).reduce((s, d) => s + d.effectiveRevenue, 0) / Math.max(pvData.filter((d) => d.pvKw > 0 && d.aboveFloor).length, 1)
    const avgAvoidedCost = pvData.filter((d) => d.pvKw > 0).reduce((s, d) => s + d.avoidedCost, 0) / Math.max(pvData.filter((d) => d.pvKw > 0).length, 1)
    const exportableHours = pvData.filter((d) => d.pvKw > 0 && d.aboveFloor).length
    const curtailedHours = pvData.filter((d) => d.pvKw > 0 && !d.aboveFloor).length

    return {
      totalPvKwh: Math.round(totalPvKwh * 10) / 10,
      peakPvKw,
      avgExportRevenue: Math.round(avgExportRevenue * 10) / 10,
      avgAvoidedCost: Math.round(avgAvoidedCost * 10) / 10,
      exportableHours,
      curtailedHours,
    }
  }, [pvData, pv])

  const mechInfo = MECHANISMS[gridExport.mechanism]

  const pvChartConfig: ChartConfig = {
    pvKw: { label: "PV Output (kW)", color: "var(--chart-3)" },
  }

  const revenueChartConfig: ChartConfig = {
    effectiveRevenue: { label: "Export Revenue", color: "var(--chart-1)" },
    avoidedCost: { label: "Avoided Import Cost", color: "var(--chart-3)" },
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Export To Grid"
        description="Feed-in mechanisms, PV surplus, and battery export strategy"
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex w-full flex-col gap-6">

          {/* Mechanism Explainer */}
          <Card className="border-primary/20 bg-primary/[0.02]">
            <CardHeader className="border-b border-primary/10">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                  <Info className="size-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">German Grid Export Mechanisms</CardTitle>
                  <CardDescription>
                    How surplus energy from PV or battery reaches the grid
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                In Germany, a supermarket EV charger with rooftop PV has three options to
                monetize surplus energy. Grid export is typically a <span className="font-semibold text-foreground">last resort</span> --
                self-consumption (charging EVs directly from PV) avoids both procurement costs
                and grid fees, making it far more valuable than any export mechanism.
              </p>

              <div className="grid gap-3 md:grid-cols-3">
                {(Object.entries(MECHANISMS) as [keyof typeof MECHANISMS, typeof MECHANISMS[keyof typeof MECHANISMS]][]).map(([key, mech]) => (
                  <button
                    key={key}
                    onClick={() => updateGridExport({ mechanism: key })}
                    className={`text-left rounded-lg border p-3 transition-colors ${
                      gridExport.mechanism === key
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <p className={`text-sm font-medium mb-1 ${
                      gridExport.mechanism === key ? "text-primary" : "text-foreground"
                    }`}>
                      {mech.title}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                      {mech.desc.slice(0, 150)}...
                    </p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Selected mechanism detail */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                  <ArrowRightLeft className="size-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">{mechInfo.title}</CardTitle>
                  <CardDescription>Currently selected export mechanism</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                {mechInfo.desc}
              </p>
              <div className="rounded-md bg-muted px-4 py-3 mb-4">
                <p className="font-mono text-sm text-foreground">{mechInfo.formula}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-foreground mb-2">Advantages</p>
                  <ul className="flex flex-col gap-1">
                    {mechInfo.pros.map((p, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <TrendingUp className="mt-0.5 size-3 shrink-0 text-chart-1" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-foreground mb-2">Disadvantages</p>
                  <ul className="flex flex-col gap-1">
                    {mechInfo.cons.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <TrendingDown className="mt-0.5 size-3 shrink-0 text-destructive" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Export Configuration */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                  <ArrowUpFromLine className="size-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Export Parameters</CardTitle>
                  <CardDescription>Feed-in rates, fees, and limits</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {gridExport.mechanism === "eeg-surplus" && (
                  <NumericField
                    label="EEG Feed-in Tariff"
                    value={gridExport.eegFeedInTariff}
                    unit="EUR/kWh"
                    onChange={(v) => updateGridExport({ eegFeedInTariff: v })}
                    min={0}
                    step={0.001}
                    hint="Fixed rate for 100-750 kWp partial"
                  />
                )}
                {gridExport.mechanism === "direktvermarktung" && (
                  <NumericField
                    label="Aggregator Fee"
                    value={gridExport.aggregatorFee}
                    unit="EUR/kWh"
                    onChange={(v) => updateGridExport({ aggregatorFee: v })}
                    min={0}
                    step={0.001}
                    hint="Direktvermarkter management fee"
                  />
                )}
                {gridExport.mechanism === "spot-indexed" && (
                  <NumericField
                    label="Grid Export Fee"
                    value={gridExport.gridExportFee}
                    unit="EUR/kWh"
                    onChange={(v) => updateGridExport({ gridExportFee: v })}
                    min={0}
                    step={0.001}
                    hint="Network usage + metering"
                  />
                )}
                <NumericField
                  label="Max Export Capacity"
                  value={gridExport.maxExportCapacity}
                  unit="kW"
                  onChange={(v) => updateGridExport({ maxExportCapacity: v })}
                  min={0}
                  step={5}
                  hint="Transformer / grid operator limit"
                />
                <NumericField
                  label="Export Floor Price"
                  value={gridExport.exportFloorPrice}
                  unit="EUR/kWh"
                  onChange={(v) => updateGridExport({ exportFloorPrice: v })}
                  min={0}
                  step={0.005}
                  hint="Don't export below this price"
                />
              </div>
            </CardContent>
          </Card>

          {/* Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-8 items-center justify-center rounded-md bg-chart-3/10">
                    <Sun className="size-4 text-chart-3" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold font-mono text-foreground">
                      {summary.totalPvKwh}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Daily PV to charger (kWh)
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Peak: {summary.peakPvKw} kW
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-8 items-center justify-center rounded-md bg-chart-1/10">
                    <Euro className="size-4 text-chart-1" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold font-mono text-foreground">
                      {summary.avgExportRevenue}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Avg export revenue (ct/kWh)
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {summary.exportableHours} profitable hours
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                    <Zap className="size-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold font-mono text-foreground">
                      {summary.avgAvoidedCost}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Avg avoided import cost (ct/kWh)
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Self-consumption is {Math.round(summary.avgAvoidedCost / Math.max(summary.avgExportRevenue, 0.1) * 10) / 10}x more valuable
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* PV Production Profile Chart */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-chart-3/10">
                  <Sun className="size-4 text-chart-3" />
                </div>
                <div>
                  <CardTitle className="text-base">PV Output Profile (Charger Share)</CardTitle>
                  <CardDescription>
                    15-min aggregation of 1-min PV data -- typical summer day
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <ChartContainer config={pvChartConfig} className="h-56 w-full">
                <ComposedChart
                  data={pvChart15Min}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="time"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10 }}
                    interval={3}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10 }}
                    width={40}
                    label={{
                      value: "kW",
                      position: "insideLeft",
                      offset: 10,
                      style: { fontSize: 10, fill: "var(--muted-foreground)" },
                    }}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.time || ""
                        }
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="pvKw"
                    fill="var(--chart-3)"
                    fillOpacity={0.3}
                    stroke="var(--chart-3)"
                    strokeWidth={2}
                    name="PV Output"
                    isAnimationActive={false}
                  />
                  <ReferenceLine
                    y={gridExport.maxExportCapacity}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="6 3"
                    strokeWidth={1}
                    label={{
                      value: `Export cap ${gridExport.maxExportCapacity} kW`,
                      position: "right",
                      style: { fontSize: 10, fill: "var(--muted-foreground)" },
                    }}
                  />
                </ComposedChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Export Revenue vs Avoided Cost Chart */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-chart-1/10">
                  <Euro className="size-4 text-chart-1" />
                </div>
                <div>
                  <CardTitle className="text-base">Export Revenue vs. Avoided Import Cost</CardTitle>
                  <CardDescription>
                    Why self-consumption beats export -- hourly comparison in ct/kWh
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <ChartContainer config={revenueChartConfig} className="h-64 w-full">
                <BarChart
                  data={pvData.filter((d) => d.pvKw > 0)}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="time"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10 }}
                    width={40}
                    label={{
                      value: "ct/kWh",
                      position: "insideLeft",
                      offset: 10,
                      style: { fontSize: 10, fill: "var(--muted-foreground)" },
                    }}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.time || ""
                        }
                      />
                    }
                  />
                  <Bar
                    dataKey="avoidedCost"
                    fill="var(--chart-3)"
                    fillOpacity={0.6}
                    radius={[3, 3, 0, 0]}
                    name="Avoided Import Cost"
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="effectiveRevenue"
                    fill="var(--chart-1)"
                    fillOpacity={0.6}
                    radius={[3, 3, 0, 0]}
                    name="Export Revenue"
                    isAnimationActive={false}
                  />
                  <ReferenceLine
                    y={gridExport.exportFloorPrice * 100}
                    stroke="var(--destructive)"
                    strokeDasharray="4 2"
                    strokeWidth={1}
                    label={{
                      value: "Floor",
                      position: "right",
                      style: { fontSize: 9, fill: "var(--destructive)" },
                    }}
                  />
                </BarChart>
              </ChartContainer>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-3)", opacity: 0.6 }} />
                  Avoided import cost (self-consumption value)
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-1)", opacity: 0.6 }} />
                  Export revenue ({mechInfo.title.split("(")[0].trim()})
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Hourly breakdown table */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                  <ArrowUpFromLine className="size-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Hourly Export Analysis</CardTitle>
                  <CardDescription>
                    PV production hours with export revenue vs self-consumption value
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Hour</TableHead>
                      <TableHead className="text-xs">PV (kW)</TableHead>
                      <TableHead className="text-xs">EPEX (ct/kWh)</TableHead>
                      <TableHead className="text-xs">Export Rev (ct/kWh)</TableHead>
                      <TableHead className="text-xs">Avoided Cost (ct/kWh)</TableHead>
                      <TableHead className="text-xs">Best Use</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pvData.filter((d) => d.pvKw > 0).map((d) => {
                      const selfBetter = d.avoidedCost > d.effectiveRevenue
                      return (
                        <TableRow key={d.hour}>
                          <TableCell className="font-mono text-xs">{d.time}</TableCell>
                          <TableCell className="font-mono text-xs">{d.pvKw}</TableCell>
                          <TableCell className="font-mono text-xs">{d.epex}</TableCell>
                          <TableCell className={`font-mono text-xs ${!d.aboveFloor ? "text-destructive line-through" : ""}`}>
                            {d.exportRevenue}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-medium text-chart-3">
                            {d.avoidedCost}
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                              selfBetter
                                ? "bg-chart-3/10 text-chart-3"
                                : "bg-chart-1/10 text-chart-1"
                            }`}>
                              {selfBetter ? "Self-consume" : "Export"}
                            </span>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Key insight card */}
          <Card className="border-chart-3/30 bg-chart-3/[0.03]">
            <CardContent className="pt-4">
              <div className="flex gap-3">
                <Info className="mt-0.5 size-4 shrink-0 text-chart-3" />
                <div className="text-sm text-muted-foreground leading-relaxed">
                  <p className="font-medium text-foreground mb-1">
                    Self-consumption is always preferred
                  </p>
                  <p>
                    At an average avoided import cost of <span className="font-mono font-medium text-foreground">{summary.avgAvoidedCost} ct/kWh</span> vs.
                    average export revenue of <span className="font-mono font-medium text-foreground">{summary.avgExportRevenue} ct/kWh</span>,
                    every kWh of PV used to charge EVs directly saves{" "}
                    <span className="font-mono font-medium text-foreground">
                      {Math.round((summary.avgAvoidedCost - summary.avgExportRevenue) * 10) / 10} ct/kWh
                    </span>{" "}
                    more than exporting it. Grid export should only happen when: (1) no EV is connected,
                    (2) the battery is full, and (3) the spot price exceeds the floor threshold.
                    The EMS optimizer (built later) will handle this dispatch logic.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sources & References */}
          <SourcesCitation
            title="Sources: Grid Export & Feed-in Regulation"
            sources={[
              {
                label: "EEG 2023/2024 -- Erneuerbare-Energien-Gesetz (Full Text)",
                url: "https://www.gesetze-im-internet.de/eeg_2014/",
                detail: "EEG feed-in tariff for PV 100-750 kWp partial surplus: ~5.68 ct/kWh (subject to monthly degression). Guaranteed for 20 years from commissioning.",
                date: "2024",
              },
              {
                label: "Bundesnetzagentur -- EEG Verguetungssaetze (Current Tariff Tables)",
                url: "https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/ErneuerbareEnergien/EEG_Foerderung/start.html",
                detail: "Official monthly publication of EEG feed-in tariffs with degression. Current rates for all PV size categories.",
                date: "2025",
              },
              {
                label: "Direktvermarktung -- Market Premium Model (Marktpraemienmodell)",
                url: "https://www.next-kraftwerke.de/wissen/direktvermarktung",
                detail: "How Direktvermarktung works: aggregator sells PV on EPEX SPOT, operator receives EPEX - aggregator fee + Marktpraemie. Mandatory for PV > 100 kWp since EEG 2017.",
                date: "2024",
              },
              {
                label: "EnWG 2024 -- Energiewirtschaftsgesetz (Battery Storage Export Rules)",
                url: "https://www.gesetze-im-internet.de/enwg_2005/",
                detail: "Battery storage grid export rules: reduced grid fees (vermiedene Netzentgelte) for battery operators, bidirectional grid connection requirements.",
                date: "2024",
              },
              {
                label: "EPEX SPOT -- Intraday Continuous & Auction Market Rules",
                url: "https://www.epexspot.com/en/tradingproducts",
                detail: "15-min and hourly intraday auction products. Used for spot-indexed battery export pricing. Gate closure and settlement rules.",
                date: "2024",
              },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
