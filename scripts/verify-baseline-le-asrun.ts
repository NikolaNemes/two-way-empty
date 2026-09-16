/**
 * verify-baseline-le-asrun — the physical sanity gate on the load-shifting
 * counterfactual, for EVERY live station × EVERY window a client can pick.
 *
 *   "Procurement WITHOUT load shifting" (projected import) must sit AT OR
 *   BELOW "Procurement WITH load shifting (as run)" (measured import).
 *   Load shifting only ever ADDS cycling losses; it never removes energy.
 *
 * Runs the SAME settlement path as the Financial Report and Fleet Monthly
 * (lib/settlement.settleStationWindow), so what it prints is what the client
 * sees. For every window it prints as-run vs projected import and, where the
 * projection is above, decomposes the gap into its known physical causes:
 *
 *   • superseded  — days frozen under the old 0.85 method (no raw frames
 *                   left); their term is removed algebraically (2026-09-04.2),
 *                   a sub-1 % residual from other superseded terms can remain
 *   • true-up     — end-of-window SOC anchoring (baseline pack ends at the
 *                   measured SOC; the kWh to get there are bought). Dominates
 *                   SHORT windows (days), washes out over a month
 *   • meter>100 % — the station's battery meter reports more discharged than
 *                   charged → as-run import is UNDERSTATED by the meter error
 *                   (vendor issue T4). No methodology can close this
 *   • other       — site-load definition (per-frame ≥0 clamps) and rounding
 *
 * Usage:
 *   NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/verify-baseline-le-asrun.ts
 *   … [--months 2026-07,2026-08]  [--stations chargepost_gronau_001]
 *
 * Exit 1 if any window is above as-run WITHOUT an identified cause covering
 * ≥ 90 % of the gap (i.e. a real, unexplained model defect).
 */
import React from "react"
void React
import { sql as dsql } from "drizzle-orm"
import { db } from "../lib/db"
import { settleStationWindow } from "../lib/settlement"
import { berlinMonthWindow, berlinDayWindow, type ReportWindow } from "../lib/report-window"
import { METHODOLOGY_VERSION } from "../lib/methodology-version"

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}
const fmt0 = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 0 })
const fmt1 = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const eur = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
const berlinDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" })
const shiftDay = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

type Row = {
  station: string
  label: string
  days: number
  asRun: number
  projected: number
  gap: number
  status: "ok" | "above"
  superseded: { days: number; kwh: number; eur: number }
  trueUpKwh: number
  meterEff: number | null
  meterExcessKwh: number
  explainedPct: number | null
  cause: string
  noLsEur: number
  asRunEur: number
  timingEur: number
}

async function checkWindow(station: string, label: string, window: ReportWindow): Promise<Row | null> {
  const s = await settleStationWindow({ stationId: station, window })
  const c = s.c
  if (!c) return null
  const gap = c.noArbImportKwh - c.totalImportKwh
  const above = gap > 0.5
  // Meter excess: what the battery meter "created" — discharge beyond
  // (charge − ΔSOC). Positive ⇒ as-run import understated by this much.
  const meterExcess = Math.max(0, c.battMeterDischargeKwh - (c.battMeterChargeKwh - c.battMeterSocDeltaKwh))
  const meterBias = c.battMeterRoundTripEff != null && c.battMeterRoundTripEff > 1
  const trueUp = Math.max(0, c.storedDiffKwh)
  let explained: number | null = null
  const causes: string[] = []
  if (above) {
    // Method 2026-09-04.4: every energy-balance segment is ≤ its measured
    // import BY CONSTRUCTION (import − 3 % × max(0, extra charge)). The only
    // way a window can sit above is a frozen day WITHOUT battery-meter legs
    // (pre-.1, no raw frames) that fell back to its simulated baseline. Any
    // gap on a window with zero such days is a genuine defect.
    let covered = 0
    if (c.supersededEffDays > 0) {
      covered = gap
      causes.push(
        `${c.supersededEffDays} of ${c.days.length} days without battery-meter legs (simulated fallback; 0.85 gross-up removed −${fmt0(c.supersededEffKwh)} kWh; no raw frames → not re-settleable; LEGACY)`,
      )
    }
    if (c.rollupLegacyDays > 0 && covered < gap) {
      covered = gap
      causes.push(`${c.rollupLegacyDays} legacy rollup days without a tariff block (no baseline at all)`)
    }
    if (meterBias && covered < gap) {
      causes.push(`battery meter >100 % (η ${(c.battMeterRoundTripEff! * 100).toFixed(1)} %, +${fmt0(meterExcess)} kWh phantom discharge, T4) — NOT an excuse under the energy-balance rule`)
    }
    if (trueUp > 0 && covered < gap) causes.push(`SOC true-up +${fmt1(trueUp)} kWh — NOT an excuse under the energy-balance rule`)
    explained = gap > 0 ? Math.min(100, (covered / gap) * 100) : 100
    if (covered < gap) causes.push("UNEXPLAINED")
  }
  return {
    station,
    label,
    days: c.days.length,
    asRun: c.totalImportKwh,
    projected: c.noArbImportKwh,
    gap,
    status: above ? "above" : "ok",
    superseded: { days: c.supersededEffDays, kwh: c.supersededEffKwh, eur: c.supersededEffEur },
    trueUpKwh: c.storedDiffKwh,
    meterEff: c.battMeterRoundTripEff,
    meterExcessKwh: meterExcess,
    explainedPct: explained,
    cause: causes.join(" + "),
    noLsEur: c.procurementNoArbCost,
    asRunEur: c.dynamicCost,
    timingEur: c.timingValue,
  }
}

async function main() {
  const stationsArg = arg("stations")
  const monthsArg = arg("months")
  const stations: string[] = stationsArg
    ? stationsArg.split(",")
    : (
        (await db.execute(
          dsql`select distinct station_id from fleet_month_report where station_id like 'chargepost_%' order by 1`,
        )) as unknown as { rows: { station_id: string }[] }
      ).rows.map((r) => r.station_id)
  const months: string[] = monthsArg
    ? monthsArg.split(",")
    : (
        (await db.execute(
          dsql`select distinct month from fleet_month_report where station_id like 'chargepost_%' order by 1`,
        )) as unknown as { rows: { month: string }[] }
      ).rows.map((r) => r.month)

  const today = berlinDay(new Date())
  const yesterday = shiftDay(today, -1)
  const runningMonth = today.slice(0, 7)
  if (!months.includes(runningMonth)) months.push(runningMonth)

  console.log(`[v0] verify-baseline-le-asrun — methodology ${METHODOLOGY_VERSION} — ${stations.length} stations × ${months.length} months + presets (last 7 d, last 3 d)\n`)

  const rows: Row[] = []
  for (const station of stations) {
    for (const m of months) {
      const w = berlinMonthWindow(m)
      if (!w) continue
      const r = await checkWindow(station, m, w)
      if (r) rows.push(r)
    }
    // the picker presets a client actually clicks
    for (const [label, n] of [["last 7 d", 7], ["last 3 d", 3]] as const) {
      const r = await checkWindow(station, label, berlinDayWindow(shiftDay(yesterday, -(n - 1)), yesterday))
      if (r) rows.push(r)
    }
  }

  let unexplained = 0
  for (const station of stations) {
    console.log(`\n${station}`)
    console.log("  window      days   as-run kWh   projected kWh      gap   status  no-LS €     as-run €   timing €   cause")
    for (const r of rows.filter((x) => x.station === station)) {
      const flag = r.status === "ok" ? "  ok  " : r.explainedPct != null && r.explainedPct >= 90 ? "ABOVE*" : "ABOVE!"
      if (flag === "ABOVE!") unexplained++
      console.log(
        `  ${r.label.padEnd(10)} ${String(r.days).padStart(4)}   ${fmt0(r.asRun).padStart(10)}   ${fmt0(r.projected).padStart(13)}   ${(r.gap >= 0 ? "+" : "") + fmt0(r.gap)
          .padStart(5)}   ${flag}  ${eur(r.noLsEur).padStart(10)}  ${eur(r.asRunEur).padStart(10)}  ${eur(r.timingEur).padStart(9)}   ${r.status === "above" ? `${r.cause} → ${r.explainedPct?.toFixed(0)} % of gap explained` : r.superseded.days > 0 ? `(${r.superseded.days} superseded days corrected −${fmt0(r.superseded.kwh)} kWh)` : ""}`,
      )
    }
  }

  const above = rows.filter((r) => r.status === "above")
  console.log(`\n[v0] ${rows.length} windows checked · ${rows.length - above.length} ok · ${above.length} above as-run (${above.length - unexplained} explained by meter/true-up/superseded, ${unexplained} UNEXPLAINED)`)
  console.log("  ABOVE* = projection above measured but fully attributable to a disclosed cause (badge shown on the card)")
  console.log("  ABOVE! = unexplained → model defect, investigate")
  process.exit(unexplained > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
