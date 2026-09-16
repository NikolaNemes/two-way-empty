/**
 * AUDIT-THROUGHPUT — is the Financial Report's battery-wear cost driven by a
 * correctly measured throughput, or is it inflated?
 * ════════════════════════════════════════════════════════════════════════
 *
 * QUESTION (user): "wear cost in the financial breakdown looks suspiciously
 * big — are we sure we're calculating battery throughput properly?"
 *
 * The report's wear = batteryThroughputKwh × cyclingCt, where
 *   batteryThroughputKwh = Σ |battKw|·dt over EVERY frame (charge + discharge).
 *
 * Two ways this can look "too big":
 *   (A) DOUBLE-COUNT vs the rate: the rate (3.5 ct/kWh) is PER DIRECTION, and
 *       throughput counts BOTH directions — so a round trip is priced twice.
 *       That is INTERNALLY CONSISTENT with the optimizer's own degradation
 *       cost (CYCLE_COST_EUR_PER_MWH_PER_DIRECTION), but this script prints
 *       the per-discharged-kWh equivalent so the magnitude is legible.
 *   (B) CHURN: if the simulated battKw oscillates frame-to-frame (noise, aux
 *       fluctuation), Σ|battKw|·dt balloons while net SOC barely moves. We
 *       detect this by comparing the full-res KPI throughput to the throughput
 *       implied by the (coarser) SOC trajectory and to net cycling.
 *
 * Run: NODE_OPTIONS="--conditions=react-server" npx -y tsx scripts/audit-throughput.ts
 */

import { runBacktest } from "../lib/backtest"
import { db } from "../lib/db"
import { modelVersion, telemetryFrame } from "../lib/db/schema"
import { desc, max } from "drizzle-orm"
import type { KernelParams } from "../lib/model-registry"
import { DEFAULT_STATION_ID } from "../lib/amperio-api"

const CYCLING_CT = 3.5 // report default, ct/kWh of throughput

async function main() {
  const latest = await db.select({ ts: max(telemetryFrame.ts) }).from(telemetryFrame)
  const lastTs = latest[0]?.ts ? new Date(latest[0].ts) : new Date()
  const toTs = lastTs
  const fromTs = new Date(toTs.getTime() - 7 * 24 * 3600 * 1000)

  const def = await db
    .select()
    .from(modelVersion)
    .orderBy(desc(modelVersion.isDefault), modelVersion.id)
    .limit(1)
  if (def.length === 0) throw new Error("no default model version")
  const params = def[0].params as KernelParams

  const result = await runBacktest({
    stationId: DEFAULT_STATION_ID,
    fromTs,
    toTs,
    paramOverride: params,
  })

  const k = result.kpis
  const series = result.series ?? []
  const throughput = k?.batteryThroughputKwh ?? 0
  const cycles = k?.batteryCycles ?? 0
  // Capacity isn't exposed on the result; back-solve it from the KPI identity
  // batteryCycles = throughput / (2 · usableCap).
  const capKwh = cycles > 0 ? throughput / (2 * cycles) : 0
  const hours = k?.durationHours ?? 0
  const days = hours / 24

  console.log(`\nwindow: ${fromTs.toISOString()} → ${toTs.toISOString()}`)
  console.log(`frames: ${k?.frames}  duration: ${hours.toFixed(1)} h (${days.toFixed(2)} d)`)
  console.log(`usable capacity (both packs): ${capKwh.toFixed(1)} kWh`)
  console.log(`SOC min/avg/max: ${k?.socMinPct}/${k?.socAvgPct}/${k?.socMaxPct} %`)

  console.log(`\n── As-run throughput (drives wearWithArb) ──`)
  console.log(`batteryThroughputKwh (Σ|battKw|·dt, charge+discharge): ${throughput.toFixed(1)} kWh`)
  console.log(`equivalent full cycles (÷ 2·cap): ${cycles.toFixed(2)}  → ${(cycles / days).toFixed(2)} cycles/day`)
  console.log(`discharge-only (~throughput/2): ${(throughput / 2).toFixed(1)} kWh`)

  const wear = throughput * (CYCLING_CT / 100)
  console.log(`\n── Wear cost @ ${CYCLING_CT} ct/kWh throughput ──`)
  console.log(`wearWithArb = ${throughput.toFixed(1)} × ${CYCLING_CT}ct = €${wear.toFixed(2)}`)
  console.log(`per-discharged-kWh equivalent: ${(2 * CYCLING_CT).toFixed(1)} ct/kWh discharged`)
  console.log(`€/day: €${(wear / days).toFixed(2)}`)

  // ── CHURN probe: throughput implied by the SOC trajectory ──
  // Σ|ΔSOC| over the (downsampled) series × cap is a LOWER bound on true
  // throughput; if the KPI throughput is wildly larger, the sim is oscillating
  // between the sampled points. If they're close, throughput ≈ real SOC travel.
  let socTravelFrac = 0
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]?.socPct
    const b = series[i]?.socPct
    if (typeof a === "number" && typeof b === "number") socTravelFrac += Math.abs(b - a) / 100
  }
  const socTravelKwh = socTravelFrac * capKwh
  console.log(`\n── Churn probe ──`)
  console.log(`SOC-trajectory travel (series, lower bound): ${socTravelKwh.toFixed(1)} kWh`)
  console.log(`KPI throughput / SOC-travel ratio: ${socTravelKwh > 0 ? (throughput / socTravelKwh).toFixed(2) : "n/a"}`)
  console.log(`(≈1 = throughput matches visible SOC movement; ≫1 = sub-sample oscillation inflating it)`)

  // Contextual scale: EV energy actually delivered in the window.
  const evKwh = result.totals?.optimizedImportKwh ?? 0
  console.log(`\n── Scale context ──`)
  console.log(`grid import (optimized): ${evKwh.toFixed(0)} kWh over ${days.toFixed(1)} d`)
  console.log(`throughput / import ratio: ${evKwh > 0 ? (throughput / evKwh).toFixed(2) : "n/a"}`)

  console.log(`\nVERDICT HINTS:`)
  console.log(`• cycles/day ≤ ~3 → normal arbitrage+peak-shave; ≥ ~5 → churny`)
  console.log(`• churn ratio ≈ 1–1.5 → throughput is real SOC travel, not noise`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
