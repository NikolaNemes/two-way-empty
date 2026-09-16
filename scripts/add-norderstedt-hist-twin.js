/**
 * One-off: create the missing Norderstedt historical twin row.
 *
 * fleet_month_report addresses Norderstedt as hist_AX10097766, but the
 * stations registry only had the live pilot row (chargepost_norderstedt_001).
 * Gronau and Gifhorn both have such twin rows (hist_* with linked_station_id
 * pointing at the pilot) — this brings Norderstedt in line, so the yearly
 * report's site-class lookup resolves instead of falling back to "unknown".
 *
 * The twin clones the pilot's physics/pricing, is disabled (no telemetry, no
 * dispatch), site_class ev_only (partner Excel row: Norderstedt = LIS), and
 * linked_station_id = pilot so listStations() keeps hiding it (56 visible).
 *
 * Run: node --env-file-if-exists=/vercel/share/.env.project scripts/add-norderstedt-hist-twin.js
 */
const { Client } = require("pg")

async function main() {
  // sslmode=require → verify-full: same strict behavior pg applies today,
  // stated explicitly so pg v8.16+ doesn't print its v9 deprecation warning.
  const conn = (process.env.DATABASE_URL || "").replace(
    /([?&])sslmode=(prefer|require|verify-ca)(?=&|$)/,
    "$1sslmode=verify-full",
  )
  const c = new Client({ connectionString: conn })
  await c.connect()

  const insert = `
    INSERT INTO stations (
      station_id, name, site_id, asset_id,
      enabled, dispatch_enabled,
      grid_import_limit_kw, grid_real_power_cap_kw,
      batt_count, batt_capacity_kwh, batt_max_power_kw,
      connector_single_max_w, connector_dual_max_w,
      flat_rate_ct_kwh, wear_ct_kwh, idm_adder_ct_kwh, price_zone,
      linked_station_id, site_class, notes,
      created_at, updated_at
    )
    SELECT
      'hist_AX10097766', name || ' (hist)', site_id, 'AX10097766',
      false, false,
      grid_import_limit_kw, grid_real_power_cap_kw,
      batt_count, batt_capacity_kwh, batt_max_power_kw,
      connector_single_max_w, connector_dual_max_w,
      flat_rate_ct_kwh, wear_ct_kwh, idm_adder_ct_kwh, price_zone,
      'chargepost_norderstedt_001', 'ev_only',
      'Historical twin of the Norderstedt pilot - carries archive/fleet-report data under the hist id.',
      now(), now()
    FROM stations
    WHERE station_id = 'chargepost_norderstedt_001'
    ON CONFLICT (station_id) DO NOTHING
  `
  const r = await c.query(insert)
  console.log("twin inserted:", r.rowCount)

  const v = await c.query("SELECT count(*)::int AS visible FROM stations WHERE linked_station_id IS NULL")
  console.log("visible stations:", v.rows[0].visible)

  const u = await c.query(`
    SELECT DISTINCT r.station_id
    FROM fleet_month_report r
    LEFT JOIN stations s ON s.station_id = r.station_id
    WHERE s.site_class IS NULL
  `)
  console.log("unclassified report ids:", JSON.stringify(u.rows))

  await c.end()
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
