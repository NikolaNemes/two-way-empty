/**
 * Re-fill frozen fleet_month_report rows from the sandbox — same code path as
 * the nightly /api/cron/fleet-report?force=1.
 *
 *   live (default): real chargepost_* stations since LIVE_FLEET_FIRST_MONTH
 *   hist:           History Analysis archive twins (hist_*) since
 *                   FLEET_REPORT_FIRST_MONTH — pure archive simulation, no
 *                   telemetry dependency.
 *
 * Run after a METHODOLOGY_VERSION bump so frozen rows pick up new columns /
 * rules (sep 2 2026: ev_delivered_kwh / aux_kwh, per-day replay basis,
 * provenance rule that drops synthesized / zero archive months, archive-only
 * history — no Gronau anchor, no capture scaling).
 *
 *   NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/refill-live-fleet-months.ts [--hist] [YYYY-MM ...]
 */
import { fillFleetMonth, fillLiveFleetMonth, fleetReportMonths, liveFleetMonths } from "../lib/fleet-report-builder"

async function main() {
  const args = process.argv.slice(2)
  const hist = args.includes("--hist")
  const wanted = args.filter((a) => /^\d{4}-\d{2}$/.test(a))

  if (hist) {
    const months = wanted.length > 0 ? wanted : fleetReportMonths()
    console.log(`[v0] refilling HIST fleet months (archive-only): ${months.join(", ")}`)
    for (const m of months) {
      const t0 = Date.now()
      try {
        const r = await fillFleetMonth(m)
        console.log(
          `[v0] ${m}: ok=${r.ok} rows=${r.rows} skipped=${r.skipped ?? 0} ${r.error ?? ""} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
        )
      } catch (err) {
        console.log(`[v0] ${m}: FAILED ${(err as Error)?.message ?? err}`)
      }
    }
    return
  }

  const months = wanted.length > 0 ? wanted : liveFleetMonths()
  console.log(`[v0] refilling live fleet months: ${months.join(", ")}`)
  for (const m of months) {
    const t0 = Date.now()
    try {
      const r = await fillLiveFleetMonth(m)
      const st = Object.entries(r.stations)
        .map(([id, s]) => `${id.replace("chargepost_", "")}=${(s as { status?: string }).status ?? JSON.stringify(s)}`)
        .join(" ")
      console.log(`[v0] ${m}: ok=${r.ok} rows=${r.rows} ${st} ${r.error ?? ""} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    } catch (err) {
      console.log(`[v0] ${m}: FAILED ${(err as Error)?.message ?? err}`)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[v0] refill failed:", err)
    process.exit(1)
  })
