/**
 * Per-OPERATING-DAY frame cache for historical telemetry.
 *
 * The historical pipeline asks for windows aligned to the operating
 * day boundary (06:00 LOCAL → 06:00 next-day LOCAL — the same way
 * dispatch shifts are bucketed in the rest of the product). The cache
 * keys MATCH that boundary so a "1-day" request writes exactly one
 * day entry, and a "30-day" request hits exactly 30 entries — instead
 * of the previous UTC-day scheme, which split every operating day
 * across two UTC-day buckets, producing partial slices that silently
 * truncated multi-day requests.
 *
 * An operating-day key is the local calendar date on which the day
 * STARTS, e.g. Monday → "2026-05-19" represents the window
 * `2026-05-19T06:00 local → 2026-05-20T06:00 local`.
 *
 * Today's op-day is never cached (still streaming).
 *
 * Cache keys look like:
 *   amperio:frames:v2:<stationId>:<step>:<YYYY-MM-DD>
 *
 * Bumping `v1` → `v2` invalidates old UTC-bucket entries automatically.
 */

import {
  getFrames,
  type ApiFramesResponse,
  type ApiTelemetryFrame,
} from "./amperio-api"
import {
  progressCacheHit,
  progressFetchEnd,
  progressFetchStart,
  progressPlan,
} from "./report-progress"

const CACHE_PREFIX = "amperio:frames:v3"
const LEGACY_PREFIX = "amperio:frames:v2"
const MAX_DAYS_PER_REQUEST = 7 // safety cap when batching contiguous runs

// One-shot eviction of the legacy UTC-bucket cache. Runs at module
// import in the browser, idempotent (the prefix is gone after the
// first pass). Keeps localStorage from carrying around dead data
// after the bump from v1 → v2; the new op-day scheme makes those
// entries unreachable anyway.
;(() => {
  if (typeof window === "undefined") return
  try {
    const ls = window.localStorage
    const toDelete: string[] = []
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i)
      if (k && k.startsWith(LEGACY_PREFIX)) toDelete.push(k)
    }
    for (const k of toDelete) ls.removeItem(k)
    if (toDelete.length > 0) {
      console.log(
        `[v0][frame-cache] migrated to op-day buckets — pruned ${toDelete.length} legacy v1 entries`,
      )
    }
  } catch {
    /* ignore — will retry on next load */
  }
})()

// ─────────────────────────────────────────────────────────────────────
// OPERATING-day helpers — boundary at 06:00 LOCAL.
//
// Why local time, not a fixed UTC offset?
//   The operating-day boundary in this product is "06:00 wall-clock
//   wherever the operator is sitting" — same convention used in the
//   dispatch UI and the calendar pickers. Computing it in local time
//   makes the cache key 1-to-1 with the operator's calendar pick:
//   tap "Monday" → cache key "2026-05-19" → window 06:00 Mon local
//   to 06:00 Tue local, regardless of DST.
//
//   Side effect: cache entries are user-timezone-specific. If the
//   same browser switches timezones between visits, the keys will
//   miss and the data will be re-fetched. Acceptable: timezone
//   changes are rare, and a stale cache from a different timezone
//   would represent a different physical window anyway.
// ─────────────────────────────────────────────────────────────────────

const OP_DAY_BOUNDARY_HOUR = 6

/** YYYY-MM-DD in LOCAL time. */
function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Map an instant to the operating-day key it BELONGS TO.
 * Anything before 06:00 local belongs to the PREVIOUS calendar date's
 * operating day, e.g. 02:00 local Tuesday is part of op-day Monday.
 */
function opDayKey(d: Date): string {
  const shifted = new Date(d.getTime())
  shifted.setHours(shifted.getHours() - OP_DAY_BOUNDARY_HOUR)
  return localDateKey(shifted)
}

/** Op-day key → start instant (06:00 local on that calendar date). */
function dayStartUtc(dayKey: string): Date {
  // Parse YYYY-MM-DD as local-midnight, then add the boundary offset.
  const [y, m, d] = dayKey.split("-").map(Number)
  return new Date(y, m - 1, d, OP_DAY_BOUNDARY_HOUR, 0, 0, 0)
}

/** Op-day key → end instant (06:00 local on the FOLLOWING calendar date − 1 ms). */
function dayEndUtc(dayKey: string): Date {
  const start = dayStartUtc(dayKey)
  // 24h later, minus 1 ms, so the [start, end] interval is closed-closed
  // and matches the rest of the codebase's day-slice convention.
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1)
}

function todayUtcKey(): string {
  return opDayKey(new Date())
}

/**
 * All operating-day keys whose [start, end] interval intersects
 * [from, to). NOTE: `to` is treated as EXCLUSIVE — this matches how
 * `rangeToOperatingDayIso` builds the request window (start of op-day
 * N, start of op-day N+1) and how the dispatch UI bucket convention
 * works elsewhere.
 *
 * Why this matters: a previous version walked while
 * `cursor <= opDayKey(to)`, which for a single-day request like
 * "May 23" (window = May-23 06:00 local → May-24 06:00 local) would
 * compute opDayKey(May-24 06:00 local) = "2026-05-24" and iterate
 * TWO op-days. The phantom second day got "cached" with at best one
 * boundary frame, and that 1-frame entry then poisoned subsequent
 * multi-day queries (a hit on the phantom day skipped the real
 * fetch). Treating `to` as exclusive — by deriving the last op-day
 * from `to − 1 ms` — produces exactly one op-day per real request
 * day.
 *
 * Robust against unaligned windows too: if `from` falls inside an
 * op-day, the partial day is included so its data still gets cached.
 */
function daysCovered(from: Date, to: Date): string[] {
  const out: string[] = []
  // Start from the op-day that CONTAINS `from` (could be the previous
  // calendar date if `from` is before 06:00 local).
  let cursor = dayStartUtc(opDayKey(from))
  // Last INCLUDED op-day = the one containing the last real instant
  // of the window. `to` is the start of the next op-day, so `to − 1ms`
  // is guaranteed to land inside the last real op-day.
  const lastInstant = new Date(Math.max(from.getTime(), to.getTime() - 1))
  const lastStart = dayStartUtc(opDayKey(lastInstant)).getTime()
  // Hard safety cap so a malformed range can never spin forever.
  const MAX_ITER = 400
  let i = 0
  while (cursor.getTime() <= lastStart && i++ < MAX_ITER) {
    out.push(localDateKey(cursor))
    // Advance one calendar day. Adding 24h handles DST cleanly because
    // we re-derive the next op-day boundary from the local calendar
    // date, not by raw ms arithmetic on the start instant.
    const next = new Date(cursor)
    next.setDate(next.getDate() + 1)
    cursor = next
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────
// LocalStorage I/O (best-effort; safe on SSR / quota errors / disabled)
// ─────────────────────────────────────────────────────────────────────

function ssrSafeStorage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function cacheKey(stationId: string, dayKey: string, stepSeconds: number): string {
  return `${CACHE_PREFIX}:${stationId}:${stepSeconds}:${dayKey}`
}

interface DayCacheEntry {
  /** ISO timestamp of when this day was fetched */
  fetchedAt: string
  /** Raw API frames for that day */
  frames: ApiTelemetryFrame[]
}

// In-memory mirror of the localStorage day cache. Same key shape, same
// values — but skips the JSON.parse roundtrip that dominates wall-clock
// time when the report re-mounts (e.g. user navigates away and back, or
// changes any state that re-runs the SWR hook). For a 7-day window with
// ~1440 frames/day, JSON.parse alone can be tens of ms per day on
// mid-range laptops; the mirror brings repeated reads down to a Map
// lookup. We never invalidate this map separately from localStorage
// because writes always go through `writeDay` which updates both.
const memoryMirror = new Map<string, ApiTelemetryFrame[]>()

function readDay(
  stationId: string,
  dayKey: string,
  stepSeconds: number,
): ApiTelemetryFrame[] | null {
  const k = cacheKey(stationId, dayKey, stepSeconds)
  const mem = memoryMirror.get(k)
  if (mem) return mem
  const ls = ssrSafeStorage()
  if (!ls) return null
  try {
    const raw = ls.getItem(k)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DayCacheEntry
    const frames = parsed.frames ?? null
    if (frames) memoryMirror.set(k, frames)
    return frames
  } catch {
    return null
  }
}

function writeDay(
  stationId: string,
  dayKey: string,
  stepSeconds: number,
  frames: ApiTelemetryFrame[],
): void {
  const ls = ssrSafeStorage()
  if (!ls) return
  const entry: DayCacheEntry = {
    fetchedAt: new Date().toISOString(),
    frames,
  }
  try {
    ls.setItem(cacheKey(stationId, dayKey, stepSeconds), JSON.stringify(entry))
    memoryMirror.set(cacheKey(stationId, dayKey, stepSeconds), frames)
  } catch (err) {
    // Quota exceeded or any other storage failure: silently degrade.
    // We trim aggressively here to keep the cache useful long-term.
    if (typeof window !== "undefined") {
      console.warn(
        `[v0][frame-cache] write failed for ${dayKey} (${frames.length} frames, ~${Math.round(
          JSON.stringify(entry).length / 1024,
        )}KB) — pruning oldest 10 entries and retrying. Err: ${
          (err as Error)?.name ?? "unknown"
        }`,
      )
    }
    try {
      pruneOldestEntries(ls, 10)
      ls.setItem(cacheKey(stationId, dayKey, stepSeconds), JSON.stringify(entry))
      memoryMirror.set(cacheKey(stationId, dayKey, stepSeconds), frames)
    } catch {
      if (typeof window !== "undefined") {
        console.warn(
          `[v0][frame-cache] write still failed after prune — giving up on ${dayKey}. ` +
            `Consider lowering stepSeconds or trimming the historical window.`,
        )
      }
    }
  }
}

/** When quota is exceeded, drop the N oldest cache entries. */
function pruneOldestEntries(ls: Storage, count: number): void {
  const entries: { key: string; fetchedAt: number }[] = []
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i)
    if (!k || !k.startsWith(CACHE_PREFIX)) continue
    try {
      const v = ls.getItem(k)
      if (!v) continue
      const parsed = JSON.parse(v) as DayCacheEntry
      entries.push({
        key: k,
        fetchedAt: new Date(parsed.fetchedAt ?? 0).getTime(),
      })
    } catch {
      // Corrupt entry — schedule for deletion.
      entries.push({ key: k, fetchedAt: 0 })
    }
  }
  entries.sort((a, b) => a.fetchedAt - b.fetchedAt)
  for (const e of entries.slice(0, count)) ls.removeItem(e.key)
}

// ─────────────────────────────────────────────────────────────────────
// Range stitching
// ─────────────────────────────────────────────────────────────────────

/** Group consecutive day keys into runs we can fetch in one API call. */
function groupConsecutive(dayKeys: string[]): string[][] {
  if (dayKeys.length === 0) return []
  const groups: string[][] = []
  let current: string[] = [dayKeys[0]]
  for (let i = 1; i < dayKeys.length; i++) {
    const prev = dayStartUtc(dayKeys[i - 1])
    const curr = dayStartUtc(dayKeys[i])
    const oneDayMs = 24 * 60 * 60 * 1000
    if (
      curr.getTime() - prev.getTime() === oneDayMs &&
      current.length < MAX_DAYS_PER_REQUEST
    ) {
      current.push(dayKeys[i])
    } else {
      groups.push(current)
      current = [dayKeys[i]]
    }
  }
  groups.push(current)
  return groups
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * getFrames + per-day localStorage cache.
 *
 * Behaviour:
 *  - Today's UTC day is always fetched live (data is still streaming).
 *  - Past UTC days are pulled from cache when available, otherwise
 *    fetched in contiguous runs (max ~7 days per upstream request).
 *  - The returned response has the same shape as `getFrames` and is
 *    sliced down to exactly the [from, to] window the caller asked for.
 */
export async function getFramesCached(
  stationId: string,
  from: string,
  to: string,
  stepSeconds: number,
): Promise<ApiFramesResponse> {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now()
  const fromDate = new Date(from)
  const toDate = new Date(to)
  if (
    isNaN(fromDate.getTime()) ||
    isNaN(toDate.getTime()) ||
    fromDate >= toDate
  ) {
    // Fall through to upstream — let it produce the canonical error / empty.
    return getFrames(stationId, from, to, stepSeconds)
  }

  const todayKey = todayUtcKey()
  const allDays = daysCovered(fromDate, toDate)

  // Declare the total work up front (one unit per UTC day) so the loader
  // can render a real percentage as cache hits + network fetches land.
  progressPlan(allDays.length)

  // Partition: cached past-days vs days that need a fetch.
  const cachedFrames: ApiTelemetryFrame[] = []
  const missing: string[] = []
  const cachedDays: string[] = []
  for (const day of allDays) {
    if (day === todayKey) {
      // Always re-fetch today (still streaming)
      missing.push(day)
      continue
    }
    const hit = readDay(stationId, day, stepSeconds)
    if (hit) {
      cachedFrames.push(...hit)
      cachedDays.push(day)
      // Tell the loading screen this day was served instantly from
      // the local cache. The UI uses this to render a green tick
      // alongside the slower network rows.
      progressCacheHit("frames", day)
    } else {
      missing.push(day)
    }
  }

  // Fetch missing days in contiguous runs, store each day individually.
  // Runs are launched in PARALLEL (Promise.all) — each `getFrames` call
  // is independent, the upstream Amperio backend handles concurrency
  // fine, and serialising them was previously responsible for ~half
  // the perceived "Loading frames and preparing report…" time on
  // multi-day reports where the date range straddles a gap in cached
  // days (so the runs can't be merged into one upstream request).
  const fetchedFrames: ApiTelemetryFrame[] = []
  const runs = groupConsecutive(missing)
  let networkCalls = 0
  const runResults = await Promise.all(
    runs.map(async (run) => {
      const runFrom = dayStartUtc(run[0]).toISOString()
      const runTo = dayEndUtc(run[run.length - 1]).toISOString()
      // Each parallel run emits its own start/end events so the
      // loading screen can render them as separate live rows.
      const startId = progressFetchStart("frames", {
        range: [run[0], run[run.length - 1]],
      })
      try {
        const resp = await getFrames(stationId, runFrom, runTo, stepSeconds)
        progressFetchEnd(startId)
        return { run, resp }
      } catch (err) {
        progressFetchEnd(startId, {
          error: (err as Error)?.message ?? "fetch failed",
        })
        throw err
      }
    }),
  )
  for (const { run, resp } of runResults) {
    networkCalls += 1
    fetchedFrames.push(...resp.frames)

    // Persist each day's slice — but only past days (not today)
    for (const day of run) {
      if (day === todayKey) continue
      const dayStart = dayStartUtc(day).getTime()
      const dayEnd = dayEndUtc(day).getTime()
      const slice = resp.frames.filter((f) => {
        const t = new Date(f.ts).getTime()
        return t >= dayStart && t <= dayEnd
      })
      // Don't cache empty days for very-recent ranges (could be a transient gap)
      if (slice.length > 0) {
        writeDay(stationId, day, stepSeconds, slice)
      }
    }
  }

  // Visible diagnostics — helps verify the cache is actually doing work.
  // You should see e.g. "[v0][frame-cache] hit 28d / fetch 2d (1 calls) — 12ms"
  // on the second load of the same window.
  if (typeof window !== "undefined") {
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now()
    console.log(
      `[v0][frame-cache] hit ${cachedDays.length}d / fetch ${missing.length}d (${networkCalls} call${
        networkCalls === 1 ? "" : "s"
      }) — ${Math.round(t1 - t0)}ms · station=${stationId} step=${stepSeconds}s window=${from.slice(
        0,
        10,
      )}…${to.slice(0, 10)}`,
    )
  }

  // Stitch + sort + slice to caller's exact window.
  const merged = [...cachedFrames, ...fetchedFrames].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  )
  const fromMs = fromDate.getTime()
  const toMs = toDate.getTime()
  const sliced = merged.filter((f) => {
    const t = new Date(f.ts).getTime()
    return t >= fromMs && t <= toMs
  })

  return {
    station_id: stationId,
    step_seconds: stepSeconds,
    frames: sliced,
  }
}

/** Manually clear the entire frame cache (e.g. from a settings UI). */
export function clearFrameCache(): void {
  memoryMirror.clear()
  const ls = ssrSafeStorage()
  if (!ls) return
  const toDelete: string[] = []
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i)
    if (k && k.startsWith(CACHE_PREFIX)) toDelete.push(k)
  }
  for (const k of toDelete) ls.removeItem(k)
}

/** Cache stats — useful for a debug panel. */
export function getFrameCacheStats(): {
  entries: number
  approxBytes: number
  oldestFetchedAt: string | null
} {
  const ls = ssrSafeStorage()
  if (!ls) return { entries: 0, approxBytes: 0, oldestFetchedAt: null }
  let entries = 0
  let bytes = 0
  let oldest: number | null = null
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i)
    if (!k || !k.startsWith(CACHE_PREFIX)) continue
    const v = ls.getItem(k)
    if (!v) continue
    entries += 1
    bytes += k.length + v.length
    try {
      const parsed = JSON.parse(v) as DayCacheEntry
      const t = new Date(parsed.fetchedAt ?? 0).getTime()
      if (oldest === null || t < oldest) oldest = t
    } catch {
      /* ignore */
    }
  }
  return {
    entries,
    approxBytes: bytes,
    oldestFetchedAt: oldest ? new Date(oldest).toISOString() : null,
  }
}
