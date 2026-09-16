import { NextResponse } from "next/server"
import { runBacktestForRange } from "@/app/actions/backtest"

export const maxDuration = 240

/**
 * TEMPORARY debug route (aug 25 2026): replicates the Dispatching History
 * "Grid-cap breaches" KPI (computeTelemetryStats in actual-vs-optimised-card)
 * for Gifhorn over its last telemetry days, to locate the client-reported
 * "13 breaches". DELETE after the investigation.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  if (url.searchParams.get("secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const stationId = url.searchParams.get("station") ?? "chargepost_gifhorn_001"
  const fromIso = url.searchParams.get("from") ?? "2026-08-19T22:00:00.000Z"
  const toIso = url.searchParams.get("to") ?? "2026-08-21T21:59:59.999Z"

  const bt = await runBacktestForRange({ stationId, fromIso, toIso })
  if (!bt || bt.empty) return NextResponse.json({ error: "empty backtest", stationId, fromIso, toIso })

  // EXACT UI rule from computeTelemetryStats: |actualGridKw| > siteGridLimitKw + 0.5
  const EPS = 0.5
  let breaches = 0
  let capKw = 0
  const samples: unknown[] = []
  for (const p of bt.series) {
    const lim = p.siteGridLimitKw
    if (lim != null && Number.isFinite(lim)) {
      capKw = Math.max(capKw, lim)
      if (p.actualGridKw != null && Math.abs(p.actualGridKw) > lim + EPS) {
        breaches++
        if (samples.length < 15) {
          samples.push({
            ts: p.ts,
            actualGridKw: p.actualGridKw,
            siteGridLimitKw: lim,
            baseloadKw: p.baseloadKw,
            evKw: p.evKw,
            socB1: p.actualB1SocPct,
            socB2: p.actualB2SocPct,
            b1Kw: p.b1Kw,
            b2Kw: p.b2Kw,
          })
        }
      }
    }
  }
  return NextResponse.json({
    stationId,
    fromIso,
    toIso,
    frames: bt.series.length,
    capKw,
    breaches,
    samples,
  })
}
