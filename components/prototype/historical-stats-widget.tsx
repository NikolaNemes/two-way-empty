"use client"

import { useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { InfoHint } from "@/components/prototype/info-hint"
import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import type { TelemetryFrame } from "@/lib/prototype-telemetry"
import {
  Zap,
  Battery,
  Car,
  TrendingUp,
  ArrowDownToLine,
  Activity,
  ChevronDown,
  History,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ChargingSession {
  connectorId: 1 | 2
  startTime: Date
  endTime: Date | null
  durationMinutes: number
  energyDeliveredKwh: number
  peakPowerKw: number
  avgPowerKw: number
  startSocPct: number | null
  endSocPct: number | null
}

interface HistoricalStats {
  // Time range
  startTime: Date | null
  endTime: Date | null
  durationHours: number

  // Charging sessions
  sessions: ChargingSession[]
  totalSessions: number
  avgSessionDurationMinutes: number
  totalEnergyDeliveredKwh: number
  peakEvPowerKw: number

  // Battery stats
  batteryChargedKwh: number
  batteryDischargedKwh: number
  batteryCycles: number
  avgBatterySocPct: number
  minBatterySocPct: number
  maxBatterySocPct: number

  // Grid stats
  gridImportKwh: number
  peakImportKw: number
  avgGridPowerKw: number

  // Market stats — DAM (day-ahead) is the dispatch reference price,
  // IDM (intraday) is the settlement price. Both are useful when
  // analysing a window because a wide DAM spread means there was a lot
  // of arbitrage opportunity, and a wide IDM spread means there was
  // tradeable volatility AFTER the DAM auction closed.
  avgEpexPrice: number
  minEpexPrice: number
  maxEpexPrice: number
  damSpread: number // max - min hourly DAM price across the window
  idmSpread: number // max - min hourly IDM price across the window
  idmMin: number
  idmMax: number
  idmAvailable: boolean // false = no IDM samples in any frame
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis functions
// ─────────────────────────────────────────────────────────────────────────────

function analyzeHistoricalFrames(frames: TelemetryFrame[]): HistoricalStats {
  if (frames.length === 0) {
    return {
      startTime: null,
      endTime: null,
      durationHours: 0,
      sessions: [],
      totalSessions: 0,
      avgSessionDurationMinutes: 0,
      totalEnergyDeliveredKwh: 0,
      peakEvPowerKw: 0,
      batteryChargedKwh: 0,
      batteryDischargedKwh: 0,
      batteryCycles: 0,
      avgBatterySocPct: 0,
      minBatterySocPct: 100,
      maxBatterySocPct: 0,
      gridImportKwh: 0,
      peakImportKw: 0,
      avgGridPowerKw: 0,
      avgEpexPrice: 0,
      minEpexPrice: 0,
      maxEpexPrice: 0,
      damSpread: 0,
      idmSpread: 0,
      idmMin: 0,
      idmMax: 0,
      idmAvailable: false,
    }
  }

  const startTime = new Date(frames[0].ts)
  const endTime = new Date(frames[frames.length - 1].ts)
  const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60)

  // Calculate energy from power values using trapezoidal integration
  // Since API doesn't provide energy counters (they're null), we estimate from power samples
  const firstFrame = frames[0]
  const lastFrame = frames[frames.length - 1]

  // Calculate average interval between frames in hours
  const avgIntervalMs = (new Date(lastFrame.ts).getTime() - new Date(firstFrame.ts).getTime()) / (frames.length - 1)
  const avgIntervalHours = avgIntervalMs / (1000 * 60 * 60)

  // Track charging sessions by detecting state transitions
  const sessions: ChargingSession[] = []
  const activeSession: { [key: number]: { startIdx: number; startSoc: number | null } } = {}

  // Aggregate stats for things that need frame-by-frame analysis
  let totalEvPowerW = 0
  let peakEvPowerW = 0
  let socSum = 0
  let minSoc = 100
  let maxSoc = 0
  let peakImportW = 0
  let gridPowerSum = 0
  let gridImportWSum = 0  // Sum of negative power magnitude (importing from grid)
  let batteryChargeWSum = 0  // Sum of positive battery power (charging)
  let batteryDischargeWSum = 0  // Sum of negative battery power magnitude (discharging)
  let epexSum = 0
  let minEpex = Infinity
  let maxEpex = -Infinity
  // DAM and IDM are quoted hourly (DAM) / 15-min (IDM) — but we only
  // need their min/max range across the window to derive the spread,
  // so accumulating per-hour uniques is unnecessary. Picking the
  // running extremum across raw frame samples gives the same answer
  // and avoids a second pass over the data.
  let minIdm = Infinity
  let maxIdm = -Infinity
  let idmSampleCount = 0

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const frameTime = new Date(frame.ts)

    // Process each charger
    for (const charger of frame.chargers) {
      const connId = charger.unit_id

      // Session detection: InProgress state
      const isCharging = charger.charging_state === "InProgress"

      if (isCharging && !activeSession[connId]) {
        // Session started
        activeSession[connId] = {
          startIdx: i,
          startSoc: charger.soc_EV_pct > 0 ? charger.soc_EV_pct : null,
        }
      } else if (!isCharging && activeSession[connId]) {
        // Session ended
        const startIdx = activeSession[connId].startIdx
        const startFrame = frames[startIdx]
        const startCharger = startFrame.chargers.find((c) => c.unit_id === connId)!
        const sessionStartTime = new Date(startFrame.ts)
        const sessionEndTime = frameTime
        const durationMinutes = (sessionEndTime.getTime() - sessionStartTime.getTime()) / (1000 * 60)

        // Calculate session energy and power
        let sessionEnergyKwh = charger.E_EV_chg_kwh - startCharger.E_EV_chg_kwh
        if (sessionEnergyKwh < 0) sessionEnergyKwh = charger.E_EV_chg_kwh // Reset happened

        let sessionPeakPowerKw = 0
        let sessionPowerSum = 0
        let sessionFrameCount = 0

        for (let j = startIdx; j <= i; j++) {
          const c = frames[j].chargers.find((ch) => ch.unit_id === connId)!
          const pKw = c.P_EV_w / 1000
          sessionPowerSum += pKw
          sessionPeakPowerKw = Math.max(sessionPeakPowerKw, pKw)
          sessionFrameCount++
        }

        sessions.push({
          connectorId: connId,
          startTime: sessionStartTime,
          endTime: sessionEndTime,
          durationMinutes,
          energyDeliveredKwh: sessionEnergyKwh,
          peakPowerKw: sessionPeakPowerKw,
          avgPowerKw: sessionFrameCount > 0 ? sessionPowerSum / sessionFrameCount : 0,
          startSocPct: activeSession[connId].startSoc,
          endSocPct: charger.soc_EV_pct > 0 ? charger.soc_EV_pct : null,
        })

        delete activeSession[connId]
      }

      // Aggregate EV power
      totalEvPowerW += charger.P_EV_w
      peakEvPowerW = Math.max(peakEvPowerW, charger.P_EV_w)
    }

    // Battery stats (sum both units) - for SOC range and energy tracking
    for (const battery of frame.batteries) {
      socSum += battery.soc_pct
      minSoc = Math.min(minSoc, battery.soc_pct)
      maxSoc = Math.max(maxSoc, battery.soc_pct)
      // Accumulate power for energy calculation
      if (battery.power_w > 0) {
        batteryChargeWSum += battery.power_w
      } else {
        batteryDischargeWSum += Math.abs(battery.power_w)
      }
    }

    // Grid stats - track peak import and accumulate for energy.
    // Negative grid power = importing from grid. We no longer surface
    // grid-export figures in the summary card (a stationary HPC site
    // with EVs + BESS rarely exports meaningful energy, so the tile
    // was always near zero and just took up space), so the export
    // branch only contributes to the gross gridPowerSum used for the
    // signed average — no separate export accumulators.
    const gridPowerW = frame.grid.P_grid_w
    gridPowerSum += gridPowerW
    if (gridPowerW < 0) {
      gridImportWSum += Math.abs(gridPowerW)
      peakImportW = Math.max(peakImportW, Math.abs(gridPowerW))
    }

    // Market stats — DAM (epex_price_eur_mwh) is always present;
    // IDM (idm_price_eur_mwh) may be null/undefined when the
    // historical record predates intraday tracking, in which case we
    // hide the IDM tile entirely rather than render misleading zeros.
    const epex = frame.market.epex_price_eur_mwh
    epexSum += epex
    minEpex = Math.min(minEpex, epex)
    maxEpex = Math.max(maxEpex, epex)

    const idm = frame.market.idm_price_eur_mwh
    if (typeof idm === "number" && Number.isFinite(idm)) {
      minIdm = Math.min(minIdm, idm)
      maxIdm = Math.max(maxIdm, idm)
      idmSampleCount++
    }
  }

  // Handle sessions still in progress at end of range
  for (const connId of Object.keys(activeSession).map(Number)) {
    const startIdx = activeSession[connId].startIdx
    const startFrame = frames[startIdx]
    const startCharger = startFrame.chargers.find((c) => c.unit_id === connId)!
    const endFrame = frames[frames.length - 1]
    const endCharger = endFrame.chargers.find((c) => c.unit_id === connId)!
    const sessionStartTime = new Date(startFrame.ts)
    const sessionEndTime = new Date(endFrame.ts)
    const durationMinutes = (sessionEndTime.getTime() - sessionStartTime.getTime()) / (1000 * 60)

    let sessionEnergyKwh = endCharger.E_EV_chg_kwh - startCharger.E_EV_chg_kwh
    if (sessionEnergyKwh < 0) sessionEnergyKwh = endCharger.E_EV_chg_kwh

    sessions.push({
      connectorId: connId as 1 | 2,
      startTime: sessionStartTime,
      endTime: null, // Still in progress
      durationMinutes,
      energyDeliveredKwh: sessionEnergyKwh,
      peakPowerKw: 0,
      avgPowerKw: 0,
      startSocPct: activeSession[connId].startSoc,
      endSocPct: null,
    })
  }

  // Calculate derived stats
  const frameCount = frames.length

  // Calculate energy from power sums (since API doesn't provide energy counters)
  // Energy = Power × Time, where Time = avgIntervalHours per frame
  // Average power (W) * number of frames * interval (hours) / 1000 = kWh
  const gridImportKwh = (gridImportWSum / frameCount) * durationHours / 1000
  const batteryChargedKwh = (batteryChargeWSum / frameCount) * durationHours / 1000
  const batteryDischargedKwh = (batteryDischargeWSum / frameCount) * durationHours / 1000

  // Battery cycles (rough estimate: total energy throughput / capacity)
  const batteryCapacityKwh = 150 // 2 x 75kWh typical
  const batteryCycles = (batteryChargedKwh + batteryDischargedKwh) / 2 / batteryCapacityKwh

  // Session stats
  const avgSessionDuration =
    sessions.length > 0
      ? sessions.reduce((sum, s) => sum + s.durationMinutes, 0) / sessions.length
      : 0
  const totalEnergyDelivered = sessions.reduce((sum, s) => sum + s.energyDeliveredKwh, 0)

  return {
    startTime,
    endTime,
    durationHours,
    sessions,
    totalSessions: sessions.length,
    avgSessionDurationMinutes: avgSessionDuration,
    totalEnergyDeliveredKwh: totalEnergyDelivered,
    peakEvPowerKw: peakEvPowerW / 1000,
    batteryChargedKwh,
    batteryDischargedKwh,
    batteryCycles,
    avgBatterySocPct: socSum / (frameCount * 2), // 2 batteries
    minBatterySocPct: minSoc,
    maxBatterySocPct: maxSoc,
    gridImportKwh,
    peakImportKw: peakImportW / 1000,
    avgGridPowerKw: (gridPowerSum / frameCount) / 1000,
    avgEpexPrice: epexSum / frameCount,
    minEpexPrice: minEpex === Infinity ? 0 : minEpex,
    maxEpexPrice: maxEpex === -Infinity ? 0 : maxEpex,
    // Spread = max - min hourly price across the window. We clamp at 0
    // so a degenerate single-frame window can't produce a negative
    // spread from the Infinity sentinels.
    damSpread:
      maxEpex === -Infinity || minEpex === Infinity
        ? 0
        : Math.max(0, maxEpex - minEpex),
    idmSpread:
      maxIdm === -Infinity || minIdm === Infinity
        ? 0
        : Math.max(0, maxIdm - minIdm),
    idmMin: minIdm === Infinity ? 0 : minIdm,
    idmMax: maxIdm === -Infinity ? 0 : maxIdm,
    idmAvailable: idmSampleCount > 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  subValue,
  hint,
  variant = "default",
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  subValue?: string
  hint?: React.ReactNode
  variant?: "default" | "success" | "warning" | "info"
}) {
  const variantClasses = {
    default: "bg-muted/50",
    success: "bg-emerald-500/10 border-emerald-500/20",
    warning: "bg-amber-500/10 border-amber-500/20",
    info: "bg-blue-500/10 border-blue-500/20",
  }

  const iconClasses = {
    default: "text-muted-foreground",
    success: "text-emerald-600",
    warning: "text-amber-600",
    info: "text-blue-600",
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg border",
        variantClasses[variant]
      )}
    >
      <div className={cn("mt-0.5", iconClasses[variant])}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{label}</span>
          {hint && <InfoHint side="top">{hint}</InfoHint>}
        </div>
        <div className="text-lg font-semibold tabular-nums leading-tight">{value}</div>
        {subValue && (
          <div className="text-[10px] text-muted-foreground mt-0.5">{subValue}</div>
        )}
      </div>
    </div>
  )
}

function SessionRow({ session, index }: { session: ChargingSession; index: number }) {
  const formatTime = (d: Date) =>
    d.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    })

  return (
    <div className="flex items-center gap-3 py-2 px-3 text-xs border-b last:border-b-0">
      <Badge variant="outline" className="h-5 text-[10px] font-mono shrink-0">
        #{index + 1}
      </Badge>
      <Badge
        variant="outline"
        className={cn(
          "h-5 text-[10px] shrink-0",
          session.connectorId === 1
            ? "border-blue-500/40 text-blue-600"
            : "border-purple-500/40 text-purple-600"
        )}
      >
        C{session.connectorId}
      </Badge>
      <div className="flex-1 min-w-0">
        <span className="font-mono">
          {formatTime(session.startTime)}
          {" → "}
          {session.endTime ? formatTime(session.endTime) : "ongoing"}
        </span>
      </div>
      <div className="text-right tabular-nums">
        <span className="font-medium">{session.durationMinutes.toFixed(0)}m</span>
      </div>
      <div className="text-right tabular-nums w-16">
        <span className="font-medium">{session.energyDeliveredKwh.toFixed(1)}</span>
        <span className="text-muted-foreground ml-0.5">kWh</span>
      </div>
      {session.startSocPct !== null && session.endSocPct !== null && (
        <div className="text-right tabular-nums text-muted-foreground w-20">
          {session.startSocPct.toFixed(0)}% → {session.endSocPct.toFixed(0)}%
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function HistoricalStatsWidget({
  title = "Operating Day Summary",
}: {
  /** Heading rendered at the top of the widget. The Data Analysis screen
   *  passes "Time Range Selection Summary" because the widget there
   *  describes a multi-day window selection rather than a single
   *  operating day. */
  title?: string
} = {}) {
  const { dataSource, historical, setDataSource } = usePrototypeTelemetryContext()

  const stats = useMemo(() => {
    if (dataSource !== "historical") return null
    return analyzeHistoricalFrames(historical.telemetry.frames)
  }, [dataSource, historical.telemetry.frames])

  // Show prompt to switch to historical mode when not in historical mode
  if (dataSource !== "historical") {
    return (
      <Card className="p-4 bg-amber-500/5 border-amber-500/20">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
            <History className="size-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Historical Replay</p>
            <p className="text-xs text-muted-foreground">
              Select <strong>Historical</strong> mode in the header to load past operating days 
              and replay dispatch decisions with full timeline visualization.
            </p>
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setDataSource("historical")}
            className="gap-1.5"
          >
            <History className="size-3.5" />
            Switch to Historical
          </Button>
        </div>
      </Card>
    )
  }

  if (!stats || stats.startTime === null) {
    return null
  }

  const formatDate = (d: Date) =>
    d.toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      timeZone: "Europe/Berlin",
    })

  return (
    <Card className="p-4 bg-card/50 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">{title}</h3>
          <InfoHint side="right">
            <p className="font-medium mb-1">Historical data analysis</p>
            <p>
              Aggregated statistics computed from all telemetry frames in the
              selected date range. Session detection uses charging_state
              transitions to InProgress/Idle.
            </p>
            <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
              Source: GET /telemetry/frames<br />
              Frames analyzed: {historical.telemetry.frames.length}
            </p>
          </InfoHint>
        </div>
        <Badge variant="outline" className="text-[10px] font-mono">
          {formatDate(stats.startTime)} · {stats.durationHours.toFixed(1)}h
        </Badge>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard
          icon={<Car className="size-4" />}
          label="Charging Sessions"
          value={stats.totalSessions}
          subValue={`avg ${stats.avgSessionDurationMinutes.toFixed(0)} min`}
          variant="info"
          hint={
            <>
              <p className="font-medium mb-1">Session count</p>
              <p>
                Number of distinct EV charging sessions detected by
                tracking charging_state transitions to/from InProgress.
              </p>
            </>
          }
        />
        <StatCard
          icon={<Zap className="size-4" />}
          label="Energy to EVs"
          value={`${stats.totalEnergyDeliveredKwh.toFixed(1)} kWh`}
          subValue={`peak ${stats.peakEvPowerKw.toFixed(0)} kW`}
          variant="success"
          hint={
            <>
              <p className="font-medium mb-1">Total EV energy</p>
              <p>
                Cumulative energy delivered to all EVs across all sessions.
                Derived from chargers[].E_EV_chg_kwh deltas.
              </p>
            </>
          }
        />
        <StatCard
          icon={<Battery className="size-4" />}
          label="Battery Cycling"
          value={`${stats.batteryCycles.toFixed(2)} cycles`}
          subValue={`${stats.minBatterySocPct.toFixed(0)}% – ${stats.maxBatterySocPct.toFixed(0)}% SOC`}
          hint={
            <>
              <p className="font-medium mb-1">Battery utilization</p>
              <p>
                Estimated full-equivalent cycles based on total energy
                throughput divided by 150 kWh rated capacity.
                SOC range shows the operating window.
              </p>
            </>
          }
        />
        <StatCard
          icon={<ArrowDownToLine className="size-4" />}
          label="Grid Import"
          value={`${stats.gridImportKwh.toFixed(1)} kWh`}
          subValue={`peak ${stats.peakImportKw.toFixed(0)} kW`}
        />
      </div>

      {/* Secondary stats — market context (DAM avg + DAM/IDM spreads).
          Avg EPEX Price was promoted out of the primary row and into
          this market-stats row so the top row reads as "site activity"
          (sessions, EV energy, battery cycling, grid import) and this
          row reads as "market conditions" — a cleaner mental split
          than mixing one price tile in with the activity counters. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <StatCard
          icon={<TrendingUp className="size-4" />}
          label="Avg EPEX Price"
          value={`€${stats.avgEpexPrice.toFixed(1)}/MWh`}
          subValue={`${stats.minEpexPrice.toFixed(0)} – ${stats.maxEpexPrice.toFixed(0)} range`}
          variant={stats.avgEpexPrice < 50 ? "success" : stats.avgEpexPrice > 80 ? "warning" : "default"}
          hint={
            <>
              <p className="font-medium mb-1">Market price stats</p>
              <p>
                Average, min, and max EPEX spot prices across the period.
                Green indicates favorable arbitrage conditions.
              </p>
            </>
          }
        />
        <StatCard
          icon={<TrendingUp className="size-4" />}
          label="DAM Spread"
          value={`€${stats.damSpread.toFixed(1)}/MWh`}
          subValue={`${stats.minEpexPrice.toFixed(0)} → ${stats.maxEpexPrice.toFixed(0)} €/MWh`}
          variant={stats.damSpread > 50 ? "success" : "default"}
          hint={
            <>
              <p className="font-medium mb-1">Day-ahead market spread</p>
              <p>
                Difference between the highest and lowest hourly DAM
                price in the selected window. Wider spread means more
                room for the optimizer to arbitrage by charging the
                BESS during the cheapest hours and discharging it
                during the most expensive ones.
              </p>
            </>
          }
        />
        <StatCard
          icon={<Activity className="size-4" />}
          label="IDM Spread"
          value={
            stats.idmAvailable
              ? `€${stats.idmSpread.toFixed(1)}/MWh`
              : "—"
          }
          subValue={
            stats.idmAvailable
              ? `${stats.idmMin.toFixed(0)} → ${stats.idmMax.toFixed(0)} €/MWh`
              : "no IDM samples in range"
          }
          variant={
            stats.idmAvailable && stats.idmSpread > 50 ? "success" : "default"
          }
          hint={
            <>
              <p className="font-medium mb-1">Intraday market spread</p>
              <p>
                Difference between the highest and lowest IDM (ID3
                continuous) price observed in the selected window. IDM
                volatility shows up AFTER the day-ahead auction
                closes, so a large IDM spread indicates the market
                kept moving — useful when judging whether IDM-indexed
                contracts paid off versus DAM-indexed ones.
              </p>
            </>
          }
        />
      </div>

      {/* Session list - collapsible, collapsed by default */}
      {stats.sessions.length > 0 && (
        <Collapsible>
          <div className="border rounded-lg overflow-hidden">
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted/70 transition-colors">
                <span className="text-xs font-medium">Session Details</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="h-5 text-[10px]">
                    {stats.sessions.length} session{stats.sessions.length !== 1 ? "s" : ""}
                  </Badge>
                  <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="max-h-48 overflow-y-auto border-t">
                {stats.sessions.map((session, i) => (
                  <SessionRow key={`${session.connectorId}-${session.startTime.getTime()}`} session={session} index={i} />
                ))}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {stats.sessions.length === 0 && (
        <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg bg-muted/30">
          No charging sessions detected in this period
        </div>
      )}
    </Card>
  )
}
