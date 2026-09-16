/**
 * Worker configuration — read once at boot from environment variables.
 *
 * Required:
 *   STATION_ID   — Amperio station id whose telemetry we read (e.g. "station_munich_01")
 *   SITE_ID      — tenant/site id echoed into the dispatch envelope
 *   ASSET_ID     — specific chargepost at the site (e.g. "chargepost_gronau_001")
 *
 * Optional:
 *   AMPERIO_BASE_URL    — defaults to https://amperio.enexa.me/api/v1
 *   AMPERIO_AUTH_TOKEN  — Bearer token. Per the Amperio spec auth may be
 *                         omitted in local dev; when present we send
 *                         `Authorization: Bearer <token>`.
 *   TICK_MS             — dispatch cadence in ms (default 15000 = 15s)
 *   PRICE_SOURCE        — "DAM" | "IDM" (default "DAM")
 *   STATUS_REPORT_URL   — base URL of the Next.js app to push status to
 *                         (e.g. "https://amperio.enexa.app"). When unset,
 *                         status reporting is disabled (worker still runs).
 *   STATUS_REPORT_TOKEN — optional shared secret; sent as `x-report-token`
 *                         and verified by the ingest route.
 *   APP_BASE_URL        — base URL of the deployed Next.js app whose
 *                         /api/dispatcher/tick endpoint runs the v5 MPC. The
 *                         worker delegates each tick here so there is ONE engine
 *                         everywhere. Falls back to STATUS_REPORT_URL if unset.
 *   DISPATCHER_TICK_TOKEN — Bearer secret for the tick endpoint (must equal the
 *                         app's CRON_SECRET). Falls back to CRON_SECRET.
 */

import "dotenv/config"

function required(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) {
    throw new Error(
      `Missing required env var ${name}. Set it in services/dispatch-worker/.env ` +
        `(see .env.example) or in the deployment environment.`,
    )
  }
  return v.trim()
}

function optional(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : fallback
}

export interface WorkerConfig {
  stationId: string
  siteId: string
  assetId: string
  baseUrl: string
  authToken: string | null
  tickMs: number
  priceSource: "DAM" | "IDM"
  statusReportUrl: string | null
  statusReportToken: string | null
  /**
   * Base URL of the deployed Next.js app whose /api/dispatcher/tick endpoint
   * runs the v5 MPC. The worker delegates every tick to this endpoint so the
   * standalone service and the dashboard share ONE dispatch engine (and the
   * endpoint's Redis run-lock prevents the two from double-posting). Falls back
   * to STATUS_REPORT_URL when APP_BASE_URL is unset.
   */
  appBaseUrl: string | null
  /**
   * Shared secret sent as `Authorization: Bearer <token>` to the tick endpoint
   * (must equal the app's CRON_SECRET). Read from DISPATCHER_TICK_TOKEN, then
   * CRON_SECRET. When unset, the endpoint must itself have CRON_SECRET unset.
   */
  tickToken: string | null
  // ── Price-supply robustness ──────────────────────────────────────────────
  /** Neon connection for the durable DAM price cache. Null disables caching. */
  databaseUrl: string | null
  /** Guaranteed forward hours of prices the planner must always have. */
  priceRequiredForwardHours: number
  /** aWATTar DE base URL (fallback source #2). */
  awattarBaseUrl: string
  /** Bidding zone key for the price cache. */
  priceZone: string
}

// Commands must be dispatched at most once every 15 seconds. TICK_MS may raise
// the interval (slower) but is clamped so it can never dispatch faster.
const MIN_TICK_MS = 15000

export function loadConfig(): WorkerConfig {
  const tickMsRaw = Number.parseInt(optional("TICK_MS", "15000"), 10)
  const tickMs = Number.isFinite(tickMsRaw) && tickMsRaw > MIN_TICK_MS ? tickMsRaw : MIN_TICK_MS
  const priceSourceRaw = optional("PRICE_SOURCE", "DAM").toUpperCase()
  const priceSource = priceSourceRaw === "IDM" ? "IDM" : "DAM"

  const reqFwdRaw = Number.parseFloat(optional("PRICE_REQUIRED_FORWARD_HOURS", "16"))
  const priceRequiredForwardHours = Number.isFinite(reqFwdRaw) && reqFwdRaw > 0 ? reqFwdRaw : 16

  return {
    stationId: required("STATION_ID"),
    siteId: required("SITE_ID"),
    assetId: required("ASSET_ID"),
    baseUrl: optional("AMPERIO_BASE_URL", "https://amperio.enexa.me/api/v1").replace(/\/+$/, ""),
    authToken: process.env.AMPERIO_AUTH_TOKEN?.trim() || null,
    tickMs,
    priceSource,
    statusReportUrl: process.env.STATUS_REPORT_URL?.trim().replace(/\/+$/, "") || null,
    statusReportToken: process.env.STATUS_REPORT_TOKEN?.trim() || null,
    appBaseUrl:
      (process.env.APP_BASE_URL?.trim() || process.env.STATUS_REPORT_URL?.trim() || "").replace(
        /\/+$/,
        "",
      ) || null,
    tickToken: process.env.DISPATCHER_TICK_TOKEN?.trim() || process.env.CRON_SECRET?.trim() || null,
    databaseUrl: process.env.DATABASE_URL?.trim() || null,
    priceRequiredForwardHours,
    awattarBaseUrl: optional("AWATTAR_BASE_URL", "https://api.awattar.de").replace(/\/+$/, ""),
    priceZone: optional("PRICE_ZONE", "DE-LU"),
  }
}
