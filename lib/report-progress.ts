/**
 * Tiny pub-sub used by the report-loading screen to show live, per-step
 * progress: which API endpoint is being fetched right now, which UTC
 * day it covers, whether the day was served from the local cache or
 * went to the network, and how long each step took.
 *
 * Why a separate module instead of React state:
 *   - The cache layer (`frame-cache.ts`, `sibling-cache.ts`) is pure
 *     TypeScript with no React dependency. Threading a setter through
 *     it would couple the data layer to the UI layer.
 *   - Multiple SWR fetchers race in parallel; a centralised emitter
 *     gives the loading screen a single subscription point to merge
 *     them into one ordered timeline.
 *   - The emitter is a no-op outside the browser (SSR is fine).
 *
 * Lifecycle:
 *   1. Loading screen calls `beginReport(label)` when the user clicks
 *      Run Report. This clears the previous run's events.
 *   2. Each cache call emits one `fetch-start` and one `fetch-end`
 *      event per day (or per multi-day batch for cache misses, which
 *      is what the upstream API actually serves).
 *   3. Loading screen subscribes via `useReportProgress()` and renders
 *      a live feed.
 *   4. When the dashboard mounts and the loader is unmounted, no
 *      explicit "end" call is needed — the events stay in memory and
 *      get cleared on the next `beginReport`.
 */

export type ProgressEventKind =
  | "fetch-start"
  | "fetch-end"
  | "cache-hit"

export type ProgressEndpoint =
  | "frames"
  | "prices-DAM"
  | "prices-IDM"
  | "cost"
  | "sessions"

export interface ProgressEvent {
  /** Monotonic id assigned in emit-order. Used as React key. */
  id: number
  kind: ProgressEventKind
  endpoint: ProgressEndpoint
  /**
   * Single UTC-day key (`YYYY-MM-DD`) when the event refers to one day,
   * or `[firstDay, lastDay]` when it refers to a contiguous batch the
   * upstream serves in one call. Cache-hit events are always per-day.
   */
  day?: string
  range?: [string, string]
  /** Filled in on `fetch-end`. Wall-clock ms for that fetch. */
  durationMs?: number
  /** When this event was emitted, ms since `beginReport`. */
  tSinceStart: number
  /** Anything went wrong (network error, parse error). */
  error?: string
}

type Listener = (events: ProgressEvent[]) => void

let nextId = 1
let runStartedAt = 0
let events: ProgressEvent[] = []
/**
 * Total number of work UNITS the pipeline expects to complete this run
 * (one unit = one UTC day of data for one endpoint). Declared up front
 * via `progressPlan` so the loader can render a REAL percentage instead
 * of a decorative shimmer. Accumulates across endpoints; reset by
 * `beginReport`. When 0 the loader falls back to an honest indeterminate
 * animation.
 */
let plannedUnits = 0
const listeners = new Set<Listener>()

function emit(): void {
  // Pass a fresh array so React's `useSyncExternalStore`-style consumers
  // see a new reference and re-render. The events list is small (tens
  // of entries even for a month report) so the copy is free.
  const snapshot = events.slice()
  for (const l of listeners) l(snapshot)
}

/**
 * Reset the timeline. Call this exactly once at the moment the report
 * pipeline begins (i.e. when the user clicks Run Report). Subsequent
 * `progress*` calls are scoped against the timestamp captured here so
 * `tSinceStart` is meaningful for the user.
 */
export function beginReport(): void {
  runStartedAt = nowMs()
  events = []
  plannedUnits = 0
  emit()
}

/**
 * Declare additional expected work units (typically the number of UTC
 * days a fetch will cover). Called by the cache layer the moment it
 * knows how many days a request spans, BEFORE the fetches resolve, so
 * the loader can show a truthful percentage. Additive across endpoints.
 */
export function progressPlan(units: number): void {
  if (!Number.isFinite(units) || units <= 0) return
  plannedUnits += Math.round(units)
  emit()
}

/** How many UTC days a start/end event covered (single day or a run). */
function unitsForEvent(e: ProgressEvent): number {
  if (e.range) {
    const [a, b] = e.range
    const da = Date.parse(`${a}T00:00:00Z`)
    const db = Date.parse(`${b}T00:00:00Z`)
    if (Number.isFinite(da) && Number.isFinite(db) && db >= da) {
      return Math.round((db - da) / 86_400_000) + 1
    }
    return 1
  }
  return 1
}

/**
 * Real completion percentage for the current run, or `null` when no plan
 * has been declared yet (loader shows an indeterminate state). Capped at
 * 99 while work remains so the bar never claims "done" before the
 * dashboard actually mounts and tears the loader down.
 */
export function getReportPercent(): number | null {
  if (plannedUnits <= 0) return null
  let done = 0
  for (const e of events) {
    if (e.kind === "cache-hit") done += 1
    else if (e.kind === "fetch-end") done += unitsForEvent(e)
  }
  const pct = Math.floor((done / plannedUnits) * 100)
  return Math.max(0, Math.min(99, pct))
}

/** Snapshot of planned vs. completed units for step counters in the UI. */
export function getReportUnits(): { done: number; planned: number } {
  let done = 0
  for (const e of events) {
    if (e.kind === "cache-hit") done += 1
    else if (e.kind === "fetch-end") done += unitsForEvent(e)
  }
  return { done, planned: plannedUnits }
}

/** Subscribe to the event stream. Returns an unsubscribe fn. */
export function subscribeReportProgress(l: Listener): () => void {
  listeners.add(l)
  // Push the current snapshot immediately so a late subscriber doesn't
  // see an empty feed while events are already in flight.
  l(events.slice())
  return () => {
    listeners.delete(l)
  }
}

/** Snapshot accessor for components that don't want a subscription. */
export function getReportProgress(): ProgressEvent[] {
  return events.slice()
}

/**
 * Mark the start of a network fetch. Returns a token the caller passes
 * back to `progressFetchEnd` to pair start/end events without globals.
 */
export function progressFetchStart(
  endpoint: ProgressEndpoint,
  opts: { day?: string; range?: [string, string] } = {},
): number {
  const id = nextId++
  events.push({
    id,
    kind: "fetch-start",
    endpoint,
    day: opts.day,
    range: opts.range,
    tSinceStart: nowMs() - runStartedAt,
  })
  emit()
  return id
}

export function progressFetchEnd(
  startId: number,
  opts: { error?: string } = {},
): void {
  const start = events.find((e) => e.id === startId && e.kind === "fetch-start")
  const startedAt = start ? start.tSinceStart : 0
  const tNow = nowMs() - runStartedAt
  events.push({
    id: nextId++,
    kind: "fetch-end",
    endpoint: start?.endpoint ?? "frames",
    day: start?.day,
    range: start?.range,
    durationMs: tNow - startedAt,
    tSinceStart: tNow,
    error: opts.error,
  })
  emit()
}

/**
 * Record a cache hit. We don't pair these with start/end because they
 * resolve synchronously; the UI shows them as a single tick.
 */
export function progressCacheHit(
  endpoint: ProgressEndpoint,
  day: string,
): void {
  events.push({
    id: nextId++,
    kind: "cache-hit",
    endpoint,
    day,
    tSinceStart: nowMs() - runStartedAt,
  })
  emit()
}

function nowMs(): number {
  if (typeof performance !== "undefined") return performance.now()
  return Date.now()
}
