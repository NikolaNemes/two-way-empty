/**
 * THE methodology version — declared once, printed everywhere (Annex A8.1/8.3).
 *
 * Stamped on every fleet_month_report row, shown in the Site Financial Report
 * footer, on the Settlement Methodology Annex, and compared by the cron /
 * yearly action to detect stale rows. Until sep 3 2026 the Financial Report
 * and the Annex each carried their own "2026-07-22" copy while rows carried
 * the builder's — three labels for one method. Isomorphic on purpose: the
 * Annex page is a client component.
 *
 * Bump when the settlement MATH changes (a bump marks every frozen row stale
 * and the nightly cron refills them). Do NOT bump for presentation-only
 * changes. Changelog lives with the builder (lib/fleet-report-builder.ts).
 *
 * A bump stales BOTH datasets — the yearly/monthly pages hide every row not
 * on this exact string, so an incomplete re-freeze shows an EMPTY report with
 * a "N station-months excluded" banner (sep 3 2026: 709 hist rows hidden
 * after only the live set was refilled). After bumping, run in this order:
 *
 *   1. scripts/backfill-rollups.ts --force           (daily station_day_report,
 *                                                     replays raw frames — the
 *                                                     only step that applies a
 *                                                     compute() change)
 *   2. scripts/refill-live-fleet-months.ts           (live chargepost_* months)
 *   3. scripts/refill-live-fleet-months.ts --hist    (archive hist_* months —
 *                                                     ~15 months × ~47 stations,
 *                                                     several minutes)
 *   4. scripts/verify-fleet-vs-financial.ts          (must PASS)
 *
 * or let the nightly cron do 2–3 (/api/cron/fleet-report?force=1).
 */
export const METHODOLOGY_VERSION = "2026-09-04.4"
