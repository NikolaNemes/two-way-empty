import { NextRequest, NextResponse } from "next/server"
import { listStations } from "@/lib/stations"
import {
  listDaysWithoutFrames,
  listMissingRollupDays,
  rollupStationDay,
  utcDayOf,
  RAW_RETENTION_DAYS,
  type RollupDayResult,
} from "@/lib/rollup"
import { backfillRange } from "@/lib/ingestion"
import { prewarmYesterdayReports, type PrewarmResult } from "@/lib/report-prewarm"

/**
 * NIGHTLY REPORT ROLLUP CRON — freezes daily aggregates into
 * station_day_report before raw telemetry ages out of retention.
 *
 * Schedule: daily 02:30 UTC (vercel.json), 45 min BEFORE the retention cron.
 * The retention cron's interlock (never delete an un-rolled-up day) makes the
 * ordering a performance nicety, not a correctness requirement.
 *
 * Default behavior: for each enabled station, find closed UTC days inside the
 * raw window with frames but no rollup row, and roll them up (time-boxed).
 *
 * Manual backfill: ?stationId=&from=YYYY-MM-DD&to=YYYY-MM-DD[&force=1]
 * rolls an explicit range (any age, as long as raw frames still exist).
 *
 * AUTH: same convention as the other crons (Bearer CRON_SECRET / ?secret=).
 */

export const dynamic = "force-dynamic"
export const maxDuration = 300

/** Time-box: stop starting new days once this much wall clock is spent. */
const TIME_BUDGET_MS = 240_000
/** Per-run cap so a huge backlog converges over nights instead of timing out. */
const MAX_DAYS_PER_RUN = 40
/** Frame backfill (step 0) budget: leave most of the run for the rollups. */
const BACKFILL_BUDGET_MS = 90_000
/** Newest N frame-less days per station per night (normally just yesterday). */
const MAX_BACKFILL_DAYS_PER_RUN = 3
/** Step 2 (report pre-warm) budget: ~3 raw chunks per station, ≈5 s each worst case. */
const PREWARM_BUDGET_MS = 60_000

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return true
  const auth = req.headers.get("authorization") ?? ""
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""
  if (bearer === secret) return true
  return req.nextUrl.searchParams.get("secret") === secret
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  if (!authorize(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const startedAt = Date.now()
  const sp = req.nextUrl.searchParams
  const onlyStation = sp.get("stationId")?.trim() || null
  const from = sp.get("from")?.trim() || null
  const to = sp.get("to")?.trim() || null
  const force = sp.get("force") === "1"

  if ((from && !DAY_RE.test(from)) || (to && !DAY_RE.test(to))) {
    return NextResponse.json({ ok: false, error: "from/to must be YYYY-MM-DD" }, { status: 400 })
  }

  try {
    const stations = (await listStations({ enabledOnly: true })).filter(
      (s) => !onlyStation || s.stationId === onlyStation,
    )
    if (stations.length === 0) {
      return NextResponse.json({ ok: false, error: "no matching enabled stations" }, { status: 404 })
    }

    // Default (cron) window: the raw retention window's closed days. Manual
    // from/to overrides it for backfills of older still-raw history.
    const today = utcDayOf(new Date())
    const defaultFrom = utcDayOf(new Date(Date.now() - RAW_RETENTION_DAYS * 24 * 3600 * 1000))
    const fromDay = from ?? defaultFrom
    const toDay = to ?? today // listMissingRollupDays excludes today itself

    const results: RollupDayResult[] = []
    let rolled = 0
    let timeBoxed = false
    const backfilled: { s: string; d: string; frames: number }[] = []

    // ── STEP 0: keep the raw tail LOCAL (sep 2 2026) ────────────────────────
    // There is no continuous frame ingestion: telemetry_frame only holds what
    // a backfill wrote, so API-only stations (Gronau) replayed the whole range
    // through the middleware on every report request. Fetch each enabled
    // station's closed days inside the retention window that have no local
    // frames (yesterday, normally) before rolling up. Retention's interlock
    // keeps these days until they are rolled.
    if (!from && !to) {
      const yesterday = utcDayOf(new Date(Date.now() - 24 * 3600 * 1000))
      for (const station of stations) {
        const days = await listDaysWithoutFrames(station.stationId, defaultFrom, yesterday)
        for (const day of days.slice(-MAX_BACKFILL_DAYS_PER_RUN)) {
          if (Date.now() - startedAt > BACKFILL_BUDGET_MS) break
          try {
            const n = await backfillRange({
              stationId: station.stationId,
              fromIso: `${day}T00:00:00.000Z`,
              toIso: new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 3600 * 1000).toISOString(),
              stepSeconds: 15,
            })
            backfilled.push({ s: station.stationId, d: day, frames: n })
          } catch (err) {
            console.log(`[v0] rollup cron: frame backfill ${station.stationId} ${day} failed: ${(err as Error)?.message ?? err}`)
          }
        }
      }
    }

    outer: for (const station of stations) {
      let days: string[]
      if (force && from && to) {
        // Forced explicit range: enumerate every day, even already-rolled ones.
        days = []
        for (let t = new Date(`${fromDay}T00:00:00Z`).getTime(); ; t += 24 * 3600 * 1000) {
          const d = utcDayOf(new Date(t))
          if (d > toDay || d >= today) break
          days.push(d)
        }
      } else {
        days = await listMissingRollupDays(station.stationId, fromDay, toDay)
      }

      for (const day of days) {
        if (Date.now() - startedAt > TIME_BUDGET_MS || rolled >= MAX_DAYS_PER_RUN) {
          timeBoxed = true
          break outer
        }
        const r = await rollupStationDay(station.stationId, day, { force })
        results.push(r)
        if (r.ok && !r.skipped) rolled++
      }
    }

    // ── STEP 2: pre-warm yesterday's site reports (sep 2 2026) ──────────────
    // Berlin-local "Yesterday" straddles two UTC days, so it is always a raw
    // replay (2.5–5 s cold). Replaying it now fills the closed-chunk memo, so
    // the first Financial / Dispatching History load of the morning is ~0.1 s.
    // Scheduled runs only; best-effort; never fails the cron.
    let prewarm: PrewarmResult | null = null
    if (!from && !to && !force) {
      const remaining = TIME_BUDGET_MS - (Date.now() - startedAt)
      if (remaining > 10_000) {
        try {
          prewarm = await prewarmYesterdayReports(
            stations.map((s) => s.stationId),
            { budgetMs: Math.min(remaining, PREWARM_BUDGET_MS) },
          )
        } catch (err) {
          console.error("[v0] report pre-warm failed:", err)
        }
      }
    }

    const failed = results.filter((r) => !r.ok)
    return NextResponse.json({
      ok: failed.length === 0,
      rolled,
      skipped: results.filter((r) => r.skipped).length,
      failed: failed.length,
      timeBoxed,
      backfilled,
      prewarm,
      // Failures carry their error; successes stay compact.
      results: results.map((r) => (r.ok && !r.error ? { s: r.stationId, d: r.day, f: r.frames, skip: r.skipped } : r)),
      tookMs: Date.now() - startedAt,
    })
  } catch (err) {
    console.error("[v0] rollup cron failed:", err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
