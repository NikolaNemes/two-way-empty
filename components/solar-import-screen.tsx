"use client"

import { useMemo, useState } from "react"
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
import { useSimulation } from "@/lib/simulation-store"
import { buildPvProfile1Min, minuteToTimeStr, aggregate15Min } from "@/lib/disaggregate"
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
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { Sun, Zap, Clock, BatteryCharging, Info, Euro, ChevronDown } from "lucide-react"

// ── Offset Breakdown Card with expandable calculation tooltip + mini chart ──
function OffsetBreakdownCard({
  totalOffsetEur,
  totalKwh,
  avgAvoidedCtKwh,
  gridFeesAndTaxes,
  hourly,
  pvSharePercent,
  plantKwp,
}: {
  totalOffsetEur: number
  totalKwh: number
  avgAvoidedCtKwh: number
  gridFeesAndTaxes: number
  hourly: { hour: number; kwh: number; avoidedCostCtKwh: number; offsetEur: number }[]
  pvSharePercent: number
  plantKwp: number
}) {
  const [open, setOpen] = useState(false)

  // Top-3 hours by offset for the formula example
  const top3 = [...hourly].sort((a, b) => b.offsetEur - a.offsetEur).slice(0, 3)
  const peakHour = top3[0]

  // Mini chart: only daylight hours (05:00 - 21:00)
  const dayHours = hourly.filter((h) => h.hour >= 5 && h.hour <= 20)
  const maxOffset = Math.max(...dayHours.map((h) => h.offsetEur), 0.01)

  return (
    <Card className="bg-chart-3/5 border-chart-3/20 relative overflow-hidden">
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground">Max Daily Offset</p>
        <p className="mt-1 text-2xl font-bold font-mono text-chart-3">
          {totalOffsetEur.toFixed(2)}
        </p>
        <p className="text-xs text-muted-foreground">EUR/day avoided grid cost</p>

        {/* Toggle button */}
        <button
          onClick={() => setOpen(!open)}
          className="mt-2 flex items-center gap-1 text-xs text-chart-3 hover:underline cursor-pointer"
        >
          <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
          {open ? "Hide" : "How is this calculated?"}
        </button>

        {/* Expandable breakdown */}
        {open && (
          <div className="mt-3 space-y-3 border-t border-chart-3/20 pt-3">
            {/* Formula */}
            <div className="space-y-1.5 text-xs text-foreground">
              <p className="font-medium">Formula</p>
              <div className="rounded bg-background p-2 font-mono text-[11px] space-y-0.5">
                <p className="text-muted-foreground">{'For each hour h = 0..23:'}</p>
                <p>{'offset(h) = PV_kWh(h) * (EPEX(h) + GridFees)'}</p>
                <p className="text-muted-foreground mt-1">{'Total = SUM( offset(h) )'}</p>
              </div>
            </div>

            {/* Worked example */}
            <div className="space-y-1.5 text-xs">
              <p className="font-medium text-foreground">Peak hour example (h={peakHour?.hour.toString().padStart(2, "0")}:00)</p>
              <div className="rounded bg-background p-2 font-mono text-[11px] space-y-0.5">
                <p>
                  PV_kWh = <span className="text-chart-3 font-medium">{peakHour?.kwh.toFixed(2)}</span> kWh
                </p>
                <p>
                  EPEX = {((peakHour?.avoidedCostCtKwh ?? 0) - gridFeesAndTaxes * 100).toFixed(2)} ct/kWh
                </p>
                <p>
                  GridFees = {(gridFeesAndTaxes * 100).toFixed(2)} ct/kWh
                </p>
                <p className="border-t border-border pt-1 mt-1">
                  Avoided = {peakHour?.kwh.toFixed(2)} * {peakHour?.avoidedCostCtKwh.toFixed(2)} ct
                  {" = "}
                  <span className="text-chart-3 font-medium">{peakHour?.offsetEur.toFixed(2)} EUR</span>
                </p>
              </div>
            </div>

            {/* Top 3 hours */}
            <div className="space-y-1 text-xs">
              <p className="font-medium text-foreground">Top contributing hours</p>
              <div className="space-y-0.5">
                {top3.map((h) => (
                  <div key={h.hour} className="flex justify-between font-mono text-[11px]">
                    <span>{h.hour.toString().padStart(2, "0")}:00</span>
                    <span className="text-muted-foreground">{h.kwh.toFixed(1)} kWh * {h.avoidedCostCtKwh.toFixed(1)} ct</span>
                    <span className="text-chart-3 font-medium">{h.offsetEur.toFixed(2)} EUR</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Mini bar chart: hourly avoided cost */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Hourly avoided cost (05:00-20:00)</p>
              <div className="h-24 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dayHours} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="hour"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 9 }}
                      tickFormatter={(h: number) => `${h}`}
                      interval={1}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.[0]) return null
                        const d = payload[0].payload as (typeof dayHours)[0]
                        return (
                          <div className="rounded-md border bg-background px-2.5 py-1.5 text-[11px] shadow-sm">
                            <p className="font-medium">{d.hour.toString().padStart(2, "0")}:00</p>
                            <p className="font-mono text-chart-3">{d.offsetEur.toFixed(2)} EUR</p>
                            <p className="text-muted-foreground">{d.kwh.toFixed(1)} kWh * {d.avoidedCostCtKwh.toFixed(1)} ct</p>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="offsetEur" radius={[2, 2, 0, 0]}>
                      {dayHours.map((entry) => (
                        <Cell
                          key={entry.hour}
                          fill={entry.offsetEur / maxOffset > 0.7
                            ? "var(--chart-3)"
                            : entry.offsetEur / maxOffset > 0.3
                              ? "color-mix(in srgb, var(--chart-3) 60%, transparent)"
                              : "color-mix(in srgb, var(--chart-3) 30%, transparent)"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Summary line */}
            <div className="rounded bg-background p-2 text-[11px] font-mono">
              <span className="text-muted-foreground">SUM(24h) = </span>
              <span className="text-chart-3 font-medium">{totalOffsetEur.toFixed(2)} EUR</span>
              <span className="text-muted-foreground"> from {totalKwh} kWh at avg {avgAvoidedCtKwh.toFixed(1)} ct/kWh</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function SolarImportScreen() {
  const { siteSetup, gridPricing } = useSimulation()
  const { pv, grid } = siteSetup
  const { epexSpotPrices, gridFeesAndTaxes } = gridPricing

  // Effective peak output for charger
  const effectiveKwp = pv.installedCapacityKwp * (pv.chargerSharePercent / 100) * (1 - pv.systemLossPercent / 100)

  // Build 1-min profile
  const pvProfile1Min = useMemo(() => buildPvProfile1Min(pv), [pv])

  // Summary stats
  const stats = useMemo(() => {
    let totalKwh = 0
    let peakKw = 0
    let peakMinute = 0
    let sunriseMin = -1
    let sunsetMin = 0
    for (let m = 0; m < 1440; m++) {
      const kw = pvProfile1Min[m]
      totalKwh += kw / 60 // 1 min = 1/60 hour
      if (kw > peakKw) {
        peakKw = kw
        peakMinute = m
      }
      if (kw > 0.1 && sunriseMin === -1) sunriseMin = m
      if (kw > 0.1) sunsetMin = m
    }
    const sunHours = (sunsetMin - sunriseMin) / 60
    return {
      totalKwh: Math.round(totalKwh * 10) / 10,
      peakKw: Math.round(peakKw * 10) / 10,
      peakTime: minuteToTimeStr(peakMinute),
      sunriseTime: sunriseMin > 0 ? minuteToTimeStr(sunriseMin) : "--",
      sunsetTime: sunsetMin > 0 ? minuteToTimeStr(sunsetMin) : "--",
      sunHours: Math.round(sunHours * 10) / 10,
      capacityFactor: Math.round((totalKwh / (effectiveKwp * 24)) * 1000) / 10,
    }
  }, [pvProfile1Min, effectiveKwp])

  // Chart data -- 15-min aggregation of 1-min data
  const chartData = useMemo(() => {
    const agg = aggregate15Min(pvProfile1Min)
    return agg.map((bin) => {
      const totalScale = pv.chargerSharePercent > 0 ? 1 / (pv.chargerSharePercent / 100) : 0
      return {
        minute: bin.minute,
        time: bin.time,
        pvKw: Math.round(bin.avg * 100) / 100,
        totalPvKw: Math.round(bin.avg * totalScale * 100) / 100,
      }
    })
  }, [pvProfile1Min, pv.chargerSharePercent])

  // ── Financial Max Offset (ideal case) ──
  // The charger's PV share is fixed at the configured %. Ideal case: every kWh of
  // that share is fully utilised -- either directly charging an EV or buffered into
  // the battery SOC during idle periods. No curtailment, no feed-in, no waste.
  // Each kWh displaces a grid import at that slot's EPEX spot + grid fees (15-min resolution).
  const financialOffset = useMemo(() => {
    let totalOffsetEur = 0
    let totalKwh = 0
    const slotCount = epexSpotPrices.length // 96
    // Aggregate to hourly for display, but use 15-min EPEX for accuracy
    const hourly: { hour: number; kwh: number; avoidedCostCtKwh: number; offsetEur: number }[] = []

    for (let h = 0; h < 24; h++) {
      let hKwh = 0
      let hOffset = 0
      // 4 slots per hour
      for (let q = 0; q < 4; q++) {
        const slot = h * 4 + q
        const procurementCost = (epexSpotPrices[slot] ?? 0) + gridFeesAndTaxes
        const startMin = slot * 15
        const endMin = startMin + 15
        for (let m = startMin; m < endMin; m++) {
          const kwh = pvProfile1Min[m] / 60
          hKwh += kwh
          hOffset += kwh * procurementCost
        }
      }
      totalKwh += hKwh
      totalOffsetEur += hOffset
      const avgProc = hKwh > 0 ? (hOffset / hKwh) : 0
      hourly.push({
        hour: h,
        kwh: Math.round(hKwh * 100) / 100,
        avoidedCostCtKwh: Math.round(avgProc * 10000) / 100, // in ct/kWh (weighted avg)
        offsetEur: Math.round(hOffset * 100) / 100,
      })
    }
    return {
      totalOffsetEur: Math.round(totalOffsetEur * 100) / 100,
      totalKwh: Math.round(totalKwh * 10) / 10,
      avgAvoidedCtKwh: totalKwh > 0 ? Math.round((totalOffsetEur / totalKwh) * 10000) / 100 : 0,
      annualEstimate: Math.round(totalOffsetEur * 365 * 100) / 100,
      hourly,
    }
  }, [pvProfile1Min, epexSpotPrices, gridFeesAndTaxes])

  // Hourly table -- aggregate 1-min to hourly
  const hourlyData = useMemo(() => {
    const hours: {
      hour: number
      timeLabel: string
      avgKw: number
      maxKw: number
      minKw: number
      kwh: number
      totalPlantKwh: number
      capacityFactor: number
    }[] = []
    for (let h = 0; h < 24; h++) {
      let sum = 0
      let max = 0
      let min = Infinity
      for (let m = h * 60; m < (h + 1) * 60; m++) {
        const kw = pvProfile1Min[m]
        sum += kw
        max = Math.max(max, kw)
        min = Math.min(min, kw)
      }
      const avgKw = sum / 60
      const kwh = sum / 60 // sum of kW over 60 minutes, each 1 min = 1/60 hour
      const totalPlantKwh = pv.chargerSharePercent > 0 ? kwh / (pv.chargerSharePercent / 100) : 0
      hours.push({
        hour: h,
        timeLabel: `${h.toString().padStart(2, "0")}:00`,
        avgKw: Math.round(avgKw * 100) / 100,
        maxKw: Math.round(max * 100) / 100,
        minKw: min === Infinity ? 0 : Math.round(min * 100) / 100,
        kwh: Math.round(kwh * 100) / 100,
        totalPlantKwh: Math.round(totalPlantKwh * 100) / 100,
        capacityFactor: effectiveKwp > 0 ? Math.round((avgKw / effectiveKwp) * 1000) / 10 : 0,
      })
    }
    return hours
  }, [pvProfile1Min, pv.chargerSharePercent, effectiveKwp])

  // Totals for table footer
  const tableTotals = useMemo(() => {
    const totalKwh = hourlyData.reduce((s, h) => s + h.kwh, 0)
    const totalPlantKwh = hourlyData.reduce((s, h) => s + h.totalPlantKwh, 0)
    const maxKw = Math.max(...hourlyData.map((h) => h.maxKw))
    return {
      totalKwh: Math.round(totalKwh * 10) / 10,
      totalPlantKwh: Math.round(totalPlantKwh * 10) / 10,
      maxKw: Math.round(maxKw * 10) / 10,
    }
  }, [hourlyData])

  const chartConfig: ChartConfig = {
    pvKw: { label: "Charger PV (kW)", color: "var(--chart-3)" },
    totalPvKw: { label: "Total Plant (kW)", color: "var(--chart-5)" },
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Solar Production"
        description="PV generation profile -- where energy goes is decided by the optimizer"
      />

      <div className="flex-1 space-y-6 p-4 md:p-6">
        {/* Explainer */}
        <Card className="border-chart-3/30 bg-chart-3/5">
          <CardContent className="flex gap-3 py-4">
            <Info className="mt-0.5 size-4 shrink-0 text-chart-3" />
            <div className="space-y-1 text-sm text-foreground">
              <p className="font-medium">
                PV Input = {pv.chargerSharePercent}% of {pv.installedCapacityKwp} kWp plant
              </p>
              <p className="text-muted-foreground">
                The supermarket rooftop PV plant produces electricity split between the
                charger ({pv.chargerSharePercent}%) and the supermarket via PPA ({100 - pv.chargerSharePercent}%).
                This page shows the charger&apos;s share: <strong>{Math.round(effectiveKwp * 10) / 10} kWp effective</strong> after
                {" "}{pv.systemLossPercent}% system losses. The 1-minute profile is interpolated from PVGIS hourly capacity
                factors for a typical July day in southern Germany (~48N, {pv.tiltDeg} deg tilt, south-facing)
                with realistic intra-hour cloud variability.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <Sun className="size-4 text-chart-3" />
                <p className="text-xs text-muted-foreground">Daily Yield</p>
              </div>
              <p className="mt-1 text-2xl font-bold font-mono">{stats.totalKwh}</p>
              <p className="text-xs text-muted-foreground">kWh to charger</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-chart-3" />
                <p className="text-xs text-muted-foreground">Peak Output</p>
              </div>
              <p className="mt-1 text-2xl font-bold font-mono">{stats.peakKw}</p>
              <p className="text-xs text-muted-foreground">kW at {stats.peakTime}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <BatteryCharging className="size-4 text-chart-3" />
                <p className="text-xs text-muted-foreground">Effective Peak</p>
              </div>
              <p className="mt-1 text-2xl font-bold font-mono">{Math.round(effectiveKwp * 10) / 10}</p>
              <p className="text-xs text-muted-foreground">kWp ({pv.chargerSharePercent}% share)</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-chart-3" />
                <p className="text-xs text-muted-foreground">Sun Hours</p>
              </div>
              <p className="mt-1 text-2xl font-bold font-mono">{stats.sunHours}</p>
              <p className="text-xs text-muted-foreground">{stats.sunriseTime} - {stats.sunsetTime}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <Sun className="size-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Capacity Factor</p>
              </div>
              <p className="mt-1 text-2xl font-bold font-mono">{stats.capacityFactor}%</p>
              <p className="text-xs text-muted-foreground">avg / peak ratio</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <Sun className="size-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Total Plant</p>
              </div>
              <p className="mt-1 text-2xl font-bold font-mono">{Math.round(stats.totalKwh / (pv.chargerSharePercent / 100) * 10) / 10}</p>
              <p className="text-xs text-muted-foreground">kWh (full {pv.installedCapacityKwp} kWp)</p>
            </CardContent>
          </Card>
        </div>

        {/* PV Generation Chart */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-chart-3/10">
                <Sun className="size-4 text-chart-3" />
              </div>
              <div>
                <CardTitle className="text-base">PV Generation Profile</CardTitle>
                <CardDescription>
                  15-min aggregation of 1-min resolution data -- typical July day, southern Germany
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <ChartContainer config={chartConfig} className="h-80 w-full">
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
                      labelFormatter={(_, payload) => {
                        if (payload?.[0]?.payload?.time) return payload[0].payload.time
                        return ""
                      }}
                    />
                  }
                />
                {/* Total plant as faint background */}
                <Area
                  type="monotone"
                  dataKey="totalPvKw"
                  fill="var(--chart-5)"
                  fillOpacity={0.1}
                  stroke="var(--chart-5)"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                  name="Total Plant"
                  isAnimationActive={false}
                />
                {/* Charger share */}
                <Area
                  type="monotone"
                  dataKey="pvKw"
                  fill="var(--chart-3)"
                  fillOpacity={0.35}
                  stroke="var(--chart-3)"
                  strokeWidth={1.5}
                  name="Charger Share"
                  isAnimationActive={false}
                />
                <ReferenceLine
                  y={effectiveKwp}
                  stroke="var(--chart-3)"
                  strokeDasharray="6 3"
                  strokeWidth={1}
                  label={{
                    value: `Peak ${Math.round(effectiveKwp)} kWp`,
                    position: "right",
                    style: { fontSize: 10, fill: "var(--chart-3)" },
                  }}
                />
                <ReferenceLine
                  y={grid.gridConnectionLimit}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  label={{
                    value: `Grid ${grid.gridConnectionLimit} kW`,
                    position: "right",
                    style: { fontSize: 10, fill: "var(--muted-foreground)" },
                  }}
                />
              </ComposedChart>
            </ChartContainer>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-3)" }} />
                Charger share ({pv.chargerSharePercent}%)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-sm border border-dashed" style={{ borderColor: "var(--chart-5)" }} />
                Total plant output
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 border-t border-dashed" style={{ borderColor: "var(--chart-3)" }} />
                Effective peak ({Math.round(effectiveKwp)} kWp)
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Financial Max Offset (Ideal Case) */}
        <Card className="border-chart-3/30">
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-chart-3/10">
                <Euro className="size-4 text-chart-3" />
              </div>
              <div>
                <CardTitle className="text-base">Financial Max Offset (Ideal Case)</CardTitle>
                <CardDescription>
                  Maximum avoided grid cost if the charger&apos;s {pv.chargerSharePercent}% PV share
                  ({stats.totalKwh} kWh/day) is fully utilised -- direct EV charging or battery SOC buffering.
                  No curtailment, no feed-in, no waste.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {/* Summary cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <OffsetBreakdownCard
                totalOffsetEur={financialOffset.totalOffsetEur}
                totalKwh={financialOffset.totalKwh}
                avgAvoidedCtKwh={financialOffset.avgAvoidedCtKwh}
                gridFeesAndTaxes={gridFeesAndTaxes}
                hourly={financialOffset.hourly}
                pvSharePercent={pv.chargerSharePercent}
                plantKwp={pv.installedCapacityKwp}
              />
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">PV Energy Available</p>
                  <p className="mt-1 text-2xl font-bold font-mono">
                    {financialOffset.totalKwh}
                  </p>
                  <p className="text-xs text-muted-foreground">kWh/day ({pv.chargerSharePercent}% of plant)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Avg Avoided Cost</p>
                  <p className="mt-1 text-2xl font-bold font-mono">
                    {financialOffset.avgAvoidedCtKwh.toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">ct/kWh (EPEX + grid fees)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground">Annual Estimate</p>
                  <p className="mt-1 text-2xl font-bold font-mono">
                    {financialOffset.annualEstimate.toLocaleString("de-DE", { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground">EUR/year (if every day like this)</p>
                </CardContent>
              </Card>
            </div>

            {/* Hourly offset table */}
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Hour</TableHead>
                    <TableHead className="text-xs text-right">PV kWh</TableHead>
                    <TableHead className="text-xs text-right">Avoided Cost (ct/kWh)</TableHead>
                    <TableHead className="text-xs text-right">Offset (EUR)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {financialOffset.hourly.map((row) => {
                    const isActive = row.kwh > 0.01
                    return (
                      <TableRow key={row.hour} className={isActive ? "" : "text-muted-foreground/50"}>
                        <TableCell className="font-mono text-xs">
                          {row.hour.toString().padStart(2, "0")}:00
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.kwh.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.avoidedCostCtKwh.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-medium text-chart-3">
                          {isActive ? row.offsetEur.toFixed(2) : "--"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
                <tfoot>
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell className="text-xs font-medium">Total</TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium">
                      {financialOffset.totalKwh}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {financialOffset.avgAvoidedCtKwh.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium text-chart-3">
                      {financialOffset.totalOffsetEur.toFixed(2)}
                    </TableCell>
                  </TableRow>
                </tfoot>
              </Table>
            </div>

            {/* Explanation */}
            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p>
                <strong>Ideal case assumes:</strong> Every kWh of the charger&apos;s {pv.chargerSharePercent}% PV share
                is fully absorbed -- either charging an active EV session directly or buffered into
                the 143 kWh battery during idle gaps. No energy is curtailed, exported to grid, or wasted.
                Each kWh displaces a grid import at that hour&apos;s EPEX spot + {(gridFeesAndTaxes * 100).toFixed(0)} ct/kWh
                grid fees.
              </p>
              <p>
                <strong>Reality will be lower:</strong> Battery SOC limits (20-90%) mean the buffer
                can&apos;t always absorb surplus PV. Some midday PV coincides with low EPEX prices where the
                offset is small. The EMS optimizer will determine actual utilisation vs. curtailment.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Hourly Breakdown Table */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-chart-3/10">
                <Clock className="size-4 text-chart-3" />
              </div>
              <div>
                <CardTitle className="text-base">Hourly Breakdown</CardTitle>
                <CardDescription>
                  Aggregated from 1-min profile -- charger share only
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="max-h-[500px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Hour</TableHead>
                    <TableHead className="text-xs text-right">Avg kW</TableHead>
                    <TableHead className="text-xs text-right">Min kW</TableHead>
                    <TableHead className="text-xs text-right">Max kW</TableHead>
                    <TableHead className="text-xs text-right">kWh</TableHead>
                    <TableHead className="text-xs text-right">Plant kWh</TableHead>
                    <TableHead className="text-xs text-right">CF %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hourlyData.map((row) => {
                    const isActive = row.avgKw > 0.1
                    return (
                      <TableRow
                        key={row.hour}
                        className={isActive ? "" : "text-muted-foreground/50"}
                      >
                        <TableCell className="font-mono text-xs">
                          {row.timeLabel}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.avgKw.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.minKw.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.maxKw.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-medium">
                          {row.kwh.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {row.totalPlantKwh.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {isActive ? `${row.capacityFactor}%` : "--"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
                <tfoot>
                  <TableRow className="bg-muted/50 font-medium">
                    <TableCell className="text-xs font-medium">Total</TableCell>
                    <TableCell className="text-right font-mono text-xs">--</TableCell>
                    <TableCell className="text-right font-mono text-xs">--</TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium">
                      {tableTotals.maxKw}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium">
                      {tableTotals.totalKwh}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium">
                      {tableTotals.totalPlantKwh}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium">
                      {stats.capacityFactor}%
                    </TableCell>
                  </TableRow>
                </tfoot>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Context card: how PV fits the energy mix */}
        <Card className="border-muted">
          <CardContent className="py-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">PV vs Grid Import</p>
                <p className="text-sm text-foreground">
                  The charger&apos;s {Math.round(effectiveKwp)}&nbsp;kWp PV share produces
                  {" "}<strong>{stats.totalKwh} kWh/day</strong> -- free energy that offsets
                  grid procurement at EPEX spot + fees rates.
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Peak Timing</p>
                <p className="text-sm text-foreground">
                  Solar peak ({stats.peakKw} kW at {stats.peakTime}) coincides with the
                  midday EPEX price dip, making self-consumption during lunch sessions
                  particularly cost-effective.
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Battery Interaction</p>
                <p className="text-sm text-foreground">
                  When PV output exceeds immediate EV demand, surplus can charge the battery
                  storage for later discharge during peak-price evening sessions.
                  This is decided by the EMS optimizer.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sources & References */}
        <SourcesCitation
          title="Sources: Solar PV Profiles & Yield Data"
          sources={[
            {
              label: "PVGIS -- EU Joint Research Centre (JRC) PV Tool",
              url: "https://re.jrc.ec.europa.eu/pvg_tools/en/",
              detail: "Hourly capacity factors for crystalline silicon PV at ~48 deg N latitude (southern Germany), 30 deg tilt, south-facing. Data basis for the 24h capacity factor profile.",
              date: "2024",
            },
            {
              label: "Fraunhofer ISE -- Photovoltaics Report (Updated Quarterly)",
              url: "https://www.ise.fraunhofer.de/en/publications/studies/photovoltaics-report.html",
              detail: "System losses ~14% (inverter, cabling, soiling, mismatch). Typical German PV capacity factors: 10-12% annual, 15-20% summer peak months.",
              date: "2024",
            },
            {
              label: "Fraunhofer ISE -- Energy Charts (Live Generation Data)",
              url: "https://energy-charts.info/charts/power/chart.htm",
              detail: "Real-time and historical PV generation profiles for Germany. Used to validate the bell-curve shape and peak timing of the hourly capacity factor profile.",
              date: "2024",
            },
            {
              label: "PVGIS -- Solar Radiation Database (SARAH-2)",
              url: "https://re.jrc.ec.europa.eu/pvg_tools/en/tools.html#TMY",
              detail: "Satellite-based solar irradiance data for Europe. Source of the Global Horizontal Irradiance (GHI) and Direct Normal Irradiance (DNI) used in PVGIS calculations.",
              date: "2023",
            },
          ]}
        />
      </div>
    </div>
  )
}
