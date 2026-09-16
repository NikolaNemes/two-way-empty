import { NextResponse } from "next/server"
import { getStatus, withStationScope } from "@/lib/dispatcher-status"
import { listStations } from "@/lib/stations"
import { refreshTelemetryOnlyStations } from "@/lib/telemetry-refresh"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * FLEET STATUS AGGREGATE — one call for the whole Fleet Overview dashboard.
 *
 * Classifies every registry station into exactly one operational tier:
 *   - "full":      dispatch-enabled, control running, fresh worker heartbeat
 *                  AND a solved plan — the dispatcher is actively driving.
 *   - "telemetry": we are receiving fresh telemetry (worker reporting) but the
 *                  dispatcher is NOT driving (control stopped/paused, no plan,
 *                  or heartbeat stale beyond the liveness window).
 *   - "offline":   DISCONNECTED — telemetry/dispatch is ENABLED in the
 *                  registry but nothing is actually flowing (silent or never
 *                  seen). This is an anomaly worth attention.
 *   - "disabled":  never enabled at all (telemetry off in the registry, e.g.
 *                  archive-imported locations). Expected, not an anomaly.
 *
 * Redis is only touched for ENABLED stations (disabled ones cannot report by
 * construction — live ingestion skips them), so the archive-imported bulk of
 * the registry costs zero store reads per poll.
 */

export type FleetStationStatus = {
  stationId: string
  name: string
  /** Registry flag: telemetry/monitoring enabled (we track this location). */
  enabled: boolean
  /** Registry flag: dispatching enabled (the optimizer drives it). */
  dispatchEnabled: boolean
  status: "full" | "telemetry" | "offline" | "disabled"
  /** Why this tier was chosen (short, human-readable). */
  reason: string
  /** min across battery SOCs (%) — null when no telemetry frame. */
  minSoc: number | null
  avgSoc: number | null
  batteryCount: number
  gridCapKw: number
  /** Age of the newest telemetry frame in ms, null when never seen. */
  telemetryAgeMs: number | null
  /** Current plan grid request (kW), null when no plan. */
  clearanceKw: number | null
  planSolvedAt: string | null
}

export async function GET() {
  // Keep telemetry-only (tracked, not dispatched) stations fresh: pull their
  // latest middleware frame before classifying. Throttled to 60s per station
  // inside the lib, best-effort — a middleware outage must not break status.
  await refreshTelemetryOnlyStations(null).catch((err) =>
    console.error("[v0] fleet-status telemetry refresh failed:", err),
  )

  const stations = await listStations()
  const now = Date.now()

  const results: FleetStationStatus[] = await Promise.all(
    stations.map(async (s): Promise<FleetStationStatus> => {
      const base = {
        stationId: s.stationId,
        name: s.name,
        enabled: s.enabled,
        dispatchEnabled: s.dispatchEnabled,
        gridCapKw: s.gridRealPowerCapKw,
      }
      if (!s.enabled) {
        // Registry invariant: dispatch requires telemetry, so !enabled means
        // nothing was ever turned on for this location — DISABLED, not an
        // anomaly. "offline" (Disconnected) is reserved for enabled locations
        // whose data/commands are NOT flowing.
        return {
          ...base,
          status: "disabled",
          reason: "Never enabled (no telemetry or dispatching configured)",
          minSoc: null,
          avgSoc: null,
          batteryCount: 0,
          telemetryAgeMs: null,
          clearanceKw: null,
          planSolvedAt: null,
        }
      }
      try {
        const st = await withStationScope(s.stationId, () => getStatus())
        const socs = (st.telemetryFrame?.batteries ?? [])
          .map((b: { soc_pct?: number | null }) => b?.soc_pct)
          .filter((v: unknown): v is number => typeof v === "number" && Number.isFinite(v))
        const frameAtMs = st.telemetryFrameAt ? new Date(st.telemetryFrameAt).getTime() : null
        const telemetryAgeMs = frameAtMs == null ? null : Math.max(0, now - frameAtMs)
        // Telemetry counts as "live" within 15 min (workers report every tick;
        // 15 min tolerates slow ticks without calling a live site offline).
        const telemetryFresh = telemetryAgeMs != null && telemetryAgeMs <= 15 * 60_000
        const plan = st.plan?.current ?? null

        // Status is MEASURED, not the registry flag: "telemetry" means data is
        // actually arriving right now; "full" means the dispatcher is actually
        // driving. A dispatch-enabled site with silent telemetry is offline.
        let status: FleetStationStatus["status"]
        let reason: string
        if (s.dispatchEnabled && st.online && st.control === "running" && plan != null) {
          status = "full"
          reason = "Dispatcher driving (fresh plan)"
        } else if (telemetryFresh) {
          status = "telemetry"
          reason = !s.dispatchEnabled
            ? "Telemetry arriving — dispatch not enabled"
            : st.control !== "running"
              ? `Control ${st.control} — telemetry streaming`
              : plan == null
                ? "Telemetry streaming — no plan yet"
                : "Heartbeat stale — telemetry only"
        } else {
          status = "offline"
          reason =
            telemetryAgeMs == null
              ? "Enabled but no telemetry ever received"
              : `Enabled but telemetry silent (${Math.round(telemetryAgeMs / 60_000)}m)`
        }

        return {
          ...base,
          status,
          reason,
          minSoc: socs.length ? Math.min(...socs) : null,
          avgSoc: socs.length ? socs.reduce((a: number, b: number) => a + b, 0) / socs.length : null,
          batteryCount: socs.length,
          telemetryAgeMs,
          clearanceKw: plan?.clearanceKw ?? null,
          planSolvedAt: plan?.solvedAt ? new Date(plan.solvedAt).toISOString() : null,
        }
      } catch {
        return {
          ...base,
          status: "offline",
          reason: "Status store unreachable",
          minSoc: null,
          avgSoc: null,
          batteryCount: 0,
          telemetryAgeMs: null,
          clearanceKw: null,
          planSolvedAt: null,
        }
      }
    }),
  )

  return NextResponse.json(
    { stations: results, at: new Date(now).toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  )
}
