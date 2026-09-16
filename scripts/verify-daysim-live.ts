/**
 * Verifies the Live Dispatching (day-sim) staleness fix for a station whose
 * stored frames only partially cover today (Gifhorn onboarding backfill).
 *
 * Asserts that runBacktestForRange over TODAY (a still-accruing window):
 *   1. sources frames from the LIVE API (frameSource === "live"), and
 *   2. the series extends past the stored-frame cutoff (07:55 UTC), i.e. the
 *      chart is no longer frozen at the backfill end.
 *
 * Run: NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/verify-daysim-live.ts
 */
import { runBacktestForRange } from "../app/actions/backtest"

const SID = "chargepost_gifhorn_001"
const STORED_CUTOFF_MS = Date.parse("2026-08-21T07:55:20.775Z")

async function main() {
  const now = new Date()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000)

  const res = await runBacktestForRange({
    stationId: SID,
    fromIso: dayStart.toISOString(),
    toIso: dayEnd.toISOString(),
  })

  console.log("frameSource:", res.frameSource, " mpcStatus:", res.mpcStatus, " series pts:", res.series.length)
  const last = res.series[res.series.length - 1]
  if (!last) throw new Error("FAIL: empty series")
  const lastMs = new Date(last.ts).getTime()
  console.log("last series ts:", last.ts, " (stored cutoff was 07:55:20Z)")
  const lastSoc = (last as { socPct?: number }).socPct
  if (lastSoc !== undefined) console.log("last SOC %:", lastSoc)

  const pass = res.frameSource === "live" && lastMs > STORED_CUTOFF_MS + 10 * 60_000
  console.log(pass ? "PASS: live source, data extends past backfill cutoff" : "FAIL: still pinned to stored frames")
  if (!pass) process.exit(1)
}

main().catch((e) => {
  console.error("FAIL:", e)
  process.exit(1)
})
