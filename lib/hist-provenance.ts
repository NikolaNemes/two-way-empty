/**
 * Provenance rules for the two report datasets — Gronau defect report,
 * Defect 1 (sep 2 2026).
 *
 * HISTORY ANALYSIS (hist_*) is the pre-system archive: a one-time CSV export
 * (CCR files, 54 locations). FLEET (chargepost_*) is the station's own
 * telemetry. The two never mix — a history row never carries a telemetry
 * figure, a fleet row is never simulated.
 *
 * `simulateFleetMonth` fills archive gaps so the PROJECTION view can show a
 * whole fleet for any month, but a REPORT may only show a station-month whose
 * volume the archive actually holds:
 *
 *   volumeSource = "month"     the archive's own figure for that month  → row
 *   volumeSource = "seasonal"  other-year same-month proxy               → NO row
 *   volumeSource = "recent"    trailing-months proxy                     → NO row
 *   import_kwh   = 0           the station was not live that month       → NO row
 *   month < optimiser go-live  the station ran WITHOUT the optimiser     → NO row
 *
 *   volumeSource = "measured"  FLEET dataset only (telemetry)            → row
 *
 * Synthesized and zero months used to be persisted and summed into the yearly
 * Station totals as if they were history. They are dropped at the builder;
 * this module is the single place that decides.
 *
 * CLIENT DECISIONS (2 sep 2026, Defect 1 follow-up):
 *  1. A station's report starts the month the optimiser went live. Gronau's
 *     archive has a Nov 2025 month (−39 € "savings" — the plant ran without
 *     the optimiser); it is excluded. Report = Dec 2025 → today.
 *  2. Session counts are reported ONLY where they are real charge events.
 *     The one-time archive import carried no charge events (it read power and
 *     SoC columns only) — its 5 kW rising-edge estimate was −12 % … +70 % off
 *     where it could be checked — so history rows show "n/a" until sessions
 *     are re-derived from the source export.
 *     UPDATE sep 4 2026: the source export DOES carry a per-connector power
 *     meter (loading_point_1/2_power_w). Sessions are re-derived from it as
 *     per-connector power islands with the live path's exact filters
 *     (lib/ccr-sessions.ts, persisted in portfolio_session by
 *     scripts/portfolio/import-ccr-sessions.ts). A history row shows that
 *     count once its station's export has been imported — stamped
 *     `sessionsBasis = "lp-power-islands-v1"` — and "n/a" before. The 5 kW
 *     estimate is still never shown.
 *  3. History Analysis contains NO telemetry: the Gronau measured-anchor row
 *     and the capture-rate scaling (real ÷ simulated, 0.968) were removed.
 */

export type ArchiveVolumeSource = "month" | "seasonal" | "recent" | "measured"

export interface ArchiveMonthLike {
  volumeSource: string
  importKwh: number
  /** Needed for the optimiser go-live gate; rows and sim entries carry both. */
  stationId?: string
  month?: string
}

/**
 * First month the optimiser was live per archive station ("YYYY-MM").
 * Stations not listed are reported from their first archive month — the
 * archive export for them starts at go-live. Add a station here when its
 * archive is known to predate the optimiser.
 */
export const OPTIMISER_LIVE_FROM: Readonly<Record<string, string>> = {
  /** Gronau (ChargePost pilot) — client: "live since Dec 2025". */
  hist_AX10095481: "2025-12",
}

/** True when the station-month predates the optimiser go-live (decision 1). */
export function isBeforeOptimiserGoLive(stationId: string | undefined, month: string | undefined): boolean {
  if (!stationId || !month) return false
  const liveFrom = OPTIMISER_LIVE_FROM[stationId]
  return !!liveFrom && month < liveFrom
}

/** Real, station-own volume for the month — the archive's own figure (history
 *  dataset) or the station's telemetry (fleet dataset) — inside the station's
 *  optimised period. */
export function isReportableArchiveMonth(s: ArchiveMonthLike): boolean {
  if (isBeforeOptimiserGoLive(s.stationId, s.month)) return false
  return (s.volumeSource === "month" || s.volumeSource === "measured") && s.importKwh > 0
}

/** The two ways a row's session count can have been obtained (decision 2). */
export type SessionsBasis = "counters" | "lp-power-islands-v1"

export interface SessionsRowLike {
  volumeSource: string
  sessions: number | null
  /** Set by the builder since sep 4 2026; older live rows were back-stamped
   *  "counters". Optional so callers with legacy row shapes still type-check. */
  sessionsBasis?: string | null
}

/**
 * The basis a row's session count rests on, or null when it has none (n/a).
 *  - `counters`            fleet/telemetry month: charge events from the
 *                          per-connector energy counters (live path).
 *  - `lp-power-islands-v1` history month: per-connector power islands from the
 *                          station's CCR export (lib/ccr-sessions.ts).
 * A `measured` row without a stamp (frozen before the column existed) is a
 * counter row by construction. A history row is n/a until its export has been
 * imported — the import's rising-edge estimate is never a basis.
 */
export function sessionsBasisOf(row: SessionsRowLike): SessionsBasis | null {
  if (row.sessions == null) return null
  if (row.sessionsBasis === "counters" || row.sessionsBasis === "lp-power-islands-v1") return row.sessionsBasis
  if (row.sessionsBasis == null && row.volumeSource === "measured") return "counters"
  return null
}

/** Session count a REPORT may show for a row: a count with a basis, or null (n/a). */
export function reportableSessions(row: SessionsRowLike): number | null {
  return sessionsBasisOf(row) != null ? row.sessions : null
}

/** Human label for the sessions basis on a station-month (Excel / tooltips). */
export function sessionsBasisLabel(row: SessionsRowLike): string {
  switch (sessionsBasisOf(row)) {
    case "counters":
      return "charge events (per-connector counters)"
    case "lp-power-islands-v1":
      return "per-connector power islands (CCR export)"
    default:
      return "n/a — station export not yet imported (scripts/portfolio/import-ccr-sessions.ts)"
  }
}

/** Human label used by report tables and Excel exports. */
export function volumeSourceLabel(volumeSource: string): string {
  switch (volumeSource) {
    case "measured":
      return "Measured (telemetry)"
    case "month":
      return "Archive (this month's export)"
    case "seasonal":
      return "Synthesized (seasonal proxy)"
    case "recent":
      return "Synthesized (recent-months proxy)"
    default:
      return volumeSource
  }
}
