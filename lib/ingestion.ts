// ════════════════════════════════════════════════════════════════════════
// INGESTION — on-demand backfill of real Amperio telemetry into Neon.
// ════════════════════════════════════════════════════════════════════════
//
// Server-only. Pages a date range day-by-day from the Amperio API at the given
// step (default 15s), normalizes each frame, and bulk-inserts with
// ON CONFLICT (station_id, ts) DO NOTHING so re-running a range is idempotent.
// ════════════════════════════════════════════════════════════════════════

import "server-only"
import { db } from "./db"
import { telemetryFrame } from "./db/schema"
import { normalizeFrame } from "./telemetry-normalize"
import type { ApiFramesResponse, ApiTelemetryFrame } from "./amperio-api"
import type { BacktestFrameRow } from "./backtest"
import { sql } from "drizzle-orm"

const BACKEND_BASE = "https://amperio.enexa.me/api/v1"
const INSERT_BATCH = 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Fetch one frames chunk directly from the upstream API (server-side). */
async function fetchFramesChunk(
  stationId: string,
  fromIso: string,
  toIso: string,
  stepSeconds: number,
): Promise<ApiFramesResponse> {
  const qs = new URLSearchParams({
    station_id: stationId,
    from: fromIso,
    to: toIso,
    step_seconds: String(stepSeconds),
  })
  const res = await fetch(`${BACKEND_BASE}/telemetry/frames?${qs}`, {
    headers: { Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
    cache: "no-store",
  })
  if (!res.ok) {
    throw new Error(`GET /telemetry/frames ${fromIso}..${toIso} → ${res.status} ${await res.text()}`)
  }
  return res.json()
}

/** Insert a batch of normalized frames, skipping duplicate (station_id, ts). */
async function insertFrames(
  rows: ReturnType<typeof toInsertRow>[],
): Promise<void> {
  if (rows.length === 0) return
  await db.insert(telemetryFrame).values(rows).onConflictDoNothing({
    target: [telemetryFrame.stationId, telemetryFrame.ts],
  })
}

function toInsertRow(
  frame: Parameters<typeof normalizeFrame>[0],
  stationId: string,
) {
  const n = normalizeFrame(frame, stationId)
  return {
    stationId: n.stationId,
    ts: new Date(n.ts),
    source: "amperio" as const,
    gridPowerW: n.gridPowerW,
    gridImportLimitW: n.gridImportLimitW,
    socPackA: n.socPackA,
    socPackB: n.socPackB,
    socAvg: n.socAvg,
    evLoadW: n.evLoadW,
    battPowerW: n.battPowerW,
    priceEurMwh: n.priceEurMwh,
    chargingModeA: n.chargingModeA,
    chargingModeB: n.chargingModeB,
    raw: frame as unknown as Record<string, unknown>,
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/**
 * Map one raw Amperio frame into the backtest engine's row shape. Reuses the
 * shared `normalizeFrame` for the analytics columns (identical sign/units to
 * the DB ingest path) and additionally extracts the per-pack usable-energy
 * registers + per-connector EV counters that the engine normally reads out of
 * the stored `raw` jsonb via SQL — so an injected live frame is byte-for-byte
 * equivalent to a stored one.
 */
function frameToBacktestRow(frame: ApiTelemetryFrame, stationId: string): BacktestFrameRow {
  const n = normalizeFrame(frame, stationId)
  const batteries = frame.batteries ?? []
  const chargers = frame.chargers ?? []
  const ev1 = chargers.find((c) => String(c.unit_id) === "1")
  const ev2 = chargers.find((c) => String(c.unit_id) === "2")
  return {
    ts: new Date(n.ts),
    socAvg: n.socAvg,
    socPackA: n.socPackA,
    socPackB: n.socPackB,
    evLoadW: n.evLoadW,
    gridPowerW: n.gridPowerW,
    battPowerW: n.battPowerW,
    priceEurMwh: n.priceEurMwh,
    gridImportLimitW: n.gridImportLimitW,
    b1Efull: num(batteries[0]?.energy_full_kwh),
    b1Eempty: num(batteries[0]?.energy_empty_kwh),
    b2Efull: num(batteries[1]?.energy_full_kwh),
    b2Eempty: num(batteries[1]?.energy_empty_kwh),
    ev1Cum: num(ev1?.e_ev_chg_kwh),
    ev2Cum: num(ev2?.e_ev_chg_kwh),
    // Acceptance ceiling = min(p_ev_max_w, p_cp_max_w). p_ev_max_w is 0 when no
    // car is plugged, so the ceiling is naturally 0 then. Mirrors the LEAST(...)
    // SQL extraction used for stored frames (lib/backtest.ts loadFramesFromDb).
    ev1AcceptW: leastAccept(num(ev1?.p_ev_max_w), num(ev1?.p_cp_max_w)),
    ev2AcceptW: leastAccept(num(ev2?.p_ev_max_w), num(ev2?.p_cp_max_w)),
    // Per-connector car SoC and charger ETA-to-full, mirroring the stored-frame
    // SQL extraction. Both reliable on this hardware even though p_ev_w is broken.
    ev1SocCar: num(ev1?.soc_ev_pct),
    ev2SocCar: num(ev2?.soc_ev_pct),
    ev1FullS: num(ev1?.t_full_s),
    ev2FullS: num(ev2?.t_full_s),
  }
}

/** Smaller of two ceilings, ignoring nulls (matches SQL LEAST semantics). */
function leastAccept(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.min(a, b)
}

/**
 * Page a window of LIVE telemetry straight from the upstream API (no DB) and
 * return it in the backtest engine's row shape. Powers the Data Analysis
 * report so the production v5 MPC can run on days that were never persisted to
 * Neon — identical engine, just an in-memory frame source.
 */
export async function loadLiveBacktestFrames(args: {
  stationId: string
  fromIso: string
  toIso: string
  stepSeconds?: number
}): Promise<BacktestFrameRow[]> {
  const stepSeconds = args.stepSeconds ?? 60
  const start = new Date(args.fromIso).getTime()
  const end = new Date(args.toIso).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("Invalid live-frame range")
  }

  const out: BacktestFrameRow[] = []
  for (let dayStart = start; dayStart < end; dayStart += DAY_MS) {
    const dayEnd = Math.min(dayStart + DAY_MS, end)
    const chunk = await fetchFramesChunk(
      args.stationId,
      new Date(dayStart).toISOString(),
      new Date(dayEnd).toISOString(),
      stepSeconds,
    )
    for (const frame of chunk.frames ?? []) {
      out.push(frameToBacktestRow(frame, args.stationId))
    }
  }
  // Frames arrive per-day ascending; guarantee global ascending order for the
  // engine's monotonic slot pointer.
  out.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  return out
}

export interface BackfillProgress {
  framesIngested: number
}

/**
 * Backfill [fromIso, toIso) for a station, paging day-by-day. `onProgress` is
 * invoked after each day so a job row can be updated incrementally.
 */
export async function backfillRange(args: {
  stationId: string
  fromIso: string
  toIso: string
  stepSeconds?: number
  onProgress?: (p: BackfillProgress) => Promise<void> | void
}): Promise<number> {
  const stepSeconds = args.stepSeconds ?? 15
  const start = new Date(args.fromIso).getTime()
  const end = new Date(args.toIso).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("Invalid backfill range")
  }

  let totalIngested = 0
  let batch: ReturnType<typeof toInsertRow>[] = []

  for (let dayStart = start; dayStart < end; dayStart += DAY_MS) {
    const dayEnd = Math.min(dayStart + DAY_MS, end)
    const chunk = await fetchFramesChunk(
      args.stationId,
      new Date(dayStart).toISOString(),
      new Date(dayEnd).toISOString(),
      stepSeconds,
    )

    for (const frame of chunk.frames ?? []) {
      batch.push(toInsertRow(frame, args.stationId))
      if (batch.length >= INSERT_BATCH) {
        await insertFrames(batch)
        totalIngested += batch.length
        batch = []
      }
    }
    // Flush remainder of this day so progress reflects whole days.
    if (batch.length > 0) {
      await insertFrames(batch)
      totalIngested += batch.length
      batch = []
    }
    await args.onProgress?.({ framesIngested: totalIngested })
  }

  return totalIngested
}

export interface CoverageDay {
  day: string
  count: number
  /** Fraction of expected frames present that day (0..1). */
  completeness: number
}

export interface DatasetCoverage {
  totalRows: number
  minTs: string | null
  maxTs: string | null
  /** Expected frames per fully-covered day at the EFFECTIVE step. */
  expectedPerDay: number
  /** The step the backfill requested (e.g. 15s). */
  requestedStepSeconds: number
  /**
   * The cadence the source actually delivered, derived from the median
   * inter-frame gap. The Amperio frames endpoint may downsample below the
   * requested step, so completeness is measured against THIS, not the request.
   */
  effectiveStepSeconds: number
  /** Overall completeness across the covered span vs effective cadence (0..1). */
  overallCompleteness: number
  /** Days within [minTs, maxTs] that have zero stored frames. */
  missingDays: number
  /** Number of inter-frame gaps longer than 2x the effective step (real dropouts). */
  dropoutCount: number
  /** Largest inter-frame gap in seconds. */
  maxGapSeconds: number
  perDay: CoverageDay[]
}

/**
 * Per-day row counts + completeness for a station's stored telemetry.
 *
 * Completeness is measured against the EFFECTIVE cadence the source actually
 * delivered (derived from the median inter-frame gap), not the requested step.
 * The Amperio frames endpoint can downsample below the requested step, so
 * judging against the request would understate quality. Measuring against the
 * observed cadence makes "completeness" mean what an engineer wants: the
 * fraction of frames present relative to how often the source emits, with the
 * remainder being genuine dropouts. The per-day series is gap-filled across the
 * whole [minTs, maxTs] span so empty days show up explicitly (count 0).
 */
export async function getCoverage(
  stationId: string,
  requestedStepSeconds = 15,
): Promise<DatasetCoverage> {
  const totalRes = await db.execute(
    sql`SELECT count(*)::int AS total,
               min(ts) AS min_ts,
               max(ts) AS max_ts
        FROM telemetry_frame
        WHERE station_id = ${stationId}`,
  )
  const total = totalRes.rows[0] as { total: number; min_ts: string | null; max_ts: string | null }
  const totalRows = total?.total ?? 0
  const minTs = total?.min_ts ?? null
  const maxTs = total?.max_ts ?? null

  if (totalRows === 0 || !minTs || !maxTs) {
    return {
      totalRows: 0,
      minTs,
      maxTs,
      expectedPerDay: Math.round(86_400 / requestedStepSeconds),
      requestedStepSeconds,
      effectiveStepSeconds: requestedStepSeconds,
      overallCompleteness: 0,
      missingDays: 0,
      dropoutCount: 0,
      maxGapSeconds: 0,
      perDay: [],
    }
  }

  // Derive the effective cadence + dropout stats from inter-frame gaps.
  const gapRes = await db.execute(
    sql`WITH g AS (
          SELECT EXTRACT(EPOCH FROM (ts - lag(ts) OVER (ORDER BY ts))) AS gap_s
          FROM telemetry_frame
          WHERE station_id = ${stationId}
        )
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_s) AS median_gap,
               max(gap_s) AS max_gap
        FROM g WHERE gap_s IS NOT NULL`,
  )
  const gap = gapRes.rows[0] as { median_gap: number | null; max_gap: number | null }
  const medianGap = gap?.median_gap && gap.median_gap > 0 ? gap.median_gap : requestedStepSeconds
  // Round the observed cadence to the nearest sane step so tiny jitter doesn't
  // produce odd denominators (e.g. 29.97 → 30).
  const effectiveStepSeconds = nearestStep(medianGap)
  const maxGapSeconds = Math.round(gap?.max_gap ?? 0)
  const expectedPerDay = Math.round(86_400 / effectiveStepSeconds)

  // Count real dropouts: inter-frame gaps longer than 2x the effective cadence.
  const dropoutRes = await db.execute(
    sql`WITH g AS (
          SELECT EXTRACT(EPOCH FROM (ts - lag(ts) OVER (ORDER BY ts))) AS gap_s
          FROM telemetry_frame
          WHERE station_id = ${stationId}
        )
        SELECT count(*)::int AS dropouts
        FROM g WHERE gap_s > ${effectiveStepSeconds * 2}`,
  )
  const dropoutCount = (dropoutRes.rows[0] as { dropouts: number })?.dropouts ?? 0

  // Gap-fill: generate every calendar day in the span, LEFT JOIN the counts so
  // empty days become explicit count=0 rows.
  const perDayRes = await db.execute(
    sql`WITH days AS (
          SELECT generate_series(
            date_trunc('day', ${minTs}::timestamptz),
            date_trunc('day', ${maxTs}::timestamptz),
            interval '1 day'
          ) AS day
        ),
        counts AS (
          SELECT date_trunc('day', ts) AS day, count(*)::int AS count
          FROM telemetry_frame
          WHERE station_id = ${stationId}
          GROUP BY 1
        )
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
               COALESCE(c.count, 0) AS count
        FROM days d
        LEFT JOIN counts c ON c.day = d.day
        ORDER BY d.day`,
  )

  const perDay: CoverageDay[] = (perDayRes.rows as Array<{ day: string; count: number }>).map(
    (r) => ({
      day: r.day,
      count: r.count,
      completeness: Math.min(1, r.count / expectedPerDay),
    }),
  )

  const spanDays = perDay.length
  const overallCompleteness = spanDays > 0 ? totalRows / (spanDays * expectedPerDay) : 0
  const missingDays = perDay.filter((d) => d.count === 0).length

  return {
    totalRows,
    minTs,
    maxTs,
    expectedPerDay,
    requestedStepSeconds,
    effectiveStepSeconds,
    overallCompleteness: Math.min(1, overallCompleteness),
    missingDays,
    dropoutCount,
    maxGapSeconds,
    perDay,
  }
}

/** Snap an observed median gap (seconds) to the nearest conventional step. */
function nearestStep(seconds: number): number {
  const steps = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300]
  return steps.reduce((best, s) => (Math.abs(s - seconds) < Math.abs(best - seconds) ? s : best), steps[0])
}
