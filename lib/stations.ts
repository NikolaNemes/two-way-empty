// ════════════════════════════════════════════════════════════════════════
// STATION REGISTRY — multi-location dispatch support.
// ════════════════════════════════════════════════════════════════════════
//
// One StationConfig per Chargepost location, loaded from the `stations` table.
// This replaces the previous singleton model where Gronau's physical constants
// (dispatch-kernel.ts) and env-var identity (engineConfig) were the only
// station the system could drive.
//
// Design rules:
// - The kernel constants in dispatch-kernel.ts are SEED DEFAULTS only; every
//   consumer that used to import them for live math must take a StationConfig.
// - A short in-process TTL cache keeps the hot paths (tick every 15s per
//   station) from hammering Postgres for rows that change ~never.
// - `getStation` throws for unknown ids — a dispatcher must never silently
//   fall back to another station's physics.
// ════════════════════════════════════════════════════════════════════════

import "server-only"
import { db } from "./db"
import { stations, type StationRow } from "./db/schema"
import { eq } from "drizzle-orm"

// Canonical home of DEFAULT_STATION_ID stays lib/amperio-api.ts (client-safe);
// re-exported here for convenience of server-side station consumers.
export { DEFAULT_STATION_ID } from "./amperio-api"

export interface StationConfig {
  stationId: string
  name: string
  siteId: string
  assetId: string
  /** Telemetry/monitoring enabled: the platform tracks this location. */
  enabled: boolean
  /** Dispatching enabled: the optimizer actively drives this location.
   * Invariant: dispatchEnabled ⇒ enabled (telemetry). */
  dispatchEnabled: boolean
  // Physical
  gridImportLimitKw: number
  gridRealPowerCapKw: number
  battCount: number
  /** kWh per battery pack (total site storage = battCount × battCapacityKwh). */
  battCapacityKwh: number
  battMaxPowerKw: number
  connectorSingleMaxW: number
  connectorDualMaxW: number
  // Commercial
  flatRateCtKwh: number
  wearCtKwh: number
  idmAdderCtKwh: number
  // Market
  priceZone: string
  /** Non-null on a historical twin row absorbed into a live pilot station
   * (same physical location). listStations hides such rows by default. */
  linkedStationId: string | null
  /** Partner's site classification ('ev_only' | 'ev_pv'), null = unknown.
   * Manual/master-list data only — never derived from telemetry. */
  siteClass: SiteClass | null
  notes: string | null
}

export type SiteClass = "ev_only" | "ev_pv"

function toConfig(row: StationRow): StationConfig {
  return {
    stationId: row.stationId,
    name: row.name,
    siteId: row.siteId,
    assetId: row.assetId,
    enabled: row.enabled,
    dispatchEnabled: row.dispatchEnabled,
    gridImportLimitKw: row.gridImportLimitKw,
    gridRealPowerCapKw: row.gridRealPowerCapKw,
    battCount: row.battCount,
    battCapacityKwh: row.battCapacityKwh,
    battMaxPowerKw: row.battMaxPowerKw,
    connectorSingleMaxW: row.connectorSingleMaxW,
    connectorDualMaxW: row.connectorDualMaxW,
    flatRateCtKwh: row.flatRateCtKwh,
    wearCtKwh: row.wearCtKwh,
    idmAdderCtKwh: row.idmAdderCtKwh,
    priceZone: row.priceZone,
    linkedStationId: row.linkedStationId,
    siteClass: (row.siteClass as SiteClass | null) ?? null,
    notes: row.notes,
  }
}

// ── In-process cache ─────────────────────────────────────────────────────────
// Station rows change on admin edits only; 30s TTL means a config change is
// picked up within two tick cycles without any invalidation plumbing.
const CACHE_TTL_MS = 30_000
const cache = new Map<string, { at: number; cfg: StationConfig }>()
let listCache: { at: number; all: StationConfig[] } | null = null

function invalidate() {
  cache.clear()
  listCache = null
}

/** Load one station's config. Throws for unknown ids (never silently falls
 *  back to another station's physics). */
export async function getStation(stationId: string): Promise<StationConfig> {
  const hit = cache.get(stationId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.cfg
  const rows = await db.select().from(stations).where(eq(stations.stationId, stationId)).limit(1)
  if (rows.length === 0) {
    throw new Error(`Unknown station "${stationId}" — not present in the stations registry`)
  }
  const cfg = toConfig(rows[0])
  cache.set(stationId, { at: Date.now(), cfg })
  return cfg
}

/** List stations (all by default; `enabledOnly` = telemetry-tracked only;
 *  `dispatchOnly` = actively dispatched only). Ordered by name.
 *  Historical twin rows (linkedStationId set — same physical location as a
 *  live pilot) are HIDDEN by default so counts match the partner's location
 *  list; pass `includeLinked` to see them (fleet report internals).
 *  `fresh` bypasses the TTL cache — REQUIRED for the admin read-after-write
 *  path: the cache is per serverless instance, so a mutation's invalidate()
 *  doesn't reach sibling instances and a cached read can serve the pre-write
 *  row for up to 30s (switch appears to flip back). */
export async function listStations(opts?: {
  enabledOnly?: boolean
  dispatchOnly?: boolean
  includeLinked?: boolean
  fresh?: boolean
}): Promise<StationConfig[]> {
  const filter = (all: StationConfig[]) => {
    const base = opts?.includeLinked ? all : all.filter((s) => s.linkedStationId === null)
    return opts?.dispatchOnly
      ? base.filter((s) => s.dispatchEnabled)
      : opts?.enabledOnly
        ? base.filter((s) => s.enabled)
        : base
  }
  if (!opts?.fresh && listCache && Date.now() - listCache.at < CACHE_TTL_MS) {
    return filter(listCache.all)
  }
  const rows = await db.select().from(stations).orderBy(stations.name)
  const all = rows.map(toConfig)
  listCache = { at: Date.now(), all }
  return filter(all)
}

// ── Admin mutations (used by the /stations admin UI server actions) ──────────

export type StationUpsert = Omit<StationConfig, "notes" | "linkedStationId" | "siteClass"> & {
  notes?: string | null
  linkedStationId?: string | null
  siteClass?: SiteClass | null
}

export async function upsertStation(input: StationUpsert): Promise<void> {
  await db
    .insert(stations)
    .values({
      stationId: input.stationId,
      name: input.name,
      siteId: input.siteId,
      assetId: input.assetId,
      // Invariant: dispatch implies telemetry.
      enabled: input.enabled || input.dispatchEnabled,
      dispatchEnabled: input.dispatchEnabled,
      gridImportLimitKw: input.gridImportLimitKw,
      gridRealPowerCapKw: input.gridRealPowerCapKw,
      battCount: input.battCount,
      battCapacityKwh: input.battCapacityKwh,
      battMaxPowerKw: input.battMaxPowerKw,
      connectorSingleMaxW: input.connectorSingleMaxW,
      connectorDualMaxW: input.connectorDualMaxW,
      flatRateCtKwh: input.flatRateCtKwh,
      wearCtKwh: input.wearCtKwh,
      idmAdderCtKwh: input.idmAdderCtKwh,
      priceZone: input.priceZone,
      linkedStationId: input.linkedStationId ?? null,
      siteClass: input.siteClass ?? null,
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: stations.stationId,
      set: {
        name: input.name,
        siteId: input.siteId,
        assetId: input.assetId,
        enabled: input.enabled || input.dispatchEnabled,
        dispatchEnabled: input.dispatchEnabled,
        gridImportLimitKw: input.gridImportLimitKw,
        gridRealPowerCapKw: input.gridRealPowerCapKw,
        battCount: input.battCount,
        battCapacityKwh: input.battCapacityKwh,
        battMaxPowerKw: input.battMaxPowerKw,
        connectorSingleMaxW: input.connectorSingleMaxW,
        connectorDualMaxW: input.connectorDualMaxW,
        flatRateCtKwh: input.flatRateCtKwh,
        wearCtKwh: input.wearCtKwh,
        idmAdderCtKwh: input.idmAdderCtKwh,
        priceZone: input.priceZone,
        linkedStationId: input.linkedStationId ?? null,
        siteClass: input.siteClass ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      },
    })
  invalidate()
}

/**
 * Kernel-params override for a station — overlay its physical + commercial
 * values onto the production baseline (resolveParams). Used by backtest and
 * report paths so per-station physics flow through the SAME parametrization
 * the model registry already applies.
 */
export function stationKernelOverride(cfg: StationConfig): {
  gridImportLimitKw: number
  gridRealPowerCapKw: number
  battCapacityKwh: number
  battMaxPowerKw: number
} {
  return {
    gridImportLimitKw: cfg.gridImportLimitKw,
    gridRealPowerCapKw: cfg.gridRealPowerCapKw,
    battCapacityKwh: cfg.battCapacityKwh,
    battMaxPowerKw: cfg.battMaxPowerKw,
  }
}

/**
 * Toggle the two operational flags with the coupling invariant enforced:
 *   - enabling DISPATCH auto-enables TELEMETRY (you cannot drive blind);
 *   - disabling TELEMETRY auto-disables DISPATCH (same reason).
 */
export async function setStationFlags(
  stationId: string,
  patch: { telemetry?: boolean; dispatch?: boolean },
): Promise<void> {
  const set: { enabled?: boolean; dispatchEnabled?: boolean; updatedAt: Date } = {
    updatedAt: new Date(),
  }
  if (patch.dispatch !== undefined) {
    set.dispatchEnabled = patch.dispatch
    if (patch.dispatch) set.enabled = true // dispatch ⇒ telemetry
  }
  if (patch.telemetry !== undefined) {
    set.enabled = patch.telemetry
    if (!patch.telemetry) set.dispatchEnabled = false // no telemetry ⇒ no dispatch
  }
  await db.update(stations).set(set).where(eq(stations.stationId, stationId))
  invalidate()
}

/** @deprecated kept for compatibility — toggles telemetry (and, per the
 * invariant, drops dispatch when disabling). Prefer setStationFlags. */
export async function setStationEnabled(stationId: string, enabled: boolean): Promise<void> {
  await setStationFlags(stationId, { telemetry: enabled })
}

/** Set the manual site classification (EV-only / EV+PV / null = unknown).
 * Single-column update so the inline classifier in the stations list can't
 * clobber concurrent edits to other fields. */
export async function setStationSiteClass(stationId: string, siteClass: SiteClass | null): Promise<void> {
  await db.update(stations).set({ siteClass, updatedAt: new Date() }).where(eq(stations.stationId, stationId))
  invalidate()
}
