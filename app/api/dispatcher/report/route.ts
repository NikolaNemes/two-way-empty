import { type NextRequest, NextResponse } from "next/server"
import { recordReport, getControl, clearActivity, type DispatcherReport } from "@/lib/dispatcher-status"
import { withStationScope } from "@/lib/dispatcher-store"

// In-memory store must run on the Node runtime (not edge) and never be cached.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Ingest endpoint for the dispatch worker.
 *
 * The worker POSTs a DispatcherReport here on every tick (and on start/stop).
 * If DISPATCHER_REPORT_TOKEN is set in the app's environment, the worker must
 * send a matching `Authorization: Bearer <token>` header. When the env var is
 * unset, the endpoint is open (fine for local/dev use).
 */
export async function POST(req: NextRequest) {
  const expectedToken = process.env.DISPATCHER_REPORT_TOKEN?.trim()
  if (expectedToken) {
    const auth = req.headers.get("authorization") ?? ""
    const provided = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""
    if (provided !== expectedToken) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
    }
  }

  let body: DispatcherReport
  try {
    body = (await req.json()) as DispatcherReport
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 })
  }

  if (!body || typeof body !== "object" || !body.worker || !body.phase) {
    return NextResponse.json({ ok: false, error: "missing worker or phase" }, { status: 400 })
  }

  // MULTI-LOCATION: scope the write to the station the WORKER says it drives.
  // Unscoped, recordReport lands in the legacy (Gronau) namespace — a
  // Norderstedt worker's heartbeat/activity would pollute Gronau's records
  // and leave its own station looking dead. Reports without a stationId
  // (legacy single-station workers) keep the legacy namespace via the
  // store's default, unchanged.
  const reportStationId = body.worker.stationId?.trim()
  const run = async () => {
    await recordReport(body)
    // Echo the operator desired-state so the worker can gate its next tick.
    return NextResponse.json({ ok: true, control: await getControl() })
  }
  return reportStationId ? withStationScope(reportStationId, run) : run()
}

/**
 * Clear the activity feed (operator action from the status page). This only
 * empties the rolling log in our store — it does not touch the worker, the
 * control flag, or any Amperio command records.
 */
export async function DELETE(req: NextRequest) {
  // MULTI-LOCATION: ?stationId= clears that station's feed; absent → legacy
  // (Gronau) namespace, matching every other dispatcher route's convention.
  const stationId = req.nextUrl.searchParams.get("stationId")?.trim()
  if (stationId) {
    await withStationScope(stationId, () => clearActivity())
  } else {
    await clearActivity()
  }
  return NextResponse.json({ ok: true })
}
