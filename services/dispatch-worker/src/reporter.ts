/**
 * Status reporter — pushes the worker's heartbeat + each command to the
 * Next.js app's ingest route (/api/dispatcher/report) so the Dispatcher Status
 * page can show a live view.
 *
 * This is best-effort and fully decoupled from dispatching: if the app is
 * unreachable, we log a warning and keep dispatching. Reporting never throws
 * into the main loop.
 */

import type { WorkerConfig } from "./config.ts"

export type WorkerPhase = "starting" | "running" | "stopping" | "paused"
export type ControlState = "running" | "stopped"

/** Fine-grained step within a tick (mirrors lib/dispatcher-status.ts). */
export type ActivityStep =
  | "idle"
  | "telemetry"
  | "prices"
  | "planning"
  | "deciding"
  | "dispatching"
  | "done"
  | "error"

export interface WorkerActivity {
  ts: string
  step: ActivityStep
  message: string
  level: "info" | "warn" | "error"
  /** Monotonic tick number this entry belongs to (for grouping in the UI). */
  tick?: number
}

export interface WorkerMeta {
  stationId: string
  siteId: string
  assetId: string
  tickMs: number
  priceSource: string
  baseUrl: string
  startedAt: string
}

interface DispatcherReport {
  worker: WorkerMeta
  phase: WorkerPhase
  activity?: WorkerActivity | null
}

export class StatusReporter {
  private readonly url: string | null
  private readonly token: string | null
  private readonly meta: WorkerMeta
  private warnedUnreachable = false
  // Latest operator desired-state learned from report responses. When a status
  // link is configured we default to "stopped" so the worker idles until an
  // operator explicitly clicks Start (the app also defaults to stopped). With
  // no status link there's no control plane, so we run normally.
  private control: ControlState

  constructor(config: WorkerConfig) {
    this.url = config.statusReportUrl ? `${config.statusReportUrl}/api/dispatcher/report` : null
    this.token = config.statusReportToken
    this.control = this.url ? "stopped" : "running"
    this.meta = {
      stationId: config.stationId,
      siteId: config.siteId,
      assetId: config.assetId,
      tickMs: config.tickMs,
      priceSource: config.priceSource,
      baseUrl: config.baseUrl,
      startedAt: new Date().toISOString(),
    }
  }

  get enabled(): boolean {
    return this.url != null
  }

  /** Fire-and-forget POST; never throws into the caller. */
  private async send(report: DispatcherReport): Promise<void> {
    if (!this.url) return
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify(report),
        // Don't let a slow app stall the dispatch loop.
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) {
        console.warn(`[reporter] status ingest returned HTTP ${res.status}`)
      } else {
        this.warnedUnreachable = false
        // The ingest route echoes the operator desired-state; cache it so the
        // worker can gate its next tick on Start/Stop from the UI.
        try {
          const data = (await res.json()) as { control?: unknown }
          if (data?.control === "running" || data?.control === "stopped") {
            this.control = data.control
          }
        } catch {
          // Non-JSON / older app build — keep the previous control state.
        }
      }
    } catch (err) {
      if (!this.warnedUnreachable) {
        console.warn(`[reporter] could not reach status ingest (${(err as Error).message}); will keep trying quietly`)
        this.warnedUnreachable = true
      }
    }
  }

  /** Operator desired-state as last learned from the app (defaults running). */
  get desiredControl(): ControlState {
    return this.control
  }

  private currentTick = 0

  /** Mark the start of a new dispatch tick; stamps subsequent activity. */
  beginTick(tick: number): void {
    this.currentTick = tick
  }

  reportPhase(phase: WorkerPhase): Promise<void> {
    return this.send({ worker: this.meta, phase })
  }

  /**
   * Report a fine-grained step within the current tick. Drives the live
   * activity feed on the status page. Fire-and-forget like reportPhase.
   */
  reportActivity(
    step: ActivityStep,
    message: string,
    level: WorkerActivity["level"] = "info",
    phase: WorkerPhase = "running",
  ): Promise<void> {
    return this.send({
      worker: this.meta,
      phase,
      activity: { ts: new Date().toISOString(), step, message, level, tick: this.currentTick },
    })
  }
}
