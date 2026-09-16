// ════════════════════════════════════════════════════════════════════════
// DISPATCH KERNEL — single source of truth for the optimizer's decision logic
// ════════════════════════════════════════════════════════════════════════
//
// This module is PURE: no React, no fetch, no DOM, no closure state. It is the
// shared foundation for the single dispatch engine (the v4/v5 LP in
// lib/optimizer/solver). It owns:
//
//   • The battery / grid / connector CONSTANTS and SOC bands.
//   • The wire-format helpers (toWireGridImportW / toWireGridRequestW) and the
//     NO-EXPORT clamp (clampNoExport) that every command passes through.
//   • The DecideTickResult shape the engine emits and toDispatchPayload(), which
//     serialises a decision into the station/charger command payload.
//
// The standalone 15-second dispatch worker (services/dispatch-worker), the live
// optimizer path (lib/dispatch-engine, lib/optimizer/plan-horizon) and the back-test (lib/backtest)
// all import this file, so the live service and the back-test can never silently
// diverge. The legacy v1–v3 heuristic (decideTick / planMeritOrder) was removed
// when the project consolidated onto the single MPC engine.
// ════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS (battery + grid + planner). Centralised here so the worker and
// the sim share identical numbers.
// ─────────────────────────────────────────────────────────────────────────

// Battery parameters (per unit)
export const SOC_FLOOR_HARD = 10 // Absolute pack floor (BMS protection)
export const SOC_EV_RESERVE = 40 // EV-only emergency reserve
export const SOC_TRADING_LOW = 40 // Arbitrage trading band — bottom
export const SOC_TRADING_HIGH = 95 // Arbitrage trading band + charge ceiling — top
// (was 90). This doubles as the per-tick CHARGE ceiling: chargeAvailKwh() and
// the planner both stop charging once a pack reaches this SOC, so the pack now
// fills to 95% instead of 90%. Aligns with TARGET_NEGATIVE_SOC_PCT = 95, which
// previously could never be reached because the charge ceiling was lower.
export const BATT_CAPACITY_KWH = 280 // kWh per battery pack (assumption; the
// device exposes the authoritative usable energy live via
// charger.X.status.battery.E_full / E_empty — prefer those when wired through).
//
// ADS-TEC ChargePost hardware limit: each of the TWO battery packs (one per
// power unit) can charge/discharge at up to 120 kW; combined 240 kW. See §1.3
// device topology + §1.5 "Battery assisted charging". This must match the
// inverter's per-unit throughput rating — raising it lets the kernel command
// more battery power than the hardware allows. Set to 120 kW per the configured
// pack rating (was 110).
export const BATT_MAX_POWER_KW = 120 // Max charge/discharge per battery pack

// SOC gap (percentage points between the two packs) at which the per-unit
// power split goes fully one-sided. Below this the split scales linearly, so
// the lower-SOC pack is charged harder / the higher-SOC pack is discharged
// harder until the two packs converge — mirroring the device's own automatic
// SoC-balancing behaviour (§1.5 "the pack with the lower SoC will get more
// power"), which we must reproduce ourselves in manual mode.
export const SOC_BALANCE_SPAN_PCT = 20

export const ROUND_TRIP_EFF = 0.9 // η — energy retained through one cycle
export const WEAR_COST_EUR_PER_MWH = 8 // Cycle wear cost (~€8/MWh @ Tesla Megapack)

// Grid connection import ceiling (kW). OPERATOR OVERRIDE (Aug 21 2026): the
// fleet is now modelled as a uniform 90 kW import ceiling at EVERY location —
// per-site physical/DSO limits are intentionally ignored for now ("if it hits
// the location limit I don't care for now"). Historical context: spec §1.3/§1.4
// nameplate is 87 kVA apparent power; the real-power plateau was ~83.5 kW at
// PF ≈ 0.96 (see git history for the measured derivation). Both the wire
// clearance envelope and the planning ceiling are pinned to 90 so planning,
// backtest and live command all share one number. Per-station registry rows
// (stations.grid_import_limit_kw / grid_real_power_cap_kw) still override this
// fallback when set — they are all set to 90/90 as of this change.
export const GRID_IMPORT_LIMIT_KW = 90

// REAL-power planning ceiling (kW). OPERATOR OVERRIDE (Aug 21 2026): pinned to
// 90 to match GRID_IMPORT_LIMIT_KW so the planner (min of the two) plans at a
// flat 90 kW everywhere. Was 83.5 (live-measured real-power plateau); the
// derate is deliberately dropped for now per operator instruction.
export const GRID_REAL_POWER_CAP_KW = 90

// ADS-TEC ChargePost connector power ceilings (§1.3 topology, §1.5 "Battery
// assisted charging"). A single power unit delivers up to 150 kW to one EV;
// in coupled / "boost" mode the two units feed one connector for up to 300 kW.
// These are the static fallbacks for the P_cp_lim register (12001/22001) —
// prefer the live per-unit `p_cp_max_w` ceiling when the frame provides it.
export const CONNECTOR_SINGLE_MAX_W = 150_000
export const CONNECTOR_DUAL_MAX_W = 300_000

// Default grid import/export clearance envelope (W) re-asserted each tick.
// DSO-agreed value sourced from site config; the kernel echoes it for
// self-healing (a reboot/fallback can't strand us on a stale clearance) but
// NEVER raises it past the configured value. OPERATOR OVERRIDE (Aug 21 2026):
// bumped 87_000 → 90_000 so the commanded clearance matches the flat 90 kW
// planning ceiling (per-site limits ignored for now).
export const DEFAULT_GRID_CLEARANCE_W = 90_000

// Wire-format normalization for the grid-import CLEARANCE, applied ONLY at the
// send boundary (toDispatchPayload / buildTestPayload) — internal kernel math
// always keeps grid import as a positive magnitude.
//
// station.mgmt.P_grid_clearance (addr 2506) is a UINT32 ceiling: the max grid
// power the site may draw. It is unsigned, so we emit the positive magnitude.
// The client maps the sign convention on their side, so the wire value is the
// plain clearance ceiling (e.g. 87000 W). The non-finite guard falls back to
// the configured clearance envelope.
export function toWireGridImportW(valueW: number): number {
  if (!Number.isFinite(valueW)) return DEFAULT_GRID_CLEARANCE_W
  // Grid-import clearance is a positive (unsigned) ceiling on the wire.
  return Math.abs(Math.round(valueW))
}

// Wire-format normalization for the active grid SETPOINT written to
// station.mgmt.P_grid_request (2505), applied ONLY at the send boundary.
//
// SIGN CONVENTION (this device): grid IMPORT is NEGATIVE, export is positive.
// The kernel keeps grid import as a positive magnitude internally, so a
// clearance/import of 87 kW becomes -87000 W on the wire. A non-finite guard
// falls back to the configured clearance envelope, also negated (import).
export function toWireGridRequestW(valueW: number): number {
  const magnitude = Number.isFinite(valueW) ? Math.abs(Math.round(valueW)) : DEFAULT_GRID_CLEARANCE_W
  // Negative = import. (We never command export today; if/when we do, callers
  // would pass a value flagged for export and this helper would flip accordingly.)
  return -magnitude
}

// Tolerance (kW) below which a grid-vs-demand surplus is treated as noise, not
// an intentional battery charge. Keeps tiny rounding/forecast jitter from
// triggering a spurious non-zero import command.
const GRID_CHARGE_EPS_KW = 0.1

/**
 * The grid import we actually COMMAND (P_grid_request), given the LP's planned
 * grid draw `gridKw` (g[t]) for that slot: the FULL planned g[t] (any g > eps).
 *
 * WHY (reverses the old "only command the g>demand charging surplus" rule): that
 * rule assumed the device auto-draws the demand portion from the grid when
 * P_grid_request ≈ 0. Live BMS-baseline evidence (chargepost_gronau_001) showed
 * the OPPOSITE — with request ≈ 0 the station serves load from the BATTERY. So
 * in the day's cheapest slots (optimal plan g ≈ demand: buy cheap grid, spare
 * the battery) the request collapsed to 0 and the battery got cycled, then
 * refilled later at a higher price. Worse, when a car draws MORE than the grid
 * headroom, the clamped clearance (≤ cap < demand) was ALWAYS zeroed — the
 * battery served the whole car even at near-zero prices.
 *
 * We therefore command the full planned draw:
 *   • g[t]  when g > eps → grid serves demand up to the plan (battery spared /
 *                          charged); the battery only covers the excess above it;
 *   • 0     when g ≈ 0   → intentional battery discharge / idle slots (the LP
 *                          plans g = 0 exactly when the battery should serve).
 * The clearance ENVELOPE (P_grid_clearance_w) is unaffected and still set to the
 * full import limit. `demandKw` is kept in the signature for call-site
 * compatibility but no longer participates in the decision.
 */
export function commandedGridImportKw(gridKw: number, _demandKw?: number): number {
  if (!Number.isFinite(gridKw) || gridKw <= GRID_CHARGE_EPS_KW) return 0
  return gridKw
}

// 15-minute auction slot length, in ms.
export const SLOT_MS = 900_000

// ─────────────────────────────────────────────────────────────────────────
// MERIT-ORDER REPLANNER
// ─────────────────────────────────────────────────────────────────────────

export interface SlotPrice {
  /** Absolute slot index (15-min). */
  slot: number
  /** Average DAM €/MWh in that slot. */
  priceEurMwh: number
}

// ─────────────────────────────────────────────────────────────────────────
// PER-TICK DISPATCH DECISION
// ─────────────────────────────────────────────────────────────────────────

/** Amperio DispatchMetadata.price_zone enum (from the OpenAPI schema). */
export type ApiPriceZone = "cheap" | "moderate" | "expensive" | "peak"

/**
 * Live physical limits for one battery pack, sourced from the device's
 * telemetry registers. All optional — when omitted the kernel falls back to
 * the static spec constants (`BATT_MAX_POWER_KW`, geometric SoC headroom from
 * `BATT_CAPACITY_KWH`). When present, the live value is combined with the
 * kernel's trading-band policy via `min(...)`, so the kernel never commands
 * more than the hardware currently reports it can absorb/deliver.
 */
export interface PackLiveLimits {
  /** `charger.X.status.battery.E_full` — usable energy for CHARGING (kWh room until full). */
  chargeHeadroomKwh?: number
  /** `charger.X.status.battery.E_empty` — usable energy for DISCHARGING (kWh until empty). */
  dischargeHeadroomKwh?: number
  /** `battery.max_charge_w / 1000` — max charge power for this pack (kW). */
  maxChargeKw?: number
  /** `battery.max_discharge_w / 1000` — max discharge power for this pack (kW). */
  maxDischargeKw?: number
}

/**
 * Optional live device limits that override the static spec constants for one
 * tick. Build this from the latest telemetry frame in the caller; omit it (or
 * any field) to keep using the hard-coded defaults.
 */
export interface LiveLimits {
  /** `station.P_grid_consumption_limit_w / 1000` — dynamic grid import ceiling (kW). */
  gridImportLimitKw?: number
  /** Per-pack physical limits. Index 0 = pack B1, index 1 = pack B2. */
  packs?: [PackLiveLimits, PackLiveLimits]
}

/**
 * Build a {@link LiveLimits} from raw telemetry-frame fields (snake_case, watts
 * and kWh as the device reports them). Decoupled from any concrete frame type
 * so both the server dispatcher and the standalone worker can call it. Returns
 * `undefined` when nothing usable is present, so callers can pass it straight
 * through and transparently fall back to the static constants.
 *
 * Watts are converted to kW. `batteries[0]` maps to pack B1, `[1]` to B2.
 */
export function buildLiveLimits(raw: {
  gridConsumptionLimitW?: number | null
  batteries?: Array<
    | {
        max_charge_w?: number | null
        max_discharge_w?: number | null
        energy_full_kwh?: number | null
        energy_empty_kwh?: number | null
      }
    | undefined
  >
}): LiveLimits | undefined {
  const toKwPos = (w?: number | null) => (w != null && w > 0 ? w / 1000 : undefined)
  const toKwhPos = (v?: number | null) => (v != null && v >= 0 ? v : undefined)

  const pack = (i: number): PackLiveLimits => {
    const b = raw.batteries?.[i]
    return {
      maxChargeKw: toKwPos(b?.max_charge_w),
      maxDischargeKw: toKwPos(b?.max_discharge_w),
      chargeHeadroomKwh: toKwhPos(b?.energy_full_kwh),
      dischargeHeadroomKwh: toKwhPos(b?.energy_empty_kwh),
    }
  }

  const gridImportLimitKw = toKwPos(raw.gridConsumptionLimitW)
  const packs: [PackLiveLimits, PackLiveLimits] = [pack(0), pack(1)]

  // Collapse to undefined when there's genuinely nothing to override with.
  const anyPack = packs.some((p) => Object.values(p).some((v) => v != null))
  if (gridImportLimitKw == null && !anyPack) return undefined
  return { gridImportLimitKw, packs }
}

// ─────────────────────────────────────────────────────────────────────────
// AUTOMATIC-MODE DISPATCH RESULT: DecideTickResult + toDispatchPayload
// ─────────────────────────────────────────────────────────────────────────
//
// The engine runs the station in AUTOMATIC `grid_mgmt_mode=0` with a single
// `P_grid_clearance` dial. The station firmware handles EV protection and the
// per-unit battery split internally; the optimizer modulates only the grid ceiling
// against price and sets an anticipatory `soc_reserve` floor.
//
// Why this is simpler and better:
//   • No balancing-services revenue → no need to hit precise import schedules.
//   • Pure self-consumption arbitrage: buy cheap, store, lean on buffer when
//     expensive so we import less during those hours.
//   • EV protection for free: the station automatically supplements from battery
//     when EV demand exceeds clearance.
//   • Export-safe by construction: clearance ≥ 0, we never command export.
//   • One dial: `P_grid_clearance` modulated by price.
//
// Control surface (automatic mode):
//   2501  operation_mode     1 (external EMS control)
//   2502  grid_mgmt_mode     0 (Automatic)
//   2506  P_grid_clearance   The single lever: max grid import the station is
//                            allowed. Station draws from battery to cover any
//                            EV demand above this.
//   517   soc_reserve        Floor SoC the station must maintain. Set dynamically
//                            based on anticipated EV demand.
//   515   soc_cp_max         Target charge SoC. Set to SOC_TRADING_HIGH (95%).
//   P_cp_lim                 Per-connector EV ceiling — keep for safety clamp.
// ─────────────────────────────────────────────────────────────────────────

export interface DecideTickResult {
  /** Grid clearance (kW) — the ONE lever: P_grid_clearance. */
  clearanceKw: number
  /** Anticipatory reserve SoC (%) — soc_reserve. */
  reserveSocPct: number
  /** Target charge SoC (%) — soc_cp_max. Fixed at SOC_TRADING_HIGH. */
  targetSocPct: number
  /** Price eagerness 0..1 (0 = cheap → max clearance, 1 = expensive → min clearance). */
  eagerness: number
  /** Anticipated EV energy need (kWh) driving the reserve. */
  anticipatedEvKwh: number
  /** Expensive threshold price (€/MWh) used for reserve weighting. */
  expensiveThresholdEurMwh: number
}

// ──────────────────────────────────────────���──────────────────────────────
// NO-EXPORT INVARIANT
// ─────────────────────────────────────────────────────────────────────────
//
// Hard site rule: this connection has NO grid-export contract. In the KERNEL
// frame a grid setpoint is positive = import, so a commanded export is any
// NEGATIVE grid setpoint. The MPC engine never produces one (clearance >= 0),
// so this helper is a guard/assertion: it clamps any
// negative setpoint to 0 and reports whether it had to. Applied in the backtest
// engine; available to the live payload boundary if ever wired there.
export interface NoExportResult {
  /** Grid setpoint after clamping (kW, >= 0). */
  gridKw: number
  /** True if the input implied export (negative) and was clamped. */
  clamped: boolean
}

export function clampNoExport(gridKw: number): NoExportResult {
  if (Number.isFinite(gridKw) && gridKw < 0) {
    return { gridKw: 0, clamped: true }
  }
  return { gridKw, clamped: false }
}

/**
 * Classify a price (€/MWh) into the Amperio API's price_zone enum.
 * The API only allows: cheap | moderate | expensive | peak. When the price is
 * unknown we default to "moderate" (the API has no "unknown" member).
 */
export function classifyPriceZone(priceEurMwh: number | null | undefined): ApiPriceZone {
  if (priceEurMwh == null || !Number.isFinite(priceEurMwh)) return "moderate"
  if (priceEurMwh < 50) return "cheap"
  if (priceEurMwh < 120) return "moderate"
  if (priceEurMwh < 250) return "expensive"
  return "peak"
}

// ─────────────────────────────────────────────────────────────────────────
// DISPATCH PAYLOAD (Amperio /api/v1/commands/dispatch envelope)
// ─────────────────────────────────────────────────────────────────────────

/**
 * `charger.X.config.charging_mode` (Modbus). Topology + EV-enable state:
 *   0 = Off       — unit idle: no EV plugged and no battery↔grid arbitrage.
 *   1 = Single    — one connector, up to 150 kW to the EV.
 *   2 = Dual      — coupled / "boost": the two units feed one connector (≤300 kW).
 *   3 = Disabled  — EV charging disabled, but the unit still runs battery↔grid
 *                   arbitrage (grid-only operation, nothing flows to a vehicle).
 */
export type ChargingMode = 0 | 1 | 2 | 3

/** Live per-unit state used to derive charging_mode + the EV power clamp. */
export interface UnitLiveState {
  /** `plug_state === "Plugged"`. */
  plugged?: boolean
  /** `boost_contactor === "closed"` → the two units are coupled onto one connector. */
  coupled?: boolean
  /** Live connector power ceiling (W) — `p_cp_max_w` (the CHARGER hardware max). */
  connectorMaxW?: number
  /**
   * Live vehicle acceptance ceiling (W) — `p_ev_max_w`, the max rate the CAR
   * currently plugged into this connector will accept (negotiated per session;
   * differs car-to-car and tapers as the car nears full). Used together with
   * `connectorMaxW` so the commanded EV ceiling never exceeds what the car can
   * physically take. Absent/0 when no car has reported a rate yet → ignored.
   */
  evMaxW?: number
}

/**
 * Auto-select `charging_mode` for one power unit from its live plug / coupling
 * state. In automatic mode we don't have per-unit grid setpoints; we just
 * indicate topology state. Serving a plugged EV → Dual when coupled, else Single;
 * with no EV plugged → Off (station handles everything internally).
 */
export function selectChargingMode(args: {
  plugged?: boolean
  coupled?: boolean
}): ChargingMode {
  if (args.plugged) return args.coupled ? 2 : 1
  return 0
}

/**
 * Safety-clamp EV power ceiling (W) for `P_cp_lim`. Per the agreed policy the
 * kernel NEVER throttles the EV for arbitrage — it offers as much power as the
 * hardware AND the car allow, so the vehicle always receives full power and the
 * grid lever does all the arbitrage.
 *
 * The ceiling is the MINIMUM of two live limits (lowest wins):
 *   • `connectorMaxW` (`p_cp_max_w`) — the charger hardware max for this unit.
 *   • `evMaxW`        (`p_ev_max_w`) — the rate the plugged CAR will accept.
 * Either may be absent; we clamp by whichever live value is present and finite,
 * falling back to the static topology limit (Dual/Single) when neither is. This
 * is what makes two different cars on the two connectors get their own ceilings
 * instead of an identical split.
 */
export function evPowerCeilingW(state: UnitLiveState | undefined): number {
  const limits: number[] = []
  if (state?.connectorMaxW != null && Number.isFinite(state.connectorMaxW) && state.connectorMaxW > 0) {
    limits.push(state.connectorMaxW)
  }
  if (state?.evMaxW != null && Number.isFinite(state.evMaxW) && state.evMaxW > 0) {
    limits.push(state.evMaxW)
  }
  if (limits.length > 0) return Math.round(Math.min(...limits))
  return state?.coupled ? CONNECTOR_DUAL_MAX_W : CONNECTOR_SINGLE_MAX_W
}

// ─────────────────────────────────────────────────────────────────────────
// v3 DISPATCH PAYLOAD — Automatic Grid Mode
// ─────────────────────────────────────────────────────────────────────────

export interface DispatchPayloadContext {
  siteId: string
  assetId: string
  /** ISO timestamp for the command. Defaults to now. */
  timestamp?: string
  /** How long the setpoint is valid before auto-revert (ms). Defaults to 15s. */
  validForMs?: number
  /** Current DAM/IDM price (€/MWh) used to classify the price zone metadata. */
  priceEurMwh?: number
  /**
   * Charger unit ids present on the asset, ORDERED so index 0 is the unit
   * bound to pack B1 and index 1 the unit bound to pack B2. Defaults to [1, 2].
   */
  chargerUnitIds?: number[]
  /**
   * Station operating mode to assert. Defaults to 1 (Active) — every dispatch
   * tick claims active external control. Set to 0 to hand the station back to
   * standby (e.g. when stopping the dispatcher).
   */
  operationMode?: 0 | 1
  /**
   * Live per-unit state (keyed by unit id, matching `chargerUnitIds`) used to
   * auto-select each unit's `charging_mode` and EV power safety clamp. Optional
   * — when a unit is absent the kernel falls back to topology defaults.
   */
  perUnitState?: Array<{ unitId: number } & UnitLiveState>
  /**
   * The triggering event type (e.g. "price_update", "ev_plug_event", "test").
   * Echoed verbatim into `metadata.event_type` for audit / traceability so the
   * edge device and operator log can see WHY each command fired. Optional —
   * scheduled pinger ticks omit it.
   */
  eventType?: string
  /**
   * Grid import ENVELOPE (kW) — the ceiling written to P_grid_clearance_w. This
   * is the DSO/connection import limit (live `station.P_grid_consumption_limit`
   * when reported, else the configured GRID_IMPORT_LIMIT_KW), NOT the active
   * setpoint. The active setpoint (how much we actually import this tick) goes to
   * P_grid_request_w from `decision.clearanceKw`. Keeping them separate is the
   * whole point: clearance = "never exceed this", request = "import this now".
   * Defaults to DEFAULT_GRID_CLEARANCE_W when omitted.
   */
  gridImportLimitKw?: number
}

export interface DispatchChargerSetpoint {
  unit_id: number
  /**
   * `charger.X.config.charging_mode` — auto-selected per tick from live plug /
   * coupling state (see `selectChargingMode`). 0=Off, 1=Single, 2=Dual.
   * (Mode 3=Disabled removed in v3: no per-unit arbitrage in automatic mode.)
   */
  charging_mode: ChargingMode
  /**
   * `charger.X.mgmt.P_cp_lim` (12001/22001) — max power deliverable to the EV
   * on this connector (W). Safety clamp only: set to the connector max so the
   * vehicle always gets full power; the kernel never throttles EV for arbitrage.
   */
  P_ev_limit_w: number
  /**
   * `charger.X.mgmt.P_grid_request` — requested per-charger grid import (W).
   * REQUIRED by the Amperio dispatch API schema even in Automatic mode
   * (`grid_mgmt_mode=0`), where the station self-manages the split and ignores
   * it. We send 0 so the field is present and valid without overriding
   * automatic control.
   */
  P_grid_request_w: number
}

export interface DispatchStationSetpoint {
  /**
   * Station operating mode — Modbus `station.mgmt.operation_mode` (2501).
   * 0 = Standby (station inactive), 1 = Active (external EMS controls).
   * MUST be 1 for our setpoints to take effect.
   */
  operation_mode: 0 | 1
  /**
   * Grid management mode — Modbus `station.mgmt.grid_mgmt_mode` (2502).
   * v3: ALWAYS 0 (Automatic). The station handles the EV/battery split
   * internally; we control only the clearance and reserve.
   */
  grid_mgmt_mode: 0
  /**
   * `station.mgmt.P_grid_clearance` (2506) — max grid import ceiling (W).
   * The single lever: cheap hours → high clearance (charge battery);
   * expensive hours → low clearance (battery supplements EV).
   */
  P_grid_clearance_w: number
  /**
   * `station.mgmt.P_grid_request` (2505) — active station grid setpoint (W).
   * SIGNED: NEGATIVE = grid import, positive = export. This device honors
   * P_grid_request even in Automatic mode (`grid_mgmt_mode=0`), so this is the
   * lever the kernel actuates — e.g. an 87 kW import clearance is sent as
   * -87000 W. The station tracks it within the positive P_grid_clearance_w
   * envelope. Encoded at the send boundary via `toWireGridRequestW`.
   */
  P_grid_request_w: number
  /**
   * `station.config.soc_reserve` (517) — floor SoC (%) the station must
   * maintain. Set dynamically based on anticipated EV demand so the buffer
   * can cover expensive windows.
   */
  soc_reserve_pct: number
  /**
   * `station.config.soc_cp_max` (515) — target charge SoC (%). Set to
   * SOC_TRADING_HIGH (95%) so the station charges to our desired top.
   */
  soc_cp_max_pct: number
}

export interface DispatchPayload {
  site_id: string
  asset_id: string
  /**
   * Discriminator. "dispatch" = a real, actuating command (default).
   * Lets the edge device branch on the command kind without inspecting values.
   * @see DispatchTestPayload for "test".
   */
  command_type: "dispatch"
  command_id: string
  timestamp: string
  valid_until: string
  /**
   * Audit-only context (never written to Modbus). `price_zone` drives operator
   * copy; `event_type` echoes the trigger that produced this command.
   */
  metadata: { price_zone: ApiPriceZone; event_type?: string }
  /**
   * Station-level command for automatic grid mode. Sets the clearance ceiling
   * and reserve floor; the station handles the EV/battery split internally.
   */
  station: DispatchStationSetpoint
  /** Per-charger topology/EV ceilings. Required (non-empty) by the Amperio API. */
  chargers: DispatchChargerSetpoint[]
}

/**
 * Liveness-probe command. Emitted when the kernel is triggered with a "test"
 * event. It exercises the FULL end-to-end path (Enexa → Middleware → edge) but
 * MUST NOT actuate hardware. Recognition contract for the edge device:
 *
 *   • `command_type === "test"`  ← primary, check this first
 *   • every setpoint value is the literal string `"test"` (secondary sentinel)
 *
 * On either signal the device MUST ignore all setpoints, leave actuation
 * untouched, and ack the command (e.g. status "accepted") so the round trip is
 * proven alive. The envelope fields (ids, timestamps, valid_until) stay valid
 * so the command still flows through normal validation, logging and the
 * Command Status API.
 */
export interface DispatchTestPayload {
  site_id: string
  asset_id: string
  command_type: "test"
  command_id: string
  timestamp: string
  valid_until: string
  // The middleware now validates EVERY field against the real dispatch schema
  // — string "test" placeholders 400 (live-confirmed on the Norderstedt
  // go-live probe, aug 2026: first metadata.price_zone, then
  // station.operation_mode, then the required P_grid_request_w fields).
  // Inert-ness comes from command_type:"test" ALONE; all setpoints must be
  // validly TYPED but are chosen neutral (request 0 W, charging_mode 0).
  metadata: { price_zone: ApiPriceZone; event_type: "test" }
  station: {
    operation_mode: 0 | 1
    grid_mgmt_mode: 0
    P_grid_request_w: number
    P_grid_clearance_w: number
    soc_reserve_pct: number
    soc_cp_max_pct: number
  }
  chargers: Array<{
    unit_id: number
    charging_mode: ChargingMode
    P_grid_request_w: number
    P_ev_limit_w: number
  }>
}

/** Either a real actuating command or an inert liveness-probe command. */
export type AnyDispatchPayload = DispatchPayload | DispatchTestPayload

/** Build a deterministic, idempotent command id from the timestamp + asset. */
function buildCommandId(assetId: string, ts: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0")
  const stamp =
    `${ts.getUTCFullYear()}${pad(ts.getUTCMonth() + 1)}${pad(ts.getUTCDate())}` +
    `_${pad(ts.getUTCHours())}${pad(ts.getUTCMinutes())}${pad(ts.getUTCSeconds())}` +
    `_${pad(ts.getUTCMilliseconds(), 3)}`
  return `cmd_${assetId}_${stamp}`
}

/**
 * v3 toDispatchPayload — automatic grid mode.
 *
 * Maps the kernel decision (clearance + reserve) to the Amperio dispatch envelope.
 * The station operates in `grid_mgmt_mode=0` (Automatic); it handles EV protection
 * and per-unit battery split internally. We set only:
 *   • P_grid_clearance — the one lever
 *   • soc_reserve — anticipatory floor
 *   • soc_cp_max — charge target
 *   • Per-charger P_ev_limit_w — safety clamp
 */
export function toDispatchPayload(
  decision: DecideTickResult,
  ctx: DispatchPayloadContext,
): DispatchPayload {
  const ts = ctx.timestamp ? new Date(ctx.timestamp) : new Date()
  const validForMs = ctx.validForMs ?? 15_000
  const chargerUnitIds = ctx.chargerUnitIds?.length ? ctx.chargerUnitIds : [1, 2]

  // Index live per-unit state by unit id for charging_mode + EV clamp.
  const stateByUnit = new Map(
    (ctx.perUnitState ?? []).map((s) => [s.unitId, s]),
  )

  // Per-charger entry: topology state + EV safety ceiling.
  // In automatic mode we don't set P_grid_request_w — station ignores it.
  const chargers: DispatchChargerSetpoint[] = chargerUnitIds.map((unit_id) => {
    const live = stateByUnit.get(unit_id)
    return {
      unit_id,
      charging_mode: selectChargingMode({
        plugged: live?.plugged,
        coupled: live?.coupled,
      }),
      P_ev_limit_w: evPowerCeilingW(live),
      // Required by the API schema; ignored by the station in Automatic mode.
      P_grid_request_w: 0,
    }
  })

  // P_grid_clearance_w = the import ENVELOPE (DSO/connection ceiling), NOT the
  // setpoint. Sourced from ctx.gridImportLimitKw (live consumption limit or the
  // configured GRID_IMPORT_LIMIT_KW); finite-guard → DEFAULT_GRID_CLEARANCE_W.
  // Always the unsigned positive ceiling the station must never exceed.
  const clearanceW =
    ctx.gridImportLimitKw != null && Number.isFinite(ctx.gridImportLimitKw)
      ? toWireGridImportW(ctx.gridImportLimitKw * 1000)
      : toWireGridImportW(DEFAULT_GRID_CLEARANCE_W)

  // P_grid_request_w = the ACTIVE grid setpoint this tick (how much we import
  // NOW), from decision.clearanceKw. NEGATIVE for import; honored in Automatic
  // mode on this device. e.g. a 38.4 kW import → -38400 W, sitting inside the
  // (larger) positive clearance envelope above.
  const requestW = Number.isFinite(decision.clearanceKw)
    ? toWireGridRequestW(decision.clearanceKw * 1000)
    : toWireGridRequestW(DEFAULT_GRID_CLEARANCE_W)

  // Reserve and target SoC: finite-guard with sensible defaults.
  const reservePct = Number.isFinite(decision.reserveSocPct)
    ? Math.round(decision.reserveSocPct)
    : SOC_TRADING_LOW
  const targetPct = Number.isFinite(decision.targetSocPct)
    ? Math.round(decision.targetSocPct)
    : SOC_TRADING_HIGH

  return {
    site_id: ctx.siteId,
    asset_id: ctx.assetId,
    command_type: "dispatch",
    command_id: buildCommandId(ctx.assetId, ts),
    timestamp: ts.toISOString(),
    valid_until: new Date(ts.getTime() + validForMs).toISOString(),
    metadata: {
      price_zone: classifyPriceZone(ctx.priceEurMwh),
      ...(ctx.eventType ? { event_type: ctx.eventType } : {}),
    },
    // v3 Automatic mode: clearance + reserve + target. No per-unit P_grid.
    station: {
      operation_mode: ctx.operationMode ?? 1,
      grid_mgmt_mode: 0, // Automatic — this device honors P_grid_request here.
      // Positive import ceiling (safety envelope).
      P_grid_clearance_w: clearanceW,
      // Active grid setpoint, NEGATIVE = import. Honored in Automatic mode on
      // this device; the station tracks it within the clearance envelope above.
      P_grid_request_w: requestW,
      soc_reserve_pct: reservePct,
      soc_cp_max_pct: targetPct,
    },
    chargers,
  }
}

/** The reserved event type that triggers a liveness-probe (test) command. */
export const TEST_EVENT_TYPE = "test" as const

/**
 * Build an inert liveness-probe command (`command_type: "test"`).
 *
 * Used to verify the full end-to-end dispatch path — Enexa → Middleware → edge
 * device → Command Status API — WITHOUT actuating any hardware. Every setpoint
 * is the literal string `"test"`; the envelope (ids, timestamps, valid_until)
 * is real so the command flows through normal validation and logging. The edge
 * device recognises it via `command_type === "test"` (or the `"test"` sentinel
 * values) and MUST ignore all setpoints while still acking the command.
 *
 * Mirrors `toDispatchPayload`'s envelope construction so the two stay aligned.
 */
export function buildTestPayload(ctx: DispatchPayloadContext): DispatchTestPayload {
  const ts = ctx.timestamp ? new Date(ctx.timestamp) : new Date()
  const validForMs = ctx.validForMs ?? 15_000
  const chargerUnitIds = ctx.chargerUnitIds?.length ? ctx.chargerUnitIds : [1, 2]

  return {
    site_id: ctx.siteId,
    asset_id: ctx.assetId,
    command_type: "test",
    command_id: buildCommandId(ctx.assetId, ts),
    timestamp: ts.toISOString(),
    valid_until: new Date(ts.getTime() + validForMs).toISOString(),
    // NEUTRAL, schema-valid values throughout — the middleware validates every
    // field against the real dispatch schema and rejects "test" placeholders
    // (live-confirmed aug 2026). command_type:"test" alone marks the command
    // inert; these values would be harmless even if actuated: request 0 W,
    // clearance at the configured envelope, charging_mode 0 (Off), price zone
    // "moderate" (the unknown-price default in classifyPriceZone).
    metadata: { price_zone: "moderate", event_type: "test" },
    station: {
      operation_mode: ctx.operationMode ?? 1,
      grid_mgmt_mode: 0,
      P_grid_request_w: 0,
      P_grid_clearance_w: DEFAULT_GRID_CLEARANCE_W,
      soc_reserve_pct: SOC_EV_RESERVE,
      soc_cp_max_pct: SOC_TRADING_HIGH,
    },
    chargers: chargerUnitIds.map((unit_id) => ({
      unit_id,
      charging_mode: 0 as ChargingMode,
      P_grid_request_w: 0,
      P_ev_limit_w: evPowerCeilingW(ctx.perUnitState?.find((u) => u.unitId === unit_id)),
    })),
  }
}
