import { NextRequest, NextResponse } from "next/server"
import {
  fillFleetMonth,
  fillLiveFleetMonth,
  fleetReportMonths,
  liveFleetMonths,
  METHODOLOGY_VERSION,
  type FleetMonthFillResult,
  type LiveFleetFillResult,
} from "@/lib/fleet-report-builder"

/**
 * FLEET MONTH REPORT FILL — pre-computes the Fleet Monthly Report rows into
 * fleet_month_report so the yearly report page and its Excel export NEVER
 * calculate on the fly (client feedback aug 20 2026).
 *
 * Default behavior: (re)fill EVERY month from FLEET_REPORT_FIRST_MONTH (May
 * 2025) through the CURRENT month — the current + previous month always
 * refresh (they can still change), older months are skipped when already
 * filled ON THE CURRENT METHODOLOGY_VERSION unless ?force=1. A month whose
 * rows carry an older version is treated as unfilled, so a methodology bump
 * self-heals the whole table over the next nights within the time budget
 * (no manual DELETE needed — e.g. the sep 2 2026 provenance rule that
 * stopped persisting synthesized / zero archive months).
 *
 * Manual: ?month=YYYY-MM fills exactly one month (always recomputed).
 *
 * AUTH: same convention as the other crons (Bearer CRON_SECRET / ?secret=).
 */

export const dynamic = "force-dynamic"
export const maxDuration = 300

/** Stop starting new months once this much wall clock is spent. */
const TIME_BUDGET_MS = 240_000

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return true
  const auth = req.headers.get("authorization") ?? ""
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""
  if (bearer === secret) return true
  return req.nextUrl.searchParams.get("secret") === secret
}

const MONTH_RE = /^\d{4}-\d{2}$/

/** Trailing `n` months ending at the current month, oldest first. */
function trailingMonths(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  }
  return out
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const one = req.nextUrl.searchParams.get("month")
  const force = req.nextUrl.searchParams.get("force") === "1"
  // ?dataset=hist → hist twins only; ?dataset=live → real stations only;
  // absent → both (the scheduled cron keeps both datasets fresh).
  const datasetParam = req.nextUrl.searchParams.get("dataset")
  if (one && !MONTH_RE.test(one)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 })
  }

  const started = Date.now()

  const months = one ? [one] : fleetReportMonths()

  // Which months are already filled? (skip old ones unless forced)
  const { db } = await import("@/lib/db")
  const { fleetMonthReport } = await import("@/lib/db/schema")
  const { and, inArray, like, notLike, sql } = await import("drizzle-orm")
  // "Filled" = has rows AND none of them predate the current methodology.
  const staleCount = sql<number>`count(*) filter (where ${fleetMonthReport.methodologyVersion} is distinct from ${METHODOLOGY_VERSION})`
  const existing =
    one || datasetParam === "live"
      ? []
      : (
          await db
            .select({ month: fleetMonthReport.month, stale: staleCount })
            .from(fleetMonthReport)
            .where(and(inArray(fleetMonthReport.month, months), like(fleetMonthReport.stationId, "hist_%")))
            .groupBy(fleetMonthReport.month)
        )
          .filter((r) => Number(r.stale) === 0)
          .map((r) => r.month)
  const nowMonth = trailingMonths(1)[0]
  const prevMonth = trailingMonths(2)[0]

  const results: FleetMonthFillResult[] = []
  const skipped: string[] = []
  // ── HISTORY ANALYSIS dataset (hist_* archive twins) — pure archive
  // simulation, no telemetry dependency, so nothing here can fail because a
  // live station is unavailable.
  if (datasetParam !== "live") {
    for (const m of months) {
      const alwaysRefresh = m === nowMonth || m === prevMonth
      if (!one && !force && !alwaysRefresh && existing.includes(m)) {
        skipped.push(m)
        continue
      }
      if (Date.now() - started > TIME_BUDGET_MS) {
        results.push({ month: m, ok: false, rows: 0, error: "time budget exhausted" })
        continue
      }
      try {
        results.push(await fillFleetMonth(m))
      } catch (e) {
        results.push({ month: m, ok: false, rows: 0, error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  // ── LIVE dataset fill (real chargepost_* stations, from May 2026) ────────
  // Same month/force semantics; ?dataset=hist skips it, ?dataset=live skips
  // the hist fill above... but hist has already run by here, so the switch is
  // applied up-front for live-only via the `liveOnly` short-circuit below.
  const liveResults: LiveFleetFillResult[] = []
  const liveSkipped: string[] = []
  if (datasetParam !== "hist") {
    const liveMonths = one ? (liveFleetMonths().includes(one) ? [one] : []) : liveFleetMonths()
    const liveExisting = one
      ? []
      : (
          await db
            .select({ month: fleetMonthReport.month, stale: staleCount })
            .from(fleetMonthReport)
            .where(
              and(inArray(fleetMonthReport.month, liveMonths), notLike(fleetMonthReport.stationId, "hist_%")),
            )
            .groupBy(fleetMonthReport.month)
        )
          .filter((r) => Number(r.stale) === 0)
          .map((r) => r.month)
    for (const m of liveMonths) {
      const alwaysRefresh = m === nowMonth || m === prevMonth
      if (!one && !force && !alwaysRefresh && liveExisting.includes(m)) {
        liveSkipped.push(m)
        continue
      }
      if (Date.now() - started > TIME_BUDGET_MS) {
        liveResults.push({ month: m, ok: false, rows: 0, stations: {}, error: "time budget exhausted" })
        continue
      }
      try {
        liveResults.push(await fillLiveFleetMonth(m))
      } catch (e) {
        liveResults.push({
          month: m,
          ok: false,
          rows: 0,
          stations: {},
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  return NextResponse.json({
    methodologyVersion: METHODOLOGY_VERSION,
    filled: results.filter((r) => r.ok).length,
    skipped,
    results,
    live: {
      filled: liveResults.filter((r) => r.ok).length,
      skipped: liveSkipped,
      results: liveResults,
    },
    tookMs: Date.now() - started,
  })
}
