import { type NextRequest, NextResponse } from "next/server"
import { runTickWindow, engineConfig } from "@/lib/dispatch-engine"
import { recordTickSource, recordTickEvent } from "@/lib/dispatcher-status"
import type { SourceKind } from "@/lib/dispatcher-status"

// A window may sleep between sub-ticks, so allow up to a minute of execution.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * STATELESS DISPATCH TICK — the single entry point that drives dispatch.
 * ════════════════════════════════════════════════════════════════════════
 *
 * There is NO server-side loop or timer (serverless freezes between requests,
 * so a timer never keeps firing). Instead, *something external* calls this
 * endpoint on an interval. Every call is fully self-contained:
 *
 *   load intent + planner from Redis → fetch telemetry/prices → run the shared
 *   kernel → POST setpoint to Amperio → write heartbeat/planner back to Redis.
 *
 * THE EXPECTED CALLER is your external app, invoking this endpoint on its own
 * cadence (e.g. every second). Each call runs exactly ONE self-contained tick
 * and returns immediately (default subTicks=1); the multi-pinger cooldown
 * inside the engine keeps a fast pinger from re-commanding the device faster
 * than the configured interval, and a Redis run-lock means concurrent calls
 * coexist safely — only one tick executes at a time (the other gets
 * `{ ran:false, reason:"locked" }`). Nothing inside this app schedules ticks:
 * no cron, no server loop, no dashboard ticker.
 *
 * For sparse pingers (~1/min) the old fill-a-minute behavior is still
 * available with `?subTicks=N` (or the DISPATCH_SUBTICKS env var).
 *
 * When the operator intent is "stopped", a tick is a no-op (`reason:"stopped"`).
 *
 * AUTH (only enforced when CRON_SECRET is set):
 *   • External callers must send `Authorization: Bearer <CRON_SECRET>`
 *     (or `?secret=<CRON_SECRET>` for pingers that can't set headers).
 *   • Same-origin browser requests (the dashboard) are allowed without it.
 *   • If CRON_SECRET is unset (local/dev), the endpoint is open.
 */

const MAX_SUBTICKS = 4

// Telemetry-only stations (tracked, not dispatched) are refreshed via the
// shared lib — also called from /api/fleet/status so freshness never depends
// on the tick alone.
import { refreshTelemetryOnlyStations } from "@/lib/telemetry-refresh"

/** Optional `?subTicks=N` override (clamped 1..MAX_SUBTICKS). */
function parseSubTicks(req: NextRequest): number | undefined {
  const raw = req.nextUrl.searchParams.get("subTicks")
  if (!raw) return undefined
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return undefined
  return Math.min(n, MAX_SUBTICKS)
}

/**
 * Same-origin detection for the in-dashboard ticker. Browsers set
 * `Sec-Fetch-Site: same-origin` on same-origin fetches, and the Origin host
 * matches this deployment. This is defense-in-depth (a forced extra tick is
 * harmless — it's lock-guarded, idempotent, and only acts when running), not a
 * hard security boundary; the Bearer secret is the real gate for outside calls.
 */
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

/** Tiny non-crypto hash → short hex, for fingerprinting anonymous pingers. */
function shortHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(16)
}

/**
 * Identify the caller so the guardrail can count distinct pingers. Prefer an
 * explicit `X-Dispatch-Source` header / `?source=` (the dashboard sends
 * `dash:<uuid>`); otherwise derive one: same-origin → an anonymous dashboard,
 * external → a fingerprint of the user-agent so repeat pingers collapse to one.
 */
function extractSource(req: NextRequest, via: string): { id: string; kind: SourceKind } {
  const raw = (
    req.headers.get("x-dispatch-source") ??
    req.nextUrl.searchParams.get("source") ??
    ""
  ).trim()
  if (raw) {
    const id = raw.slice(0, 80)
    return { id, kind: id.startsWith("dash:") ? "dashboard" : "external" }
  }
  if (via === "same-origin") return { id: "dash:anon", kind: "dashboard" }
  const ua = req.headers.get("user-agent") ?? "unknown"
  return { id: `ext:${shortHash(ua)}`, kind: "external" }
}

/**
 * The caller's human-meaningful NAME — mandatory on the tick endpoint. Read from
 * the `X-Dispatch-Name` header or `?name=` query param so the Pingers monitor
 * can label processes by something operators recognise (browser + OS, a cron
 * job name, a host, …) instead of an opaque GUID. Returns "" when absent.
 */
function extractName(req: NextRequest): string {
  return (req.headers.get("x-dispatch-name") ?? req.nextUrl.searchParams.get("name") ?? "")
    .trim()
    .slice(0, 80)
}

function authorize(req: NextRequest): { ok: boolean; via: string } {
  // Fixed token for the tick (Pinger) endpoint. DISPATCHER_TICK_TOKEN is the
  // dedicated name; CRON_SECRET is accepted as a fallback for compatibility.
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

async function handle(req: NextRequest) {
  const auth = authorize(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  // A meaningful pinger NAME is mandatory: the Pingers monitor must be able to
  // label processes by something operators recognise, not just a GUID. Reject
  // ticks that don't declare one (header X-Dispatch-Name or ?name=).
  const name = extractName(req)
  if (!name) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_name",
        message:
          "A pinger name is required. Send it as the 'X-Dispatch-Name' header or '?name=' query " +
          "param (e.g. ?name=cron-job.org%20gronau or a host/script name). It labels this process " +
          "in the dashboard's Pingers monitor.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    )
  }

  // Register the caller for the multi-pinger guardrail (best-effort; never
  // blocks the tick). This counts every authorized call so the monitor can
  // surface when more than one pinger is driving the loop.
  const source = extractSource(req, auth.via)
  await recordTickSource(source.id, source.kind, name).catch(() => {})
  // Append to the durable 24h ticking history (powers the Ticking Report card).
  await recordTickEvent().catch(() => {})

  // ── MULTI-LOCATION: one tick call drives EVERY enabled station ────────────
  // Stations are loaded from the registry; each runs inside its own
  // withStationScope so its Redis state (plan, heartbeat, lock, logs) is fully
  // isolated, and each has its own engine config (identity + physical limits).
  // Failures are isolated per station: one location erroring must never stop
  // the others from being dispatched. `?stationId=` limits the call to one
  // station (used by per-station dashboards and targeted diagnostics).
  // Registry unavailability falls back to the legacy env-driven single-station
  // config so a DB outage cannot halt dispatch for the default station.
  const subTicks = parseSubTicks(req)
  const requested = req.nextUrl.searchParams.get("stationId")?.trim() || null

  let stationList: Array<Parameters<typeof engineConfig>[0] | undefined>
  try {
    const { listStations } = await import("@/lib/stations")
    // The dispatch loop only drives DISPATCH-enabled stations; telemetry-only
    // stations are tracked (ingestion, fleet dashboard) but never driven.
    const enabled = await listStations({ dispatchOnly: true })
    const filtered = requested ? enabled.filter((s) => s.stationId === requested) : enabled
    if (requested && filtered.length === 0) {
      return NextResponse.json(
        { ok: false, error: "unknown_station", stationId: requested },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      )
    }
    stationList = filtered.length > 0 ? filtered : [undefined]
  } catch (err) {
    console.error("[v0] tick: station registry unavailable — legacy single-station fallback", err)
    stationList = [undefined]
  }

  const { withStationScope } = await import("@/lib/dispatcher-store")
  const results = await Promise.all(
    stationList.map(async (station) => {
      const cfg = engineConfig(station)
      const effective = subTicks != null ? { ...cfg, subTicks } : cfg
      try {
        // Pass the caller so the Tick logger records who pinged + what the
        // call did (including no-op locked/stopped/cooldown calls).
        const result = await withStationScope(cfg.stationId, () =>
          runTickWindow(effective, { name, kind: source.kind }),
        )
        return {
          stationId: cfg.stationId,
          ran: result.ran,
          reason: result.reason ?? null,
          subTicks: result.subTicks,
          intervalMs: effective.intervalMs,
          lastPhase: result.lastPhase,
        }
      } catch (err) {
        console.error(`[v0] tick failed for station ${cfg.stationId}:`, err)
        return {
          stationId: cfg.stationId,
          ran: false,
          reason: "error" as const,
          subTicks: 0,
          intervalMs: effective.intervalMs,
          lastPhase: null,
        }
      }
    }),
  )

  // ── TELEMETRY-ONLY PASS ────────────────────────────────────────────────────
  // Stations that are TRACKED (enabled) but not DISPATCHED never run through
  // the engine above, so nothing would ever feed their fleet-status telemetry.
  // Refresh their latest middleware frame into the scoped status store here,
  // throttled per station, best-effort (never blocks or fails the tick).
  await refreshTelemetryOnlyStations(requested).catch((err) =>
    console.error("[v0] telemetry-only refresh failed:", err),
  )

  // Backward-compatible top-level shape = the default/first station's result,
  // with the full per-station breakdown alongside.
  const first = results[0]
  return NextResponse.json(
    {
      ok: true,
      ran: first?.ran ?? false,
      reason: first?.reason ?? null,
      subTicks: first?.subTicks ?? 0,
      intervalMs: first?.intervalMs,
      lastPhase: first?.lastPhase ?? null,
      via: auth.via,
      source: { id: source.id, kind: source.kind, name },
      stations: results,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

// Accept both verbs so any pinger works (GET for simple URL monitors, POST for
// the dashboard ticker / scripted callers).
export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
