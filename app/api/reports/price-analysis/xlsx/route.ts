/**
 * Excel export of the Price Analysis (dynamic vs flat) — client request
 * aug 24 2026, same pattern as the Fleet Yearly export.
 *
 * Three sheets:
 *   1. "Summary"  — verdict counts, weighted flat, actual euro totals
 *   2. "Monthly"  — one row per month (verdict counts + actual euros)
 *   3. "Daily"    — the raw grain: one row per Berlin day
 *
 * Auth: browser route behind Clerk via proxy.ts (/api/reports is NOT in the
 * machine bypass list), so the signed-in session downloads it directly.
 * ADMIN-ONLY (client request aug 25 2026): Amperio "user" accounts must not
 * see tariff/price internals — role verified per request below.
 */

import { NextResponse, type NextRequest } from "next/server"
import ExcelJS from "exceljs"
import { getCurrentUser } from "@/lib/auth"
import { getPriceAnalysis, PRICE_ANALYSIS_FIRST_DAY, type DayVerdict } from "@/lib/price-analysis"
import { appendDefinitionsSheet } from "@/lib/report-definitions"

export const maxDuration = 60

const EUR = "#,##0.00\u00a0€"
const CT = "#,##0.0\u00a0\u0022ct\u0022"
const KWH = "#,##0"
const NUM0 = "#,##0"

const VERDICT_LABEL: Record<DayVerdict, string> = {
  favorable: "Favorable",
  headwind: "Headwind",
  guaranteed_loss: "Guaranteed loss",
}

function isDay(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 })
  }
  const url = new URL(req.url)
  const today = new Date().toISOString().slice(0, 10)
  let fromDay = isDay(url.searchParams.get("from")) ? url.searchParams.get("from")! : PRICE_ANALYSIS_FIRST_DAY
  let toDay = isDay(url.searchParams.get("to")) ? url.searchParams.get("to")! : today
  if (fromDay < PRICE_ANALYSIS_FIRST_DAY) fromDay = PRICE_ANALYSIS_FIRST_DAY
  if (toDay > today) toDay = today
  if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay]

  const a = await getPriceAnalysis(fromDay, toDay)

  const wb = new ExcelJS.Workbook()
  wb.creator = "enexa fleet reporting"
  wb.created = new Date()

  const headerStyle = (ws: ExcelJS.Worksheet) => {
    const row = ws.getRow(1)
    row.font = { bold: true, size: 10 }
    row.alignment = { vertical: "middle" }
    ws.views = [{ state: "frozen", ySplit: 1 }]
  }

  // ── Sheet 1: Summary ─────────────────────────────────────────────────────
  const s1 = wb.addWorksheet("Summary")
  s1.columns = [
    { header: "Metric", key: "k", width: 34 },
    { header: "Value", key: "v", width: 22 },
  ]
  const t = a.totals
  const rows: [string, string | number][] = [
    ["Range", `${a.fromDay} → ${a.toDay}`],
    ["Weighted flat reference (ct/kWh)", Number(a.weightedFlatCt.toFixed(2))],
    ["Days classified", t.favorableDays + t.headwindDays + t.lossDays],
    ["Favorable days", t.favorableDays],
    ["Headwind days", t.headwindDays],
    ["Guaranteed-loss days", t.lossDays],
    ["Actuals through", a.actualsThroughDay ?? "—"],
    ["Actual import kWh", Math.round(t.actualImportKwh)],
    ["Actual flat € (counterfactual)", Number(t.actualFlatEur.toFixed(2))],
    ["Actual dynamic € (paid)", Number(t.actualDynEur.toFixed(2))],
    ["Actual Δ€ (flat − dynamic)", Number(t.actualDeltaEur.toFixed(2))],
    ["Best day", t.bestDay ? `${t.bestDay.day} (+${t.bestDay.deltaEur.toFixed(2)} €)` : "—"],
    ["Worst day", t.worstDay ? `${t.worstDay.day} (${t.worstDay.deltaEur.toFixed(2)} €)` : "—"],
  ]
  for (const [k, v] of rows) s1.addRow({ k, v })
  headerStyle(s1)

  // ── Sheet 2: Monthly ─────────────────────────────────────────────────────
  const s2 = wb.addWorksheet("Monthly")
  s2.columns = [
    { header: "Month", key: "month", width: 10 },
    { header: "Days", key: "days", width: 7, style: { numFmt: NUM0 } },
    { header: "Favorable", key: "favorableDays", width: 10, style: { numFmt: NUM0 } },
    { header: "Headwind", key: "headwindDays", width: 10, style: { numFmt: NUM0 } },
    { header: "Loss days", key: "lossDays", width: 10, style: { numFmt: NUM0 } },
    { header: "Avg price ct", key: "avgPriceCt", width: 12, style: { numFmt: CT } },
    { header: "Avg spread ct", key: "avgSpreadCt", width: 13, style: { numFmt: CT } },
    { header: "Actual days", key: "actualDays", width: 11, style: { numFmt: NUM0 } },
    { header: "Import kWh", key: "importKwh", width: 12, style: { numFmt: KWH } },
    { header: "Flat €", key: "flatEur", width: 12, style: { numFmt: EUR } },
    { header: "Dynamic €", key: "dynEur", width: 12, style: { numFmt: EUR } },
    { header: "Δ€ (flat − dyn)", key: "deltaEur", width: 14, style: { numFmt: EUR } },
  ]
  for (const m of a.months) s2.addRow(m)
  const totalRow = s2.addRow({
    month: "TOTAL",
    days: t.favorableDays + t.headwindDays + t.lossDays,
    favorableDays: t.favorableDays,
    headwindDays: t.headwindDays,
    lossDays: t.lossDays,
    importKwh: t.actualImportKwh,
    flatEur: t.actualFlatEur,
    dynEur: t.actualDynEur,
    deltaEur: t.actualDeltaEur,
  })
  totalRow.font = { bold: true }
  headerStyle(s2)

  // ── Sheet 3: Daily grain ─────────────────────────────────────────────────
  const s3 = wb.addWorksheet("Daily")
  s3.columns = [
    { header: "Day", key: "day", width: 11 },
    { header: "Verdict", key: "verdict", width: 15 },
    { header: "Min ct", key: "minCt", width: 9, style: { numFmt: CT } },
    { header: "Avg ct", key: "avgCt", width: 9, style: { numFmt: CT } },
    { header: "Max ct", key: "maxCt", width: 9, style: { numFmt: CT } },
    { header: "Spread ct", key: "spreadCt", width: 10, style: { numFmt: CT } },
    { header: "Import kWh", key: "importKwh", width: 12, style: { numFmt: KWH } },
    { header: "Flat €", key: "flatEur", width: 12, style: { numFmt: EUR } },
    { header: "Dynamic €", key: "dynEur", width: 12, style: { numFmt: EUR } },
    { header: "Δ€ (flat − dyn)", key: "deltaEur", width: 14, style: { numFmt: EUR } },
  ]
  for (const d of a.days) {
    const row = s3.addRow({ ...d, verdict: VERDICT_LABEL[d.verdict] })
    if (d.verdict === "guaranteed_loss") {
      row.getCell("verdict").font = { color: { argb: "FFDC2626" }, bold: true }
    } else if (d.verdict === "headwind") {
      row.getCell("verdict").font = { color: { argb: "FFD97706" } }
    }
  }
  headerStyle(s3)

  // ── Sheet 4: Definitions — the shared Annex glossary (lib/report-definitions) ──
  appendDefinitionsSheet(wb, [
    "settlementWindow",
    "slot",
    "gridImport",
    "flatRate",
    "dynamicTariff",
    "priceSourceMix",
    "flatCost",
    "dynamicCost",
    "procurementSaving",
    "idmSpread",
    "dayVerdict",
  ])

  const buf = await wb.xlsx.writeBuffer()
  const filename = `price-analysis_${a.fromDay}_${a.toDay}.xlsx`
  return new NextResponse(buf as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
