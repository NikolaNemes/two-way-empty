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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { NumericField, TextField } from "@/components/numeric-field"
import { useSimulation } from "@/lib/simulation-store"
import { PageHeader } from "@/components/page-header"
import { SourcesCitation } from "@/components/sources-citation"

import { minuteToTimeStr, buildPvProfile1Min, aggregate15Min } from "@/lib/disaggregate"
import {
  Cpu,
  Grid3X3,
  Battery,
  Wrench,
  Clock,
  Sun,
  Shield,
  Gauge,
  Plug,
  Zap,
  Info,
  BatteryCharging,
  ArrowDownUp,
} from "lucide-react"

export function SiteSetupScreen() {
  const {
    siteSetup,
    chargingSessions,
    updateCharger,
    updateGrid,
    updateBattery,
    updateWear,
    updatePv,
    updateSimulation,
  } = useSimulation()

  const { charger, grid, battery, wear, pv, simulation } = siteSetup

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Location Setup"
        description="Physical equipment specifications, operational constraints, and capacity envelope"
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="flex w-full flex-col gap-4 md:gap-6">
          <Tabs defaultValue="config" className="w-full">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="config" className="gap-1.5">
                <Cpu className="size-3.5" />
                Configuration
              </TabsTrigger>
              <TabsTrigger value="constraints" className="gap-1.5">
                <Gauge className="size-3.5" />
                Constraints & Capacity
              </TabsTrigger>
            </TabsList>

            {/* ── Tab 1: Configuration (editable inputs) ── */}
            <TabsContent value="config" className="mt-4 space-y-6">
              <ConfigurationTab
                charger={charger}
                grid={grid}
                battery={battery}
                wear={wear}
                pv={pv}
                simulation={simulation}
                updateCharger={updateCharger}
                updateGrid={updateGrid}
                updateBattery={updateBattery}
                updateWear={updateWear}
                updatePv={updatePv}
                updateSimulation={updateSimulation}
              />
            </TabsContent>

            {/* ── Tab 2: Constraints & Capacity (visual) ── */}
            <TabsContent value="constraints" className="mt-4 space-y-6">
              <ConstraintsTab
                siteSetup={siteSetup}
                chargingSessions={chargingSessions}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}

// ── Configuration Tab ──
function ConfigurationTab({
  charger,
  grid,
  battery,
  wear,
  pv,
  simulation,
  updateCharger,
  updateGrid,
  updateBattery,
  updateWear,
  updatePv,
  updateSimulation,
}: {
  charger: any
  grid: any
  battery: any
  wear: any
  pv: any
  simulation: any
  updateCharger: any
  updateGrid: any
  updateBattery: any
  updateWear: any
  updatePv: any
  updateSimulation: any
}) {
  return (
    <>
      {/* Row 1: Charger + Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                <Cpu className="size-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Charger Hardware</CardTitle>
                <CardDescription>Charging unit specifications</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Charger Model"
                value={charger.model}
                onChange={(v) => updateCharger({ model: v })}
              />
              <NumericField
                label="Max Hardware Output"
                value={charger.maxHardwareOutput}
                unit="kW"
                onChange={(v) => updateCharger({ maxHardwareOutput: v })}
                min={0}
                step={10}
                hint="Grid + Battery combined"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                <Grid3X3 className="size-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Grid Connection</CardTitle>
                <CardDescription>Utility grid parameters</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <NumericField
              label="Grid Connection Limit"
              value={grid.gridConnectionLimit}
              unit="kW"
              onChange={(v) => updateGrid({ gridConnectionLimit: v })}
              min={0}
              step={5}
              hint="Low voltage limit (VDE-AR-N 4100)"
            />
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Battery Pack */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
              <Battery className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Battery Pack</CardTitle>
              <CardDescription>Integrated battery storage parameters</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumericField label="Total Capacity" value={battery.totalCapacity} unit="kWh" onChange={(v) => updateBattery({ totalCapacity: v })} min={0} step={1} hint="Cell-level total" />
            <NumericField label="SOC Floor" value={battery.socFloor} unit="%" onChange={(v) => updateBattery({ socFloor: v })} min={0} max={100} step={1} hint="Hard minimum state of charge" />
            <NumericField label="SOC Ceiling" value={battery.socCeiling} unit="%" onChange={(v) => updateBattery({ socCeiling: v })} min={0} max={100} step={1} hint="Tapers above 85%" />
            <NumericField label="Usable Capacity" value={battery.usableCapacity} unit="kWh" onChange={(v) => updateBattery({ usableCapacity: v })} min={0} step={1} hint="Total x (Ceiling - Floor) / 100" />
            <NumericField label="Max Discharge Rate" value={battery.maxDischargeRate} unit="kW" onChange={(v) => updateBattery({ maxDischargeRate: v })} min={0} step={5} hint="Power OUT to EV/grid" />
            <NumericField label="Max Charge Rate" value={battery.maxChargeRate} unit="kW" onChange={(v) => updateBattery({ maxChargeRate: v })} min={0} step={5} hint="Power IN from grid/PV" />
            <NumericField label="Start SOC (midnight)" value={battery.startSoc} unit="%" onChange={(v) => updateBattery({ startSoc: v })} min={0} max={100} step={1} hint="Beginning of simulation day" />
            <NumericField label="Round-Trip Efficiency" value={Math.round(battery.roundTripEfficiency * 100)} unit="%" onChange={(v) => updateBattery({ roundTripEfficiency: v / 100 })} min={80} max={100} step={1} hint="LFP ~90%, NMC ~88-92%" />
          </div>
        </CardContent>
      </Card>

      {/* Row 3: PV Solar Plant */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-chart-3/10">
              <Sun className="size-4 text-chart-3" />
            </div>
            <div>
              <CardTitle className="text-base">PV Solar Plant</CardTitle>
              <CardDescription>Rooftop PV on supermarket -- partial allocation to charger</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumericField label="Installed Capacity" value={pv.installedCapacityKwp} unit="kWp" onChange={(v) => updatePv({ installedCapacityKwp: v })} min={0} step={10} hint="Total PV plant size" />
            <NumericField label="Charger Share" value={pv.chargerSharePercent} unit="%" onChange={(v) => updatePv({ chargerSharePercent: v })} min={0} max={100} step={5} hint="Rest is PPA with supermarket" />
            <NumericField label="System Losses" value={pv.systemLossPercent} unit="%" onChange={(v) => updatePv({ systemLossPercent: v })} min={0} max={50} step={1} hint="Cables, inverter, soiling" />
            <NumericField label="Azimuth" value={pv.azimuthDeg} unit="deg" onChange={(v) => updatePv({ azimuthDeg: v })} min={-180} max={180} step={5} hint="0 = south" />
            <NumericField label="Tilt Angle" value={pv.tiltDeg} unit="deg" onChange={(v) => updatePv({ tiltDeg: v })} min={0} max={90} step={5} hint="Typical 30 deg for Germany" />
            <div className="rounded-md bg-muted p-3 flex flex-col justify-center">
              <p className="text-xs text-muted-foreground">Charger receives up to</p>
              <p className="text-lg font-semibold font-mono text-foreground">
                {Math.round(pv.installedCapacityKwp * pv.chargerSharePercent / 100 * (1 - pv.systemLossPercent / 100))} kWp
              </p>
              <p className="text-xs text-muted-foreground">effective peak for charging</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Row 4: Battery Wear + Simulation */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                <Wrench className="size-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Battery Wear Model</CardTitle>
                <CardDescription>Cycle degradation and replacement economics</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <NumericField label="Cycle Life" value={wear.cycleLife} unit="cycles" onChange={(v) => updateWear({ cycleLife: v })} min={1} step={100} hint="Calendar + cycle degradation" />
              <NumericField label="Battery Replacement Cost" value={wear.batteryReplacementCost} unit="EUR" onChange={(v) => updateWear({ batteryReplacementCost: v })} min={0} step={250} hint="250 EUR/kWh cell cost" />
              <NumericField label="Max Daily Cycles" value={wear.maxDailyCycles} unit="cycles" onChange={(v) => updateWear({ maxDailyCycles: v })} min={0} step={0.5} hint="Hard cap per day" />
              <NumericField label="Max Daily Discharge" value={wear.maxDailyDischarge} unit="kWh" onChange={(v) => updateWear({ maxDailyDischarge: v })} min={0} step={10} hint="Max Cycles x Usable Capacity" />
              <NumericField label="Cost per Cycle" value={wear.costPerCycle} unit="EUR" onChange={(v) => updateWear({ costPerCycle: v })} min={0} step={0.01} hint="Replacement / Cycle Life" />
              <NumericField label="Wear Cost per kWh" value={wear.wearCostPerKwh} unit="EUR/kWh" onChange={(v) => updateWear({ wearCostPerKwh: v })} min={0} step={0.001} hint="Cost per Cycle / Usable Capacity" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                <Clock className="size-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Simulation</CardTitle>
                <CardDescription>Time resolution settings</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <NumericField label="Time Resolution" value={simulation.timeResolution} unit="min" onChange={(v) => updateSimulation({ timeResolution: v })} min={1} max={60} step={5} hint="96 slots/day at 15 min" />
            <div className="mt-4 rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{Math.floor(1440 / simulation.timeResolution)}</span> time slots per day
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

// ── Constraints & Capacity Tab ──
function ConstraintsTab({
  siteSetup,
  chargingSessions,
}: {
  siteSetup: any
  chargingSessions: any[]
}) {
  const {
    grid: { gridConnectionLimit },
    battery: { totalCapacity, usableCapacity, socFloor, socCeiling, maxDischargeRate, maxChargeRate, startSoc },
    charger: { maxHardwareOutput },
    wear: { maxDailyDischarge, maxDailyCycles, cycleLife, wearCostPerKwh },
    pv,
  } = siteSetup

  // PV output for charger (hourly, kW)
  const pvForCharger = useMemo(() => {
    const effectiveKwp = pv.installedCapacityKwp * (pv.chargerSharePercent / 100) * (1 - pv.systemLossPercent / 100)
    return pv.hourlyCapacityFactors.map((cf: number) => Math.round(cf * effectiveKwp * 10) / 10)
  }, [pv])

  // Per-session analysis
  const sessionAnalysis = useMemo(() => {
    return chargingSessions.map((s: any) => {
      const evMax = s.maxAcceptRateKw
      const chargerCap = maxHardwareOutput
      const gridOnly = gridConnectionLimit
      const gridPlusBattery = gridConnectionLimit + maxDischargeRate
      const [hh] = s.startTime.split(":").map(Number)
      const pvKw = pvForCharger[hh] || 0
      const gridPlusPv = gridConnectionLimit + pvKw
      const totalAvailable = Math.min(chargerCap, gridConnectionLimit + maxDischargeRate + pvKw)
      const effective = Math.min(evMax, totalAvailable)

      let bottleneck: string
      if (evMax <= gridOnly) bottleneck = "EV onboard limit"
      else if (evMax <= gridPlusPv) bottleneck = "EV (grid+PV sufficient)"
      else if (evMax <= totalAvailable) bottleneck = "EV (needs battery)"
      else if (totalAvailable <= chargerCap) bottleneck = "Grid+Batt+PV supply"
      else bottleneck = "Charger hardware"

      return { ...s, pvKw, gridOnly, gridPlusPv, totalAvailable, effective, bottleneck }
    })
  }, [chargingSessions, maxHardwareOutput, gridConnectionLimit, maxDischargeRate, pvForCharger])

  const energyAvailableAtStart = ((startSoc - socFloor) / 100) * totalCapacity

  // Power source stacking chart (per session)
  const powerStackData = useMemo(() => {
    return sessionAnalysis.map((s: any, i: number) => {
      const gridPortion = Math.min(s.effective, gridConnectionLimit)
      const pvPortion = Math.min(Math.max(s.effective - gridPortion, 0), s.pvKw)
      const batteryPortion = Math.max(s.effective - gridPortion - pvPortion, 0)
      return { label: `#${i + 1}`, vehicleType: s.vehicleType, time: s.startTime, evMax: s.maxAcceptRateKw, effective: s.effective, grid: gridPortion, pv: pvPortion, battery: batteryPortion }
    })
  }, [sessionAnalysis, gridConnectionLimit])

  const stackChartConfig: ChartConfig = {
    grid: { label: "Grid (kW)", color: "var(--chart-2)" },
    pv: { label: "PV Solar (kW)", color: "var(--chart-3)" },
    battery: { label: "Battery (kW)", color: "var(--chart-4)" },
    evMax: { label: "EV Accepts (kW)", color: "var(--muted-foreground)" },
  }

  // 15-min available power profile
  const pvProfile1Min = useMemo(() => buildPvProfile1Min(pv), [pv])
  const powerProfile15Min = useMemo(() => {
    const pvAgg = aggregate15Min(pvProfile1Min)
    return pvAgg.map((bin) => {
      const pvKw = Math.round(bin.avg * 100) / 100
      const gridKw = gridConnectionLimit
      const battKw = maxDischargeRate
      const total = Math.min(maxHardwareOutput, gridKw + battKw + pvKw)
      return { minute: bin.minute, time: bin.time, grid: gridKw, pv: pvKw, batteryHeadroom: Math.min(battKw, Math.max(total - gridKw - pvKw, 0)), total }
    })
  }, [pvProfile1Min, gridConnectionLimit, maxDischargeRate, maxHardwareOutput])

  const hourlyProfileConfig: ChartConfig = {
    grid: { label: "Grid (kW)", color: "var(--chart-2)" },
    pv: { label: "PV Solar (kW)", color: "var(--chart-3)" },
    batteryHeadroom: { label: "Battery Headroom (kW)", color: "var(--chart-4)" },
  }

  const constraints = [
    { category: "Grid", constraint: "Connection limit", value: `${gridConnectionLimit} kW`, detail: "Low-voltage VDE-AR-N 4100, always available" },
    { category: "Charger", constraint: "Max hardware output", value: `${maxHardwareOutput} kW`, detail: "Absolute ceiling: grid + battery + PV combined" },
    { category: "Battery", constraint: "Total / usable capacity", value: `${totalCapacity} / ${usableCapacity} kWh`, detail: `SOC window: ${socFloor}% - ${socCeiling}%` },
    { category: "Battery", constraint: "Max discharge rate", value: `${maxDischargeRate} kW`, detail: `~${(maxDischargeRate / totalCapacity).toFixed(2)}C -- power OUT to EV/grid` },
    { category: "Battery", constraint: "Max charge rate", value: `${maxChargeRate} kW`, detail: `~${(maxChargeRate / totalCapacity).toFixed(2)}C -- power IN from grid/PV` },
    { category: "Battery", constraint: "Round-trip efficiency", value: `${Math.round(siteSetup.battery.roundTripEfficiency * 100)}%`, detail: `${Math.round(Math.sqrt(siteSetup.battery.roundTripEfficiency) * 100)}% per leg (charge / discharge)` },
    { category: "Battery", constraint: "Energy at start (midnight)", value: `${energyAvailableAtStart.toFixed(1)} kWh`, detail: `SOC ${startSoc}% down to floor ${socFloor}%` },
    { category: "Battery", constraint: "Daily discharge budget", value: `${maxDailyDischarge} kWh`, detail: `${maxDailyCycles} cycles x ${usableCapacity} kWh = hard cap` },
    { category: "Battery", constraint: "Wear cost per kWh discharged", value: `${(wearCostPerKwh * 100).toFixed(2)} ct/kWh`, detail: `${cycleLife} cycle life, factored into EMS marginal cost` },
    { category: "PV", constraint: "Peak PV to charger", value: `${Math.max(...pvForCharger).toFixed(1)} kW`, detail: `${pv.installedCapacityKwp} kWp x ${pv.chargerSharePercent}% share, peak hour` },
  ]

  return (
    <>
      {/* Explainer */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex gap-3 py-4">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="text-sm text-foreground">
            <p className="font-medium">Physical equipment constraints only -- no simulation results.</p>
            <p className="mt-1 text-muted-foreground">
              This shows the maximum theoretical power from each source (grid, battery, PV) and per-session
              bottleneck analysis. Actual energy delivered per session depends on the BMS/EMS strategy.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Card className="py-3">
          <CardContent className="flex flex-col items-center gap-1 text-center">
            <Plug className="size-4 text-chart-2" />
            <p className="text-lg font-bold tabular-nums text-foreground">{gridConnectionLimit}</p>
            <p className="text-[10px] leading-tight text-muted-foreground">Grid Limit (kW)</p>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="flex flex-col items-center gap-1 text-center">
            <Zap className="size-4 text-chart-1" />
            <p className="text-lg font-bold tabular-nums text-foreground">{maxHardwareOutput}</p>
            <p className="text-[10px] leading-tight text-muted-foreground">Max Output (kW)</p>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="flex flex-col items-center gap-1 text-center">
            <Battery className="size-4 text-chart-4" />
            <p className="text-lg font-bold tabular-nums text-foreground">{maxDischargeRate}</p>
            <p className="text-[10px] leading-tight text-muted-foreground">Max Discharge (kW)</p>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="flex flex-col items-center gap-1 text-center">
            <BatteryCharging className="size-4 text-chart-3" />
            <p className="text-lg font-bold tabular-nums text-foreground">{maxChargeRate}</p>
            <p className="text-[10px] leading-tight text-muted-foreground">Max Charge (kW)</p>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="flex flex-col items-center gap-1 text-center">
            <ArrowDownUp className="size-4 text-destructive" />
            <p className="text-lg font-bold tabular-nums text-foreground">{maxDailyDischarge}</p>
            <p className="text-[10px] leading-tight text-muted-foreground">Cycle Budget (kWh/day)</p>
          </CardContent>
        </Card>
        <Card className="py-3">
          <CardContent className="flex flex-col items-center gap-1 text-center">
            <Sun className="size-4 text-chart-3" />
            <p className="text-lg font-bold tabular-nums text-foreground">{Math.max(...pvForCharger).toFixed(0)}</p>
            <p className="text-[10px] leading-tight text-muted-foreground">Peak PV (kW)</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart 1: 15-min Available Power Profile */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-chart-2/10">
              <Gauge className="size-4 text-chart-2" />
            </div>
            <div>
              <CardTitle className="text-base">Available Power Capacity (15-min)</CardTitle>
              <CardDescription>Maximum theoretical power at 15-min intervals, stacked by source. PV varies with solar irradiance.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <ChartContainer config={hourlyProfileConfig} className="h-72 w-full">
            <ComposedChart data={powerProfile15Min} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={3} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={40} domain={[0, maxHardwareOutput * 1.1]} label={{ value: "kW", position: "insideLeft", offset: 10, style: { fontSize: 10, fill: "var(--muted-foreground)" } }} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => payload?.[0]?.payload?.time || ""} />} />
              <Bar dataKey="grid" stackId="power" fill="var(--chart-2)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="pv" stackId="power" fill="var(--chart-3)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="batteryHeadroom" stackId="power" fill="var(--chart-4)" fillOpacity={0.5} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              <ReferenceLine y={maxHardwareOutput} stroke="var(--destructive)" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: `HW Max ${maxHardwareOutput} kW`, position: "insideTopRight", style: { fontSize: 10, fill: "var(--destructive)" } }} />
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
              <CardTitle className="text-base">Per-Session Power Source Breakdown</CardTitle>
              <CardDescription>How power would be sourced for each session at its max acceptance rate. The dot shows what the EV can accept.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <ChartContainer config={stackChartConfig} className="h-72 w-full">
            <ComposedChart data={powerStackData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} interval={0} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={40} domain={[0, 280]} label={{ value: "kW", position: "insideLeft", offset: 10, style: { fontSize: 10, fill: "var(--muted-foreground)" } }} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => { const d = payload?.[0]?.payload; return d ? `${d.time} - ${d.vehicleType}` : "" }} />} />
              <Bar dataKey="grid" stackId="source" fill="var(--chart-2)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="pv" stackId="source" fill="var(--chart-3)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="battery" stackId="source" fill="var(--chart-4)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              <Line type="step" dataKey="evMax" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 3, fill: "var(--muted-foreground)" }} isAnimationActive={false} name="EV Accepts" />
              <ReferenceLine y={gridConnectionLimit} stroke="var(--chart-2)" strokeDasharray="8 4" strokeWidth={1} />
              <ReferenceLine y={maxHardwareOutput} stroke="var(--destructive)" strokeDasharray="4 4" strokeWidth={1} />
            </ComposedChart>
          </ChartContainer>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-2)" }} />Grid
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-3)" }} />PV Solar
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-4)" }} />Battery
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 border-t border-dashed border-muted-foreground" />EV max accept rate
            </div>
          </div>
        </CardContent>
      </Card>

      {/* All Constraints Table */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
              <Shield className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">All Equipment Constraints</CardTitle>
              <CardDescription>Every physical and operational limit the BMS/EMS must respect</CardDescription>
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
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      row.category === "Grid" ? "bg-chart-2/10 text-chart-2"
                        : row.category === "Charger" ? "bg-chart-1/10 text-chart-1"
                        : row.category === "Battery" ? "bg-chart-4/10 text-chart-4"
                        : row.category === "PV" ? "bg-chart-3/10 text-chart-3"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {row.category}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm font-medium">{row.constraint}</TableCell>
                  <TableCell className="font-mono text-sm tabular-nums">{row.value}</TableCell>
                  <TableCell className="pr-4 text-xs text-muted-foreground">{row.detail}</TableCell>
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
              <CardTitle className="text-base">Per-Session Bottleneck Analysis</CardTitle>
              <CardDescription>For each EV: what is the binding constraint on charging speed? Single connector -- sessions are sequential.</CardDescription>
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
                {sessionAnalysis.map((s: any, i: number) => (
                  <TableRow key={s.id}>
                    <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{s.startTime}</TableCell>
                    <TableCell className="text-xs max-w-32 truncate">{s.vehicleType}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{s.maxAcceptRateKw} kW</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{s.totalAvailable} kW</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums font-medium">{s.effective} kW</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{s.energyRequestedKwh.toFixed(1)}</TableCell>
                    <TableCell className="pr-4">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        s.bottleneck.includes("EV") ? "bg-primary/10 text-primary"
                          : s.bottleneck.includes("battery") ? "bg-chart-4/10 text-chart-4"
                          : s.bottleneck.includes("hardware") ? "bg-destructive/10 text-destructive"
                          : "bg-chart-2/10 text-chart-2"
                      }`}>
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
        title="Sources: Site Setup & Equipment"
        sources={[
          {
            label: "ADS-TEC Energy -- ChargePost CP320 Product Page",
            url: "https://www.ads-tec-energy.com/en/products/chargepost-cp320/",
            detail: "Max hardware output 320 kW (2x160 kW connectors), integrated 143 kWh LFP battery, max discharge rate 150 kW. Product specifications for battery-buffered HPC.",
            date: "2024",
          },
          {
            label: "ADS-TEC Energy -- ChargePost CP320 Datasheet (PDF)",
            url: "https://www.ads-tec-energy.com/fileadmin/user_upload/Downloads/Data_Sheets/ADS-TEC_Energy_ChargePost_CP320_DataSheet.pdf",
            detail: "Battery capacity 143 kWh (LFP), SOC operating range 20-90%, grid connection 80 kW (63A 3-phase), charge/discharge C-rates.",
            date: "2024",
          },
          {
            label: "PVGIS -- Photovoltaic Geographical Information System (EU JRC)",
            url: "https://re.jrc.ec.europa.eu/pvg_tools/en/",
            detail: "Hourly capacity factors for PV systems at ~48 deg N (southern Germany), crystalline silicon, 30 deg tilt south-facing. Used to generate the 24h PV profile.",
            date: "2024",
          },
          {
            label: "Fraunhofer ISE -- Photovoltaics Report",
            url: "https://www.ise.fraunhofer.de/en/publications/studies/photovoltaics-report.html",
            detail: "System loss assumptions (~14%), typical capacity factors for German PV installations, degradation rates.",
            date: "2024",
          },
          {
            label: "ADS-TEC Energy -- Grid Connection Requirements",
            url: "https://www.ads-tec-energy.com/en/solutions/grid-friendly-charging/",
            detail: "80 kW grid connection limit enables HPC at low-power sites. Battery buffers the difference between grid capacity and EV demand.",
            date: "2024",
          },
          {
            label: "Battery University -- BU-808: How to Prolong Lithium-based Batteries",
            url: "https://batteryuniversity.com/article/bu-808-how-to-prolong-lithium-based-batteries",
            detail: "LFP cycle life ~3000-6000 cycles at 80% DoD, SOC floor/ceiling recommendations for longevity (20-90%), calendar aging effects of high SOC storage.",
          },
        ]}
      />
    </>
  )
}
