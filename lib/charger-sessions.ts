// ════════════════════════════════════════════════════════════════════════
// CHARGER SESSION DERIVATION — reconstruct C1/C2 charging sessions.
// ════════════════════════════════════════════════════════════════════════
//
// The per-charger instantaneous power field (`p_ev_w`) is a KNOWN-BROKEN
// telemetry field stuck at 0 (see deriveEvLoadW). So we cannot read EV power
// per charger directly. Instead we reconstruct discrete charging *sessions*
// from two robust signals that ARE present in the stored `raw` frame:
//
//   • plug_state === "Plugged"   → a car is connected (session boundary)
//   • e_ev_chg_kwh               → a monotonic cumulative energy counter, so
//                                  energy delivered in a session is the delta
//                                  between the first and last frame.
//
// Implemented as a gaps-and-islands query: explode the chargers array, flag
// each plugged frame, mark a new session whenever a unit transitions from
// unplugged → plugged, then aggregate contiguous runs per unit.
// ════════════════════════════════════════════════════════════════════════

import "server-only"
import { db } from "./db"
import { sql } from "drizzle-orm"

export interface ChargerSession {
  /** Source charger unit id ("1", "2", …). */
  unitId: string
  /** Display label: C1, C2, … */
  label: string
  startIso: string
  endIso: string
  startMs: number
  endMs: number
  /** Energy delivered this session (kWh), from the cumulative counter delta. */
  energyKwh: number
  /** Average power across the connected window (kW). */
  avgKw: number
  frames: number
  /** Car SoC % at the first / last frame of the session (null when not reported). */
  startSocPct?: number | null
  endSocPct?: number | null
  /** Charger-reported time-to-full (seconds) at the last frame (null when idle/not estimated). */
  etaFullS?: number | null
}

export async function getChargerSessions(args: {
  stationId: string
  fromIso: string
  toIso: string
}): Promise<ChargerSession[]> {
  const rows = (
    await db.execute(sql`
      WITH frames AS (
        SELECT
          tf.ts,
          (e ->> 'unit_id')       AS unit_id,
          (e ->> 'plug_state')    AS plug_state,
          (e ->> 'e_ev_chg_kwh')::float AS e_kwh
        FROM telemetry_frame tf,
          LATERAL jsonb_array_elements(tf.raw -> 'chargers') AS e
        WHERE tf.station_id = ${args.stationId}
          AND tf.ts >= ${args.fromIso}
          AND tf.ts <= ${args.toIso}
      ),
      flagged AS (
        SELECT *,
          CASE WHEN plug_state = 'Plugged' THEN 1 ELSE 0 END AS is_active,
          CASE
            WHEN plug_state = 'Plugged'
             AND COALESCE(
                   LAG(CASE WHEN plug_state = 'Plugged' THEN 1 ELSE 0 END)
                     OVER (PARTITION BY unit_id ORDER BY ts), 0) = 0
            THEN 1 ELSE 0
          END AS new_session
        FROM frames
      ),
      grouped AS (
        SELECT unit_id, ts, e_kwh,
          SUM(new_session) OVER (PARTITION BY unit_id ORDER BY ts) AS session_id
        FROM flagged
        WHERE is_active = 1
      )
      SELECT
        unit_id                              AS unit_id,
        MIN(ts)                              AS start_ts,
        MAX(ts)                              AS end_ts,
        GREATEST(MAX(e_kwh) - MIN(e_kwh), 0) AS energy_kwh,
        COUNT(*)                             AS frames
      FROM grouped
      GROUP BY unit_id, session_id
      -- keep only real charging sessions: ≥2 frames AND meaningful delivered energy
      HAVING COUNT(*) >= 2 AND GREATEST(MAX(e_kwh) - MIN(e_kwh), 0) > 0.1
      ORDER BY unit_id, start_ts
    `)
  ).rows as Array<{
    unit_id: string
    start_ts: string | Date
    end_ts: string | Date
    energy_kwh: number | string
    frames: number | string
  }>

  return rows.map((r) => {
    const startMs = new Date(r.start_ts).getTime()
    const endMs = new Date(r.end_ts).getTime()
    const energyKwh = Number(r.energy_kwh) || 0
    const hours = Math.max((endMs - startMs) / 3_600_000, 1 / 240) // ≥ 15s
    return {
      unitId: r.unit_id,
      label: `C${r.unit_id}`,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      startMs,
      endMs,
      energyKwh: Math.round(energyKwh * 100) / 100,
      avgKw: Math.round((energyKwh / hours) * 10) / 10,
      frames: Number(r.frames) || 0,
    }
  })
}
