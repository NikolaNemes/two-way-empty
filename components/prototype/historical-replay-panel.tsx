"use client"

import { useMemo, useState, useEffect } from "react"
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  ChevronFirst,
  ChevronLast,
  ChevronsLeft,
  ChevronsRight,
  AlertTriangle,
  Clock,
  Calendar,
  Activity,
  Gauge,
  ChevronDown,
  ChevronUp,
  Database,
  Loader2,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import { InfoHint } from "@/components/prototype/info-hint"

interface GapInfo {
  startIndex: number
  endIndex: number
  durationSeconds: number
  missedReadings: number
  startTime: Date
  endTime: Date
}

interface SessionInfo {
  connectorId: number
  startIndex: number
  endIndex: number
  startTime: Date
  endTime: Date
  durationMinutes: number
}

interface DataQualityAnalysis {
  totalFrames: number
  totalDurationMinutes: number
  gaps: GapInfo[]
  totalGapDuration: number
  coveragePercent: number
  averageInterval: number
  expectedInterval: number
  longestGap: GapInfo | null
  sessions: SessionInfo[]
  }

function formatTime(date: Date): string {
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Berlin",
    hour12: false,
  })
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

function formatTimeShort(date: Date): string {
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
    hour12: false,
  })
}

// Animated EV car SVG component
function AnimatedEVCar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 50" className={className} fill="none">
      {/* Car body */}
      <path
        d="M20 35 L25 20 L45 15 L75 15 L95 20 L100 35 Z"
        className="fill-emerald-500"
      />
      {/* Car roof */}
      <path
        d="M35 20 L40 10 L70 10 L80 20 Z"
        className="fill-emerald-400"
      />
      {/* Windows */}
      <path
        d="M42 18 L45 12 L55 12 L55 18 Z"
        className="fill-sky-200"
      />
      <path
        d="M58 18 L58 12 L68 12 L72 18 Z"
        className="fill-sky-200"
      />
      {/* Headlights */}
      <circle cx="95" cy="28" r="3" className="fill-yellow-300">
        <animate attributeName="opacity" values="0.5;1;0.5" dur="0.5s" repeatCount="indefinite" />
      </circle>
      {/* Taillights */}
      <rect x="18" y="26" width="4" height="6" rx="1" className="fill-red-500" />
      {/* Wheels */}
      <g>
        <circle cx="35" cy="38" r="8" className="fill-gray-800" />
        <circle cx="35" cy="38" r="5" className="fill-gray-600" />
        <circle cx="35" cy="38" r="2" className="fill-gray-400">
          <animateTransform attributeName="transform" type="rotate" from="0 35 38" to="360 35 38" dur="0.3s" repeatCount="indefinite" />
        </circle>
      </g>
      <g>
        <circle cx="85" cy="38" r="8" className="fill-gray-800" />
        <circle cx="85" cy="38" r="5" className="fill-gray-600" />
        <circle cx="85" cy="38" r="2" className="fill-gray-400">
          <animateTransform attributeName="transform" type="rotate" from="0 85 38" to="360 85 38" dur="0.3s" repeatCount="indefinite" />
        </circle>
      </g>
      {/* Charging port indicator */}
      <circle cx="60" cy="25" r="3" className="fill-emerald-300">
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1s" repeatCount="indefinite" />
      </circle>
      {/* Lightning bolt on side */}
      <path d="M50 22 L55 22 L53 26 L57 26 L49 34 L51 28 L47 28 Z" className="fill-yellow-400" />
    </svg>
  )
}

// Charging station SVG
function ChargingStation({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 60" className={className} fill="none">
      {/* Station body */}
      <rect x="5" y="10" width="30" height="45" rx="3" className="fill-gray-700" />
      {/* Screen */}
      <rect x="10" y="15" width="20" height="15" rx="2" className="fill-emerald-500/80">
        <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" />
      </rect>
      {/* Cable holder */}
      <rect x="12" y="35" width="16" height="8" rx="2" className="fill-gray-600" />
      {/* Cable */}
      <path d="M20 43 Q 20 50, 30 55" className="stroke-gray-500 stroke-2 fill-none" strokeLinecap="round" />
      {/* Plug */}
      <rect x="28" y="52" width="8" height="6" rx="1" className="fill-gray-400" />
      {/* Status light */}
      <circle cx="20" cy="8" r="3" className="fill-emerald-400">
        <animate attributeName="opacity" values="0.5;1;0.5" dur="1s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}

// Animated loading state component.
//
// `delayMs` lets fast (cache-served) loads skip the loader entirely:
// the component returns null until `delayMs` has elapsed, so if the
// parent unmounts us before that (because data arrived), the user
// never sees the loading UI at all.
function HistoricalLoadingState({ delayMs = 0 }: { delayMs?: number }) {
  const { historicalRange } = usePrototypeTelemetryContext()
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState(0)
  const [visible, setVisible] = useState(delayMs === 0)
  
  const stages = [
    { label: "Connecting to API", icon: Database },
    { label: "Fetching telemetry frames", icon: Activity },
    { label: "Processing data", icon: Zap },
  ]

  useEffect(() => {
    if (delayMs > 0) {
      const t = setTimeout(() => setVisible(true), delayMs)
      return () => clearTimeout(t)
    }
  }, [delayMs])

  useEffect(() => {
    if (!visible) return
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return prev
        const increment = prev < 30 ? 3 : prev < 60 ? 2 : prev < 80 ? 1 : 0.5
        return Math.min(prev + increment, 95)
      })
    }, 100)

    const stageInterval = setInterval(() => {
      setStage((prev) => (prev + 1) % stages.length)
    }, 2000)

    return () => {
      clearInterval(progressInterval)
      clearInterval(stageInterval)
    }
  }, [visible])

  if (!visible) return null

  const CurrentIcon = stages[stage].icon
  
  // Calculate actual date range info from historicalRange
  const startDate = new Date(historicalRange.dayStart)
  const endDate = new Date(historicalRange.dayEnd)
  const durationMs = endDate.getTime() - startDate.getTime()
  const durationDays = Math.round(durationMs / (1000 * 60 * 60 * 24))
  const isSingleDay = durationDays <= 1
  
  // Format dates for display
  const formatDate = (d: Date) => {
    const day = d.getDate()
    const month = d.toLocaleDateString('en-US', { month: 'short' })
    const hours = d.getHours().toString().padStart(2, '0')
    const mins = d.getMinutes().toString().padStart(2, '0')
    return `${month} ${day}, ${hours}:${mins}`
  }
  
  const timeRangeLabel = isSingleDay 
    ? "06:00 - 06:00"
    : `${formatDate(startDate)} → ${formatDate(endDate)}`
  
  const durationLabel = isSingleDay 
    ? "24h operating day"
    : `${durationDays} day${durationDays !== 1 ? 's' : ''} selected`
  
  // Estimate frames: ~1440 per day (60s intervals)
  const expectedFrames = durationDays * 1440
  const framesLabel = expectedFrames >= 1000 
    ? `~${(expectedFrames / 1000).toFixed(1)}k`
    : `~${expectedFrames.toLocaleString()}`

  return (
    <Card className="overflow-hidden border-emerald-500/20">
      {/* Animated gradient background */}
      <div className="relative p-6 bg-gradient-to-br from-emerald-500/5 via-sky-500/5 to-blue-500/5">
        
        {/* Animated car scene */}
        <div className="relative h-24 mb-6 overflow-hidden rounded-lg bg-gradient-to-b from-sky-100 to-gray-100 dark:from-sky-900/30 dark:to-gray-800/50">
          {/* Road */}
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gray-700">
            {/* Road markings */}
            <div className="absolute top-1/2 left-0 right-0 h-1 flex gap-4">
              {Array.from({ length: 20 }).map((_, i) => (
                <div
                  key={i}
                  className="w-8 h-full bg-yellow-400 animate-road-line"
                  style={{ 
                    animationDelay: `${i * 0.1}s`,
                    animation: 'roadMove 1s linear infinite'
                  }}
                />
              ))}
            </div>
          </div>
          
          {/* Charging station (stationary) */}
          <div className="absolute right-8 bottom-6">
            <ChargingStation className="w-10 h-16" />
          </div>
          
          {/* Animated EV car driving in */}
          <div 
            className="absolute bottom-5 transition-all duration-1000 ease-out"
            style={{ 
              left: `${Math.min(progress * 0.6, 55)}%`,
              transform: progress > 80 ? 'scale(1)' : 'scale(1)'
            }}
          >
            <AnimatedEVCar className="w-24 h-10" />
          </div>
          
          {/* Energy particles flowing when car reaches station */}
          {progress > 60 && (
            <div className="absolute right-16 bottom-12">
              {[0, 1, 2].map((i) => (
                <Zap
                  key={i}
                  className="absolute size-3 text-yellow-400 animate-pulse"
                  style={{
                    animationDelay: `${i * 0.3}s`,
                    transform: `translate(${i * 4}px, ${i * -4}px)`
                  }}
                />
              ))}
            </div>
          )}
          
          {/* Progress percentage overlay - top-left to avoid overlapping the charging station */}
          <div className="absolute top-2 left-2 bg-background/80 backdrop-blur rounded-md px-2 py-1 shadow-sm border border-border/50">
            <span className="text-lg font-mono font-bold text-emerald-600 tabular-nums">
              {Math.round(progress)}%
            </span>
          </div>
        </div>

        <div className="relative space-y-4">
          {/* Header with icon and status */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 size-12 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
              <div className="size-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CurrentIcon className="size-5 text-emerald-600" />
              </div>
            </div>
            
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">Loading Historical Data</h3>
                <Loader2 className="size-4 text-emerald-500 animate-spin" />
              </div>
              <p className="text-sm text-muted-foreground">
                {stages[stage].label}...
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-2">
            <div className="relative h-2 w-full bg-muted/50 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-emerald-500/30 blur-sm transition-all duration-300 ease-out"
                style={{ width: `${progress + 2}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 via-emerald-400 to-sky-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            
            <div className="flex justify-between text-[10px] text-muted-foreground">
              {stages.map((s, i) => (
                <span
                  key={i}
                  className={cn(
                    "transition-colors duration-300",
                    i <= stage ? "text-emerald-600" : "text-muted-foreground/50"
                  )}
                >
                  {s.label}
                </span>
              ))}
            </div>
          </div>

          {/* Info boxes */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-background/60 backdrop-blur border border-border/50">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Clock className="size-3" />
                <span>Time Range</span>
              </div>
              <p className="text-sm font-medium">{timeRangeLabel}</p>
              <p className="text-[10px] text-muted-foreground">{durationLabel}</p>
            </div>
            <div className="p-3 rounded-lg bg-background/60 backdrop-blur border border-border/50">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Database className="size-3" />
                <span>Expected Frames</span>
              </div>
              <p className="text-sm font-medium">{framesLabel}</p>
              <p className="text-[10px] text-muted-foreground">at 60s intervals</p>
            </div>
            <div className="p-3 rounded-lg bg-background/60 backdrop-blur border border-border/50">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Activity className="size-3" />
                <span>Data Source</span>
              </div>
              <p className="text-sm font-medium">Amperio API</p>
              <p className="text-[10px] text-muted-foreground">/telemetry/frames</p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div className="px-4 py-2 bg-muted/30 border-t flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="relative flex size-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full size-2 bg-emerald-500" />
          </span>
          Fetching charging session data...
        </span>
        <span>GET /api/amperio/telemetry/frames</span>
      </div>
    </Card>
  )
}

export function HistoricalReplayPanel() {
  const { dataSource, historical } = usePrototypeTelemetryContext()
  const [showGapDetails, setShowGapDetails] = useState(false)

  const analysis = useMemo<DataQualityAnalysis | null>(() => {
    if (dataSource !== "historical") return null

    const frames = historical.telemetry.frames
    if (frames.length === 0) {
      return {
        totalFrames: 0,
        totalDurationMinutes: 0,
        gaps: [],
        totalGapDuration: 0,
        coveragePercent: 0,
        averageInterval: 0,
        expectedInterval: 30,
        longestGap: null,
        sessions: [],
      }
    }

    const EXPECTED_INTERVAL = 30 // seconds
    const GAP_THRESHOLD = EXPECTED_INTERVAL * 2 // 60 seconds = gap

    const gaps: GapInfo[] = []
    let totalIntervalSum = 0
    let totalGapDuration = 0

    for (let i = 1; i < frames.length; i++) {
      const prevTime = new Date(frames[i - 1].ts).getTime()
      const currTime = new Date(frames[i].ts).getTime()
      const intervalSeconds = (currTime - prevTime) / 1000

      totalIntervalSum += intervalSeconds

      if (intervalSeconds > GAP_THRESHOLD) {
        const gap: GapInfo = {
          startIndex: i - 1,
          endIndex: i,
          startTime: new Date(frames[i - 1].ts),
          endTime: new Date(frames[i].ts),
          durationSeconds: intervalSeconds,
          missedReadings: Math.floor(intervalSeconds / EXPECTED_INTERVAL) - 1,
        }
        gaps.push(gap)
        totalGapDuration += intervalSeconds - EXPECTED_INTERVAL
      }
    }

    const firstTime = new Date(frames[0].ts).getTime()
    const lastTime = new Date(frames[frames.length - 1].ts).getTime()
    const totalDurationSeconds = (lastTime - firstTime) / 1000
    const totalDurationMinutes = totalDurationSeconds / 60

    // Expected readings = total duration / expected interval
    const expectedReadings = Math.ceil(totalDurationSeconds / EXPECTED_INTERVAL)
    const coveragePercent = Math.min(100, (frames.length / expectedReadings) * 100)

    const averageInterval = frames.length > 1 ? totalIntervalSum / (frames.length - 1) : EXPECTED_INTERVAL

    const longestGap = gaps.length > 0
      ? gaps.reduce((max, gap) => gap.durationSeconds > max.durationSeconds ? gap : max)
      : null

    // Detect charging sessions
    const sessions: SessionInfo[] = []
    const activeSession: { [key: number]: { startIdx: number } } = {}

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]
      const frameTime = new Date(frame.ts)

      for (const charger of frame.chargers) {
        const connId = charger.unit_id
        const isCharging = charger.charging_state === "InProgress"

        if (isCharging && !activeSession[connId]) {
          // Session started
          activeSession[connId] = { startIdx: i }
        } else if (!isCharging && activeSession[connId]) {
          // Session ended
          const startIdx = activeSession[connId].startIdx
          const startFrame = frames[startIdx]
          const sessionStartTime = new Date(startFrame.ts)
          const durationMinutes = (frameTime.getTime() - sessionStartTime.getTime()) / (1000 * 60)

          sessions.push({
            connectorId: connId,
            startIndex: startIdx,
            endIndex: i,
            startTime: sessionStartTime,
            endTime: frameTime,
            durationMinutes,
          })

          delete activeSession[connId]
        }
      }
    }

    // Handle sessions that are still active at the end
    for (const [connIdStr, session] of Object.entries(activeSession)) {
      const connId = Number(connIdStr)
      const startFrame = frames[session.startIdx]
      const endFrame = frames[frames.length - 1]
      const sessionStartTime = new Date(startFrame.ts)
      const sessionEndTime = new Date(endFrame.ts)
      const durationMinutes = (sessionEndTime.getTime() - sessionStartTime.getTime()) / (1000 * 60)

      sessions.push({
        connectorId: connId,
        startIndex: session.startIdx,
        endIndex: frames.length - 1,
        startTime: sessionStartTime,
        endTime: sessionEndTime,
        durationMinutes,
      })
    }

    return {
      totalFrames: frames.length,
      totalDurationMinutes,
      gaps,
      totalGapDuration,
      coveragePercent,
      averageInterval,
      expectedInterval: EXPECTED_INTERVAL,
      longestGap,
      sessions,
    }
  }, [dataSource, historical.telemetry.frames])

  // Don't render if not in historical mode
  if (dataSource !== "historical") return null

  const { frames, playback, error } = historical.telemetry
  const { 
    currentIndex, currentFrame, isPlaying, speed, 
    togglePlay, reset, seekTo, setSpeed,
    stepForward, stepBackward, jumpForwardMinutes, jumpBackwardMinutes 
  } = playback

  const progressPercent = frames.length > 0 ? ((currentIndex + 1) / frames.length) * 100 : 0

  // Loading state with animated progress.
  //
  // We delay showing it by 250 ms so cache-served loads (which return
  // synchronously after a microtask hop) don't briefly flash the loader.
  // Without this, even an instant localStorage hit looks "slow" because
  // the loader has a fake timer-driven progress animation that always
  // takes ≥3.2 s to climb. With the delay, fast loads show no loader at
  // all and the panel mounts directly from cached data.
  if (historical.isLoading) {
    return <HistoricalLoadingState delayMs={250} />
  }

  // Error state
  if (error) {
    return (
      <Card className="p-4 bg-destructive/5 border-destructive/20">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-5 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">Failed to Load Data</p>
            <p className="text-xs text-muted-foreground">{error.message}</p>
          </div>
        </div>
      </Card>
    )
  }

  // No data state
  if (frames.length === 0) {
    return (
      <Card className="p-4 bg-amber-500/5 border-amber-500/20">
        <div className="flex items-center gap-3">
          <Calendar className="size-5 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-700">No Data Available</p>
            <p className="text-xs text-muted-foreground">
              No telemetry frames found for the selected date range. Try selecting a different day.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      {/* Main replay controls */}
      <div className="p-4 bg-gradient-to-r from-blue-500/5 via-indigo-500/5 to-violet-500/5">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Time display and status */}
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center justify-center bg-background/80 backdrop-blur rounded-lg px-4 py-2 border shadow-sm min-w-[140px]">
              <span className="text-2xl font-mono font-bold tabular-nums tracking-tight">
                {currentFrame ? formatTime(new Date(currentFrame.ts)) : "--:--:--"}
              </span>
              <span className="text-[11px] text-muted-foreground font-medium">
                {currentFrame ? new Date(currentFrame.ts).toLocaleDateString("de-DE", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "Europe/Berlin",
                }) : "-- --- ----"}
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1.5",
                    isPlaying
                      ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10"
                      : "border-muted-foreground/40"
                  )}
                >
                  {isPlaying ? (
                    <>
                      <Activity className="size-3 animate-pulse" />
                      Playing
                    </>
                  ) : (
                    <>
                      <Pause className="size-3" />
                      Paused
                    </>
                  )}
                </Badge>
                <Badge variant="outline" className="gap-1 font-mono text-xs">
                  <Gauge className="size-3" />
                  {speed >= 1800 ? `${speed / 60}min/s` : speed >= 60 ? `${speed}x` : `${speed}x RT`}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Frame {currentIndex + 1} of {frames.length}
              </p>
            </div>
          </div>

          {/* Center: Transport controls */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => seekTo(0)}
              disabled={currentIndex === 0}
            >
              <ChevronFirst className="size-4" />
              <span className="sr-only">Go to start</span>
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => jumpBackwardMinutes(60)}
                    disabled={currentIndex === 0}
                  >
                    <ChevronsLeft className="size-4" />
                    <span className="sr-only">Jump back 1 hour</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Jump back 1 hour</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => jumpBackwardMinutes(5)}
                    disabled={currentIndex === 0}
                  >
                    <SkipBack className="size-4" />
                    <span className="sr-only">Jump back 5 min</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Jump back 5 min</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Primary playback button. When the head is parked at the
                last frame (which is the default state right after a
                historical fetch) the regular Play action would do
                nothing — togglePlay starts the loop but the loop's own
                end-of-stream guard immediately pauses it again. Swap
                the button to a "Play from beginning" affordance in
                that case: seek back to frame 0 and start playing in a
                single click. The visual cue (RotateCcw icon + amber
                tint + wider pill shape) makes the alternate behaviour
                obvious without needing a separate hint. */}
            {(() => {
              const atEnd = currentIndex >= frames.length - 1
              const showRestart = atEnd && !isPlaying
              return (
                <Button
                  variant={isPlaying ? "secondary" : "default"}
                  size="icon"
                  // Keep the same circular icon-button geometry as the
                  // regular Play state — only the icon (RotateCcw) and
                  // the amber tint signal "play from start". Tooltip +
                  // sr-only label carry the explanatory copy so the
                  // button doesn't change width on state transition.
                  className={cn(
                    "h-12 w-12 rounded-full shadow-md",
                    showRestart && "bg-amber-500 hover:bg-amber-600 text-white",
                  )}
                  title={
                    isPlaying ? "Pause" : showRestart ? "Play from beginning" : "Play"
                  }
                  onClick={() => {
                    if (showRestart) {
                      seekTo(0)
                      // Defer toggle to next tick so seekTo's state
                      // update commits before isPlaying flips, avoiding
                      // a race where the loop's end-of-stream guard
                      // sees `prev = lastIndex` and pauses immediately.
                      setTimeout(togglePlay, 0)
                    } else {
                      togglePlay()
                    }
                  }}
                >
                  {isPlaying ? (
                    <Pause className="size-5" />
                  ) : showRestart ? (
                    <RotateCcw className="size-5" />
                  ) : (
                    <Play className="size-5 ml-0.5" />
                  )}
                  <span className="sr-only">
                    {isPlaying ? "Pause" : showRestart ? "Play from beginning" : "Play"}
                  </span>
                </Button>
              )
            })()}

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => jumpForwardMinutes(5)}
                    disabled={currentIndex >= frames.length - 1}
                  >
                    <SkipForward className="size-4" />
                    <span className="sr-only">Jump forward 5 min</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Jump forward 5 min</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => jumpForwardMinutes(60)}
                    disabled={currentIndex >= frames.length - 1}
                  >
                    <ChevronsRight className="size-4" />
                    <span className="sr-only">Jump forward 1 hour</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Jump forward 1 hour</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => seekTo(frames.length - 1)}
              disabled={currentIndex >= frames.length - 1}
            >
              <ChevronLast className="size-4" />
              <span className="sr-only">Go to end</span>
            </Button>
          </div>

          {/* Right: Speed and reset */}
          <div className="flex items-center gap-2">
            <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="Select speed" />
              </SelectTrigger>
              <SelectContent className="w-[220px]">
                <div className="px-2 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wider border-b mb-1">
                  Playback Speed
                </div>
                <SelectItem value="1" className="py-2">
                  <div className="flex flex-col">
                    <span className="font-medium">1x Real-time</span>
                    <span className="text-[10px] text-muted-foreground">1s playback = 1min data</span>
                  </div>
                </SelectItem>
                <SelectItem value="10" className="py-2">
                  <div className="flex flex-col">
                    <span className="font-medium">10x Fast</span>
                    <span className="text-[10px] text-muted-foreground">1s playback = 10min data</span>
                  </div>
                </SelectItem>
                <SelectItem value="30" className="py-2">
                  <div className="flex flex-col">
                    <span className="font-medium">30x Faster</span>
                    <span className="text-[10px] text-muted-foreground">1s playback = 30min data</span>
                  </div>
                </SelectItem>
                <SelectItem value="60" className="py-2">
                  <div className="flex flex-col">
                    <span className="font-medium">60x Quick review</span>
                    <span className="text-[10px] text-muted-foreground">1s playback = 1hr data</span>
                  </div>
                </SelectItem>
                <div className="border-t my-1" />
                <SelectItem value="1800" className="py-2 bg-blue-500/5">
                  <div className="flex flex-col">
                    <span className="font-medium text-blue-600">1800x Overview</span>
                    <span className="text-[10px] text-muted-foreground">1s playback = 30min data (default)</span>
                  </div>
                </SelectItem>
                <SelectItem value="3600" className="py-2">
                  <div className="flex flex-col">
                    <span className="font-medium">3600x Ultra fast</span>
                    <span className="text-[10px] text-muted-foreground">1s playback = 1hr data</span>
                  </div>
                </SelectItem>
                <SelectItem value="7200" className="py-2">
                  <div className="flex flex-col">
                    <span className="font-medium">7200x Rapid</span>
                    <span className="text-[10px] text-muted-foreground">1s playback = 2hr data</span>
                  </div>
                </SelectItem>
                <SelectItem value="14400" className="py-2">
                  <div className="flex flex-col">
                    <span className="font-medium">14400x Instant</span>
                    <span className="text-[10px] text-muted-foreground">Full day in ~6s</span>
                  </div>
                </SelectItem>
                <SelectItem value="28800" className="py-2">
                  <div className="flex flex-col">
                    <span className="font-medium">28800x Flash</span>
                    <span className="text-[10px] text-muted-foreground">Full day in ~3s</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={reset}>
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4 space-y-2">
          <div className="relative h-3 bg-muted rounded-full overflow-hidden shadow-inner">
            {/* Gap indicators */}
            {analysis?.gaps.map((gap, i) => {
              const startPercent = (gap.startIndex / frames.length) * 100
              const width = ((gap.endIndex - gap.startIndex) / frames.length) * 100
              return (
                <div
                  key={i}
                  className="absolute inset-y-0 bg-amber-500/30 border-l border-r border-amber-500/50"
                  style={{ left: `${startPercent}%`, width: `${Math.max(width, 0.5)}%` }}
                  title={`Gap: ${formatDuration(gap.durationSeconds)} (${gap.missedReadings} missed readings)`}
                />
              )
            })}
            {/* Progress fill */}
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-150 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
            {/* Current position indicator */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-blue-600 rounded-full shadow-md transition-all duration-150"
              style={{ left: `calc(${progressPercent}% - 8px)` }}
            />
            {/* Seek input */}
            <input
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={currentIndex}
              onChange={(e) => seekTo(Number(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>

          {/* Charging session indicators */}
          {analysis && analysis.sessions.length > 0 && (
            <div className="relative h-4 mt-1">
              {/* Session bars grouped by connector */}
              {[1, 2].map((connectorId) => {
                const connectorSessions = analysis.sessions.filter((s) => s.connectorId === connectorId)
                if (connectorSessions.length === 0) return null
                
                return (
                  <div key={connectorId} className="absolute inset-x-0" style={{ top: connectorId === 1 ? 0 : 8, height: 6 }}>
                    {connectorSessions.map((session, i) => {
                      const startPercent = (session.startIndex / frames.length) * 100
                      const width = ((session.endIndex - session.startIndex) / frames.length) * 100
                      const color = connectorId === 1 ? "bg-emerald-500" : "bg-violet-500"
                      
                      return (
                        <div
                          key={i}
                          className={cn(
                            "absolute inset-y-0 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer",
                            color
                          )}
                          style={{ left: `${startPercent}%`, width: `${Math.max(width, 0.5)}%` }}
                          title={`Connector ${connectorId}: ${formatTimeShort(session.startTime)} - ${formatTimeShort(session.endTime)} (${Math.round(session.durationMinutes)}min)`}
                          onClick={() => seekTo(session.startIndex)}
                        />
                      )
                    })}
                  </div>
                )
              })}
              {/* Legend */}
              <div className="absolute -right-1 top-0 flex items-center gap-2 text-[9px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-emerald-500" /> C1
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-violet-500" /> C2
                </span>
              </div>
            </div>
          )}

          {/* Time scale with intermediate markers */}
          <div className="relative text-[10px] text-muted-foreground font-mono mt-1">
            {/* Scale ticks */}
            <div className="absolute inset-x-0 top-0 h-1.5 flex justify-between pointer-events-none">
              {Array.from({ length: 9 }).map((_, i) => (
                <div 
                  key={i} 
                  className={cn(
                    "w-px bg-muted-foreground/40",
                    i === 0 || i === 8 ? "h-1.5" : "h-1"
                  )} 
                />
              ))}
            </div>
            {/* Time labels — adapts to the span:
                  • ≤ 36 h          → 5 evenly-spaced HH:MM markers
                  • > 36 h, ≤ 7 d   → date + HH:MM (e.g. "3 May 12:00")
                  • > 7 d           → date only ("3 May")
                The marker count also adapts to the span so labels never
                overlap: longer windows get fewer markers (typically 4
                day-boundary ticks for a week, 5 for a single day).        */}
            <div className="flex justify-between pt-2">
              {frames.length > 0 && (() => {
                const startTs = new Date(frames[0].ts).getTime()
                const endTs = new Date(frames[frames.length - 1].ts).getTime()
                const duration = endTs - startTs
                const durationHours = duration / 3_600_000
                const isMultiDay = durationHours > 36
                const isLongMultiDay = durationHours > 24 * 7
                
                const roundToHour = (ts: number) => {
                  const d = new Date(ts)
                  if (d.getMinutes() >= 30) d.setHours(d.getHours() + 1)
                  d.setMinutes(0, 0, 0)
                  return d
                }
                const startOfDay = (ts: number) => {
                  const d = new Date(ts)
                  d.setHours(0, 0, 0, 0)
                  return d
                }
                
                // Pick marker count: 5 by default, 4 for week-plus spans
                // (each marker carries a date string, which is wider).
                const markerCount = isLongMultiDay ? 4 : 5
                const pcts = Array.from({ length: markerCount }, (_, i) => i / (markerCount - 1))
                
                const formatMultiDay = (d: Date) =>
                  d.toLocaleDateString("de-DE", {
                    day: "numeric",
                    month: "short",
                    timeZone: "Europe/Berlin",
                  })
                const formatMultiDayWithTime = (d: Date) => {
                  const date = d.toLocaleDateString("de-DE", {
                    day: "numeric",
                    month: "short",
                    timeZone: "Europe/Berlin",
                  })
                  const time = formatTimeShort(d)
                  return `${date} ${time}`
                }
                
                const labels = pcts.map((pct, idx) => {
                  const rawTs = startTs + duration * pct
                  if (isLongMultiDay) {
                    // Snap intermediate ticks to midnight so labels land
                    // on whole day boundaries and read cleanly.
                    const d = idx === 0 || idx === pcts.length - 1
                      ? new Date(rawTs)
                      : startOfDay(rawTs)
                    return formatMultiDay(d)
                  }
                  if (isMultiDay) {
                    const d = idx === 0 ? new Date(rawTs) : roundToHour(rawTs)
                    return formatMultiDayWithTime(d)
                  }
                  // Single-day span — original HH:MM behaviour.
                  const d = idx === 0 ? new Date(rawTs) : roundToHour(rawTs)
                  return formatTimeShort(d)
                })
                
                return labels.map((label, i) => (
                  <span 
                    key={i} 
                    className={cn(
                      "tabular-nums whitespace-nowrap",
                      i === 0 ? "text-left" : i === labels.length - 1 ? "text-right" : "text-center"
                    )}
                    style={{ 
                      width: i === 0 || i === labels.length - 1 ? "auto" : "1px",
                      flexShrink: i === 0 || i === labels.length - 1 ? 0 : 1
                    }}
                  >
                    {label}
                  </span>
                ))
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Data quality section */}
      {analysis && (
        <Collapsible open={showGapDetails} onOpenChange={setShowGapDetails}>
          <CollapsibleTrigger asChild>
            <button className="w-full px-4 py-2 flex items-center justify-between text-xs border-t hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-4">
                <span className="font-medium">Data Quality</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    analysis.coveragePercent >= 95
                      ? "border-emerald-500/40 text-emerald-600"
                      : analysis.coveragePercent >= 80
                      ? "border-amber-500/40 text-amber-600"
                      : "border-destructive/40 text-destructive"
                  )}
                >
                  {analysis.coveragePercent.toFixed(1)}% coverage
                </Badge>
                <span className="text-muted-foreground">
                  {analysis.totalFrames} frames over {Math.round(analysis.totalDurationMinutes)}min
                </span>
                {analysis.gaps.length > 0 && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 gap-1">
                    <AlertTriangle className="size-3" />
                    {analysis.gaps.length} gap{analysis.gaps.length !== 1 && "s"} detected
                  </Badge>
                )}
              </div>
              {showGapDetails ? (
                <ChevronUp className="size-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="px-4 pb-4 border-t bg-muted/30">
              <div className="pt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div className="space-y-1">
                  <span className="text-muted-foreground">Total Frames</span>
                  <p className="font-mono font-medium">{analysis.totalFrames}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">Avg Interval</span>
                  <p className="font-mono font-medium">
                    {analysis.averageInterval.toFixed(1)}s
                    <span className="text-muted-foreground ml-1">(expected {analysis.expectedInterval}s)</span>
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">Total Gap Time</span>
                  <p className={cn("font-mono font-medium", analysis.totalGapDuration > 0 && "text-amber-600")}>
                    {analysis.totalGapDuration > 0 ? formatDuration(analysis.totalGapDuration) : "None"}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">Longest Gap</span>
                  <p className={cn("font-mono font-medium", analysis.longestGap && "text-amber-600")}>
                    {analysis.longestGap ? formatDuration(analysis.longestGap.durationSeconds) : "None"}
                  </p>
                </div>
              </div>

              {/* Detailed gap list */}
              {analysis.gaps.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium mb-2">Gap Details</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {analysis.gaps.map((gap, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-xs bg-background rounded px-3 py-2 border"
                      >
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="text-[10px] font-mono">
                            #{i + 1}
                          </Badge>
                          <span className="font-mono">
                            {formatTimeShort(gap.startTime)} → {formatTimeShort(gap.endTime)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">
                            {gap.missedReadings} missed reading{gap.missedReadings !== 1 && "s"}
                          </span>
                          <Badge variant="outline" className="text-[10px] font-mono border-amber-500/40 text-amber-600">
                            {formatDuration(gap.durationSeconds)}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => seekTo(gap.startIndex)}
                          >
                            Go to
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Info hint for API mapping */}
              <div className="mt-4 pt-3 border-t flex justify-end">
                <InfoHint side="top" align="end">
                  <p className="font-medium mb-2">Data Quality Analysis</p>
                  <div className="space-y-1 text-xs">
                    <p>Gap detection threshold: 60s (2x expected interval)</p>
                    <p>Expected reading interval: 30s (backend polling rate)</p>
                    <p>Coverage = actual frames / expected frames</p>
                  </div>
                  <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                    API: GET /telemetry/frames<br />
                    Params: station_id, from, to, step_seconds
                  </p>
                </InfoHint>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  )
}
