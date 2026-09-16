/**
 * OPS: pull a BOUNDED range of raw frames from the Amperio API into
 * telemetry_frame (idempotent, ON CONFLICT DO NOTHING), one UTC day at a time.
 *
 *   NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/backfill-frames.ts \
 *     <stationId> <fromDay> <toDayExclusive> [--step=15]
 *
 * Used 4 sep 2026 to re-hydrate May–Jul 2026 (Gronau May 1 → Jul 30,
 * Norderstedt Jun 18 → Jul 30) so those days could be re-frozen from real
 * frames under the energy-balance method instead of carrying legacy scalars.
 * The upstream endpoint serves ~30 s cadence for step ≤ 30. The nightly
 * retention cron purges anything older than RAW_RETENTION_DAYS once the day's
 * station_day_report row exists, so the re-hydrated frames are transient:
 * freeze the days the same session.
 */
import { backfillRange } from "../lib/ingestion"

const MS_DAY = 86_400_000

async function main() {
  const [stationId, fromDay, toDay, ...flags] = process.argv.slice(2)
  if (!stationId || !fromDay || !toDay) {
    console.log("usage: backfill-frames.ts <stationId> <fromDay> <toDayExclusive> [--step=15]")
    process.exit(1)
  }
  const step = Number(flags.find((f) => f.startsWith("--step="))?.split("=")[1] ?? 15)
  const start = Date.parse(`${fromDay}T00:00:00Z`)
  const end = Date.parse(`${toDay}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("bad range")

  const nDays = Math.round((end - start) / MS_DAY)
  console.log(`[v0] ${stationId}: ${fromDay} → ${toDay} (${nDays} d) step=${step}s`)
  const t0 = Date.now()
  let total = 0
  for (let t = start; t < end; t += MS_DAY) {
    const day = new Date(t).toISOString().slice(0, 10)
    const td = Date.now()
    try {
      const n = await backfillRange({
        stationId,
        fromIso: new Date(t).toISOString(),
        toIso: new Date(Math.min(t + MS_DAY, end)).toISOString(),
        stepSeconds: step,
      })
      total += n
      console.log(`[v0] ${stationId} ${day}: +${n} frames (${((Date.now() - td) / 1000).toFixed(0)} s, Σ ${total})`)
    } catch (err) {
      console.log(`[v0] ${stationId} ${day}: FAILED ${(err as Error).message}`)
    }
  }
  console.log(`[v0] ${stationId}: done, ${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[v0] backfill-frames failed:", err)
    process.exit(1)
  })
