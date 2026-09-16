import { type NextRequest, NextResponse } from "next/server"
import { setCommandsClearedAt, getCommandsClearedAt, withStationScope } from "@/lib/dispatcher-status"

export const dynamic = "force-dynamic"

/**
 * Operator "clear commands view" marker.
 *
 * Amperio's GET /api/v1/commands is the master record and has no delete API,
 * so this does NOT delete anything in Amperio. It records a timestamp; the
 * dashboard hides commands issued at/before it. POST sets it to now; DELETE
 * resets it (un-clears the view).
 * MULTI-LOCATION: `?stationId=` scopes the marker to that station's namespace.
 */
function scoped<T>(req: NextRequest, fn: () => Promise<T>): Promise<T> {
  const stationId = req.nextUrl.searchParams.get("stationId")?.trim() || null
  return stationId ? withStationScope(stationId, fn) : fn()
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const at = Date.now()
  await scoped(req, () => setCommandsClearedAt(at))
  return NextResponse.json(
    { ok: true, commandsClearedAt: new Date(at).toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  )
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  await scoped(req, () => setCommandsClearedAt(null))
  return NextResponse.json({ ok: true, commandsClearedAt: null }, { headers: { "Cache-Control": "no-store" } })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const at = await scoped(req, getCommandsClearedAt)
  return NextResponse.json(
    { commandsClearedAt: at == null ? null : new Date(at).toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  )
}
