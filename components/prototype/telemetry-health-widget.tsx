"use client"

import { useMemo } from "react"
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Signal,
  SignalLow,
  SignalMedium,
  SignalHigh,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import { InfoHint, LabelHint } from "@/components/prototype/info-hint"

interface TelemetryHealthStatus {
  status: "healthy" | "degraded" | "stale" | "offline"
  lastReadingTime: Date | null
  ageSeconds: number
  isLive: boolean
  dataQuality: {
    hasGaps: boolean
    missedFrames: number
    expectedInterval: number // seconds
    actualInterval: number // seconds
  }
}

function formatRelativeTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

function formatAbsoluteTime(date: Date): string {
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Berlin",
    hour12: false,
  })
}

function getSignalIcon(status: TelemetryHealthStatus["status"]) {
  switch (status) {
    case "healthy":
      return <SignalHigh className="size-4 text-emerald-500" />
    case "degraded":
      return <SignalMedium className="size-4 text-amber-500" />
    case "stale":
      return <SignalLow className="size-4 text-orange-500" />
    case "offline":
      return <XCircle className="size-4 text-destructive" />
  }
}

function getStatusBadge(status: TelemetryHealthStatus["status"]) {
  switch (status) {
    case "healthy":
      return (
        <Badge variant="outline" className="gap-1.5 text-emerald-600 border-emerald-500/40 bg-emerald-500/5">
          <CheckCircle2 className="size-3" />
          Healthy
        </Badge>
      )
    case "degraded":
      return (
        <Badge variant="outline" className="gap-1.5 text-amber-600 border-amber-500/40 bg-amber-500/5">
          <AlertCircle className="size-3" />
          Degraded
        </Badge>
      )
    case "stale":
      return (
        <Badge variant="outline" className="gap-1.5 text-orange-600 border-orange-500/40 bg-orange-500/5">
          <Clock className="size-3" />
          Stale
        </Badge>
      )
    case "offline":
      return (
        <Badge variant="outline" className="gap-1.5 text-destructive border-destructive/40 bg-destructive/5">
          <XCircle className="size-3" />
          Offline
        </Badge>
      )
  }
}

export function TelemetryHealthWidget() {
  const { dataSource, frame, live, historical, isLoading } = usePrototypeTelemetryContext()

  const health = useMemo<TelemetryHealthStatus>(() => {
    // Timing expectations:
    // - Frontend polls API every 5 seconds
    // - Backend receives station readings every ~30 seconds
    // - So we expect data age to be at most 30-35s under normal conditions
    const FRONTEND_POLL_INTERVAL = 5 // seconds - how often we poll the API
    const BACKEND_READING_INTERVAL = 30 // seconds - how often station reports to backend
    const expectedInterval = BACKEND_READING_INTERVAL

    if (dataSource === "live") {
      if (!frame || !live.rawFrame) {
        return {
          status: "offline",
          lastReadingTime: null,
          ageSeconds: Infinity,
          isLive: true,
          dataQuality: {
            hasGaps: false,
            missedFrames: 0,
            expectedInterval,
            actualInterval: 0,
          },
        }
      }

      const lastReadingTime = new Date(frame.ts)
      const ageSeconds = live.ageMs / 1000

      // Determine status based on age relative to backend reading interval
      // - Healthy: within expected interval (~30s) + small buffer
      // - Degraded: 1-2 missed readings (30-75s)
      // - Stale: 2-3 missed readings (75-120s)
      // - Offline: >3 missed readings (>120s)
      let status: TelemetryHealthStatus["status"] = "healthy"
      if (ageSeconds > BACKEND_READING_INTERVAL * 4) {
        status = "offline" // >120s - likely disconnected
      } else if (ageSeconds > BACKEND_READING_INTERVAL * 2.5) {
        status = "stale" // >75s - multiple missed readings
      } else if (ageSeconds > BACKEND_READING_INTERVAL * 1.5) {
        status = "degraded" // >45s - missed one reading
      }

      const missedReadings = Math.max(0, Math.floor(ageSeconds / BACKEND_READING_INTERVAL) - 1)

      return {
        status,
        lastReadingTime,
        ageSeconds,
        isLive: true,
        dataQuality: {
          hasGaps: ageSeconds > BACKEND_READING_INTERVAL * 1.5,
          missedFrames: missedReadings,
          expectedInterval,
          actualInterval: ageSeconds,
        },
      }
    }

    // Historical mode - handled by HistoricalReplayPanel, return minimal status
    if (dataSource === "historical") {
      return {
        status: "healthy",
        lastReadingTime: null,
        ageSeconds: 0,
        isLive: false,
        dataQuality: {
          hasGaps: false,
          missedFrames: 0,
          expectedInterval: 30,
          actualInterval: 30,
        },
      }
    }

    // Simulated mode - always healthy
    return {
      status: "healthy",
      lastReadingTime: frame ? new Date(frame.ts) : null,
      ageSeconds: 0,
      isLive: false,
      dataQuality: {
        hasGaps: false,
        missedFrames: 0,
        expectedInterval: 1,
        actualInterval: 1,
      },
    }
  }, [dataSource, frame, live, historical])

  if (isLoading) {
    return (
      <Card className="p-3 bg-muted/30">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Activity className="size-4 animate-pulse" />
          <span>Checking telemetry stream...</span>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-4">
        {/* Left side - status */}
        <div className="flex items-start gap-3">
          {getSignalIcon(health.status)}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Telemetry Stream</span>
              {getStatusBadge(health.status)}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {health.lastReadingTime && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  Last reading: {formatAbsoluteTime(health.lastReadingTime)}
                  {health.isLive && ` (${formatRelativeTime(health.ageSeconds)})`}
                </span>
              )}
              {health.isLive && (
                <span className={cn(
                  "flex items-center gap-1",
                  health.dataQuality.hasGaps ? "text-amber-600" : "text-muted-foreground"
                )}>
                  <Activity className="size-3" />
                  Update interval: {health.dataQuality.actualInterval.toFixed(1)}s
                  {health.dataQuality.actualInterval > health.dataQuality.expectedInterval * 1.5 && (
                    <span className="text-amber-600">(expected {health.dataQuality.expectedInterval}s)</span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right side - data quality info */}
        <div className="flex items-center gap-2">
          <InfoHint side="left">
            <p className="font-medium mb-2">Telemetry Health Metrics</p>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Mode:</span>
                <span className="font-mono">{dataSource}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Status:</span>
                <span className={cn(
                  "font-medium",
                  health.status === "healthy" && "text-emerald-600",
                  health.status === "degraded" && "text-amber-600",
                  health.status === "stale" && "text-orange-600",
                  health.status === "offline" && "text-destructive"
                )}>
                  {health.status.charAt(0).toUpperCase() + health.status.slice(1)}
                </span>
              </div>
              {health.isLive && (
                <>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Data age:</span>
                    <span className="font-mono">{health.ageSeconds.toFixed(1)}s</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Expected interval:</span>
                    <span className="font-mono">{health.dataQuality.expectedInterval}s</span>
                  </div>
                </>
              )}

            </div>
            <p className="mt-3 text-[10px] font-mono text-muted-foreground border-t pt-2">
              API: GET /telemetry/latest<br />
              Timestamp: ts field<br />
              Frontend poll: 5s | Backend reading: 30s
            </p>
          </InfoHint>
        </div>
      </div>

      {/* Warning banner for issues */}
      {(health.status === "stale" || health.status === "offline") && health.isLive && (
        <div className="mt-3 pt-3 border-t">
          <div className={cn(
            "flex items-start gap-2 text-xs p-2 rounded-md",
            health.status === "stale" ? "bg-orange-500/10 text-orange-700" : "bg-destructive/10 text-destructive"
          )}>
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">
                {health.status === "stale"
                  ? "Telemetry data is stale"
                  : "Telemetry stream appears offline"}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {health.status === "stale"
                  ? `Last reading was ${formatRelativeTime(health.ageSeconds)} (expected every ~30s). The station may have connectivity issues.`
                  : `No data received for ${formatRelativeTime(health.ageSeconds)}. Check station connectivity and middleware status.`}
              </p>
            </div>
          </div>
        </div>
      )}


    </Card>
  )
}
