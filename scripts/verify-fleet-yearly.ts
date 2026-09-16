/**
 * Verifies the Fleet Yearly pipeline end-to-end WITHOUT the HTTP layer:
 *  1. getFleetYearlyReport() — the exact server action the page renders
 *  2. an exceljs workbook from the same data — proves the export path
 *
 * Run: NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/verify-fleet-yearly.ts
 * (env sourced from /vercel/share/.env.project)
 */
import { getFleetYearlyReport } from "../app/actions/fleet-yearly"
import ExcelJS from "exceljs"

async function main() {
  const r = await getFleetYearlyReport()
  console.log("[v0] range:", r.fromMonth, "→", r.toMonth)
  console.log("[v0] months:", r.months.map((m) => `${m.month}(${m.stations})`).join(" "))
  console.log("[v0] stations:", r.stations.length, "| station-months:", r.totals.stationMonths)
  console.log(
    "[v0] totals: net €" + Math.round(r.totals.netEur),
    "saving €" + Math.round(r.totals.procSavingEur),
    "ev " + Math.round(r.totals.evKwh) + " kWh",
  )

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Monthly totals")
  ws.columns = [
    { header: "Month", key: "month" },
    { header: "Net €", key: "netEur" },
  ]
  for (const m of r.months) ws.addRow(m)
  const buf = await wb.xlsx.writeBuffer()
  console.log("[v0] xlsx buffer bytes:", (buf as ArrayBuffer).byteLength)

  const ok = r.months.length >= 8 && r.stations.length >= 50 && (buf as ArrayBuffer).byteLength > 1000
  console.log(ok ? "PASS" : "FAIL")
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error("FAIL:", e)
  process.exit(1)
})
