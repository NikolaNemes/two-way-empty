/**
 * ONE-TIME / OPS: freeze lossless daily rollups for live stations and make the
 * raw tail local.
 *
 *   NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/backfill-rollups.ts \
 *     <stationId|all> <fromDay> <toDay> [--force] [--frames-from=YYYY-MM-DD]
 *
 * Per station:
 *   1. (optional) backfill API frames into telemetry_frame for
 *      [--frames-from, today) so Dispatching History / the accruing day are
 *      served from Neon (Gronau had ZERO local frames).
 *   2. rollupStationDay for every closed UTC day in [fromDay, toDay]:
 *      stored frames first, Amperio API fallback; --force re-freezes rows that
 *      predate the lossless payload (no `detail.tariff`).
 *
 * Progress is printed per day so the run can be tailed; the script is
 * idempotent and safe to re-run after a timeout.
 */
import { db } from "../lib/db"
import { rollupStationDay, utcDayOf } from "../lib/rollup"
import { backfillRange } from "../lib/ingestion"
import { listStations } from "../lib/stations"
import { sql } from "drizzle-orm"

const MS_DAY = 86_400_000

async function main() {
  const [stationArg, fromDay, toDay, ...flags] = process.argv.slice(2)
  if (!stationArg || !fromDay || !toDay) {
    console.log("usage: backfill-rollups.ts <stationId|all> <fromDay> <toDay> [--force] [--frames-from=YYYY-MM-DD]")
    process.exit(1)
  }
  const force = flags.includes("--force")
  const framesFrom = flags.find((f) => f.startsWith("--frames-from="))?.split("=")[1] ?? null

  const all = await listStations({ enabledOnly: true, fresh: true })
  const stations = all.filter((s) => stationArg === "all" || s.stationId === stationArg)
  if (stations.length === 0) throw new Error(`no enabled station matches "${stationArg}"`)

  const today = utcDayOf(new Date())
  const days: string[] = []
  for (let t = Date.parse(`${fromDay}T00:00:00Z`); ; t += MS_DAY) {
    const d = utcDayOf(new Date(t))
    if (d > toDay || d >= today) break
    days.push(d)
  }
  console.log(`[v0] stations=${stations.map((s) => s.stationId).join(",")} days=${days.length} (${days[0]}..${days[days.length - 1]}) force=${force}`)

  for (const st of stations) {
    if (framesFrom) {
      console.log(`[v0] ${st.stationId}: backfilling API frames ${framesFrom} → today`)
      const t0 = Date.now()
      const n = await backfillRange({
        stationId: st.stationId,
        fromIso: `${framesFrom}T00:00:00.000Z`,
        toIso: new Date().toISOString(),
        stepSeconds: 15,
        onProgress: (p) => console.log(`[v0]   frames so far: ${p.framesIngested}`),
      })
      console.log(`[v0] ${st.stationId}: ${n} frames inserted in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    }

    // Skip rows that already carry the lossless payload unless --force.
    const lossless = new Set<string>()
    if (!force) {
      const r = await db.execute(
        sql`SELECT day FROM station_day_report WHERE station_id = ${st.stationId} AND detail ? 'tariff'`,
      )
      for (const row of r.rows as { day: string }[]) lossless.add(row.day)
    }

    let ok = 0
    let skipped = 0
    let failed = 0
    for (const day of days) {
      if (lossless.has(day)) {
        skipped++
        continue
      }
      const t0 = Date.now()
      const res = await rollupStationDay(st.stationId, day, { force: true })
      const dt = ((Date.now() - t0) / 1000).toFixed(0)
      if (!res.ok) {
        failed++
        console.log(`[v0] ${st.stationId} ${day}: FAILED ${res.error} (${dt}s)`)
      } else if (res.skipped) {
        skipped++
        console.log(`[v0] ${st.stationId} ${day}: skipped ${res.skipped} (${dt}s)`)
      } else {
        ok++
        console.log(`[v0] ${st.stationId} ${day}: frozen ${res.frames} frames, kernel saving ${res.savingsEur?.toFixed(2)} € (${dt}s)`)
      }
    }
    console.log(`[v0] ${st.stationId}: done ok=${ok} skipped=${skipped} failed=${failed}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[v0] backfill-rollups failed:", err)
    process.exit(1)
  })
