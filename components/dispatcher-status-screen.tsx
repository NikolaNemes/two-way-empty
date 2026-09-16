"use client"

import { useState, useMemo, Fragment, type ReactNode } from "react"
import useSWR from "swr"
import {
  Activity,
  Zap,
  RefreshCw,
  CircleCheck,
  CircleAlert,
  CircleSlash,
  Gauge,
  Clock,
  TriangleAlert,
  Loader2,
  Copy,
  Check,
  Coins,
  Cpu,
  Send,
  ListChecks,
  Pause,
  Radio,
  Trash2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  BookOpen,
  Download,
  ListFilter,
  ArrowUp,
  ArrowDown,
  Microscope,
  BatteryCharging,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { TelemetryLoader } from "@/components/prototype/telemetry-loader"
import type {
  DispatcherStatusResponse,
  ActivityStep,
  WorkerActivity,
} from "@/lib/dispatcher-status"
import {
  getCommands,
  getFrames,
  type ApiCommand,
  type CommandStatus,
  type ApiTelemetryFrame,
} from "@/lib/amperio-api"
import { DispatcherHealthStrip } from "@/components/dispatcher-health-strip"
import { useStation } from "@/components/station-context"
import { DispatchPlan } from "@/components/dispatch-plan"
import { DispatcherTickLog } from "@/components/dispatcher-tick-log"
import {
  getDispatchSourceId,
  getDispatchSourceName,
  DISPATCH_SOURCE_HEADER,
  DISPATCH_NAME_HEADER,
} from "@/lib/dispatch-source"

const fetcher = async (url: string): Promise<DispatcherStatusResponse> => {
  const res = await fetch(url, {
    // Identify this source (tab/pinger) on every request so replans and
    // commands can be attributed to who triggered them in the activity log.
    headers:
      typeof window === "undefined"
        ? {}
        : {
            [DISPATCH_SOURCE_HEADER]: getDispatchSourceId(),
            [DISPATCH_NAME_HEADER]: getDispatchSourceName(),
          },
  })
  // Read the body as text first so an empty or non-JSON error response (e.g. a
  // 500 with no body) produces a clear message instead of the opaque
  // "Unexpected end of JSON input" SyntaxError from calling .json() directly.
  const text = await res.text()
  if (!res.ok) {
    let detail = text.trim()
    try {
      const parsed = JSON.parse(detail) as { error?: string; message?: string }
      detail = parsed.error || parsed.message || detail
    } catch {
      // Non-JSON error body — use the raw text (often empty).
    }
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`)
  }
  if (!text.trim()) {
    throw new Error("Empty response from the status endpoint.")
  }
  return JSON.parse(text) as DispatcherStatusResponse
}

// Amperio is the master record for commands. If no worker has reported its
// site yet, fall back to the prototype site so the grid still populates.
const DEFAULT_SITE_ID = "site_gronau_01"

const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

// ── CSV export (last 24h of commands) ───────────────────────────────────────

function commandsToCsv(cmds: ApiCommand[]): string {
  const header = [
    "command_id",
    "timestamp",
    "valid_until",
    "p_grid_request_w",
    "price_zone",
    "gate_reason",
    "status",
    "deviation_pct",
  ]
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = cmds.map((c) =>
    [
      c.commandId,
      c.timestamp ?? "",
      c.validUntil ?? "",
      c.pGridRequestW ?? "",
      c.priceZone ?? "",
      c.gateReason ?? "",
      c.status ?? "",
      c.deviationPct ?? "",
    ].map(esc).join(","),
  )
  return [header.join(","), ...rows].join("\n")
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── command reason + setpoint-change analysis ───────────────────────────────

// Plain-language explanation of Amperio's gate_reason enum. Verbose prototype
// reasons are already human-readable, so we fall back to the raw string.
const GATE_REASON_EXPLANATIONS: Record<string, string> = {
  cheap_slot:
    "Cheap price slot — importing from the grid to charge the battery while energy is inexpensive.",
  peak_pricing:
    "Peak pricing — discharging the battery to serve load and avoid expensive grid import.",
  emergency_override:
    "Emergency override — a safety or limit condition forced this setpoint regardless of price.",
  demand_limit:
    "Demand limit — holding within the site's grid/EMS limits; no price-driven action this tick.",
}

function explainGateReason(reason: string | null): string {
  if (!reason) return "No gate reason was provided by Amperio for this command."
  const key = reason.toLowerCase()
  return GATE_REASON_EXPLANATIONS[key] ?? reason
}

/** Per-command setpoint-change annotation, keyed by commandId. */
interface SetpointChange {
  /** The requested watts of the previous (chronologically older) command. */
  prevW: number | null
  /** current − previous, in watts. */
  deltaW: number | null
  /** True when this command actually moved the grid setpoint. */
  changed: boolean
}

// Minimum delta to count as a real setpoint change. The table shows kW to one
// decimal (0.1 kW = 100 W), so smaller deltas are sub-display jitter, not a
// meaningful command change.
const SETPOINT_CHANGE_THRESHOLD_W = 100

/**
 * Annotate each command with whether it actually changed the grid setpoint
 * relative to the previous command that carried one. `sorted` must be
 * newest-first (as returned by getCommands), so the prior command in time is
 * the next entry with a non-null setpoint.
 */
function annotateSetpointChanges(sorted: ApiCommand[]): Map<string, SetpointChange> {
  const map = new Map<string, SetpointChange>()
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i].pGridRequestW
    let prev: number | null = null
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].pGridRequestW != null) {
        prev = sorted[j].pGridRequestW
        break
      }
    }
    const deltaW = cur != null && prev != null ? cur - prev : null
    const changed = deltaW != null && Math.abs(deltaW) >= SETPOINT_CHANGE_THRESHOLD_W
    map.set(sorted[i].commandId, { prevW: prev, deltaW, changed })
  }
  return map
}

// ── small formatting helpers ──────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function fmtAgo(ms: number | null): string {
  if (ms == null) return "—"
  if (ms < 1000) return "just now"
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

function num(n: number, digits = 1): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function CommandStatusBadge({ status }: { status: CommandStatus | null }) {
  if (status == null) {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <CircleSlash className="size-3" />
        unknown
      </Badge>
    )
  }
  switch (status) {
    case "executed":
      return (
        <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1">
          <CircleCheck className="size-3" />
          executed
        </Badge>
      )
    case "executing":
      return (
        <Badge className="bg-sky-600 hover:bg-sky-600 text-white gap-1">
          <Activity className="size-3" />
          executing
        </Badge>
      )
    case "accepted":
      return (
        <Badge variant="outline" className="border-sky-500/50 text-sky-600 gap-1">
          <CircleCheck className="size-3" />
          accepted
        </Badge>
      )
    case "deviated":
      return (
        <Badge variant="outline" className="border-amber-500/50 text-amber-600 gap-1">
          <TriangleAlert className="size-3" />
          deviated
        </Badge>
      )
    case "timed_out":
      return (
        <Badge variant="outline" className="border-amber-500/50 text-amber-600 gap-1">
          <Clock className="size-3" />
          timed out
        </Badge>
      )
    case "superseded":
      return (
        <Badge variant="outline" className="text-muted-foreground gap-1">
          <CircleSlash className="size-3" />
          superseded
        </Badge>
      )
    case "rejected":
      return (
        <Badge variant="destructive" className="gap-1">
          <CircleAlert className="size-3" />
          rejected
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function priceZoneClasses(zone: string): string {
  switch (zone) {
    case "cheap":
      return "border-emerald-500/40 text-emerald-600"
    case "moderate":
      return "border-sky-500/40 text-sky-600"
    case "expensive":
      return "border-amber-500/40 text-amber-600"
    case "peak":
      return "border-red-500/40 text-red-600"
    default:
      return "text-muted-foreground"
  }
}

/**
 * Translate a dispatch command into a plain-English explanation of WHY the
 * algorithm issued it — grounded in the engine's own signals, never invented:
 *   • gate_reason CODE from the dispatch engine: base zone (cheap_slot |
 *     moderate | expensive_slot | peak_pricing) plus the SOC overrides
 *     (near_full | reserve_protect), the firm committed-action rules, and
 *     an optional `_ev_active` suffix appended when a car is plugged in.
 *   • the price zone badge and the setpoint delta (raised / lowered / held).
 * If the reason is already a human sentence (the prototype stream emits those),
 * it is surfaced as-is. Returns null only when there is genuinely no signal.
 */
function describeCommandReason(cmd: ApiCommand, change: SetpointChange): string | null {
  const raw = cmd.gateReason?.trim() ?? null

  // Already a human sentence (contains a space and isn't a bare snake_case code).
  if (raw && /\s/.test(raw) && !/^[a-z]+(_[a-z]+)*$/.test(raw)) return raw

  // Split the code into its base reason and the EV-plugged flag.
  let base = raw ?? ""
  const evActive = base.endsWith("_ev_active")
  if (evActive) base = base.slice(0, -"_ev_active".length)

  const REASONS: Record<string, string> = {
    cheap_slot: "Cheap price slot — importing from grid to bank cheap energy in the battery",
    moderate: "Moderate prices — holding state of charge, no arbitrage",
    expensive_slot: "Expensive prices — no grid import, serving load from the battery",
    peak_pricing: "Peak prices — maximising battery discharge and throttling the EV ceiling",
    near_full: "Battery near full (>92%) — grid import cut back to a trickle",
    reserve_protect: "Battery reserve thin (<22%) — forcing grid import to refill",
    // Firm committed-action rules.
    firm_cheap_car_import:
      "Cheap slot + car connected — grid serves the car in full, sparing the battery",
    firm_no_arb_car_grid:
      "Car connected, no price spread beats the ~7 ct/kWh battery cycling cost — grid serves the car, sparing the battery",
    wait_high_soc:
      "High state of charge + a cheaper slot is still ahead — holding off on grid charging to wait for it",
    low_soc_refill:
      "Low state of charge + cheap now — importing to proactively refill the battery",
    buy_now_marginal:
      "Cheap now and the next cheaper slot saves too little to wait — importing now",
    buy_now_cheapest: "Cheapest reachable slot — importing now to bank cheap energy",
  }

  // Fall back to the price-zone badge when the code is missing/unrecognised.
  let core: string | null = REASONS[base] ?? null
  if (!core) {
    switch (cmd.priceZone?.toLowerCase()) {
      case "cheap":
        core = "Cheap price slot — importing to charge the battery from grid"
        break
      case "moderate":
        core = "Moderate prices — holding state of charge"
        break
      case "expensive":
        core = "Expensive prices — minimising grid import"
        break
      case "peak":
        core = "Peak prices — discharging the battery to serve load"
        break
      default:
        core = raw ?? null
    }
  }

  if (!core) return null

  // A car just made the dispatcher raise the import floor — the most common
  // "why did this change" the user asked about.
  if (evActive) core += " · car connected, grid-import floor raised"
  return core
}

// ── status banner ─────────────────────────────────────────────────────────

function StatusBanner({ data }: { data: DispatcherStatusResponse }) {
  const online = data.online
  const phase = data.phase

  // Dispatch is event/replan-driven and always armed — no operator Start/Stop.
  // The banner reflects plan freshness: has a replan landed recently?
  const label = !data.hasWorker
    ? "Awaiting first plan"
    : online
      ? phase === "starting"
        ? "Starting"
        : "Dispatching"
      : "Idle"

  const sublabel = !data.hasWorker
    ? "Event-driven · always armed. The plan re-solves on triggers (car connect/disconnect, price divergence, SoC thresholds, safety interval)."
    : online
      ? phase === "starting"
        ? "Dispatch engine is starting up…"
        : `Event-driven · always armed · last replan ${fmtAgo(data.msSinceLastReport)}`
      : `No recent replan — last solve ${fmtAgo(data.msSinceLastReport)}. Trigger a replan or wire an external event source.`

  // Tone: green when a replan landed recently, red when armed but stale.
  const tone = !data.hasWorker ? "neutral" : online ? "good" : "bad"
  const dotColor = !data.hasWorker
    ? "bg-muted-foreground/50"
    : online
      ? "bg-emerald-500"
      : "bg-red-500"

  return (
    <Card
      className={cn(
        "border-l-4",
        tone === "good" && "border-l-emerald-500 bg-emerald-500/5",
        tone === "bad" && "border-l-red-500 bg-red-500/5",
        tone === "neutral" && "border-l-muted-foreground/40",
      )}
    >
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div className="flex items-center gap-3">
          <span className="relative flex size-3.5">
            {online && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span className={cn("relative inline-flex size-3.5 rounded-full", dotColor)} />
          </span>
          <div>
            <div className="text-xl font-semibold tracking-tight">{label}</div>
            <div className="text-sm text-muted-foreground">{sublabel}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1 text-xs">
            <Radio className="size-3" />
            Replan-driven
          </Badge>
          {data.worker && (
            <>
              <Badge
                variant="default"
                className="bg-orange-600 hover:bg-orange-600 text-white"
              >
                LIVE — sending commands
              </Badge>
              <Badge variant="outline" className="gap-1 font-mono text-xs">
                <Clock className="size-3" />
                {Math.round(data.worker.tickMs / 1000)}s safety interval
              </Badge>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── command row ───────────────────────────────────���────────────────────────

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(id)
    } catch {
      // Fallback for non-secure contexts where the Clipboard API is blocked.
      const el = document.createElement("textarea")
      el.value = id
      el.style.position = "fixed"
      el.style.opacity = "0"
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Click to copy command ID"
      className="group inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left font-mono text-xs hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="break-all">{id}</span>
      {copied ? (
        <Check className="size-3.5 shrink-0 text-emerald-600" aria-label="Copied" />
      ) : (
        <Copy
          className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      )}
      <span className="sr-only">{copied ? "Copied command ID" : "Copy command ID"}</span>
    </button>
  )
}

function fmtKw(w: number | null): string {
  return w == null ? "—" : `${num(w / 1000)} kW`
}

function CommandRow({
  cmd,
  change,
  expanded,
  onToggle,
  stationId,
}: {
  cmd: ApiCommand
  change: SetpointChange
  expanded: boolean
  onToggle: () => void
  /** Station to fetch debug telemetry frames for (falls back to the cmd asset). */
  stationId: string
}) {
  const kw = cmd.pGridRequestW != null ? cmd.pGridRequestW / 1000 : null
  const changed = change.changed
  const deltaKw = change.deltaW != null ? change.deltaW / 1000 : null
  const payload = JSON.stringify(cmd.raw, null, 2)
  // Plain-English "why" for this command, synthesized from the engine's own
  // gate_reason + price zone + setpoint move.
  const reason = describeCommandReason(cmd, change)

  return (
    <>
      <TableRow
        className={cn("cursor-pointer", changed && "bg-primary/5 border-l-2 border-l-primary")}
        onClick={onToggle}
      >
        <TableCell className="w-8 align-top">
          <ChevronRight
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
            aria-hidden="true"
          />
          <span className="sr-only">{expanded ? "Collapse" : "Expand"} command details</span>
        </TableCell>
        <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
          <CopyableId id={cmd.commandId} />
        </TableCell>
        <TableCell className="font-mono text-xs whitespace-nowrap align-top">
          {cmd.timestamp ? fmtTime(cmd.timestamp) : "—"}
        </TableCell>
        <TableCell className="text-right tabular-nums align-top">
          {kw != null ? (
            <>
              <span className={cn("font-medium", changed && "text-primary")}>{num(kw)} kW</span>
              {changed && deltaKw != null ? (
                <span
                  className={cn(
                    "mt-0.5 flex items-center justify-end gap-0.5 text-[10px] font-medium",
                    deltaKw > 0 ? "text-amber-600" : "text-emerald-600",
                  )}
                >
                  {deltaKw > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
                  {num(Math.abs(deltaKw))} kW from {num((change.prevW ?? 0) / 1000)}
                </span>
              ) : (
                <span className="block text-[10px] text-muted-foreground">no change</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="max-w-[260px] align-top">
          {reason ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs leading-snug text-pretty text-foreground">{reason}</span>
              {cmd.gateReason ? (
                <span className="font-mono text-[10px] text-muted-foreground">{cmd.gateReason}</span>
              ) : null}
            </div>
          ) : cmd.gateReason ? (
            <span className="font-mono text-xs">{cmd.gateReason}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="align-top">
          {cmd.priceZone ? (
            <Badge variant="outline" className={cn("text-[10px]", priceZoneClasses(cmd.priceZone))}>
              {cmd.priceZone}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground align-top">
          {cmd.validUntil ? fmtTime(cmd.validUntil) : "—"}
        </TableCell>
        <TableCell className="text-right align-top">
          <CommandStatusBadge status={cmd.status} />
          {cmd.deviationPct != null && (
            <span className="block text-[10px] text-muted-foreground mt-0.5">
              dev {num(cmd.deviationPct)}%
            </span>
          )}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className={cn(changed && "border-l-2 border-l-primary")}>
          <TableCell colSpan={8} className="bg-muted/30">
            <div className="space-y-3 py-1">
              {/* Setpoint summary — what this command changed */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">Grid setpoint:</span>
                {changed && change.prevW != null ? (
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    {fmtKw(change.prevW)}
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                    <span className="font-semibold text-primary">{fmtKw(cmd.pGridRequestW)}</span>
                    <span
                      className={cn(
                        "ml-1 rounded px-1.5 py-0.5 text-xs",
                        (change.deltaW ?? 0) > 0
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                      )}
                    >
                      {(change.deltaW ?? 0) > 0 ? "+" : ""}
                      {fmtKw(change.deltaW)}
                    </span>
                  </span>
                ) : (
                  <span className="font-mono text-muted-foreground">
                    {fmtKw(cmd.pGridRequestW)} · re-asserted, no change from the previous command
                  </span>
                )}
              </div>

              {/* Plain-language reason */}
              <div className="text-sm">
                <span className="font-medium">Reason: </span>
                <span className="text-muted-foreground">{explainGateReason(cmd.gateReason)}</span>
              </div>

              {/* Raw dispatch payload */}
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Dispatch command payload
                </div>
                <pre className="max-h-72 overflow-auto rounded-md border bg-background p-3 font-mono text-[11px] leading-relaxed">
                  {payload}
                </pre>
              </div>

              {/* On-demand neighboring telemetry frames for debugging */}
              <CommandTelemetryFrames
                stationId={stationId || cmd.assetId || ""}
                commandTs={cmd.timestamp}
                requestW={cmd.pGridRequestW}
              />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ── on-demand command telemetry frames ──────────────────────────────────────

/** Aggregate battery power (W) and mean SOC (%) across a frame's batteries. */
function batteryAggregate(frame: ApiTelemetryFrame): { powerW: number; socPct: number | null } {
  const bats = frame.batteries ?? []
  if (bats.length === 0) return { powerW: 0, socPct: null }
  const powerW = bats.reduce((sum, b) => sum + (b.power_w ?? 0), 0)
  const socPct = bats.reduce((sum, b) => sum + (b.soc_pct ?? 0), 0) / bats.length
  return { powerW, socPct }
}

/** Scalar telemetry signals comparable frame-to-frame (for the "what changed" view). */
interface FrameMetrics {
  gridW: number
  batteryW: number
  socPct: number | null
  dam: number | null
  idm: number | null
  consumptionLimitW: number | null
  generationLimitW: number | null
  warnings: string[]
  errors: string[]
}

function frameMetrics(f: ApiTelemetryFrame): FrameMetrics {
  const bat = batteryAggregate(f)
  return {
    gridW: f.grid?.p_grid_w ?? 0,
    batteryW: bat.powerW,
    socPct: bat.socPct,
    dam: f.prices?.dam ?? null,
    idm: f.prices?.idm ?? null,
    consumptionLimitW: f.station?.p_grid_consumption_limit_w ?? null,
    generationLimitW: f.station?.p_grid_generation_limit_w ?? null,
    warnings: f.station?.warnings ?? [],
    errors: f.station?.errors ?? [],
  }
}

/** A single before���after metric delta surfaced in the trigger panel. */
interface MetricDelta {
  key: string
  label: string
  icon: typeof Zap
  before: number | null
  after: number | null
  delta: number | null
  fmt: (n: number | null) => string
  /** Bigger = more significant mover (used to pick the headline trigger). */
  magnitude: number
}

/**
 * Lazily fetches the telemetry frames AROUND a command's timestamp so an
 * operator can debug exactly what the dispatch loop saw and what the command
 * did:
 *   • a short pre-window (the frame[s] the decision was based on — the cause),
 *   • the command instant (highlighted),
 *   • a longer post-window (grid power converging toward the new setpoint — the
 *     effect).
 *
 * Frames are fetched ON DEMAND (button click), not eagerly, so opening a row is
 * cheap and Amperio isn't hit unless the operator actually wants the trace.
 */
function CommandTelemetryFrames({
  stationId,
  commandTs,
  requestW,
}: {
  stationId: string
  commandTs: string | null
  requestW: number | null
}) {
  const [frames, setFrames] = useState<ApiTelemetryFrame[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Which frame row is expanded to reveal its FULL telemetry detail.
  const [openKey, setOpenKey] = useState<string | null>(null)

  // Center a window on the command so we capture the SEQUENCE leading to the
  // trigger (several frames before the cause) AND the convergence after it (the
  // effect). Wider pre-window than before so the "what changed" view has enough
  // history to compare against.
  const PRE_MS = 60_000 // ~12 frames before → the lead-up that tripped the trigger
  const POST_MS = 120_000 // ~24 frames after → the effect of the command
  const STEP_S = 5

  async function load() {
    if (!commandTs || !stationId) {
      setErr("No command timestamp or station id available for this command.")
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const t = Date.parse(commandTs)
      const from = new Date(t - PRE_MS).toISOString()
      const to = new Date(t + POST_MS).toISOString()
      const res = await getFrames(stationId, from, to, STEP_S)
      setFrames(res.frames ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load telemetry frames.")
    } finally {
      setLoading(false)
    }
  }

  const cmdMs = commandTs ? Date.parse(commandTs) : null
  // Index of the frame nearest to (but not after) the command — the "cause".
  const causeIdx = useMemo(() => {
    if (!frames || cmdMs == null) return -1
    let idx = -1
    for (let i = 0; i < frames.length; i++) {
      if (Date.parse(frames[i].ts) <= cmdMs) idx = i
      else break
    }
    return idx
  }, [frames, cmdMs])

  // The telemetry delta that tripped the decision: the cause frame compared
  // against the frame immediately before it. Surfaces the signal that changed.
  const trigger = useMemo(() => {
    if (!frames || causeIdx < 0) return null
    const cause = frames[causeIdx]
    const prev = causeIdx > 0 ? frames[causeIdx - 1] : null
    const c = frameMetrics(cause)
    const p = prev ? frameMetrics(prev) : null
    const fmtPrice = (n: number | null) => (n == null ? "—" : num(n, 1))
    const mk = (
      key: string,
      label: string,
      icon: typeof Zap,
      after: number | null,
      before: number | null,
      fmt: (n: number | null) => string,
    ): MetricDelta => {
      const delta = before != null && after != null ? after - before : null
      // Normalize W vs % vs price so the "biggest mover" is picked sensibly.
      const scale = key === "grid" || key === "battery" ? 1 / 1000 : 1
      return {
        key,
        label,
        icon,
        before,
        after,
        delta,
        fmt,
        magnitude: delta != null ? Math.abs(delta) * scale : 0,
      }
    }
    const deltas: MetricDelta[] = [
      mk("grid", "Grid power", Zap, c.gridW, p?.gridW ?? null, fmtKw),
      mk("battery", "Battery power", BatteryCharging, c.batteryW, p?.batteryW ?? null, fmtKw),
      mk("soc", "Mean SOC", Gauge, c.socPct, p?.socPct ?? null, (n) => (n == null ? "—" : `${num(n)}%`)),
      mk("dam", "DAM price", Coins, c.dam, p?.dam ?? null, fmtPrice),
      mk("idm", "IDM price", Coins, c.idm, p?.idm ?? null, fmtPrice),
    ]
    const changed = deltas.filter((d) => d.delta != null && Math.abs(d.delta) > 1e-6)
    const headline = changed.length
      ? changed.reduce((a, b) => (b.magnitude > a.magnitude ? b : a))
      : null
    const limitChanged =
      !!p && (c.consumptionLimitW !== p.consumptionLimitW || c.generationLimitW !== p.generationLimitW)
    const newWarnings = p ? c.warnings.filter((w) => !p.warnings.includes(w)) : c.warnings
    const newErrors = p ? c.errors.filter((e) => !p.errors.includes(e)) : c.errors
    return { cause, prev, deltas, headline, limitChanged, newWarnings, newErrors }
  }, [frames, causeIdx])

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Telemetry around this command
        </span>
        {frames == null && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={(e) => {
              e.stopPropagation()
              void load()
            }}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Microscope className="size-3.5" />
            )}
            {loading ? "Loading frames…" : "Load telemetry frames"}
          </Button>
        )}
      </div>

      {err && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {err}
        </p>
      )}

      {frames != null && frames.length === 0 && !err && (
        <p className="text-xs text-muted-foreground">
          No telemetry frames found in this window.
        </p>
      )}

      {frames != null && frames.length > 0 && (
        <>
          {/* Special view: what changed in the sequence to trigger the dispatch. */}
          {trigger && <TriggerPanel trigger={trigger} requestW={requestW} />}

          <p className="mb-1.5 text-[11px] text-muted-foreground">
            Highlighted row = frame the decision was based on (the cause). Rows above it are the
            lead-up; rows below show grid power moving toward the {fmtKw(requestW)} setpoint (the
            effect). Click any row for its full telemetry.
          </p>
          <div className="max-h-80 overflow-auto rounded-md border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 w-6" />
                  <TableHead className="h-8 text-xs">Time</TableHead>
                  <TableHead className="h-8 text-right text-xs">Grid power</TableHead>
                  <TableHead className="h-8 text-right text-xs">Battery</TableHead>
                  <TableHead className="h-8 text-right text-xs">SOC</TableHead>
                  <TableHead className="h-8 text-xs">Phase</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {frames.map((f, i) => {
                  const bat = batteryAggregate(f)
                  const isCause = i === causeIdx
                  const after = cmdMs != null && Date.parse(f.ts) > cmdMs
                  const key = `${f.ts}-${f.sequence_number}`
                  const open = openKey === key
                  return (
                    <Fragment key={key}>
                      <TableRow
                        className={cn(
                          "cursor-pointer",
                          isCause && "bg-primary/10 border-l-2 border-l-primary",
                          after && "text-foreground",
                          !after && !isCause && "text-muted-foreground",
                        )}
                        onClick={() => setOpenKey(open ? null : key)}
                      >
                        <TableCell className="py-1 pr-0">
                          <ChevronRight
                            className={cn(
                              "size-3.5 text-muted-foreground transition-transform",
                              open && "rotate-90",
                            )}
                          />
                        </TableCell>
                        <TableCell className="py-1 font-mono text-[11px] whitespace-nowrap">
                          {fmtTime(f.ts)}
                          {isCause && (
                            <span className="ml-1.5 rounded bg-primary/15 px-1 text-[9px] font-medium text-primary">
                              cause
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-1 text-right tabular-nums text-[11px]">
                          {fmtKw(f.grid?.p_grid_w ?? null)}
                        </TableCell>
                        <TableCell className="py-1 text-right tabular-nums text-[11px]">
                          <span className="inline-flex items-center justify-end gap-1">
                            <BatteryCharging className="size-3 text-muted-foreground" />
                            {fmtKw(bat.powerW)}
                          </span>
                        </TableCell>
                        <TableCell className="py-1 text-right tabular-nums text-[11px]">
                          {bat.socPct != null ? `${num(bat.socPct)}%` : "—"}
                        </TableCell>
                        <TableCell className="py-1 text-[10px]">
                          {isCause ? (
                            <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
                              decision input
                            </Badge>
                          ) : after ? (
                            <span className="text-emerald-600">effect</span>
                          ) : (
                            <span className="text-muted-foreground">pre</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {open && <FrameDetail frame={f} />}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}

/** Emphasizes the telemetry change between the pre-cause frame and the cause. */
function TriggerPanel({
  trigger,
  requestW,
}: {
  trigger: {
    cause: ApiTelemetryFrame
    prev: ApiTelemetryFrame | null
    deltas: MetricDelta[]
    headline: MetricDelta | null
    limitChanged: boolean
    newWarnings: string[]
    newErrors: string[]
  }
  requestW: number | null
}) {
  const { deltas, headline, prev, limitChanged, newWarnings, newErrors } = trigger
  return (
    <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <TriangleAlert className="size-4 text-primary" />
        <span className="text-xs font-semibold">What changed to trigger this dispatch</span>
      </div>

      {!prev ? (
        <p className="text-[11px] text-muted-foreground">
          No earlier frame in the window to compare against — the cause is the first frame loaded.
        </p>
      ) : headline ? (
        <p className="mb-2 text-xs leading-relaxed">
          <span className="font-medium">{headline.label}</span> moved{" "}
          <span className="font-mono">
            {headline.fmt(headline.before)} → {headline.fmt(headline.after)}
          </span>{" "}
          <DeltaBadge delta={headline.delta} fmt={headline.fmt} /> between the two frames, and the
          dispatcher set grid power to <span className="font-mono">{fmtKw(requestW)}</span>.
        </p>
      ) : (
        <p className="mb-2 text-[11px] text-muted-foreground">
          Telemetry was steady frame-to-frame — this looks like a re-assert or scheduled decision
          rather than a reaction to a changing signal.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {deltas.map((d) => (
          <div
            key={d.key}
            className={cn(
              "rounded-md border bg-background px-2 py-1.5",
              d === headline && "border-primary/50 ring-1 ring-primary/30",
            )}
          >
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <d.icon className="size-3" />
              {d.label}
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span className="font-mono text-xs">{d.fmt(d.after)}</span>
              <DeltaBadge delta={d.delta} fmt={d.fmt} />
            </div>
          </div>
        ))}
      </div>

      {(limitChanged || newWarnings.length > 0 || newErrors.length > 0) && (
        <ul className="mt-2 space-y-1 text-[11px]">
          {limitChanged && (
            <li className="text-foreground">Station grid limits changed at the cause frame.</li>
          )}
          {newWarnings.map((w) => (
            <li key={w} className="text-amber-600">
              New warning: {w}
            </li>
          ))}
          {newErrors.map((e) => (
            <li key={e} className="text-red-600">
              New error: {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Small up/down delta pill; green = down, amber = up, muted = no change. */
function DeltaBadge({ delta, fmt }: { delta: number | null; fmt: (n: number | null) => string }) {
  if (delta == null || Math.abs(delta) < 1e-6)
    return <span className="text-[10px] text-muted-foreground">no change</span>
  const up = delta > 0
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium",
        up
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      <Icon className="size-3" />
      {up ? "+" : ""}
      {fmt(delta)}
    </span>
  )
}

/** Full telemetry breakdown for one frame, shown as an expanded detail row. */
function FrameDetail({ frame }: { frame: ApiTelemetryFrame }) {
  const g = frame.grid
  const st = frame.station
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={6} className="p-0">
        <div className="grid gap-3 p-3 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
          <DetailBlock title="Grid">
            <DetailItem label="Power" value={fmtKw(g?.p_grid_w ?? null)} />
            <DetailItem label="Aux" value={fmtKw(g?.p_aux_w ?? null)} />
            <DetailItem label="Frequency" value={g?.f_grid_hz != null ? `${num(g.f_grid_hz, 2)} Hz` : "—"} />
            <DetailItem label="cos φ" value={g?.cos_phi != null ? num(g.cos_phi, 2) : "—"} />
            <DetailItem label="Import" value={g?.e_grid_imp_kwh != null ? `${num(g.e_grid_imp_kwh)} kWh` : "—"} />
            <DetailItem label="Export" value={g?.e_grid_exp_kwh != null ? `${num(g.e_grid_exp_kwh)} kWh` : "—"} />
          </DetailBlock>

          <DetailBlock title="Batteries">
            {(frame.batteries ?? []).length === 0 ? (
              <span className="text-muted-foreground">none</span>
            ) : (
              (frame.batteries ?? []).map((b) => (
                <DetailItem
                  key={b.unit_id}
                  label={`Unit ${b.unit_id}`}
                  value={`${num(b.soc_pct)}% · ${fmtKw(b.power_w)} · ${num(b.temp_max_c, 0)}°C · ${b.contactor_state}`}
                />
              ))
            )}
          </DetailBlock>

          <DetailBlock title="Chargers">
            {(frame.chargers ?? []).length === 0 ? (
              <span className="text-muted-foreground">none</span>
            ) : (
              (frame.chargers ?? []).map((c) => (
                <DetailItem
                  key={c.unit_id}
                  label={`Unit ${c.unit_id}`}
                  value={`${c.plug_state} · ${fmtKw(c.p_ev_w)} · ${c.charging_state}`}
                />
              ))
            )}
          </DetailBlock>

          <DetailBlock title="Station">
            <DetailItem label="State" value={st?.operation_state ?? "—"} />
            <DetailItem label="Consumption limit" value={fmtKw(st?.p_grid_consumption_limit_w ?? null)} />
            <DetailItem label="Generation limit" value={fmtKw(st?.p_grid_generation_limit_w ?? null)} />
            <DetailItem label="Warnings" value={st?.warnings?.length ? st.warnings.join(", ") : "none"} />
            <DetailItem label="Errors" value={st?.errors?.length ? st.errors.join(", ") : "none"} />
          </DetailBlock>

          <DetailBlock title="Prices">
            <DetailItem label="DAM" value={frame.prices?.dam != null ? num(frame.prices.dam, 1) : "—"} />
            <DetailItem label="IDM" value={frame.prices?.idm != null ? num(frame.prices.idm, 1) : "—"} />
            <DetailItem label="Bucket" value={frame.prices?.bucket_ts ? fmtTime(frame.prices.bucket_ts) : "—"} />
          </DetailBlock>

          <DetailBlock title="Frame">
            <DetailItem label="Timestamp" value={fmtTime(frame.ts)} />
            <DetailItem label="Sequence" value={String(frame.sequence_number)} />
          </DetailBlock>
        </div>
      </TableCell>
    </TableRow>
  )
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <dl className="space-y-0.5">{children}</dl>
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono">{value}</dd>
    </div>
  )
}

// ── page ──���─────────────────────────────────────────────────────────────────

export function DispatcherStatusScreen() {
  // MULTI-LOCATION: the status poll is scoped to the sidebar-selected station;
  // the stationId in the SWR key makes switching stations refetch cleanly.
  const { stationId } = useStation()
  const { data, error, isLoading, mutate } = useSWR(
    `/api/dispatcher/status?stationId=${encodeURIComponent(stationId)}`,
    fetcher,
    {
      refreshInterval: 3000,
      revalidateOnFocus: true,
    },
  )

  // Dispatch is EXTERNALLY DRIVEN only: the external app calls the plan/replan
  // API on its own cadence. This dashboard is a pure viewer — it never triggers
  // ticks or replans on its own (the old browser ticker has been removed), so
  // having the page open produces no command stream.
  return (
    <div className="w-full min-w-0 max-w-full overflow-x-clip py-6 sm:py-8 px-3 sm:px-6 space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] tracking-wider uppercase">
            Prototype
          </Badge>
          <Badge variant="outline" className="text-[10px] tracking-wider uppercase gap-1">
            <RefreshCw className="size-3" />
            Auto-refresh 3s
          </Badge>
          <a
            href="/dispatcher-status/api-docs"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <BookOpen className="size-3.5" />
            API docs
          </a>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-balance">Dispatching Plan</h1>
        <p className="text-muted-foreground max-w-2xl leading-relaxed text-pretty text-sm">
          Event/replan-driven dispatch — the optimizer re-plans on relevant events (car
          connect/disconnect, IDM price divergence, SoC thresholds) plus a safety interval, and only
          the committed first step is sent to Amperio. There is no fixed tick loop: each command is
          the result of a discrete trigger. The committed commands themselves live on the{" "}
          <a href="/live-commands" className="underline underline-offset-2 hover:text-foreground">
            Live Commands Stack
          </a>
          .
        </p>
        <DispatcherHealthStrip />
      </div>

      {/* Status — event/replan-driven liveness, at the top */}
      {data && <StatusBanner data={data} />}

      {/* Dispatch plan — the replanned horizon + how it changed on replan */}
      {data && (
        <DispatchPlan plan={data.plan} replanLog={data.replanLog} onReplanned={() => void mutate()} />
      )}

      <DispatcherTickLog tickLog={data?.tickLog} />

      {error && (
        <Card className="border-l-4 border-l-red-500 bg-red-500/5">
          <CardContent className="py-4 text-sm text-red-600">
            Could not load dispatcher status ({error instanceof Error ? error.message : String(error)}).
            {/^HTTP 5/.test(error instanceof Error ? error.message : "")
              ? " The server responded with an error — this is usually the data store (Upstash Redis) being unavailable or over quota, not the app being down."
              : " Check that the app is running and reachable."}
          </CardContent>
        </Card>
      )}

      {!error && data?.storeError && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-500/5">
          <CardContent className="py-4 text-sm text-amber-700 dark:text-amber-400">
            <span className="font-medium">Data store degraded:</span> {data.storeError} Live status,
            activity and plan history may be stale or empty until this clears.
          </CardContent>
        </Card>
      )}

      {isLoading && !data && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Loading dispatcher status…
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/**
 * Live Commands Stack — the committed dispatch commands, split out of the
 * Dispatching Plan page into its own view. It reads the dispatcher status (for
 * the worker's site/station + the clear marker) and the live command record
 * from Amperio, then renders the filterable, exportable command table.
 */
export function LiveCommandsStackScreen() {
  // Status is the source of worker site/station + the commands-clear marker.
  // SWR dedupes this key with any other live poll of the same endpoint.
  // MULTI-LOCATION: scoped to the sidebar-selected station. (Renamed to avoid
  // shadowing the worker-reported stationId below, which keys frame fetches.)
  const { stationId: selectedStationId, station: selectedStation } = useStation()
  const { data, mutate } = useSWR(
    `/api/dispatcher/status?stationId=${encodeURIComponent(selectedStationId)}`,
    fetcher,
    {
      refreshInterval: 3000,
      revalidateOnFocus: true,
    },
  )
  const [clearingCommands, setClearingCommands] = useState(false)
  const [exporting, setExporting] = useState(false)
  // Commands list time range: default last hour; "Show more" expands to 24h.
  const [range, setRange] = useState<"1h" | "24h">("1h")
  // Show only commands that actually moved the grid setpoint.
  const [onlyChanges, setOnlyChanges] = useState(false)
  // Which command row is expanded to reveal its payload + reason.
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Commands come straight from Amperio (the master record), not our layer.
  // Fetch enough to cover the selected window (1h ≈ 240 @15s, 24h ≈ 5760).
  // MULTI-LOCATION: worker-reported site first, then the SELECTED station's
  // registry siteId. The old hardcoded Gronau fallback pulled GRONAU's
  // commands into the grid while viewing another location whenever that
  // station's worker hadn't reported yet — cross-station data is worse than
  // an empty grid, so the legacy constant is a last resort only when the
  // registry list hasn't loaded.
  const siteId = data?.worker?.siteId ?? selectedStation?.siteId ?? DEFAULT_SITE_ID
  // Station id is what the telemetry/frames endpoint keys on (per-command debug
  // frame fetch). Worker-reported first, then the sidebar selection; commands
  // fall back to their own assetId when neither has resolved yet.
  const stationId = data?.worker?.stationId ?? selectedStationId ?? ""
  const fetchLimit = range === "24h" ? 6000 : 400
  const {
    data: commands,
    error: commandsError,
    isLoading: commandsLoading,
  } = useSWR(["amperio-commands", siteId, range], ([, sid]) => getCommands(sid, fetchLimit), {
    refreshInterval: range === "24h" ? 15000 : 5000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })

  // The "clear commands" marker only hides the view (Amperio keeps the records).
  const clearedAtMs = data?.commandsClearedAt ? Date.parse(data.commandsClearedAt) : 0
  // Commands actually shown: within the selected window and after any clear.
  const visibleCommands = useMemo(() => {
    const cutoff = Date.now() - (range === "24h" ? DAY_MS : HOUR_MS)
    return (commands ?? []).filter((c) => {
      const t = c.timestamp ? Date.parse(c.timestamp) : Number.NaN
      return Number.isFinite(t) && t >= cutoff && t > clearedAtMs
    })
  }, [commands, range, clearedAtMs])
  // How many recent commands the clear marker is currently hiding.
  const hiddenByClear = useMemo(() => {
    if (!clearedAtMs) return 0
    return (commands ?? []).filter((c) => {
      const t = c.timestamp ? Date.parse(c.timestamp) : Number.NaN
      return Number.isFinite(t) && t <= clearedAtMs
    }).length
  }, [commands, clearedAtMs])

  // Setpoint-change analysis. Computed across ALL fetched commands so a diff is
  // correct even at the edge of the visible window. Keyed by commandId.
  const changeMap = useMemo(() => annotateSetpointChanges(commands ?? []), [commands])
  const changeCount = useMemo(
    () => visibleCommands.filter((c) => changeMap.get(c.commandId)?.changed).length,
    [visibleCommands, changeMap],
  )
  // "Only setpoint changes" filter + which row is expanded for detail.
  const displayedCommands = onlyChanges
    ? visibleCommands.filter((c) => changeMap.get(c.commandId)?.changed)
    : visibleCommands

  async function handleClearCommands() {
    setClearingCommands(true)
    const nowIso = new Date().toISOString()
    if (data) void mutate({ ...data, commandsClearedAt: nowIso }, { revalidate: false })
    try {
      await fetch(
        `/api/dispatcher/commands-clear?stationId=${encodeURIComponent(selectedStationId)}`,
        { method: "POST" },
      )
    } catch {
      // Ignore — the next poll reconciles.
    } finally {
      setClearingCommands(false)
      void mutate()
    }
  }

  // Undo a previous clear so the full window is visible again.
  async function handleUnclearCommands() {
    if (data) void mutate({ ...data, commandsClearedAt: null }, { revalidate: false })
    try {
      await fetch(
        `/api/dispatcher/commands-clear?stationId=${encodeURIComponent(selectedStationId)}`,
        { method: "DELETE" },
      )
    } catch {
      // Ignore — the next poll reconciles.
    } finally {
      void mutate()
    }
  }

  // Export the last 24h of commands as CSV (fetched fresh, independent of the
  // current view range or clear marker — this is the raw record from Amperio).
  async function handleExport24h() {
    setExporting(true)
    try {
      const all = await getCommands(siteId, 6000)
      const cutoff = Date.now() - DAY_MS
      const within = all.filter((c) => {
        const t = c.timestamp ? Date.parse(c.timestamp) : Number.NaN
        return Number.isFinite(t) && t >= cutoff
      })
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
      downloadCsv(`amperio-commands-24h-${stamp}.csv`, commandsToCsv(within))
    } catch {
      // Ignore — export is best-effort.
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-clip py-6 sm:py-8 px-3 sm:px-6 space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] tracking-wider uppercase">
            Prototype
          </Badge>
          <Badge variant="outline" className="text-[10px] tracking-wider uppercase gap-1">
            <RefreshCw className="size-3" />
            Auto-refresh
          </Badge>
          <a
            href="/dispatcher-status"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Radio className="size-3.5" />
            Dispatching Plan
          </a>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-balance">Live Commands Stack</h1>
        <p className="text-muted-foreground max-w-2xl leading-relaxed text-pretty text-sm">
          The committed dispatch commands sent to Amperio (the master record), newest first. Each row
          is the first step of a plan re-solve; expand it to inspect the payload, gate reason and the
          telemetry frames around the command. Use the filters to isolate the commands that actually
          moved the grid setpoint.
        </p>
      </div>

      {/* Commands — pulled live from Amperio (GET /api/v1/commands) */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Zap className="size-5 text-orange-500" />
                Commands
                <Badge variant="secondary" className="ml-1 font-mono">
                  {visibleCommands.length}
                </Badge>
              </CardTitle>
              <CardDescription>
                Live from Amperio (master record) · {range === "24h" ? "last 24 hours" : "last hour"} ·
                newest first ·{" "}
                <span className="text-primary font-medium">{changeCount} setpoint change{changeCount === 1 ? "" : "s"}</span>
                {hiddenByClear > 0 && (
                  <>
                    {" · "}
                    <span className="text-amber-600">{hiddenByClear} cleared from view</span>{" "}
                    <button
                      type="button"
                      onClick={handleUnclearCommands}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      show
                    </button>
                  </>
                )}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={onlyChanges ? "default" : "outline"}
                onClick={() => setOnlyChanges((v) => !v)}
                aria-pressed={onlyChanges}
                className="gap-1.5"
              >
                <ListFilter className="size-4" />
                {onlyChanges ? "Setpoint changes only" : "Only setpoint changes"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRange(range === "24h" ? "1h" : "24h")}
                className="gap-1.5"
              >
                {range === "24h" ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
                {range === "24h" ? "Show last hour" : "Show more (24h)"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExport24h}
                disabled={exporting}
                className="gap-1.5"
              >
                {exporting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Export 24h
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleClearCommands}
                disabled={clearingCommands || visibleCommands.length === 0}
                className="gap-1.5 text-muted-foreground"
              >
                {clearingCommands ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Clear
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {commandsError ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <CircleAlert className="size-8 text-red-500/60" />
              <p className="text-sm text-red-600">
                Could not load commands from Amperio. ({String(commandsError)})
              </p>
            </div>
          ) : commandsLoading && !commands ? (
            <TelemetryLoader
              mode="historical"
              bare
              title="Loading Command Stack"
              subtitle="Fetching the committed dispatch commands from Amperio"
              endpoint="GET /api/v1/commands"
              footer="Reading the master command record"
            />
          ) : visibleCommands.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <Gauge className="size-8 opacity-40" />
              <p className="text-sm">
                {hiddenByClear > 0
                  ? `All commands in the ${range === "24h" ? "last 24h" : "last hour"} are cleared from view.`
                  : `No commands in Amperio for the ${range === "24h" ? "last 24 hours" : "last hour"}.`}
              </p>
              {hiddenByClear > 0 ? (
                <Button size="sm" variant="outline" onClick={handleUnclearCommands} className="mt-1">
                  Show cleared
                </Button>
              ) : (
                range === "1h" && (
                  <Button size="sm" variant="outline" onClick={() => setRange("24h")} className="mt-1">
                    Show last 24h
                  </Button>
                )
              )}
            </div>
          ) : displayedCommands.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <ListFilter className="size-8 opacity-40" />
              <p className="text-sm">
                No setpoint changes in the {range === "24h" ? "last 24 hours" : "last hour"} — every
                command re-asserted the same grid setpoint.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOnlyChanges(false)}
                className="mt-1"
              >
                Show all commands
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Command ID</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="text-right">P_grid</TableHead>
                    <TableHead>Why this command</TableHead>
                    <TableHead>Price zone</TableHead>
                    <TableHead>Valid until</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedCommands.map((cmd) => (
                    <CommandRow
                      key={cmd.commandId}
                      cmd={cmd}
                      stationId={stationId}
                      change={
                        changeMap.get(cmd.commandId) ?? {
                          prevW: null,
                          deltaW: null,
                          changed: false,
                        }
                      }
                      expanded={expandedId === cmd.commandId}
                      onToggle={() =>
                        setExpandedId((id) => (id === cmd.commandId ? null : cmd.commandId))
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
