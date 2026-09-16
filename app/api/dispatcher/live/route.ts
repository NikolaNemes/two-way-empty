import { type NextRequest, NextResponse } from "next/server"
import { getLiveness, withStationScope } from "@/lib/dispatcher-status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Dispatch freshness probe for the EVENT/REPLAN-DRIVEN dispatcher. There is no
 * fixed tick loop anymore, so freshness is keyed on the LAST PLAN + its dispatch
 * outcome rather than heartbeat cadence:
 *   - healthy:  a fresh, optimal plan exists and the last dispatch succeeded
 *   - degraded: a replan is overdue for the current slot
 *   - down:     no plan, last solve errored/infeasible, last dispatch failed, or
 *               the plan is stale past a slot boundary
 *   - disabled: operator intent is "stopped"
 *
 * Returns 503 when `down` so external uptime monitors can alert; 200 otherwise
 * (healthy/degraded/disabled are all "behaving as configured").
 */
export async function GET(req: NextRequest) {
  // MULTI-LOCATION: `?stationId=` probes that station's plan freshness;
  // absent → default station (legacy monitors unchanged).
  const stationId = req.nextUrl.searchParams.get("stationId")?.trim() || null
  const live = stationId ? await withStationScope(stationId, getLiveness) : await getLiveness()
  const httpStatus = live.status === "down" ? 503 : 200
  return NextResponse.json(
    { ...live, ts: new Date().toISOString() },
    { status: httpStatus, headers: { "Cache-Control": "no-store" } },
  )
}
