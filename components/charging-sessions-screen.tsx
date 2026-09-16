"use client"

import { useMemo, useCallback } from "react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table"
import { useSimulation, type ChargingSession } from "@/lib/simulation-store"
import { minuteToTimeStr } from "@/lib/disaggregate"

import { PageHeader } from "@/components/page-header"
import { SourcesCitation } from "@/components/sources-citation"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Bar,
  Area,
  ComposedChart,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  Cell,
} from "recharts"
import { Badge } from "@/components/ui/badge"
import {
  Plus,
  Trash2,
  Car,
  Zap,
  Clock,
  BatteryCharging,
  AlertTriangle,
  PlugZap,
} from "lucide-react"

// Parse "HH:MM" to minute of day
function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

export function ChargingSessionsScreen() {
  const { chargingSessions, setChargingSessions, siteSetup, switchConnectorCount } = useSimulation()
  const connectorCount = siteSetup.charger.connectorCount ?? 1

  const updateSession = useCallback(
    (id: number, updates: Partial<ChargingSession>) => {
      setChargingSessions(
        chargingSessions.map((s) => {
          if (s.id !== id) return s
          const merged = { ...s, ...updates }
          // Recompute energyRequestedKwh
          merged.energyRequestedKwh =
            Math.round(
              merged.batteryCapacityKwh *
                ((merged.targetSoc - merged.arrivalSoc) / 100) *
                10
            ) / 10
          return merged
        })
      )
    },
    [chargingSessions, setChargingSessions]
  )

  const removeSession = useCallback(
    (id: number) => {
      setChargingSessions(chargingSessions.filter((s) => s.id !== id))
    },
    [chargingSessions, setChargingSessions]
  )

  const addSession = useCallback(() => {
    const maxId = chargingSessions.reduce((max, s) => Math.max(max, s.id), 0)
    // Place new session after last one ends
    const sorted = [...chargingSessions].sort(
      (a, b) => timeToMin(a.startTime) - timeToMin(b.startTime)
    )
    const last = sorted[sorted.length - 1]
    let nextStart = "12:00"
    if (last) {
      const endMin = timeToMin(last.startTime) + last.durationMinutes + 5 // 5 min gap
      nextStart = minuteToTimeStr(Math.min(endMin, 23 * 60))
    }
    const newSession: ChargingSession = {
      id: maxId + 1,
      connectorId: 1,
      startTime: nextStart,
      durationMinutes: 30,
      vehicleType: "Generic EV",
      batteryCapacityKwh: 60,
      arrivalSoc: 30,
      targetSoc: 80,
      maxAcceptRateKw: 150,
      energyRequestedKwh: 30,
    }
    setChargingSessions([...chargingSessions, newSession])
  }, [chargingSessions, setChargingSessions])

  // Sort sessions chronologically
  const sortedSessions = useMemo(
    () =>
      [...chargingSessions].sort(
        (a, b) => timeToMin(a.startTime) - timeToMin(b.startTime)
      ),
    [chargingSessions]
  )

  // Detect overlaps per connector -- sessions on the same connector must not overlap
  const overlaps = useMemo(() => {
    const issues: { id: number; conflictWith: number }[] = []
    for (let c = 1; c <= connectorCount; c++) {
      const connSessions = sortedSessions.filter(s => (s.connectorId ?? 1) === c)
      for (let i = 1; i < connSessions.length; i++) {
        const prev = connSessions[i - 1]
        const curr = connSessions[i]
        const prevEnd = timeToMin(prev.startTime) + prev.durationMinutes
        if (timeToMin(curr.startTime) < prevEnd) {
          issues.push({ id: curr.id, conflictWith: prev.id })
        }
      }
    }
    return issues
  }, [sortedSessions, connectorCount])

  const overlapIds = useMemo(
    () => new Set(overlaps.flatMap((o) => [o.id, o.conflictWith])),
    [overlaps]
  )

  // Summary stats
  const stats = useMemo(() => {
    const totalEnergyRequested = chargingSessions.reduce(
      (sum, s) => sum + s.energyRequestedKwh,
      0
    )
    const maxAcceptRate = Math.max(
      ...chargingSessions.map((s) => s.maxAcceptRateKw),
      0
    )
    const totalMinutes = chargingSessions.reduce(
      (sum, s) => sum + s.durationMinutes,
      0
    )
    const avgArrivalSoc =
      chargingSessions.length > 0
        ? chargingSessions.reduce((sum, s) => sum + s.arrivalSoc, 0) /
          chargingSessions.length
        : 0

    // Idle time: gaps between sessions
    let idleMinutes = 0
    for (let i = 1; i < sortedSessions.length; i++) {
      const prevEnd =
        timeToMin(sortedSessions[i - 1].startTime) +
        sortedSessions[i - 1].durationMinutes
      const currStart = timeToMin(sortedSessions[i].startTime)
      if (currStart > prevEnd) idleMinutes += currStart - prevEnd
    }

    return {
      sessionCount: chargingSessions.length,
      totalEnergyRequested: Math.round(totalEnergyRequested * 10) / 10,
      maxAcceptRate,
      totalMinutes,
      totalHours: (totalMinutes / 60).toFixed(1),
      avgArrivalSoc: Math.round(avgArrivalSoc),
      idleMinutes,
      overlapCount: overlaps.length,
    }
  }, [chargingSessions, sortedSessions, overlaps])

  // Build per-session bar chart: one bar per session showing its max accept rate
  // This is the correct view for a single connector -- sequential, not stacked
  const sessionChartData = useMemo(() => {
    return sortedSessions.map((s, i) => {
      const startMin = timeToMin(s.startTime)
      const endMin = startMin + s.durationMinutes
      const gridLimit = siteSetup.grid.gridConnectionLimit
      const gridPart = Math.min(s.maxAcceptRateKw, gridLimit)
      const batteryPart = Math.max(s.maxAcceptRateKw - gridLimit, 0)
      return {
        label: `#${i + 1}`,
        name: s.vehicleType.split("(")[0].trim(),
        time: `${s.startTime}-${minuteToTimeStr(endMin)}`,
        gridPart,
        batteryPart,
        total: s.maxAcceptRateKw,
        energyReq: s.energyRequestedKwh,
        duration: s.durationMinutes,
        isOverlap: overlapIds.has(s.id),
      }
    })
  }, [sortedSessions, siteSetup.grid.gridConnectionLimit, overlapIds])

  const chartConfig: ChartConfig = {
    gridPart: { label: "Grid can serve (kW)", color: "var(--chart-1)" },
    batteryPart: {
      label: "Needs battery assist (kW)",
      color: "var(--chart-4)",
    },
  }

  // 15-min resolution EV demand profile
  // For each 15-min slot, sum active session power across all connectors
  const demandProfile15min = useMemo(() => {
    const slots: { time: string; minute: number; powerKw: number; energyKwh: number; vehicle: string; sessionIdx: number }[] = []
    const maxHw = siteSetup.charger.maxHardwareOutput

    for (let m = 0; m < 1440; m += 15) {
      const slotEnd = m + 15
      const timeStr = minuteToTimeStr(m)

      let totalPowerKw = 0
      let vehicle = ""
      let sessionIdx = -1

      for (let i = 0; i < sortedSessions.length; i++) {
        const s = sortedSessions[i]
        const sStart = timeToMin(s.startTime)
        const sEnd = sStart + s.durationMinutes
        if (sStart < slotEnd && sEnd > m) {
          const pw = Math.min(s.maxAcceptRateKw, maxHw)
          totalPowerKw += pw
          if (sessionIdx === -1) { vehicle = s.vehicleType; sessionIdx = i }
        }
      }

      const energyKwh = totalPowerKw * (15 / 60)
      slots.push({ time: timeStr, minute: m, powerKw: totalPowerKw, energyKwh, vehicle, sessionIdx })
    }
    return slots
  }, [sortedSessions, siteSetup.charger.maxHardwareOutput])

  const peakDemandKw = Math.max(...demandProfile15min.map(s => s.powerKw), 0)
  const totalDemandKwh = Math.round(demandProfile15min.reduce((sum, s) => sum + s.energyKwh, 0) * 10) / 10

  // Timeline constants
  const firstStart = sortedSessions.length > 0
    ? Math.max(timeToMin(sortedSessions[0].startTime) - 30, 0)
    : 6 * 60
  const lastSession = sortedSessions[sortedSessions.length - 1]
  const lastEnd = lastSession
    ? timeToMin(lastSession.startTime) + lastSession.durationMinutes + 30
    : 21 * 60
  // Round to whole hours
  const dayStart = Math.floor(firstStart / 60) * 60
  const dayEnd = Math.min(Math.ceil(lastEnd / 60) * 60, 1440)
  const dayRange = Math.max(dayEnd - dayStart, 60)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Charging Sessions"
        description={`EV arrival queue for ${connectorCount} charging post${connectorCount > 1 ? "s" : ""} -- actual energy delivery decided by BMS/EMS`}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex w-full flex-col gap-6">
          {/* Connector Count Switcher */}
          <Card className="py-4">
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <PlugZap className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Charging Posts</p>
                    <p className="text-xs text-muted-foreground">
                      {connectorCount === 1
                        ? "Single connector -- sessions are sequential (one EV at a time)"
                        : "Two connectors -- sessions run in parallel (two EVs simultaneously)"
                      }
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 rounded-lg border p-1 bg-muted/30">
                  <button
                    type="button"
                    onClick={() => switchConnectorCount(1)}
                    className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all ${
                      connectorCount === 1
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    1 Post
                  </button>
                  <button
                    type="button"
                    onClick={() => switchConnectorCount(2)}
                    className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all ${
                      connectorCount === 2
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    2 Posts
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Overlap warning */}
          {overlaps.length > 0 && (
            <Card className="border-destructive/30 bg-destructive/5 py-4">
              <CardContent className="flex gap-3">
                <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-destructive mb-1">
                    {overlaps.length} overlap{overlaps.length > 1 ? "s" : ""} detected
                  </p>
                  <p className="text-foreground/80 leading-relaxed">
                    Sessions on the same connector cannot overlap. Adjust
                    start times, durations, or move sessions to a different post.
                    Overlapping sessions are highlighted in red below.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="py-4">
              <CardContent className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Car className="size-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {stats.sessionCount}
                  </p>
                  <p className="text-xs text-muted-foreground">EV Arrivals</p>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-chart-1/10 shrink-0">
                  <BatteryCharging className="size-5 text-chart-1" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {stats.totalEnergyRequested.toLocaleString()} kWh
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Energy Requested
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-chart-2/10">
                  <Clock className="size-5 text-chart-2" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {stats.totalHours}h
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Occupied ({stats.idleMinutes} min idle)
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="py-4">
              <CardContent className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-chart-4/10">
                  <Zap className="size-5 text-chart-4" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {stats.avgArrivalSoc}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Avg Arrival SOC
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* EV Demand Profile (15-min resolution) */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-chart-4/10">
                  <Zap className="size-4 text-chart-4" />
                </div>
                <div>
                  <CardTitle className="text-base">EV Demand Profile (15-min Resolution)</CardTitle>
                  <CardDescription>
                    Power demand from EV queue over 24h -- peak {peakDemandKw} kW, total {totalDemandKwh} kWh
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                Each 15-min slot shows the {connectorCount > 1 ? "combined" : ""} max accept rate of {connectorCount > 1 ? "EVs plugged into all posts" : "whichever EV is plugged in"}. {connectorCount === 1 ? "Single connector = only one EV active at a time." : "Two connectors = up to two EVs charging simultaneously."} Gaps show zero demand (connector idle). This is the <strong className="text-foreground">demand ceiling</strong> -- actual power delivery depends on battery SOC taper, grid capacity, and battery assist.
              </div>

              <ChartContainer config={{
                powerKw: { label: "EV Demand (kW)", color: "var(--chart-4)" },
              }} className="h-64 w-full">
                <AreaChart
                  data={demandProfile15min}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="demandGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
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
                    domain={[0, (max: number) => Math.ceil(max / 50) * 50 + 20]}
                    label={{
                      value: "kW",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 10, fill: "var(--muted-foreground)" },
                    }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null
                      const d = payload[0].payload as (typeof demandProfile15min)[0]
                      if (d.powerKw === 0) {
                        return (
                          <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                            <p className="font-semibold">{d.time}</p>
                            <p className="text-muted-foreground mt-1">Connector idle -- no EV plugged in</p>
                          </div>
                        )
                      }
                      return (
                        <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm min-w-52">
                          <p className="font-semibold">{d.time} - {minuteToTimeStr(d.minute + 15)}</p>
                          <div className="mt-1.5 space-y-1">
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">Vehicle</span>
                              <span className="font-medium text-foreground truncate max-w-36">{d.vehicle}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">Session</span>
                              <span className="font-mono">#{d.sessionIdx + 1}</span>
                            </div>
                            <div className="flex justify-between gap-4 border-t border-border pt-1">
                              <span className="text-muted-foreground">Max Accept Rate</span>
                              <span className="font-mono font-bold text-chart-4">{d.powerKw} kW</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-muted-foreground">Energy this slot</span>
                              <span className="font-mono">{d.energyKwh.toFixed(1)} kWh</span>
                            </div>
                          </div>
                          <div className="mt-2 rounded bg-muted/50 p-1.5 font-mono text-[10px] text-muted-foreground">
                            {d.powerKw} kW * 15 min / 60 = {d.energyKwh.toFixed(2)} kWh
                          </div>
                        </div>
                      )
                    }}
                  />
                  {/* Grid connection limit */}
                  <ReferenceLine
                    y={siteSetup.grid.gridConnectionLimit}
                    stroke="var(--destructive)"
                    strokeDasharray="6 3"
                    strokeWidth={1.5}
                    label={{
                      value: `Grid limit ${siteSetup.grid.gridConnectionLimit} kW`,
                      position: "right",
                      style: { fontSize: 9, fill: "var(--destructive)" },
                    }}
                  />
                  {/* Charger hardware limit */}
                  {peakDemandKw > siteSetup.grid.gridConnectionLimit && (
                    <ReferenceLine
                      y={siteSetup.charger.maxHardwareOutput}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="3 3"
                      strokeWidth={1}
                      label={{
                        value: `Hardware ${siteSetup.charger.maxHardwareOutput} kW`,
                        position: "left",
                        style: { fontSize: 9, fill: "var(--muted-foreground)" },
                      }}
                    />
                  )}
                  <Area
                    type="stepAfter"
                    dataKey="powerKw"
                    stroke="var(--chart-4)"
                    strokeWidth={2}
                    fill="url(#demandGradient)"
                  />
                </AreaChart>
              </ChartContainer>

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-sm bg-chart-4" />
                  EV demand (max accept rate)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-destructive" />
                  Grid limit ({siteSetup.grid.gridConnectionLimit} kW)
                </span>
                <span className="text-muted-foreground/60">|</span>
                <span>Peak: <span className="font-mono font-medium text-foreground">{peakDemandKw} kW</span></span>
                <span>Total: <span className="font-mono font-medium text-foreground">{totalDemandKwh} kWh</span></span>
                <span>Active slots: <span className="font-mono font-medium text-foreground">{demandProfile15min.filter(s => s.powerKw > 0).length}</span> / 96</span>
              </div>
            </CardContent>
          </Card>

          {/* Energy Requested Breakdown */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-chart-1/10">
                  <BatteryCharging className="size-4 text-chart-1" />
                </div>
                <div>
                  <CardTitle className="text-base">Energy Requested: {stats.totalEnergyRequested} kWh</CardTitle>
                  <CardDescription>
                    How much energy all EVs need -- derived from battery specs and SOC, not measured
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 pt-4">
              {/* The Formula */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground">Calculation Formula</h4>
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <div className="rounded-md bg-background p-3 font-mono text-xs border space-y-1">
                    <p className="text-muted-foreground">{'// For each EV session i = 1..N:'}</p>
                    <p>{'energy(i) = batteryCapacity(i) * (targetSOC(i) - arrivalSOC(i)) / 100'}</p>
                    <p className="text-muted-foreground mt-2">{'// Total across all sessions:'}</p>
                    <p>{'totalEnergyRequested = SUM( energy(i) ) for i = 1..N'}</p>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p><strong className="text-foreground">batteryCapacity(i)</strong> -- total battery size of vehicle i in kWh (e.g. 77 kWh for VW ID.4). From manufacturer specs.</p>
                    <p><strong className="text-foreground">arrivalSOC(i)</strong> -- state of charge when EV plugs in (e.g. 20% = battery is 80% empty)</p>
                    <p><strong className="text-foreground">targetSOC(i)</strong> -- desired state of charge when EV leaves (e.g. 80% = charge to 80%)</p>
                    <p><strong className="text-foreground">energy(i)</strong> -- the kWh gap that needs filling for this one session</p>
                  </div>
                  <div className="rounded-md border border-chart-4/30 bg-chart-4/5 p-3 text-xs space-y-2 mt-2">
                    <p className="font-semibold text-foreground">How were arrivalSOC and targetSOC determined?</p>
                    <p>These values are <strong className="text-foreground">manually assumed</strong> based on published HPC usage data, not randomized. In production, they would come from real OCPP session logs.</p>
                    <div className="space-y-1.5 mt-1">
                      <div>
                        <p className="font-medium text-foreground">arrivalSOC (20-50%)</p>
                        <p>HPC users arrive with low SOC -- that is why they use fast charging. Average HPC arrival SOC is ~25-35% (Fastned 2023 transparency report, Ionity usage data). Higher arrivals (40-50%) represent quick top-ups during errands. Delivery vans arrive lower (20-25%) due to route depletion.</p>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">targetSOC (55-80%)</p>
                        <p>HPC users almost never charge to 100% -- DC charging power tapers sharply above 80% (e.g. 150 kW at 60% down to 50 kW at 80% and 20 kW at 90%). At a supermarket, dwell time is 20-40 min, so target is "enough to get home", not "full battery". Average HPC departure SOC is ~65-75% (Fastned, EnBW public data). Lower targets (55-65%) are quick shoppers; higher (75-80%) have a longer trip ahead.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Visual Per-Session SOC Breakdown */}
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h4 className="text-sm font-semibold text-foreground">All {sortedSessions.length} Sessions</h4>
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-5 rounded-sm bg-muted-foreground/20" />
                      Existing charge
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-5 rounded-sm bg-chart-1" />
                      Energy requested
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-5 rounded-sm bg-muted/60" />
                      Unused capacity
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  {sortedSessions.map((s, i) => {
                    const delta = s.targetSoc - s.arrivalSoc
                    const arrivalKwh = (s.arrivalSoc / 100) * s.batteryCapacityKwh
                    const unusedPct = 100 - s.targetSoc
                    return (
                      <div key={s.id} className="rounded-lg border bg-background p-3">
                        <div className="flex items-start gap-3">
                          {/* Session number + post indicator */}
                          <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
                            <div className="flex size-7 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground">
                              {i + 1}
                            </div>
                            {connectorCount > 1 && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0" style={{ borderColor: (s.connectorId ?? 1) === 1 ? "var(--chart-1)" : "var(--chart-2)", color: (s.connectorId ?? 1) === 1 ? "var(--chart-1)" : "var(--chart-2)" }}>
                                P{s.connectorId ?? 1}
                              </Badge>
                            )}
                          </div>

                          <div className="flex-1 min-w-0 space-y-2">
                            {/* Header row: car name + energy result */}
                            <div className="flex items-baseline justify-between gap-2">
                              <div className="flex items-baseline gap-2 min-w-0">
                                <span className="text-sm font-semibold text-foreground truncate">{s.vehicleType}</span>
                                <span className="text-[10px] text-muted-foreground font-mono shrink-0">{s.batteryCapacityKwh} kWh battery</span>
                              </div>
                              <span className="text-sm font-bold font-mono text-chart-1 shrink-0">
                                {s.energyRequestedKwh.toFixed(1)} kWh
                              </span>
                            </div>

                            {/* SOC battery gauge */}
                            <div className="space-y-1">
                              <div className="flex h-5 w-full rounded-md overflow-hidden border">
                                {/* Existing charge: 0% to arrivalSoc */}
                                {s.arrivalSoc > 0 && (
                                  <div
                                    className="bg-muted-foreground/20 flex items-center justify-center text-[9px] font-mono text-muted-foreground border-r border-background/50"
                                    style={{ width: `${s.arrivalSoc}%` }}
                                  >
                                    {s.arrivalSoc >= 15 && `${s.arrivalSoc}%`}
                                  </div>
                                )}
                                {/* Energy requested: arrivalSoc to targetSoc */}
                                <div
                                  className="bg-chart-1 flex items-center justify-center text-[9px] font-mono text-white font-medium border-r border-background/50"
                                  style={{ width: `${delta}%` }}
                                >
                                  {delta >= 10 && `+${delta}%`}
                                </div>
                                {/* Unused capacity: targetSoc to 100% */}
                                {unusedPct > 0 && (
                                  <div
                                    className="bg-muted/60 flex items-center justify-center text-[9px] font-mono text-muted-foreground"
                                    style={{ width: `${unusedPct}%` }}
                                  >
                                    {unusedPct >= 15 && `${unusedPct}%`}
                                  </div>
                                )}
                              </div>
                              {/* SOC labels */}
                              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                <span>0%</span>
                                <div className="flex items-center gap-3">
                                  <span>Arrival: <span className="font-mono font-medium text-foreground">{s.arrivalSoc}%</span> ({arrivalKwh.toFixed(0)} kWh)</span>
                                  <span>Target: <span className="font-mono font-medium text-foreground">{s.targetSoc}%</span></span>
                                </div>
                                <span>100%</span>
                              </div>
                            </div>

                            {/* Calculation line */}
                            <div className="rounded bg-muted/40 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground">
                              {s.batteryCapacityKwh} kWh {'*'} ({s.targetSoc}% - {s.arrivalSoc}%) / 100 = {s.batteryCapacityKwh} {'*'} {delta} / 100 = <span className="text-chart-1 font-medium">{s.energyRequestedKwh.toFixed(1)} kWh</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Total Summary */}
              <div className="rounded-lg border bg-chart-1/5 border-chart-1/20 p-4">
                <div className="flex items-baseline justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold text-foreground">Total Energy Requested</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      SUM({sortedSessions.length} sessions) = {sortedSessions.map(s => s.energyRequestedKwh.toFixed(1)).join(' + ')}
                    </p>
                  </div>
                  <p className="text-2xl font-bold font-mono text-chart-1">{stats.totalEnergyRequested.toFixed(1)} kWh</p>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  This is the maximum energy all EVs would need if fully charged to target SOC. Actual delivery depends on available power (grid + battery + PV), session duration, and BMS charging curve. Real delivery may be lower if the session ends before the target is reached.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Session Timeline -- occupancy per connector */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                  <Clock className="size-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">
                    Connector Occupancy Timeline
                  </CardTitle>
                  <CardDescription>
                    {connectorCount === 1
                      ? "Sequential queue -- one EV at a time, gaps = connector idle"
                      : "Two parallel connectors -- EVs on the same post are sequential, different posts run simultaneously"
                    }
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {/* Time axis labels */}
              <div className="relative mb-1">
                <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                  {Array.from(
                    { length: Math.floor((dayEnd - dayStart) / 60) + 1 },
                    (_, i) => {
                      const h = Math.floor(dayStart / 60) + i
                      return (
                        <span key={h}>
                          {h.toString().padStart(2, "0")}:00
                        </span>
                      )
                    }
                  )}
                </div>
              </div>
              {/* Multi-track timeline: one row per connector */}
              <div className="space-y-1">
                {Array.from({ length: connectorCount }, (_, c) => c + 1).map(connId => {
                  const connSessions = sortedSessions.filter(s => (s.connectorId ?? 1) === connId)
                  const colors = connId === 1 ? { bg: "var(--chart-1)", overlap: "var(--chart-4)" } : { bg: "var(--chart-2)", overlap: "var(--chart-4)" }
                  return (
                    <div key={connId}>
                      {connectorCount > 1 && (
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="inline-block size-2 rounded-full" style={{ backgroundColor: colors.bg }} />
                          <span className="text-[10px] font-medium text-muted-foreground">Post {connId}</span>
                        </div>
                      )}
                      <div className="relative h-10 bg-muted/50 rounded-md overflow-hidden">
                        {connSessions.map((s) => {
                          const globalIdx = sortedSessions.indexOf(s)
                          const startMin = timeToMin(s.startTime)
                          const endMin = startMin + s.durationMinutes
                          const left = ((Math.max(startMin, dayStart) - dayStart) / dayRange) * 100
                          const width = ((Math.min(endMin, dayEnd) - Math.max(startMin, dayStart)) / dayRange) * 100
                          const isOverlap = overlapIds.has(s.id)
                          return (
                            <div
                              key={s.id}
                              className="absolute top-1 bottom-1 rounded-sm flex items-center overflow-hidden"
                              style={{
                                left: `${left}%`,
                                width: `${Math.max(width, 0.3)}%`,
                                backgroundColor: isOverlap ? colors.overlap : colors.bg,
                              }}
                              title={`#${globalIdx + 1} ${s.vehicleType} | ${s.startTime}-${minuteToTimeStr(endMin)} | Post ${connId} | ${s.maxAcceptRateKw} kW max | ${s.energyRequestedKwh} kWh req`}
                            >
                              <span className="text-[9px] font-mono text-primary-foreground px-1 truncate">
                                {width > 3 ? `${s.vehicleType.split(" ")[0]} ${s.maxAcceptRateKw}kW` : ""}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-[10px] text-muted-foreground">
                <span>{sortedSessions.length} sessions{connectorCount > 1 ? ` across ${connectorCount} posts` : ", sequential"}</span>
                <span>
                  Occupied: {stats.totalMinutes} min | Idle: {stats.idleMinutes}{" "}
                  min
                </span>
                {connectorCount > 1 && (
                  <>
                    <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ backgroundColor: "var(--chart-1)" }} />Post 1</span>
                    <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ backgroundColor: "var(--chart-2)" }} />Post 2</span>
                  </>
                )}
                {overlaps.length > 0 && (
                  <span className="text-destructive font-medium">
                    {overlaps.length} overlap(s)
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Per-Session Max Accept Rate Chart */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-chart-1/10">
                  <Zap className="size-4 text-chart-1" />
                </div>
                <div>
                  <CardTitle className="text-base">
                    Per-Session Max Acceptance Rate
                  </CardTitle>
                  <CardDescription>
                    Each bar = one EV session. Shows how much the EV can accept
                    vs. grid limit (actual delivery TBD by simulation)
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <ChartContainer config={chartConfig} className="h-64 w-full">
                <ComposedChart
                  data={sessionChartData}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 9 }}
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
                      style: {
                        fontSize: 10,
                        fill: "var(--muted-foreground)",
                      },
                    }}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) => {
                          const d = payload?.[0]?.payload
                          if (!d) return ""
                          return `${d.name} (${d.time}, ${d.duration} min)`
                        }}
                      />
                    }
                  />
                  <Bar
                    dataKey="gridPart"
                    stackId="power"
                    name="Grid can serve"
                    isAnimationActive={false}
                    radius={[0, 0, 0, 0]}
                  >
                    {sessionChartData.map((d, i) => (
                      <Cell
                        key={i}
                        fill={
                          d.isOverlap
                            ? "color-mix(in oklch, var(--chart-4) 60%, transparent)"
                            : "var(--chart-1)"
                        }
                      />
                    ))}
                  </Bar>
                  <Bar
                    dataKey="batteryPart"
                    stackId="power"
                    name="Needs battery"
                    isAnimationActive={false}
                    radius={[2, 2, 0, 0]}
                  >
                    {sessionChartData.map((d, i) => (
                      <Cell
                        key={i}
                        fill={
                          d.isOverlap
                            ? "color-mix(in oklch, var(--chart-4) 30%, transparent)"
                            : "var(--chart-4)"
                        }
                      />
                    ))}
                  </Bar>
                  <ReferenceLine
                    y={siteSetup.grid.gridConnectionLimit}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="6 3"
                    strokeWidth={1.5}
                    label={{
                      value: `Grid ${siteSetup.grid.gridConnectionLimit} kW`,
                      position: "right",
                      style: {
                        fontSize: 10,
                        fill: "var(--muted-foreground)",
                      },
                    }}
                  />
                  <ReferenceLine
                    y={siteSetup.charger.maxHardwareOutput}
                    stroke="var(--destructive)"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                    label={{
                      value: `HW max ${siteSetup.charger.maxHardwareOutput} kW`,
                      position: "right",
                      style: { fontSize: 10, fill: "var(--destructive)" },
                    }}
                  />
                </ComposedChart>
              </ChartContainer>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block size-2.5 rounded-sm"
                    style={{ background: "var(--chart-1)" }}
                  />
                  Grid can serve (up to{" "}
                  {siteSetup.grid.gridConnectionLimit} kW)
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block size-2.5 rounded-sm"
                    style={{ background: "var(--chart-4)" }}
                  />
                  Needs battery assist
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sessions Table */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                  <Car className="size-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">EV Arrival Queue</CardTitle>
                  <CardDescription>
                    {stats.sessionCount} plug-in events in arrival order --
                    energy delivery and billing decided by simulation
                  </CardDescription>
                </div>
              </div>
              <CardAction>
                <Button size="sm" onClick={addSession} className="gap-1.5">
                  <Plus className="size-4" />
                  Add EV
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-10 pl-4">#</TableHead>
                      {connectorCount > 1 && <TableHead className="text-xs">Post</TableHead>}
                      <TableHead className="text-xs">Plug-in</TableHead>
                      <TableHead className="text-xs">Dwell (min)</TableHead>
                      <TableHead className="text-xs">Plug-out</TableHead>
                      <TableHead className="text-xs">Vehicle</TableHead>
                      <TableHead className="text-xs">Batt. (kWh)</TableHead>
                      <TableHead className="text-xs">Arr. SOC %</TableHead>
                      <TableHead className="text-xs">Target SOC %</TableHead>
                      <TableHead className="text-xs">Max Accept kW</TableHead>
                      <TableHead className="text-xs">Energy Req.</TableHead>
                      <TableHead className="text-xs w-10 pr-4"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedSessions.map((session, index) => {
                      const endMin =
                        timeToMin(session.startTime) + session.durationMinutes
                      const hasOverlap = overlapIds.has(session.id)
                      return (
                        <TableRow
                          key={session.id}
                          className={
                            hasOverlap
                              ? "bg-destructive/5 hover:bg-destructive/10"
                              : ""
                          }
                        >
                          <TableCell className="font-mono text-xs text-muted-foreground pl-4">
                            {index + 1}
                            {hasOverlap && (
                              <AlertTriangle className="inline size-3 text-destructive ml-1" />
                            )}
                          </TableCell>
                          {connectorCount > 1 && (
                            <TableCell>
                              <div className="flex gap-1 rounded border p-0.5 bg-muted/30 w-fit">
                                {[1, 2].map(c => (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => updateSession(session.id, { connectorId: c })}
                                    className={`rounded px-2 py-0.5 text-[10px] font-medium transition-all ${
                                      (session.connectorId ?? 1) === c
                                        ? c === 1 ? "bg-chart-1 text-white" : "bg-chart-2 text-white"
                                        : "text-muted-foreground hover:text-foreground"
                                    }`}
                                  >
                                    {c}
                                  </button>
                                ))}
                              </div>
                            </TableCell>
                          )}
                          <TableCell>
                            <Input
                              type="time"
                              value={session.startTime}
                              onChange={(e) =>
                                updateSession(session.id, {
                                  startTime: e.target.value,
                                })
                              }
                              className="h-7 w-22 font-mono text-xs"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={session.durationMinutes}
                              onChange={(e) =>
                                updateSession(session.id, {
                                  durationMinutes:
                                    parseInt(e.target.value) || 1,
                                })
                              }
                              min={1}
                              max={480}
                              step={5}
                              className="h-7 w-16 font-mono text-xs tabular-nums"
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {minuteToTimeStr(Math.min(endMin, 1440))}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="text"
                              value={session.vehicleType}
                              onChange={(e) =>
                                updateSession(session.id, {
                                  vehicleType: e.target.value,
                                })
                              }
                              className="h-7 w-36 text-xs"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={session.batteryCapacityKwh}
                              onChange={(e) =>
                                updateSession(session.id, {
                                  batteryCapacityKwh:
                                    parseFloat(e.target.value) || 1,
                                })
                              }
                              min={1}
                              step={1}
                              className="h-7 w-16 font-mono text-xs tabular-nums"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={session.arrivalSoc}
                              onChange={(e) =>
                                updateSession(session.id, {
                                  arrivalSoc:
                                    parseFloat(e.target.value) || 0,
                                })
                              }
                              min={0}
                              max={100}
                              className="h-7 w-14 font-mono text-xs tabular-nums"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={session.targetSoc}
                              onChange={(e) =>
                                updateSession(session.id, {
                                  targetSoc:
                                    parseFloat(e.target.value) || 0,
                                })
                              }
                              min={0}
                              max={100}
                              className="h-7 w-14 font-mono text-xs tabular-nums"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={session.maxAcceptRateKw}
                              onChange={(e) =>
                                updateSession(session.id, {
                                  maxAcceptRateKw:
                                    parseFloat(e.target.value) || 0,
                                })
                              }
                              min={0}
                              step={10}
                              className="h-7 w-16 font-mono text-xs tabular-nums"
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {session.energyRequestedKwh} kWh
                          </TableCell>
                          <TableCell className="pr-4">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeSession(session.id)}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={`Remove session ${index + 1}`}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell
                        colSpan={connectorCount > 1 ? 3 : 2}
                        className="pl-4 font-medium text-xs"
                      >
                        Totals ({stats.sessionCount} EVs{connectorCount > 1 ? ` across ${connectorCount} posts` : ""})
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium">
                        {stats.totalMinutes} min
                      </TableCell>
                      <TableCell colSpan={5}></TableCell>
                      <TableCell className="font-mono text-xs font-medium">
                        {stats.totalEnergyRequested} kWh
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sources & References */}
        <SourcesCitation
          title="Sources: Charging Sessions & EV Data"
          sources={[
            {
              label: "Fastned -- 2023 Annual Report & Transparency Data",
              url: "https://fastnedcharging.com/en/investor-relations",
              detail: "Average HPC arrival SOC ~25-35%, average departure SOC ~65-75%. Session duration and energy delivery statistics for European HPC network.",
              date: "2023",
            },
            {
              label: "Ionity -- HPC Network Usage Statistics",
              url: "https://ionity.eu/",
              detail: "HPC user behavior patterns: arrival SOC typically 20-40%, target SOC 60-80%. Users rarely charge above 80% due to BMS taper.",
              date: "2024",
            },
            {
              label: "EnBW mobility+ -- HPC Pricing & Usage Data",
              url: "https://www.enbw.com/elektromobilitaet/produkte/ladetarife",
              detail: "German HPC station utilization patterns, average session duration 20-35 min at supermarket locations, departure SOC statistics.",
              date: "2024",
            },
            {
              label: "BDEW -- Standard Load Profiles (Standardlastprofile)",
              url: "https://www.bdew.de/energie/standardlastprofile-strom/",
              detail: "Used for arrival time distribution: Saturday HPC demand peaks at 10:00-12:00 and 14:00-16:00, matching supermarket footfall patterns.",
              date: "2024",
            },
            {
              label: "EV Database -- Battery Capacity & Charging Specs",
              url: "https://ev-database.org/",
              detail: "Battery capacities and max DC charging rates for each vehicle model: VW ID.3 (58 kWh, 120 kW), ID.4 (77 kWh, 135 kW), Tesla Model 3 (60 kWh, 170 kW), etc.",
              date: "2024",
            },
            {
              label: "Allego -- HPC Utilization Reports (DE market)",
              url: "https://www.allego.eu/",
              detail: "Retail-site HPC utilization 65-75% on summer Saturdays. Vehicle mix data: ~60% compact/sedan, ~25% SUV, ~10% delivery vans.",
              date: "2024",
            },
          ]}
        />
      </div>
    </div>
  )
}
