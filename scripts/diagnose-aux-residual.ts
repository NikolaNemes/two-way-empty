/**
 * Decompose the "Auxiliary" (AUX) energy bucket from RAW telemetry_frame rows.
 *
 * Why: the frozen fleet_month_report.aux_kwh is NOT a metered quantity. In
 * lib/backtest.ts it is a per-frame RESIDUAL of the site power balance:
 *
 *     pbEv  = max(0, batt − grid)          // everything the AC bus feeds (EV + AUX + …)
 *     auxKw = max(0, pbEv − meteredEvKw)   // whatever the connector meters do not explain
 *
 * so it absorbs (a) genuine hotel/baseload, (b) battery/inverter round-trip
 * losses, (c) a one-sided rectification bias at session ramps (the per-frame
 * max(0,·) keeps positive meter/proxy misalignment and drops negative), and
 * (d) metering drift. This script measures each component independently.
 *
 * Usage:  NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/diagnose-aux-residual.ts 2026-08 [stationId]
 */
import { db } from "../lib/db"
import { sql, and, eq, notLike } from "drizzle-orm"
import { fleetMonthReport } from "../lib/db/schema"

const month = process.argv[2] ?? "2026-08"
const onlyStation = process.argv[3]
const [y, m] = month.split("-").map(Number)

const berlinOffsetH = (d: Date) => {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value
  return Number(s?.replace("GMT", "") || 0)
}
const edge = (yy: number, mm: number) => {
  const guess = new Date(Date.UTC(yy, mm - 1, 1, 0, 0, 0))
  return new Date(guess.getTime() - berlinOffsetH(guess) * 3_600_000).toISOString()
}
const fromIso = edge(y, m)
const toIso = edge(y, m + 1)

const f1 = (v: unknown) => (v == null ? "—" : Number(v).toFixed(1))
const f2 = (v: unknown) => (v == null ? "—" : Number(v).toFixed(2))

async function main() {
  const frozen = await db
    .select()
    .from(fleetMonthReport)
    .where(and(eq(fleetMonthReport.month, month), notLike(fleetMonthReport.stationId, "hist_%")))

  for (const row of frozen.sort((a, b) => a.stationId.localeCompare(b.stationId))) {
    if (onlyStation && row.stationId !== onlyStation) continue

    const r = await db.execute(sql`
      WITH win AS (SELECT ${fromIso}::timestamptz AS lo, ${toIso}::timestamptz AS hi),
      f AS (
        SELECT tf.ts, tf.grid_power_w AS g, tf.batt_power_w AS b, tf.soc_avg AS soc, tf.raw,
               LEAD(tf.ts) OVER (ORDER BY tf.ts) AS nts
        FROM telemetry_frame tf, win
        WHERE tf.station_id = ${row.stationId} AND tf.ts >= win.lo AND tf.ts < win.hi
      ),
      -- per-connector counter deltas → metered EV power at each frame (engine formula:
      -- d / backward window, window clamped ≥ 1 s)
      ctr AS (
        SELECT f.ts, e ->> 'unit_id' AS unit,
               (e ->> 'e_ev_chg_kwh')::float AS c,
               LAG((e ->> 'e_ev_chg_kwh')::float) OVER (PARTITION BY e ->> 'unit_id' ORDER BY f.ts) AS pc,
               LAG(f.ts) OVER (PARTITION BY e ->> 'unit_id' ORDER BY f.ts) AS pts
        FROM f, LATERAL jsonb_array_elements(COALESCE(f.raw -> 'chargers', '[]'::jsonb)) e
      ),
      mev AS (
        SELECT ts,
               SUM(GREATEST(c - pc, 0)) FILTER (WHERE ts - pts <= interval '10 minutes') AS d_kwh,
               SUM(GREATEST(c - pc, 0) / GREATEST(EXTRACT(EPOCH FROM (ts - pts)) / 3600.0, 1.0 / 3600.0))
                 FILTER (WHERE ts - pts <= interval '10 minutes') AS kw
        FROM ctr WHERE pc IS NOT NULL GROUP BY ts
      ),
      -- per-frame quantities in kW, dt in hours (gap to next frame, capped 5 min like the verifier)
      p AS (
        SELECT f.ts,
               LEAST(COALESCE(EXTRACT(EPOCH FROM (f.nts - f.ts)), 0), 300) / 3600.0 AS dt_h,
               GREATEST(-f.g, 0) / 1000.0 AS import_kw,
               GREATEST( f.g, 0) / 1000.0 AS export_kw,
               GREATEST(-f.b, 0) / 1000.0 AS chg_kw,
               GREATEST( f.b, 0) / 1000.0 AS dis_kw,
               GREATEST(COALESCE(f.b,0) - COALESCE(f.g,0), 0) / 1000.0 AS pbev_kw,
               COALESCE(mev.kw, 0) AS mev_kw,
               COALESCE(mev.d_kwh, 0) AS mev_kwh,
               f.b, f.soc
        FROM f LEFT JOIN mev USING (ts)
      ),
      agg AS (
        SELECT
          COUNT(*)::int                                   AS frames,
          SUM(dt_h)                                       AS hours,
          SUM(import_kw * dt_h)                           AS import_kwh,
          SUM(export_kw * dt_h)                           AS export_kwh,
          SUM(chg_kw * dt_h)                              AS chg_kwh,
          SUM(dis_kw * dt_h)                              AS dis_kwh,
          SUM(pbev_kw * dt_h)                             AS pbev_kwh,
          SUM(mev_kwh)                                    AS mev_kwh,
          -- engine's per-frame clamped AUX (what gets frozen)
          SUM(GREATEST(pbev_kw - mev_kw, 0) * dt_h)       AS aux_clamped_kwh,
          -- the part the clamp throws away (meter led the proxy)
          SUM(GREATEST(mev_kw - pbev_kw, 0) * dt_h)       AS rectified_away_kwh,
          -- pure hotel draw: both connectors idle AND battery resting (|b| < 500 W)
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pbev_kw)
            FILTER (WHERE mev_kw = 0 AND ABS(COALESCE(b,0)) < 500)   AS hotel_med_kw,
          AVG(pbev_kw) FILTER (WHERE mev_kw = 0 AND ABS(COALESCE(b,0)) < 500) AS hotel_avg_kw,
          SUM(dt_h)    FILTER (WHERE mev_kw = 0 AND ABS(COALESCE(b,0)) < 500) AS idle_hours,
          -- residual while battery is ACTIVE and no EV: isolates inverter/aux draw during cycling
          AVG(pbev_kw) FILTER (WHERE mev_kw = 0 AND ABS(COALESCE(b,0)) >= 500) AS residual_battactive_kw,
          SUM(dt_h)    FILTER (WHERE mev_kw = 0 AND ABS(COALESCE(b,0)) >= 500) AS battactive_hours,
          (ARRAY_AGG(soc ORDER BY ts ASC))[1]              AS soc_first,
          (ARRAY_AGG(soc ORDER BY ts DESC))[1]             AS soc_last
        FROM p
      )
      SELECT * FROM agg
    `)
    const a = r.rows[0] as Record<string, unknown>
    if (!a || Number(a.frames) === 0) {
      console.log(`\n== ${row.stationId} · ${month}: no raw frames in window (retention) — frozen aux ${f1(row.auxKwh)} kWh cannot be decomposed`)
      continue
    }

    const hours = Number(a.hours)
    const imp = Number(a.import_kwh), exp = Number(a.export_kwh)
    const chg = Number(a.chg_kwh), dis = Number(a.dis_kwh)
    const pbev = Number(a.pbev_kwh), mev = Number(a.mev_kwh)
    const auxClamped = Number(a.aux_clamped_kwh)
    const rectified = Number(a.rectified_away_kwh)
    const hotelMed = Number(a.hotel_med_kw), hotelAvg = Number(a.hotel_avg_kw)
    const battLoss = chg - dis // ≈ round-trip losses if SOC start≈end
    const residualEnergy = pbev - mev // unclamped residual = AUX + losses-on-this-side + drift
    const hotelKwh = hotelMed * hours

    console.log(`\n== ${row.stationId} · ${month}  (${a.frames} frames · ${hours.toFixed(1)} h covered)`)
    console.log(`  FROZEN  import ${f1(row.importKwh)}  evDelivered ${f1(row.evDeliveredKwh)}  aux ${f1(row.auxKwh)}  → ev+aux−import = ${f1(Number(row.evDeliveredKwh ?? 0) + Number(row.auxKwh ?? 0) - row.importKwh)}`)
    console.log(`  RAW     import ${f1(imp)}  export ${f1(exp)}  battChg ${f1(chg)}  battDis ${f1(dis)}  (chg−dis = ${f1(battLoss)} kWh; SOC ${f1(a.soc_first)}% → ${f1(a.soc_last)}%)`)
    console.log(`  RAW     AC-bus load Σpbev ${f1(pbev)}  metered EV Σctr ${f1(mev)}  → unclamped residual ${f1(residualEnergy)} kWh  (${f2(residualEnergy / hours)} kW avg)`)
    console.log(`  ENGINE  per-frame clamped AUX ${f1(auxClamped)} kWh   rectified-away ${f1(rectified)} kWh   (clamped − unclamped = +${f1(auxClamped - residualEnergy)})`)
    console.log(`  HOTEL   idle frames (no EV, |batt|<0.5kW): ${f1(a.idle_hours)} h · median ${f2(hotelMed)} kW · mean ${f2(hotelAvg)} kW  → ×${hours.toFixed(0)} h ≈ ${f1(hotelKwh)} kWh`)
    console.log(`  CYCLING residual while battery active & no EV: ${f2(a.residual_battactive_kw)} kW over ${f1(a.battactive_hours)} h  (inverter/BMS draw during cycling)`)
    console.log(`  DECOMP  aux ${f1(auxClamped)} ≈ hotel ${f1(hotelKwh)} + rectification ${f1(auxClamped - residualEnergy)} + other(losses/drift) ${f1(residualEnergy - hotelKwh)}`)
    console.log(`  BALANCE import + dis − chg − export = ${f1(imp + dis - chg - exp)}  vs  Σpbev ${f1(pbev)}   (Δ ${f1(imp + dis - chg - exp - pbev)} = clamp of negative pbev frames)`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
