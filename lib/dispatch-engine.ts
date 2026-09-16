/**
 * STATELESS DISPATCH ENGINE
 * ════════════════════════════════════════════════════════════════════════
 *
 * The Vercel-native dispatch engine. Serverless functions freeze after a
 * request, so a persistent in-process timer never keeps firing in production.
 * Instead, dispatch is
 * driven entirely by external calls to `/api/dispatcher/tick` — there is no
 * server-side loop or timer:
 *
 *   • The Dispatcher Status page (while open) and/or your own external pinger
 *     hit `/api/dispatcher/tick` on an interval. No Vercel Cron required.
 *   • Each call runs `runTickWindow()`, which runs N "sub-ticks" spaced
 *     `intervalMs` apart (default 15s) so a single ~1/min ping still yields
 *     ~15s control resolution; pingers running every ~15s pass `?subTicks=1`.
 *   • Each sub-tick (`runOneTick`) is fully self-contained: it loads planner
 *     state from Upstash Redis, fetches telemetry + prices, solves the optimizer,
 *     POSTs the setpoint to Amperio, and writes planner state + heartbeat +
 *     activity back to Redis. No globalThis, no timers.
 *   • A Redis run-lock guarantees only one tick executes at a time, so the
 *     page ticker and an external pinger can both run without double-dispatch.
 *
 * The live decision is produced by the SAME optimizer LP as the back-test
 * (`solveHorizon`, via `lib/optimizer/plan-horizon.ts`) — there is no heuristic kernel in this
 * path — so the live service and the back-test can never silently diverge. If
 * the optimizer cannot solve a tick we send a safe self-protecting command (full grid
 * clearance, emergency reserve floor), never a heuristic decision.
 */

import {
  buildTestPayload,
  TEST_EVENT_TYPE,
  classifyPriceZone,
  SLOT_MS,
  GRID_IMPORT_LIMIT_KW,
  GRID_REAL_POWER_CAP_KW,
  BATT_CAPACITY_KWH,
  BATT_MAX_POWER_KW,
  type SlotPrice,
  type DispatchPayload,
  type AnyDispatchPayload,
} from "@/lib/dispatch-kernel"
import {
  OPTIMIZER_DEFAULTS,
  CAR_GUARD_FRAC,
  NOCAR_RECHARGE_TRIGGER_FRAC,
  NOCAR_RECHARGE_TARGET_FRAC,
} from "@/lib/optimizer/params"
import { decideDispatch } from "@/lib/dispatch-decide"
import {
  recordReport,
  readPlanner,
  writePlanner,
  clearPlanner,
  acquireLock,
  releaseLock,
  getControl,
  getLastDispatchAt,
  recordDispatch,
  readPlan,
  writePlan,
  updateCurrentPlan,
  appendReplanLog,
  appendTickLog,
  type PlannerState,
} from "@/lib/dispatcher-store"
import { deriveEvLoadW } from "@/lib/telemetry-normalize"
import type {
  WorkerMeta,
  WorkerPhase,
  WorkerActivity,
  ActivityStep,
  PlanSnapshot,
  SourceKind,
  TickLogEntry,
} from "@/lib/dispatcher-status"
import { DEFAULT_STATION_ID, type ApiTelemetryFrame } from "@/lib/amperio-api"

// ── Runtime configuration (env, with sensible site defaults) ─────────────────

const MIN_INTERVAL_MS = 5_000
const MAX_SUBTICKS = 4

export interface EngineConfig {
  stationId: string
  siteId: string
  assetId: string
  baseUrl: string
  authToken: string | null
  /**
   * PER-STATION PHYSICAL LIMITS (multi-location). Populated from the stations
   * registry when engineConfig(station) is called with a StationConfig;
   * defaults to the Gronau kernel constants for env-driven single-station use.
   */
  gridImportLimitKw: number
  gridRealPowerCapKw: number
  battCapacityKwh: number
  battCount: number
  battMaxPowerKw: number
  /** Tick interval in ms (the "configurable interval"). */
  intervalMs: number
  /**
   * How long a dispatched setpoint stays valid on the device (`valid_until`).
   * DECOUPLED from `intervalMs` on purpose: the device must hold the commanded
   * setpoint until the NEXT scheduled tick re-commands it, so a late, slow, or
   * briefly-missed tick (or a gap between event-driven replans) does not let the
   * charger revert to its local default mid-slot and silently stop following the
   * dispatch plan. Capped at one slot so a fully-dead dispatcher still expires the
   * command (device reverts to its safe local default) within the slot rather
   * than holding a stale grid-import setpoint indefinitely.
   */
  commandValidMs: number
  /** How many sub-ticks to run per cron invocation. */
  subTicks: number
  priceSource: "DAM" | "IDM"
  /**
   * Min spacing between real dispatches, as a fraction of intervalMs. A tick is
   * skipped if the previous dispatch was less than intervalMs*factor ago — the
   * hard backstop that stops multiple pingers from commanding Amperio more
   * frequently than configured (duplicate-command guard).
   */
  minSpacingFactor: number
  /**
   * Optional triggering event type, threaded from /api/dispatcher/replan.
   * Echoed into the command's `metadata.event_type`. The reserved value
   * "test" (TEST_EVENT_TYPE) makes the tick emit an inert liveness-probe
   * command instead of a real dispatch. Undefined for scheduled pinger ticks.
   */
  eventType?: string
  /**
   * Optional human-readable reason/source for this replan (e.g. the note +
   * caller name from /api/dispatcher/replan). Recorded verbatim in the replan
   * history so the table can show WHY each replan fired. Undefined for
   * scheduled ticks.
   */
  triggerNote?: string
}

/**
 * Build the engine config. With a StationConfig (multi-location tick loop) the
 * station's identity + physical limits come from the registry; without one the
 * legacy env-var/Gronau-constant path applies (backward compatible).
 */
export function engineConfig(station?: {
  stationId: string
  siteId: string
  assetId: string
  gridImportLimitKw: number
  gridRealPowerCapKw: number
  battCapacityKwh: number
  battCount: number
  battMaxPowerKw: number
}): EngineConfig {
  // DISPATCH_INTERVAL_MS is the canonical knob; fall back to legacy TICK_MS.
  const raw = Number.parseInt(
    process.env.DISPATCH_INTERVAL_MS ?? process.env.TICK_MS ?? "15000",
    10,
  )
  const intervalMs = Number.isFinite(raw) && raw >= MIN_INTERVAL_MS ? raw : 15_000

  // Sub-ticks default to 1: dispatch cadence is EXTERNALLY DRIVEN — the
  // external app calls /tick (or /replan) on its own schedule (e.g. every
  // second), so each invocation runs exactly ONE self-contained tick and
  // returns immediately. The old behaviour (loop a full minute's window of
  // sub-ticks with sleeps, for sparse ~1/min cron pingers) is still available
  // via DISPATCH_SUBTICKS or the ?subTicks=N query override.
  const subRaw = Number.parseInt(process.env.DISPATCH_SUBTICKS ?? "", 10)
  const subTicks = Number.isFinite(subRaw) && subRaw >= 1 ? Math.min(subRaw, MAX_SUBTICKS) : 1

  // Command validity (`valid_until`). Default bridges ~3 ticks (floor 90s) so a
  // late/missed scheduled tick doesn't drop the device to its default, capped at
  // one slot so a dead dispatcher still expires the setpoint. Override with
  // DISPATCH_COMMAND_VALID_MS (clamped to [intervalMs, SLOT_MS]).
  const cvRaw = Number.parseInt(process.env.DISPATCH_COMMAND_VALID_MS ?? "", 10)
  const cvDefault = Math.min(SLOT_MS, Math.max(intervalMs * 3, 90_000))
  const commandValidMs =
    Number.isFinite(cvRaw) && cvRaw > 0
      ? Math.min(SLOT_MS, Math.max(intervalMs, cvRaw))
      : cvDefault

  const priceSource = (process.env.PRICE_SOURCE ?? "DAM").toUpperCase() === "IDM" ? "IDM" : "DAM"

  // Cooldown factor: clamp to [0, 0.95]; 0 disables the backstop.
  const facRaw = Number.parseFloat(process.env.DISPATCH_MIN_SPACING_FACTOR ?? "0.8")
  const minSpacingFactor = Number.isFinite(facRaw) ? Math.max(0, Math.min(0.95, facRaw)) : 0.8

  return {
    stationId: station?.stationId ?? (process.env.STATION_ID?.trim() || DEFAULT_STATION_ID),
    siteId: station?.siteId ?? (process.env.SITE_ID?.trim() || "site_gronau_01"),
    assetId: station?.assetId ?? (process.env.ASSET_ID?.trim() || DEFAULT_STATION_ID),
    baseUrl: (process.env.AMPERIO_BASE_URL?.trim() || "https://amperio.enexa.me/api/v1").replace(
      /\/+$/,
      "",
    ),
    authToken: process.env.AMPERIO_AUTH_TOKEN?.trim() || null,
    gridImportLimitKw: station?.gridImportLimitKw ?? GRID_IMPORT_LIMIT_KW,
    gridRealPowerCapKw: station?.gridRealPowerCapKw ?? GRID_REAL_POWER_CAP_KW,
    battCapacityKwh: station?.battCapacityKwh ?? BATT_CAPACITY_KWH,
    battCount: station?.battCount ?? 2,
    battMaxPowerKw: station?.battMaxPowerKw ?? BATT_MAX_POWER_KW,
    intervalMs,
    commandValidMs,
    subTicks,
    priceSource: priceSource as "DAM" | "IDM",
    minSpacingFactor,
  }
}

// ── Amperio HTTP helpers (direct, server-side, Bearer-authed) ────────────────

interface PricesResponse {
  source: "DAM" | "IDM"
  prices: Array<{ ts: string; price_eur_mwh: number }>
}

function authHeaders(cfg: EngineConfig, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json", ...extra }
  if (cfg.authToken) h.Authorization = `Bearer ${cfg.authToken}`
  return h
}

function buildUrl(cfg: EngineConfig, path: string, params?: Record<string, string>): string {
  const u = new URL(cfg.baseUrl + path)
  if (params) for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v)
  return u.toString()
}

async function fetchLatestFrame(cfg: EngineConfig): Promise<ApiTelemetryFrame> {
  const res = await fetch(buildUrl(cfg, "/telemetry/latest", { station_id: cfg.stationId }), {
    headers: authHeaders(cfg),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`GET /telemetry/latest → ${res.status} ${await res.text()}`)
  return (await res.json()) as ApiTelemetryFrame
}

async function fetchPrices(cfg: EngineConfig, fromIso: string, toIso: string): Promise<PricesResponse> {
  const res = await fetch(
    buildUrl(cfg, "/prices", {
      source: cfg.priceSource,
      from: fromIso,
      to: toIso,
      resolution: "PT15M",
    }),
    { headers: authHeaders(cfg), cache: "no-store" },
  )
  if (!res.ok) throw new Error(`GET /prices → ${res.status} ${await res.text()}`)
  return (await res.json()) as PricesResponse
}

async function postDispatch(cfg: EngineConfig, payload: AnyDispatchPayload): Promise<number> {
  const res = await fetch(buildUrl(cfg, "/commands/dispatch"), {
    method: "POST",
    headers: authHeaders(cfg, { "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`POST /commands/dispatch → ${res.status} ${await res.text()}`)
  return res.status
}

// ── Slot math (epoch-anchored 15-min slots) ──────────────────────────────────

const slotOf = (ms: number) => Math.floor(ms / SLOT_MS)
const slotOfIso = (iso: string) => slotOf(new Date(iso).getTime())

// ── Heartbeat / activity helpers (persist straight into Redis) ───────────────

function workerMeta(cfg: EngineConfig, startedAt: string): WorkerMeta {
  return {
    stationId: cfg.stationId,
    siteId: cfg.siteId,
    assetId: cfg.assetId,
    tickMs: cfg.intervalMs,
    priceSource: cfg.priceSource,
    baseUrl: cfg.baseUrl,
    startedAt,
  }
}

async function reportActivity(
  cfg: EngineConfig,
  startedAt: string,
  tick: number,
  step: ActivityStep,
  message: string,
  level: WorkerActivity["level"] = "info",
  telemetryFrame?: ApiTelemetryFrame | null,
): Promise<void> {
  await recordReport({
    worker: workerMeta(cfg, startedAt),
    phase: "running",
    activity: { ts: new Date().toISOString(), step, message, level, tick },
    telemetryFrame,
  })
}

export async function reportPhase(cfg: EngineConfig, startedAt: string, phase: WorkerPhase): Promise<void> {
  await recordReport({ worker: workerMeta(cfg, startedAt), phase })
}

// ── Planner helpers (operate on the serialized PlannerState) ─────────────────

function plannerToSlotPrices(priceBySlot: Record<string, number>): SlotPrice[] {
  return Object.entries(priceBySlot).map(([slot, priceEurMwh]) => ({
    slot: Number(slot),
    priceEurMwh,
  }))
}

async function refreshPrices(cfg: EngineConfig, planner: PlannerState, nowMs: number): Promise<void> {
  // Fetch the FULL plan horizon, not a short 7 h peek. The LP plans up to
  // `horizonSteps · stepHours` ahead (24 h at high SOC), and planHorizon STOPS the
  // price loop at the first missing slot — so if we only cache ~7 h of prices the
  // effective arbitrage horizon is silently capped at ~7 h no matter the SOC. That
  // makes classic buy-low/sell-high arbitrage (charge in the midday trough,
  // discharge into the evening peak, usually >7 h apart) IMPOSSIBLE to plan. We
  // fetch now−1 h … now + horizon + 2 h margin so the whole receding horizon has
  // prices, and the window naturally spans into tomorrow so the next day's peak
  // becomes visible as soon as it is published.
  const horizonHours = (OPTIMIZER_DEFAULTS.horizonSteps || 96) * (OPTIMIZER_DEFAULTS.stepHours || 0.25)
  const fromIso = new Date(nowMs - 3_600_000).toISOString()
  const toIso = new Date(nowMs + (horizonHours + 2) * 3_600_000).toISOString()
  const res = await fetchPrices(cfg, fromIso, toIso)
  const map: Record<string, number> = {}
  for (const p of res.prices ?? []) {
    if (typeof p.price_eur_mwh === "number" && Number.isFinite(p.price_eur_mwh)) {
      map[String(slotOfIso(p.ts))] = p.price_eur_mwh
    }
  }
  // SAFETY: the upstream can return HTTP 200 with the slot rows present but every
  // price_eur_mwh === null (e.g. today's day-ahead auction not yet published, or an
  // ingestion gap). That is NOT a fresh curve — overwriting priceBySlot with the
  // resulting empty map would WIPE the last good curve and leave the optimizer with no
  // prices to dispatch against. So if we parsed zero finite prices, throw and let
  // the caller's catch reuse the cached curve (it already logs "reusing cached
  // curve"). We only replace the curve when we actually got priced slots.
  if (Object.keys(map).length === 0) {
    throw new Error(
      `upstream returned 0 priced slots for ${cfg.priceSource} ${fromIso}…${toIso} ` +
        `(prices null/unpublished) — keeping last good curve`,
    )
  }
  planner.priceBySlot = map
  planner.pricedSlots = plannerToSlotPrices(map)
}

// v3: replan() removed. The kernel handles clearance + reserve per-tick based
// on the price curve, so we no longer need merit-order planning.

// ── One dispatch cycle (never throws) ────────────────────────────────────────

export interface TickResult {
  ok: boolean
  tick: number
  phase: "dispatched" | "skipped" | "error"
  message: string
  /** Committed output of this tick, captured for the Tick logger. */
  output?: {
    commandW: number | null
    commandKw: number | null
    reserveFloorPct: number | null
    socCeilingPct: number | null
    priceEurMwh: number | null
    wasReplan: boolean
    mpcOk: boolean
    /** Committed plan snapshot, so a Tick-logger row can drill into in/out. */
    snapshot: PlanSnapshot | null
  }
}

export async function runOneTick(cfg: EngineConfig): Promise<TickResult> {
  const dt_h = cfg.intervalMs / 3_600_000
  const nowMs = Date.now()
  const currentSlot = slotOf(nowMs)

  const planner = await readPlanner()
  if (!planner.startedAt) planner.startedAt = new Date().toISOString()
  const startedAt = planner.startedAt
  planner.tickSeq += 1
  const tick = planner.tickSeq

  // ── Multi-pinger cooldown guard (steady ticks only) ────────────────────────
  // If another caller dispatched very recently, skip this tick entirely (no
  // Amperio calls) so we never command more frequently than configured. This is
  // the hard backstop that keeps a fast external pinger (e.g. 1 Hz) from
  // re-commanding the device faster than the configured interval.
  //
  // EVENT REPLANS BYPASS THIS. When `cfg.eventType` is set (car connect /
  // disconnect, price divergence, grid constraint, SoC threshold, operator
  // "Replan now", liveness test) the caller is reporting that the WORLD
  // CHANGED — the whole point is to re-solve and re-command immediately, even
  // if a steady tick dispatched 2 s ago. Without this bypass a car plugging in
  // right after a scheduled tick would wait out the cooldown before the plan
  // reacts — exactly the latency the event API exists to remove.
  const minSpacingMs = cfg.intervalMs * cfg.minSpacingFactor
  if (minSpacingMs > 0 && !cfg.eventType) {
    const lastDispatchAt = await getLastDispatchAt()
    if (lastDispatchAt != null && nowMs - lastDispatchAt < minSpacingMs) {
      const sinceS = ((nowMs - lastDispatchAt) / 1000).toFixed(1)
      const minS = (minSpacingMs / 1000).toFixed(0)
      await reportActivity(
        cfg,
        startedAt,
        tick,
        "idle",
        `Skipped — last dispatch ${sinceS}s ago (< ${minS}s min spacing). Another pinger is driving; not re-commanding Amperio.`,
        "warn",
      )
      await writePlanner(planner)
      return { ok: true, tick, phase: "skipped", message: "cooldown" }
    }
  }

  // ── Liveness probe (test event) ────────────��──────────────────────────────
  // A "test" event proves the FULL end-to-end path (Enexa → Middleware → edge →
  // Command Status) WITHOUT touching telemetry, prices, the planner kernel, or
  // hardware. We short-circuit here — before any data fetch — so the probe stays
  // green even when telemetry/prices are degraded, isolating the transport from
  // the data plane. The edge device recognises command_type:"test" (and the
  // all-"test" setpoints) and ignores actuation while still acking.
  if (cfg.eventType === TEST_EVENT_TYPE) {
    await reportActivity(
      cfg,
      startedAt,
      tick,
      "deciding",
      "Liveness probe — building inert test command (command_type:test, all setpoints \"test\")…",
    )
    const testPayload = buildTestPayload({
      siteId: cfg.siteId,
      assetId: cfg.assetId,
      timestamp: new Date(nowMs).toISOString(),
      validForMs: cfg.intervalMs,
      eventType: TEST_EVENT_TYPE,
    })
    await reportActivity(cfg, startedAt, tick, "dispatching", `POST /commands/dispatch — TEST ${testPayload.command_id}`)
    await writePlanner(planner)
    try {
      const status = await postDispatch(cfg, testPayload)
      await recordDispatch(Date.now())
      await reportActivity(
        cfg,
        startedAt,
        tick,
        "done",
        `Liveness OK (HTTP ${status}) — edge round-trip alive; no setpoints actuated`,
      )
      return { ok: true, tick, phase: "dispatched", message: `liveness test ${testPayload.command_id}` }
    } catch (err) {
      await reportActivity(cfg, startedAt, tick, "error", `Liveness probe failed: ${(err as Error).message}`, "error")
      return { ok: false, tick, phase: "error", message: "liveness test failed" }
    }
  }

  await reportActivity(cfg, startedAt, tick, "telemetry", `Fetching telemetry frame (slot ${currentSlot})…`)

  let frame: ApiTelemetryFrame
  try {
    frame = await fetchLatestFrame(cfg)
  } catch (err) {
    await reportActivity(cfg, startedAt, tick, "error", `Telemetry fetch failed: ${(err as Error).message}`, "error")
    await writePlanner(planner)
    return { ok: false, tick, phase: "error", message: "telemetry fetch failed" }
  }

  const bs = frame.batteries ?? []
  const b1 = bs[0]?.soc_pct ?? 50
  const b2 = bs[1]?.soc_pct ?? b1
  const avgSoc = (b1 + b2) / 2
  // Weakest string — feeds the planner's RISK decisions and the reserve guard.
  // Live-diagnosed (Jul 17 2026): B1 85% / B2 41% averaged to 63%, so the
  // planner idled through cheap afternoon slots deferring recharge to the next
  // day while one string sat at 41%. The average must never mask imbalance.
  const minSoc = Math.min(b1, b2)
  // EV load on-site NOW (kW). `p_ev_w` is a known-broken register (stuck at 0),
  // so reconstruct from the metered power balance (ev ≈ batt − grid) via the
  // same helper ingestion + the backtest use. This is the live demand the optimizer
  // needs to see at its committed step, otherwise it plans against the forecast
  // only and commits g[0]=0 at the reserve floor while real cars are charging.
  const rawEvLoadW = (frame.chargers ?? []).reduce((acc, c) => acc + (c.p_ev_w || 0), 0)
  const gridPowerW = typeof frame.grid?.p_grid_w === "number" ? frame.grid.p_grid_w : null
  const battPowerW = bs.reduce(
    (acc, b) => acc + (typeof b.power_w === "number" ? b.power_w : 0),
    0,
  )
  const evLoadKw = (deriveEvLoadW(gridPowerW, battPowerW, rawEvLoadW) ?? 0) / 1000

  // ── TRUE EV DEMAND (served vs. demanded) ──────────────────────────────────
  // `evLoadKw` above is what was SERVED last frame (batt − grid). When a car is
  // plugged but the battery is throttling it (tapped out / at the floor with no
  // grid import), served UNDERSTATES what the car actually wants — and feeding
  // the served value back into the optimizer makes it plan to cover only the throttled
  // amount, so the car never ramps up (a self-reinforcing deadlock).
  //
  // The authoritative DEMAND signal is the car's live negotiated acceptance rate
  // `p_ev_max_w` (per plugged connector) — NOT the connector's static spec. It
  // is what the vehicle will accept this instant and tapers as it fills, so it
  // tracks real demand. We sum it over connectors reporting Plugged + a positive
  // rate, then take max(served, accepted): the optimiser must cover at least the
  // load already on-site, and at least what the plugged cars are asking for. The
  // LP then decides battery-vs-grid by price/SOC and imports the shortfall the
  // battery shouldn't/can't supply — guaranteeing TOTAL demand is met. Absent/0
  // acceptance (no car, or none reported yet) ⇒ falls back to served (unchanged).
  const pluggedAcceptKw =
    (frame.chargers ?? []).reduce((acc, c) => {
      const plugged = c.plug_state === "Plugged"
      const rateW = typeof c.p_ev_max_w === "number" && c.p_ev_max_w > 0 ? c.p_ev_max_w : 0
      return plugged ? acc + rateW : acc
    }, 0) / 1000
  // CAR-PRESENT GATE: the derived `evLoadKw` absorbs the site's AUX/hotel load
  // (deriveEvLoadW's own contract — `p_ev_w` registers are typically dead and
  // aux is not metered separately), so with NO car on site it still reads
  // ~5 kW and, unguarded, tricks the optimizer's `evConnected` check into
  // firing firm car-serve rules (e.g. firm_no_arb_car_grid importing at
  // expensive prices for a car that isn't there). A car is present only if a
  // connector reports Plugged or its own metered `p_ev_w` register is actually
  // delivering. No car ⇒ live demand is 0 by definition; aux stays covered by
  // the planner's separate auxReserveKw term (never double-counted).
  const carPresent = (frame.chargers ?? []).some(
    (c) => c.plug_state === "Plugged" || (typeof c.p_ev_w === "number" && c.p_ev_w > 500),
  )
  const trueDemandKw = carPresent ? Math.max(evLoadKw, pluggedAcceptKw) : 0

  // ── LIVE AUX MEASUREMENT (for the planner's dynamic aux reserve) ──────────
  // The derived `evLoadKw` (batt − grid) absorbs aux by construction, so:
  //   • no car on site  → the whole derived load IS aux (pure hotel draw);
  //   • car + live p_ev_w registers → aux = derived − metered EV;
  //   • car + dead registers → unmeasurable this tick → null (planner falls
  //     back to the fixed reserve).
  // Live-diagnosed (Jul 17 2026): measured aux ≈ 0–0.1 kW while the fixed 8 kW
  // reserve capped every charging hour at 79 kW — the planner now reserves
  // max(measured, 2 kW floor) instead.
  const rawEvKw = rawEvLoadW / 1000
  const liveAuxKw: number | null = !carPresent
    ? Math.max(0, evLoadKw)
    : rawEvLoadW > 500
      ? Math.max(0, evLoadKw - rawEvKw)
      : null

  await reportActivity(
    cfg,
    startedAt,
    tick,
    "telemetry",
    `Telemetry: SOC ${avgSoc.toFixed(1)}% (min ${minSoc.toFixed(1)}%) · EV served ${evLoadKw.toFixed(1)} kW` +
      (pluggedAcceptKw > evLoadKw + 0.1 ? ` · demand ${trueDemandKw.toFixed(1)} kW (car accept)` : ""),
    "info",
    frame,
  )

  if (planner.lastPriceRefreshSlot !== currentSlot) {
    await reportActivity(cfg, startedAt, tick, "prices", `Refreshing ${cfg.priceSource} price curve…`)
    try {
      await refreshPrices(cfg, planner, nowMs)
      planner.lastPriceRefreshSlot = currentSlot
      await reportActivity(cfg, startedAt, tick, "prices", `Prices refreshed: ${planner.pricedSlots.length} slots loaded`)
    } catch (err) {
      await reportActivity(
        cfg,
        startedAt,
        tick,
        "prices",
        `Price refresh failed, reusing cached curve: ${(err as Error).message}`,
        "warn",
      )
    }
  }

  // ── SHARED DECISION CORE (decideDispatch) ─────────────────────────────────
  // ONE function decides dispatch for BOTH live and replay: `decideDispatch`
  // (lib/dispatch-decide.ts) runs planHorizon → decision (committed step or safe
  // fallback) → reserve guard → toDispatchPayload. The replay/backtest harness
  // calls the SAME function, so live and replay cannot silently diverge on the
  // decision — this engine only adds the side effects around it (activity log,
  // plan-snapshot rotation, the POST, planner persistence).
  const priceEurMwh = planner.priceBySlot[String(currentSlot)]

  await reportActivity(cfg, startedAt, tick, "deciding", "Solving the optimizer…")

  // Site grid-import ceiling: the configured GRID_IMPORT_LIMIT_KW (87) is the
  // SINGLE authoritative cap. Register 2010 (p_grid_consumption_limit_w) is NOT
  // used as the planning ceiling because it echoes the clearance WE command —
  // adopting it created a self-reinforcing ratchet (read 79 → plan 79 →
  // command 79 → read 79) that silently derated the site ~10% and penalized
  // the with-arbitrage system versus the true 87 kW connection. Genuine
  // external curtailment arrives via the grid_constraint event replan, not via
  // this echoed register. We keep the raw reading purely as a diagnostic.
  const liveLimitW = frame.station?.p_grid_consumption_limit_w
  const echoedLimitKw =
    typeof liveLimitW === "number" && Number.isFinite(liveLimitW) && liveLimitW > 0
      ? liveLimitW / 1000
      : null
  if (echoedLimitKw != null && Math.abs(echoedLimitKw - cfg.gridImportLimitKw) > 0.5) {
    console.log(
      `[v0-dispatch] register 2010 reports ${echoedLimitKw.toFixed(1)} kW but the configured cap is ${cfg.gridImportLimitKw} kW — planning against the configured cap (register is our own echoed clearance, not an external limit)`,
    )
  }
  // PLAN at the REAL-power ceiling (~83.5 kW): the 87 is kVA (apparent) and the
  // meter runs at PF ≈ 0.96 — live-measured plateau 83.0–83.5 kW during a
  // ~190 kW session. Planning at 87 schedules import the wire can never carry
  // and the shortfall falls onto the battery as unplanned cycling. The wire
  // clearance envelope (P_grid_clearance_w) still advertises the full kVA
  // limit via the payload's gridImportLimitKw below.
  const gridLimitKw: number | null = cfg.gridRealPowerCapKw

  const carConnected = (frame.chargers ?? []).some((c) => c.plug_state === "Plugged")
  const chargerUnitIds = (frame.chargers ?? [])
    .map((c) => c.unit_id)
    .filter((id) => Number.isFinite(id))
  // Live per-unit state for charging_mode auto-select + EV power safety clamp.
  const perUnitState = (frame.chargers ?? []).map((c) => ({
    unitId: c.unit_id,
    plugged: c.plug_state === "Plugged",
    coupled: c.boost_contactor === "closed",
    connectorMaxW: c.p_cp_max_w,
    // Car's negotiated accept rate — the EV ceiling is min(connector, car).
    evMaxW: c.p_ev_max_w,
  }))

  const result = await decideDispatch({
    stationId: cfg.stationId,
    siteId: cfg.siteId,
    assetId: cfg.assetId,
    currentSlot,
    timestampMs: nowMs,
    // Hold the setpoint until the next scheduled tick re-commands it (not just
    // one interval), so a missed/late tick or a gap between event replans can't
    // drop the charger to its local default mid-slot.
    commandValidMs: cfg.commandValidMs,
    eventType: cfg.eventType,
    avgSocPct: avgSoc,
    minSocPct: minSoc,
    // Live demand → committed step. We pass max(served, car-accept) so the optimizer
    // imports to serve the FULL demand of plugged cars right now — even when
    // this hour's forecast is ~0 and the buffer is at the reserve floor, and
    // even when the battery is currently throttling the car (served < wanted).
    trueDemandKw,
    gridLimitKw,
    gridImportEnvelopeKw: cfg.gridImportLimitKw,
    liveAuxKw,
    priceBySlot: planner.priceBySlot,
    chargerUnitIds: chargerUnitIds.length ? chargerUnitIds : undefined,
    perUnitState,
    carConnected,
    forcedRechargeActive: planner.forcedRechargeActive === true,
  })

  const committedSnapshot: PlanSnapshot | null = result.snapshot
  const mpcOk = result.mpcOk
  const decision = result.decision
  const payload = result.payload
  // Persist the no-car forced-recharge latch for the next tick (via writePlanner).
  planner.forcedRechargeActive = result.forcedRechargeActive

  // ── Plan-snapshot rotation + solve reporting (engine-only side effects) ────
  // On a replan EVENT (or when the anchor slot advances) rotate current→previous
  // so the status page can diff the replan; held ticks refresh in place.
  let wasReplan = false
  if (committedSnapshot) {
    const existing = await readPlan()
    const isReplan = Boolean(cfg.eventType) || existing.current?.baseSlot !== committedSnapshot.baseSlot
    wasReplan = isReplan
    if (isReplan) {
      await writePlan(committedSnapshot)
      await reportActivity(
        cfg,
        startedAt,
        tick,
        "planning",
        `the optimizer replanned (${cfg.eventType ?? "slot"}): clearance ${committedSnapshot.clearanceKw.toFixed(1)} kW · ` +
          `reserve ${committedSnapshot.reserveFloorStep1Pct.toFixed(0)}% · ${committedSnapshot.horizonSteps} steps` +
          (committedSnapshot.objectiveEur != null ? ` · obj €${committedSnapshot.objectiveEur.toFixed(2)}` : ""),
      )
    } else {
      // Held tick: refresh the current snapshot in place (no rotation).
      await updateCurrentPlan(committedSnapshot)
    }
  } else if (result.solveStatus === "error") {
    await reportActivity(
      cfg,
      startedAt,
      tick,
      "deciding",
      `the optimizer solve failed — sending safe full-clearance command: ${result.solveError ?? "unknown error"}`,
      "warn",
    )
  } else {
    await reportActivity(
      cfg,
      startedAt,
      tick,
      "deciding",
      "the optimizer produced no usable plan — sending safe full-clearance command",
      "warn",
    )
  }

  // ── Reserve-guard reporting + snapshot override (engine-only side effects) ──
  // decideDispatch already applied the guard to the committed setpoint; here we
  // only log it and reflect the override in the PERSISTED plan snapshot so the
  // Dispatching Plan UI shows the REAL committed setpoint (what's on the wire),
  // not the LP's pre-guard intent. We preserve the LP's own value in
  // `lpClearanceKw` so the view can show "LP intent → guard-forced", and mirror
  // the override onto the committed step's grid bar so the chart matches too.
  const reserveGuardEngaged = result.reserveGuardEngaged
  if (reserveGuardEngaged) {
    const why =
      result.reserveGuardReason === "car-guard"
        ? `car connected + SOC ${avgSoc.toFixed(1)}% < ${(CAR_GUARD_FRAC * 100).toFixed(0)}%`
        : `no car + SOC ${avgSoc.toFixed(1)}% < ${(NOCAR_RECHARGE_TRIGGER_FRAC * 100).toFixed(0)}% (hold to ${(NOCAR_RECHARGE_TARGET_FRAC * 100).toFixed(0)}%)`
    await reportActivity(
      cfg,
      startedAt,
      tick,
      "deciding",
      `RESERVE GUARD engaged — ${why}. Forcing grid import to ${decision.clearanceKw.toFixed(1)} kW (full cap).`,
      "warn",
      frame,
    )
    if (committedSnapshot) {
      committedSnapshot.lpClearanceKw = committedSnapshot.clearanceKw
      committedSnapshot.clearanceKw = decision.clearanceKw
      committedSnapshot.reserveGuardEngaged = true
      committedSnapshot.reserveGuardReason = result.reserveGuardReason ?? undefined
      if (committedSnapshot.steps[0]) committedSnapshot.steps[0].gridKw = decision.clearanceKw
      // Re-persist current-in-place (rotation, if any, already happened above).
      await updateCurrentPlan(committedSnapshot).catch(() => {})
    }
  }

  const priceZone = classifyPriceZone(priceEurMwh)
  const setpoint =
    `P_grid_request ${decision.clearanceKw.toFixed(1)} kW → ${payload.station.P_grid_request_w} W ` +
    `(neg=import, clearance ${payload.station.P_grid_clearance_w} W) · ` +
    `reserve ${decision.reserveSocPct.toFixed(0)}% · ceiling ${decision.targetSocPct.toFixed(0)}% · ` +
    `${mpcOk ? "the optimizer" : "SAFE fallback"}${reserveGuardEngaged ? " · RESERVE GUARD" : ""} · ${priceZone}`

  await reportActivity(cfg, startedAt, tick, "dispatching", `POST /commands/dispatch — ${setpoint}`)

  // Persist planner state before the network POST so a failed dispatch still
  // advances budgets/plan exactly as the simulator would.
  await writePlanner(planner)

  // Record one replan-history row per genuine replan, AFTER the dispatch is
  // attempted, so it carries the real output command + outcome (not an intent).
  // OUTPUT COMMAND = the ACTUAL grid-import setpoint (P_grid_request_w), NOT the
  // P_grid_clearance_w envelope. The request is negative for import (e.g.
  // -38400 W) and is what the device actually acts on — 0 when idle/discharging,
  // g[t] when charging from grid. We display its magnitude (unsigned import kW),
  // so an operator sees how much we're importing now, not the fixed ceiling.
  const requestW = payload.station.P_grid_request_w ?? null
  const commandW = requestW != null ? Math.abs(requestW) : null
  const commandKw = commandW != null ? Math.round((commandW / 1000) * 10) / 10 : null
  const logReplan = async (dispatched: boolean) => {
    if (!wasReplan || !committedSnapshot) return
    await appendReplanLog({
      solvedAt: committedSnapshot.solvedAt,
      eventType: cfg.eventType,
      trigger: cfg.triggerNote,
      status: committedSnapshot.status,
      clearanceKw: committedSnapshot.clearanceKw,
      reserveFloorStep1Pct: committedSnapshot.reserveFloorStep1Pct,
      objectiveEur: committedSnapshot.objectiveEur,
      horizonSteps: committedSnapshot.horizonSteps,
      commandW,
      commandKw,
      dispatched,
      isTest: cfg.eventType === TEST_EVENT_TYPE,
      snapshot: committedSnapshot,
    }).catch(() => {})
  }

  // Output captured on every dispatched tick (replan OR steady cadence) for the
  // Tick logger — so a held/scheduled tick that commits a setpoint still shows
  // its command, even though it never appends to the replan history.
  const output = {
    commandW,
    commandKw,
    reserveFloorPct: decision.reserveSocPct,
    socCeilingPct: decision.targetSocPct,
    priceEurMwh,
    wasReplan,
    mpcOk,
    // Carry the committed horizon so the Tick logger drill-down can show this
    // tick's Plan Input + Plan Output, exactly like the replan history rows.
    snapshot: committedSnapshot,
  }

  try {
    const status = await postDispatch(cfg, payload)
    // Record the dispatch time so the cooldown guard + cadence monitor can see
    // how frequently commands are actually going out across all pingers.
    await recordDispatch(Date.now())
    await reportActivity(cfg, startedAt, tick, "done", `Dispatched (HTTP ${status}) — ${setpoint}`)
    await logReplan(true)
    return { ok: true, tick, phase: "dispatched", message: setpoint, output }
  } catch (err) {
    await reportActivity(cfg, startedAt, tick, "error", `Dispatch failed: ${(err as Error).message}`, "error")
    await logReplan(false)
    return { ok: false, tick, phase: "error", message: "dispatch failed", output }
  }
}

// ── Sub-tick window (one cron invocation) ────────────────────────────────────

export interface WindowResult {
  ran: boolean
  reason?: string
  subTicks: number
  results: TickResult[]
  lastPhase: string | null
}

/** Cooperative sleep helper. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Who initiated a tick window — recorded in the Tick logger. */
export interface TickCaller {
  name?: string | null
  kind?: SourceKind
}

/**
 * Append one Tick-logger row for a finished window. Best-effort — never throws.
 * Invoked for every call that passes a caller — both the steady `/tick` cadence
 * AND event-driven `/replan` ticks (the latter tagged `wasReplan`), so the Tick
 * logger is the full execution stream; the replan history stays the event view.
 * Logs dispatched / error / stopped / cooldown-skipped calls, but DROPS benign
 * "locked" no-ops (a concurrent pinger held the lock) to avoid log spam.
 */
async function logTick(result: WindowResult, caller: TickCaller): Promise<void> {
  const last = result.results.length ? result.results[result.results.length - 1] : null
  const out = last?.output
  // Map the window into a single outcome the logger renders as a status pill.
  let outcome: TickLogEntry["outcome"]
  if (result.reason === "stopped") outcome = "stopped"
  else if (result.reason === "locked") outcome = "locked"
  else if (last?.phase === "dispatched") outcome = "dispatched"
  else if (last?.phase === "error") outcome = "error"
  else outcome = "skipped"

  // Skip benign "locked" no-ops: when several pingers run concurrently only one
  // wins the run-lock per interval and the rest would spam the log with rows
  // that did nothing. We still log "stopped" (operator paused — meaningful),
  // "skipped" (cooldown spacing), dispatched, and error.
  if (outcome === "locked") return

  const entry: TickLogEntry = {
    at: Date.now(),
    source: caller.name ?? null,
    sourceKind: caller.kind,
    subTicks: result.subTicks,
    ran: result.ran,
    outcome,
    reason: result.reason ?? last?.message ?? null,
    commandW: out?.commandW ?? null,
    commandKw: out?.commandKw ?? null,
    reserveFloorPct: out?.reserveFloorPct ?? null,
    socCeilingPct: out?.socCeilingPct ?? null,
    priceEurMwh: out?.priceEurMwh ?? null,
    wasReplan: out?.wasReplan ?? false,
    mpcOk: out?.mpcOk ?? false,
    // Embed the committed horizon (dispatched ticks only) for the drill-down.
    snapshot: out?.snapshot ?? undefined,
  }
  await appendTickLog(entry).catch(() => {})
}

/**
 * Run one cron invocation's worth of dispatch: acquire the run-lock, then run
 * `subTicks` sub-ticks spaced `intervalMs` apart, refreshing the heartbeat each
 * time. The lock is always released. No-op (and unlocked) when the operator
 * intent is "stopped" or another invocation already holds the lock.
 *
 * When `caller` is provided (the steady `/tick` endpoint), every call — even a
 * no-op — is appended to the Tick logger. `/replan` omits it so event ticks are
 * not double-logged (they already appear in the replan history).
 */
export async function runTickWindow(
  cfg: EngineConfig = engineConfig(),
  caller?: TickCaller,
  opts?: { lockWaitMs?: number },
): Promise<WindowResult> {
  if ((await getControl()) !== "running") {
    const r: WindowResult = { ran: false, reason: "stopped", subTicks: 0, results: [], lastPhase: null }
    if (caller) await logTick(r, caller)
    return r
  }

  // Lock TTL covers the whole window (sub-ticks + the sleeps between them) plus
  // a safety margin, so a crashed invocation auto-releases. A short browser
  // tick (subTicks=1) therefore holds the lock only ~interval+margin, not a
  // fixed minute — letting the next ping proceed promptly.
  const windowMs = cfg.subTicks * cfg.intervalMs
  const lockTtlSec = Math.min(70, Math.ceil(windowMs / 1000) + 10)

  // Acquire the run-lock. Schedulers (page ticker, pinger) pass no wait and bail
  // immediately on contention — they'll just try again next interval. But an
  // EXPLICIT operator/event replan passes lockWaitMs and briefly RETRIES, so a
  // transient lock held by a concurrent pinger doesn't surface as a spurious
  // "Did not run: locked". We re-check Stop intent between retries.
  const lockWaitMs = Math.max(0, opts?.lockWaitMs ?? 0)
  const lockDeadline = Date.now() + lockWaitMs
  let token = await acquireLock(lockTtlSec)
  while (!token && Date.now() < lockDeadline) {
    await sleep(250)
    if ((await getControl()) !== "running") {
      const r: WindowResult = { ran: false, reason: "stopped", subTicks: 0, results: [], lastPhase: null }
      if (caller) await logTick(r, caller)
      return r
    }
    token = await acquireLock(lockTtlSec)
  }
  if (!token) {
    const r: WindowResult = { ran: false, reason: "locked", subTicks: 0, results: [], lastPhase: null }
    if (caller) await logTick(r, caller)
    return r
  }

  const results: TickResult[] = []
  try {
    for (let i = 0; i < cfg.subTicks; i++) {
      // Re-check intent each sub-tick so a Stop mid-window takes effect quickly.
      if ((await getControl()) !== "running") break
      const r = await runOneTick(cfg)
      results.push(r)
      // Space sub-ticks by the interval, but don't sleep after the last one.
      if (i < cfg.subTicks - 1) await sleep(cfg.intervalMs)
    }
  } finally {
    await releaseLock(token)
  }

  const result: WindowResult = {
    ran: results.length > 0,
    subTicks: results.length,
    results,
    lastPhase: results.length ? results[results.length - 1].phase : null,
  }
  if (caller) await logTick(result, caller)
  return result
}

/**
 * Mark the start of a fresh run: clear planner state and emit a "starting"
 * heartbeat so the status page resets its counters. Called by the control
 * route when the operator presses Start.
 */
export async function announceStart(cfg: EngineConfig = engineConfig()): Promise<{ authConfigured: boolean }> {
  await clearPlanner()
  await reportPhase(cfg, new Date().toISOString(), "starting")
  return { authConfigured: cfg.authToken != null }
}

/** Emit a "stopping" heartbeat so the status page flips to offline immediately. */
export async function announceStop(cfg: EngineConfig = engineConfig()): Promise<void> {
  await reportPhase(cfg, new Date().toISOString(), "stopping")
}
