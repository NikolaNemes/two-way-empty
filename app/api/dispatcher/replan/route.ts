import { type NextRequest, NextResponse } from "next/server"
import { runTickWindow, engineConfig } from "@/lib/dispatch-engine"
import { recordReport, recordTickSource, recordTickEvent } from "@/lib/dispatcher-status"
import type { WorkerMeta } from "@/lib/dispatcher-status"
import { readPlan, withStationScope } from "@/lib/dispatcher-store"
import { compressPlanToCommands } from "@/lib/plan-commands"

// A replan runs a single immediate dispatch tick; allow generous headroom.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * EVENT-TRIGGERED REPLAN — push-based dispatch trigger.
 * ════════════════════════════════════════════════════════════════════════
 *
 * An ADDITIONAL, optional way to drive dispatch alongside the scheduled pinger
 * (`/api/dispatcher/tick`). It exists for external systems that detect events
 * worth re-optimising for (an SOC threshold crossing, a fresh price update, an
 * EV plug/unplug, a grid constraint, …) and want to ask Amperio to replan NOW
 * instead of waiting for the next scheduled tick.
 *
 * It changes NOTHING about how dispatch works — a "replan" here IS one
 * immediate dispatch tick. The endpoint reuses the exact same code path as the
 * pinger (`runTickWindow` → `runOneTick` → shared kernel), so the live service,
 * the pinger and the back-test can never diverge. The caller does NOT send any
 * telemetry/price data: the tick fetches the latest telemetry + price curve
 * itself, runs the kernel, and POSTs the setpoint to Amperio — same as always.
 *
 * BEHAVIOUR (by design):
 *   • Bypasses the multi-pinger cooldown (minSpacingFactor=0) — an event is a
 *     legitimate reason to re-command immediately. The Redis run-lock still
 *     applies, so it never double-dispatches concurrently with a scheduled tick.
 *   • Runs exactly ONE sub-tick (the "replan"), never a multi-tick window.
 *   • No-op when operator intent is "stopped" (returns ran:false,
 *     reason:"stopped") — it respects the Stop button exactly like the pinger.
 *
 * INPUT: a required, validated `eventType` (see EVENT_TYPES) plus an optional
 * `name`/`note` for traceability — supplied as a JSON body (POST) or query
 * params (GET/POST). The eventType is recorded in the activity feed so the
 * dashboard shows *why* each event-driven replan fired.
 *
 * AUTH: identical to the tick endpoint. When DISPATCHER_TICK_TOKEN (legacy
 * CRON_SECRET) is set, send `Authorization: Bearer <token>` or `?secret=<token>`;
 * same-origin dashboard requests are allowed without it; open in local/dev.
 */

/**
 * The closed set of accepted event types. Keep in sync with the enum documented
 * in the OpenAPI spec (`app/api/dispatcher/openapi.json/route.ts`).
 */
const EVENT_TYPES = [
  "soc_threshold", // battery SOC crossed a configured high/low band
  "price_update", // a new / revised price curve arrived
  "ev_plug_event", // an EV plugged in (load appeared)
  "ev_unplug_event", // an EV unplugged (load disappeared)
  "grid_constraint", // grid/connection limit changed (e.g. curtailment)
  "setpoint_deviation", // measured power drifted from the commanded setpoint
  "schedule_change", // an upstream schedule / reservation changed
  "manual", // an operator manually requested a replan
  "external", // a generic externally-detected event
  "test", // liveness probe — emits an inert test command, actuates nothing
] as const

type EventType = (typeof EVENT_TYPES)[number]

function isEventType(v: unknown): v is EventType {
  return typeof v === "string" && (EVENT_TYPES as readonly string[]).includes(v)
}

// ── Auth (mirrors /api/dispatcher/tick) ──────────────────────────────────────

function isSameOrigin(req: NextRequest): boolean {
  if (req.headers.get("sec-fetch-site") === "same-origin") return true
  const origin = req.headers.get("origin")
  if (origin) {
    try {
      return new URL(origin).host === req.nextUrl.host
    } catch {
      return false
    }
  }
  return false
}

function authorize(req: NextRequest): { ok: boolean; via: string } {
  const secret = (process.env.DISPATCHER_TICK_TOKEN ?? process.env.CRON_SECRET)?.trim()
  if (!secret) return { ok: true, via: "open" } // local/dev: no token configured

  const authHeader = req.headers.get("authorization") ?? ""
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : ""
  if (bearer && bearer === secret) return { ok: true, via: "bearer" }

  const qs = req.nextUrl.searchParams.get("secret")?.trim()
  if (qs && qs === secret) return { ok: true, via: "query" }

  if (isSameOrigin(req)) return { ok: true, via: "same-origin" }

  return { ok: false, via: "none" }
}

/** Non-crypto hash → short hex, to fingerprint anonymous callers. */
function shortHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(16)
}

// ── Input parsing (JSON body OR query params) ────────────────────────────────

interface ReplanInput {
  eventType?: string
  name?: string
  note?: string
  stationId?: string
}

async function parseInput(req: NextRequest): Promise<ReplanInput> {
  const sp = req.nextUrl.searchParams
  const fromQuery: ReplanInput = {
    eventType: sp.get("eventType") ?? sp.get("event_type") ?? sp.get("event") ?? undefined,
    name: sp.get("name") ?? undefined,
    note: sp.get("note") ?? undefined,
    stationId: sp.get("stationId") ?? sp.get("station_id") ?? sp.get("station") ?? undefined,
  }
  // Merge a JSON body when present (body wins over query for overlapping keys).
  if (req.method === "POST") {
    try {
      const ct = req.headers.get("content-type") ?? ""
      if (ct.includes("application/json")) {
        const body = (await req.json()) as Record<string, unknown>
        return {
          eventType:
            (body.eventType as string) ??
            (body.event_type as string) ??
            (body.event as string) ??
            fromQuery.eventType,
          name: (body.name as string) ?? fromQuery.name,
          note: (body.note as string) ?? fromQuery.note,
          stationId:
            (body.stationId as string) ??
            (body.station_id as string) ??
            (body.station as string) ??
            fromQuery.stationId,
        }
      }
    } catch {
      // Malformed/empty body → fall back to query params.
    }
  }
  return fromQuery
}

/**
 * MULTI-LOCATION safety net: infer the target station from the event's OWN
 * text when the caller didn't pass an explicit stationId.
 *
 * Live-hit (aug 2026): the middleware fired "unit 1 external" replans named
 * `amperio:chargepost_norderstedt_001/1` with no stationId — the route
 * silently fell through to the legacy default and PLANNED + DISPATCHED
 * GRONAU off a Norderstedt charger event. Cross-station dispatch is never
 * acceptable, so any station identity embedded in name/note must win over
 * the default. Explicit stationId still takes precedence over inference.
 */
async function inferStationFromEvent(name: string, note: string): Promise<string | null> {
  const haystack = `${name} ${note}`.toLowerCase()
  if (!haystack.trim()) return null
  try {
    const { listStations } = await import("@/lib/stations")
    const all = await listStations({ enabledOnly: false })
    // Longest-id-first so an id that happens to be a prefix of another can
    // never shadow the more specific match.
    const hits = all
      .filter((s) => haystack.includes(s.stationId.toLowerCase()))
      .sort((a, b) => b.stationId.length - a.stationId.length)
    return hits[0]?.stationId ?? null
  } catch {
    return null // Inference is best-effort; explicit paths still work.
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handle(req: NextRequest) {
  const auth = authorize(req)
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    )
  }

  const input = await parseInput(req)
  const eventType = (input.eventType ?? "").trim()

  if (!eventType) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_event_type",
        message:
          "An 'eventType' is required. Provide it in the JSON body or as '?eventType=' query param. " +
          `Accepted values: ${EVENT_TYPES.join(", ")}.`,
        acceptedEventTypes: EVENT_TYPES,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    )
  }

  if (!isEventType(eventType)) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_event_type",
        message:
          `Unknown eventType '${eventType}'. Accepted values: ${EVENT_TYPES.join(", ")}.`,
        acceptedEventTypes: EVENT_TYPES,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    )
  }

  const note = (input.note ?? "").trim().slice(0, 160)
  const name = ((input.name ?? "").trim() || `event:${eventType}`).slice(0, 80)

  // Identify the caller for the Pingers monitor (best-effort, never blocks).
  const ua = req.headers.get("user-agent") ?? "unknown"
  const sourceId = `evt:${shortHash(name + ua)}`
  await recordTickSource(sourceId, "external", name).catch(() => {})
  await recordTickEvent().catch(() => {})

  // ── MULTI-LOCATION: resolve the target station ─────────────────────────────
  // Resolution order:
  //   1. explicit stationId (query OR body) — caller knows best
  //   2. station id embedded in the event's name/note (middleware events are
  //      named `amperio:<station_id>/<unit>`) — prevents cross-station dispatch
  //   3. legacy default station (env-driven), for old single-station callers
  // The resolved station scopes the engine config (identity + physical limits)
  // AND the Redis namespace (plan, logs, lock).
  const explicitStation = input.stationId?.trim() || null
  const inferredStation = explicitStation ? null : await inferStationFromEvent(name, note)
  const requestedStation = explicitStation || inferredStation
  // Surfaced in the response so callers/monitors can audit HOW the station
  // was chosen (explicit > inferred-from-event > legacy default).
  const stationResolution = explicitStation ? "explicit" : inferredStation ? "inferred" : "default"
  let stationCfg: Parameters<typeof engineConfig>[0] | undefined
  if (requestedStation) {
    try {
      const { getStation } = await import("@/lib/stations")
      const station = await getStation(requestedStation)
      if (!station.dispatchEnabled && eventType !== "test") {
        // Telemetry-only stations are tracked but never planned/driven.
        // EXCEPTION: the inert "test" liveness probe IS allowed — its whole
        // purpose is validating the command path BEFORE dispatch is enabled
        // (go-live gate). The edge acks command_type:"test" without actuating.
        return NextResponse.json(
          { ok: false, error: "station_dispatch_disabled", stationId: requestedStation },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        )
      }
      stationCfg = station
    } catch {
      return NextResponse.json(
        { ok: false, error: "unknown_station", stationId: requestedStation },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      )
    }
  }
  const cfg = engineConfig(stationCfg)

  // Everything below (activity report, tick, plan read-back) runs inside the
  // station's scope so all Redis reads/writes hit the right namespace.
  return withStationScope(cfg.stationId, async () => {

  // Log WHY this replan fired into the activity feed (traceability). recordReport
  // preserves the current run's startedAt, so this entry groups with the run.
  const worker: WorkerMeta = {
    stationId: cfg.stationId,
    siteId: cfg.siteId,
    assetId: cfg.assetId,
    tickMs: cfg.intervalMs,
    priceSource: cfg.priceSource,
    baseUrl: cfg.baseUrl,
    startedAt: new Date().toISOString(),
  }
  await recordReport({
    worker,
    phase: "running",
    activity: {
      ts: new Date().toISOString(),
      step: "deciding",
      level: "info",
      message:
        `Event-triggered replan — eventType=${eventType}` +
        (note ? ` · ${note}` : "") +
        ` (source: ${name})`,
    },
  }).catch(() => {})

  // Run ONE immediate tick, bypassing the multi-pinger cooldown. The run-lock
  // still serializes against a concurrent scheduled tick. eventType is threaded
  // into the tick so it is echoed in metadata.event_type — and, when "test",
  // makes the kernel emit an inert liveness-probe command (no actuation). The
  // human-readable trigger (note + source) is threaded too so the MPC replan
  // history can show WHY this replan fired.
  const triggerNote = [note || null, `via ${name}`].filter(Boolean).join(" · ")
  // Pass the caller so this event-driven tick ALSO appears in the Tick logger
  // (tagged wasReplan), making it the full execution stream. The richer replan
  // history is still appended separately inside runOneTick.
  const result = await runTickWindow(
    {
      ...cfg,
      subTicks: 1,
      minSpacingFactor: 0,
      eventType,
      triggerNote,
    },
    { name, kind: "external" },
    // An explicit replan is an operator/event action — briefly wait out a lock
    // held by a concurrent scheduled pinger instead of failing with "locked".
    // Bounded well under this route's 60s maxDuration.
    { lockWaitMs: 8000 },
  )

  const lastPhase = result.lastPhase

  // Return the WHOLE planned horizon as run-length-encoded scheduled commands so
  // the caller can execute the trajectory on its own clock until the next
  // event-driven replan overrides it. The replan tick just persisted the
  // committed plan to Redis (writePlan), so we read it back here — no engine
  // signature change. Only for real dispatches (skip liveness "test" probes and
  // no-op/stopped runs, which command nothing). One command PER SETPOINT CHANGE,
  // not per slot; the first command equals the setpoint just committed.
  let plan: {
    baseSlot: number
    solvedAt: string
    stepHours: number
    horizonSteps: number
    commandCount: number
    /**
     * REAL-TIME RESERVE GUARD override on the FIRST (committed) command. When
     * true, the price-independent safety guard raised the committed grid-import
     * setpoint above the optimiser's own choice this slot (car connected + SOC
     * below the floor, or the no-car forced-recharge latch). The first command's
     * setpoint already reflects the forced value; these fields tell the external
     * system it is a safety override so it can surface/trust it accordingly.
     */
    reserveGuardEngaged: boolean
    reserveGuardReason: "car-guard" | "no-car-recharge" | null
    /** Actual committed grid import (kW) for the current slot = first command. */
    committedGridKw: number
    /** Optimiser's own committed grid import (kW) BEFORE the guard override, or null when the guard did not fire. */
    lpClearanceKw: number | null
    commands: ReturnType<typeof compressPlanToCommands>
  } | null = null
  if (eventType !== "test" && result.ran) {
    try {
      const snapshot = (await readPlan()).current
      if (snapshot && snapshot.steps.length > 0) {
        const commands = compressPlanToCommands(snapshot, {
          siteId: cfg.siteId,
          assetId: cfg.assetId,
        })
        plan = {
          baseSlot: snapshot.baseSlot,
          solvedAt: new Date(snapshot.solvedAt).toISOString(),
          stepHours: snapshot.stepHours,
          horizonSteps: snapshot.horizonSteps,
          commandCount: commands.length,
          reserveGuardEngaged: snapshot.reserveGuardEngaged ?? false,
          reserveGuardReason: snapshot.reserveGuardReason ?? null,
          committedGridKw: snapshot.clearanceKw,
          lpClearanceKw: snapshot.lpClearanceKw ?? null,
          commands,
        }
      }
    } catch {
      // Plan read/compression is best-effort — never fail the replan over it.
    }
  }

  return NextResponse.json(
    {
      ok: true,
      eventType,
      isTest: eventType === "test",
      commandType: eventType === "test" ? "test" : "dispatch",
      note: note || null,
      ran: result.ran,
      reason: result.reason ?? null,
      dispatched: lastPhase === "dispatched",
      lastPhase: lastPhase ?? null,
      intervalMs: cfg.intervalMs,
      commandValidMs: cfg.commandValidMs,
      via: auth.via,
      source: { id: sourceId, kind: "external", name },
      stationId: cfg.stationId,
      stationResolution,
      plan,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
  }) // end withStationScope
}

// POST is the canonical verb (JSON body with eventType). GET is accepted too so
// simpler integrations can trigger via a URL with ?eventType=.
export async function POST(req: NextRequest) {
  return handle(req)
}

export async function GET(req: NextRequest) {
  return handle(req)
}
