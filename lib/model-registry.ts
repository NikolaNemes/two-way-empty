// ════════════════════════════════════════════════════════════════════════
// MODEL REGISTRY — typed snapshot of the dispatch engine's tunable parameters.
// ════════════════════════════════════════════════════════════════════════
//
// SINGLE ENGINE: the project runs ONE dispatch optimizer — the LP solver in
// lib/optimizer/solver. The legacy heuristic (decideTick / merit-order planner)
// has been removed. A "version" is therefore a parameterisation of that one
// engine. VERSION LABELS ("v4", "v5", …) ARE HISTORICAL DATABASE NAMES ONLY —
// they identify stored model_version rows for backtest comparison, not
// separate code paths: "v4" = legacy flat reserve floor parameterisation,
// "v5" = the current production defaults (adaptive, uncertainty-sized reserve).
// Both solve the identical linear program; they differ only in the `mpc`
// parameter block.
//
// This module reads the kernel's exported constants (lib/dispatch-kernel.ts) and
// the optimizer defaults (lib/optimizer/params.ts) and packages them into a typed
// `KernelParams` object so a version can be stored, displayed, and compared.
// Reading the constants here means a snapshot can never drift from the engine.
// ════════════════════════════════════════════════════════════════════════

import {
  SOC_FLOOR_HARD,
  SOC_EV_RESERVE,
  SOC_TRADING_LOW,
  SOC_TRADING_HIGH,
  BATT_CAPACITY_KWH,
  BATT_MAX_POWER_KW,
  SOC_BALANCE_SPAN_PCT,
  ROUND_TRIP_EFF,
  WEAR_COST_EUR_PER_MWH,
  GRID_IMPORT_LIMIT_KW,
  GRID_REAL_POWER_CAP_KW,
} from "./dispatch-kernel"
import {
  LEGACY_FIXED_RESERVE_DEFAULTS,
  OPTIMIZER_DEFAULTS,
  GRID_MAX_KW,
  DISCHARGE_MAX_KW,
  CHARGE_EFFICIENCY,
  DISCHARGE_EFFICIENCY,
  CYCLE_COST_EUR_PER_MWH_PER_DIRECTION,
  type OptimizerParams,
} from "./optimizer/params"

/**
 * Which dispatch engine a version runs. There is now exactly ONE engine — the
 * LP (lib/optimizer/solver). The union is kept single-valued (rather than removed) so
 * stored rows, the backtest guard, and the UI keep an explicit engine tag.
 */
export type DispatchEngine = "v4-mpc"

/** The tunable parameter surface of the dispatch engine. */
export interface KernelParams {
  // Battery / SOC bands
  socFloorHard: number
  socEvReserve: number
  socTradingLow: number
  socTradingHigh: number
  battCapacityKwh: number
  battMaxPowerKw: number
  socBalanceSpanPct: number
  // Economics
  roundTripEff: number
  wearCostEurPerMwh: number
  // Grid
  gridImportLimitKw: number
  /**
   * Sustained REAL-power planning ceiling (kW) — per-station (multi-location).
   * Optional for backward compatibility with stored versions: absent means the
   * Gronau kernel constant GRID_REAL_POWER_CAP_KW (83.5).
   */
  gridRealPowerCapKw?: number
  /** Dispatch engine tag. Always "v4-mpc" (historical tag) — the single LP engine. */
  engine: DispatchEngine
  /** The optimizer parameter block — the LP's physical model + tuning. */
  mpc: OptimizerParams
}

/** Fields the backtest engine can actually apply at runtime (genuine inputs). */
export const APPLIED_PARAM_KEYS = [
  "gridImportLimitKw",
  "gridRealPowerCapKw",
  // Selects the dispatch engine; when "v4-mpc" the entire `mpc` block is applied
  // by the LP solver. (Single engine today, but kept explicit for the backtest.)
  "engine",
] as const
export type AppliedParamKey = (typeof APPLIED_PARAM_KEYS)[number]

/** Whether a given param is applied at runtime or recorded snapshot-only. */
export function isAppliedParam(key: keyof KernelParams): boolean {
  return (APPLIED_PARAM_KEYS as readonly string[]).includes(key)
}

/** The shared base fields common to every stored version, read from the kernel. */
function getBaseParams(): Omit<KernelParams, "engine" | "mpc"> {
  return {
    socFloorHard: SOC_FLOOR_HARD,
    socEvReserve: SOC_EV_RESERVE,
    socTradingLow: SOC_TRADING_LOW,
    socTradingHigh: SOC_TRADING_HIGH,
    battCapacityKwh: BATT_CAPACITY_KWH,
    battMaxPowerKw: BATT_MAX_POWER_KW,
    socBalanceSpanPct: SOC_BALANCE_SPAN_PCT,
    roundTripEff: ROUND_TRIP_EFF,
    wearCostEurPerMwh: WEAR_COST_EUR_PER_MWH,
    gridImportLimitKw: GRID_IMPORT_LIMIT_KW,
    gridRealPowerCapKw: GRID_REAL_POWER_CAP_KW,
  }
}

/**
 * The "v4" (historical DB label) parameter set — the LP with a FLAT reserve
 * floor. Carries the METERED ChargePost physical model (190 kWh usable, 90 kW
 * grid cap, η=0.94, 35% reserve floor) in its `mpc` block, plus the hard
 * self-consumption throughput cap. Base battery/economics fields surface the
 * metered values so the params table reflects the engine actually running.
 */
export function getV4Params(): KernelParams {
  return {
    ...getBaseParams(),
    gridImportLimitKw: GRID_MAX_KW,
    battMaxPowerKw: DISCHARGE_MAX_KW,
    roundTripEff: Math.round(CHARGE_EFFICIENCY * DISCHARGE_EFFICIENCY * 1000) / 1000,
    wearCostEurPerMwh: CYCLE_COST_EUR_PER_MWH_PER_DIRECTION,
    engine: "v4-mpc",
    mpc: { ...LEGACY_FIXED_RESERVE_DEFAULTS },
  }
}

/**
 * The CURRENT PRODUCTION parameter set ("v5" as a historical DB label). Same LP
 * engine, but with the ADAPTIVE, uncertainty-sized reserve instead of the
 * legacy flat planning floor. The planning floor becomes time-varying: a low
 * base floor (SOC_FLOOR_FRAC) plus a cushion sized from the per-hour
 * demand-forecast spread (P90 − mean) over a short protective lookahead. Keeps
 * the pack fuller exactly when EV-arrival uncertainty is high and leaner when
 * demand is predictable. Inherits every other legacy field unchanged.
 */
export function getCurrentParams(): KernelParams {
  return {
    ...getV4Params(),
    engine: "v4-mpc", // same LP engine; the adaptive reserve lives in the mpc block
    mpc: { ...OPTIMIZER_DEFAULTS },
  }
}

/** @deprecated Historical alias — use getCurrentParams(). Kept for stored-row mapping. */
export const getV5Params = getCurrentParams

/**
 * Merge a partial override onto the PRODUCTION DEFAULT baseline, so a call
 * with no override reproduces the deployed engine. Draft/candidate versions pass
 * an override (typically a tweaked `mpc` block) to explore the single engine's
 * parameter space.
 */
export function resolveParams(override?: Partial<KernelParams>): KernelParams {
  return { ...getCurrentParams(), ...(override ?? {}) }
}

/** Human-friendly metadata for rendering the params table in the UI. */
export interface ParamMeta {
  key: keyof KernelParams
  label: string
  unit: string
  group: "Battery / SOC" | "Economics" | "Grid" | "Engine"
}

// Re-export the optimizer param metadata so the registry UI has a single import.
export { OPTIMIZER_PARAM_META, type OptimizerParams, type OptimizerParamMeta } from "./optimizer/params"

export const PARAM_META: ParamMeta[] = [
  { key: "socFloorHard", label: "Hard SOC floor", unit: "%", group: "Battery / SOC" },
  { key: "socEvReserve", label: "EV-only reserve", unit: "%", group: "Battery / SOC" },
  { key: "socTradingLow", label: "Trading band low", unit: "%", group: "Battery / SOC" },
  { key: "socTradingHigh", label: "Trading band high", unit: "%", group: "Battery / SOC" },
  { key: "battCapacityKwh", label: "Pack capacity", unit: "kWh", group: "Battery / SOC" },
  { key: "battMaxPowerKw", label: "Pack max power", unit: "kW", group: "Battery / SOC" },
  { key: "socBalanceSpanPct", label: "SOC balance span", unit: "pp", group: "Battery / SOC" },
  { key: "roundTripEff", label: "Round-trip efficiency", unit: "η", group: "Economics" },
  { key: "wearCostEurPerMwh", label: "Cycle wear cost", unit: "€/MWh", group: "Economics" },
  { key: "gridImportLimitKw", label: "Grid import limit", unit: "kW", group: "Grid" },
  { key: "gridRealPowerCapKw", label: "Grid real-power cap", unit: "kW", group: "Grid" },
  { key: "engine", label: "Dispatch engine", unit: "", group: "Engine" },
]
