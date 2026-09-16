import "server-only"
import { createHash } from "node:crypto"
import { getRedis } from "@/lib/dispatcher-store"
import { METHODOLOGY_VERSION } from "@/lib/methodology-version"
import type { RangeBacktestResult } from "@/app/actions/backtest"

/**
 * Memo for CLOSED raw replay chunks (≤ one UTC day) of `runBacktestForRange`.
 *
 * Why: rollups already make every full closed UTC day cheap, but report windows
 * are Berlin-local, so each one also has a raw HEAD (2 h) and a raw TAIL (22 h
 * of the last day). The TAIL alone costs ~1.8 s of walk-forward LP for ~2.6k
 * frames (measured Sep 2 2026, Gronau) — 80 % of a 30-day Dispatching History
 * load. Its inputs (frames, prices, engine params) are fixed once the window
 * is in the past, so the finished chunk is memoised.
 *
 * Rules
 *  - Only chunks that ended > CLOSED_GRACE_MS ago (late frames have landed).
 *  - Never cache failures (empty / noTelemetry / mpc unavailable) — a transient
 *    API hiccup must not become a cached blank.
 *  - Key = METHODOLOGY_VERSION + station + exact window + engine label + params
 *    fingerprint, so a settlement-math change, a new model version or a
 *    parameter edit is a cache miss, never a stale hit.
 *
 *    INCIDENT (sep 3 2026, method 2026-09-03.3): the key lacked the methodology
 *    version. After compute() switched AUX to the energy-balance formula and
 *    added battNetKwh, every closed UTC day was re-frozen — but the Berlin
 *    HEAD (2 h) and TAIL (22 h) of each month kept coming from week-old memo
 *    entries carrying the OLD per-frame-clamp AUX and no battery-net figure.
 *    Result: rollup days closed to 0.1 kWh, yet month rows missed
 *    import = EV + AUX + battNet by 13–100 kWh (exactly the HEAD+TAIL
 *    battery net). A memoised chunk is a frozen settlement artefact and must
 *    obey the same staleness rule as station_day_report / fleet_month_report.
 *  - Fail-open: no Redis, oversize payload or any error ⇒ compute as before.
 */

const PREFIX = `replay-memo:v2:${METHODOLOGY_VERSION}`
/** A chunk must be at least this far in the past before it is memoised. */
export const CLOSED_GRACE_MS = 60 * 60 * 1000
/** Keep for a week — long enough for a user's report session and repeat visits. */
const TTL_S = 7 * 24 * 3600
/** Upstash request limit is 1 MB on the smallest plan; stay well under it. */
const MAX_BYTES = 900 * 1024

export function isClosedChunk(partTo: Date, now = Date.now()): boolean {
  return partTo.getTime() < now - CLOSED_GRACE_MS
}

export function paramsFingerprint(params: unknown): string {
  return createHash("sha1").update(stableStringify(params)).digest("hex").slice(0, 12)
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`
}

export function memoKey(args: {
  stationId: string
  fromIso: string
  toIso: string
  versionLabel: string
  paramsHash: string
}): string {
  return `${PREFIX}:${args.stationId}:${args.fromIso}:${args.toIso}:${args.versionLabel}:${args.paramsHash}`
}

export async function readReplayMemo(key: string): Promise<RangeBacktestResult | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    // Stored as a JSON string (not Upstash auto-serialisation) so the size
    // guard below sees the same bytes that go over the wire.
    const raw = await redis.get<string>(key)
    if (!raw) return null
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as RangeBacktestResult) : (raw as RangeBacktestResult)
    if (!parsed || !Array.isArray(parsed.series) || !parsed.totals) return null
    return parsed
  } catch {
    return null
  }
}

/** Only successful, non-empty chunks are worth remembering. */
export function isMemoisable(r: RangeBacktestResult): boolean {
  return r.empty !== true && r.noTelemetry !== true && r.mpcStatus !== "unavailable" && r.kpis.frames > 0
}

export async function writeReplayMemo(key: string, result: RangeBacktestResult): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    const body = JSON.stringify(result)
    if (Buffer.byteLength(body) > MAX_BYTES) return
    await redis.set(key, body, { ex: TTL_S })
  } catch {
    // fail-open
  }
}
