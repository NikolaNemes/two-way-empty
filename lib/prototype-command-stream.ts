/**
 * Live command-stream simulator for the Prototype > Telemetry > Commands tab.
 *
 * Pilot model
 * -----------
 * The optimizer ingests one telemetry frame per second (ts cadence on the
 * Telemetry API) and re-evaluates strategy. It only emits a new command on
 * the Dispatching API when something material has changed since the last
 * successful dispatch -- it does NOT re-issue identical setpoints every
 * tick. That keeps wire chatter and ChargePost write churn near zero in
 * steady state.
 *
 * The triggers we model here, in order of dominance:
 *
 *   1. EV plug / unplug events on either connector (state-derived from the
 *      charger.plug_state field; there is no separate event API)
 *   2. Spot intraday price zone crosses a band threshold (cheap, moderate,
 *      expensive, peak)
 *   3. Pack-average SOC crosses a guard band (low / mid / high)
 *   4. First observation after a reset (baseline command)
 *
 * Each emitted command carries the full request payload that real
 * Middleware would receive (station envelope + per-charger setpoints) and
 * picks up an async status timeline that mirrors the API status feedback
 * loop: pending -> acked -> executing -> executed | deviated | rejected.
 *
 * Pure functions, no React. The screen owns React state and the per-tick
 * advance loop; this module is replayable and testable in isolation.
 */

import type { TelemetryFrame } from "@/lib/prototype-telemetry"

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type PriceZone = "cheap" | "moderate" | "expensive" | "peak"
export type SocBand = "low" | "mid" | "high"

export type DispatchTrigger =
  | "baseline"
  | "ev_plug_c1"
  | "ev_unplug_c1"
  | "ev_plug_c2"
  | "ev_unplug_c2"
  | "price_to_cheap"
  | "price_to_moderate"
  | "price_to_expensive"
  | "price_to_peak"
  | "soc_to_low"
  | "soc_to_mid"
  | "soc_to_high"

export type ChargingMode = 0 | 1 | 2 | 3 // 0 Off, 1 Single 150 kW, 2 Dual 300 kW, 3 Disabled

export interface ChargerCommandSetpoint {
  unit_id: 1 | 2
  charging_mode: ChargingMode
  /**
   * **The arbitrage lever.** Requested grid power for this charger unit.
   * Producer counting system: positive = import from grid, negative = export to grid.
   * Only active when station.grid_mgmt_mode = 1 (manual/external).
   * ChargePost enforces: P_grid[1] + P_grid[2] <= station.P_grid_clearance_w
   * Modbus: charger.X.mgmt.P_grid (12005/22005)
   */
  P_grid_request_w: number
  /**
   * Max power deliverable to EV on this connector, watts (0..300_000).
   * Modbus: charger.X.mgmt.P_cp_lim (12001/22001)
   */
  P_ev_limit_w: number
}

/**
 * NOTE: `soc_cp_max` (Modbus 12009/22009) is intentionally NOT part of the
 * runtime dispatch payload. It is a **commissioning-time configuration** —
 * set once during ChargePost setup based on battery warranty, chemistry,
 * and longevity policy (typically 85-90%). The optimizer drives arbitrage
 * exclusively through `P_grid_request_w` within that fixed envelope; it
 * never modulates the ceiling itself. There is no `soc_cp_min` register
 * in the hardware — the floor concept does not exist.
 */

export interface StationCommandSetpoint {
  /**
   * 0 = Standby (station inactive), 1 = Active (Enexa controls).
   * Modbus: station.mgmt.operation_mode (2501)
   */
  operation_mode: 0 | 1
  /**
   * 0 = Automatic (ChargePost PMS decides grid power internally),
   * 1 = Manual/External (Enexa commands P_grid_request_w per charger).
   * For arbitrage, this MUST be 1.
   * Modbus: station.mgmt.grid_mgmt_mode (2502)
   */
  grid_mgmt_mode: 0 | 1
  /**
   * Max grid import envelope, watts. The sum of charger P_grid_request_w
   * values must not exceed this ceiling.
   * Modbus: station.mgmt.P_grid_clearance (2506)
   */
  P_grid_clearance_w: number
}

export type CommandStatus =
  | "pending"
  | "acked"
  | "executing"
  | "executed"
  | "deviated"
  | "rejected"

/** A single observed-state snapshot used for change detection. */
export interface ObservedState {
  plug_c1: boolean
  plug_c2: boolean
  price_zone: PriceZone
  soc_band: SocBand
  /** Raw values kept for the per-card diagnostics block. */
  price_eur_mwh: number
  pack_soc_pct: number
}

export interface LiveCommand {
  /** Stable id, deterministic for the session */
  id: string
  /** Monotonic sequence */
  seq: number
  /** Wall-clock issue time (ms, derived from the frame.ts of the trigger frame) */
  issuedAt: number
  /** Wall-clock ack time */
  ackedAt?: number
  /** Wall-clock execution-start time */
  executingAt?: number
  /** Wall-clock execution-end time */
  finalizedAt?: number
  /** Latencies in ms / s for display */
  ack_latency_ms?: number
  exec_latency_s?: number
  triggers: DispatchTrigger[]
  gate_reason: string
  status: CommandStatus
  request: {
    station: StationCommandSetpoint
    chargers: [ChargerCommandSetpoint, ChargerCommandSetpoint]
    metadata: {
      price_zone: PriceZone
      price_eur_mwh: number
      pack_soc_pct: number
      ev_active_c1: boolean
      ev_active_c2: boolean
    }
  }
  /** Snapshot of the previous accepted command's setpoints, for diffing. */
  prev_request?: LiveCommand["request"]
  /** Populated once executed/deviated. */
  result?: {
    commanded_P_grid_w: number
    actual_P_grid_w: number
    deviation_pct: number
    note?: string
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

export function priceZone(eur_mwh: number): PriceZone {
  if (eur_mwh < 60) return "cheap"
  if (eur_mwh < 110) return "moderate"
  if (eur_mwh < 160) return "expensive"
  return "peak"
}

export function socBand(soc_pct: number): SocBand {
  if (soc_pct < 30) return "low"
  if (soc_pct < 80) return "mid"
  return "high"
}

export function observeFrame(frame: TelemetryFrame): ObservedState {
  const plug_c1 = frame.chargers[0].plug_state === "Plugged"
  const plug_c2 = frame.chargers[1].plug_state === "Plugged"
  const price_eur_mwh = frame.market.epex_price_eur_mwh
  const pack_soc_pct =
    (frame.batteries[0].soc_pct + frame.batteries[1].soc_pct) / 2
  return {
    plug_c1,
    plug_c2,
    price_zone: priceZone(price_eur_mwh),
    soc_band: socBand(pack_soc_pct),
    price_eur_mwh,
    pack_soc_pct,
  }
}

/**
 * Compute the trigger set when transitioning from `prev` -> `cur`.
 * Returns an empty array when nothing has materially changed.
 */
export function diffTriggers(
  prev: ObservedState | null,
  cur: ObservedState
): DispatchTrigger[] {
  if (prev === null) return ["baseline"]
  const out: DispatchTrigger[] = []
  if (prev.plug_c1 !== cur.plug_c1) {
    out.push(cur.plug_c1 ? "ev_plug_c1" : "ev_unplug_c1")
  }
  if (prev.plug_c2 !== cur.plug_c2) {
    out.push(cur.plug_c2 ? "ev_plug_c2" : "ev_unplug_c2")
  }
  if (prev.price_zone !== cur.price_zone) {
    out.push(`price_to_${cur.price_zone}` as DispatchTrigger)
  }
  if (prev.soc_band !== cur.soc_band) {
    out.push(`soc_to_${cur.soc_band}` as DispatchTrigger)
  }
  return out
}

// --------------------------------------------------------------------------
// Optimizer playbook -> setpoints
// --------------------------------------------------------------------------

interface PlaybookInput {
  cur: ObservedState
}

interface PlaybookOutput {
  station_P_grid_clearance_w: number
  charger_charging_mode: ChargingMode
  charger_P_grid_request_w: number
  charger_P_ev_limit_w: number
  gate_reason: string
}

function playbook({ cur }: PlaybookInput): PlaybookOutput {
  const { price_zone, soc_band, plug_c1, plug_c2 } = cur
  const evActive = plug_c1 || plug_c2

  let station_P_grid_clearance_w = 80_000
  const charger_charging_mode: ChargingMode = 2 // dual-coupled, 0..300 kW
  let charger_P_grid_request_w = 0
  let charger_P_ev_limit_w = 150_000
  let gate_reason: string

  if (price_zone === "cheap") {
    charger_P_grid_request_w = 40_000
    gate_reason = "Cheap intraday slot — charge BESS from grid"
  } else if (price_zone === "moderate") {
    charger_P_grid_request_w = 0
    gate_reason = "Moderate intraday — hold SOC, no arbitrage"
  } else if (price_zone === "expensive") {
    charger_P_grid_request_w = 0
    gate_reason = "Expensive intraday — discharge BESS to serve EV load"
  } else {
    charger_P_grid_request_w = 0
    charger_P_ev_limit_w = 100_000
    gate_reason = "Peak pricing — maximize BESS discharge, throttle EV ceiling"
  }

  // SOC ceiling protection — don't import if BESS is near full
  if (soc_band === "high" && charger_P_grid_request_w > 0) {
    charger_P_grid_request_w = Math.min(charger_P_grid_request_w, 8_000)
    gate_reason = "BESS near full — trickle charge only"
  }
  // SOC floor protection — must import if BESS is low
  if (soc_band === "low") {
    charger_P_grid_request_w = Math.max(charger_P_grid_request_w, 25_000)
    gate_reason = "BESS reserve thin — import from grid to refill"
  }

  // Must-serve override — when EV is connected, ensure grid availability
  if (evActive) {
    charger_P_grid_request_w = Math.max(charger_P_grid_request_w, 10_000)
    gate_reason = `${gate_reason} · EV connected, grid import floor raised`
    // Tighten the import envelope only when SOC is healthy
    if (soc_band !== "low") {
      station_P_grid_clearance_w = 70_000
    }
  }

  return {
    station_P_grid_clearance_w,
    charger_charging_mode,
    charger_P_grid_request_w,
    charger_P_ev_limit_w,
    gate_reason,
  }
}

// --------------------------------------------------------------------------
// Command construction
// --------------------------------------------------------------------------

let SEQ_COUNTER = 0

/**
 * Reset the sequence counter used by `buildCommand`. Call this when the
 * upstream simulator resets so command ids restart at 1 cleanly.
 */
export function resetCommandSeq(): void {
  SEQ_COUNTER = 0
}

function commandId(issuedAt: number, seq: number): string {
  const d = new Date(issuedAt)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(d.getUTCDate()).padStart(2, "0")
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mi = String(d.getUTCMinutes()).padStart(2, "0")
  const ss = String(d.getUTCSeconds()).padStart(2, "0")
  return `cmd_${yyyy}${mm}${dd}_${hh}${mi}${ss}_${String(seq).padStart(4, "0")}`
}

export interface BuildCommandInput {
  issuedAt: number
  triggers: DispatchTrigger[]
  cur: ObservedState
  /** Previous accepted command for diff-vs-prev rendering. */
  prev?: LiveCommand
}

export function buildCommand({
  issuedAt,
  triggers,
  cur,
  prev,
}: BuildCommandInput): LiveCommand {
  const seq = ++SEQ_COUNTER
  const pb = playbook({ cur })
  const charger_setpoint = (unit_id: 1 | 2): ChargerCommandSetpoint => ({
    unit_id,
    charging_mode: pb.charger_charging_mode,
    P_grid_request_w: pb.charger_P_grid_request_w,
    P_ev_limit_w: pb.charger_P_ev_limit_w,
  })
  return {
    id: commandId(issuedAt, seq),
    seq,
    issuedAt,
    triggers,
    gate_reason: pb.gate_reason,
    status: "pending",
    request: {
      station: {
        operation_mode: 1,
        grid_mgmt_mode: 1,
      P_grid_clearance_w: pb.station_P_grid_clearance_w,
    },
      chargers: [charger_setpoint(1), charger_setpoint(2)],
      metadata: {
        price_zone: cur.price_zone,
        price_eur_mwh: Math.round(cur.price_eur_mwh * 10) / 10,
        pack_soc_pct: Math.round(cur.pack_soc_pct * 10) / 10,
        ev_active_c1: cur.plug_c1,
        ev_active_c2: cur.plug_c2,
      },
    },
    prev_request: prev?.request,
  }
}

// --------------------------------------------------------------------------
// Async status simulation
// --------------------------------------------------------------------------

/** Deterministic mulberry32 in [0, 1) keyed on a string. */
function seededRand(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let t = (h | 0) + 0x6d2b79f5
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/**
 * Advance the in-flight status of `cmd` against the current wall-clock
 * `now_ms` and the current actual `frame`. Returns either the same
 * reference (no transition) or a new object (transitioned).
 */
export function advanceCommandStatus(
  cmd: LiveCommand,
  now_ms: number,
  frame: TelemetryFrame
): LiveCommand {
  if (cmd.status === "executed" || cmd.status === "deviated" || cmd.status === "rejected") {
    return cmd
  }

  const ageMs = now_ms - cmd.issuedAt
  const ackBudget = 30 + seededRand(cmd.id + "_a") * 150 // 30..180 ms
  const execBudget = 1500 + seededRand(cmd.id + "_x") * 2000 // 1.5..3.5 s

  // Random rejection — extremely rare, only on baseline-like commands. Keep
  // the loop predictable so demos stay focused on the main path.
  const rejectRoll = seededRand(cmd.id + "_r")
  const willReject = rejectRoll < 0.005

  // ---- pending -> acked (or rejected at ack-time) ----
  if (cmd.status === "pending" && ageMs >= ackBudget) {
    if (willReject) {
      return {
        ...cmd,
        status: "rejected",
        ackedAt: cmd.issuedAt + ackBudget,
        ack_latency_ms: Math.round(ackBudget),
        finalizedAt: cmd.issuedAt + ackBudget,
        result: {
          commanded_P_grid_w: cmd.request.chargers[0].P_grid_request_w * 2,
          actual_P_grid_w: 0,
          deviation_pct: 0,
          note: "Schema validation failed at ingress",
        },
      }
    }
    return {
      ...cmd,
      status: "acked",
      ackedAt: cmd.issuedAt + ackBudget,
      ack_latency_ms: Math.round(ackBudget),
    }
  }

  // ---- acked -> executing ----
  if (cmd.status === "acked" && ageMs >= ackBudget + 200) {
    return {
      ...cmd,
      status: "executing",
      executingAt: cmd.issuedAt + ackBudget + 200,
    }
  }

  // ---- executing -> executed | deviated ----
  if (cmd.status === "executing" && ageMs >= ackBudget + execBudget) {
    const commanded = cmd.request.chargers[0].P_grid_request_w * 2
    const actual = frame.grid.P_grid_w
    const deviation_pct =
      Math.abs(commanded) < 1
        ? 0
        : Math.abs(((actual - commanded) / commanded) * 100)
    const deviated = deviation_pct > 12 // > 12% off-target -> deviated
    return {
      ...cmd,
      status: deviated ? "deviated" : "executed",
      finalizedAt: cmd.issuedAt + ackBudget + execBudget,
      exec_latency_s: Math.round(execBudget / 100) / 10,
      result: {
        commanded_P_grid_w: commanded,
        actual_P_grid_w: actual,
        deviation_pct: Math.round(deviation_pct * 10) / 10,
        note: deviated ? "Site clipped to honour grid envelope" : undefined,
      },
    }
  }

  return cmd
}

// --------------------------------------------------------------------------
// Diffing for the "what changed" badges
// --------------------------------------------------------------------------

export interface SetpointDiff {
  field: string
  from: string
  to: string
  kind: "tightens" | "loosens" | "flips" | "set"
}

export function diffSetpoints(
  prev: LiveCommand["request"] | undefined,
  cur: LiveCommand["request"]
): SetpointDiff[] {
  if (!prev) return []
  const out: SetpointDiff[] = []
  const fmtKw = (w: number) =>
    w === 0 ? "0 kW" : w > 0 ? `+${(w / 1000).toFixed(0)} kW` : `${(w / 1000).toFixed(0)} kW`
  const fmtPct = (p: number) => `${p}%`

  if (prev.station.P_grid_clearance_w !== cur.station.P_grid_clearance_w) {
    out.push({
      field: "P_grid_clearance",
      from: fmtKw(prev.station.P_grid_clearance_w),
      to: fmtKw(cur.station.P_grid_clearance_w),
      kind:
        cur.station.P_grid_clearance_w > prev.station.P_grid_clearance_w
          ? "loosens"
          : "tightens",
    })
  }
  for (const i of [0, 1] as const) {
    const p = prev.chargers[i]
    const c = cur.chargers[i]
    if (p.P_grid_request_w !== c.P_grid_request_w) {
      const flips =
        (p.P_grid_request_w < 0 && c.P_grid_request_w >= 0) ||
        (p.P_grid_request_w > 0 && c.P_grid_request_w <= 0)
      out.push({
        field: `C${i + 1} P_grid`,
        from: fmtKw(p.P_grid_request_w),
        to: fmtKw(c.P_grid_request_w),
        kind: flips ? "flips" : c.P_grid_request_w > p.P_grid_request_w ? "loosens" : "tightens",
      })
    }
    if (p.P_ev_limit_w !== c.P_ev_limit_w) {
      out.push({
        field: `C${i + 1} EV limit`,
        from: fmtKw(p.P_ev_limit_w),
        to: fmtKw(c.P_ev_limit_w),
        kind: c.P_ev_limit_w > p.P_ev_limit_w ? "loosens" : "tightens",
      })
    }
  }
  // fmtPct retained for potential future fields; suppress unused warning.
  void fmtPct
  return out
}

// --------------------------------------------------------------------------
// Display helpers
// --------------------------------------------------------------------------

export function triggerLabel(t: DispatchTrigger): string {
  switch (t) {
    case "baseline":
      return "Baseline"
    case "ev_plug_c1":
      return "EV plug C1"
    case "ev_unplug_c1":
      return "EV unplug C1"
    case "ev_plug_c2":
      return "EV plug C2"
    case "ev_unplug_c2":
      return "EV unplug C2"
    case "price_to_cheap":
      return "Price → cheap"
    case "price_to_moderate":
      return "Price → moderate"
    case "price_to_expensive":
      return "Price → expensive"
    case "price_to_peak":
      return "Price → peak"
    case "soc_to_low":
      return "SOC → low"
    case "soc_to_mid":
      return "SOC → mid"
    case "soc_to_high":
      return "SOC → high"
  }
}

export function triggerKind(
  t: DispatchTrigger
): "ev" | "price" | "soc" | "baseline" {
  if (t === "baseline") return "baseline"
  if (t.startsWith("ev_")) return "ev"
  if (t.startsWith("price_")) return "price"
  return "soc"
}

export function statusTone(
  s: CommandStatus
): { label: string; text: string; bg: string; border: string; dot: string } {
  switch (s) {
    case "pending":
      return {
        label: "PENDING",
        text: "text-amber-700 dark:text-amber-500",
        bg: "bg-amber-500/10",
        border: "border-amber-500/40",
        dot: "bg-amber-500",
      }
    case "acked":
      return {
        label: "ACKED",
        text: "text-sky-700 dark:text-sky-400",
        bg: "bg-sky-500/10",
        border: "border-sky-500/40",
        dot: "bg-sky-500",
      }
    case "executing":
      return {
        label: "EXECUTING",
        text: "text-violet-700 dark:text-violet-400",
        bg: "bg-violet-500/10",
        border: "border-violet-500/40",
        dot: "bg-violet-500",
      }
    case "executed":
      return {
        label: "EXECUTED",
        text: "text-emerald-700 dark:text-emerald-500",
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/40",
        dot: "bg-emerald-500",
      }
    case "deviated":
      return {
        label: "DEVIATED",
        text: "text-amber-700 dark:text-amber-500",
        bg: "bg-amber-500/10",
        border: "border-amber-500/40",
        dot: "bg-amber-500",
      }
    case "rejected":
      return {
        label: "REJECTED",
        text: "text-red-700 dark:text-red-400",
        bg: "bg-red-500/10",
        border: "border-red-500/40",
        dot: "bg-red-500",
      }
  }
}

export function priceZoneTone(z: PriceZone): {
  text: string
  bg: string
  border: string
} {
  switch (z) {
    case "cheap":
      return {
        text: "text-emerald-700 dark:text-emerald-400",
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/40",
      }
    case "moderate":
      return {
        text: "text-sky-700 dark:text-sky-400",
        bg: "bg-sky-500/10",
        border: "border-sky-500/40",
      }
    case "expensive":
      return {
        text: "text-amber-700 dark:text-amber-500",
        bg: "bg-amber-500/10",
        border: "border-amber-500/40",
      }
    case "peak":
      return {
        text: "text-red-700 dark:text-red-400",
        bg: "bg-red-500/10",
        border: "border-red-500/40",
      }
  }
}

export function formatKw(w: number): string {
  if (w === 0) return "0 kW"
  const kw = (w / 1000).toFixed(0)
  return w > 0 ? `+${kw} kW` : `${kw} kW`
}

// --------------------------------------------------------------------------
// Impact derivation — answers "what does this command DO?" in plain language
// --------------------------------------------------------------------------

/**
 * High-level intent label for a dispatch. Drives badge tone and a short
 * primary-effect sentence in the UI.
 *
 *  - `bess_charge`   : positive grid import, no EV plugged → fill BESS
 *  - `bess_export`   : negative grid import, no EV plugged → discharge to grid
 *  - `bess_serve_ev` : zero or near-zero grid, EV plugged → BESS carries the load
 *  - `grid_serve_ev` : positive grid, EV plugged → grid supplements EV
 *  - `mixed_serve_ev`: positive grid + EV plugged + BESS still net-charging
 *  - `idle`          : zero grid, no EV plugged → site holds steady
 */
export type CommandIntent =
  | "bess_charge"
  | "bess_export"
  | "bess_serve_ev"
  | "grid_serve_ev"
  | "mixed_serve_ev"
  | "idle"

export interface CommandImpact {
  /** Machine-readable category. */
  intent: CommandIntent
  /** Two- or three-word label suitable for a badge. */
  intentLabel: string
  /** One-sentence narrative of the physical effect. */
  primaryEffect: string
  /** Optional second-order effect (e.g. envelope utilization). */
  secondaryEffect?: string
  /** Total grid power requested across both units, signed (W).
   *  Positive = import from grid, negative = export. */
  siteGridFlowW: number
  /** Number of plugged connectors at issue time (0..2). */
  plugCount: 0 | 1 | 2
  /** Tone tokens for badges/tiles. */
  tone: {
    text: string
    bg: string
    border: string
    /** Short adjective for the intent badge ("import", "export", "hold"). */
    direction: "import" | "export" | "hold"
  }
}

/**
 * Derive the high-level "what does this command do" view from a built
 * `LiveCommand`. Pure: depends only on the request payload itself.
 */
export function deriveCommandImpact(cmd: LiveCommand): CommandImpact {
  const c1 = cmd.request.chargers[0].P_grid_request_w
  const c2 = cmd.request.chargers[1].P_grid_request_w
  const siteGridFlowW = c1 + c2
  const plugC1 = cmd.request.metadata.ev_active_c1
  const plugC2 = cmd.request.metadata.ev_active_c2
  const plugCount = ((plugC1 ? 1 : 0) + (plugC2 ? 1 : 0)) as 0 | 1 | 2
  const evActive = plugCount > 0
  const importThreshold = 1_000 // W; treat <1 kW as zero

  let intent: CommandIntent
  let intentLabel: string
  let primaryEffect: string
  let secondaryEffect: string | undefined
  let direction: "import" | "export" | "hold"

  if (evActive) {
    if (siteGridFlowW > importThreshold) {
      // Grid import while EV plugged — could be split between EV serve and BESS top-up.
      // The optimizer's gate_reason already says which dominates; we surface a generic
      // statement and let the secondary line carry the breakdown.
      const grossKw = Math.round(siteGridFlowW / 1000)
      intent = "grid_serve_ev"
      intentLabel = "Grid serves EV"
      primaryEffect = `Grid imports ${grossKw} kW; BESS supplements the EV draw on top.`
      secondaryEffect = `${plugCount} connector${plugCount === 1 ? "" : "s"} plugged · BESS still in the energy balance`
      direction = "import"
    } else if (siteGridFlowW < -importThreshold) {
      const grossKw = Math.round(Math.abs(siteGridFlowW) / 1000)
      intent = "mixed_serve_ev"
      intentLabel = "BESS serves EV + exports"
      primaryEffect = `BESS covers the EV draw and exports ${grossKw} kW to the grid.`
      secondaryEffect = `${plugCount} connector${plugCount === 1 ? "" : "s"} plugged · grid is a sink, not a source`
      direction = "export"
    } else {
      intent = "bess_serve_ev"
      intentLabel = "BESS serves EV"
      primaryEffect = "Grid stays at zero; the BESS carries the EV load alone."
      secondaryEffect = `${plugCount} connector${plugCount === 1 ? "" : "s"} plugged · pure self-consumption`
      direction = "hold"
    }
  } else {
    // No EV plugged — site flow is exactly the BESS flow (with sign flipped).
    if (siteGridFlowW > importThreshold) {
      const grossKw = Math.round(siteGridFlowW / 1000)
      intent = "bess_charge"
      intentLabel = "BESS top-up"
      primaryEffect = `Grid imports ${grossKw} kW · all of it flows into the BESS.`
      secondaryEffect = "No EV active — pure arbitrage charge"
      direction = "import"
    } else if (siteGridFlowW < -importThreshold) {
      const grossKw = Math.round(Math.abs(siteGridFlowW) / 1000)
      intent = "bess_export"
      intentLabel = "BESS export"
      primaryEffect = `BESS discharges ${grossKw} kW to the grid (export).`
      secondaryEffect = "No EV active — pure arbitrage discharge"
      direction = "export"
    } else {
      intent = "idle"
      intentLabel = "Hold steady"
      primaryEffect = "Site holds; no power flows in or out."
      secondaryEffect = "No EV active and no arbitrage opportunity"
      direction = "hold"
    }
  }

  const tone: CommandImpact["tone"] =
    direction === "import"
      ? {
          text: "text-sky-700 dark:text-sky-400",
          bg: "bg-sky-500/10",
          border: "border-sky-500/40",
          direction,
        }
      : direction === "export"
      ? {
          text: "text-emerald-700 dark:text-emerald-400",
          bg: "bg-emerald-500/10",
          border: "border-emerald-500/40",
          direction,
        }
      : {
          text: "text-muted-foreground",
          bg: "bg-muted/50",
          border: "border-border",
          direction,
        }

  return {
    intent,
    intentLabel,
    primaryEffect,
    secondaryEffect,
    siteGridFlowW,
    plugCount,
    tone,
  }
}

/** Format the per-unit dispatch setpoints into a compact mono string. */
export function formatPerUnitGrid(cmd: LiveCommand): string {
  const c1 = formatKw(cmd.request.chargers[0].P_grid_request_w)
  const c2 = formatKw(cmd.request.chargers[1].P_grid_request_w)
  return `C1 ${c1} · C2 ${c2}`
}

export function formatRelative(target_ms: number, now_ms: number): string {
  const diff = now_ms - target_ms
  if (diff < 0) return "future"
  if (diff < 1000) return "just now"
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  const h = Math.floor(diff / 3_600_000)
  const m = Math.round((diff - h * 3_600_000) / 60_000)
  return `${h}h ${m}m ago`
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}
