import { type NextRequest, NextResponse } from "next/server"
import { getStatus, recordSourcePresence, withStationScope } from "@/lib/dispatcher-status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Live status snapshot for the Dispatcher Status page (polled via SWR).
 *
 * Each open dashboard tab sends its `X-Dispatch-Source` id on every poll, so we
 * register its *presence* here (without counting it as a tick). That keeps the
 * multi-pinger guardrail aware of every open tab — including ones that are
 * currently yielding and not triggering ticks — so the client-side "who drives"
 * election stays stable instead of deadlocking.
 */
export async function GET(req: NextRequest) {
  // MULTI-LOCATION: `?stationId=` scopes every store read to that station's
  // Redis namespace. Absent (all legacy callers) → the default station.
  const stationId = req.nextUrl.searchParams.get("stationId")?.trim() || null

  const respond = async () => {
    const id = req.headers.get("x-dispatch-source")?.trim()
    if (id && id.startsWith("dash:")) {
      // The tab also sends its meaningful name (browser + OS) so the Pingers
      // monitor can label it even before it triggers its first tick.
      const name = req.headers.get("x-dispatch-name")?.trim().slice(0, 80) || null
      await recordSourcePresence(id.slice(0, 80), "dashboard", name).catch(() => {})
    }
    return NextResponse.json(await getStatus(), {
      headers: { "Cache-Control": "no-store" },
    })
  }

  return stationId ? withStationScope(stationId, respond) : respond()
}
