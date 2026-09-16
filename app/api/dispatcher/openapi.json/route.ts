import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Hand-authored OpenAPI 3.1 document for the dispatcher Pinger endpoint.
 * Served as JSON and rendered by the Swagger UI page at
 * /dispatcher-status/api-docs.
 *
 * Scope: only the stateless dispatch tick (the "Pinger") is documented here —
 * that is the single endpoint operators integrate with for 24/7 dispatch. The
 * control/status/health endpoints are internal to the dashboard.
 */
const spec = {
  openapi: "3.1.0",
  info: {
    title: "BESS Dispatcher API",
    version: "1.1.0",
    description:
      "Endpoints that drive dispatch. Dispatch is fully stateless — there is no server-side loop or " +
      "timer. Two complementary triggers are documented here, both of which run the SAME engine path " +
      "(fetch latest telemetry + price curve → run the shared kernel → POST setpoint to Amperio):\n\n" +
      "1. /api/dispatcher/tick — the scheduled PINGER. Call it on an interval (the dashboard pings it " +
      "while open; point your own cron/uptime monitor at it for 24/7 dispatch).\n" +
      "2. /api/dispatcher/replan — an optional, push-based EVENT trigger. Have an external system that " +
      "detects events worth re-optimising for (SOC threshold, price update, EV plug, grid constraint, …) " +
      "call it to replan immediately, instead of waiting for the next scheduled tick. It takes an " +
      "`eventType` and does NOT require you to send any telemetry/price data — the tick fetches " +
      "everything itself. It bypasses the inter-pinger cooldown but still respects the Stop button and " +
      "the run-lock.\n\n" +
      "State is persisted in Upstash Redis so it survives cold starts and is consistent across instances.\n\n" +
      "AUTH: protected by a fixed token. Set DISPATCHER_TICK_TOKEN (legacy CRON_SECRET also accepted) " +
      "and send it as `Authorization: Bearer <token>`, or `?secret=<token>` for callers that cannot set " +
      "headers. Same-origin dashboard requests are allowed without it; if no token is configured the " +
      "endpoints are open (local/dev).\n\n" +
      "NAME (tick only, REQUIRED): every pinger call must declare a human-meaningful name via the " +
      "`X-Dispatch-Name` header or `?name=` query param. The Pingers monitor labels each process by " +
      "this name. (The replan endpoint accepts an optional `name` but does not require one.)",
  },
  servers: [{ url: "/", description: "This deployment" }],
  tags: [
    { name: "pinger", description: "Stateless dispatch trigger — call on an interval" },
    {
      name: "replan",
      description:
        "Event-triggered replan — an optional, push-based trigger. Have an external system that " +
        "detects events worth re-optimising for (SOC threshold, price update, EV plug, …) call this " +
        "to ask Amperio to replan immediately, instead of waiting for the next scheduled pinger tick.",
    },
  ],
  paths: {
    "/api/dispatcher/replan": {
      post: {
        tags: ["replan"],
        summary: "Trigger an event-driven replan (act now)",
        description:
          "Runs ONE immediate dispatch tick in response to an externally-detected event. This is an " +
          "ADDITIONAL, optional way to drive dispatch alongside the scheduled pinger — it does not " +
          "change anything about how dispatch works. A 'replan' here IS one dispatch tick: it reuses " +
          "the exact same engine path as /api/dispatcher/tick (fetch latest telemetry + price curve → " +
          "run the shared kernel → POST setpoint to Amperio). You do NOT send any telemetry or price " +
          "data — the tick fetches everything itself.\n\n" +
          "Use it when your own system detects something worth re-optimising for (an SOC threshold " +
          "crossing, a fresh price update, an EV plug/unplug, a grid constraint, …) and you want to " +
          "replan now rather than wait for the next scheduled tick.\n\n" +
          "BEHAVIOUR:\n" +
          "• Bypasses the multi-pinger cooldown — an event is a legitimate reason to re-command " +
          "immediately. The Redis run-lock still applies, so it never double-dispatches concurrently " +
          "with a scheduled tick (you'd get ran:false, reason:'locked').\n" +
          "• Runs exactly one tick (never a multi-tick window).\n" +
          "• No-op when operator intent is 'stopped' (ran:false, reason:'stopped') — it respects the " +
          "Stop button exactly like the pinger.\n\n" +
          "INPUT: a required, validated `eventType` (see enum) plus optional `name` (caller label for " +
          "the Pingers monitor) and `note` (free-text reason). Supply as a JSON body or query params. " +
          "The eventType is written to the activity feed so the dashboard shows why each replan fired.\n\n" +
          "AUTH: identical to the tick endpoint (Bearer token / ?secret=, same-origin allowed, open in dev).",
        security: [{ dispatcherToken: [] }, {}],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ReplanRequest" },
              examples: {
                socThreshold: {
                  summary: "SOC crossed a low threshold",
                  value: { eventType: "soc_threshold", name: "ems-edge-gronau", note: "B1 SOC 12% < 15% floor" },
                },
                priceUpdate: {
                  summary: "Fresh price curve arrived",
                  value: { eventType: "price_update", name: "price-feed-watcher" },
                },
                evPlug: {
                  summary: "EV plugged in",
                  value: { eventType: "ev_plug_event", note: "connector 2 plugged" },
                },
              },
            },
          },
        },
        parameters: [
          {
            name: "eventType",
            in: "query",
            required: false,
            description:
              "The event type (alternative to the JSON body). Required overall — supply it here or in " +
              "the body. Must be one of the accepted values.",
            schema: { $ref: "#/components/schemas/EventType" },
          },
          {
            name: "name",
            in: "query",
            required: false,
            description: "Optional caller label shown in the Pingers monitor (defaults to event:<eventType>).",
            schema: { type: "string", maxLength: 80 },
          },
          {
            name: "note",
            in: "query",
            required: false,
            description: "Optional free-text reason, recorded in the activity feed for traceability.",
            schema: { type: "string", maxLength: 160 },
          },
          {
            name: "secret",
            in: "query",
            required: false,
            description: "Fixed token, for callers that cannot set an Authorization header.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Replan result",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ReplanResult" } },
            },
          },
          "400": {
            description: "Missing or invalid eventType.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ReplanError" } },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
      get: {
        tags: ["replan"],
        summary: "Trigger an event-driven replan (URL form)",
        description:
          "Identical to POST /api/dispatcher/replan, for integrations that can only issue a GET. " +
          "Pass the event via ?eventType=, e.g. /api/dispatcher/replan?eventType=soc_threshold&name=ems-edge.",
        security: [{ dispatcherToken: [] }, {}],
        parameters: [
          {
            name: "eventType",
            in: "query",
            required: true,
            description: "The event type. Must be one of the accepted values.",
            schema: { $ref: "#/components/schemas/EventType" },
          },
          {
            name: "name",
            in: "query",
            required: false,
            description: "Optional caller label shown in the Pingers monitor.",
            schema: { type: "string", maxLength: 80 },
          },
          {
            name: "note",
            in: "query",
            required: false,
            description: "Optional free-text reason, recorded in the activity feed.",
            schema: { type: "string", maxLength: 160 },
          },
          {
            name: "secret",
            in: "query",
            required: false,
            description: "Fixed token, for callers that cannot set an Authorization header.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Replan result",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ReplanResult" } },
            },
          },
          "400": {
            description: "Missing or invalid eventType.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ReplanError" } },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/api/dispatcher/tick": {
      get: {
        tags: ["pinger"],
        summary: "Dispatch tick (call on an interval)",
        description:
          "The single trigger that drives dispatch — there is no server-side loop. Each call " +
          "acquires a Redis run-lock and runs N sub-ticks spaced DISPATCH_INTERVAL_MS apart, then " +
          "releases the lock. No-op when operator intent is 'stopped' (reason:'stopped') or another " +
          "tick holds the lock (reason:'locked').\n\n" +
          "TRIGGER PATTERNS:\n" +
          "• Ping every ~15s → pass ?subTicks=1 (one tick per call).\n" +
          "• Ping every ~60s → omit subTicks (default fills the minute with spaced sub-ticks).\n\n" +
          "AUTH (when DISPATCHER_TICK_TOKEN / CRON_SECRET is set): send " +
          "Authorization: Bearer <token> or ?secret=<token>. Same-origin browser requests are " +
          "allowed without it. GET and POST are equivalent.",
        security: [{ dispatcherToken: [] }, {}],
        parameters: [
          {
            name: "X-Dispatch-Name",
            in: "header",
            required: true,
            description:
              "REQUIRED. Human-meaningful name for this pinger (e.g. cron job name, host, or " +
              "script). Shown in the dashboard's Pingers monitor with its continuous uptime. " +
              "May instead be supplied via the ?name= query param.",
            schema: { type: "string", maxLength: 80 },
          },
          {
            name: "name",
            in: "query",
            required: false,
            description:
              "Alternative to the X-Dispatch-Name header for pingers that cannot set headers. " +
              "A name is mandatory — supply it here or via the header, or the tick is rejected (400).",
            schema: { type: "string", maxLength: 80 },
          },
          {
            name: "subTicks",
            in: "query",
            required: false,
            description: "Sub-ticks to run this call (1..4). Use 1 for ~15s pingers.",
            schema: { type: "integer", minimum: 1, maximum: 4 },
          },
          {
            name: "secret",
            in: "query",
            required: false,
            description: "Fixed token, for pingers that cannot set an Authorization header.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Tick result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TickResult" },
              },
            },
          },
          "400": {
            description: "Missing pinger name (no X-Dispatch-Name header or ?name= query param).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TickError" },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
      post: {
        tags: ["pinger"],
        summary: "Dispatch tick (POST form)",
        description: "Identical to GET /api/dispatcher/tick. Used by the in-dashboard ticker.",
        security: [{ dispatcherToken: [] }, {}],
        parameters: [
          {
            name: "X-Dispatch-Name",
            in: "header",
            required: true,
            description:
              "REQUIRED. Human-meaningful name for this pinger (e.g. cron job name, host, or " +
              "script). Shown in the dashboard's Pingers monitor with its continuous uptime. " +
              "May instead be supplied via the ?name= query param.",
            schema: { type: "string", maxLength: 80 },
          },
          {
            name: "name",
            in: "query",
            required: false,
            description:
              "Alternative to the X-Dispatch-Name header for pingers that cannot set headers. " +
              "A name is mandatory — supply it here or via the header, or the tick is rejected (400).",
            schema: { type: "string", maxLength: 80 },
          },
          {
            name: "subTicks",
            in: "query",
            required: false,
            description: "Sub-ticks to run this call (1..4). Use 1 for ~15s pingers.",
            schema: { type: "integer", minimum: 1, maximum: 4 },
          },
          {
            name: "secret",
            in: "query",
            required: false,
            description: "Fixed token, for pingers that cannot set an Authorization header.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Tick result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TickResult" },
              },
            },
          },
          "400": {
            description: "Missing pinger name (no X-Dispatch-Name header or ?name= query param).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TickError" },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      dispatcherToken: {
        type: "http",
        scheme: "bearer",
        description:
          "Fixed token (DISPATCHER_TICK_TOKEN, or legacy CRON_SECRET) as a Bearer token, for " +
          "external pingers. Same-origin dashboard requests are allowed without it; if no token " +
          "is configured the tick endpoint is open.",
      },
    },
    schemas: {
      EventType: {
        type: "string",
        enum: [
          "soc_threshold",
          "price_update",
          "ev_plug_event",
          "ev_unplug_event",
          "grid_constraint",
          "setpoint_deviation",
          "schedule_change",
          "manual",
          "external",
          "test",
        ],
        description:
          "The class of externally-detected event that warrants an immediate replan. " +
          "soc_threshold = battery SOC crossed a configured band; price_update = a new/revised price " +
          "curve arrived; ev_plug_event / ev_unplug_event = EV load appeared/disappeared; " +
          "grid_constraint = connection limit / curtailment changed; setpoint_deviation = measured " +
          "power drifted from command; schedule_change = upstream schedule/reservation changed; " +
          "manual = operator-requested; external = generic externally-detected event; " +
          "test = end-to-end LIVENESS PROBE. Emits an inert command (command_type:\"test\", every " +
          "setpoint the literal string \"test\") that traverses the full path but actuates nothing — " +
          "the edge device recognises it and ignores the setpoints while still acking.",
      },
      ReplanRequest: {
        type: "object",
        required: ["eventType"],
        properties: {
          eventType: { $ref: "#/components/schemas/EventType" },
          name: {
            type: "string",
            maxLength: 80,
            description: "Optional caller label shown in the Pingers monitor (defaults to event:<eventType>).",
          },
          note: {
            type: "string",
            maxLength: 160,
            description: "Optional free-text reason, recorded in the activity feed for traceability.",
          },
        },
      },
      ReplanResult: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          eventType: { $ref: "#/components/schemas/EventType" },
          note: { type: ["string", "null"] },
          ran: { type: "boolean", description: "Whether the replan tick executed." },
          reason: {
            type: ["string", "null"],
            enum: ["stopped", "locked", null],
            description: "Why nothing ran (when ran=false): operator stopped, or a tick already holds the lock.",
          },
          dispatched: {
            type: "boolean",
            description: "True when the tick actually POSTed a setpoint to Amperio.",
          },
          lastPhase: {
            type: ["string", "null"],
            enum: ["dispatched", "skipped", "error", null],
          },
          intervalMs: { type: "integer" },
          commandValidMs: {
            type: "integer",
            description:
              "How long each dispatched setpoint stays valid on the device (valid_until − timestamp). " +
              "Decoupled from intervalMs so a late/missed tick doesn't drop the charger to its default.",
          },
          via: {
            type: "string",
            enum: ["bearer", "query", "same-origin", "open"],
            description: "How the request was authorized.",
          },
          source: {
            type: "object",
            properties: {
              id: { type: "string" },
              kind: { type: "string", enum: ["external"] },
              name: { type: "string" },
            },
          },
          plan: {
            type: ["object", "null"],
            description:
              "The whole planned horizon as run-length-encoded scheduled commands — one command per " +
              "SETPOINT CHANGE, not per slot. Execute these on your own clock until the next event-driven " +
              "replan overrides them; the first command equals the setpoint just committed for the current " +
              "slot. Null for 'test' probes and no-op runs.",
            properties: {
              baseSlot: { type: "integer", description: "Slot index the plan is anchored at." },
              solvedAt: { type: "string", format: "date-time" },
              stepHours: { type: "number", description: "Control step length (h), e.g. 0.25 for 15 min." },
              horizonSteps: { type: "integer", description: "Number of planned slots before compression." },
              commandCount: { type: "integer", description: "Number of compressed commands returned." },
              reserveGuardEngaged: {
                type: "boolean",
                description:
                  "True when a REAL-TIME SAFETY GUARD overrode the optimiser on the current (first) command — " +
                  "it forced grid import to full capacity because a car is connected while the battery is below " +
                  "the safety floor, or a no-car emergency recharge latch is active. The first command's setpoint " +
                  "already carries the forced value; this flag tells you it is a safety override, not a price-driven " +
                  "optimiser decision, so you should honour it and not second-guess it.",
              },
              reserveGuardReason: {
                type: ["string", "null"],
                enum: ["car-guard", "no-car-recharge", null],
                description:
                  "Which guard rule fired: 'car-guard' (car connected + SOC below floor) or 'no-car-recharge' " +
                  "(emergency recharge with no car). Null when the guard did not engage.",
              },
              committedGridKw: {
                type: "number",
                description: "Actual committed grid-import setpoint (kW) for the current slot = the first command.",
              },
              lpClearanceKw: {
                type: ["number", "null"],
                description:
                  "The optimiser's OWN committed grid import (kW) before any guard override. Equals " +
                  "committedGridKw when the guard did not fire; when it did, the difference is the safety uplift. " +
                  "Null when the guard did not engage.",
              },
              commands: {
                type: "array",
                items: { $ref: "#/components/schemas/ScheduledCommand" },
              },
            },
          },
        },
      },
      ScheduledCommand: {
        type: "object",
        description:
          "A single dispatch command covering a run of consecutive slots that share the same setpoint. " +
          "`payload` is the exact wire command to POST to the station, stamped with executeAt/validUntil.",
        properties: {
          index: { type: "integer", description: "0-based position in the schedule." },
          executeAt: {
            type: "string",
            format: "date-time",
            description: "When to apply this command (slot start of the run).",
          },
          executeAtMs: { type: "integer", description: "Epoch-ms form of executeAt." },
          validUntil: {
            type: "string",
            format: "date-time",
            description: "When this command stops holding — the next setpoint change, or horizon end.",
          },
          slot: { type: "integer", description: "Epoch-anchored 15-min slot index the run starts at." },
          slotSpan: { type: "integer", description: "How many consecutive slots this command covers." },
          gridKw: { type: "number", description: "Planned grid-import ceiling for the run (kW)." },
          setpointW: { type: "integer", description: "Active wire grid setpoint P_grid_request_w (W, signed; negative = import) — the value that changed to start this command. P_grid_clearance_w in the payload is the (larger) positive import envelope." },
          socReservePct: { type: "integer", description: "Planned SOC reserve floor (%)." },
          socCeilingPct: { type: "integer", description: "Planned SOC ceiling (%)." },
          priceEurMwh: { type: "number", description: "DA price at the run start (€/MWh)." },
          payload: {
            type: "object",
            description: "The exact dispatch wire command (same shape as a live POST /commands/dispatch).",
          },
        },
      },
      ReplanError: {
        type: "object",
        properties: {
          ok: { type: "boolean", enum: [false] },
          error: {
            type: "string",
            enum: ["missing_event_type", "invalid_event_type", "unauthorized"],
          },
          message: { type: "string", description: "Human-readable explanation." },
          acceptedEventTypes: {
            type: "array",
            items: { type: "string" },
            description: "The closed set of accepted eventType values (on 400 errors).",
          },
        },
      },
      TickResult: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          ran: { type: "boolean", description: "Whether any sub-tick executed this call." },
          reason: {
            type: ["string", "null"],
            enum: ["stopped", "locked", null],
            description: "Why nothing ran (when ran=false).",
          },
          subTicks: { type: "integer", description: "Number of sub-ticks actually run." },
          intervalMs: { type: "integer" },
          lastPhase: {
            type: ["string", "null"],
            enum: ["dispatched", "skipped", "error", null],
          },
          via: {
            type: "string",
            enum: ["bearer", "query", "same-origin", "open"],
            description: "How the request was authorized.",
          },
          source: {
            type: "object",
            description: "How this caller was identified and labeled in the Pingers monitor.",
            properties: {
              id: { type: "string", description: "Caller id (dash:<uuid> or ext:<hash>)." },
              kind: { type: "string", enum: ["dashboard", "external"] },
              name: { type: "string", description: "The mandatory human-meaningful name." },
            },
          },
        },
      },
      TickError: {
        type: "object",
        properties: {
          ok: { type: "boolean", enum: [false] },
          error: { type: "string", enum: ["missing_name", "unauthorized"] },
          message: { type: "string", description: "Human-readable explanation." },
        },
      },
    },
  },
} as const

export async function GET() {
  return NextResponse.json(spec, { headers: { "Cache-Control": "no-store" } })
}
