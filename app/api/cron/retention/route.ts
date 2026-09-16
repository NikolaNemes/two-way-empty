import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { sql } from "drizzle-orm"

/**
 * TELEMETRY RETENTION CRON — deletes telemetry_frame rows older than 35 days,
 * BUT ONLY for (station, day)s that already have a station_day_report rollup.
 *
 * Schedule: daily at 03:15 UTC (vercel.json), after the 02:30 rollup cron.
 *
 * SAFETY INTERLOCK: raw telemetry is the only source the rollup can be built
 * from — once deleted, the day's report is whatever was frozen. So deletion
 * joins against station_day_report and a day WITHOUT a rollup row is never
 * touched, no matter how old (reported as `blockedDays` for observability).
 * This makes the rollup→retention ordering a performance nicety rather than
 * a correctness requirement: if rollup fails a night, retention simply skips.
 *
 * AUTH (same convention as /api/dispatcher/tick):
 *   • Vercel Cron calls with `Authorization: Bearer <CRON_SECRET>` automatically.
 *   • `?secret=<CRON_SECRET>` accepted for manual triggers / pingers.
 *   • If CRON_SECRET is unset (local/dev), the endpoint is open.
 *
 * DELETION IS BATCHED (50k rows per statement, up to 20 batches per run ≈ 1M
 * rows): one giant DELETE on a 100+ MB table would hold locks and can hit the
 * serverless statement timeout. If a run hits the batch cap it reports
 * `exhausted: false` and the next daily run continues — retention converges.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 300

// Mirrors RAW_RETENTION_DAYS in lib/rollup.ts (35 = month + buffer so a full
// calendar month is always raw-complete while its rollups settle).
const RETENTION_DAYS = 35
const BATCH_ROWS = 50_000
const MAX_BATCHES = 20

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return true // local/dev
  const auth = req.headers.get("authorization") ?? ""
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""
  if (bearer === secret) return true
  return req.nextUrl.searchParams.get("secret") === secret
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const startedAt = Date.now()
  let deleted = 0
  let batches = 0
  let exhausted = true

  try {
    for (let i = 0; i < MAX_BATCHES; i++) {
      // ctid subquery = batched delete without an ORDER BY scan over the whole
      // dead range on every pass. INTERLOCK: a frame is only a victim when its
      // (station, UTC day) already has a frozen rollup row.
      const res = await db.execute(sql`
        WITH victims AS (
          SELECT ctid FROM telemetry_frame t
          WHERE ts < now() - make_interval(days => ${RETENTION_DAYS})
            AND EXISTS (
              SELECT 1 FROM station_day_report r
              WHERE r.station_id = t.station_id
                AND r.day = to_char(t.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD')
            )
          LIMIT ${BATCH_ROWS}
        )
        DELETE FROM telemetry_frame t
        USING victims v
        WHERE t.ctid = v.ctid
      `)
      const n = res.rowCount ?? 0
      batches++
      deleted += n
      if (n < BATCH_ROWS) break // dead range drained
      if (i === MAX_BATCHES - 1) exhausted = false
    }

    const remRes = await db.execute(sql`
      SELECT count(*)::int AS remaining FROM telemetry_frame
      WHERE ts < now() - make_interval(days => ${RETENTION_DAYS})
    `)
    const remaining = Number((remRes.rows[0] as { remaining?: number } | undefined)?.remaining ?? 0)

    // Observability: (station, day)s past retention age that are BLOCKED from
    // deletion because their rollup row is missing. Persistent entries here
    // mean the rollup cron is failing for those days and needs attention.
    const blockedRes = await db.execute(sql`
      SELECT t.station_id, to_char(t.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS frames
      FROM telemetry_frame t
      WHERE ts < now() - make_interval(days => ${RETENTION_DAYS})
        AND NOT EXISTS (
          SELECT 1 FROM station_day_report r
          WHERE r.station_id = t.station_id
            AND r.day = to_char(t.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        )
      GROUP BY 1, 2
      ORDER BY 2
      LIMIT 50
    `)
    const blockedDays = blockedRes.rows as { station_id: string; day: string; frames: number }[]

    return NextResponse.json({
      ok: true,
      retentionDays: RETENTION_DAYS,
      deleted,
      batches,
      exhausted,
      remainingOlderThanRetention: remaining,
      blockedDays,
      tookMs: Date.now() - startedAt,
    })
  } catch (err) {
    console.error("[v0] retention cron failed:", err)
    return NextResponse.json(
      { ok: false, deleted, batches, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
