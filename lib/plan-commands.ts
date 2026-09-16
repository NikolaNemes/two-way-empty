/**
 * PLAN → SCHEDULED COMMANDS (run-length encoded)
 * ════════════════════════════════════════════════════════════════════════
 *
 * Turns a committed the optimizer plan snapshot (the full receding-horizon grid
 * schedule) into a COMPACT list of dispatch commands the external system can
 * execute on its own clock — one command per *setpoint change*, NOT one per
 * slot. The optimizer typically holds the same clearance/reserve across many
 * consecutive 15-min slots, so emitting a command per slot is wasteful and
 * noisy; we collapse runs of identical setpoints into a single command that is
 * valid from its `executeAt` until the next change.
 *
 * WHY this exists: the live dispatcher only commits g[0] to the wire each tick
 * and relies on a steady pinger to walk the plan forward. An external system
 * driving us purely on EV plug/unplug events has no such pinger, so between
 * events the plan never advances (cheap-hour grid import is never commanded).
 * Returning the whole horizon as scheduled commands lets that system execute
 * the remaining trajectory itself until the next event-driven replan overrides
 * it — exactly the "materialise the plan + scheduled commands" model.
 *
 * Each command is a REAL wire payload built by the same `toDispatchPayload`
 * used for live dispatch, so the external system receives the identical
 * structure it already POSTs to the station — just stamped with when to apply
 * it (`executeAt`) and until when it holds (`validUntil`). The FIRST command
 * equals the setpoint we just committed for the current slot.
 *
 * NOTE: per-connector EV limits are NOT forward-projected (we can't know future
 * plug state), so each command carries the default per-unit envelope. The
 * actuating value — `station.P_grid_clearance_w` (plus SOC reserve/ceiling) — is
 * fully determined by the plan.
 */

import { toDispatchPayload, type DispatchPayload, type DecideTickResult } from "@/lib/dispatch-kernel"
import type { PlanSnapshot } from "@/lib/dispatcher-status"

/** One run-length-encoded scheduled command derived from the plan horizon. */
export interface ScheduledCommand {
  /** 0-based position in the returned schedule. */
  index: number
  /** When this command should be applied (ISO, = slot start of the run's first slot). */
  executeAt: string
  /** Epoch ms form of `executeAt`. */
  executeAtMs: number
  /** When this command stops being valid (ISO) — the next change, or horizon end. */
  validUntil: string
  /** Slot index (epoch-anchored 15-min) the run starts at. */
  slot: number
  /** How many consecutive slots this single command covers. */
  slotSpan: number
  /** Planned grid-import ceiling for the run (kW) — the human-readable setpoint. */
  gridKw: number
  /** The active wire grid setpoint in W (P_grid_request_w, signed neg=import) — what changed to start a new command. */
  setpointW: number
  /** Planned SOC reserve floor for the run (%). */
  socReservePct: number
  /** Planned SOC ceiling for the run (%). */
  socCeilingPct: number
  /** DA price at the run start (€/MWh) — context for the setpoint. */
  priceEurMwh: number
  /** The exact wire command to send, stamped with executeAt / validUntil. */
  payload: DispatchPayload
}

export interface CompressPlanOptions {
  siteId: string
  assetId: string
  /** Charger unit ids to stamp on each command (default [1, 2]). */
  chargerUnitIds?: number[]
}

/**
 * Compress a plan snapshot into run-length-encoded scheduled commands. Returns
 * `[]` when the snapshot has no usable steps. Pure + synchronous so it can be
 * unit-tested and called from any route without side effects.
 */
export function compressPlanToCommands(
  snapshot: PlanSnapshot,
  opts: CompressPlanOptions,
): ScheduledCommand[] {
  const steps = snapshot.steps ?? []
  if (steps.length === 0) return []

  const slotMs = Math.max(1, Math.round(snapshot.stepHours * 3_600_000))
  const chargerUnitIds = opts.chargerUnitIds?.length ? opts.chargerUnitIds : [1, 2]

  // Build the actuating wire setpoint for each step, then detect change points.
  // We derive the per-step station setpoint exactly as the live tick would: the
  // grid clearance = the planned grid import for that slot, the reserve = the
  // step's adaptive floor, the ceiling = the plan's SOC ceiling. We render via
  // toDispatchPayload so the comparison is on the FINAL integer wire values
  // (rounded W / %), which is what the device actually sees.
  const decisionFor = (stepIdx: number): DecideTickResult => ({
    clearanceKw: steps[stepIdx].gridKw,
    reserveSocPct: steps[stepIdx].reserveFloorPct,
    targetSocPct: snapshot.socCeilingPct,
    eagerness: 0,
    anticipatedEvKwh: 0,
    expensiveThresholdEurMwh: 0,
  })

  // Probe payload (timestamp irrelevant here) just to read the rounded wire
  // setpoint fields for run-length comparison.
  //
  // The run-length key MUST include `P_grid_request_w` — that is the ACTIVE grid
  // setpoint (signed, neg=import) that changes per slot. `P_grid_clearance_w` is
  // only the (mostly constant) import envelope, so keying on it alone would
  // collapse every setpoint change and break runs only when the reserve floor
  // steps — making the schedule look like a flat ceiling held for hours when the
  // plan actually dips (e.g. battery-supplements a peak). Include all three
  // actuating fields so a run breaks whenever ANY of them changes.
  const wireKeyOf = (stepIdx: number): string => {
    const p = toDispatchPayload(decisionFor(stepIdx), {
      siteId: opts.siteId,
      assetId: opts.assetId,
      chargerUnitIds,
      gridImportLimitKw: snapshot.gridImportLimitKw,
    })
    return `${p.station.P_grid_request_w}|${p.station.P_grid_clearance_w}|${p.station.soc_reserve_pct}|${p.station.soc_cp_max_pct}`
  }

  // 1. Find the index where each run starts (setpoint differs from previous).
  const runStarts: number[] = [0]
  let prevKey = wireKeyOf(0)
  for (let t = 1; t < steps.length; t++) {
    const key = wireKeyOf(t)
    if (key !== prevKey) {
      runStarts.push(t)
      prevKey = key
    }
  }

  // 2. Materialize one command per run, stamped with the real execute/valid times.
  const horizonEndMs = new Date(steps[steps.length - 1].ts).getTime() + slotMs
  const commands: ScheduledCommand[] = runStarts.map((startIdx, i) => {
    const step = steps[startIdx]
    const nextStartIdx = runStarts[i + 1]
    const executeAtMs = new Date(step.ts).getTime()
    const validUntilMs = nextStartIdx != null ? new Date(steps[nextStartIdx].ts).getTime() : horizonEndMs
    const endIdx = (nextStartIdx ?? steps.length) - 1
    const slotSpan = endIdx - startIdx + 1

    const payload = toDispatchPayload(decisionFor(startIdx), {
      siteId: opts.siteId,
      assetId: opts.assetId,
      timestamp: step.ts,
      // Holds until the next setpoint change (or the end of the planned horizon).
      validForMs: Math.max(slotMs, validUntilMs - executeAtMs),
      priceEurMwh: step.priceEurMwh,
      chargerUnitIds,
      gridImportLimitKw: snapshot.gridImportLimitKw,
    })

    return {
      index: i,
      executeAt: step.ts,
      executeAtMs,
      validUntil: new Date(validUntilMs).toISOString(),
      slot: step.slot,
      slotSpan,
      gridKw: step.gridKw,
      // The ACTIVE setpoint for the run (signed, neg=import) — what actually
      // varies slot-to-slot. (P_grid_clearance_w is the envelope ceiling.)
      setpointW: payload.station.P_grid_request_w,
      socReservePct: payload.station.soc_reserve_pct,
      socCeilingPct: payload.station.soc_cp_max_pct,
      priceEurMwh: step.priceEurMwh,
      payload,
    }
  })

  return commands
}
