/**
 * Amperio dispatch worker — a standalone, long-running Node process.
 *
 * Every TICK_MS (default 15s) it DELEGATES one dispatch tick to the deployed
 * Next.js app's `/api/dispatcher/tick` endpoint (APP_BASE_URL). That endpoint
 * runs the production **v5 MPC** — the SAME engine the dashboard's "Replan"
 * button and the backtest/simulator use — fetches telemetry + prices, solves,
 * and POSTs the setpoint to Amperio itself.
 *
 * WHY a thin pinger (not its own decision):
 *   • ONE engine everywhere. The old worker ran the legacy v3 `decideTick`
 *     (price-only clearance, SOC/EV-blind), which diverged from the v5 MPC the
 *     UI uses — e.g. it never imported from the grid to protect EV demand at the
 *     reserve floor. Delegating removes that divergence entirely.
 *   • No double-posting. The endpoint holds a Redis run-lock, so the worker and
 *     an open dashboard can both ping safely — only one tick executes at a time
 *     (the other gets `{ ran:false, reason:"locked" }`).
 *   • The v5 MPC imports `server-only` (transitively), so it CANNOT run inside
 *     this plain-Node process; calling the endpoint is the only way to share it.
 *
 * This is still a single persistent process (not a cron) because a true
 * 15-second cadence needs a held timer. Deploy it on any always-on runtime
 * (Railway, Fly, a VM). Alternatively, point any external pinger
 * (cron-job.org, GitHub Actions) at /api/dispatcher/tick and skip the worker.
 */

import { loadConfig } from "./config.ts"
import { StatusReporter } from "./reporter.ts"

const cfg = loadConfig()
const reporter = new StatusReporter(cfg)

// The tick endpoint requires a human-meaningful pinger NAME (header
// X-Dispatch-Name / ?name=) and labels this process in the Pingers monitor.
const PINGER_NAME = `dispatch-worker:${cfg.stationId}`

// Endpoint the worker delegates each tick to. One sub-tick per call since the
// worker already holds the cadence timer; `name` is mandatory upstream.
const tickUrl = cfg.appBaseUrl
  ? `${cfg.appBaseUrl}/api/dispatcher/tick?subTicks=1&name=${encodeURIComponent(PINGER_NAME)}`
  : null

function log(...args: unknown[]) {
  console.log(`[dispatch-worker ${new Date().toISOString()}]`, ...args)
}

/** Shape of the tick endpoint's JSON response (only the fields we surface). */
interface TickResponse {
  ok?: boolean
  ran?: boolean
  reason?: string | null
  subTicks?: number
  lastPhase?: string | null
}

// Avoid spamming the log/feed every 15s while the operator has us paused.
let loggedPaused = false
// Monotonic counter for active ticks, used to group the activity feed.
let tickSeq = 0

/** One dispatch cycle — delegate to the app's v5 MPC tick. Never throws. */
async function tick(): Promise<void> {
  // Operator Start/Stop gate. When the UI desired-state is "stopped", stay alive
  // but delegate nothing. We still send a "paused" heartbeat so the page shows
  // the worker is up (idle) and so we learn when the operator presses Start.
  // NOTE: the endpoint ALSO no-ops when intent is "stopped"; this local gate
  // just avoids an unnecessary round-trip every tick.
  if (reporter.desiredControl === "stopped") {
    if (!loggedPaused) {
      log("paused by operator — idling (no ticks delegated)")
      loggedPaused = true
    }
    await reporter.reportPhase("paused")
    return
  }
  if (loggedPaused) {
    log("resumed by operator — delegating ticks")
    loggedPaused = false
  }

  if (!tickUrl) {
    log("ERROR no APP_BASE_URL (or STATUS_REPORT_URL) configured — cannot delegate tick")
    void reporter.reportActivity(
      "error",
      "No APP_BASE_URL configured — set it to the deployed app so the worker can delegate to the v5 MPC.",
      "error",
    )
    return
  }

  // New active tick — bump the sequence so the UI can group this cycle's steps.
  reporter.beginTick(++tickSeq)
  void reporter.reportActivity("deciding", "Delegating tick to v5 MPC (/api/dispatcher/tick)…")

  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-dispatch-name": PINGER_NAME,
      "x-dispatch-source": `worker:${cfg.stationId}`,
    }
    if (cfg.tickToken) headers.authorization = `Bearer ${cfg.tickToken}`

    const res = await fetch(tickUrl, { method: "POST", headers })
    const bodyText = await res.text()

    if (!res.ok) {
      const hint =
        res.status === 401
          ? " (check DISPATCHER_TICK_TOKEN vs app CRON_SECRET)"
          : res.status === 400
            ? " (endpoint rejected the request — missing pinger name?)"
            : ""
      log(`ERROR tick endpoint returned HTTP ${res.status}${hint}: ${bodyText.slice(0, 200)}`)
      void reporter.reportActivity("error", `Tick endpoint HTTP ${res.status}${hint}`, "error")
      return
    }

    let body: TickResponse = {}
    try {
      body = JSON.parse(bodyText) as TickResponse
    } catch {
      // Endpoint returned non-JSON (unexpected) — surface raw text.
      log(`tick ok (HTTP ${res.status}) — non-JSON body: ${bodyText.slice(0, 160)}`)
      void reporter.reportActivity("done", `Tick ran (HTTP ${res.status})`)
      return
    }

    if (body.ran === false) {
      // Lock contention (dashboard ticked), operator stopped, or cooldown —
      // all expected no-ops. The endpoint did its own logging; just surface it.
      log(`tick no-op: ${body.reason ?? "unknown"}`)
      void reporter.reportActivity("done", `Tick no-op: ${body.reason ?? "unknown"}`)
      return
    }

    // ran === true: the v5 MPC executed and posted to Amperio inside the app.
    // The committed setpoint is recorded by the endpoint (Tick logger / status),
    // so we just confirm the delegation succeeded.
    const detail =
      `${body.subTicks ?? 1} sub-tick(s)` + (body.lastPhase ? ` · phase=${body.lastPhase}` : "")
    log(`tick ok (HTTP ${res.status}) — v5 MPC ran (${detail})`)
    void reporter.reportActivity("done", `v5 MPC dispatched (${detail})`)
  } catch (err) {
    const msg = (err as Error).message
    log("ERROR delegating tick:", msg)
    void reporter.reportActivity("error", `Tick delegation failed: ${msg}`, "error")
  }
}

// While paused, poll the control flag this often (ms) so an operator's Start
// is picked up within a few seconds instead of waiting a full tick. Also keeps
// the liveness heartbeat fresh so the page shows "idle" rather than "offline".
const IDLE_POLL_MS = 3000

/** Drift-corrected scheduler when running; fast poll while paused. */
function scheduleLoop(): void {
  let nextAt = Date.now()
  const run = async () => {
    await tick()
    if (reporter.desiredControl === "stopped") {
      // Idle: poll quickly. Re-anchor the grid so a resume starts a fresh,
      // full-length tick interval from now.
      nextAt = Date.now() + cfg.tickMs
      setTimeout(run, Math.min(IDLE_POLL_MS, cfg.tickMs))
    } else {
      nextAt += cfg.tickMs
      setTimeout(run, Math.max(0, nextAt - Date.now()))
    }
  }
  run()
}

log(
  `starting — station=${cfg.stationId} site=${cfg.siteId} asset=${cfg.assetId} ` +
    `tick=${cfg.tickMs}ms ` +
    `delegate=${tickUrl ?? "UNSET"} ` +
    `tick-auth=${cfg.tickToken ? "bearer" : "none"} ` +
    `status-report=${reporter.enabled ? "on" : "off"}`,
)

// The worker no longer posts to Amperio directly — the tick endpoint does. But
// without a delegate URL it can do nothing, so warn loudly on misconfiguration.
if (!tickUrl) {
  log(
    "WARNING: no APP_BASE_URL (or STATUS_REPORT_URL) set — the worker cannot " +
      "delegate to the v5 MPC and every tick will no-op. Set APP_BASE_URL to the deployed app.",
  )
}

// Announce startup to the status page (resets its counters for this run) and
// learn the current operator desired-state BEFORE the first tick, so a worker
// that restarts while stopped stays idle instead of firing one command.
void (async () => {
  await reporter.reportPhase("starting")
  scheduleLoop()
})()

// Graceful shutdown so an orchestrator's SIGTERM doesn't look like a crash.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log(`received ${sig}, shutting down.`)
    // Best-effort "stopping" report, then exit shortly after so the page can
    // flip to offline immediately instead of waiting for the liveness timeout.
    void reporter.reportPhase("stopping")
    setTimeout(() => process.exit(0), 300)
  })
}
