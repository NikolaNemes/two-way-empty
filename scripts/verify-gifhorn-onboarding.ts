/**
 * Onboarding smoke test for chargepost_gifhorn_001.
 * Confirms the registry row wires the station into the DB-driven pipeline:
 *  - listStations({dispatchOnly}) returns Gifhorn (so the tick loop drives it)
 *  - its physics load from the registry
 *  - a backtest over the backfilled window computes finite numbers (no NaN)
 * Run: NODE_OPTIONS=--conditions=react-server tsx scripts/verify-gifhorn-onboarding.ts
 */
import { listStations, getStation } from "../lib/stations"
import { runBacktest } from "../lib/backtest"
import { loadLiveBacktestFrames } from "../lib/ingestion"

const SID = "chargepost_gifhorn_001"

async function main() {
  const dispatch = await listStations({ dispatchOnly: true })
  const ids = dispatch.map((s) => s.stationId)
  console.log("dispatch-enabled stations:", ids.join(", "))
  console.log("Gifhorn in dispatch loop:", ids.includes(SID) ? "YES" : "NO — MISSING")

  const st = await getStation(SID)
  if (!st) throw new Error("Gifhorn registry row not found")
  console.log(
    `physics: grid ${st.gridImportLimitKw}/${st.gridRealPowerCapKw} kW  cap ${st.battCapacityKwh} kWh  batt ${st.battMaxPowerKw} kW  flat ${st.flatRateCtKwh} wear ${st.wearCtKwh}`,
  )

  const fromIso = "2026-08-20T00:00:00.000Z"
  const toIso = "2026-08-22T00:00:00.000Z"
  const frames = await loadLiveBacktestFrames({ stationId: SID, fromIso, toIso })
  console.log("backtest input frames:", frames.length)
  const bt = await runBacktest({ stationId: SID, fromTs: new Date(fromIso), toTs: new Date(toIso), frames })
  const t = (bt as { totals?: Record<string, number> }).totals ?? {}
  const allFinite = Object.values(t).every((v) => typeof v !== "number" || Number.isFinite(v))
  console.log("backtest totals:", JSON.stringify(t))
  console.log("all totals finite:", allFinite ? "YES" : "NO — NaN present")
  console.log(allFinite && ids.includes(SID) ? "\nPASS" : "\nFAIL")
}

main().catch((e) => {
  console.error("verify failed:", e)
  process.exit(1)
})
