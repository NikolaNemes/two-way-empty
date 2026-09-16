import type { RangeBacktestResult } from "@/app/actions/backtest"
import {
  DEFINITIONS_SHEET_HEADER,
  DEFINITIONS_SHEET_WIDTHS,
  definitionsSheetRows,
  termHeader,
  type ReportTermKey,
} from "@/lib/report-definitions"

/**
 * Dispatching History → Excel (client side, SheetJS loaded on demand).
 *
 * Mirrors what the telemetry card shows for the selected window:
 *   1. Summary     — the KPI strip (Annex terms) + provenance
 *   2. Daily       — per-day grid import / EV / cost when the run is multi-day
 *   3. Sessions    — every plug-in session (C1/C2) with energy and car SoC
 *   4. Telemetry   — the metered series (grid, EV per connector, AUX, pack SOC,
 *                    price); stride-downsampled above MAX_SERIES_ROWS so a
 *                    30-day export stays a few MB, never a 300k-row sheet
 *   5. Definitions — the shared Annex glossary (every report workbook has it)
 */

const MAX_SERIES_ROWS = 40_000

const round1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)
const round2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100)

const TERMS_USED: readonly ReportTermKey[] = [
  "site",
  "frame",
  "settlementWindow",
  "gridImport",
  "evDelivered",
  "aux",
  "siteLoad",
  "sessions",
  "batteryThroughput",
  "gridCap",
  "priceSourceMix",
  "dataThrough",
]

export async function exportDispatchingHistoryXlsx(
  result: RangeBacktestResult,
  opts: {
    stationLabel: string
    fromDay: string
    toDay: string
    capKw?: number
    breaches?: number
    /** Per-battery (B1 or B2) measured SOC extremes — the "Measured SOC" tile. */
    batterySoc?: { min: number; max: number }
  },
) {
  const XLSX = await import("xlsx")
  const wb = XLSX.utils.book_new()

  const evDelivered = (result.totals.mEv1Kwh ?? 0) + (result.totals.mEv2Kwh ?? 0)
  const aux = result.totals.auxKwh ?? 0
  const k = result.kpis
  const lastTs = result.series.length ? result.series[result.series.length - 1].ts : null

  // ── 1. Summary ─────────────────────────────────────────────────────────────
  const summary: (string | number | null)[][] = [
    ["Dispatching History"],
    [],
    [termHeader("site"), opts.stationLabel],
    [termHeader("settlementWindow"), `${opts.fromDay} → ${opts.toDay}`],
    ["Frame source", result.frameSource ?? "stored"],
    [termHeader("dataThrough"), lastTs ?? "—"],
    [termHeader("frame", { unit: "count" }), k.frames],
    ["Covered hours", round1(k.durationHours)],
    [],
    [termHeader("gridImport", { unit: "kWh" }), round1(result.totals.actualImportKwh)],
    [termHeader("evDelivered", { unit: "kWh" }), round1(evDelivered)],
    ["  of which C1 (kWh)", round1(result.totals.mEv1Kwh ?? 0)],
    ["  of which C2 (kWh)", round1(result.totals.mEv2Kwh ?? 0)],
    [termHeader("aux", { unit: "kWh" }), round1(aux)],
    [termHeader("siteLoad", { unit: "kWh" }), round1(evDelivered + aux)],
    [termHeader("sessions", { unit: "count" }), result.sessions.length],
    [termHeader("batteryThroughput", { unit: "kWh" }), round1(k.batteryThroughputKwh)],
    ["Battery cycles", round2(k.batteryCycles)],
    // Two SOC rows on purpose — they answer different questions. The pack row
    // is the site-level average of both batteries (what the optimiser steers);
    // the per-battery row is the extreme of EITHER battery (what the "Measured
    // SOC" tile shows). One battery can sit at 3 % while the pack reads 77 %.
    ["Measured pack SOC min / avg / max (%) — average of B1+B2", `${round1(k.socMinPct)} / ${round1(k.socAvgPct)} / ${round1(k.socMaxPct)}`],
    [
      "Measured battery SOC range (%) — lowest / highest of any single battery",
      opts.batterySoc ? `${round1(opts.batterySoc.min)} – ${round1(opts.batterySoc.max)}` : null,
    ],
    [termHeader("gridCap", { unit: "kW" }), opts.capKw ?? null],
    // Breaches come from result.chartStats — counted on the full series
    // before any chart downsampling, so they are always frame-resolution.
    ["Grid-cap breaches (frames)", opts.breaches ?? null],
    [
      "Telemetry sheet resolution",
      result.seriesStepMs
        ? `${Math.round(result.seriesStepMs / 60_000)}-min bucket means (chart series; totals and KPIs from full data)`
        : "native frames",
    ],
  ]
  if (result.rollup) {
    summary.push(
      [],
      ["Rollup part (frozen daily aggregates)", ""],
      ["  days from rollups", result.rollup.days],
      ["  closed days without data", result.rollup.missingDays],
      ["  import over rollup days (kWh)", round1(result.rollup.importKwh)],
    )
  }
  const wsSummary = XLSX.utils.aoa_to_sheet(summary)
  wsSummary["!cols"] = [{ wch: 40 }, { wch: 34 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary")

  // ── 2. Daily ───────────────────────────────────────────────────────────────
  if (result.daily && result.daily.length > 0) {
    const wsDaily = XLSX.utils.json_to_sheet(
      result.daily.map((d) => ({
        Day: d.bucketIso,
        [termHeader("frame", { unit: "count" })]: d.frames,
        "EV energy (kWh)": round1(d.evKwh),
        "Metered cost (EUR)": round2(d.actualCostEur),
      })),
    )
    wsDaily["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, wsDaily, "Daily")
  }

  // ── 3. Sessions ────────────────────────────────────────────────────────────
  const wsSessions = XLSX.utils.json_to_sheet(
    result.sessions.length
      ? result.sessions.map((s) => ({
          Connector: s.label,
          Start: s.startIso,
          End: s.endIso,
          "Duration (min)": Math.round((s.endMs - s.startMs) / 60_000),
          "Energy (kWh)": round2(s.energyKwh),
          "Avg power (kW)": round1(s.avgKw),
          "Car SoC start (%)": s.startSocPct ?? null,
          "Car SoC end (%)": s.endSocPct ?? null,
          Frames: s.frames,
        }))
      : [{ Connector: "—", Note: "No plug-in sessions in this window" }],
  )
  wsSessions["!cols"] = [{ wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 13 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 8 }]
  XLSX.utils.book_append_sheet(wb, wsSessions, "Sessions")

  // ── 4. Telemetry series ────────────────────────────────────────────────────
  const stride = Math.max(1, Math.ceil(result.series.length / MAX_SERIES_ROWS))
  const rows = result.series
    .filter((_, i) => i % stride === 0)
    .map((p) => {
      const ev = (p.mEv1Kw ?? 0) + (p.mEv2Kw ?? 0)
      const site = p.evKw ?? null
      return {
        Timestamp: p.ts,
        [termHeader("gridImport", { unit: "kW" })]: round2(p.actualGridKw),
        "EV C1 (kW)": round2(p.mEv1Kw),
        "EV C2 (kW)": round2(p.mEv2Kw),
        [termHeader("aux", { unit: "kW" })]: site == null ? null : round2(Math.max(0, site - ev)),
        "Pack 1 SOC (%)": round1(p.actualB1SocPct ?? p.b1SocPct),
        "Pack 2 SOC (%)": round1(p.actualB2SocPct ?? p.b2SocPct),
        "Price (EUR/MWh)": round2(p.priceEurMwh),
        "Site grid limit (kW)": round1(p.siteGridLimitKw),
      }
    })
  const wsSeries = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Timestamp: "—", Note: "No frames in this window" }])
  wsSeries["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 11 }, { wch: 11 }, { wch: 18 }, { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(
    wb,
    wsSeries,
    stride > 1 ? `Telemetry (1 in ${stride})` : "Telemetry",
  )

  // ── 5. Definitions ─────────────────────────────────────────────────────────
  const wsDefs = XLSX.utils.aoa_to_sheet([[...DEFINITIONS_SHEET_HEADER], ...definitionsSheetRows(TERMS_USED)])
  wsDefs["!cols"] = DEFINITIONS_SHEET_WIDTHS.map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, wsDefs, "Definitions")

  XLSX.writeFile(wb, `dispatching-history_${opts.stationLabel.replace(/\s+/g, "-")}_${opts.fromDay}_${opts.toDay}.xlsx`)
}
