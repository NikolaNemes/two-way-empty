/**
 * Proxy route for Amperio API
 * 
 * This proxies requests to the Amperio backend to avoid CORS issues
 * when calling from the browser. The backend uses gzip compression
 * which is handled automatically.
 * 
 * Usage:
 *   GET /api/telemetry/latest?station_id=chargepost_gronau_001
 *   -> proxies to https://amperio.enexa.me/api/v1/telemetry/latest?station_id=...
 */

import { NextRequest, NextResponse } from "next/server"
import { defaultIdmSources } from "@/lib/idm-sources"

const BACKEND_BASE = "https://amperio.enexa.me/api/v1"

/**
 * IDM (intraday) price fallback.
 *
 * The Amperio backend currently has the IDM source disabled — a GET for
 * `/prices?source=IDM` returns HTTP 400 "Source IDM/DE-LU/PT15M not found
 * or disabled". That made every Data-Analysis report show IDM prices as
 * "failed" in the loading feed, even though IDM is non-critical (the day-sim
 * and cost math already fall back to the DAM/EPEX price when IDM is absent).
 *
 * Rather than surface a scary failure, we resolve IDM server-side from the
 * same free SMARD intraday-continuous source chain the backtest engine
 * already uses (`lib/idm-sources.ts`). Running it here (server) avoids the
 * browser CORS wall against smard.de and returns a normal 200 in the
 * `ApiPricesResponse` shape, so the report's IDM step completes cleanly with
 * real intraday data. If SMARD also yields nothing, we return an empty (but
 * successful) curve so downstream code transparently falls back to DAM.
 */
async function resolveIdmPricesFromSmard(
  fromIso: string,
  toIso: string,
): Promise<{
  source: "IDM"
  region: string
  resolution: string
  prices: { ts: string; price_eur_mwh: number }[]
  stats: { min: number; max: number; avg: number; spread: number }
}> {
  const fromMs = new Date(fromIso).getTime()
  const toMs = new Date(toIso).getTime()

  let points: { ts: number; priceEurMwh: number }[] = []
  // Walk the priority chain (SMARD 15-min → SMARD hourly → ENTSO-E) and take
  // the first source that returns data; each isolates its own failure.
  for (const src of defaultIdmSources()) {
    try {
      const got = await src.fetch(fromMs, toMs)
      if (got.length > 0) {
        points = got
        break
      }
    } catch {
      // Source unavailable (e.g. missing ENTSOE token, transient SMARD
      // hiccup) — try the next one in the chain.
    }
  }

  // De-dupe to one point per timestamp, clip to the requested window, sort.
  const byTs = new Map<number, number>()
  for (const p of points) {
    if (p.ts < fromMs || p.ts > toMs) continue
    if (!byTs.has(p.ts)) byTs.set(p.ts, p.priceEurMwh)
  }
  const prices = Array.from(byTs.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, price_eur_mwh]) => ({
      ts: new Date(ts).toISOString(),
      price_eur_mwh,
    }))

  const values = prices.map((p) => p.price_eur_mwh)
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 0
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0

  return {
    source: "IDM",
    region: "DE-LU",
    resolution: "PT15M",
    prices,
    stats: { min, max, avg, spread: max - min },
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const pathStr = path.join("/")
  const searchParams = request.nextUrl.searchParams.toString()
  const url = `${BACKEND_BASE}/${pathStr}${searchParams ? `?${searchParams}` : ""}`

  const isIdmPrices =
    pathStr === "prices" &&
    request.nextUrl.searchParams.get("source") === "IDM"

  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      // Don't cache - we want fresh data
      cache: "no-store",
    })

    if (!response.ok) {
      // The Amperio backend has IDM disabled; transparently serve real
      // intraday prices from SMARD instead of bubbling up a "failed" step.
      if (isIdmPrices) {
        const from = request.nextUrl.searchParams.get("from") ?? ""
        const to = request.nextUrl.searchParams.get("to") ?? ""
        const idm = await resolveIdmPricesFromSmard(from, to)
        return NextResponse.json(idm)
      }
      const errorText = await response.text()
      return NextResponse.json(
        { error: errorText || response.statusText },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    // Network error reaching Amperio — IDM can still be served from SMARD.
    if (isIdmPrices) {
      try {
        const from = request.nextUrl.searchParams.get("from") ?? ""
        const to = request.nextUrl.searchParams.get("to") ?? ""
        const idm = await resolveIdmPricesFromSmard(from, to)
        return NextResponse.json(idm)
      } catch (smardErr) {
        console.error("[v0] IDM SMARD fallback error:", smardErr)
      }
    }
    console.error("[v0] Telemetry proxy error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const pathStr = path.join("/")
  const url = `${BACKEND_BASE}/${pathStr}`

  try {
    const body = await request.json()
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: errorText || response.statusText },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Telemetry proxy error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
