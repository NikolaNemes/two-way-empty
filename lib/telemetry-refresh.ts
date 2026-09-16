import "server-only"

import { listStations } from "@/lib/stations"
import { withStationScope, recordTelemetrySnapshot } from "@/lib/dispatcher-store"

const AMPERIO_BASE = "https://amperio.enexa.me/api/v1"

/** Refresh a telemetry-only station's frame at most this often (per instance). */
const TELEMETRY_REFRESH_MS = 60_000
const lastTelemetryRefresh = new Map<string, number>()

/**
 * Fetch the latest middleware frame for EVERY enabled station and store it
 * into that station's scoped status record. This is what keeps live SOC/age
 * on the fleet dashboard truthful.
 *
 * Covers dispatch-enabled stations too (not just telemetry-only ones): the
 * dispatcher tick also records telemetry while planning, but between ticks —
 * or in environments with no cron at all (sandbox/local dev) — that snapshot
 * goes stale and a station that IS streaming telemetry would misclassify as
 * DISCONNECTED (live-hit: Norderstedt right after its dispatch go-live).
 * Telemetry freshness must never depend on the dispatch loop running.
 *
 * Called from BOTH the dispatcher tick (background cadence) and the fleet
 * status route (UI-driven cadence). Per-station 60s throttle + set-before-fetch
 * keeps a failing station from retrying on every call, and makes the overlap
 * with the tick's own telemetry fetch negligible. Best-effort by design:
 * callers must never block or fail on it.
 */
export async function refreshTelemetryOnlyStations(requestedStationId: string | null): Promise<void> {
  const all = await listStations({ enabledOnly: true })
  const now = Date.now()
  const targets = all.filter(
    (s) =>
      (!requestedStationId || s.stationId === requestedStationId) &&
      now - (lastTelemetryRefresh.get(s.stationId) ?? 0) >= TELEMETRY_REFRESH_MS,
  )
  if (targets.length === 0) return

  await Promise.all(
    targets.map(async (s) => {
      lastTelemetryRefresh.set(s.stationId, now) // set BEFORE fetch: a failing station must not retry every call
      try {
        const res = await fetch(`${AMPERIO_BASE}/telemetry/latest?station_id=${encodeURIComponent(s.stationId)}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) return
        const frame = await res.json()
        if (!frame?.ts) return
        await withStationScope(s.stationId, () =>
          recordTelemetrySnapshot(frame, {
            stationId: s.stationId,
            siteId: s.siteId,
            assetId: s.assetId,
            baseUrl: AMPERIO_BASE,
          }),
        )
      } catch (err) {
        console.error(`[v0] telemetry refresh failed for ${s.stationId}:`, err)
      }
    }),
  )
}
