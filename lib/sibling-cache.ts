/**
 * Per-day cache for the three "sibling" endpoints used by the Report screen:
 *   • /prices   (DAM and IDM)
 *   • /telemetry/cost
 *   • /telemetry/sessions
 *
 * Same shape and guarantees as `lib/frame-cache.ts` — caches RAW API
 * responses only, on a per-OPERATING-DAY basis (06:00→06:00 local,
 * matching the historical pipeline's request windows), in
 * localStorage with an in-memory mirror to skip JSON.parse on warm
 * reads. Today's op-day is never cached because data is still
 * streaming.
 *
 * Why this exists separately from frame-cache:
 *   The Amperio responses for these three endpoints are SUMMARIES over
 *   the requested window (totals/stats fields are computed across the
 *   whole period). Caching at request granularity ("DAM prices for
 *   2026-04-20→2026-05-19") is wasteful because every (from,to) pair
 *   becomes a new key. Caching at day granularity lets us re-use a
 *   day's data across any window that includes it, mirroring how
 *   frame-cache works for /frames.
 *
 * What we DO NOT cache:
 *   The "stats" / "total" aggregate fields on the API response. They
 *   are window-specific and recomputed by the consumer at use-time.
 *   Only the per-bucket arrays (prices/buckets/sessions) are cached.
 *
 * v0 NOTE: caching only RAW REMOTE DATA, never any dispatching/
 * planning/algorithm output. Everything downstream of these calls
 * (planner, BMS-vs-Optimizer attribution, charts) recomputes on every
 * render — see the user-facing rule "cache only data fetched
 * remotely, not logic of dispatching".
 */

import {
  getPrices,
  getCost,
  getSessions,
  type ApiPricesResponse,
  type ApiCostResponse,
  type ApiSessionsResponse,
  type ApiPricePoint,
  type ApiCostBucket,
  type ApiEvSession,
  type ApiBatterySession,
} from "./amperio-api"
import {
  progressCacheHit,
  progressFetchEnd,
  progressFetchStart,
  type ProgressEndpoint,
} from "./report-progress"

const PREFIX = "amperio:sibling:v2"
const LEGACY_PREFIX = "amperio:sibling:v1"

// One-shot eviction of the legacy UTC-bucket sibling cache. See the
// matching block in `frame-cache.ts` for the rationale — same idea,
// runs once at module import, idempotent thereafter.
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
        `[v0][sibling-cache] migrated to op-day buckets — pruned ${toDelete.length} legacy v1 entries`,
      )
    }
  } catch {
    /* ignore */
  }
})()

// ─────────────────────────────────────────────────────────────────────
// OPERATING-day helpers — boundary at 06:00 LOCAL.
// Same scheme as frame-cache.ts, kept private. See frame-cache.ts for
// the full rationale; in short: aligning the cache key with the way
// the Report screen requests its windows (06:00→06:00 local) produces
// 1 cache entry per calendar day the user picked, with no partial
// slices straddling UTC midnight.
// ─────────────────────────────────────────────────────────────────────

const OP_DAY_BOUNDARY_HOUR = 6

function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function opDayKey(d: Date): string {
  const shifted = new Date(d.getTime())
  shifted.setHours(shifted.getHours() - OP_DAY_BOUNDARY_HOUR)
  return localDateKey(shifted)
}

function dayStartUtc(dayKey: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number)
  return new Date(y, m - 1, d, OP_DAY_BOUNDARY_HOUR, 0, 0, 0)
}

function dayEndUtc(dayKey: string): Date {
  const start = dayStartUtc(dayKey)
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1)
}

function todayUtcKey(): string {
  return opDayKey(new Date())
}

function daysCovered(from: Date, to: Date): string[] {
  const out: string[] = []
  let cursor = dayStartUtc(opDayKey(from))
  const lastStart = dayStartUtc(opDayKey(to)).getTime()
  const MAX_ITER = 400
  let i = 0
  while (cursor.getTime() <= lastStart && i++ < MAX_ITER) {
    out.push(localDateKey(cursor))
    const next = new Date(cursor)
    next.setDate(next.getDate() + 1)
    cursor = next
  }
  return out
}

function ssrSafeStorage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────
// Generic per-day cache primitive (same shape as frame-cache, but
// parameterised on the unit array element type T — a price point, a
// cost bucket, or a session).
// ─────────────────────────────────────────────────────────────────────

interface DayEntry<T> {
  v: 1
  fetchedAt: number
  items: T[]
}

const memoryMirror = new Map<string, unknown[]>()

function readDay<T>(key: string): T[] | null {
  const mem = memoryMirror.get(key) as T[] | undefined
  if (mem) return mem
  const ls = ssrSafeStorage()
  if (!ls) return null
  try {
    const raw = ls.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DayEntry<T>
    if (parsed.items) memoryMirror.set(key, parsed.items)
    return parsed.items ?? null
  } catch {
    return null
  }
}

function writeDay<T>(key: string, items: T[]): void {
  const ls = ssrSafeStorage()
  if (!ls) return
  const entry: DayEntry<T> = { v: 1, fetchedAt: Date.now(), items }
  try {
    ls.setItem(key, JSON.stringify(entry))
    memoryMirror.set(key, items)
  } catch {
    // Quota or other storage error — keep the in-memory mirror so the
    // current session still benefits, but skip persistent storage.
    memoryMirror.set(key, items)
  }
}

function groupConsecutive(days: string[]): string[][] {
  if (days.length === 0) return []
  const sorted = [...days].sort()
  const runs: string[][] = []
  let current: string[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00Z`).getTime()
    const here = new Date(`${sorted[i]}T00:00:00Z`).getTime()
    const oneDay = 24 * 60 * 60 * 1000
    if (here - prev === oneDay) current.push(sorted[i])
    else {
      runs.push(current)
      current = [sorted[i]]
    }
  }
  runs.push(current)
  return runs
}

// ─────────────────────────────────────────────────────────────────────
// Filtering helpers — each endpoint uses a different timestamp field.
// ─────────────────────────────────────────────────────────────────────

function tsOfPrice(p: ApiPricePoint): number {
  // ApiPricePoint has `ts` (ISO string).
  return new Date(p.ts).getTime()
}

function tsOfCostBucket(b: ApiCostBucket): number {
  return new Date(b.bucket_ts).getTime()
}

function tsOfEvSession(s: ApiEvSession): number {
  return new Date(s.session_start).getTime()
}

function tsOfBatterySession(s: ApiBatterySession): number {
  return new Date(s.session_start).getTime()
}

function inDay<T>(item: T, getTs: (i: T) => number, dayKey: string): boolean {
  const t = getTs(item)
  return t >= dayStartUtc(dayKey).getTime() && t <= dayEndUtc(dayKey).getTime()
}

// ─────────────────────────────────────────────────────────────────────
// PRICES
// ─────────────────────────────────────────────────────────────────────

function pricesKey(
  source: "DAM" | "IDM",
  resolution: string,
  dayKey: string,
): string {
  return `${PREFIX}:prices:${source}:${resolution}:${dayKey}`
}

export async function getPricesCached(
  source: "DAM" | "IDM",
  from: string,
  to: string,
  resolution: "PT15M" | "PT60M" = "PT60M",
): Promise<ApiPricesResponse> {
  const fromDate = new Date(from)
  const toDate = new Date(to)
  const days = daysCovered(fromDate, toDate)
  const today = todayUtcKey()

  const cached = new Map<string, ApiPricePoint[]>()
  const missing: string[] = []
  const pricesEndpoint: ProgressEndpoint =
    source === "DAM" ? "prices-DAM" : "prices-IDM"
  for (const day of days) {
    if (day === today) {
      missing.push(day)
      continue
    }
    const c = readDay<ApiPricePoint>(pricesKey(source, resolution, day))
    if (c) {
      cached.set(day, c)
      progressCacheHit(pricesEndpoint, day)
    } else {
      missing.push(day)
    }
  }

  // Fetch missing days in contiguous runs, in parallel.
  const runs = groupConsecutive(missing)
  const runResults = await Promise.all(
    runs.map(async (run) => {
      const runFrom = dayStartUtc(run[0]).toISOString()
      const runTo = dayEndUtc(run[run.length - 1]).toISOString()
      const startId = progressFetchStart(pricesEndpoint, {
        range: [run[0], run[run.length - 1]],
      })
      try {
        const resp = await getPrices(source, runFrom, runTo, resolution)
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
    for (const day of run) {
      const slice = resp.prices.filter((p) => inDay(p, tsOfPrice, day))
      if (day !== today && slice.length > 0) {
        writeDay(pricesKey(source, resolution, day), slice)
      }
      cached.set(day, slice)
    }
  }

  // Stitch + slice to the exact (from, to) the caller asked for.
  const fromMs = fromDate.getTime()
  const toMs = toDate.getTime()
  const allPrices: ApiPricePoint[] = []
  for (const day of days) {
    const dayPrices = cached.get(day) ?? []
    for (const p of dayPrices) {
      const t = tsOfPrice(p)
      if (t >= fromMs && t <= toMs) allPrices.push(p)
    }
  }
  allPrices.sort((a, b) => tsOfPrice(a) - tsOfPrice(b))

  // Recompute window-level stats from the stitched array — cached
  // per-day data has no window stats.
  const values = allPrices.map((p) => p.price_eur_mwh)
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 0
  const avg =
    values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0
  const spread = max - min

  return {
    source,
    region: "DE-LU", // synthetic; consumers don't read this field
    resolution,
    prices: allPrices,
    stats: { min, max, avg, spread },
  }
}

// ─────────────────────────────────────────────────────────────────────
// COST
// ─────────────────────────────────────────────────────────────────────

function costKey(
  stationId: string,
  source: "DAM" | "IDM",
  dayKey: string,
): string {
  return `${PREFIX}:cost:${stationId}:${source}:${dayKey}`
}

export async function getCostCached(
  stationId: string,
  from: string,
  to: string,
  source: "DAM" | "IDM" = "IDM",
): Promise<ApiCostResponse> {
  const fromDate = new Date(from)
  const toDate = new Date(to)
  const days = daysCovered(fromDate, toDate)
  const today = todayUtcKey()

  const cached = new Map<string, ApiCostBucket[]>()
  const missing: string[] = []
  for (const day of days) {
    if (day === today) {
      missing.push(day)
      continue
    }
    const c = readDay<ApiCostBucket>(costKey(stationId, source, day))
    if (c) {
      cached.set(day, c)
      progressCacheHit("cost", day)
    } else {
      missing.push(day)
    }
  }

  const runs = groupConsecutive(missing)
  const runResults = await Promise.all(
    runs.map(async (run) => {
      const runFrom = dayStartUtc(run[0]).toISOString()
      const runTo = dayEndUtc(run[run.length - 1]).toISOString()
      const startId = progressFetchStart("cost", {
        range: [run[0], run[run.length - 1]],
      })
      try {
        const resp = await getCost(stationId, runFrom, runTo, source)
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
    for (const day of run) {
      const slice = resp.buckets.filter((b) => inDay(b, tsOfCostBucket, day))
      if (day !== today && slice.length > 0) {
        writeDay(costKey(stationId, source, day), slice)
      }
      cached.set(day, slice)
    }
  }

  const fromMs = fromDate.getTime()
  const toMs = toDate.getTime()
  const allBuckets: ApiCostBucket[] = []
  for (const day of days) {
    const dayBuckets = cached.get(day) ?? []
    for (const b of dayBuckets) {
      const t = tsOfCostBucket(b)
      if (t >= fromMs && t <= toMs) allBuckets.push(b)
    }
  }
  allBuckets.sort((a, b) => tsOfCostBucket(a) - tsOfCostBucket(b))

  // Re-derive window totals from the stitched buckets. The
  // `cumulative_cost_eur` field is also re-computed, since it's a
  // running sum that only made sense within the original API
  // response's window.
  let totalKwh = 0
  let totalCost = 0
  let cum = 0
  const stitched = allBuckets.map((b) => {
    totalKwh += b.energy_kwh
    totalCost += b.cost_eur
    cum += b.cost_eur
    return { ...b, cumulative_cost_eur: cum }
  })
  const avgPrice = totalKwh > 0 ? (totalCost / totalKwh) * 1000 : 0

  return {
    station_id: stationId,
    from,
    to,
    source,
    buckets: stitched,
    total: {
      energy_kwh: totalKwh,
      cost_eur: totalCost,
      avg_price_eur_mwh: avgPrice,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────────────────────────────

function sessionsKey(stationId: string, dayKey: string): string {
  return `${PREFIX}:sessions:${stationId}:${dayKey}`
}

interface SessionsDayPayload {
  ev: ApiEvSession[]
  bat: ApiBatterySession[]
}

function readSessionsDay(
  stationId: string,
  dayKey: string,
): SessionsDayPayload | null {
  const k = sessionsKey(stationId, dayKey)
  const mem = memoryMirror.get(k) as SessionsDayPayload | undefined
  if (mem) return mem
  const ls = ssrSafeStorage()
  if (!ls) return null
  try {
    const raw = ls.getItem(k)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DayEntry<SessionsDayPayload>
    const payload = parsed.items?.[0]
    if (payload) memoryMirror.set(k, payload as unknown as unknown[])
    return payload ?? null
  } catch {
    return null
  }
}

function writeSessionsDay(
  stationId: string,
  dayKey: string,
  payload: SessionsDayPayload,
): void {
  const ls = ssrSafeStorage()
  if (!ls) return
  const k = sessionsKey(stationId, dayKey)
  const entry: DayEntry<SessionsDayPayload> = {
    v: 1,
    fetchedAt: Date.now(),
    items: [payload],
  }
  try {
    ls.setItem(k, JSON.stringify(entry))
    memoryMirror.set(k, payload as unknown as unknown[])
  } catch {
    memoryMirror.set(k, payload as unknown as unknown[])
  }
}

export async function getSessionsCached(
  stationId: string,
  from: string,
  to: string,
): Promise<ApiSessionsResponse> {
  const fromDate = new Date(from)
  const toDate = new Date(to)
  const days = daysCovered(fromDate, toDate)
  const today = todayUtcKey()

  const cached = new Map<string, SessionsDayPayload>()
  const missing: string[] = []
  for (const day of days) {
    if (day === today) {
      missing.push(day)
      continue
    }
    const c = readSessionsDay(stationId, day)
    if (c) {
      cached.set(day, c)
      progressCacheHit("sessions", day)
    } else {
      missing.push(day)
    }
  }

  const runs = groupConsecutive(missing)
  const runResults = await Promise.all(
    runs.map(async (run) => {
      const runFrom = dayStartUtc(run[0]).toISOString()
      const runTo = dayEndUtc(run[run.length - 1]).toISOString()
      const startId = progressFetchStart("sessions", {
        range: [run[0], run[run.length - 1]],
      })
      try {
        const resp = await getSessions(stationId, runFrom, runTo)
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
    for (const day of run) {
      const evSlice = resp.ev_sessions.filter((s) =>
        inDay(s, tsOfEvSession, day),
      )
      const batSlice = resp.battery_sessions.filter((s) =>
        inDay(s, tsOfBatterySession, day),
      )
      const payload: SessionsDayPayload = { ev: evSlice, bat: batSlice }
      if (day !== today && (evSlice.length > 0 || batSlice.length > 0)) {
        writeSessionsDay(stationId, day, payload)
      }
      cached.set(day, payload)
    }
  }

  const fromMs = fromDate.getTime()
  const toMs = toDate.getTime()
  const allEv: ApiEvSession[] = []
  const allBat: ApiBatterySession[] = []
  for (const day of days) {
    const payload = cached.get(day)
    if (!payload) continue
    for (const s of payload.ev) {
      const t = tsOfEvSession(s)
      if (t >= fromMs && t <= toMs) allEv.push(s)
    }
    for (const s of payload.bat) {
      const t = tsOfBatterySession(s)
      if (t >= fromMs && t <= toMs) allBat.push(s)
    }
  }
  allEv.sort((a, b) => tsOfEvSession(a) - tsOfEvSession(b))
  allBat.sort((a, b) => tsOfBatterySession(a) - tsOfBatterySession(b))

  return {
    station_id: stationId,
    from,
    to,
    ev_sessions: allEv,
    battery_sessions: allBat,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public clear API (parallel to clearFrameCache)
// ─────────────────────────────────────────────────────────────────────

export function clearSiblingCache(): void {
  memoryMirror.clear()
  const ls = ssrSafeStorage()
  if (!ls) return
  try {
    const toRemove: string[] = []
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i)
      if (k && k.startsWith(`${PREFIX}:`)) toRemove.push(k)
    }
    for (const k of toRemove) ls.removeItem(k)
  } catch {
    // ignore — best-effort
  }
}
