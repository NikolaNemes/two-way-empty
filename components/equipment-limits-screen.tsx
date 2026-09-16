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
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Line,
} from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { useSimulation } from "@/lib/simulation-store"
import { PageHeader } from "@/components/page-header"
import { SourcesCitation } from "@/components/sources-citation"
import { EnergyRequestedTooltip } from "@/components/energy-requested-tooltip"
import { minuteToTimeStr, buildPvProfile1Min, aggregate15Min } from "@/lib/disaggregate"
import {
  Gauge,
  Plug,
  Battery,
  Zap,
  Sun,
  Info,
  BatteryCharging,
  ArrowDownUp,
} from "lucide-react"

export function EquipmentLimitsScreen() {
  const { siteSetup, chargingSessions } = useSimulation()

  const {
    grid: { gridConnectionLimit },
    battery: {
      totalCapacity,
      usableCapacity,
      socFloor,
      socCeiling,
      maxDischargeRate,
      startSoc,
    },
    charger: { maxHardwareOutput },
    wear: { maxDailyDischarge, maxDailyCycles, cycleLife, wearCostPerKwh },
    pv,
  } = siteSetup

  // ── PV output for charger (hourly, kW) ──
  const pvForCharger = useMemo(() => {
    const effectiveKwp =
      pv.installedCapacityKwp *
      (pv.chargerSharePercent / 100) *
      (1 - pv.systemLossPercent / 100)
    return pv.hourlyCapacityFactors.map((cf) =>
      Math.round(cf * effectiveKwp * 10) / 10
    )
  }, [pv])

  // ── Per-session: what limits each EV can receive from this charger ──
  const sessionAnalysis = useMemo(() => {
    return chargingSessions.map((s) => {
      const evMax = s.maxAcceptRateKw
      // Charger hardware is absolute ceiling
      const chargerCap = maxHardwareOutput
      // Grid alone (no battery assist)
      const gridOnly = gridConnectionLimit
      // Grid + max discharge
      const gridPlusBattery = gridConnectionLimit + maxDischargeRate
      // PV contribution at session hour
      const [hh] = s.startTime.split(":").map(Number)
      const pvKw = pvForCharger[hh] || 0
      // Grid + PV (no battery)
      const gridPlusPv = gridConnectionLimit + pvKw
      // Total available = min(charger HW, grid + battery + PV)
      const totalAvailable = Math.min(
        chargerCap,
        gridConnectionLimit + maxDischargeRate + pvKw
      )
      // Effective rate = min(EV acceptance, total available)
      const effective = Math.min(evMax, totalAvailable)

      // What's the binding constraint?
      let bottleneck: string
      if (evMax <= gridOnly) {
        bottleneck = "EV onboard limit"
      } else if (evMax <= gridPlusPv) {
        bottleneck = "EV (grid+PV sufficient)"
      } else if (evMax <= totalAvailable) {
        bottleneck = "EV (needs battery)"
      } else if (totalAvailable <= chargerCap) {
        bottleneck = "Grid+Batt+PV supply"
      } else {
        bottleneck = "Charger hardware"
      }

      return { ...s, pvKw, gridOnly, gridPlusPv, totalAvailable, effective, bottleneck }
    })
  }, [
    chargingSessions,
    maxHardwareOutput,
    gridConnectionLimit,
    maxDischargeRate,
    pvForCharger,
  ])

  // ── Total energy requested vs cycle budget ──
  const totalEnergyRequested = chargingSessions.reduce(
    (sum, s) => sum + s.energyRequestedKwh,
    0
  )
  const energyAvailableAtStart =
    ((startSoc - socFloor) / 100) * totalCapacity

  // ── Power source stacking chart (per session) ──
  const powerStackData = useMemo(() => {
    return sessionAnalysis.map((s, i) => {
      const gridPortion = Math.min(s.effective, gridConnectionLimit)
      const pvPortion = Math.min(
        Math.max(s.effective - gridPortion, 0),
        s.pvKw
      )
      const batteryPortion = Math.max(
        s.effective - gridPortion - pvPortion,
        0
      )
      return {
        label: `#${i + 1}`,
        vehicleType: s.vehicleType,
        time: s.startTime,
        evMax: s.maxAcceptRateKw,
        effective: s.effective,
        grid: gridPortion,
        pv: pvPortion,
        battery: batteryPortion,
      }
    })
  }, [sessionAnalysis, gridConnectionLimit])

  const stackChartConfig: ChartConfig = {
    grid: { label: "Grid (kW)", color: "var(--chart-2)" },
    pv: { label: "PV Solar (kW)", color: "var(--chart-3)" },
    battery: { label: "Battery (kW)", color: "var(--chart-4)" },
    evMax: { label: "EV Accepts (kW)", color: "var(--muted-foreground)" },
  }

  // ── 15-min available power profile (96 intervals) ──
  const pvProfile1Min = useMemo(() => buildPvProfile1Min(pv), [pv])
  const powerProfile15Min = useMemo(() => {
    const pvAgg = aggregate15Min(pvProfile1Min)
    return pvAgg.map((bin) => {
      const pvKw = Math.round(bin.avg * 100) / 100
      const gridKw = gridConnectionLimit
      const battKw = maxDischargeRate
      const total = Math.min(maxHardwareOutput, gridKw + battKw + pvKw)
      return {
        minute: bin.minute,
        time: bin.time,
        grid: gridKw,
        pv: pvKw,
        batteryHeadroom: Math.min(battKw, Math.max(total - gridKw - pvKw, 0)),
        total,
      }
    })
  }, [pvProfile1Min, gridConnectionLimit, maxDischargeRate, maxHardwareOutput])

  const hourlyProfileConfig: ChartConfig = {
    grid: { label: "Grid (kW)", color: "var(--chart-2)" },
    pv: { label: "PV Solar (kW)", color: "var(--chart-3)" },
    batteryHeadroom: { label: "Battery Headroom (kW)", color: "var(--chart-4)" },
  }

  // ── Constraints table ──
  const constraints = [
    {
      category: "Grid",
      constraint: "Connection limit",
      value: `${gridConnectionLimit} kW`,
      detail: "Low-voltage VDE-AR-N 4100, always available",
    },
    {
      category: "Charger",
      constraint: "Max hardware output",
      value: `${maxHardwareOutput} kW`,
      detail: "Absolute ceiling: grid + battery + PV combined",
    },
    {
      category: "Battery",
      constraint: "Total / usable capacity",
      value: `${totalCapacity} / ${usableCapacity} kWh`,
      detail: `SOC window: ${socFloor}% - ${socCeiling}%`,
    },
    {
      category: "Battery",
      constraint: "Max discharge rate",
      value: `${maxDischargeRate} kW`,
      detail: "C-rate limited",
    },
    {
      category: "Battery",
      constraint: "Energy at start (midnight)",
      value: `${energyAvailableAtStart.toFixed(1)} kWh`,
      detail: `SOC ${startSoc}% down to floor ${socFloor}%`,
    },
    {
      category: "Battery",
      constraint: "Daily discharge budget",
      value: `${maxDailyDischarge} kWh`,
      detail: `${maxDailyCycles} cycles x ${usableCapacity} kWh = hard cap`,
    },
    {
      category: "Battery",
      constraint: "Wear cost per kWh discharged",
      value: `${(wearCostPerKwh * 100).toFixed(2)} ct/kWh`,
      detail: `${cycleLife} cycle life, factored into EMS marginal cost`,
    },
    {
      category: "PV",
      constraint: "Peak PV to charger",
      value: `${Math.max(...pvForCharger).toFixed(1)} kW`,
      detail: `${pv.installedCapacityKwp} kWp x ${pv.chargerSharePercent}% share, peak hour`,
    },
    {
      category: "Demand",
      constraint: "Total energy requested (all EVs)",
      value: `${totalEnergyRequested.toFixed(1)} kWh`,
      detail: `${chargingSessions.length} sessions, based on SOC delta`,
    },
    {
      category: "Demand",
      constraint: "Requested vs. discharge budget",
      value:
        totalEnergyRequested > maxDailyDischarge
          ? `${(totalEnergyRequested - maxDailyDischarge).toFixed(0)} kWh over budget`
          : `${(maxDailyDischarge - totalEnergyRequested).toFixed(0)} kWh headroom`,
      detail:
        totalEnergyRequested > maxDailyDischarge
          ? "Cannot serve all EVs from battery alone -- grid + PV critical"
          : "Within cycle budget if battery is sole supplement",
    },
  ]

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Equipment Limits"
        description="Physical constraints and capacity envelope -- inputs only, no simulation"
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="flex w-full flex-col gap-4 md:gap-6">
          {/* Explainer */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="flex gap-3 py-4">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="text-sm text-foreground">
                <p className="font-medium">
                  This page shows physical equipment constraints only -- no simulation results.
                </p>
                <p className="mt-1 text-muted-foreground">
                  It answers: "What can this charger physically deliver?" The charts show the
                  maximum theoretical power from each source (grid, battery, PV) and per-session
                  bottleneck analysis. Actual energy delivered per session depends on the BMS/EMS
                  strategy which is configured on later screens.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Summary Cards -- only hard physical facts */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Card className="py-3">
              <CardContent className="flex flex-col items-center gap-1 text-center">
                <Plug className="size-4 text-chart-2" />
                <p className="text-lg font-bold tabular-nums text-foreground">
                  {gridConnectionLimit}
                </p>
                <p className="text-[10px] leading-tight text-muted-foreground">
                  Grid Limit (kW)
                </p>
              </CardContent>
            </Card>

            <Card className="py-3">
              <CardContent className="flex flex-col items-center gap-1 text-center">
                <Zap className="size-4 text-chart-1" />
                <p className="text-lg font-bold tabular-nums text-foreground">
                  {maxHardwareOutput}
                </p>
                <p className="text-[10px] leading-tight text-muted-foreground">
                  Max Output (kW)
                </p>
              </CardContent>
            </Card>

            <Card className="py-3">
              <CardContent className="flex flex-col items-center gap-1 text-center">
                <Battery className="size-4 text-chart-4" />
                <p className="text-lg font-bold tabular-nums text-foreground">
                  {maxDischargeRate}
                </p>
                <p className="text-[10px] leading-tight text-muted-foreground">
                  Max Discharge (kW)
                </p>
              </CardContent>
            </Card>

            <Card className="py-3">
              <CardContent className="flex flex-col items-center gap-1 text-center">
                <ArrowDownUp className="size-4 text-destructive" />
                <p className="text-lg font-bold tabular-nums text-foreground">
                  {maxDailyDischarge}
                </p>
                <p className="text-[10px] leading-tight text-muted-foreground">
                  Cycle Budget (kWh/day)
                </p>
              </CardContent>
            </Card>

            <Card className="py-3">
              <CardContent className="flex flex-col items-center gap-1 text-center">
                <Sun className="size-4 text-chart-3" />
                <p className="text-lg font-bold tabular-nums text-foreground">
                  {Math.max(...pvForCharger).toFixed(0)}
                </p>
                <p className="text-[10px] leading-tight text-muted-foreground">
                  Peak PV (kW)
                </p>
              </CardContent>
            </Card>

            <Card className="py-3">
              <CardContent className="flex flex-col items-center gap-1 text-center">
                <BatteryCharging className="size-4 text-muted-foreground" />
                <p className="text-lg font-bold tabular-nums text-foreground">
                  {totalEnergyRequested.toFixed(0)} kWh
                </p>
                <p className="text-[10px] leading-tight text-muted-foreground mb-1">
                  Energy Requested
                </p>
                <EnergyRequestedTooltip
                  sessions={chargingSessions}
                  totalKwh={totalEnergyRequested}
                  variant="compact"
                />
              </CardContent>
            </Card>
          </div>

          {/* Chart 1: Hourly Available Power Profile (24h) */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-chart-2/10">
                  <Gauge className="size-4 text-chart-2" />
                </div>
                <div>
                  <CardTitle className="text-base">
                    Available Power Capacity (15-min)
                  </CardTitle>
                  <CardDescription>
                    Maximum theoretical power at 15-min intervals from 1-min data,
                    stacked by source. PV varies with solar irradiance.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <ChartContainer config={hourlyProfileConfig} className="h-72 w-full">
                <ComposedChart
                  data={powerProfile15Min}
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
                    domain={[0, maxHardwareOutput * 1.1]}
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
                  <Bar
                    dataKey="grid"
                    stackId="power"
                    fill="var(--chart-2)"
                    radius={[0, 0, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="pv"
                    stackId="power"
                    fill="var(--chart-3)"
                    radius={[0, 0, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="batteryHeadroom"
                    stackId="power"
                    fill="var(--chart-4)"
                    fillOpacity={0.5}
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  />
                  <ReferenceLine
                    y={maxHardwareOutput}
                    stroke="var(--destructive)"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{
                      value: `HW Max ${maxHardwareOutput} kW`,
                      position: "insideTopRight",
                      style: { fontSize: 10, fill: "var(--destructive)" },
                    }}
                  />
                </ComposedChart>
              </ChartContainer>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-2)" }} />
                  Grid ({gridConnectionLimit} kW constant)
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-3)" }} />
                  PV Solar (varies with sun)
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-sm opacity-50" style={{ background: "var(--chart-4)" }} />
                  Battery headroom (if SOC allows)
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Chart 2: Per-Session Power Source Breakdown */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-chart-1/10">
                  <Zap className="size-4 text-chart-1" />
                </div>
                <div>
                  <CardTitle className="text-base">
                    Per-Session Power Source Breakdown
                  </CardTitle>
                  <CardDescription>
                    How power would be sourced for each session at its max acceptance
                    rate. The dot shows what the EV can accept -- bars show what the
                    charger can supply from each source.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <ChartContainer config={stackChartConfig} className="h-72 w-full">
                <ComposedChart
                  data={powerStackData}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 9 }}
                    interval={0}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10 }}
                    width={40}
                    domain={[0, 280]}
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
                          const d = payload?.[0]?.payload
                          return d ? `${d.time} - ${d.vehicleType}` : ""
                        }}
                      />
                    }
                  />
                  <Bar
                    dataKey="grid"
                    stackId="source"
                    fill="var(--chart-2)"
                    radius={[0, 0, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="pv"
                    stackId="source"
                    fill="var(--chart-3)"
                    radius={[0, 0, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="battery"
                    stackId="source"
                    fill="var(--chart-4)"
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Line
                    type="step"
                    dataKey="evMax"
                    stroke="var(--muted-foreground)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={{ r: 3, fill: "var(--muted-foreground)" }}
                    isAnimationActive={false}
                    name="EV Accepts"
                  />
                  <ReferenceLine
                    y={gridConnectionLimit}
                    stroke="var(--chart-2)"
                    strokeDasharray="8 4"
                    strokeWidth={1}
                  />
                  <ReferenceLine
                    y={maxHardwareOutput}
                    stroke="var(--destructive)"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                  />
                </ComposedChart>
              </ChartContainer>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-2)" }} />
                  Grid
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-3)" }} />
                  PV Solar
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-4)" }} />
                  Battery
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-4 border-t border-dashed border-muted-foreground" />
                  EV max accept rate
                </div>
              </div>
            </CardContent>
          </Card>

          {/* All Constraints Table */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                  <Gauge className="size-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">
                    All Equipment Constraints
                  </CardTitle>
                  <CardDescription>
                    Every physical and operational limit the BMS/EMS must respect
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20 pl-4 text-xs">Category</TableHead>
                    <TableHead className="text-xs">Constraint</TableHead>
                    <TableHead className="text-xs">Value</TableHead>
                    <TableHead className="pr-4 text-xs">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {constraints.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            row.category === "Grid"
                              ? "bg-chart-2/10 text-chart-2"
                              : row.category === "Charger"
                              ? "bg-chart-1/10 text-chart-1"
                              : row.category === "Battery"
                              ? "bg-chart-4/10 text-chart-4"
                              : row.category === "PV"
                              ? "bg-chart-3/10 text-chart-3"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {row.category}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {row.constraint}
                      </TableCell>
                      <TableCell className="font-mono text-sm tabular-nums">
                        {row.value}
                      </TableCell>
                      <TableCell className="pr-4 text-xs text-muted-foreground">
                        {row.detail}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Per-Session Bottleneck Analysis */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-chart-4/10">
                  <BatteryCharging className="size-4 text-chart-4" />
                </div>
                <div>
                  <CardTitle className="text-base">
                    Per-Session Bottleneck Analysis
                  </CardTitle>
                  <CardDescription>
                    For each EV: what is the binding constraint on charging speed?
                    Single connector -- sessions are sequential, not concurrent.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 pl-4 text-xs">#</TableHead>
                      <TableHead className="text-xs">Time</TableHead>
                      <TableHead className="text-xs">Vehicle</TableHead>
                      <TableHead className="text-xs text-right">EV Max</TableHead>
                      <TableHead className="text-xs text-right">Available</TableHead>
                      <TableHead className="text-xs text-right">Effective</TableHead>
                      <TableHead className="text-xs text-right">Energy Req.</TableHead>
                      <TableHead className="pr-4 text-xs">Bottleneck</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessionAnalysis.map((s, i) => (
                      <TableRow key={s.id}>
                        <TableCell className="pl-4 font-mono text-xs text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {s.startTime}
                        </TableCell>
                        <TableCell className="text-xs max-w-32 truncate">
                          {s.vehicleType}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {s.maxAcceptRateKw} kW
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {s.totalAvailable} kW
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums font-medium">
                          {s.effective} kW
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {s.energyRequestedKwh.toFixed(1)}
                        </TableCell>
                        <TableCell className="pr-4">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              s.bottleneck.includes("EV")
                                ? "bg-primary/10 text-primary"
                                : s.bottleneck.includes("battery")
                                ? "bg-chart-4/10 text-chart-4"
                                : s.bottleneck.includes("hardware")
                                ? "bg-destructive/10 text-destructive"
                                : "bg-chart-2/10 text-chart-2"
                            }`}
                          >
                            {s.bottleneck}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          {/* Sources & References */}
          <SourcesCitation
            title="Sources: Equipment Specifications & Limits"
            sources={[
              {
                label: "ADS-TEC Energy -- ChargePost CP320 Product Page",
                url: "https://www.ads-tec-energy.com/en/products/chargepost-cp320/",
                detail: "Max hardware output 320 kW (2x160 kW CCS), grid connection 80 kW (63A 3-phase), integrated 143 kWh LFP battery. Single connector sequential operation.",
                date: "2024",
              },
              {
                label: "ADS-TEC Energy -- ChargePost CP320 Datasheet (PDF)",
                url: "https://www.ads-tec-energy.com/fileadmin/user_upload/Downloads/Data_Sheets/ADS-TEC_Energy_ChargePost_CP320_DataSheet.pdf",
                detail: "Max discharge rate 150 kW (~1.05C), max charge rate 80 kW (~0.56C), SOC operating range 20-90%, usable capacity 100 kWh.",
                date: "2024",
              },
              {
                label: "EV Database -- Vehicle Charging Specifications",
                url: "https://ev-database.org/",
                detail: "Per-vehicle max DC accept rates used in bottleneck analysis: Tesla Model 3 (170 kW), VW ID.4 (135 kW), BMW iX (195 kW), etc.",
                date: "2024",
              },
              {
                label: "Battery University -- LFP Cycle Life & Depth of Discharge",
                url: "https://batteryuniversity.com/article/bu-808-how-to-prolong-lithium-based-batteries",
                detail: "LFP cycle life ~5000 cycles at 70% DoD. Wear cost derivation: replacement cost / (cycle life x usable capacity) = ct/kWh wear.",
              },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
