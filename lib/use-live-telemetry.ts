/**
 * Live Telemetry Hook
 *
 * Connects the prototype UI to the real Amperio backend API instead of
 * the in-browser simulation. Polls /telemetry/latest at a configurable
 * interval (default 1s) and converts the response to the TelemetryFrame
 * shape the UI components expect.
 *
 * For historical replay (Dispatching Timeline), use /telemetry/frames
 * to fetch a time range and drive the UI from that array.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import useSWR from "swr"
import {
  getLatestFrame,
  getFrames,
  getPrices,
  getCost,
  getSessions,
  getStationConfig,
  listStations,
  apiFrameToTelemetryFrame,
  DEFAULT_STATION_ID,
  type ApiTelemetryFrame,
  type ApiFramesResponse,
  type ApiPricesResponse,
  type ApiCostResponse,
  type ApiSessionsResponse,
  type ApiStationConfig,
  type ApiStationListItem,
} from "./amperio-api"
import { getFramesCached } from "./frame-cache"
import {
  getPricesCached,
  getCostCached,
  getSessionsCached,
} from "./sibling-cache"
import type {
  TelemetryFrame,
  TelemetryEvent,
  CostAccumulator,
  CostHistoryPoint,
  ControlMode,
} from "./prototype-telemetry"

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface UseLiveTelemetryOptions {
  stationId?: string
  /** Polling interval in ms for live mode (default 2000) */
  pollIntervalMs?: number
  /** Enable/disable polling (default true) */
  enabled?: boolean
}

export interface UseLiveTelemetryResult {
  /** Current telemetry frame (null while loading) */
  frame: TelemetryFrame | null
  /** Raw API frame for debugging */
  rawFrame: ApiTelemetryFrame | null
  /** Accumulated frame history for charting (newest last) */
  frameHistory: TelemetryFrame[]
  /** Loading state */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Time since last successful fetch (ms) */
  ageMs: number
  /** Station ID being polled */
  stationId: string
  /** Manually refresh */
  refresh: () => void
}

// ─────────────────────────────────────────────────────────────────────
// Live Telemetry Hook (polling /latest)
// ─────────────────────────────────────────────────────────────────────

export function useLiveTelemetry(
  options: UseLiveTelemetryOptions = {}
): UseLiveTelemetryResult {
  const {
    stationId = DEFAULT_STATION_ID,
    pollIntervalMs = 5000, // Poll API every 5 seconds (backend updates every ~30s)
    enabled = true,
  } = options

  const startTimeRef = useRef<number>(Date.now())
  const [ageMs, setAgeMs] = useState(0)
  
  // Track previous frames for power calculation
  const prevFrameRef = useRef<{ frame: TelemetryFrame; ts: number } | null>(null)
  // Power we derived for the CURRENT backend frame, keyed by its timestamp.
  // Re-applying this whenever the memo recomputes for the same frame makes the
  // derivation idempotent — without it, a memo recompute (React may drop
  // memoized values, and the ageMs/history re-renders fire every 500ms) would
  // skip the `prev.ts !== currTs` branch and reset charger power back to the
  // API's 0, making the bird's-eye charger flow blink off between frames.
  const derivedRef = useRef<{ ts: number; power: [number, number] } | null>(null)

  const {
    data: rawFrame,
    error,
    isLoading,
    mutate,
  } = useSWR<ApiTelemetryFrame>(
    enabled ? ["telemetry-latest", stationId] : null,
    () => getLatestFrame(stationId),
    {
      refreshInterval: pollIntervalMs,
      revalidateOnFocus: false,
      dedupingInterval: pollIntervalMs / 2,
    }
  )

  // Convert API frame to internal shape and calculate EV power from energy delta
  const frame = useMemo(() => {
    if (!rawFrame) return null
    
    const converted = apiFrameToTelemetryFrame(rawFrame, startTimeRef.current)
    const currTs = new Date(rawFrame.ts).getTime()

    // Idempotent path: we've already processed this exact backend frame. Re-apply
    // the previously derived power so a memo recompute for the same frame (or the
    // 500ms ageMs re-render) never resets the charger flow back to 0. This is what
    // keeps the power visible continuously until the next frame actually arrives.
    if (derivedRef.current && derivedRef.current.ts === currTs) {
      for (let i = 0; i < 2; i++) {
        const c = converted.chargers[i]
        const p = derivedRef.current.power[i]
        if (c && c.P_EV_w === 0 && p > 0) c.P_EV_w = p
      }
      return converted
    }

    const prev = prevFrameRef.current

    // Calculate EV charging power from cumulative energy delta if API reports 0
    if (prev && prev.ts !== currTs) {
      const deltaSeconds = (currTs - prev.ts) / 1000
      
      for (let i = 0; i < 2; i++) {
        const currCharger = converted.chargers[i]
        const prevCharger = prev.frame.chargers[i]
        
        // If current power is 0 but we have energy data, calculate from delta
        if (currCharger && prevCharger && currCharger.P_EV_w === 0) {
          const currEnergyKwh = currCharger.E_EV_chg_kwh ?? 0
          const prevEnergyKwh = prevCharger.E_EV_chg_kwh ?? 0
          const energyDeltaWh = (currEnergyKwh - prevEnergyKwh) * 1000 // Convert kWh to Wh
          
          // Only calculate if energy increased and delta time is reasonable (5s - 120s)
          if (energyDeltaWh > 0 && deltaSeconds >= 5 && deltaSeconds <= 120) {
            const calculatedPowerW = (energyDeltaWh / deltaSeconds) * 3600
            // Sanity check: power should be between 100W and 150kW
            if (calculatedPowerW >= 100 && calculatedPowerW <= 150000) {
              currCharger.P_EV_w = Math.round(calculatedPowerW)
            }
          }

          // Energy counters often update less frequently than `ts`, so a fresh
          // frame can report 0 power with no energy delta even though the car is
          // still charging. Hold the last known power while the plug stays
          // connected and charging hasn't clearly ended, so the flow persists
          // until the next meaningful update instead of dropping out each frame.
          if (
            currCharger.P_EV_w === 0 &&
            prevCharger.P_EV_w > 0 &&
            currCharger.plug_state === "Plugged" &&
            currCharger.charging_state !== "Idle" &&
            currCharger.charging_state !== "Finishing"
          ) {
            currCharger.P_EV_w = prevCharger.P_EV_w
          }
        }
      }
    }
    
    // Store current frame for next comparison + remember the derived power so
    // re-renders for this same frame stay consistent (see idempotent path above).
    prevFrameRef.current = { frame: converted, ts: currTs }
    derivedRef.current = {
      ts: currTs,
      power: [converted.chargers[0]?.P_EV_w ?? 0, converted.chargers[1]?.P_EV_w ?? 0],
    }
    
    return converted
  }, [rawFrame])

  // Accumulate frame history for live charting. Keep ~2 hours of data
  // (720 frames at 10s intervals or 360 at 20s). Older frames roll off.
  const MAX_HISTORY = 720
  const frameHistoryRef = useRef<TelemetryFrame[]>([])
  
  useEffect(() => {
    if (!frame) return
    const history = frameHistoryRef.current
    // Avoid duplicates (same timestamp)
    if (history.length > 0 && history[history.length - 1].ts === frame.ts) return
    history.push(frame)
    // Trim old entries
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY)
    }
  }, [frame])
  
  // Expose as stable array (new ref on each push so React sees the update)
  const frameHistory = frameHistoryRef.current

  // Track age
  useEffect(() => {
    if (!rawFrame) return
    const interval = setInterval(() => {
      const frameTime = new Date(rawFrame.ts).getTime()
      setAgeMs(Date.now() - frameTime)
    }, 500)
    return () => clearInterval(interval)
  }, [rawFrame])

  const refresh = useCallback(() => {
    mutate()
  }, [mutate])

  return {
    frame,
    rawFrame: rawFrame ?? null,
    frameHistory,
    isLoading,
    error: error ?? null,
    ageMs,
    stationId,
    refresh,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Historical Replay Hook (for Dispatching Timeline)
// ─────────────────────────────────────────────────────────────────────

export interface UseHistoricalTelemetryOptions {
  stationId?: string
  /** ISO-8601 datetime with timezone */
  from: string
  /** ISO-8601 datetime with timezone */
  to: string
  /** Sub-sample interval in seconds (default 60) */
  stepSeconds?: number
  /** Enable/disable fetching */
  enabled?: boolean
}

export interface UseHistoricalTelemetryResult {
  /** All frames in the time range */
  frames: TelemetryFrame[]
  /** Raw API response */
  rawResponse: ApiFramesResponse | null
  /** Loading state */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Playback controls */
  playback: {
    /** Current frame index */
    currentIndex: number
    /** Current frame */
    currentFrame: TelemetryFrame | null
    /** Is playing */
    isPlaying: boolean
    /** Play/pause toggle */
    togglePlay: () => void
    /** Seek to specific index */
    seekTo: (index: number) => void
    /** Seek to specific timestamp */
    seekToTime: (ts: Date) => void
    /** Reset to beginning */
    reset: () => void
    /** Step forward by N frames (default 1) */
    stepForward: (n?: number) => void
    /** Step backward by N frames (default 1) */
    stepBackward: (n?: number) => void
    /** Jump forward by N minutes */
    jumpForwardMinutes: (minutes: number) => void
    /** Jump backward by N minutes */
    jumpBackwardMinutes: (minutes: number) => void
    /** Playback speed multiplier */
    speed: number
    /** Set playback speed */
    setSpeed: (speed: number) => void
    /** Elapsed simulation seconds */
    elapsedSeconds: number
    /** Total duration in seconds */
    totalSeconds: number
  }
}

export function useHistoricalTelemetry(
  options: UseHistoricalTelemetryOptions
): UseHistoricalTelemetryResult {
  const {
    stationId = DEFAULT_STATION_ID,
    from,
    to,
    stepSeconds = 60,
    enabled = true,
  } = options

  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(3600) // Default: 3600x (1s playback = 1hr real data)
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const {
    data: rawResponse,
    error,
    isLoading,
  } = useSWR<ApiFramesResponse>(
    enabled ? ["telemetry-frames", stationId, from, to, stepSeconds] : null,
    // Routed through getFramesCached → per-UTC-day localStorage cache.
    // Past days are served from cache; today is always re-fetched live.
    () => getFramesCached(stationId, from, to, stepSeconds),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // Keep already-fetched frames "fresh" within SWR for the
      // entire session. Otherwise re-mounting the report screen
      // (configure → loading → report flow re-creates the hook)
      // causes SWR to revalidate-in-background even when the
      // underlying day cache will return synchronously, which
      // shows a brief loading flash.
      dedupingInterval: 24 * 60 * 60 * 1000,
      revalidateIfStale: false,
    }
  )

  // Cache the costly conversion + power-derivation pass against the
  // raw frames *array reference*, not against the SWR response
  // wrapper. SWR sometimes hands back a fresh `rawResponse` object
  // even when the frames inside are the exact same array (cache hit
  // from `getFramesCached` returning the same value through the
  // memoryMirror), and the previous keying on `rawResponse + baseTs`
  // would re-run the 1440-frame conversion loop unnecessarily on
  // every report remount. Keying on `rawResponse?.frames` avoids
  // that — the frame-cache mirror returns the same reference, so the
  // memo stays warm across remounts.
  const rawFramesArray = rawResponse?.frames ?? null
  const baseTs = rawFramesArray?.[0]
    ? new Date(rawFramesArray[0].ts).getTime()
    : undefined

  const frames: TelemetryFrame[] = useMemo(() => {
    if (!rawFramesArray) return []

    // First convert all frames
    const convertedFrames = rawFramesArray.map((f: ApiTelemetryFrame) =>
      apiFrameToTelemetryFrame(f, baseTs)
    )
    
    // Then calculate charging power from energy counter deltas
    // Since p_ev_w is often 0, we derive power from the change in e_ev_chg_kwh
    // We look at the NEXT frame's energy increase to calculate current frame's power
    // This way, when viewing frame N, we see power that was active during that interval
    for (let i = 0; i < convertedFrames.length - 1; i++) {
      const currFrame = convertedFrames[i]
      const nextFrame = convertedFrames[i + 1]
      const timeDeltaSec = (new Date(nextFrame.ts).getTime() - new Date(currFrame.ts).getTime()) / 1000
      
      if (timeDeltaSec > 0 && timeDeltaSec < 300) { // Only calc if reasonable interval (< 5min)
        for (let c = 0; c < currFrame.chargers.length; c++) {
          const currCharger = currFrame.chargers[c]
          const nextCharger = nextFrame.chargers[c]
          
          if (currCharger && nextCharger) {
            const energyDeltaKwh = nextCharger.E_EV_chg_kwh - currCharger.E_EV_chg_kwh
            
            // Only calculate if energy increased (charging) and reported power is 0
            if (energyDeltaKwh > 0 && currCharger.P_EV_w === 0) {
              // Power (W) = Energy (kWh) / Time (h) * 1000
              const calculatedPowerW = (energyDeltaKwh / (timeDeltaSec / 3600)) * 1000
              
              // Apply calculated power if it's reasonable (< 500kW)
              if (calculatedPowerW > 0 && calculatedPowerW < 500_000) {
                currCharger.P_EV_w = Math.round(calculatedPowerW)
              }
            }
          }
        }
      }
    }
    
    // For the last frame, copy power from second-to-last if charging is in progress
    if (convertedFrames.length >= 2) {
      const lastFrame = convertedFrames[convertedFrames.length - 1]
      const prevFrame = convertedFrames[convertedFrames.length - 2]
      for (let c = 0; c < lastFrame.chargers.length; c++) {
        const lastCharger = lastFrame.chargers[c]
        const prevCharger = prevFrame.chargers[c]
        if (lastCharger && prevCharger && lastCharger.P_EV_w === 0 && lastCharger.charging_state === "InProgress") {
          lastCharger.P_EV_w = prevCharger.P_EV_w
        }
      }
    }
    
    return convertedFrames
  }, [rawFramesArray, baseTs])

  const currentFrame = frames[currentIndex] ?? null

  // When a fresh set of frames lands (e.g. user switches operating
  // day or extends the historical range), default the playback head
  // to the LAST frame. Rationale: the page-level KPIs, charts and
  // optimizer comparison all reflect the cumulative state at the
  // current frame, and operators almost always want to see the
  // end-of-period totals first — not the empty 06:00 starting state
  // that produced the original UX complaint about "everything looks
  // blank after a fetch". The reset-to-beginning workflow stays one
  // click away via the explicit "Play from beginning" button.
  //
  // We key the effect on `frames.length` (not the frames array
  // itself) so manual scrubbing inside the same data set is never
  // overridden — the effect only fires when the SWR fetch produces
  // a new-length payload.
  // Auto-reset playback whenever the *window* changes — not just when
  // the frame count changes. Keying on `frames.length` alone caused a
  // subtle bug: if the user picked a different historical range that
  // happened to yield the same number of frames (e.g. any two 24 h
  // windows at 60 s steps both produce 1440), `currentIndex` stayed
  // pointing at the old end and the screen displayed stale data until
  // the user manually scrubbed the slider. Keying on the window
  // signature (stationId + from + to + stepSeconds) makes every range
  // change snap the cursor to the new last frame and pause playback,
  // so the chart, KPIs and replay panel all "reload" automatically.
  const lastWindowKeyRef = useRef<string>("")
  useEffect(() => {
    if (frames.length === 0) {
      lastWindowKeyRef.current = ""
      return
    }
    const windowKey = `${stationId}|${from}|${to}|${stepSeconds}`
    if (windowKey !== lastWindowKeyRef.current) {
      lastWindowKeyRef.current = windowKey
      setCurrentIndex(frames.length - 1)
      setIsPlaying(false)
    }
  }, [frames.length, stationId, from, to, stepSeconds])

  // Playback loop
  useEffect(() => {
    if (!isPlaying || frames.length === 0) {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current)
        playIntervalRef.current = null
      }
      return
    }

    // Calculate how to achieve the desired playback speed:
    // - At low speeds (< 600x): tick every frame with variable interval
    // - At high speeds (>= 600x): tick at fixed 50ms interval but skip multiple frames
    const MIN_INTERVAL_MS = 50 // Minimum interval for smooth UI updates
    const rawIntervalMs = (stepSeconds * 1000) / speed
    
    // If raw interval would be too fast, use frame skipping instead
    const useFrameSkipping = rawIntervalMs < MIN_INTERVAL_MS
    const intervalMs = useFrameSkipping ? MIN_INTERVAL_MS : rawIntervalMs
    const framesPerTick = useFrameSkipping ? Math.ceil(MIN_INTERVAL_MS / rawIntervalMs) : 1

    playIntervalRef.current = setInterval(() => {
      setCurrentIndex((prev) => {
        const next = prev + framesPerTick
        if (next >= frames.length - 1) {
          setIsPlaying(false)
          return frames.length - 1
        }
        return next
      })
    }, intervalMs)

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current)
        playIntervalRef.current = null
      }
    }
  }, [isPlaying, frames.length, stepSeconds, speed])

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => !p)
  }, [])

  const seekTo = useCallback(
    (index: number) => {
      setCurrentIndex(Math.max(0, Math.min(frames.length - 1, index)))
    },
    [frames.length]
  )

  const seekToTime = useCallback(
    (ts: Date) => {
      const targetMs = ts.getTime()
      const idx = frames.findIndex((f) => new Date(f.ts).getTime() >= targetMs)
      if (idx >= 0) seekTo(idx)
    },
    [frames, seekTo]
  )

  const reset = useCallback(() => {
    setCurrentIndex(0)
    setIsPlaying(false)
  }, [])

  // Step forward by N frames (default 1)
  const stepForward = useCallback((n = 1) => {
    setCurrentIndex((prev) => Math.min(frames.length - 1, prev + n))
  }, [frames.length])

  // Step backward by N frames (default 1)
  const stepBackward = useCallback((n = 1) => {
    setCurrentIndex((prev) => Math.max(0, prev - n))
  }, [])

  // Jump forward by time (e.g., 5 minutes, 1 hour)
  const jumpForwardMinutes = useCallback((minutes: number) => {
    const framesToSkip = Math.ceil((minutes * 60) / stepSeconds)
    stepForward(framesToSkip)
  }, [stepSeconds, stepForward])

  // Jump backward by time
  const jumpBackwardMinutes = useCallback((minutes: number) => {
    const framesToSkip = Math.ceil((minutes * 60) / stepSeconds)
    stepBackward(framesToSkip)
  }, [stepSeconds, stepBackward])

  const elapsedSeconds = currentIndex * stepSeconds
  const totalSeconds = frames.length * stepSeconds

  return {
    frames,
    rawResponse: rawResponse ?? null,
    isLoading,
    error: error ?? null,
    playback: {
      currentIndex,
      currentFrame,
      isPlaying,
      togglePlay,
      seekTo,
      seekToTime,
      reset,
      stepForward,
      stepBackward,
      jumpForwardMinutes,
      jumpBackwardMinutes,
      speed,
      setSpeed,
      elapsedSeconds,
      totalSeconds,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────
// EPEX Prices Hook
// ─────────────────────────────────────────────────────────────────────

export interface UsePricesOptions {
  source?: "DAM" | "IDM"
  from: string
  to: string
  resolution?: "PT15M" | "PT60M"
  enabled?: boolean
}

export function usePrices(options: UsePricesOptions) {
  const {
    source = "DAM",
    from,
    to,
    resolution = "PT60M",
    enabled = true,
  } = options

  const { data, error, isLoading } = useSWR<ApiPricesResponse>(
    enabled ? ["prices", source, from, to, resolution] : null,
    () => getPricesCached(source, from, to, resolution),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // Prices for a past day are immutable; for today they update
      // when EPEX publishes IDM continuous trades. A 24h dedupe
      // keeps the report screen instant on remount; live mode uses
      // its own polling path so this doesn't impact freshness.
      dedupingInterval: 24 * 60 * 60 * 1000,
      revalidateIfStale: false,
    }
  )

  return {
    prices: data?.prices ?? [],
    stats: data?.stats ?? null,
    isLoading,
    error: error ?? null,
  }
}

// ───────��─────��───────────────────────────────────────────────────────
// Cost Hook
// ─────────────────────────────────────────────────────────────────────

export interface UseCostOptions {
  stationId?: string
  from: string
  to: string
  source?: "DAM" | "IDM"
  enabled?: boolean
}

export function useCost(options: UseCostOptions) {
  const {
    stationId = DEFAULT_STATION_ID,
    from,
    to,
    source = "IDM",
    enabled = true,
  } = options

  const { data, error, isLoading } = useSWR<ApiCostResponse>(
    enabled ? ["cost", stationId, from, to, source] : null,
    () => getCostCached(stationId, from, to, source),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // Cost buckets for a closed operating day are immutable.
      // Long dedupe keeps Run Report instant on remount.
      dedupingInterval: 24 * 60 * 60 * 1000,
      revalidateIfStale: false,
    }
  )

  return {
    buckets: data?.buckets ?? [],
    total: data?.total ?? null,
    isLoading,
    error: error ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Sessions Hook
// ─────────────────────────────────────────────────────────────────────

export interface UseSessionsOptions {
  stationId?: string
  from: string
  to: string
  enabled?: boolean
}

export function useSessions(options: UseSessionsOptions) {
  const {
    stationId = DEFAULT_STATION_ID,
    from,
    to,
    enabled = true,
  } = options

  const { data, error, isLoading } = useSWR<ApiSessionsResponse>(
    enabled ? ["sessions", stationId, from, to] : null,
    () => getSessionsCached(stationId, from, to),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // Closed-day sessions are immutable.
      dedupingInterval: 24 * 60 * 60 * 1000,
      revalidateIfStale: false,
    }
  )

  return {
    evSessions: data?.ev_sessions ?? [],
    batterySessions: data?.battery_sessions ?? [],
    isLoading,
    error: error ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Combined "Day View" Hook for Dispatching Timeline
// ─────────────────────────────────────────────────────────────────────

export interface UseDayViewOptions {
  stationId?: string
  /** Operating day start in ISO-8601 (e.g. "2026-05-10T06:00:00+02:00") */
  dayStart: string
  /** Operating day end (24h later) */
  dayEnd: string
  enabled?: boolean
}

export interface UseDayViewResult {
  /** Telemetry frames for the day */
  telemetry: UseHistoricalTelemetryResult
  /** DAM prices for the day */
  damPrices: ReturnType<typeof usePrices>
  /** IDM prices for the day */
  idmPrices: ReturnType<typeof usePrices>
  /** Cost breakdown for the day */
  cost: ReturnType<typeof useCost>
  /** EV/Battery sessions for the day */
  sessions: ReturnType<typeof useSessions>
  /** Overall loading state */
  isLoading: boolean
}

// ─────────────────────────────────────────────────────────────────────
// Station Config Hook
// ─────────────────────────────────────────────────────────────────────

export interface UseStationConfigOptions {
  stationId?: string
  enabled?: boolean
}

export interface UseStationConfigResult {
  config: ApiStationConfig | null
  isLoading: boolean
  error: Error | null
}

export function useStationConfig(
  options: UseStationConfigOptions = {}
): UseStationConfigResult {
  const { stationId = DEFAULT_STATION_ID, enabled = true } = options

  const { data, error, isLoading } = useSWR<ApiStationConfig>(
    enabled ? ["station-config", stationId] : null,
    () => getStationConfig(stationId),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // Config rarely changes, cache for 1 min
    }
  )

  return {
    config: data ?? null,
    isLoading,
    error: error ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Stations List Hook
// ─────────────────────────────────────────────────────────────────────

export interface UseStationsListResult {
  stations: ApiStationListItem[]
  isLoading: boolean
  error: Error | null
}

export function useStationsList(enabled = true): UseStationsListResult {
  const { data, error, isLoading } = useSWR<ApiStationListItem[]>(
    enabled ? ["stations-list"] : null,
    () => listStations(),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  )

  return {
    stations: data ?? [],
    isLoading,
    error: error ?? null,
  }
}

// ──���──────────────────────────────────────────────────────────────────
// Combined "Day View" Hook for Dispatching Timeline
// ─────────────────────────────────────────────────────────────────────

export function useDayView(options: UseDayViewOptions): UseDayViewResult {
  const {
    stationId = DEFAULT_STATION_ID,
    dayStart,
    dayEnd,
    enabled = true,
  } = options

  const telemetry = useHistoricalTelemetry({
    stationId,
    from: dayStart,
    to: dayEnd,
    stepSeconds: 60,
    enabled,
  })

  const damPrices = usePrices({
    source: "DAM",
    from: dayStart,
    to: dayEnd,
    resolution: "PT60M",
    enabled,
  })

  const idmPrices = usePrices({
    source: "IDM",
    from: dayStart,
    to: dayEnd,
    resolution: "PT60M",
    enabled,
  })

  const cost = useCost({
    stationId,
    from: dayStart,
    to: dayEnd,
    source: "IDM",
    enabled,
  })

  const sessions = useSessions({
    stationId,
    from: dayStart,
    to: dayEnd,
    enabled,
  })

  const isLoading =
    telemetry.isLoading ||
    damPrices.isLoading ||
    idmPrices.isLoading ||
    cost.isLoading ||
    sessions.isLoading

  return {
    telemetry,
    damPrices,
    idmPrices,
    cost,
    sessions,
    isLoading,
  }
}
