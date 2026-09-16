import { NextResponse } from "next/server"
import { getRedis, isStoreConfigured } from "@/lib/dispatcher-store"
import { engineConfig } from "@/lib/dispatch-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Check {
  name: string
  ok: boolean
  detail: string
}

/**
 * Readiness probe — checks the dependencies the dispatcher needs to function:
 *  1. Upstash Redis (the durable store) is configured AND reachable (PING).
 *  2. The Amperio auth token is present.
 *  3. The Amperio base URL is reachable.
 *
 * Returns 200 when every check passes, 503 otherwise with per-check detail.
 */
export async function GET() {
  const cfg = engineConfig()
  const checks: Check[] = []

  // 1. Redis configured + reachable.
  if (!isStoreConfigured()) {
    checks.push({ name: "redis", ok: false, detail: "KV_REST_API_URL / KV_REST_API_TOKEN not set" })
  } else {
    try {
      const redis = getRedis()
      const pong = await redis?.ping()
      checks.push({ name: "redis", ok: pong === "PONG", detail: pong === "PONG" ? "reachable" : `unexpected ping reply: ${pong}` })
    } catch (err) {
      checks.push({ name: "redis", ok: false, detail: `ping failed: ${(err as Error).message}` })
    }
  }

  // 2. Amperio auth token present.
  checks.push({
    name: "amperio_auth",
    ok: cfg.authToken != null,
    detail: cfg.authToken != null ? "token configured" : "AMPERIO_AUTH_TOKEN not set",
  })

  // 3. Amperio base reachable (HEAD-ish GET; any HTTP reply counts as reachable).
  try {
    const ctrl = AbortSignal.timeout(4000)
    const res = await fetch(`${cfg.baseUrl}/stations`, {
      headers: cfg.authToken ? { Authorization: `Bearer ${cfg.authToken}`, Accept: "application/json" } : { Accept: "application/json" },
      cache: "no-store",
      signal: ctrl,
    })
    checks.push({ name: "amperio_reachable", ok: res.ok || res.status < 500, detail: `HTTP ${res.status}` })
  } catch (err) {
    checks.push({ name: "amperio_reachable", ok: false, detail: `unreachable: ${(err as Error).message}` })
  }

  const ready = checks.every((c) => c.ok)
  return NextResponse.json(
    { ready, checks, ts: new Date().toISOString() },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  )
}
