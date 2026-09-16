"use server"

// Server actions for the station registry (multi-location dispatch).
// Thin, validated wrappers over lib/stations.ts used by the /stations admin
// UI, the sidebar station switcher, and the fleet dashboard.

import { revalidatePath } from "next/cache"
import {
  getStation,
  listStations,
  upsertStation,
  setStationFlags,
  setStationSiteClass,
  type SiteClass,
  type StationConfig,
  type StationUpsert,
} from "@/lib/stations"

export async function listStationsAction(opts?: {
  enabledOnly?: boolean
  /** Bypass the per-instance TTL cache — use for admin read-after-write. */
  fresh?: boolean
}): Promise<StationConfig[]> {
  return listStations(opts)
}

export async function getStationAction(stationId: string): Promise<StationConfig> {
  return getStation(stationId)
}

/** Validation: every physical/commercial number must be finite and positive
 *  (idm adder may be 0). Returns an error string instead of throwing so the
 *  form can render it inline. */
function validate(input: StationUpsert): string | null {
  if (!/^[a-z0-9_-]+$/i.test(input.stationId)) {
    return "Station id must be alphanumeric with _ or - (it keys telemetry, Redis and reports)."
  }
  if (!input.name.trim()) return "Name is required."
  if (!input.siteId.trim() || !input.assetId.trim()) return "Site id and asset id are required."
  const positives: Array<[string, number]> = [
    ["Grid import limit", input.gridImportLimitKw],
    ["Grid real-power cap", input.gridRealPowerCapKw],
    ["Battery count", input.battCount],
    ["Battery capacity", input.battCapacityKwh],
    ["Battery max power", input.battMaxPowerKw],
    ["Connector single max", input.connectorSingleMaxW],
    ["Connector dual max", input.connectorDualMaxW],
    ["Flat rate", input.flatRateCtKwh],
    ["Wear rate", input.wearCtKwh],
  ]
  for (const [label, v] of positives) {
    if (!Number.isFinite(v) || v <= 0) return `${label} must be a positive number.`
  }
  if (!Number.isFinite(input.idmAdderCtKwh) || input.idmAdderCtKwh < 0) {
    return "IDM adder must be zero or positive."
  }
  if (input.gridRealPowerCapKw > input.gridImportLimitKw) {
    return "Real-power cap cannot exceed the grid import limit (kVA nameplate)."
  }
  return null
}

export async function upsertStationAction(
  input: StationUpsert,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const error = validate(input)
  if (error) return { ok: false, error }
  await upsertStation(input)
  revalidatePath("/stations")
  revalidatePath("/fleet")
  return { ok: true }
}

/**
 * Toggle telemetry and/or dispatch for a station. The coupling invariant is
 * enforced in lib/stations.ts: enabling dispatch auto-enables telemetry, and
 * disabling telemetry auto-disables dispatch.
 */
export async function setStationFlagsAction(
  stationId: string,
  patch: { telemetry?: boolean; dispatch?: boolean },
): Promise<{ ok: true }> {
  await setStationFlags(stationId, patch)
  revalidatePath("/stations")
  revalidatePath("/fleet")
  return { ok: true }
}

/** Inline classifier in the stations list: set EV-only / EV+PV / unknown.
 * Validated against the closed enum — the value lands in report groupings. */
export async function setStationSiteClassAction(
  stationId: string,
  siteClass: SiteClass | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (siteClass !== null && siteClass !== "ev_only" && siteClass !== "ev_pv") {
    return { ok: false, error: "Invalid site class." }
  }
  await setStationSiteClass(stationId, siteClass)
  revalidatePath("/stations")
  revalidatePath("/portfolio/yearly")
  return { ok: true }
}
