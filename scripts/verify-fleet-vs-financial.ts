/**
 * VERIFY: Financial Report == Fleet Monthly == Fleet Yearly, per station.
 *
 * Client requirement (sep 3 2026): "the calculation method per location must be
 * the same in the fleet reports and the financial report; the numbers must
 * always match." This script proves it on REAL data, for every live station
 * and every closed live month:
 *
 *   1. LIVE  — settleStationRange(station, 1st → last day of month): what the
 *              Financial Report page renders when you pick that month.
 *   2. FROZEN — the fleet_month_report row the Fleet Monthly page shows
 *              (written by fillLiveFleetMonth through the same function).
 *   3. YEARLY — getFleetYearlyReport().stations[station] must equal Σ frozen
 *              rows (it never re-prices).
 *
 * PASS iff every compared euro agrees to the cent. A mismatch on (1)≠(2) means
 * a stale frozen row (re-run the cron / `?one=yyyy-mm`); on (2)≠(3) a summing
 * bug in the yearly action.
 *
 * Run: NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/verify-fleet-vs-financial.ts [yyyy-mm]
 * (env sourced from /vercel/share/.env.project)
 */
import { and, eq, notLike } from "drizzle-orm"
import { db } from "../lib/db"
import { fleetMonthReport, stations } from "../lib/db/schema"
import { liveFleetMonths, METHODOLOGY_VERSION } from "../lib/fleet-report-builder"
import { berlinMonthWindow } from "../lib/report-window"
import { settleStationRange } from "../app/actions/settlement"
import { getFleetYearlyReport } from "../app/actions/fleet-yearly"

const CENT = 0.005
const fmt = (v: number) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2)

/**
 * Every euro column printed on the Fleet Monthly / Fleet Yearly tables and on
 * the Financial Report blocks. ALL of them must agree — not just net/LS — so a
 * component (e.g. "wear without load shifting") can never drift while the
 * headline still reconciles.
 */
const MONEY_KEYS = [
  "flatEur",
  "noShiftEur",
  "asRunEur",
  "procSavingEur",
  "wearNoShiftEur",
  "wearAsRunEur",
  "wearEur",
  "netEur",
  "lsEur",
  "timingEur",
] as const
type MoneyKey = (typeof MONEY_KEYS)[number]
type MoneyVec = Record<MoneyKey, number>
const zeroVec = (): MoneyVec => Object.fromEntries(MONEY_KEYS.map((k) => [k, 0])) as MoneyVec

async function main() {
  const only = process.argv[2]
  const months = only ? [only] : liveFleetMonths(false) // closed months only
  const live = await db
    .select({ stationId: stations.stationId, name: stations.name })
    .from(stations)
    .where(and(notLike(stations.stationId, "hist_%"), eq(stations.enabled, true)))

  let checked = 0
  let failures = 0
  const sumByStation = new Map<string, { sum: MoneyVec; months: number }>()

  for (const month of months) {
    const win = berlinMonthWindow(month)
    if (!win) continue
    console.log(`\n[v0] ── ${month}  window ${win.fromDay} → ${win.toDay} (${win.days} d)  ${win.fromIso} → ${win.toIso}`)
    for (const st of live) {
      const [frozen] = await db
        .select()
        .from(fleetMonthReport)
        .where(and(eq(fleetMonthReport.stationId, st.stationId), eq(fleetMonthReport.month, month)))
        .limit(1)
      const s = await settleStationRange({ stationId: st.stationId, fromDay: win.fromDay, toDay: win.toDay })
      const f = s.figures

      if (!frozen && !f) {
        console.log(`  ${st.stationId.padEnd(14)} no data on either side (${s.reason})`)
        continue
      }
      checked++
      if (!frozen || !f) {
        failures++
        console.log(
          `  ${st.stationId.padEnd(14)} FAIL  one side missing — frozen:${frozen ? "yes" : "no"} live:${f ? "yes" : s.reason}`,
        )
        continue
      }
      // A frozen row with NULL wear bases (written before 2026-09-03) is a
      // FAIL: the table would print "—" where the Financial Report prints a euro.
      const missing = MONEY_KEYS.filter((k) => frozen[k] == null)
      const diffs = Object.fromEntries(
        MONEY_KEYS.map((k) => [k, frozen[k] == null ? Number.POSITIVE_INFINITY : Math.abs((frozen[k] as number) - f[k])]),
      ) as MoneyVec
      const worst = (Object.entries(diffs) as [MoneyKey, number][]).sort((a, b) => b[1] - a[1])[0]
      const ok = worst[1] < CENT && frozen.methodologyVersion === METHODOLOGY_VERSION
      const recon = s.reconciliation
      const reconOk = recon?.matches === true
      if (!ok || !reconOk) failures++
      console.log(
        `  ${st.stationId.padEnd(14)} ${ok && reconOk ? "ok  " : "FAIL"}  net ${fmt(frozen.netEur)}/${fmt(f.netEur)}` +
          ` · flat ${fmt(f.flatEur)} noLS ${fmt(f.noShiftEur)} asRun ${fmt(f.asRunEur)}` +
          ` · wear noLS ${fmt(f.wearNoShiftEur)} asRun ${fmt(f.wearAsRunEur)} extra ${fmt(f.wearEur)}` +
          ` · worst Δ ${worst[0]} ${Number.isFinite(worst[1]) ? worst[1].toFixed(4) : "NULL"} €` +
          (missing.length ? ` · frozen NULL: ${missing.join(",")}` : "") +
          ` · method ${frozen.methodologyVersion}${frozen.methodologyVersion !== METHODOLOGY_VERSION ? " (STALE)" : ""}` +
          ` · page badge ${recon ? (reconOk ? "match" : `mismatch Δ${recon.maxDiffEur?.toFixed(2)}`) : "none"}`,
      )
      const acc = sumByStation.get(st.stationId) ?? { sum: zeroVec(), months: 0 }
      for (const k of MONEY_KEYS) acc.sum[k] += (frozen[k] as number | null) ?? 0
      acc.months++
      sumByStation.set(st.stationId, acc)
    }
  }

  // Yearly == Σ frozen months. Bound the yearly to exactly the months verified
  // above (the default yearly range also includes the running month, whose row
  // is refreshed nightly and is not part of the closed-month proof).
  if (!only && months.length > 0) {
    const fromMonth = months[0]
    const toMonth = months[months.length - 1]
    console.log(`\n[v0] ── Fleet Yearly (${fromMonth} → ${toMonth}) vs Σ Fleet Monthly rows`)
    const y = await getFleetYearlyReport({ dataset: "live", fromMonth, toMonth })
    const fleetSum = zeroVec()
    for (const ys of y.stations) {
      const acc = sumByStation.get(ys.stationId)
      if (!acc) continue
      for (const k of MONEY_KEYS) fleetSum[k] += acc.sum[k]
      if (ys.months !== acc.months) {
        failures++
        console.log(`  ${ys.stationId.padEnd(14)} FAIL  yearly covers ${ys.months} months, verified set ${acc.months}`)
        continue
      }
      // Every printed column on the Station totals row must be the exact Σ of
      // that station's frozen monthly rows — including both wear bases.
      const diffs = (Object.entries(acc.sum) as [MoneyKey, number][]).map(([k, v]) => {
        const yv = (ys as unknown as Record<string, number | null>)[k]
        return [k, yv == null ? Number.POSITIVE_INFINITY : Math.abs(yv - v)] as [MoneyKey, number]
      })
      const worst = diffs.sort((a, b) => b[1] - a[1])[0]
      const ok = worst[1] < CENT
      if (!ok) failures++
      console.log(
        `  ${ys.stationId.padEnd(14)} ${ok ? "ok  " : "FAIL"}  net yearly ${fmt(ys.netEur)} Σmonthly ${fmt(acc.sum.netEur)}` +
          ` · wear noLS ${fmt(ys.wearNoShiftEur ?? Number.NaN)} asRun ${fmt(ys.wearAsRunEur ?? Number.NaN)}` +
          ` · worst Δ ${worst[0]} ${Number.isFinite(worst[1]) ? worst[1].toFixed(4) : "NULL"} €`,
      )
    }
    const tot = y.totals as unknown as Record<string, number | null>
    const totWorst = MONEY_KEYS.map((k) => [k, tot[k] == null ? Number.POSITIVE_INFINITY : Math.abs((tot[k] as number) - fleetSum[k])] as [MoneyKey, number])
      .sort((a, b) => b[1] - a[1])[0]
    if (totWorst[1] >= CENT) failures++
    console.log(
      `  ${"FLEET TOTAL".padEnd(14)} ${totWorst[1] < CENT ? "ok  " : "FAIL"}  net yearly ${fmt(y.totals.netEur)} Σrows ${fmt(fleetSum.netEur)}` +
        ` · worst Δ ${totWorst[0]} ${Number.isFinite(totWorst[1]) ? totWorst[1].toFixed(4) : "NULL"} €`,
    )
  }

  console.log(`\n[v0] checked ${checked} station-months · failures ${failures}`)
  console.log(failures === 0 ? "PASS" : "FAIL")
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("FAIL:", e)
  process.exit(1)
})
