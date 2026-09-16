"use client"

import { createContext, useContext, useState, useMemo, type ReactNode } from "react"
import {
  usePrototypeTelemetry,
  type UsePrototypeTelemetryResult,
} from "@/lib/prototype-telemetry"
import {
  useLiveTelemetry,
  useDayView,
  type UseLiveTelemetryResult,
  type UseDayViewResult,
} from "@/lib/use-live-telemetry"
import type { TelemetryFrame } from "@/lib/prototype-telemetry"
import { useStation } from "@/components/station-context"

/**
 * Data source mode for the prototype UI.
 *
 * - "simulated" — in-browser simulation (the current behavior)
 * - "live" — polling /telemetry/latest from the real Amperio API
 * - "historical" — replaying a day from /telemetry/frames
 */
export type DataSourceMode = "simulated" | "live" | "historical"

/**
 * Shared simulation host for the Prototype > Telemetry section.
 * One instance lives at /prototype/telemetry/layout.tsx so that switching
 * between Snapshot, Time-series, Events, Stream and Drill-down views
 * doesn't reset the running simulation -- the history buffer and event
 * log persist across pages.
 *
 * Now supports switching between simulated and live data sources via
 * the `dataSource` control.
 */

interface TelemetryContextValue {
  /** Which data source is active */
  dataSource: DataSourceMode
  /** Switch data source */
  setDataSource: (mode: DataSourceMode) => void

  /** Simulated telemetry (always available for comparison) */
  simulated: UsePrototypeTelemetryResult

  /** Live telemetry from the API (only active when dataSource === "live") */
  live: UseLiveTelemetryResult

  /** Historical day view (only active when dataSource === "historical") */
  historical: UseDayViewResult

  /**
   * Unified frame accessor — returns the appropriate frame based on
   * the current data source mode. UI components should use this.
   */
  frame: UsePrototypeTelemetryResult["frame"]

  /**
   * Unified frame history for charting — returns the appropriate
   * array of frames based on current data source mode.
   * - live: today's operating day history (6am-now) from API
   * - historical: all frames up to current playback index
   * - simulated: simulated history buffer
   */
  frameHistory: TelemetryFrame[]

  /**
   * For live mode: the "Now" position in the frameHistory array
   * (always the last index for live mode). For historical mode,
   * this is the current playback index. Used for chart "now" indicators.
   */
  nowIndex: number

  /**
   * Today's operating day data for live mode (full 6am-6am fetch)
   */
  todayDayView: UseDayViewResult

  /**
   * Is the current data source loading?
   */
  isLoading: boolean

  /**
   * Station ID for live/historical modes
   */
  stationId: string
  setStationId: (id: string) => void

  /**
   * Historical date range
   */
  historicalRange: {
    dayStart: string
    dayEnd: string
  }
  setHistoricalRange: (range: { dayStart: string; dayEnd: string }) => void
}

const TelemetryCtx = createContext<TelemetryContextValue | null>(null)

// Default historical range: last 30 operating days (29 days back at
// 06:00 → today at 06:00). Multi-day is now the canonical use case —
// it shows the broader picture of optimizer performance and lets the
// day-by-day uplift chart render meaningfully on first paint. Single
// days are still one click away via the "Yesterday" preset.
function getDefaultHistoricalRange() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")

  // 29 days ago at 06:00 (inclusive start of the 30-day window)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 6, 0, 0)
  // Today at 06:00 (exclusive end — yesterday's full operating day
  // ends here, today's is still in progress)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0)

  const formatISO = (d: Date) => {
    const offset = -d.getTimezoneOffset()
    const sign = offset >= 0 ? "+" : "-"
    const absOffset = Math.abs(offset)
    const tzHours = pad(Math.floor(absOffset / 60))
    const tzMins = pad(absOffset % 60)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${tzHours}:${tzMins}`
  }

  return { dayStart: formatISO(start), dayEnd: formatISO(end) }
}

/**
 * Get the current operating day range (6am -> 6am next day) for live mode.
 *
 * The "operating day" is anchored on `anchor` (defaults to now). We pass the
 * latest available live telemetry timestamp here so the Dispatching Timeline
 * tracks the freshest data the backend actually has rather than the wall
 * clock — otherwise, if the upstream feed is a day behind (e.g. its newest
 * frame is yesterday), "today's" window is empty and the page shows no data.
 *
 * The operating day also rolls at 06:00: a timestamp before 6am belongs to the
 * previous calendar day's operating window (which started at 6am yesterday).
 */
function getTodayOperatingDayRange(anchor: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0")

  // Anchor before 06:00 still belongs to the prior operating day.
  const dayOffset = anchor.getHours() < 6 ? -1 : 0

  // Operating-day start at 06:00
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + dayOffset, 6, 0, 0)
  // Next day at 06:00
  const end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + dayOffset + 1, 6, 0, 0)

  const formatISO = (d: Date) => {
    const offset = -d.getTimezoneOffset()
    const sign = offset >= 0 ? "+" : "-"
    const absOffset = Math.abs(offset)
    const tzHours = pad(Math.floor(absOffset / 60))
    const tzMins = pad(absOffset % 60)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${tzHours}:${tzMins}`
  }

  return { dayStart: formatISO(start), dayEnd: formatISO(end) }
}

export function PrototypeTelemetryProvider({ children }: { children: ReactNode }) {
  // Data source control — default to "live" (Today) for real-time view
  const [dataSource, setDataSource] = useState<DataSourceMode>("live")
  // Station identity comes from the APP-WIDE location context (the sidebar
  // picker) — never a local copy. Selecting Norderstedt in the sidebar MUST
  // switch every telemetry view to Norderstedt, and the in-page station
  // select (data-source-switcher) writes through to the same global context.
  const { stationId, setStationId } = useStation()
  const [historicalRange, setHistoricalRange] = useState(getDefaultHistoricalRange)

  // Boot the shared simulation host in `day_sim` mode by default. The
  // Day-Sim screen also asserts this via `forceDaySim`, but defaulting
  // here means Snapshot and Commands show the same simulated May-1
  // dataset on first load instead of starting in the realtime sinusoid
  // demo and forcing the operator to switch tabs manually.
  const simulated = usePrototypeTelemetry({
    intervalMs: 1000,
    historySize: 600,
    simMode: "day_sim",
  })

  // Live telemetry — only poll when in live mode
  const live = useLiveTelemetry({
    stationId,
    pollIntervalMs: 2000,
    enabled: dataSource === "live",
  })

  // Today's operating day data for live mode — fetch full 6am-6am range
  // This gives us the full day's history for charts while live.frame
  // provides the real-time "now" point.
  //
  // We anchor the window on the latest live telemetry frame rather than the
  // wall clock. If the upstream feed lags (its newest frame is from an earlier
  // day), this keeps the timeline pointed at the most recent operating day that
  // actually has data instead of rendering an empty "today". We bucket the
  // anchor to the operating day (date + whether it's pre/post 06:00) so the
  // 2s live poll doesn't churn the SWR keys every tick.
  const liveAnchorKey = useMemo(() => {
    const ts = live.frame?.ts
    if (!ts) return null
    const d = new Date(ts)
    const opOffset = d.getHours() < 6 ? -1 : 0
    // Noon of the operating day's calendar date — a stable, unambiguous anchor
    // that sits safely after the 06:00 roll so getTodayOperatingDayRange maps
    // it to the correct 06:00 → 06:00 window.
    const opNoon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + opOffset, 12, 0, 0)
    return opNoon.getTime()
  }, [live.frame?.ts])

  const todayRange = useMemo(
    () => getTodayOperatingDayRange(liveAnchorKey != null ? new Date(liveAnchorKey) : undefined),
    [liveAnchorKey],
  )
  const todayDayView = useDayView({
    stationId,
    dayStart: todayRange.dayStart,
    dayEnd: todayRange.dayEnd,
    enabled: dataSource === "live",
  })

  // Historical day view — only fetch when in historical mode
  const historical = useDayView({
    stationId,
    dayStart: historicalRange.dayStart,
    dayEnd: historicalRange.dayEnd,
    enabled: dataSource === "historical",
  })

  // Unified frame accessor
  const frame =
    dataSource === "live"
      ? live.frame
      : dataSource === "historical"
        ? historical.telemetry.playback.currentFrame
        : simulated.frame

  const isLoading =
    dataSource === "live"
      ? live.isLoading
      : dataSource === "historical"
        ? historical.isLoading
        : false

  // Unified frame history for charting
  // For live mode: use today's full day view frames (6am-now)
  // For historical: use frames up to current playback index
  // For simulated: use simulated history buffer
  const frameHistory = useMemo(() => {
    if (dataSource === "live") {
      // Use today's operating day frames from the API
      // These are fetched via useDayView and contain the full history
      return todayDayView.telemetry.frames
    }
    if (dataSource === "historical") {
      return historical.telemetry.frames.slice(0, historical.telemetry.playback.currentIndex + 1)
    }
    return simulated.history
  }, [dataSource, todayDayView.telemetry.frames, historical.telemetry.frames, historical.telemetry.playback.currentIndex, simulated.history])

  // "Now" index for chart indicators
  // For live: last frame in today's history (or find closest to current time)
  // For historical: current playback index
  // For simulated: last frame
  const nowIndex = useMemo(() => {
    if (dataSource === "live") {
      // Find the frame closest to "now" in today's frames
      const frames = todayDayView.telemetry.frames
      if (frames.length === 0) return 0
      const now = Date.now()
      // Find last frame that's before or at "now"
      let idx = frames.length - 1
      for (let i = frames.length - 1; i >= 0; i--) {
        if (new Date(frames[i].ts).getTime() <= now) {
          idx = i
          break
        }
      }
      return idx
    }
    if (dataSource === "historical") {
      return historical.telemetry.playback.currentIndex
    }
    return simulated.history.length - 1
  }, [dataSource, todayDayView.telemetry.frames, historical.telemetry.playback.currentIndex, simulated.history.length])

  const value: TelemetryContextValue = {
    dataSource,
    setDataSource,
    simulated,
    live,
    historical,
    frame,
    frameHistory,
    nowIndex,
    todayDayView,
    isLoading,
    stationId,
    setStationId,
    historicalRange,
    setHistoricalRange,
  }

  return <TelemetryCtx.Provider value={value}>{children}</TelemetryCtx.Provider>
}

export function usePrototypeTelemetryContext(): TelemetryContextValue {
  const ctx = useContext(TelemetryCtx)
  if (!ctx) {
    throw new Error(
      "usePrototypeTelemetryContext must be used inside <PrototypeTelemetryProvider>"
    )
  }
  return ctx
}

/**
 * Backward-compatible hook that returns just the simulated telemetry result.
 * Existing components that import `usePrototypeTelemetryContext` and expect
 * the old shape can continue to work by destructuring `simulated`.
 */
export function useSimulatedTelemetry(): UsePrototypeTelemetryResult {
  const ctx = usePrototypeTelemetryContext()
  return ctx.simulated
}
