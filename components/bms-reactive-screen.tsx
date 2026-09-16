"use client"

import { useMemo } from "react"
import { useSimulation } from "@/lib/simulation-store"
import { PageHeader } from "@/components/page-header"
  import { StaleSimulationBanner } from "@/components/stale-simulation-banner"
  import { SourcesCitation } from "@/components/sources-citation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ChartContainer } from "@/components/ui/chart"
import {
  Area,
  AreaChart,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from "recharts"
import {
  Battery,
  BatteryCharging,
  Zap,
  Sun,
  Plug,
  TrendingUp,
  TrendingDown,
  Activity,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react"
import { buildPvProfile1Min, aggregate15Min, runReactiveBmsSimulation, minuteToTimeStr, rotateChartData } from "@/lib/disaggregate"

function NumericParam({
  label,
  value,
  unit,
  onChange,
  min = 0,
  max,
  step = 1,
  hint,
}: {
  label: string
  value: number
  unit: string
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  hint?: string
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={min}
          max={max}
          step={step}
          className="h-8 w-24 font-mono text-sm tabular-nums"
        />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function BmsReactiveScreen() {
  const { siteSetup, chargingSessions, bmsConfig, updateBmsConfig, snapshot } = useSimulation()

  // Compute from snapshot (frozen at last "Run Simulation" click)
  const pvProfile1Min = useMemo(() => buildPvProfile1Min(snapshot.siteSetup.pv), [snapshot])

  const result = useMemo(
    () => runReactiveBmsSimulation(snapshot.siteSetup, snapshot.gridPricing, snapshot.chargingSessions, snapshot.bmsConfig, pvProfile1Min),
    [snapshot, pvProfile1Min]
  )

  const { summary } = result

  // Aggregate to 15-min for charts (too much data at 1-min for recharts)
  const chart15Min = useMemo(() => {
    const slots: {
      time: string
      minute: number
      pvToEv: number
      gridToEv: number
      batteryToEv: number
      totalToEv: number
      gridToBattery: number
      pvToBattery: number
      // Idle vs trickle breakdown for battery charging
      pvToBattIdle: number
      gridToBattIdle: number
      pvToBattTrickle: number
      gridToBattTrickle: number
      totalBattCharge: number
      pvToGrid: number
      batterySocPct: number
      totalGridDraw: number
      evMaxAccept: number
      evConnectedMinutes: number
    }[] = []

    for (let s = 0; s < 96; s++) {
      const startMin = s * 15
      const endMin = startMin + 15
      let pvToEv = 0, gridToEv = 0, batteryToEv = 0, totalToEv = 0
      let gridToBattery = 0, pvToBattery = 0, pvToGrid = 0
      let pvToBattIdle = 0, gridToBattIdle = 0
      let pvToBattTrickle = 0, gridToBattTrickle = 0
      let totalGridDraw = 0, evMaxAccept = 0
      let socSum = 0, evMinutes = 0

      for (let m = startMin; m < endMin; m++) {
        const d = result.minutes[m]
        pvToEv += d.pvToEvKw
        gridToEv += d.gridToEvKw
        batteryToEv += d.batteryToEvKw
        totalToEv += d.totalToEvKw
        gridToBattery += d.gridToBatteryKw
        pvToBattery += d.pvToBatteryKw
        pvToGrid += d.pvToGridKw
        totalGridDraw += d.totalGridDrawKw
        evMaxAccept += d.evMaxAcceptKw
        socSum += d.batterySocPct
        if (d.evConnected) {
          evMinutes++
          pvToBattTrickle += d.pvToBatteryKw
          gridToBattTrickle += d.gridToBatteryKw
        } else {
          pvToBattIdle += d.pvToBatteryKw
          gridToBattIdle += d.gridToBatteryKw
        }
      }

      const r1 = (v: number) => Math.round((v / 15) * 10) / 10
      slots.push({
        time: minuteToTimeStr(startMin),
        minute: startMin,
        pvToEv: r1(pvToEv),
        gridToEv: r1(gridToEv),
        batteryToEv: r1(batteryToEv),
        totalToEv: r1(totalToEv),
        gridToBattery: r1(gridToBattery),
        pvToBattery: r1(pvToBattery),
        pvToBattIdle: r1(pvToBattIdle),
        gridToBattIdle: r1(gridToBattIdle),
        pvToBattTrickle: r1(pvToBattTrickle),
        gridToBattTrickle: r1(gridToBattTrickle),
        totalBattCharge: r1(pvToBattery + gridToBattery),
        pvToGrid: r1(pvToGrid),
        batterySocPct: Math.round((socSum / 15) * 10) / 10,
        totalGridDraw: r1(totalGridDraw),
        evMaxAccept: r1(evMaxAccept),
        evConnectedMinutes: evMinutes,
      })
    }
    return rotateChartData(slots) // start at 06:00
  }, [result])

  // Per-session delivery table
  const sessionDelivery = useMemo(() => {
    const sorted = [...chargingSessions].sort((a, b) => {
      const aMin = parseInt(a.startTime.split(":")[0]) * 60 + parseInt(a.startTime.split(":")[1])
      const bMin = parseInt(b.startTime.split(":")[0]) * 60 + parseInt(b.startTime.split(":")[1])
      return aMin - bMin
    })

    return sorted.map((s, i) => {
      let delivered = 0
      let pvShare = 0
      let gridShare = 0
      let battShare = 0
      for (const min of result.minutes) {
        const idxs = min.activeSessionIdxs ?? (min.sessionIdx >= 0 ? [min.sessionIdx] : [])
        if (idxs.includes(i)) {
          // Proportional share when multiple sessions active simultaneously
          const activeCount = idxs.length
          let myShare = 1
          if (activeCount > 1) {
            const totalDemand = idxs.reduce((sum, idx) => sum + (sorted[idx]?.maxAcceptRateKw ?? 0), 0)
            myShare = totalDemand > 0 ? s.maxAcceptRateKw / totalDemand : 1 / activeCount
          }
          delivered += (min.totalToEvKw / 60) * myShare
          pvShare += (min.pvToEvKw / 60) * myShare
          gridShare += (min.gridToEvKw / 60) * myShare
          battShare += (min.batteryToEvKw / 60) * myShare
        }
      }
      const pct = s.energyRequestedKwh > 0 ? (delivered / s.energyRequestedKwh) * 100 : 100
      const durationH = s.durationMinutes / 60
      const avgSpeedKw = durationH > 0 ? delivered / durationH : 0
      return {
        ...s,
        idx: i,
        delivered: Math.round(delivered * 10) / 10,
        pvShare: Math.round(pvShare * 10) / 10,
        gridShare: Math.round(gridShare * 10) / 10,
        battShare: Math.round(battShare * 10) / 10,
        pct: Math.round(pct * 10) / 10,
        avgSpeedKw: Math.round(avgSpeedKw * 10) / 10,
        fullyServed: pct >= 99.5,
      }
    })
  }, [chargingSessions, result])

  return (
    <>
    <StaleSimulationBanner />
    <PageHeader
      title="BMS Reactive"
      description="Rule-based battery management -- no forward knowledge, purely reactive to current state"
      />
      <div className="space-y-6 p-6">

        {/* BMS Configuration Inputs */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-chart-4/10">
                <Activity className="size-4 text-chart-4" />
              </div>
              <div>
                <CardTitle className="text-base">BMS Configuration</CardTitle>
                <CardDescription>Tune reactive parameters -- simulation re-runs automatically</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
              <NumericParam
                label="Idle Target SOC"
                value={bmsConfig.idleTargetSoc}
                unit="%"
                onChange={(v) => updateBmsConfig({ idleTargetSoc: v })}
                min={siteSetup.battery.socFloor}
                max={siteSetup.battery.socCeiling}
                step={5}
                hint={`Recharge to this when idle (floor ${siteSetup.battery.socFloor}%, ceiling ${siteSetup.battery.socCeiling}%)`}
              />
              <NumericParam
                label="Idle Recharge Rate"
                value={bmsConfig.idleRechargeRateKw}
                unit="kW"
                onChange={(v) => updateBmsConfig({ idleRechargeRateKw: v })}
                min={0}
                max={siteSetup.grid.gridConnectionLimit}
                step={5}
                hint={`Max grid draw for idle recharge (grid limit: ${siteSetup.grid.gridConnectionLimit} kW)`}
              />
              <NumericParam
                label="Derating Start SOC"
                value={bmsConfig.deratingStartSoc}
                unit="%"
                onChange={(v) => updateBmsConfig({ deratingStartSoc: v })}
                min={siteSetup.battery.socFloor}
                max={siteSetup.battery.socCeiling}
                step={5}
                hint={`Full power above this. Linear ramp to 0 at ${siteSetup.battery.socFloor}% floor.`}
              />
              <div className="space-y-1">
                <Label className="text-xs font-medium">Trickle Recharge</Label>
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={bmsConfig.trickleRechargeEnabled}
                    onCheckedChange={(v) => updateBmsConfig({ trickleRechargeEnabled: v })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {bmsConfig.trickleRechargeEnabled ? "On" : "Off"}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">Recharge battery during EV sessions with spare grid capacity</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">PV Priority</Label>
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={bmsConfig.pvPriorityCharging}
                    onCheckedChange={(v) => updateBmsConfig({ pvPriorityCharging: v })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {bmsConfig.pvPriorityCharging ? "On" : "Off"}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">Use PV power before grid for all operations</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
          <Card className="py-3">
            <CardContent className="flex flex-col items-center gap-1 text-center">
              <Zap className="size-4 text-chart-1" />
              <p className="text-lg font-bold tabular-nums text-foreground">{summary.totalEvEnergyKwh}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">EV Delivered (kWh)</p>
            </CardContent>
          </Card>
          <Card className="py-3">
            <CardContent className="flex flex-col items-center gap-1 text-center">
              <Plug className="size-4 text-chart-2" />
              <p className="text-lg font-bold tabular-nums text-foreground">{summary.totalGridImportKwh}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">Grid Import (kWh)</p>
            </CardContent>
          </Card>
          <Card className="py-3">
            <CardContent className="flex flex-col items-center gap-1 text-center">
              <Sun className="size-4 text-chart-3" />
              <p className="text-lg font-bold tabular-nums text-foreground">{summary.totalPvUsedKwh}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">PV Used (kWh)</p>
            </CardContent>
          </Card>
          <Card className="py-3">
            <CardContent className="flex flex-col items-center gap-1 text-center">
              <Battery className="size-4 text-chart-4" />
              <p className="text-lg font-bold tabular-nums text-foreground">{summary.totalBatteryDischargeKwh}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">Batt Discharge (kWh)</p>
            </CardContent>
          </Card>
          <Card className="py-3">
            <CardContent className="flex flex-col items-center gap-1 text-center">
              <TrendingUp className="size-4 text-chart-3" />
              <p className="text-lg font-bold tabular-nums text-foreground">{summary.totalEvRevenueEur.toFixed(2)}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">Revenue (EUR)</p>
            </CardContent>
          </Card>
          <Card className="py-3">
            <CardContent className="flex flex-col items-center gap-1 text-center">
              <TrendingDown className="size-4 text-destructive" />
              <p className="text-lg font-bold tabular-nums text-foreground">{summary.totalGridCostEur.toFixed(2)}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">Grid Cost (EUR)</p>
            </CardContent>
          </Card>
          <Card className="py-3">
            <CardContent className="flex flex-col items-center gap-1 text-center">
              <BatteryCharging className="size-4 text-chart-4" />
              <p className="text-lg font-bold tabular-nums text-foreground">{summary.peakGridDrawKw}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">Peak Grid (kW)</p>
            </CardContent>
          </Card>
          <Card className={`py-3 ${summary.netProfitEur >= 0 ? "border-chart-3/30 bg-chart-3/5" : "border-destructive/30 bg-destructive/5"}`}>
            <CardContent className="flex flex-col items-center gap-1 text-center">
              <TrendingUp className={`size-4 ${summary.netProfitEur >= 0 ? "text-chart-3" : "text-destructive"}`} />
              <p className={`text-lg font-bold tabular-nums ${summary.netProfitEur >= 0 ? "text-chart-3" : "text-destructive"}`}>
                {summary.netProfitEur.toFixed(2)}
              </p>
              <p className="text-[10px] leading-tight text-muted-foreground">Net Profit (EUR)</p>
            </CardContent>
          </Card>
        </div>

        {/* Power Flows Chart (stacked area) */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-chart-1/10">
                <Zap className="size-4 text-chart-1" />
              </div>
              <div>
                <CardTitle className="text-base">Power Flows to EV (15-min)</CardTitle>
                <CardDescription>
                  Stacked power sources: PV (green) + Grid (blue) + Battery (amber) = total to EV
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <ChartContainer config={{
              pvToEv: { label: "PV to EV", color: "var(--chart-3)" },
              gridToEv: { label: "Grid to EV", color: "var(--chart-2)" },
              batteryToEv: { label: "Battery to EV", color: "var(--chart-4)" },
              evMaxAccept: { label: "EV Demand", color: "var(--chart-1)" },
            }} className="h-72 w-full">
              <ComposedChart data={chart15Min} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="pvEvGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="gridEvGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="battEvGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={7} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }}
                  label={{ value: "kW", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "var(--muted-foreground)" } }}
                />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const d = payload[0].payload
                  return (
                    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm min-w-48">
                      <p className="font-semibold">{d.time}</p>
                      <div className="mt-1.5 space-y-1">
                        <div className="flex justify-between gap-4">
                          <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm bg-chart-3" />PV to EV</span>
                          <span className="font-mono">{d.pvToEv} kW</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm bg-chart-2" />Grid to EV</span>
                          <span className="font-mono">{d.gridToEv} kW</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm bg-chart-4" />Battery to EV</span>
                          <span className="font-mono">{d.batteryToEv} kW</span>
                        </div>
                        <div className="flex justify-between gap-4 border-t border-border pt-1">
                          <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full bg-chart-1" />EV Demand</span>
                          <span className="font-mono">{d.evMaxAccept} kW</span>
                        </div>
                        <div className="flex justify-between gap-4 font-medium">
                          <span>Total Delivered</span>
                          <span className={`font-mono ${d.totalToEv >= d.evMaxAccept ? "text-chart-3" : "text-destructive"}`}>{d.totalToEv} kW</span>
                        </div>
                        {d.evMaxAccept > 0 && d.totalToEv < d.evMaxAccept && (
                          <p className="text-[10px] text-destructive">Shortfall: {(d.evMaxAccept - d.totalToEv).toFixed(1)} kW unmet</p>
                        )}
                      </div>
                    </div>
                  )
                }} />
                <ReferenceLine y={siteSetup.grid.gridConnectionLimit} stroke="var(--destructive)" strokeDasharray="6 3" strokeWidth={1.5} />
                <Area type="stepAfter" dataKey="pvToEv" stackId="ev" fill="url(#pvEvGrad)" stroke="var(--chart-3)" strokeWidth={1} />
                <Area type="stepAfter" dataKey="gridToEv" stackId="ev" fill="url(#gridEvGrad)" stroke="var(--chart-2)" strokeWidth={1} />
                <Area type="stepAfter" dataKey="batteryToEv" stackId="ev" fill="url(#battEvGrad)" stroke="var(--chart-4)" strokeWidth={1} />
                <Line type="stepAfter" dataKey="evMaxAccept" stroke="var(--chart-1)" strokeWidth={2} strokeDasharray="5 3" dot={false} />
              </ComposedChart>
            </ChartContainer>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground mt-3">
              <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-chart-3" />PV to EV</span>
              <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-chart-2" />Grid to EV</span>
              <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-chart-4" />Battery to EV</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-chart-1" />EV Demand</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-destructive" />Grid limit ({siteSetup.grid.gridConnectionLimit} kW)</span>
            </div>
          </CardContent>
        </Card>

        {/* Battery SOC Trajectory */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-chart-4/10">
                <Battery className="size-4 text-chart-4" />
              </div>
              <div>
                <CardTitle className="text-base">Battery SOC Trajectory</CardTitle>
                <CardDescription>
                  Min {summary.minBatterySocPct.toFixed(1)}% | Max {summary.maxBatterySocPct.toFixed(1)}% | Discharged {summary.totalBatteryDischargeKwh} kWh | Charged {summary.totalBatteryChargeKwh} kWh
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <ChartContainer config={{
              batterySocPct: { label: "Battery SOC (%)", color: "var(--chart-4)" },
            }} className="h-56 w-full">
              <AreaChart data={chart15Min} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="socGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={7} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }}
                  domain={[0, 100]}
                  label={{ value: "%", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "var(--muted-foreground)" } }}
                />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const d = payload[0].payload
                  const socKwh = (d.batterySocPct / 100) * siteSetup.battery.totalCapacity
                  return (
                    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                      <p className="font-semibold">{d.time}</p>
                      <p className="mt-1 font-mono">SOC: <span className="text-chart-4 font-bold">{d.batterySocPct.toFixed(1)}%</span> ({socKwh.toFixed(1)} kWh)</p>
                      {d.gridToBattery > 0 && <p className="text-muted-foreground">Grid charging: {d.gridToBattery} kW</p>}
                      {d.pvToBattery > 0 && <p className="text-muted-foreground">PV charging: {d.pvToBattery} kW</p>}
                      {d.batteryToEv > 0 && <p className="text-muted-foreground">Discharging to EV: {d.batteryToEv} kW</p>}
                    </div>
                  )
                }} />
                {/* SOC floor */}
                <ReferenceLine y={siteSetup.battery.socFloor} stroke="var(--destructive)" strokeDasharray="4 4" strokeWidth={1}
                  label={{ value: `Floor ${siteSetup.battery.socFloor}%`, position: "right", style: { fontSize: 9, fill: "var(--destructive)" } }}
                />
                {/* Derating start */}
                <ReferenceLine y={bmsConfig.deratingStartSoc} stroke="var(--chart-4)" strokeDasharray="4 4" strokeWidth={1}
                  label={{ value: `Derate ${bmsConfig.deratingStartSoc}%`, position: "right", style: { fontSize: 9, fill: "var(--chart-4)" } }}
                />
                {/* Idle target */}
                <ReferenceLine y={bmsConfig.idleTargetSoc} stroke="var(--chart-3)" strokeDasharray="4 4" strokeWidth={1}
                  label={{ value: `Target ${bmsConfig.idleTargetSoc}%`, position: "left", style: { fontSize: 9, fill: "var(--chart-3)" } }}
                />
                <Area type="monotone" dataKey="batterySocPct" fill="url(#socGrad)" stroke="var(--chart-4)" strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Battery Charging Breakdown -- Idle vs Trickle, PV vs Grid */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-chart-4/10">
                <BatteryCharging className="size-4 text-chart-4" />
              </div>
              <div>
                <CardTitle className="text-base">Battery Charging Breakdown</CardTitle>
                <CardDescription>
                  When and from where the battery gets charged -- idle recharge (no EV) vs trickle (during EV session). Discharge shown as negative.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {/* Summary stats row */}
            <div className="grid grid-cols-2 gap-3 mb-4 md:grid-cols-4">
              <div className="rounded-md border px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Idle -- PV</p>
                <p className="text-base font-bold tabular-nums">{(result.minutes.reduce((s, m) => s + (!m.evConnected ? m.pvToBatteryKw / 60 : 0), 0)).toFixed(1)} kWh</p>
              </div>
              <div className="rounded-md border px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Idle -- Grid</p>
                <p className="text-base font-bold tabular-nums">{(result.minutes.reduce((s, m) => s + (!m.evConnected ? m.gridToBatteryKw / 60 : 0), 0)).toFixed(1)} kWh</p>
              </div>
              <div className="rounded-md border px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Trickle -- PV</p>
                <p className="text-base font-bold tabular-nums">{(result.minutes.reduce((s, m) => s + (m.evConnected ? m.pvToBatteryKw / 60 : 0), 0)).toFixed(1)} kWh</p>
              </div>
              <div className="rounded-md border px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Trickle -- Grid</p>
                <p className="text-base font-bold tabular-nums">{(result.minutes.reduce((s, m) => s + (m.evConnected ? m.gridToBatteryKw / 60 : 0), 0)).toFixed(1)} kWh</p>
              </div>
            </div>
            <ChartContainer config={{
              pvToBattIdle: { label: "PV (Idle)", color: "var(--chart-3)" },
              gridToBattIdle: { label: "Grid (Idle)", color: "var(--chart-2)" },
              pvToBattTrickle: { label: "PV (Trickle)", color: "oklch(0.72 0.17 145)" },
              gridToBattTrickle: { label: "Grid (Trickle)", color: "oklch(0.65 0.15 240)" },
              discharge: { label: "Discharge to EV", color: "var(--chart-4)" },
            }} className="h-72 w-full">
              <ComposedChart
                data={chart15Min.map(d => ({
                  ...d,
                  discharge: d.batteryToEv > 0 ? -d.batteryToEv : 0,
                  // Background band: 1 = EV connected, 0 = idle
                  evBand: d.evConnectedMinutes > 0 ? siteSetup.battery.maxChargeRate * 1.15 : 0,
                }))}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="pvBattIdleG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.08} />
                  </linearGradient>
                  <linearGradient id="gridBattIdleG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.08} />
                  </linearGradient>
                  <linearGradient id="pvBattTrickleG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.72 0.17 145)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="oklch(0.72 0.17 145)" stopOpacity={0.08} />
                  </linearGradient>
                  <linearGradient id="gridBattTrickleG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.65 0.15 240)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="oklch(0.65 0.15 240)" stopOpacity={0.08} />
                  </linearGradient>
                  <linearGradient id="dischGrad" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={7} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }}
                  label={{ value: "kW", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "var(--muted-foreground)" } }}
                />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const d = payload[0].payload
                  const totalCharge = d.pvToBattIdle + d.gridToBattIdle + d.pvToBattTrickle + d.gridToBattTrickle
                  const netPower = totalCharge - d.batteryToEv
                  const isEv = d.evConnectedMinutes > 0
                  return (
                    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm min-w-56">
                      <div className="flex items-center justify-between gap-4">
                        <p className="font-semibold">{d.time}</p>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isEv ? "bg-chart-1/15 text-chart-1" : "bg-muted text-muted-foreground"}`}>
                          {isEv ? `EV connected (${d.evConnectedMinutes}/15 min)` : "Idle"}
                        </span>
                      </div>
                      <div className="mt-1.5 space-y-1">
                        {(d.pvToBattIdle > 0 || d.gridToBattIdle > 0) && (
                          <>
                            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Idle Recharge</p>
                            {d.pvToBattIdle > 0 && (
                              <div className="flex justify-between gap-4">
                                <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm" style={{ background: "var(--chart-3)" }} />PV (idle)</span>
                                <span className="font-mono">{d.pvToBattIdle} kW</span>
                              </div>
                            )}
                            {d.gridToBattIdle > 0 && (
                              <div className="flex justify-between gap-4">
                                <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm" style={{ background: "var(--chart-2)" }} />Grid (idle)</span>
                                <span className="font-mono">{d.gridToBattIdle} kW</span>
                              </div>
                            )}
                          </>
                        )}
                        {(d.pvToBattTrickle > 0 || d.gridToBattTrickle > 0) && (
                          <>
                            <p className="text-muted-foreground text-[10px] uppercase tracking-wide pt-0.5">Trickle (during EV session)</p>
                            {d.pvToBattTrickle > 0 && (
                              <div className="flex justify-between gap-4">
                                <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm" style={{ background: "oklch(0.72 0.17 145)" }} />PV (trickle)</span>
                                <span className="font-mono">{d.pvToBattTrickle} kW</span>
                              </div>
                            )}
                            {d.gridToBattTrickle > 0 && (
                              <div className="flex justify-between gap-4">
                                <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm" style={{ background: "oklch(0.65 0.15 240)" }} />Grid (trickle)</span>
                                <span className="font-mono">{d.gridToBattTrickle} kW</span>
                              </div>
                            )}
                          </>
                        )}
                        {d.batteryToEv > 0 && (
                          <>
                            <p className="text-muted-foreground text-[10px] uppercase tracking-wide pt-0.5">Discharge</p>
                            <div className="flex justify-between gap-4">
                              <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm bg-chart-4" />To EV</span>
                              <span className="font-mono">-{d.batteryToEv} kW</span>
                            </div>
                          </>
                        )}
                        <div className="flex justify-between gap-4 border-t border-border pt-1 font-medium">
                          <span>Net battery flow</span>
                          <span className={`font-mono ${netPower >= 0 ? "text-chart-3" : "text-chart-4"}`}>
                            {netPower >= 0 ? "+" : ""}{netPower.toFixed(1)} kW
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                }} />
                {/* EV connected background band */}
                <Bar dataKey="evBand" fill="var(--chart-1)" fillOpacity={0.06} strokeWidth={0} barSize={999} isAnimationActive={false} />
                {/* Max charge rate */}
                <ReferenceLine y={siteSetup.battery.maxChargeRate} stroke="var(--chart-3)" strokeDasharray="4 4" strokeWidth={1}
                  label={{ value: `Max charge ${siteSetup.battery.maxChargeRate} kW`, position: "right", style: { fontSize: 9, fill: "var(--chart-3)" } }}
                />
                {/* Max discharge rate (negative) */}
                <ReferenceLine y={-siteSetup.battery.maxDischargeRate} stroke="var(--chart-4)" strokeDasharray="4 4" strokeWidth={1}
                  label={{ value: `Max discharge -${siteSetup.battery.maxDischargeRate} kW`, position: "right", style: { fontSize: 9, fill: "var(--chart-4)" } }}
                />
                {/* Zero line */}
                <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
                {/* Charge stacked areas: idle first, then trickle */}
                <Area type="stepAfter" dataKey="pvToBattIdle" stackId="charge" fill="url(#pvBattIdleG)" stroke="var(--chart-3)" strokeWidth={1.5} />
                <Area type="stepAfter" dataKey="gridToBattIdle" stackId="charge" fill="url(#gridBattIdleG)" stroke="var(--chart-2)" strokeWidth={1.5} />
                <Area type="stepAfter" dataKey="pvToBattTrickle" stackId="charge" fill="url(#pvBattTrickleG)" stroke="oklch(0.72 0.17 145)" strokeWidth={1.5} strokeDasharray="4 2" />
                <Area type="stepAfter" dataKey="gridToBattTrickle" stackId="charge" fill="url(#gridBattTrickleG)" stroke="oklch(0.65 0.15 240)" strokeWidth={1.5} strokeDasharray="4 2" />
                {/* Discharge (negative) */}
                <Area type="stepAfter" dataKey="discharge" fill="url(#dischGrad)" stroke="var(--chart-4)" strokeWidth={1.5} />
              </ComposedChart>
            </ChartContainer>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground mt-3">
              <span className="text-[10px] font-medium uppercase tracking-wide text-foreground/60">Idle recharge:</span>
              <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-3)" }} />PV</span>
              <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: "var(--chart-2)" }} />Grid</span>
              <span className="text-border">|</span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-foreground/60">Trickle (EV session):</span>
              <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: "oklch(0.72 0.17 145)" }} />PV</span>
              <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: "oklch(0.65 0.15 240)" }} />Grid</span>
              <span className="text-border">|</span>
              <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-chart-4" />Discharge</span>
              <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm bg-chart-1/10 border border-chart-1/20" />EV connected</span>
            </div>
          </CardContent>
        </Card>

        {/* Grid Draw Profile */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-chart-2/10">
                <Plug className="size-4 text-chart-2" />
              </div>
              <div>
                <CardTitle className="text-base">Grid Import Profile</CardTitle>
                <CardDescription>
                  Total grid draw (EV + battery recharge) -- peak {summary.peakGridDrawKw} kW vs limit {siteSetup.grid.gridConnectionLimit} kW
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <ChartContainer config={{
              gridToEv: { label: "Grid to EV", color: "var(--chart-2)" },
              gridToBattery: { label: "Grid to Battery", color: "var(--chart-5)" },
            }} className="h-48 w-full">
              <AreaChart data={chart15Min} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={7} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10 }}
                  domain={[0, (max: number) => Math.ceil(max / 20) * 20 + 10]}
                  label={{ value: "kW", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "var(--muted-foreground)" } }}
                />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const d = payload[0].payload
                  return (
                    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                      <p className="font-semibold">{d.time}</p>
                      <div className="mt-1 space-y-0.5">
                        <p>Grid to EV: <span className="font-mono font-medium">{d.gridToEv} kW</span></p>
                        <p>Grid to Battery: <span className="font-mono font-medium">{d.gridToBattery} kW</span></p>
                        <p className="border-t pt-0.5 font-medium">Total: <span className="font-mono">{d.totalGridDraw} kW</span></p>
                      </div>
                    </div>
                  )
                }} />
                <ReferenceLine y={siteSetup.grid.gridConnectionLimit} stroke="var(--destructive)" strokeDasharray="6 3" strokeWidth={1.5} />
                <Area type="stepAfter" dataKey="gridToEv" stackId="grid" fill="var(--chart-2)" fillOpacity={0.2} stroke="var(--chart-2)" strokeWidth={1} />
                <Area type="stepAfter" dataKey="gridToBattery" stackId="grid" fill="var(--chart-5)" fillOpacity={0.2} stroke="var(--chart-5)" strokeWidth={1} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Per-Session Delivery Table */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-md bg-chart-1/10">
                <CheckCircle2 className="size-4 text-chart-1" />
              </div>
              <div>
                <CardTitle className="text-base">Session Delivery Report</CardTitle>
                <CardDescription>
                  {summary.sessionsFullyServed}/{summary.totalSessionCount} sessions fully served |{" "}
                  {summary.sessionsPartiallyServed > 0 && (
                    <span className="text-destructive font-medium">{summary.sessionsPartiallyServed} partially served</span>
                  )}
                  {summary.sessionsPartiallyServed === 0 && (
                    <span className="text-chart-3 font-medium">All sessions fully served</span>
                  )}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">#</th>
                    <th className="pb-2 pr-3 font-medium">Vehicle</th>
                    <th className="pb-2 pr-3 font-medium">Time</th>
                    <th className="pb-2 pr-3 font-medium text-right">Requested</th>
                    <th className="pb-2 pr-3 font-medium text-right">Delivered</th>
                    <th className="pb-2 pr-3 font-medium text-right">PV</th>
                    <th className="pb-2 pr-3 font-medium text-right">Grid</th>
                    <th className="pb-2 pr-3 font-medium text-right">Battery</th>
                    <th className="pb-2 pr-3 font-medium text-right">Avg kW</th>
                    <th className="pb-2 font-medium text-right">Fulfillment</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionDelivery.map((s) => (
                    <tr key={s.id} className={`border-b last:border-0 ${!s.fullyServed ? "bg-destructive/5" : ""}`}>
                      <td className="py-2 pr-3 font-mono text-muted-foreground">{s.idx + 1}</td>
                      <td className="py-2 pr-3 font-medium truncate max-w-32">{s.vehicleType}</td>
                      <td className="py-2 pr-3 font-mono text-muted-foreground">{s.startTime}</td>
                      <td className="py-2 pr-3 font-mono text-right">{s.energyRequestedKwh.toFixed(1)}</td>
                      <td className="py-2 pr-3 font-mono text-right font-medium">{s.delivered}</td>
                      <td className="py-2 pr-3 font-mono text-right text-chart-3">{s.pvShare}</td>
                      <td className="py-2 pr-3 font-mono text-right text-chart-2">{s.gridShare}</td>
                      <td className="py-2 pr-3 font-mono text-right text-chart-4">{s.battShare}</td>
                      <td className="py-2 pr-3 font-mono text-right">{s.avgSpeedKw}</td>
                      <td className="py-2 font-mono text-right">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          s.fullyServed
                            ? "bg-chart-3/10 text-chart-3"
                            : "bg-destructive/10 text-destructive"
                        }`}>
                          {s.fullyServed ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
                          {s.pct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-medium">
                    <td className="pt-2 pr-3" colSpan={3}>TOTAL</td>
                    <td className="pt-2 pr-3 font-mono text-right">{sessionDelivery.reduce((s, r) => s + r.energyRequestedKwh, 0).toFixed(1)}</td>
                    <td className="pt-2 pr-3 font-mono text-right">{summary.totalEvEnergyKwh}</td>
                    <td className="pt-2 pr-3 font-mono text-right text-chart-3">{sessionDelivery.reduce((s, r) => s + r.pvShare, 0).toFixed(1)}</td>
                    <td className="pt-2 pr-3 font-mono text-right text-chart-2">{sessionDelivery.reduce((s, r) => s + r.gridShare, 0).toFixed(1)}</td>
                    <td className="pt-2 pr-3 font-mono text-right text-chart-4">{sessionDelivery.reduce((s, r) => s + r.battShare, 0).toFixed(1)}</td>
                    <td className="pt-2 pr-3 font-mono text-right">{sessionDelivery.length > 0 ? (sessionDelivery.reduce((s, r) => s + r.avgSpeedKw, 0) / sessionDelivery.length).toFixed(1) : "-"}</td>
                    <td className="pt-2 font-mono text-right">{summary.totalSessionCount > 0 ? ((summary.totalEvEnergyKwh / sessionDelivery.reduce((s, r) => s + r.energyRequestedKwh, 0)) * 100).toFixed(1) : 100}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Sources & References */}
        <SourcesCitation
          title="Sources: BMS Strategy & Battery Management"
          sources={[
            {
              label: "ADS-TEC Energy -- Energy Management System Overview",
              url: "https://www.ads-tec-energy.com/en/solutions/grid-friendly-charging/",
              detail: "ADS-TEC EMS: idle SOC target ~80%, PV-priority charging, trickle recharge during sessions when spare grid capacity exists. Battery-buffered charger power flow architecture.",
              date: "2024",
            },
            {
              label: "Fastned -- 2023 Transparency Report (Battery Buffered Sites)",
              url: "https://fastnedcharging.com/en/investor-relations",
              detail: "Idle SOC target 70-80% at battery-buffered locations. Average HPC arrival SOC 25-35%, used to calibrate BMS readiness assumptions.",
              date: "2023",
            },
            {
              label: "Battery University -- BU-808: How to Prolong Lithium-based Batteries",
              url: "https://batteryuniversity.com/article/bu-808-how-to-prolong-lithium-based-batteries",
              detail: "LFP calendar aging at high SOC: ~2x faster at 90% vs 70%. SOC derating behavior near floor: BMS cuts discharge below 20% to protect cell voltage.",
            },
            {
              label: "NREL -- Battery Storage Best Practices for Commercial BESS",
              url: "https://www.nrel.gov/docs/fy21osti/79444.pdf",
              detail: "Commercial BESS SOC management: full discharge power above 30%, stepped derating below 30%, hard cutoff at 15-20%. Cycle budget management for longevity.",
              date: "2021",
            },
            {
              label: "DNV GL -- Battery Energy Storage System Safety Guidelines (GRIDSTOR)",
              url: "https://www.dnv.com/services/testing-and-certification-of-battery-energy-storage-systems-141478",
              detail: "Safety constraints for BESS: SOC floor 15-20%, charge rate limits for LFP (~0.5-0.7C), thermal management requirements that affect max charge rate.",
              date: "2023",
            },
          ]}
        />
      </div>
    </>
  )
}
