/**
 * DURABLE DISPATCHER STORE — Upstash Redis
 * ════════════════════════════════════════════════════════════════════════
 *
 * Replaces the old in-memory `globalThis` singleton (which reset on every cold
 * start and was not shared across serverless instances — the root cause of the
 * "Dispatching disconnected" flicker on refresh).
 *
 * Everything the operational view and the stateless dispatch engine need lives
 * here, keyed in Redis so ANY instance can read/write it consistently:
 *
 *   dispatcher:control    -> { state, updatedAt }   operator intent (no TTL)
 *   dispatcher:heartbeat  -> { phase, startedAt, lastTickAt, tickSeq, worker,
 *                             currentStep, telemetryFrame, telemetryFrameAt }
 *                           liveness beacon (TTL ~ max(90s, 3x interval))
 *   dispatcher:activity   -> Redis LIST of activity entries (newest first,
 *                           capped at MAX_ACTIVITY via LTRIM)
 *   dispatcher:planner    -> serialized planner state (Maps -> plain objects)
 *   dispatcher:lock       -> SET NX EX run-lock, serializes overlapping cron
 *                           invocations so we never double-dispatch
 *
 * The shared display/report TYPES still live in `dispatcher-status.ts`; this
 * module imports them (type-only) and implements the async, Redis-backed
 * behaviour. `dispatcher-status.ts` re-exports these functions so existing
 * importers keep a single entry point.
 */

import { Redis } from "@upstash/redis"
import type {
  WorkerMeta,
  WorkerPhase,
  ActivityStep,
  WorkerActivity,
  ControlState,
  DispatcherReport,
  DispatcherStatusResponse,
  SourceKind,
  ActiveSource,
  DispatchGuard,
  TickReport,
  TickBucket,
  PlanSnapshot,
  PlanState,
  ReplanLogEntry,
  TickLogEntry,
} from "./dispatcher-status"
import type { ApiTelemetryFrame } from "./amperio-api"
import type { SlotPrice } from "./dispatch-kernel"

// -- Redis client ------------------------------------------------------------

let _redis: Redis | null = null

/**
 * Lazily construct the Upstash client from the connected integration's env
 * vars. Returns null when not configured so callers can degrade gracefully
 * (e.g. health probes report "not ready" instead of throwing).
 */
export function getRedis(): Redis | null {
  if (_redis) return _redis
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) return null
  _redis = new Redis({ url, token })
  return _redis
}

export function isStoreConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

// -- Resilient reads ---------------------------------------------------------

/**
 * The most recent Redis read failure, surfaced to the status endpoint so the
 * dashboard can explain WHY data is missing (e.g. Upstash monthly request quota
 * exhausted) instead of crashing or misreporting the app as "not running".
 * Reset at the start of each getStatus() call.
 */
let _lastReadError: string | null = null

/** Turn an unknown thrown value into a short, human-meaningful reason string. */
function describeRedisError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/max requests limit exceeded/i.test(msg)) {
    return "Upstash Redis monthly request limit reached — the data store is temporarily read-blocked. Upgrade the plan or wait for the quota to reset."
  }
  if (/rate limit|too many requests|429/i.test(msg)) {
    return "Upstash Redis is rate-limiting requests right now. Retrying shortly."
  }
  return `Data store read failed: ${msg}`
}

/**
 * Run a Redis read, returning `fallback` when Redis is unconfigured OR the
 * command fails (Upstash quota/rate-limit, transient network, etc.). This keeps
 * the status/liveness endpoints returning valid JSON in a degraded state rather
 * than throwing — which previously surfaced as a 500 with an empty body and the
 * misleading client error "Could not load dispatcher status. Is the app running?".
 */
async function safeRedisRead<T>(
  label: string,
  fn: (redis: Redis) => Promise<T>,
  fallback: T,
): Promise<T> {
  const redis = getRedis()
  if (!redis) return fallback
  try {
    return await fn(redis)
  } catch (err) {
    _lastReadError = describeRedisError(err)
    console.error(`[v0] dispatcher-store: Redis read "${label}" failed; returning fallback —`, err)
    return fallback
  }
}

// -- Keys (per-station namespacing via AsyncLocalStorage) ---------------------
//
// MULTI-LOCATION: every store function reads/writes the keys of the station in
// the current async scope. `withStationScope(stationId, fn)` establishes the
// scope; anything not wrapped (all legacy callers) operates on the DEFAULT
// station. The default station keeps the ORIGINAL un-namespaced key names
// ("dispatcher:control", …) so Gronau's existing Redis data needs NO
// migration; every other station is namespaced "dispatcher:{stationId}:*".
// AsyncLocalStorage propagates across await boundaries, so concurrent
// per-station tick runs in one process can never cross-contaminate keys —
// the getter-based K below resolves at ACCESS time, inside the scope.

import { AsyncLocalStorage } from "node:async_hooks"

const DEFAULT_STORE_STATION_ID = "chargepost_gronau_001"
const stationScope = new AsyncLocalStorage<string>()

/** Run `fn` with all dispatcher-store reads/writes bound to `stationId`. */
export function withStationScope<T>(stationId: string, fn: () => Promise<T>): Promise<T> {
  return stationScope.run(stationId, fn)
}

/** The station id the store is currently scoped to (default when unwrapped). */
export function scopedStationId(): string {
  return stationScope.getStore() ?? DEFAULT_STORE_STATION_ID
}

function k(suffix: string): string {
  const sid = scopedStationId()
  return sid === DEFAULT_STORE_STATION_ID ? `dispatcher:${suffix}` : `dispatcher:${sid}:${suffix}`
}

const K = {
  get control() { return k("control") },
  get heartbeat() { return k("heartbeat") },
  get activity() { return k("activity") },
  get planner() { return k("planner") },
  get lock() { return k("lock") },
  // Multi-pinger guardrail:
  get sources() { return k("sources") }, // HASH id -> SourceRecord (presence + tick stats)
  get dispatches() { return k("dispatches") }, // LIST of epoch ms of real dispatches (newest first)
  get commandsClearedAt() { return k("commandsClearedAt") }, // epoch ms of operator "clear commands view"
  get ticks() { return k("ticks24h") }, // HASH bucketIndex -> tick count (durable 24h history)
  get plan() { return k("plan") }, // { current, previous } PlanState (latest the optimizer plans)
  get replanLog() { return k("replanLog") }, // LIST of ReplanLogEntry JSON (newest first), rolling
  get tickLog() { return k("tickLog") }, // LIST of TickLogEntry JSON (newest first), rolling
} as const

const MAX_ACTIVITY = 80
const MAX_REPLAN_LOG = 30 // each row embeds its full plan snapshot for drill-down
const MAX_TICK_LOG = 60 // dispatched rows embed a plan snapshot (drill-down); cap to bound Redis size
const DEFAULT_TICK_MS = 15_000
const SOURCE_TTL_SEC = 600
const MAX_DISPATCH_SAMPLES = 12

// 24h ticking report: fixed 5-minute buckets, kept a little over a day so the
// rolling 24h window is always fully covered.
const TICK_BUCKET_MS = 5 * 60_000
const TICK_REPORT_WINDOW_MS = 24 * 60 * 60_000
const TICK_BUCKETS_IN_WINDOW = Math.round(TICK_REPORT_WINDOW_MS / TICK_BUCKET_MS) // 288
const TICK_HASH_TTL_SEC = Math.ceil((TICK_REPORT_WINDOW_MS + 2 * 60 * 60_000) / 1000) // ~26h

interface SourceRecord {
  kind: SourceKind
  /** Human-meaningful caller name (mandatory on the tick API). */
  name: string
  firstSeenAt: number
  lastSeenAt: number
  /** Epoch ms when the current uninterrupted pinging streak began. */
  streakStartedAt: number
  lastTickAt: number | null
  tickCount: number
}

// -- Stored record shapes ----------------------------------------------------

interface ControlRecord {
  state: ControlState
  updatedAt: number
}

interface HeartbeatRecord {
  phase: WorkerPhase
  startedAt: string
  /** Epoch ms of the most recent heartbeat/tick. */
  lastTickAt: number
  tickSeq: number
  worker: WorkerMeta
  currentStep: ActivityStep | null
  telemetryFrame: ApiTelemetryFrame | null
  /** Epoch ms when telemetryFrame was captured. */
  telemetryFrameAt: number | null
}

/** Planner state persisted between stateless ticks (Maps serialized as objects). */
export interface PlannerState {
  remainingBuyKwh: Record<string, number>
  remainingSellKwh: Record<string, number>
  lastPlannedSlot: number | null
  lastPriceRefreshSlot: number | null
  priceBySlot: Record<string, number>
  pricedSlots: SlotPrice[]
  /** Monotonic tick counter persisted across invocations. */
  tickSeq: number
  startedAt: string | null
  /** Reserve-guard latch: a no-car full-power recharge is in progress (Rule B).
   *  Set when SOC drops below the trigger with no car; cleared when SOC reaches
   *  the target. Persisted so the recharge holds across ticks (hysteresis). */
  forcedRechargeActive?: boolean
}

export function freshPlannerState(): PlannerState {
  return {
    remainingBuyKwh: {},
    remainingSellKwh: {},
    lastPlannedSlot: null,
    lastPriceRefreshSlot: null,
    priceBySlot: {},
    pricedSlots: [],
    tickSeq: 0,
    startedAt: null,
    forcedRechargeActive: false,
  }
}

// -- Liveness window ---------------------------------------------------------

function livenessWindowMs(tickMs: number | undefined): number {
  return Math.max((tickMs ?? DEFAULT_TICK_MS) * 3, 10_000)
}

/** TTL for the heartbeat key -- generous enough to survive a missed minute. */
function heartbeatTtlSec(tickMs: number | undefined): number {
  return Math.max(90, Math.ceil(((tickMs ?? DEFAULT_TICK_MS) * 3) / 1000))
}

// -- Control flag ------------------------------------------------------------
//
// Dispatch is now purely EVENT/REPLAN-DRIVEN and ALWAYS armed — there is no
// operator Start/Stop. `getControl()` therefore ALWAYS reports "running" so the
// engine never idles on a stale "stopped" record left over from the old
// Start/Stop era. Safety against double-dispatch is handled by the driver
// election + Redis run-lock, not by this flag. `setControl` is retained as a
// harmless export (callers still compile) but no longer gates dispatch.

export async function getControlRecord(): Promise<ControlRecord> {
  const rec = await safeRedisRead(
    "control",
    (redis) => redis.get<ControlRecord>(K.control).then((r) => r ?? null),
    null,
  )
  // Unconditionally armed: ignore any persisted state. updatedAt is surfaced
  // purely for display continuity.
  return { state: "running", updatedAt: rec?.updatedAt ?? 0 }
}

export async function getControl(): Promise<ControlState> {
  return (await getControlRecord()).state
}

export async function setControl(state: ControlState): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.set(K.control, { state, updatedAt: Date.now() } satisfies ControlRecord)
}

// -- Heartbeat ---------------------------------------------------------------

export async function readHeartbeat(): Promise<HeartbeatRecord | null> {
  return safeRedisRead(
    "heartbeat",
    (redis) => redis.get<HeartbeatRecord>(K.heartbeat).then((r) => r ?? null),
    null,
  )
}

export async function writeHeartbeat(hb: HeartbeatRecord): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.set(K.heartbeat, hb, { ex: heartbeatTtlSec(hb.worker?.tickMs) })
}

// -- Activity feed (Redis list, newest first) --------------------------------

export async function pushActivity(entry: WorkerActivity): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.lpush(K.activity, entry)
  await redis.ltrim(K.activity, 0, MAX_ACTIVITY - 1)
}

export async function readActivity(limit = MAX_ACTIVITY): Promise<WorkerActivity[]> {
  const list = await safeRedisRead(
    "activity",
    (redis) => redis.lrange<WorkerActivity>(K.activity, 0, limit - 1).then((l) => l ?? []),
    [] as WorkerActivity[],
  )
  // Upstash returns parsed objects; guard against any legacy string entries.
  return list
    .map((x) => (typeof x === "string" ? safeParse<WorkerActivity>(x) : x))
    .filter((x): x is WorkerActivity => x != null)
}

export async function clearActivity(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.del(K.activity)
  // Reflect the cleared feed in the heartbeat's currentStep.
  const hb = await readHeartbeat()
  if (hb) {
    hb.currentStep = hb.phase === "running" ? null : "idle"
    await writeHeartbeat(hb)
  }
}

function safeParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

// -- Planner state -----------------------------------------------------------

export async function readPlanner(): Promise<PlannerState> {
  const redis = getRedis()
  if (!redis) return freshPlannerState()
  const p = (await redis.get<PlannerState>(K.planner)) ?? null
  return p ?? freshPlannerState()
}

export async function writePlanner(state: PlannerState): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  // Planner state is only meaningful while a run is active; expire it so a long
  // idle period doesn't resurrect a stale plan.
  await redis.set(K.planner, state, { ex: 3600 })
}

export async function clearPlanner(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.del(K.planner)
}

// -- the optimizer plan snapshots (current + previous, for the plan view + diff) -----

export async function readPlan(): Promise<PlanState> {
  const empty: PlanState = { current: null, previous: null }
  const p = await safeRedisRead(
    "plan",
    (redis) => redis.get<PlanState>(K.plan).then((r) => r ?? null),
    null,
  )
  return p ?? empty
}

/**
 * Persist a freshly-solved dispatch plan, rotating the prior `current` into
 * `previous` so the page can diff the replan. TTL'd like the planner state so a
 * long idle window doesn't surface a stale plan.
 */
export async function writePlan(snapshot: PlanSnapshot): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const prev = await readPlan()
  const next: PlanState = { current: snapshot, previous: prev.current }
  await redis.set(K.plan, next, { ex: 3600 })
}

/**
 * Append one row to the replan history (newest first, capped + TTL'd). Done
 * AFTER the dispatch resolves so the entry carries the real output command and
 * outcome, not just the plan intent.
 */
export async function appendReplanLog(entry: ReplanLogEntry): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.lpush(K.replanLog, JSON.stringify(entry))
  await redis.ltrim(K.replanLog, 0, MAX_REPLAN_LOG - 1)
  await redis.expire(K.replanLog, 86_400)
}

/** Recent replan log entries, newest first. */
export async function readReplanLog(): Promise<ReplanLogEntry[]> {
  const raw = await safeRedisRead(
    "replanLog",
    (redis) => redis.lrange<ReplanLogEntry | string>(K.replanLog, 0, MAX_REPLAN_LOG - 1),
    [] as (ReplanLogEntry | string)[],
  )
  return raw
    .map((r) => (typeof r === "string" ? (safeParse<ReplanLogEntry>(r) ?? null) : (r as ReplanLogEntry)))
    .filter((e): e is ReplanLogEntry => e != null)
}

/** Append one tick-log row (newest first), capped + 24h TTL. Best-effort. */
export async function appendTickLog(entry: TickLogEntry): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.lpush(K.tickLog, JSON.stringify(entry))
  await redis.ltrim(K.tickLog, 0, MAX_TICK_LOG - 1)
  await redis.expire(K.tickLog, 86_400)
}

/** Recent tick-log entries, newest first. */
export async function readTickLog(): Promise<TickLogEntry[]> {
  const raw = await safeRedisRead(
    "tickLog",
    (redis) => redis.lrange<TickLogEntry | string>(K.tickLog, 0, MAX_TICK_LOG - 1),
    [] as (TickLogEntry | string)[],
  )
  return raw
    .map((r) => (typeof r === "string" ? (safeParse<TickLogEntry>(r) ?? null) : (r as TickLogEntry)))
    .filter((e): e is TickLogEntry => e != null)
}

/**
 * Refresh the `current` plan in place WITHOUT rotating it into `previous`. Used
 * on held ticks (no replan event, same anchor slot) so the stored "previous"
 * keeps pointing at the genuinely prior plan for the diff.
 */
export async function updateCurrentPlan(snapshot: PlanSnapshot): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const prev = await readPlan()
  const next: PlanState = { current: snapshot, previous: prev.previous }
  await redis.set(K.plan, next, { ex: 3600 })
}

// -- Run-lock (serialize overlapping cron invocations) -----------------------

/**
 * Acquire the dispatch run-lock. Returns a token to release it, or null if
 * another invocation holds it. Auto-expires after ttlSec so a crashed
 * invocation can't wedge the loop permanently.
 */
export async function acquireLock(ttlSec = 70): Promise<string | null> {
  const redis = getRedis()
  if (!redis) return null
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const ok = await redis.set(K.lock, token, { nx: true, ex: ttlSec })
  return ok === "OK" ? token : null
}

export async function releaseLock(token: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  // Only release if we still own it (avoid releasing a lock that already
  // expired and was re-acquired by another invocation).
  const current = await redis.get<string>(K.lock)
  if (current === token) await redis.del(K.lock)
}

// -- Source registry (multi-pinger guardrail) --------------------------------

/** How long a source counts as "active" without a new ping. */
function sourceWindowMs(tickMs?: number): number {
  return Math.max((tickMs ?? DEFAULT_TICK_MS) * 4, 90_000)
}

async function upsertSource(
  id: string,
  kind: SourceKind,
  name: string | null | undefined,
  didTick: boolean,
): Promise<void> {
  const redis = getRedis()
  if (!redis || !id) return
  const now = Date.now()
  const existing = (await redis.hget<SourceRecord>(K.sources, id)) ?? null
  // A gap longer than the active window means the pinger stopped and came back,
  // so the "uninterrupted" streak restarts; otherwise it continues.
  const gap = existing ? now - existing.lastSeenAt : Number.POSITIVE_INFINITY
  const continued = existing != null && gap <= sourceWindowMs()
  const rec: SourceRecord = {
    kind,
    // Prefer a freshly-supplied name; otherwise keep the last known one, finally
    // fall back to the id so legacy callers still render something.
    name: (name && name.trim()) || existing?.name || id,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    streakStartedAt: continued ? existing!.streakStartedAt : now,
    lastTickAt: didTick ? now : (existing?.lastTickAt ?? null),
    tickCount: (existing?.tickCount ?? 0) + (didTick ? 1 : 0),
  }
  await redis.hset(K.sources, { [id]: rec })
  await redis.expire(K.sources, SOURCE_TTL_SEC)
}

/** Record that a source is present (e.g. a dashboard tab polling status). */
export async function recordSourcePresence(
  id: string,
  kind: SourceKind,
  name?: string | null,
): Promise<void> {
  await upsertSource(id, kind, name, false)
}

/** Record that a source actually triggered a tick. */
export async function recordTickSource(
  id: string,
  kind: SourceKind,
  name?: string | null,
): Promise<void> {
  await upsertSource(id, kind, name, true)
}

/** Active sources within the window, newest-seen first. Prunes stale entries. */
export async function readActiveSources(tickMs?: number): Promise<ActiveSource[]> {
  const redis = getRedis()
  if (!redis) return []
  const all = (await redis.hgetall<Record<string, SourceRecord>>(K.sources)) ?? {}
  const now = Date.now()
  const win = sourceWindowMs(tickMs)
  const stale: string[] = []
  const out: ActiveSource[] = []
  for (const [id, rec] of Object.entries(all)) {
    if (!rec || typeof rec !== "object") {
      stale.push(id)
      continue
    }
    if (now - rec.lastSeenAt > win) {
      stale.push(id)
      continue
    }
    const streakStartedAt = rec.streakStartedAt ?? rec.firstSeenAt
    out.push({
      id,
      name: rec.name || id,
      kind: rec.kind,
      firstSeenAt: new Date(rec.firstSeenAt).toISOString(),
      lastSeenAt: new Date(rec.lastSeenAt).toISOString(),
      lastTickAt: rec.lastTickAt ? new Date(rec.lastTickAt).toISOString() : null,
      tickCount: rec.tickCount,
      ticking: rec.lastTickAt != null && now - rec.lastTickAt <= win,
      streakStartedAt: new Date(streakStartedAt).toISOString(),
      uptimeMs: Math.max(0, rec.lastSeenAt - streakStartedAt),
    })
  }
  if (stale.length) await redis.hdel(K.sources, ...stale)
  return out.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
}

// -- Dispatch log + cadence (multi-pinger guardrail) -------------------------

/** Record the timestamp of a real dispatch (POST to Amperio). */
export async function recordDispatch(atMs: number = Date.now()): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.lpush(K.dispatches, atMs)
  await redis.ltrim(K.dispatches, 0, MAX_DISPATCH_SAMPLES - 1)
  await redis.expire(K.dispatches, 3600)
}

async function readDispatchTimes(): Promise<number[]> {
  const redis = getRedis()
  if (!redis) return []
  const list = (await redis.lrange<number | string>(K.dispatches, 0, MAX_DISPATCH_SAMPLES - 1)) ?? []
  return list.map((x) => (typeof x === "string" ? Number(x) : x)).filter((n) => Number.isFinite(n))
}

/** Epoch ms of the most recent dispatch (for the cooldown guard), or null. */
export async function getLastDispatchAt(): Promise<number | null> {
  const times = await readDispatchTimes()
  return times.length ? Math.max(...times) : null
}

/** Median spacing between recent dispatches (ms), or null with <2 samples. */
function medianIntervalMs(times: number[]): number | null {
  if (times.length < 2) return null
  const sorted = [...times].sort((a, b) => b - a) // newest first
  const deltas: number[] = []
  for (let i = 0; i < sorted.length - 1; i++) deltas.push(sorted[i] - sorted[i + 1])
  deltas.sort((a, b) => a - b)
  const mid = Math.floor(deltas.length / 2)
  return deltas.length % 2 ? deltas[mid] : Math.round((deltas[mid - 1] + deltas[mid]) / 2)
}

// -- 24h ticking history (durable buckets) -----------------------------------

/**
 * Record that a tick happened, bucketed into a fixed 5-minute slot. Cheap
 * (single HINCRBY) and self-pruning via TTL — old buckets fall out of the
 * rolling window and the whole hash expires if ticking stops entirely.
 */
export async function recordTickEvent(atMs: number = Date.now()): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const bucket = Math.floor(atMs / TICK_BUCKET_MS)
  await redis.hincrby(K.ticks, String(bucket), 1)
  await redis.expire(K.ticks, TICK_HASH_TTL_SEC)
}

/**
 * Build the 24h ticking report: a dense, oldest→newest array of fixed-width
 * buckets (zero-filled where no ticks occurred) plus coverage/gap summary, so
 * the dashboard can prove how continuously dispatch has been driven.
 */
export async function getTickReport(): Promise<TickReport> {
  const empty: TickReport = {
    bucketMs: TICK_BUCKET_MS,
    windowMs: TICK_REPORT_WINDOW_MS,
    buckets: [],
    totalTicks: 0,
    activeBuckets: 0,
    totalBuckets: TICK_BUCKETS_IN_WINDOW,
    coveragePct: 0,
    longestGapMs: 0,
    lastTickBucketAt: null,
  }
  const redis = getRedis()
  if (!redis) return empty

  const raw = (await redis.hgetall<Record<string, number | string>>(K.ticks)) ?? {}
  const counts = new Map<number, number>()
  for (const [k, v] of Object.entries(raw)) {
    const idx = Number(k)
    const n = typeof v === "string" ? Number(v) : v
    if (Number.isFinite(idx) && Number.isFinite(n)) counts.set(idx, n)
  }

  const now = Date.now()
  const currentBucket = Math.floor(now / TICK_BUCKET_MS)
  const startBucket = currentBucket - (TICK_BUCKETS_IN_WINDOW - 1)

  const buckets: TickBucket[] = []
  let totalTicks = 0
  let activeBuckets = 0
  let lastTickBucketAt: string | null = null
  let longestGapBuckets = 0
  let runGap = 0

  for (let b = startBucket; b <= currentBucket; b++) {
    const count = counts.get(b) ?? 0
    buckets.push({ startAt: new Date(b * TICK_BUCKET_MS).toISOString(), count })
    totalTicks += count
    if (count > 0) {
      activeBuckets++
      lastTickBucketAt = new Date(b * TICK_BUCKET_MS).toISOString()
      runGap = 0
    } else {
      runGap++
      if (runGap > longestGapBuckets) longestGapBuckets = runGap
    }
  }

  return {
    bucketMs: TICK_BUCKET_MS,
    windowMs: TICK_REPORT_WINDOW_MS,
    buckets,
    totalTicks,
    activeBuckets,
    totalBuckets: TICK_BUCKETS_IN_WINDOW,
    coveragePct: Math.round((activeBuckets / TICK_BUCKETS_IN_WINDOW) * 1000) / 10,
    longestGapMs: longestGapBuckets * TICK_BUCKET_MS,
    lastTickBucketAt,
  }
}

// -- Commands "clear view" marker --------------------------------------------

/** Epoch ms of the operator's last "clear commands view", or null. */
export async function getCommandsClearedAt(): Promise<number | null> {
  const v = await safeRedisRead(
    "commandsClearedAt",
    (redis) => redis.get<number | string>(K.commandsClearedAt).then((r) => r ?? null),
    null,
  )
  if (v == null) return null
  const n = typeof v === "string" ? Number(v) : v
  return Number.isFinite(n) ? n : null
}

/** Set (or with null, reset) the "clear commands view" marker. */
export async function setCommandsClearedAt(atMs: number | null): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  if (atMs == null) await redis.del(K.commandsClearedAt)
  else await redis.set(K.commandsClearedAt, atMs)
}

/**
 * Build the multi-pinger guardrail summary: active callers + observed cadence,
 * and the derived "multiplePingers" / "overFrequency" flags.
 */
export async function getDispatchGuard(intervalMs: number): Promise<DispatchGuard> {
  // Empty guard used both when no callers are active and when the store read
  // fails (quota/transient) — the dashboard then shows "no pingers" rather than
  // crashing the whole status response.
  const emptyGuard: DispatchGuard = {
    configuredIntervalMs: intervalMs,
    observedIntervalMs: null,
    lastDispatchAt: null,
    activeSources: [],
    pingerCount: 0,
    externalActive: false,
    multiplePingers: false,
    overFrequency: false,
  }
  try {
    const [sources, times] = await Promise.all([readActiveSources(intervalMs), readDispatchTimes()])
    const observed = medianIntervalMs(times)
    const pingers = sources.filter((s) => s.ticking)
    return {
      configuredIntervalMs: intervalMs,
      observedIntervalMs: observed,
      lastDispatchAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
      activeSources: sources,
      pingerCount: pingers.length,
      externalActive: pingers.some((s) => s.kind === "external"),
      multiplePingers: pingers.length > 1,
      overFrequency: observed != null && observed < intervalMs * 0.8,
    }
  } catch (err) {
    _lastReadError = describeRedisError(err)
    console.error("[v0] dispatcher-store: getDispatchGuard failed; returning empty guard —", err)
    return emptyGuard
  }
}

// -- recordReport (worker/engine heartbeat ingestion) ------------------------

/**
 * Persist a heartbeat (and optional activity entry) to Redis. Mirrors the old
 * in-memory `recordReport` semantics so the report route and any external
 * worker keep working unchanged.
 */
export async function recordReport(report: DispatcherReport): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  // A fresh run resets the activity feed and stale telemetry frame.
  if (report.phase === "starting") {
    await redis.del(K.activity)
  }

  const prev = await readHeartbeat()
  const startedAt =
    report.phase === "starting"
      ? new Date().toISOString()
      : prev?.startedAt ?? report.worker.startedAt
  const tickSeq = report.activity?.tick ?? prev?.tickSeq ?? 0

  let currentStep: ActivityStep | null = prev?.currentStep ?? null
  if (report.activity) {
    await pushActivity(report.activity)
    currentStep = report.activity.step
  } else if (report.phase === "paused") {
    currentStep = "idle"
  }

  const hb: HeartbeatRecord = {
    phase: report.phase,
    startedAt,
    lastTickAt: Date.now(),
    tickSeq,
    worker: report.worker,
    currentStep,
    telemetryFrame:
      report.telemetryFrame != null
        ? report.telemetryFrame
        : report.phase === "starting"
          ? null
          : prev?.telemetryFrame ?? null,
    telemetryFrameAt:
      report.telemetryFrame != null
        ? Date.now()
        : report.phase === "starting"
          ? null
          : prev?.telemetryFrameAt ?? null,
  }
  await writeHeartbeat(hb)
}

/**
 * TELEMETRY-ONLY snapshot — for stations that are TRACKED but not DISPATCHED.
 * Stores the latest middleware frame into this station's scoped heartbeat so
 * the fleet dashboard can classify it as "telemetry" (data arriving) without
 * a dispatch worker ever existing. Must run inside withStationScope.
 *
 * The synthetic "monitor" worker meta keeps the HeartbeatRecord shape intact;
 * phase stays "paused" so nothing can mistake this for a driving dispatcher
 * (fleet "full" tier additionally requires control=running + a solved plan).
 * If a real dispatch heartbeat exists, only the frame fields are refreshed.
 */
export async function recordTelemetrySnapshot(
  frame: ApiTelemetryFrame,
  meta: { stationId: string; siteId: string; assetId: string; baseUrl: string },
): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const prev = await readHeartbeat()
  const nowIso = new Date().toISOString()
  const hb: HeartbeatRecord = prev
    ? { ...prev, lastTickAt: Date.now(), telemetryFrame: frame, telemetryFrameAt: Date.now() }
    : {
        phase: "paused",
        startedAt: nowIso,
        lastTickAt: Date.now(),
        tickSeq: 0,
        worker: {
          stationId: meta.stationId,
          siteId: meta.siteId,
          assetId: meta.assetId,
          tickMs: 0,
          priceSource: "none",
          baseUrl: meta.baseUrl,
          startedAt: nowIso,
        },
        currentStep: "idle",
        telemetryFrame: frame,
        telemetryFrameAt: Date.now(),
      }
  await writeHeartbeat(hb)
}

// -- Status snapshot (what /api/dispatcher/status returns) -------------------

export async function getStatus(): Promise<DispatcherStatusResponse> {
  const now = Date.now()
  // Clear the per-call error latch; any read below that fails will repopulate it
  // so we can report a precise reason (e.g. Upstash quota) to the dashboard.
  _lastReadError = null
  const [control, hb, activity, plan, replanLog, tickLog] = await Promise.all([
    getControlRecord(),
    readHeartbeat(),
    readActivity(),
    readPlan(),
    readReplanLog(),
    readTickLog(),
  ])

  const tickMs = hb?.worker?.tickMs
  const dispatchGuard = await getDispatchGuard(tickMs ?? DEFAULT_TICK_MS)
  const commandsClearedAtMs = await getCommandsClearedAt()
  const windowMs = livenessWindowMs(tickMs)
  const lastReportAt = hb?.lastTickAt ?? null
  const msSince = lastReportAt == null ? null : now - lastReportAt
  // Online requires operator intent to be "running" AND a fresh heartbeat.
  const online =
    control.state === "running" &&
    lastReportAt != null &&
    hb?.phase !== "stopping" &&
    now - lastReportAt <= windowMs

  return {
    hasWorker: hb?.worker != null,
    online,
    phase: hb?.phase ?? null,
    worker: hb?.worker ?? null,
    lastReportAt: lastReportAt == null ? null : new Date(lastReportAt).toISOString(),
    msSinceLastReport: msSince,
    livenessWindowMs: windowMs,
    control: control.state,
    controlUpdatedAt: control.updatedAt ? new Date(control.updatedAt).toISOString() : null,
    currentStep: hb?.currentStep ?? null,
    activity,
    telemetryFrame: hb?.telemetryFrame ?? null,
    telemetryFrameAt:
      hb?.telemetryFrameAt == null ? null : new Date(hb.telemetryFrameAt).toISOString(),
    dispatchGuard,
    commandsClearedAt:
      commandsClearedAtMs == null ? null : new Date(commandsClearedAtMs).toISOString(),
    plan,
    replanLog,
    tickLog,
    // Non-null when one or more Redis reads failed this snapshot (quota, rate
    // limit, transient). The dashboard renders this as the real reason instead
    // of the misleading "is the app running?" message.
    storeError: _lastReadError,
  }
}

/**
 * Liveness classification for the freshness probe (/api/dispatcher/live).
 * Dispatch is REPLAN-DRIVEN (event-based), not tick-based, so liveness is keyed
 * on PLAN FRESHNESS + the LAST DISPATCH OUTCOME rather than heartbeat cadence:
 * - disabled:      operator intent is "stopped"
 * - down:          no plan yet, last solve errored/infeasible, or last dispatch
 *                  failed, or the plan is older than 3x its control step (a slot
 *                  boundary almost certainly rolled over without a replan)
 * - degraded:      plan is older than 1.5x its control step (a replan is overdue)
 * - healthy:       a fresh, optimal plan exists and the last dispatch succeeded
 *
 * In steady state an event-driven dispatcher replans at least every slot
 * boundary (price/slot-rollover triggers), so a plan that ages well past one
 * control step is the real failure signal — not "ticks stopped".
 */
export async function getLiveness(): Promise<{
  status: "healthy" | "degraded" | "down" | "disabled"
  control: ControlState
  phase: WorkerPhase | null
  /** Why the dispatcher is in this state (human-readable). */
  reason: string
  /** ISO time the current plan was solved. */
  lastReplanAt: string | null
  /** Age of the current plan (ms since solve). */
  ageMs: number | null
  /** Control-step length in ms — the cadence a healthy system replans at. */
  intervalMs: number
  /** LP status of the current plan. */
  planStatus: "optimal" | "infeasible" | "error" | null
  /** Whether the most recent replan's dispatch POST succeeded. */
  lastDispatchOk: boolean | null
  /** Trigger that fired the most recent replan. */
  lastEventType: string | null
  /** Back-compat: ISO time of the last heartbeat (no longer drives status). */
  lastTickAt: string | null
}> {
  const [control, plan, replanLog] = await Promise.all([
    getControlRecord(),
    readPlan(),
    readReplanLog(),
  ])
  const now = Date.now()
  const current = plan.current
  const lastReplan = replanLog[0] ?? null

  // Control step in ms (15-min default) → the cadence a healthy event-driven
  // dispatcher replans at. Guard against missing/zero stepHours.
  const stepMs = Math.max((current?.stepHours ?? 0.25) * 3_600_000, 60_000)
  const ageMs = current == null ? null : now - current.solvedAt
  const planStatus = current?.status ?? null
  const lastDispatchOk = lastReplan?.isTest ? null : lastReplan?.dispatched ?? null
  const lastEventType = lastReplan?.eventType ?? null

  let status: "healthy" | "degraded" | "down" | "disabled"
  let reason: string
  if (control.state === "stopped") {
    status = "disabled"
    reason = "Operator intent is stopped"
  } else if (current == null || ageMs == null) {
    status = "down"
    reason = "No plan solved yet"
  } else if (planStatus !== "optimal") {
    status = "down"
    reason = `Last solve was ${planStatus}`
  } else if (lastDispatchOk === false) {
    status = "down"
    reason = "Last replan solved but the dispatch to Amperio failed"
  } else if (ageMs > stepMs * 3) {
    status = "down"
    reason = "Plan is stale — a slot boundary rolled over without a replan"
  } else if (ageMs > stepMs * 1.5) {
    status = "degraded"
    reason = "A replan is overdue for the current slot"
  } else {
    status = "healthy"
    reason = "Fresh optimal plan, last dispatch succeeded"
  }

  return {
    status,
    control: control.state,
    phase: null,
    reason,
    lastReplanAt: current == null ? null : new Date(current.solvedAt).toISOString(),
    ageMs,
    intervalMs: stepMs,
    planStatus,
    lastDispatchOk,
    lastEventType,
    lastTickAt: lastReplan == null ? null : new Date(lastReplan.solvedAt).toISOString(),
  }
}
