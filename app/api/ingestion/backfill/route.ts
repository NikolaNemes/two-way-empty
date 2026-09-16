// ════════════════════════════════════════════════════════════════════════
// POST/GET /api/ingestion/backfill — ops endpoint to backfill telemetry
// history for ANY station into Neon. CRON_SECRET-protected (same auth as the
// other operational endpoints). Wraps the same startBackfill used by the
// /lab/ingestion UI, so jobs are tracked in ingestion_job either way.
//
//   GET /api/ingestion/backfill?secret=…&stationId=…&from=2026-06-18&to=2026-06-25
//
// Runs synchronously (day-by-day paging, idempotent ON CONFLICT DO NOTHING),
// so call it in modest chunks (≤ ~2 weeks) to stay within serverless limits.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server"
import { startBackfill } from "@/app/actions/ingestion"

export const maxDuration = 300

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const url = new URL(req.url)
  const auth = req.headers.get("authorization")
  return auth === `Bearer ${secret}` || url.searchParams.get("secret") === secret
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const url = new URL(req.url)
  const stationId = url.searchParams.get("stationId")?.trim()
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")
  const step = Number(url.searchParams.get("stepSeconds") ?? 15)

  if (!stationId || !from || !to) {
    return NextResponse.json({ error: "stationId, from, to are required" }, { status: 400 })
  }
  const fromIso = new Date(from).toISOString()
  const toIso = new Date(to).toISOString()
  if (!Number.isFinite(new Date(fromIso).getTime()) || new Date(toIso) <= new Date(fromIso)) {
    return NextResponse.json({ error: "invalid range" }, { status: 400 })
  }

  const job = await startBackfill({ stationId, fromIso, toIso, stepSeconds: step })
  return NextResponse.json({
    ok: job.status === "done",
    jobId: job.id,
    stationId,
    from: fromIso,
    to: toIso,
    framesIngested: job.framesIngested,
    status: job.status,
    error: job.error ?? null,
  })
}
