/**
 * Independent cross-check of the frozen fleet_month_report VOLUMES against the
 * raw telemetry_frame table — deliberately NOT through lib/backtest.ts, so the
 * two paths can disagree.
 *
 *   • Grid import  = Σ max(grid_power_w, 0) · Δt   (Δt = gap to next frame, capped 5 min)
 *   • EV delivered = Σ over connectors of (max − min) of the per-connector
 *                    e_ev_chg_kwh counter per Berlin day (counter reset-safe by day)
 *   • Coverage     = Berlin days with ≥1 frame, first/last frame, largest gap
 *   • Sessions     = lib/charger-sessions.getChargerSessions (the same detector
 *                    the builder uses — no second implementation exists)
 *
 * Usage:  NODE_OPTIONS=--conditions=react-server pnpm exec tsx scripts/verify-volumes-from-frames.ts 2026-08
 */
import { db } from "../lib/db"
import { sql } from "drizzle-orm"
import { getChargerSessions } from "../lib/charger-sessions"
import { fleetMonthReport } from "../lib/db/schema"
import { and, eq, notLike } from "drizzle-orm"

const month = process.argv[2] ?? "2026-08"
const [y, m] = month.split("-").map(Number)
// Berlin month edges expressed in UTC (the settlement window is Berlin days).
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

async function main() {
  const frozen = await db
    .select()
    .from(fleetMonthReport)
    .where(and(eq(fleetMonthReport.month, month), notLike(fleetMonthReport.stationId, "hist_%")))

  for (const row of frozen.sort((a, b) => a.stationId.localeCompare(b.stationId))) {
    const r = await db.execute(sql`
      WITH win AS (
        SELECT ${fromIso}::timestamptz AS lo, ${toIso}::timestamptz AS hi
      ),
      f AS (
        -- Sign convention (chart legend "Grid import (below 0)"): import = −grid_power_w.
        SELECT tf.ts, tf.grid_power_w, tf.source, tf.raw,
               LEAD(tf.ts) OVER (ORDER BY tf.ts) AS nts
        FROM telemetry_frame tf, win
        WHERE tf.station_id = ${row.stationId} AND tf.ts >= win.lo AND tf.ts < win.hi
      ),
      d AS (
        SELECT (ts AT TIME ZONE 'Europe/Berlin')::date AS day,
               SUM(GREATEST(-grid_power_w, 0) * LEAST(COALESCE(EXTRACT(EPOCH FROM (nts - ts)), 0), 300)) / 3600000.0 AS import_kwh,
               COUNT(*)::int AS frames,
               MIN(ts) AS first_ts, MAX(ts) AS last_ts,
               MAX(EXTRACT(EPOCH FROM (nts - ts))) / 60 AS max_gap_min,
               ARRAY_AGG(DISTINCT source) AS sources
        FROM f GROUP BY 1
      ),
      -- EV energy = Σ POSITIVE counter increments PER CONNECTOR. The ChargePost
      -- e_ev_chg_kwh counter is NOT a lifetime meter: it resets to 0 (Gifhorn
      -- 22/25/29 Aug 2026, Gronau likewise). MAX−MIN per day double-counts the
      -- pre-reset value (Gifhorn Aug: 3997 vs 2749 kWh frozen); LAST−FIRST goes
      -- negative. Positive increments are what lib/backtest deriveSessionsFromRows
      -- sums, so this is the like-for-like check.
      ctr AS (
        SELECT f.ts, e ->> 'unit_id' AS unit, (e ->> 'e_ev_chg_kwh')::float AS c,
               LAG((e ->> 'e_ev_chg_kwh')::float) OVER (PARTITION BY e ->> 'unit_id' ORDER BY f.ts) AS pc,
               LAG(f.ts) OVER (PARTITION BY e ->> 'unit_id' ORDER BY f.ts) AS pts
        FROM f, LATERAL jsonb_array_elements(COALESCE(f.raw -> 'chargers', '[]'::jsonb)) e
      ),
      -- The engine settles per Berlin day and only sees deltas between frames
      -- it actually has, so a counter advance ACROSS a telemetry gap (the car
      -- charged while no frame reached us) is not in the report. Split it out:
      -- ev_kwh = observed (like the engine), gap_kwh = advanced while blind.
      ev AS (
        SELECT (ts AT TIME ZONE 'Europe/Berlin')::date AS day,
               SUM(GREATEST(c - pc, 0)) FILTER (WHERE ts - pts <= interval '10 minutes'
                                               AND (ts AT TIME ZONE 'Europe/Berlin')::date = (pts AT TIME ZONE 'Europe/Berlin')::date) AS ev_kwh,
               SUM(GREATEST(c - pc, 0)) FILTER (WHERE NOT (ts - pts <= interval '10 minutes'
                                               AND (ts AT TIME ZONE 'Europe/Berlin')::date = (pts AT TIME ZONE 'Europe/Berlin')::date)) AS gap_kwh
        FROM ctr WHERE pc IS NOT NULL GROUP BY 1
      )
      SELECT d.day::text, ROUND(d.import_kwh::numeric, 1) AS import_kwh, ROUND(ev.ev_kwh::numeric, 1) AS ev_kwh,
             ROUND(COALESCE(ev.gap_kwh, 0)::numeric, 1) AS gap_kwh,
             d.frames, d.first_ts, d.last_ts, ROUND(d.max_gap_min::numeric) AS max_gap_min, d.sources
      FROM d LEFT JOIN ev USING (day) ORDER BY d.day
    `)
    const days = r.rows as Array<{
      day: string
      import_kwh: string
      ev_kwh: string | null
      gap_kwh: string
      frames: number
      first_ts: Date
      last_ts: Date
      max_gap_min: string
      sources: string[]
    }>
    const imp = days.reduce((a, x) => a + Number(x.import_kwh), 0)
    const ev = days.reduce((a, x) => a + Number(x.ev_kwh ?? 0), 0)
    const gapEv = days.reduce((a, x) => a + Number(x.gap_kwh ?? 0), 0)
    const sources = [...new Set(days.flatMap((x) => x.sources))]
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 16).replace("T", " ") + "Z" : "—")
    const first = iso(days[0]?.first_ts)
    const last = iso(days[days.length - 1]?.last_ts)
    const gaps = days.filter((x) => Number(x.max_gap_min) > 60).map((x) => `${x.day} (${x.max_gap_min} min)`)
    const sessions = await getChargerSessions({ stationId: row.stationId, fromIso, toIso })

    console.log(`\n== ${row.stationId} · ${month}`)
    console.log(
      `  coverage      ${days.length} Berlin days · first frame ${first} · last ${last} · sources ${sources.join("|")}`,
    )
    if (gaps.length) console.log(`  gaps > 60 min ${gaps.join(", ")}`)
    console.log(`  grid import   raw Σmax(P,0)Δt ${imp.toFixed(1)} kWh   vs frozen ${row.importKwh.toFixed(1)}   Δ ${(imp - row.importKwh).toFixed(1)}`)
    console.log(`  EV delivered  raw Σ ctr rises   ${ev.toFixed(1)} kWh   vs frozen ${row.evDeliveredKwh?.toFixed(1) ?? "—"}   Δ ${(ev - (row.evDeliveredKwh ?? 0)).toFixed(1)}`)
    if (gapEv > 0.5)
      console.log(`  NOT in report ${gapEv.toFixed(1)} kWh EV counter advance across telemetry gaps / day edges (charged while blind — no frames, no prices)`)
    console.log(`  sessions      detector         ${sessions.length}        vs frozen ${row.sessions}   (Σ energy ${sessions.reduce((a, s) => a + s.energyKwh, 0).toFixed(1)} kWh)`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
