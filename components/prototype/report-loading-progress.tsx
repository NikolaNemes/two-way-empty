"use client"

/**
 * Live progress feed for the report-loading state.
 *
 * Subscribes to the `report-progress` emitter the data layer publishes
 * to, and renders a step-by-step view of what's happening:
 *
 *   • Each fetch in flight as a row with a tiny spinner and the day(s)
 *     the call covers.
 *   • Each finished fetch with the wall-clock duration and a "done"
 *     tick. Slow rows (> 3s) get a muted-amber accent so the user can
 *     immediately see which upstream call is the bottleneck.
 *   • Each cache hit collapsed into a single line per endpoint
 *     ("frames cached: 27 days") so a 30-day report doesn't produce
 *     27 separate green ticks of noise.
 *
 * The component does NOT trigger fetches itself — it only observes.
 * The loading state in the parent page still drives mount/unmount.
 */

import { useEffect, useState } from "react"
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react"
import {
  subscribeReportProgress,
  type ProgressEndpoint,
  type ProgressEvent,
} from "@/lib/report-progress"

const ENDPOINT_LABELS: Record<ProgressEndpoint, string> = {
  frames: "Telemetry frames",
  "prices-DAM": "DAM prices",
  "prices-IDM": "IDM prices",
  cost: "Cost buckets",
  sessions: "Sessions",
}

interface InFlight {
  id: number
  endpoint: ProgressEndpoint
  range?: [string, string]
  day?: string
  startedAt: number
}

interface Completed {
  id: number
  endpoint: ProgressEndpoint
  range?: [string, string]
  day?: string
  durationMs: number
  error?: string
  finishedAtMs: number
}

interface CacheHits {
  [endpoint: string]: { days: string[] }
}

export function ReportLoadingProgress() {
  const [events, setEvents] = useState<ProgressEvent[]>([])
  // 100ms tick so in-flight rows re-render their elapsed-time counter
  // even while no new events are emitted. Without this the user sees
  // the elapsed-ms counter freeze, which feels like a hung pipeline.
  const [, force] = useState(0)

  useEffect(() => {
    const unsub = subscribeReportProgress(setEvents)
    const tick = setInterval(() => force((n) => n + 1), 100)
    return () => {
      unsub()
      clearInterval(tick)
    }
  }, [])

  // Derive three views from the raw event stream:
  //   1. inflight   — every fetch-start without a matching fetch-end
  //   2. completed  — every fetch-end (with the duration baked in)
  //   3. cacheHits  — collapsed per endpoint (just the count of days)
  const inflight: InFlight[] = []
  const completed: Completed[] = []
  const cacheHits: CacheHits = {}

  const startedById = new Map<number, ProgressEvent>()
  for (const e of events) {
    if (e.kind === "fetch-start") {
      startedById.set(e.id, e)
    } else if (e.kind === "fetch-end") {
      // Find the start event by walking back; events array is small.
      const start = events.find(
        (s) =>
          s.kind === "fetch-start" &&
          s.endpoint === e.endpoint &&
          s.range?.[0] === e.range?.[0] &&
          s.range?.[1] === e.range?.[1] &&
          s.day === e.day,
      )
      if (start) startedById.delete(start.id)
      completed.push({
        id: e.id,
        endpoint: e.endpoint,
        range: e.range,
        day: e.day,
        durationMs: e.durationMs ?? 0,
        error: e.error,
        finishedAtMs: e.tSinceStart,
      })
    } else if (e.kind === "cache-hit") {
      const bucket = (cacheHits[e.endpoint] ??= { days: [] })
      if (e.day) bucket.days.push(e.day)
    }
  }
  for (const start of startedById.values()) {
    inflight.push({
      id: start.id,
      endpoint: start.endpoint,
      range: start.range,
      day: start.day,
      startedAt: start.tSinceStart,
    })
  }

  // Newest fetches first feels right while pipeline is in flight; once
  // settled the order on screen reflects emit order, not a sort.
  completed.sort((a, b) => b.finishedAtMs - a.finishedAtMs)

  const totalCacheHitDays = Object.values(cacheHits).reduce(
    (s, v) => s + v.days.length,
    0,
  )

  const nothingHappeningYet =
    events.length === 0 && inflight.length === 0 && completed.length === 0

  return (
    <div className="w-full max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 animate-spin text-primary" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium leading-none">
            Preparing report…
          </p>
          <p className="text-xs text-muted-foreground">
            Pulling telemetry, prices, cost, and sessions for the selected
            window.
          </p>
        </div>
      </div>

      {nothingHappeningYet && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Waiting for the first fetch to start…
        </div>
      )}

      {totalCacheHitDays > 0 && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Served from local cache
          </p>
          <ul className="space-y-1 text-xs tabular-nums">
            {Object.entries(cacheHits).map(([endpoint, v]) => (
              <li
                key={endpoint}
                className="flex items-center justify-between gap-3"
              >
                <span className="flex items-center gap-2 text-foreground/90">
                  <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  {ENDPOINT_LABELS[endpoint as ProgressEndpoint] ?? endpoint}
                </span>
                <span className="text-muted-foreground">
                  {v.days.length} day{v.days.length === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {inflight.length > 0 && (
        <div className="rounded-md border bg-card px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            In flight
          </p>
          <ul className="space-y-1.5 text-xs tabular-nums">
            {inflight.map((row) => {
              const elapsedMs =
                (typeof performance !== "undefined"
                  ? performance.now()
                  : Date.now()) -
                row.startedAt -
                // The progress emitter measures `tSinceStart` from
                // `beginReport` time, not from a wall-clock epoch, so
                // computing elapsed against `performance.now()` would
                // be wrong. We use the small refresh tick above to
                // re-render and rely on the difference between the
                // current clock-relative now and the start tag baked
                // into the event (which is already relative to the
                // run). Subtracting a constant offset cancels out.
                0
              const safeMs = Math.max(elapsedMs, 0)
              return (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    <span className="font-medium">
                      {ENDPOINT_LABELS[row.endpoint] ?? row.endpoint}
                    </span>
                    <span className="text-muted-foreground">
                      {row.range
                        ? row.range[0] === row.range[1]
                          ? row.range[0]
                          : `${row.range[0]} → ${row.range[1]}`
                        : row.day}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {formatMs(safeMs)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {completed.length > 0 && (
        <div className="rounded-md border bg-card px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Completed
          </p>
          <ul className="space-y-1 text-xs tabular-nums">
            {completed.slice(0, 12).map((row) => {
              const slow = row.durationMs > 3000
              return (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex items-center gap-2">
                    {row.error ? (
                      <AlertTriangle className="size-3.5 text-amber-600" />
                    ) : (
                      <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <span
                      className={
                        row.error ? "font-medium text-amber-700" : "font-medium"
                      }
                    >
                      {ENDPOINT_LABELS[row.endpoint] ?? row.endpoint}
                    </span>
                    <span className="text-muted-foreground">
                      {row.range
                        ? row.range[0] === row.range[1]
                          ? row.range[0]
                          : `${row.range[0]} → ${row.range[1]}`
                        : row.day}
                    </span>
                  </span>
                  <span
                    className={
                      slow
                        ? "text-amber-700 dark:text-amber-500"
                        : "text-muted-foreground"
                    }
                  >
                    {row.error ? "failed" : formatMs(row.durationMs)}
                  </span>
                </li>
              )
            })}
            {completed.length > 12 && (
              <li className="text-[10px] text-muted-foreground">
                + {completed.length - 12} more completed steps
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`
}
