import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Liveness probe — confirms the app process is up and serving. Always 200 when
 * the function can execute. Does NOT check dependencies (see /ready) or the
 * dispatch heartbeat (see /live).
 */
export async function GET() {
  return NextResponse.json(
    { status: "ok", service: "dispatcher", ts: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  )
}
