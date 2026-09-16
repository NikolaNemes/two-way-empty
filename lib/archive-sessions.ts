import "server-only"
import { sql } from "drizzle-orm"
import { db } from "@/lib/db"

/**
 * ARCHIVE SESSIONS — the one reader for `portfolio_session`.
 *
 * Sessions on history (`hist_*`) rows are re-derived from the station's CCR
 * export as per-connector power islands (lib/ccr-sessions.ts, persisted by
 * scripts/portfolio/import-ccr-sessions.ts). This module answers "how many
 * sessions did station X have in month M" for BOTH consumers of that number —
 * `simulateFleetMonth` (the History Analysis monthly page) and the yearly
 * builder that freezes it — so the two can never disagree.
 *
 * Semantics of the returned map:
 *   - station present, n ≥ 0   → its export is imported and its imported span
 *                                reaches into the month: n is a real count
 *                                (0 = the station was up but nobody charged).
 *   - station absent           → unknown: no export imported, or the export
 *                                does not cover the month → report "n/a".
 * Bucketed by UTC month of the session start, the same calendar the archive's
 * daily volumes (`portfolio_daily.day`, UTC days) are bucketed on.
 */
export async function archiveSessionsForMonth(month: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!/^\d{4}-\d{2}$/.test(month)) return out
  const monthStart = `${month}-01`
  type Row = { station_id: string; n: string | number }
  try {
    const res = await db.execute(sql`
      SELECT i.station_id,
             (SELECT count(*) FROM portfolio_session s
               WHERE s.station_id = i.station_id
                 AND s.start_ts >= ${monthStart}::date
                 AND s.start_ts <  (${monthStart}::date + interval '1 month')) AS n
      FROM portfolio_session_import i
      WHERE i.first_ts < (${monthStart}::date + interval '1 month')
        AND i.last_ts  >= ${monthStart}::date
    `)
    // node-postgres driver: rows live on `.rows` (same access as lib/price-analysis.ts).
    const list = ((res as unknown as { rows?: Row[] }).rows ?? []) as Row[]
    for (const r of list) out.set(r.station_id, Number(r.n))
  } catch (e) {
    // 42P01 = undefined_table: nothing imported yet → every history row is n/a.
    if ((e as { code?: string })?.code !== "42P01") throw e
  }
  return out
}
