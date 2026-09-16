// ════════════════════════════════════════════════════════════════════════
// TELEMETRY NORMALIZER — single mapping from a raw Amperio frame to the
// denormalized analytics columns. Used by BOTH ingestion (writes columns) and
// the backtest engine (reconstructs kernel inputs) so they can never diverge.
// ════════════════════════════════════════════════════════════════════════

import type { ApiTelemetryFrame } from "./amperio-api"

export interface NormalizedFrame {
  stationId: string
  ts: string // ISO-8601
  gridPowerW: number | null
  gridImportLimitW: number | null
  socPackA: number | null
  socPackB: number | null
  socAvg: number | null
  evLoadW: number | null
  battPowerW: number | null
  priceEurMwh: number | null
  chargingModeA: number | null
  chargingModeB: number | null
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/**
 * Reconstruct EV charging power from the site power balance.
 *
 * KNOWN SOURCE BUG: the chargers' `p_ev_w` telemetry is stuck at 0, so the
 * summed EV load is unusable. We instead derive it from conservation of power
 * at the AC bus, which is what the meter + battery actually measure:
 *
 *     grid_import + battery_discharge = ev_load + battery_charge + aux
 *
 * With the stored sign conventions:
 *   - gridPowerW: positive = EXPORT, negative = IMPORT  ⇒ import = -gridPowerW
 *   - battPowerW: positive = DISCHARGE, negative = CHARGE (API sign)
 *
 * Rearranging (and folding battery charge into the signed battPowerW term):
 *
 *     ev_load ≈ battPowerW - gridPowerW
 *
 * Aux load is not metered separately in the stored frame, so it is absorbed
 * here; the result is clamped at 0 because chargers cannot back-feed the bus.
 * Validated against the May dataset: mean ≈ grid import, < 0.01% of frames
 * needed the clamp.
 */
export function deriveEvLoadW(
  gridPowerW: number | null,
  battPowerW: number | null,
  /** Raw summed p_ev_w; used as-is when the source actually reports it. */
  rawEvLoadW?: number | null,
): number | null {
  if (rawEvLoadW != null && Math.abs(rawEvLoadW) > 1) return rawEvLoadW
  if (gridPowerW == null && battPowerW == null) return rawEvLoadW ?? null
  const grid = gridPowerW ?? 0
  const batt = battPowerW ?? 0
  return Math.max(0, batt - grid)
}

/**
 * Derive analytics columns from a raw frame. Mirrors the dispatcher's own
 * frame→inputs mapping (lib/dispatch-engine.ts): SOC per pack, summed EV
 * load, grid power, twin-pack battery power, and the DAM price snapshot.
 */
export function normalizeFrame(
  frame: ApiTelemetryFrame,
  /**
   * Authoritative station id. Per-frame objects from `/telemetry/frames` do
   * NOT carry `station_id` (it lives at the response top level), so callers
   * paging that endpoint MUST pass the station id they queried with. Falls
   * back to any id embedded on the frame for single-frame callers.
   */
  stationIdOverride?: string,
): NormalizedFrame {
  const batteries = frame.batteries ?? []
  const chargers = frame.chargers ?? []

  const socPackA = num(batteries[0]?.soc_pct)
  const socPackB = num(batteries[1]?.soc_pct) ?? socPackA
  const socAvg =
    socPackA != null && socPackB != null
      ? (socPackA + socPackB) / 2
      : (socPackA ?? socPackB)

  const rawEvLoadW = chargers.reduce((acc, c) => acc + (num(c.p_ev_w) ?? 0), 0)
  const battPowerW = batteries.reduce((acc, b) => acc + (num(b.power_w) ?? 0), 0)
  const gridPowerW = num(frame.grid?.p_grid_w)
  // p_ev_w is a known-broken source field (stuck at 0); reconstruct EV load
  // from the metered power balance instead. See deriveEvLoadW.
  const evLoadW = deriveEvLoadW(gridPowerW, battPowerW, rawEvLoadW)

  // Price snapshot embedded in the frame (DAM is the day-ahead settlement).
  const priceEurMwh = num(frame.prices?.dam)

  return {
    stationId: stationIdOverride ?? frame.station_id,
    ts: frame.ts,
    gridPowerW,
    gridImportLimitW: num(frame.station?.p_grid_consumption_limit_w),
    socPackA,
    socPackB,
    socAvg,
    evLoadW,
    battPowerW,
    priceEurMwh,
    // charging_mode is a command register, not in raw telemetry; left null on
    // ingest (telemetry is observed state, not the commanded mode).
    chargingModeA: null,
    chargingModeB: null,
  }
}
