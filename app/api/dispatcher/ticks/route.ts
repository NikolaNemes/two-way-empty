import { type NextRequest, NextResponse } from "next/server"
import { getTickReport, withStationScope } from "@/lib/dispatcher-status"

export const dynamic = "force-dynamic"

/**
 * 24h ticking report — durable, bucketed history of how continuously the
 * dispatch loop has been driven (by this dashboard or any external pinger).
 * Read-only; powers the Ticking Report card.
 * MULTI-LOCATION: `?stationId=` reads that station's tick history.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const stationId = req.nextUrl.searchParams.get("stationId")?.trim() || null
  const report = stationId
    ? await withStationScope(stationId, getTickReport)
    : await getTickReport()
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } })
}
