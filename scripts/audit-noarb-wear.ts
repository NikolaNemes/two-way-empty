/**
 * AUDIT-NOARB-WEAR — empirical double-check of the Financial Report's
 * no-arbitrage battery-wear counterfactual.
 * ════════════════════════════════════════════════════════════════════════
 *
 * QUESTION (user): "estimated wear cost with no optimizer looks too low —
 * the battery is barely used and almost all EV demand is served from grid."
 *
 * The report's counterfactual is GRID-FIRST: battery discharges ONLY when
 * EV demand exceeds available grid headroom (site cap − baseload). This
 * script quantifies, on the REAL data the report uses:
 *   1. The EV demand distribution vs the grid headroom (how often is the
 *      battery actually FORCED to help?)
 *   2. The report-style noArb throughput on the downsampled series (exact
 *      replication of the report's math).
 *   3. The same computation at FULL frame resolution (via the KPI-grade
 *      un-downsampled path) to expose any stride-sampling bias.
 *   4. The as-run (with-arbitrage) throughput for scale.
 *
 * Run:  NODE_OPTIONS="--conditions=react-server" npx -y tsx scripts/audit-noarb-wear.ts
 */

import { runBacktest } from "../lib/backtest"
import { db } from "../lib/db"
import { modelVersion } from "../lib/db/schema"
import { desc } from "drizzle-orm"
import type { KernelParams } from "../lib/model-registry"
import { DEFAULT_STATION_ID } from "../lib/amperio-api"
const GRID_CAP_KW = 87

function pct(n: number, d: number) {
  return d > 0 ? ((n / d) * 100).toFixed(1) + "%" : "n/a"
}

async function main() {
  // Use the most recent 7 days of ACTUALLY STORED frames (the DB window can
  // trail "now"), so the audit runs on the same data the report renders.
  const { telemetryFrame } = await import("../lib/db/schema")
  const { max } = await import("drizzle-orm")
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

  const series = result.series
  if (!series || series.length === 0) throw new Error("empty series")

  console.log(`window: ${fromTs.toISOString()} → ${toTs.toISOString()}`)
  console.log(`series points: ${series.length} (downsampled to ≤600)`)

  // ── 1. EV demand distribution vs grid headroom ─────────────────────────
  const evVals = series.map((p) => Math.max(0, p.evKw ?? 0))
  const sorted = [...evVals].sort((a, b) => a - b)
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))]
  const evMax = sorted[sorted.length - 1]
  const framesCharging = evVals.filter((v) => v > 1).length

  let framesSurplus = 0
  let surplusKwhSeries = 0
  let evEnergyKwh = 0
  let baseSum = 0

  // Median-gap dt, exactly like the report.
  const gaps: number[] = []
  for (let i = 1; i < series.length; i++) {
    const g = series[i].hour - series[i - 1].hour
    if (g > 0) gaps.push(g)
  }
  gaps.sort((a, b) => a - b)
  const medianGapH = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 0.25
  const maxDtH = Math.min(6, Math.max(0.5, 2 * medianGapH))

  for (let i = 0; i < series.length; i++) {
    const p = series[i]
    let dtH = medianGapH
    if (i > 0) dtH = Math.min(maxDtH, Math.max(0, p.hour - series[i - 1].hour))
    const capKw = p.siteGridLimitKw != null && p.siteGridLimitKw > 0 ? p.siteGridLimitKw : GRID_CAP_KW
    const baseKw = Math.max(0, p.baseloadKw ?? 0)
    const gridAvail = Math.max(0, capKw - baseKw)
    const evKw = Math.max(0, p.evKw ?? 0)
    evEnergyKwh += evKw * dtH
    baseSum += baseKw
    const surplus = Math.max(0, evKw - gridAvail)
    if (surplus > 0) framesSurplus++
    surplusKwhSeries += surplus * dtH
  }

  console.log(`\n── EV demand vs grid headroom (downsampled series) ──`)
  console.log(`evKw: max=${evMax.toFixed(1)}  p95=${q(0.95).toFixed(1)}  p75=${q(0.75).toFixed(1)}  median=${q(0.5).toFixed(1)} kW`)
  console.log(`frames with EV charging (>1 kW): ${framesCharging}/${series.length} (${pct(framesCharging, series.length)})`)
  console.log(`avg baseload: ${(baseSum / series.length).toFixed(1)} kW → typical headroom ≈ ${(GRID_CAP_KW - baseSum / series.length).toFixed(1)} kW`)
  console.log(`frames where EV demand EXCEEDS headroom: ${framesSurplus}/${series.length} (${pct(framesSurplus, series.length)})`)
  console.log(`EV energy total: ${evEnergyKwh.toFixed(0)} kWh`)
  console.log(`EV energy above headroom (forced battery serve): ${surplusKwhSeries.toFixed(1)} kWh (${pct(surplusKwhSeries, evEnergyKwh)} of EV energy)`)
  console.log(`report-style noArb throughput (×2 round-trip): ${(2 * surplusKwhSeries).toFixed(1)} kWh`)

  // ── 2. As-run comparison ────────────────────────────────────────────────
  const kpiThru = result.kpis?.batteryThroughputKwh ?? 0
  console.log(`\n── As-run (with arbitrage) ──`)
  console.log(`KPI battery throughput (full-res): ${kpiThru.toFixed(1)} kWh`)
  console.log(`→ noArb/withArb throughput ratio: ${pct(2 * surplusKwhSeries, kpiThru)}`)

  // ── 3. Stride-sampling bias check: recompute surplus on FULL resolution ──
  // The series keeps every Nth frame (~16.5 min apart on a 7-day window), so
  // short EV bursts above headroom between kept frames are invisible to the
  // report. Integrate the same surplus over EVERY stored 15s frame via SQL.
  const { telemetryFrame: tf } = await import("../lib/db/schema")
  const { sql: dsql } = await import("drizzle-orm")
  const fullRes = await db.execute(dsql`
    WITH f AS (
      SELECT
        ts,
        GREATEST(COALESCE(ev_load_w, 0) / 1000.0, 0) AS ev_kw,
        CASE WHEN COALESCE(grid_import_limit_w, 0) > 0
             THEN grid_import_limit_w / 1000.0 ELSE ${GRID_CAP_KW} END AS cap_kw,
        EXTRACT(EPOCH FROM (LEAD(ts) OVER (ORDER BY ts) - ts)) / 3600.0 AS dt_h
      FROM telemetry_frame
      WHERE station_id = ${DEFAULT_STATION_ID}
        AND ts >= ${fromTs.toISOString()}::timestamptz
        AND ts <  ${toTs.toISOString()}::timestamptz
    )
    SELECT
      COUNT(*)::int                                         AS frames,
      MAX(ev_kw)::float                                     AS peak_ev_kw,
      SUM(ev_kw * LEAST(COALESCE(dt_h, 0.0042), 0.01))::float AS ev_energy_kwh,
      SUM(GREATEST(ev_kw - cap_kw, 0) * LEAST(COALESCE(dt_h, 0.0042), 0.01))::float AS surplus_kwh,
      COUNT(*) FILTER (WHERE ev_kw > cap_kw)::int           AS surplus_frames
    FROM f
  `)
  const fr = (fullRes as unknown as { rows: Record<string, unknown>[] }).rows?.[0] ?? (fullRes as unknown as Record<string, unknown>[])[0]
  const fullSurplus = Number(fr.surplus_kwh ?? 0)
  const fullEvEnergy = Number(fr.ev_energy_kwh ?? 0)
  console.log(`\n── Stride-bias probe (FULL resolution, ${fr.frames} frames) ──`)
  console.log(`full-res peak EV: ${Number(fr.peak_ev_kw).toFixed(1)} kW  (series saw ${evMax.toFixed(1)} kW)`)
  console.log(`full-res EV energy: ${fullEvEnergy.toFixed(0)} kWh (series integrated ${evEnergyKwh.toFixed(0)} kWh)`)
  console.log(`full-res surplus above cap: ${fullSurplus.toFixed(1)} kWh in ${fr.surplus_frames} frames`)
  console.log(`full-res noArb throughput (×2): ${(2 * fullSurplus).toFixed(1)} kWh`)
  console.log(`series-based noArb throughput:  ${(2 * surplusKwhSeries).toFixed(1)} kWh`)
  const bias = 2 * surplusKwhSeries - 2 * fullSurplus
  console.log(`→ stride bias: ${bias >= 0 ? "+" : ""}${bias.toFixed(1)} kWh (${pct(Math.abs(bias), 2 * fullSurplus)} of full-res)`)
  void tf

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
