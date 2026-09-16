// Ad-hoc diagnostic (Aug 2026 review): where did a per-connector EV energy
// counter (e_ev_chg_kwh) advance while NO frame reached us? Those kWh were
// charged but are in no report — the engine only prices frames it has.
//   node --env-file-if-exists=/vercel/share/.env.project scripts/inspect-ev-counters.mjs [fromIso] [toIso]
import pg from "pg"

const from = process.argv[2] ?? "2026-07-31T22:00:00Z"
const to = process.argv[3] ?? "2026-08-31T22:00:00Z"
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
const r = await pool.query(
  `with f as (
     select station_id, ts, e->>'unit_id' unit, (e->>'e_ev_chg_kwh')::float ctr
     from telemetry_frame tf, lateral jsonb_array_elements(coalesce(tf.raw->'chargers','[]'::jsonb)) e
     where station_id not like 'hist_%' and ts >= $1 and ts < $2
   ), l as (
     select *, lag(ctr) over (partition by station_id, unit order by ts) prev,
               lag(ts)  over (partition by station_id, unit order by ts) pts
     from f
   )
   select station_id, unit,
          to_char(pts at time zone 'Europe/Berlin', 'DD.MM HH24:MI') blind_from,
          to_char(ts  at time zone 'Europe/Berlin', 'DD.MM HH24:MI') blind_to,
          round((extract(epoch from (ts - pts))/3600)::numeric,1) gap_h,
          round(prev::numeric,1) ctr_before, round(ctr::numeric,1) ctr_after,
          round((ctr - prev)::numeric,1) advance_kwh
   from l
   where prev is not null and ctr - prev > 5 and ts - pts > interval '10 minutes'
   order by station_id, ts`,
  [from, to],
)
console.log(`== EV counter advances across telemetry gaps > 10 min (NOT in any report), ${from} .. ${to}`)
console.table(r.rows)
const tot = {}
for (const x of r.rows) tot[x.station_id] = Math.round(((tot[x.station_id] ?? 0) + Number(x.advance_kwh)) * 10) / 10
console.log("Σ per station (kWh charged while blind):", tot)
await pool.end()
