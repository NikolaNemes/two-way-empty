/**
 * PROOF: a report window served from frozen daily rollups equals the same
 * window replayed from raw frames — for EVERY number the client sees
 * (import, EV delivered, AUX, flat/dynamic cost, grid-first counterfactual,
 * timing value, wear, net saving, sessions, throughput).
 *
 * Background (Gronau defect report, sep 2 2026): the old rollup stitch only
 * carried priced import, so months past the raw window lost the counterfactual
 * (→ "Dynamic no-dispatch 0"), showed negative timing value and ~1/3 of the
 * sessions. This script is the regression gate for the lossless rollup.
 *
 * What it does
 *   1. RAW TRUTH  — delete the window's rollup rows, then runBacktestForRange
 *                   (per-UTC-day raw replay — the atomic unit every page uses)
 *                   + the tariff engine (compute) on top.
 *   2. ROLLUP     — force re-freeze every full UTC day inside the window with
 *                   the lossless writer, then runBacktestForRange (which now
 *                   serves those days from station_day_report and raw-replays
 *                   only the partial head/tail) + the same tariff engine.
 *   3. COMPARE    — relative error per metric must be ≤ TOL (default 0.5 %).
 *
 * Run (env from /vercel/share/.env.project):
 *   set -a && source /vercel/share/.env.project && set +a && \
 *   NODE_OPTIONS=--conditions=react-server pnpm exec tsx \
 *     scripts/verify-rollup-lossless.ts [stationId] [fromBerlinDay] [toBerlinDay] [tolPct]
 *
 * Defaults: chargepost_norderstedt_001, 3 closed Berlin days ending yesterday, 0.5 %.
 */
import { db } from "../lib/db"
import { modelVersion, stationDayReport } from "../lib/db/schema"
import { and, desc, eq, gte, lte } from "drizzle-orm"
import { loadFramesFromDb, runBacktest } from "../lib/backtest"
import { rollupStationDay } from "../lib/rollup"
import { runBacktestForRange, type RangeBacktestResult } from "../app/actions/backtest"
import { getIdmPricesForRange } from "../app/actions/idm-prices"
import { compute, DEFAULT_CYCLING_CT, DEFAULT_FLAT_CT, type Computed } from "../lib/tariff-compute"
import { GRID_REAL_POWER_CAP_KW } from "../lib/dispatch-kernel"
import type { KernelParams } from "../lib/model-registry"

const ADDER_CT = 2 // any fixed adder — must cancel out identically on both paths

function berlinOffsetHours(day: string): number {
  // CEST (UTC+2) roughly Apr–Oct, CET (UTC+1) otherwise — good enough for
  // picking a window edge; the SAME edge is used on both paths anyway.
  const m = Number(day.slice(5, 7))
  return m >= 4 && m <= 10 ? 2 : 1
}

function berlinWindow(fromDay: string, toDay: string): { fromTs: Date; toTs: Date } {
  const fromTs = new Date(Date.parse(`${fromDay}T00:00:00Z`) - berlinOffsetHours(fromDay) * 3_600_000)
  const toTs = new Date(Date.parse(`${toDay}T00:00:00Z`) + 86_400_000 - berlinOffsetHours(toDay) * 3_600_000 - 1)
  return { fromTs, toTs }
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function rel(a: number, b: number): number {
  const den = Math.max(Math.abs(a), Math.abs(b), 1e-9)
  return Math.abs(a - b) / den
}

function pick(c: Computed | null, r: RangeBacktestResult) {
  return {
    "Grid import kWh": c?.totalImportKwh ?? r.totals.actualImportKwh,
    "EV delivered kWh (C1+C2)": (r.totals.mEv1Kwh ?? 0) + (r.totals.mEv2Kwh ?? 0),
    "EV demand kWh (kernel)": r.totals.evKwh,
    "AUX kWh": r.totals.auxKwh ?? 0,
    "Flat cost €": c?.flatCost ?? 0,
    "Dynamic cost €": c?.dynamicCost ?? 0,
    "Dynamic no-dispatch import kWh": c?.noArbImportKwh ?? 0,
    "Dynamic no-dispatch cost €": c?.procurementNoArbCost ?? 0,
    "Timing value €": c?.timingValue ?? 0,
    "Wear (dispatch) €": c?.wearWithArb ?? 0,
    "Wear (no-dispatch) €": c?.wearNoArb ?? 0,
    "Net saving €": c?.netSaving ?? 0,
    "Battery throughput kWh": r.kpis.batteryThroughputKwh,
    "Sessions (count)": r.sessions.length,
    "Sessions energy kWh": r.sessions.reduce((s, x) => s + x.energyKwh, 0),
    "Kernel savings €": r.kpis.savingsEur,
  }
}

async function main() {
  const stationId = process.argv[2] ?? "chargepost_norderstedt_001"
  const yesterday = utcDay(new Date(Date.now() - 86_400_000))
  const toDay = process.argv[4] ?? utcDay(new Date(Date.parse(`${yesterday}T00:00:00Z`) - 86_400_000))
  const fromDay = process.argv[3] ?? utcDay(new Date(Date.parse(`${toDay}T00:00:00Z`) - 2 * 86_400_000))
  const tol = Number(process.argv[5] ?? "0.5") / 100

  const { fromTs, toTs } = berlinWindow(fromDay, toDay)
  console.log(`[v0] station ${stationId} | Berlin days ${fromDay}..${toDay} | UTC ${fromTs.toISOString()} → ${toTs.toISOString()}`)

  const def = await db.select().from(modelVersion).orderBy(desc(modelVersion.isDefault), modelVersion.id).limit(1)
  if (def.length === 0) throw new Error("no model version")
  const params = def[0].params as KernelParams

  const idm = await getIdmPricesForRange({ fromIso: fromTs.toISOString(), toIso: toTs.toISOString() })
  const idmBySlot = new Map<number, number>(idm.prices.map((p) => [p.slot, p.priceEurMwh]))
  const tariff = (r: RangeBacktestResult) =>
    compute(r, idmBySlot, DEFAULT_FLAT_CT, ADDER_CT, DEFAULT_CYCLING_CT, GRID_REAL_POWER_CAP_KW)

  const frames = await loadFramesFromDb(stationId, fromTs, toTs)
  if (frames.length === 0) throw new Error("no stored frames in window — pick a window inside raw retention")

  const MS_DAY = 86_400_000
  const firstFull = fromTs.getTime() % MS_DAY === 0 ? fromTs.getTime() : (Math.floor(fromTs.getTime() / MS_DAY) + 1) * MS_DAY
  const lastFull = Math.floor((toTs.getTime() + 1) / MS_DAY) * MS_DAY - MS_DAY
  const days: string[] = []
  for (let t = firstFull; t <= lastFull; t += MS_DAY) days.push(utcDay(new Date(t)))

  // 1. RAW TRUTH — the report path with NO rollups for these days (per-UTC-day
  // raw replay, the atomic unit every page uses since sep 2 2026).
  await db
    .delete(stationDayReport)
    .where(and(eq(stationDayReport.stationId, stationId), gte(stationDayReport.day, days[0]), lte(stationDayReport.day, days[days.length - 1])))
  const raw = await runBacktestForRange({ stationId, fromIso: fromTs.toISOString(), toIso: toTs.toISOString() })
  if (raw.rollup) throw new Error("raw truth unexpectedly used rollups")
  const rawC = tariff(raw)
  console.log(
    `[v0] raw (per-day replay): ${frames.length} frames, ${raw.sessions.length} sessions, import ${raw.totals.actualImportKwh.toFixed(1)} kWh, rawSegments=${rawC?.rawSegments ?? 0}`,
  )

  // Informational: one continuous MPC run over the whole window (legacy
  // behaviour, NOT the truth any more — state carried across midnight).
  const contRun = await runBacktest({ stationId, fromTs, toTs, frames, paramOverride: params })
  console.log(
    `[v0] continuous run (info only): throughput ${contRun.kpis.batteryThroughputKwh.toFixed(1)} kWh, kernel savings ${contRun.kpis.savingsEur.toFixed(2)} €`,
  )

  // 2. ROLLUP — force re-freeze every FULL UTC day inside the window
  console.log(`[v0] re-freezing ${days.length} full UTC day(s): ${days.join(", ")}`)
  for (const d of days) {
    const r = await rollupStationDay(stationId, d, { force: true })
    if (!r.ok) throw new Error(`rollup ${d} failed: ${r.error}`)
    console.log(`[v0]   ${d}: ${r.frames} frames${r.skipped ? ` (skipped: ${r.skipped})` : ""}`)
  }
  const rolled = await runBacktestForRange({ stationId, fromIso: fromTs.toISOString(), toIso: toTs.toISOString() })
  const rolledC = tariff(rolled)
  console.log(
    `[v0] rolled: source=${rolled.frameSource ?? "raw"} rollupDays=${rolled.rollup?.days ?? 0} lossless=${rolled.rollup?.losslessDays ?? 0} legacy=${rolled.rollup?.legacyDays ?? 0} rawSegments=${rolledC?.rawSegments ?? 0} sessions=${rolled.sessions.length}`,
  )
  if (!rolled.rollup || rolled.rollup.days !== days.length) {
    throw new Error(`expected ${days.length} rollup days on the read path, got ${rolled.rollup?.days ?? 0}`)
  }

  // 3. COMPARE
  const a = pick(rawC, raw)
  const b = pick(rolledC, rolled)
  let worst = 0
  let fail = false
  console.log("\nmetric".padEnd(36) + "raw".padStart(14) + "rollup".padStart(14) + "rel err".padStart(10))
  for (const k of Object.keys(a) as (keyof typeof a)[]) {
    const e = rel(a[k], b[k])
    worst = Math.max(worst, e)
    // Small absolute values (< 1 unit) are compared absolutely: a €0.30 vs
    // €0.31 difference is noise, not a 3 % defect.
    const small = Math.max(Math.abs(a[k]), Math.abs(b[k])) < 1
    const ok = small ? Math.abs(a[k] - b[k]) <= 0.05 : e <= tol
    if (!ok) fail = true
    console.log(
      `${k.padEnd(35)}${a[k].toFixed(2).padStart(14)}${b[k].toFixed(2).padStart(14)}${(e * 100).toFixed(3).padStart(9)}%${ok ? "" : "  <-- FAIL"}`,
    )
  }
  console.log(`\nworst rel err ${(worst * 100).toFixed(3)} % (tol ${(tol * 100).toFixed(2)} %)`)
  console.log(fail ? "FAIL" : "PASS")
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error("FAIL:", e)
  process.exit(1)
})
