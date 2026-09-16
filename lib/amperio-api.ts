/**
 * Amperio Backend API Client
 *
 * Type-safe client for the Amperio telemetry ingestor API.
 * Base URL: https://amperio.enexa.me/api/v1
 *
 * All responses use gzip compression automatically when the browser
 * sends `Accept-Encoding: gzip` (which fetch does by default).
 */

// ─────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────

// Use local proxy to avoid CORS issues
// The proxy at /api/amperio/[...path] forwards to the Amperio backend at /api/v1/[...path]
const API_BASE = "/api/amperio"

// ─────────────────────────────────────────────────────────────────────
// Response Types (matching backend OpenAPI schema)
// ─────────────────────────────────────────────────────────────────────

/** Grid telemetry sub-object */
export interface ApiGridState {
  ts: string
  p_grid_w: number
  e_grid_imp_kwh: number | null
  e_grid_exp_kwh: number | null
  p_aux_w: number
  f_grid_hz: number
  cos_phi: number
}

/** Battery unit telemetry */
export interface ApiBatteryState {
  station_id: string
  unit_id: number
  ts: string
  soc_pct: number
  power_w: number
  temp_min_c: number
  temp_max_c: number
  max_charge_w: number
  max_discharge_w: number
  energy_empty_kwh: number
  energy_full_kwh: number
  contactor_state: "open" | "closed" | "fault"
}

/** Charger unit telemetry */
export interface ApiChargerState {
  station_id: string
  unit_id: number
  ts: string
  charging_state: string
  charging_process_state: string
  plug_state: "Plugged" | "Unplugged"
  p_ev_w: number
  p_ev_max_w: number
  p_cp_max_w: number
  p_grid_chg_max_w: number
  p_grid_dischg_max_w: number
  soc_ev_pct: number | null
  t_bulk_s: number | null
  t_full_s: number | null
  e_ev_chg_kwh: number
  e_evse_kwh: number
  boost_contactor: "open" | "closed"
  grid_contactor_state: "open" | "closed"
}

/** Station-level status */
export interface ApiStationState {
  station_id: string
  ts: string
  operation_state: string
  p_grid_consumption_limit_w: number
  p_grid_generation_limit_w: number
  warnings: string[]
  errors: string[]
}

/** Embedded price snapshot */
export interface ApiPriceSnapshot {
  bucket_ts: string
  dam: number
  idm: number
}

/** Full telemetry frame from /telemetry/latest or /telemetry/frames */
export interface ApiTelemetryFrame {
  station_id: string
  ts: string
  sequence_number: number
  age_ms?: number // only on /latest
  grid: ApiGridState
  batteries: ApiBatteryState[]
  chargers: ApiChargerState[]
  station: ApiStationState
  prices: ApiPriceSnapshot
}

/** Bulk frames response from /telemetry/frames */
export interface ApiFramesResponse {
  station_id: string
  step_seconds: number
  frames: ApiTelemetryFrame[]
}

/** Price point from /prices */
export interface ApiPricePoint {
  ts: string
  price_eur_mwh: number
}

/** Prices response from /prices */
export interface ApiPricesResponse {
  source: "DAM" | "IDM"
  region: string
  resolution: string
  prices: ApiPricePoint[]
  stats: {
    min: number
    max: number
    avg: number
    spread: number
  }
}

/** Session from /telemetry/sessions */
export interface ApiEvSession {
  unit_id: number
  session_start: string
  session_end: string
  duration_minutes: number
  energy_kwh: number
  peak_power_w: number
  avg_power_w: number
}

export interface ApiBatterySession {
  unit_id: number
  mode: "charging" | "discharging"
  session_start: string
  session_end: string
  duration_minutes: number
  energy_kwh: number
  peak_power_w: number
  avg_power_w: number
}

export interface ApiSessionsResponse {
  station_id: string
  from: string
  to: string
  ev_sessions: ApiEvSession[]
  battery_sessions: ApiBatterySession[]
}

/** Cost bucket from /telemetry/cost */
export interface ApiCostBucket {
  bucket_ts: string
  energy_kwh: number
  price_eur_mwh: number
  cost_eur: number
  cumulative_cost_eur: number
}

export interface ApiCostResponse {
  station_id: string
  from: string
  to: string
  source: "DAM" | "IDM"
  buckets: ApiCostBucket[]
  total: {
    energy_kwh: number
    cost_eur: number
    avg_price_eur_mwh: number
  }
}

/** Station config from /stations/:id/config */
export interface ApiStationConfig {
  station_id: string
  site_id: string
  asset_id: string
  middleware_version: string
  first_seen_at: string
  battery_units: number[]
  charger_units: number[]
}

/** Station list item from /stations */
export interface ApiStationListItem {
  station_id: string
  site_id: string
  asset_id: string
  middleware_version: string
  first_seen_at: string
}

// ─────────────────────────────────────────────────────────────────────
// API Client Functions
// ─────────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  // Build URL with query params - use relative path for the proxy
  let url = `${API_BASE}${path}`
  if (params) {
    const searchParams = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        searchParams.set(k, v)
      }
    })
    const qs = searchParams.toString()
    if (qs) {
      url += `?${qs}`
    }
  }

  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }

  return res.json()
}

/**
 * Get the latest telemetry frame for a station.
 * This is a snapshot of the most recent reading.
 */
export async function getLatestFrame(stationId: string): Promise<ApiTelemetryFrame> {
  return apiFetch<ApiTelemetryFrame>("/telemetry/latest", {
    station_id: stationId,
  })
}

/**
 * Get bulk telemetry frames for replay/scrubbing.
 * Returns frames sub-sampled at the specified interval.
 *
 * @param stationId - Station ID
 * @param from - ISO-8601 datetime with timezone (e.g. "2026-05-10T06:00:00+02:00")
 * @param to - ISO-8601 datetime with timezone
 * @param stepSeconds - Sub-sample interval (1=raw, 60=1min, 300=5min)
 */
export async function getFrames(
  stationId: string,
  from: string,
  to: string,
  stepSeconds: number = 60
): Promise<ApiFramesResponse> {
  return apiFetch<ApiFramesResponse>("/telemetry/frames", {
    station_id: stationId,
    from,
    to,
    step_seconds: stepSeconds.toString(),
  })
}

/**
 * Get telemetry history (grid + battery aggregates).
 *
 * @param resolution - One of: raw, 1m, 5m, 15m, 1h, 1d
 */
export async function getHistory(
  stationId: string,
  from: string,
  to: string,
  resolution: "raw" | "1m" | "5m" | "15m" | "1h" | "1d" = "1m"
): Promise<unknown> {
  return apiFetch("/telemetry/history", {
    station_id: stationId,
    from,
    to,
    resolution,
  })
}

/**
 * Get EV and battery sessions (plug-in intervals).
 */
export async function getSessions(
  stationId: string,
  from: string,
  to: string,
  options?: { gapMinutes?: number; batteryThresholdW?: number }
): Promise<ApiSessionsResponse> {
  const params: Record<string, string> = {
    station_id: stationId,
    from,
    to,
  }
  if (options?.gapMinutes) params.gap_minutes = options.gapMinutes.toString()
  if (options?.batteryThresholdW) params.battery_threshold_w = options.batteryThresholdW.toString()

  return apiFetch<ApiSessionsResponse>("/telemetry/sessions", params)
}

/**
 * Get energy cost breakdown over a period.
 *
 * @param source - Price source: "DAM" or "IDM"
 */
export async function getCost(
  stationId: string,
  from: string,
  to: string,
  source: "DAM" | "IDM" = "IDM"
): Promise<ApiCostResponse> {
  return apiFetch<ApiCostResponse>("/telemetry/cost", {
    station_id: stationId,
    from,
    to,
    source,
  })
}

/**
 * Get EPEX power prices (DAM or IDM).
 *
 * @param source - "DAM" or "IDM"
 * @param resolution - "PT15M" (15-min) or "PT60M" (hourly)
 */
export async function getPrices(
  source: "DAM" | "IDM",
  from: string,
  to: string,
  resolution: "PT15M" | "PT60M" = "PT60M"
): Promise<ApiPricesResponse> {
  return apiFetch<ApiPricesResponse>("/prices", {
    source,
    from,
    to,
    resolution,
  })
}

/**
 * List all stations.
 */
export async function listStations(): Promise<ApiStationListItem[]> {
  return apiFetch<ApiStationListItem[]>("/stations")
}

/**
 * Get station configuration.
 */
export async function getStationConfig(stationId: string): Promise<ApiStationConfig> {
  return apiFetch<ApiStationConfig>(`/stations/${stationId}/config`)
}

// ─────────────────────────────────────────────────────────────────────
// Commands (Amperio is the master record — we never store these locally)
// ─────────────────────────────────────────────────────────────────────

/** Lifecycle status of a dispatch command, as tracked by Amperio. */
export type CommandStatus =
  | "accepted"
  | "executing"
  | "executed"
  | "deviated"
  | "superseded"
  | "timed_out"
  | "rejected"

/**
 * A dispatch command as returned by GET /api/v1/commands. Normalized into a
 * flat, UI-friendly shape. The backend response schema is loosely specified
 * (the envelope mirrors DispatchRequest plus a status), so every field is
 * optional and parsed defensively.
 */
export interface ApiCommand {
  commandId: string
  siteId: string | null
  assetId: string | null
  /** When the command was issued (ISO). */
  timestamp: string | null
  /** When the command stops being valid (ISO). */
  validUntil: string | null
  /** Requested grid setpoint in watts (positive = import). */
  pGridRequestW: number | null
  priceZone: string | null
  gateReason: string | null
  status: CommandStatus | null
  /** Latest deviation from setpoint, if Amperio reported one (%). */
  deviationPct: number | null
  /** The full, unmodified record as returned by Amperio (for payload inspection). */
  raw: Record<string, unknown>
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null
}

/** Normalize one raw command record (tolerant of nested vs flat shapes). */
function normalizeCommand(raw: Record<string, unknown>): ApiCommand {
  const station = (raw.station ?? {}) as Record<string, unknown>
  const metadata = (raw.metadata ?? {}) as Record<string, unknown>

  // Status lifecycle: Amperio reports the rolled-up state as `current_status`
  // and the full history as `status_events[]` (newest changes appended). Older
  // shapes used a flat `status` / `command_status`. Read them in that order,
  // falling back to the last status event so the column is never "unknown" when
  // the API actually told us a state.
  const statusEvents = Array.isArray(raw.status_events)
    ? (raw.status_events as Array<Record<string, unknown>>)
    : []
  const lastEvent = statusEvents.length > 0 ? statusEvents[statusEvents.length - 1] : null
  const status = (asString(raw.current_status) ??
    asString(raw.status) ??
    asString(raw.command_status) ??
    (lastEvent ? asString(lastEvent.status) : null)) as CommandStatus | null

  // Deviation, if any, lives on the status events; prefer the most recent one
  // that actually carries a value, then fall back to any flat field.
  const eventDeviation = [...statusEvents]
    .reverse()
    .map((e) => asNumber(e.deviation_pct))
    .find((v) => v != null)

  return {
    commandId: asString(raw.command_id) ?? asString(raw.commandId) ?? "(unknown)",
    siteId: asString(raw.site_id) ?? asString(raw.siteId),
    assetId: asString(raw.asset_id) ?? asString(raw.assetId),
    timestamp: asString(raw.timestamp) ?? asString(raw.event_ts) ?? asString(raw.received_at),
    validUntil: asString(raw.valid_until) ?? asString(raw.validUntil),
    pGridRequestW: asNumber(station.P_grid_request_w) ?? asNumber(raw.P_grid_request_w),
    priceZone: asString(metadata.price_zone) ?? asString(raw.price_zone),
    gateReason: asString(metadata.gate_reason) ?? asString(raw.gate_reason),
    status,
    deviationPct: eventDeviation ?? asNumber(raw.deviation_pct) ?? asNumber(raw.deviationPct),
    raw,
  }
}

/**
 * List recent dispatch commands for a site, newest first.
 * Amperio is the source of truth — this app does not persist commands itself.
 *
 * @param siteId - Required tenant/site id (e.g. "site_gronau_01").
 * @param limit  - Max number of commands to return.
 */
export async function getCommands(siteId: string, limit = 50): Promise<ApiCommand[]> {
  const raw = await apiFetch<unknown>("/commands", {
    site_id: siteId,
    limit: String(limit),
  })
  const list = Array.isArray(raw) ? raw : []
  const commands = list
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
    .map(normalizeCommand)
  // Sort newest first when timestamps are available.
  commands.sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : 0
    const tb = b.timestamp ? Date.parse(b.timestamp) : 0
    return tb - ta
  })
  return commands
}

// ─────────────────────────────────────────────────────────────────────
// Utility: Convert API frame to internal TelemetryFrame shape
// ─────────────────────────────────────────────────────────────────────

import type {
  TelemetryFrame,
  TelemetryEvent,
  GridState,
  BatteryUnit,
  ChargerUnit,
  StationState,
  MarketState,
  ContactorState,
  PlugState,
  ChargingState,
  ChargingProcessState,
  OperationState,
} from "./prototype-telemetry"

/**
 * Convert an API frame to the internal TelemetryFrame shape used by
 * the prototype UI components.
 */
/**
 * Coerce a value that *should* be an array into one. The Amperio API
 * (and our localStorage frame-cache, which round-trips frames through
 * JSON) occasionally hands back `batteries` / `chargers` / `warnings` /
 * `errors` as a non-array — `null`, `undefined`, `{}`, or an object map
 * keyed by unit id. A bare `value ?? []` only guards null/undefined, so
 * a `{}` slips through and the subsequent `.map(...)` throws
 * "(... ?? []).map is not a function", which previously crashed the
 * entire Data Analysis report. This guard accepts only real arrays and
 * falls back to an empty array for anything else (and unwraps object
 * maps into their values so we don't silently drop data).
 */
function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === "object") return Object.values(value as Record<string, T>)
  return []
}

export function apiFrameToTelemetryFrame(
  apiFrame: ApiTelemetryFrame,
  baseTs?: number // optional: for computing t_s offset
): TelemetryFrame {
  const ts = apiFrame.ts
  const tsMs = new Date(ts).getTime()
  const t_s = baseTs ? (tsMs - baseTs) / 1000 : 0

  // The grid block is occasionally absent on sparse historical frames;
  // fall back to an empty object so the field reads below don't throw.
  const apiGrid = apiFrame.grid ?? ({} as NonNullable<ApiTelemetryFrame["grid"]>)
  const grid: GridState = {
    P_grid_w: apiGrid.p_grid_w ?? 0,
    P_aux_w: apiGrid.p_aux_w ?? 0,
    E_grid_imp_kwh: apiGrid.e_grid_imp_kwh ?? 0,
    E_grid_exp_kwh: apiGrid.e_grid_exp_kwh ?? 0,
    E_aux_kwh: 0, // API doesn't provide aux energy counter yet
    f_grid_hz: apiGrid.f_grid_hz ?? 50,
    cos_phi: apiGrid.cos_phi ?? 1,
  }

  const batteries: BatteryUnit[] = asArray<NonNullable<ApiTelemetryFrame["batteries"]>[number]>(
    apiFrame.batteries,
  ).map((b) => ({
    unit_id: b.unit_id as 1 | 2,
    soc_pct: b.soc_pct,
    // API sign convention: positive = discharging, negative = charging
    // Internal convention: positive = charging, negative = discharging
    // So we negate the value to match internal convention
    power_w: -(b.power_w ?? 0),
    temp_min_c: b.temp_min_c,
    temp_max_c: b.temp_max_c,
    max_charge_w: b.max_charge_w,
    max_discharge_w: b.max_discharge_w,
    contactor_state: b.contactor_state as ContactorState,
    soh_pct: 98, // API doesn't provide SOH yet, assume healthy
    E_charged_kwh: 0, // lifetime counters not in API yet
    E_discharged_kwh: 0,
    // Live usable-energy headroom registers (E_full = room to charge,
    // E_empty = energy available to discharge). Previously dropped; the
    // dispatch kernel now consumes these to bound charge/discharge.
    E_full_kwh: b.energy_full_kwh,
    E_empty_kwh: b.energy_empty_kwh,
  }))

  const chargers: ChargerUnit[] = asArray<NonNullable<ApiTelemetryFrame["chargers"]>[number]>(
    apiFrame.chargers,
  ).map((c) => ({
    unit_id: c.unit_id as 1 | 2,
    plug_state: c.plug_state as PlugState,
    charging_state: c.charging_state as ChargingState,
    charging_process_state: c.charging_process_state as ChargingProcessState,
    P_EV_w: c.p_ev_w,
    P_EV_max_w: c.p_ev_max_w,
    P_cp_max_w: c.p_cp_max_w,
    soc_EV_pct: c.soc_ev_pct ?? 0,
    E_EV_chg_kwh: c.e_ev_chg_kwh,
    boost_contactor: c.boost_contactor as ContactorState,
  }))

  // Convert string warnings/errors to TelemetryEvent format
  const warningEvents: TelemetryEvent[] = asArray<string>(apiFrame.station?.warnings).map((msg, i) => ({
    id: i,
    ts,
    severity: "warning" as const,
    source: "station" as const,
    code: "WARN",
    message: msg,
    acknowledged: false,
  }))
  const errorEvents: TelemetryEvent[] = asArray<string>(apiFrame.station?.errors).map((msg, i) => ({
    id: warningEvents.length + i,
    ts,
    severity: "error" as const,
    source: "station" as const,
    code: "ERR",
    message: msg,
    acknowledged: false,
  }))

  const station: StationState = {
    operation_state: (apiFrame.station?.operation_state ?? "Ready") as OperationState,
    P_grid_consumption_limit_w: apiFrame.station?.p_grid_consumption_limit_w ?? 0,
    P_grid_generation_limit_w: apiFrame.station?.p_grid_generation_limit_w ?? 0,
    warnings: warningEvents,
    errors: errorEvents,
  }

  // Format slot_label in Europe/Berlin time (CEST/CET)
  // The server runs in UTC, so getHours() returns UTC hours. We must
  // explicitly format in Europe/Berlin to show the correct local time.
  let slotLabel = "00:00"
  if (apiFrame.prices?.bucket_ts) {
    const bucketDate = new Date(apiFrame.prices.bucket_ts)
    slotLabel = bucketDate.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
      hour12: false,
    })
  }

  const market: MarketState = {
    // DAM (day-ahead) price for dispatch decisions
    epex_price_eur_mwh: apiFrame.prices?.dam ?? apiFrame.prices?.idm ?? 0,
    // IDM (intraday / ID3) price for settlement - may differ from DAM
    idm_price_eur_mwh: apiFrame.prices?.idm ?? apiFrame.prices?.dam ?? 0,
    slot_label: slotLabel,
  }

  // Compute total EV demand from chargers
  const P_EV_demand_w = chargers.reduce((sum, c) => sum + c.P_EV_w, 0)

  // TelemetryFrame expects tuples, not arrays
  const batteryTuple: [BatteryUnit, BatteryUnit] = [
    batteries[0] ?? createDefaultBattery(1),
    batteries[1] ?? createDefaultBattery(2),
  ]
  const chargerTuple: [ChargerUnit, ChargerUnit] = [
    chargers[0] ?? createDefaultCharger(1),
    chargers[1] ?? createDefaultCharger(2),
  ]

  return {
    ts,
    t_s,
    grid,
    batteries: batteryTuple,
    chargers: chargerTuple,
    station,
    market,
    new_events: [], // events come from station.warnings/errors
    P_EV_demand_w,
  }
}

/** Default battery state when API returns fewer than 2 */
function createDefaultBattery(unitId: 1 | 2): BatteryUnit {
  return {
    unit_id: unitId,
    soc_pct: 0,
    power_w: 0,
    temp_min_c: 20,
    temp_max_c: 25,
    max_charge_w: 0,
    max_discharge_w: 0,
    contactor_state: "open",
    soh_pct: 100,
    E_charged_kwh: 0,
    E_discharged_kwh: 0,
  }
}

/** Default charger state when API returns fewer than 2 */
function createDefaultCharger(unitId: 1 | 2): ChargerUnit {
  return {
    unit_id: unitId,
    plug_state: "Unplugged",
    charging_state: "Idle",
    charging_process_state: "Idle",
    P_EV_w: 0,
    P_EV_max_w: 0,
    P_cp_max_w: 160000,
    soc_EV_pct: 0,
    E_EV_chg_kwh: 0,
    boost_contactor: "open",
  }
}

// ─────────────────────────────────────────────────────────────────────
// Default station ID (can be overridden)
// ──────────────────────────────────────────────────────────��──────────

export const DEFAULT_STATION_ID = "chargepost_gronau_001"
