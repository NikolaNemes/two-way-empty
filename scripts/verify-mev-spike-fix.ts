// ONE-OFF VERIFICATION — metered EV power spike fix (Aug 20 2026 feedback).
//
// Reproduces the exact path behind Live Dispatching → Charging Session for a
// non-persisted day: pull today's frames straight from the Amperio API, run
// the SAME runBacktest replay, and report the maximum per-connector metered
// EV power (mEv1Kw/mEv2Kw) in the series. Before the fix, a telemetry gap
// before session end compounded the gap's energy into one 15s frame
// (~452 kW on a ~100 kW connector). After the fix (backward-dt derivation)
// the max must stay physically plausible (≤ ~150 kW connector rating).
//
// Run: node --env-file-if-exists=/vercel/share/.env.project \
//        node_modules/.bin/tsx scripts/verify-mev-spike-fix.ts [YYYY-MM-DD]

import { loadLiveBacktestFrames } from "../lib/ingestion"
import { runBacktest } from "../lib/backtest"

const STATION = "chargepost_norderstedt_001"
const day = process.argv[2] ?? new Date().toISOString().slice(0, 10)

async function main() {
  const fromIso = `${day}T00:00:00.000Z`
  const toIso = `${day}T23:59:59.999Z`
  console.log(`[verify] pulling live frames ${STATION} ${day}...`)
  const frames = await loadLiveBacktestFrames({ stationId: STATION, fromIso, toIso })
  console.log(`[verify] frames: ${frames.length}`)
  if (frames.length === 0) {
    console.log("[verify] no frames — nothing to check")
    return
  }
  const result = await runBacktest({
    stationId: STATION,
    fromTs: new Date(fromIso),
    toTs: new Date(toIso),
    frames,
  })
  let max1 = 0
  let max2 = 0
  let spikes = 0
  for (const p of result.series) {
    const m1 = p.mEv1Kw ?? 0
    const m2 = p.mEv2Kw ?? 0
    if (m1 > max1) max1 = m1
    if (m2 > max2) max2 = m2
    if (m1 > 160 || m2 > 160) spikes++
  }
  console.log(`[verify] max mEv1Kw=${max1.toFixed(1)} kW, max mEv2Kw=${max2.toFixed(1)} kW`)
  console.log(`[verify] frames above 160 kW (physically impossible): ${spikes}`)
  console.log(spikes === 0 ? "[verify] PASS — no compounded spikes" : "[verify] FAIL — spikes remain")
}

main().catch((e) => {
  console.error("[verify] error:", e instanceof Error ? e.message : e)
  process.exit(1)
})
