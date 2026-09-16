"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BatteryCharging,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Cpu,
  DollarSign,
  Filter,
  Inbox,
  LayoutGrid,
  Layers3,
  Minus,
  PlugZap,
  Radio,
  RotateCw,
  Sparkles,
  Table2,
  Target,
  Zap,
} from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ButtonGroup,
} from "@/components/ui/button-group"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import { SimControlWidget } from "@/components/prototype/sim-control-widget"
import { HistoricalReplayPanel } from "@/components/prototype/historical-replay-panel"
import { HistoricalStatsWidget } from "@/components/prototype/historical-stats-widget"
import {
  advanceCommandStatus,
  buildCommand,
  deriveCommandImpact,
  diffSetpoints,
  diffTriggers,
  formatClock,
  formatKw,
  formatPerUnitGrid,
  formatRelative,
  observeFrame,
  priceZoneTone,
  resetCommandSeq,
  socBand,
  statusTone,
  triggerKind,
  triggerLabel,
  type CommandImpact,
  type CommandStatus,
  type DispatchTrigger,
  type LiveCommand,
  type ObservedState,
  type SetpointDiff,
} from "@/lib/prototype-command-stream"

// ---------------------------------------------------------------------------
// Stream hook
// ---------------------------------------------------------------------------

interface UseCommandStreamResult {
  commands: LiveCommand[]
  /** Wall-clock as known by the simulator (frame.ts). */
  nowMs: number | null
  /** Most recent observed state (used by the explainer + NOW chip). */
  observation: ObservedState | null
  /** Reset stack — wired to the same Reset button as the rest of the shell. */
  reset: () => void
  /** Total commands ever issued this session (for KPI strip). */
  totalCount: number
  /** In-flight (pending | acked | executing) count. */
  inFlightCount: number
  /** Executed (incl. deviated) within the last N ms. */
  recentExecutedCount: number
}

/**
 * Generate a small set of historical, already-finalized commands so the
 * Commands screen has visible activity on first paint instead of an empty
 * stack. The variations walk through a plausible 4-5 minute slice of the
 * day (cheap night → moderate morning → plug-in → expensive midday →
 * peak afternoon → unplug into cheap evening) so trigger badges, price
 * zones and SOC bands all show up at least once.
 */
function buildBackfillCommands(nowMs: number): LiveCommand[] {
  const variations: ObservedState[] = [
    { plug_c1: false, plug_c2: false, price_zone: "cheap",     soc_band: "mid",  price_eur_mwh: 48,  pack_soc_pct: 62 },
    { plug_c1: false, plug_c2: false, price_zone: "moderate",  soc_band: "mid",  price_eur_mwh: 88,  pack_soc_pct: 65 },
    { plug_c1: true,  plug_c2: false, price_zone: "moderate",  soc_band: "mid",  price_eur_mwh: 96,  pack_soc_pct: 64 },
    { plug_c1: true,  plug_c2: false, price_zone: "expensive", soc_band: "mid",  price_eur_mwh: 132, pack_soc_pct: 58 },
    { plug_c1: true,  plug_c2: true,  price_zone: "expensive", soc_band: "mid",  price_eur_mwh: 148, pack_soc_pct: 52 },
    { plug_c1: true,  plug_c2: true,  price_zone: "peak",      soc_band: "mid",  price_eur_mwh: 178, pack_soc_pct: 46 },
    { plug_c1: false, plug_c2: true,  price_zone: "peak",      soc_band: "low",  price_eur_mwh: 168, pack_soc_pct: 28 },
    { plug_c1: false, plug_c2: false, price_zone: "moderate",  soc_band: "low",  price_eur_mwh: 92,  pack_soc_pct: 26 },
  ]
  // Walk forward in irregular 25..70s steps so the seq is monotonic and the
  // youngest seeded entry sits ~15s before "now".
  const steps: number[] = [55, 38, 47, 62, 31, 44, 58, 27]
  const totalAge = steps.reduce((a, b) => a + b, 0)
  let cursor = nowMs - totalAge * 1000 - 15_000
  const out: LiveCommand[] = []
  let prev: ObservedState | null = null
  let prevCmd: LiveCommand | undefined
  variations.forEach((cur, i) => {
    const triggers = diffTriggers(prev, cur)
    if (triggers.length > 0) {
      const cmd = buildCommand({ issuedAt: cursor, triggers, cur, prev: prevCmd })
      const ackLatency = 55 + ((i * 37) % 90)
      const execLatencyS = Math.round((1.5 + ((i * 11) % 18) / 10) * 10) / 10
      const commanded = cmd.request.chargers[0].P_grid_request_w * 2
      const devSign = i % 3 === 0 ? -1 : 1
      const devPct = ((i * 13) % 9) + 0.5 // 0.5..9.5
      const isDeviation = cur.price_zone === "peak" && i === 5
      cmd.status = isDeviation ? "deviated" : "executed"
      cmd.ackedAt = cursor + ackLatency
      cmd.ack_latency_ms = ackLatency
      cmd.executingAt = cursor + ackLatency + 200
      cmd.finalizedAt = cursor + ackLatency + Math.round(execLatencyS * 1000)
      cmd.exec_latency_s = execLatencyS
      cmd.result = {
        commanded_P_grid_w: commanded,
        actual_P_grid_w:
          isDeviation
            ? Math.round(commanded * 0.86)
            : Math.round(commanded * (1 - (devPct / 100) * devSign)),
        deviation_pct: isDeviation ? 14.2 : Math.round(devPct * 10) / 10,
        note: isDeviation ? "Site clipped to honour grid envelope" : undefined,
      }
      out.push(cmd)
      prevCmd = cmd
    }
    prev = cur
    cursor += steps[i] * 1000
  })
  return out.reverse() // newest first
}

/**
 * Build a synthetic "periodic refresh" command that replays the current
 * setpoints. Real Middleware re-asserts the active envelope every ~15s
 * even when nothing changed, both to refresh the watchdog and to give
 * integrators a steady heartbeat in the Commands stack.
 */
function buildPeriodicRefresh(
  issuedAt: number,
  cur: ObservedState,
  prevCmd: LiveCommand | undefined
): LiveCommand {
  const cmd = buildCommand({ issuedAt, triggers: ["baseline"], cur, prev: prevCmd })
  // Override the gate reason to read as a heartbeat, not a baseline reset.
  return {
    ...cmd,
    gate_reason:
      "Periodic refresh — re-asserting active envelope (no observed state change)",
  }
}

function useCommandStream(windowMs = 5 * 60_000): UseCommandStreamResult {
  const { frame } = usePrototypeTelemetryContext()
  const [commands, setCommands] = useState<LiveCommand[]>([])
  const [observation, setObservation] = useState<ObservedState | null>(null)
  const seededRef = useRef(false)
  const lastDispatchTRef = useRef<number | null>(null)
  const nextSyntheticTRef = useRef<number | null>(null)

  const scheduleNextSynthetic = (currentT: number) => {
    // 10..20s later (sim-seconds)
    nextSyntheticTRef.current = currentT + 10 + Math.random() * 10
  }

  // Reset hook: detect a global reset by watching frame.t_s drop back near zero.
  // After a reset the grid intentionally stays EMPTY — no backfill replay —
  // so the operator sees a clean slate and watches commands accumulate
  // organically as the simulation progresses. We achieve that by leaving
  // `seededRef.current = true` so the first-frame seed branch is skipped.
  const lastTRef = useRef<number | null>(null)
  useEffect(() => {
    const t = frame?.t_s ?? null
    if (t !== null && lastTRef.current !== null && t < lastTRef.current) {
      setCommands([])
      setObservation(null)
      resetCommandSeq()
      seededRef.current = true
      lastDispatchTRef.current = null
      nextSyntheticTRef.current = null
    }
    lastTRef.current = t
  }, [frame?.t_s])

  // On every new frame: observe -> compute trigger diff -> issue command if any
  useEffect(() => {
    if (!frame) return
    const cur = observeFrame(frame)
    setObservation(cur)
    const issuedAt = new Date(frame.ts).getTime()
    const t_s = frame.t_s ?? 0

    // First-mount seed: prebuild ~7 historical commands so the table is
    // alive on initial paint. After a reset this branch is skipped (the
    // reset paths flip `seededRef.current` to true) so the grid starts
    // empty and only fills as real triggers fire.
    if (!seededRef.current) {
      seededRef.current = true
      const seeded = buildBackfillCommands(issuedAt)
      lastDispatchTRef.current = t_s
      scheduleNextSynthetic(t_s)
      setCommands(seeded)
      return
    }

    setCommands((prev) => {
      const lastObs: ObservedState | null =
        prev.length > 0
          ? {
              plug_c1: prev[0].request.metadata.ev_active_c1,
              plug_c2: prev[0].request.metadata.ev_active_c2,
              price_zone: prev[0].request.metadata.price_zone,
              soc_band: socBand(prev[0].request.metadata.pack_soc_pct),
              price_eur_mwh: prev[0].request.metadata.price_eur_mwh,
              pack_soc_pct: prev[0].request.metadata.pack_soc_pct,
            }
          : null
      const triggers = diffTriggers(lastObs, cur)
      // Always advance status of in-flight commands first
      const advanced = prev.map((c) => advanceCommandStatus(c, issuedAt, frame))
      const prevAccepted = advanced.find((c) => c.status !== "pending")

      if (triggers.length > 0) {
        const newCmd = buildCommand({
          issuedAt,
          triggers,
          cur,
          prev: prevAccepted,
        })
        lastDispatchTRef.current = t_s
        scheduleNextSynthetic(t_s)
        return [newCmd, ...advanced]
      }

      // No real trigger this tick -- check periodic refresh window
      if (
        nextSyntheticTRef.current !== null &&
        t_s >= nextSyntheticTRef.current
      ) {
        const synth = buildPeriodicRefresh(issuedAt, cur, prevAccepted)
        lastDispatchTRef.current = t_s
        scheduleNextSynthetic(t_s)
        return [synth, ...advanced]
      }

      return advanced
    })
  }, [frame])

  const nowMs = frame ? new Date(frame.ts).getTime() : null

  const inFlightCount = useMemo(
    () =>
      commands.filter(
        (c) =>
          c.status === "pending" ||
          c.status === "acked" ||
          c.status === "executing"
      ).length,
    [commands]
  )

  const recentExecutedCount = useMemo(() => {
    if (nowMs === null) return 0
    return commands.filter(
      (c) =>
        (c.status === "executed" || c.status === "deviated") &&
        nowMs - c.issuedAt <= windowMs
    ).length
  }, [commands, nowMs, windowMs])

  return {
    commands,
    nowMs,
    observation,
    reset: () => {
      // Mirror the t_s-drop reset path: clear the grid and leave the
      // seeded flag set so the next frame doesn't replay the historical
      // backfill. The simulation continues forward from "no commands".
      setCommands([])
      setObservation(null)
      resetCommandSeq()
      seededRef.current = true
      lastDispatchTRef.current = null
      nextSyntheticTRef.current = null
    },
    totalCount: commands.length,
    inFlightCount,
    recentExecutedCount,
  }
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

type TriggerFilter = "all" | "ev" | "price" | "soc"
type StatusFilter = "all" | "in_flight" | "executed" | "issue"

function filterCommands(
  cmds: LiveCommand[],
  triggerFilter: TriggerFilter,
  statusFilter: StatusFilter
): LiveCommand[] {
  return cmds.filter((c) => {
    if (triggerFilter !== "all") {
      const has = c.triggers.some((t) => triggerKind(t) === triggerFilter)
      if (!has) return false
    }
    if (statusFilter === "in_flight") {
      return c.status === "pending" || c.status === "acked" || c.status === "executing"
    }
    if (statusFilter === "executed") {
      return c.status === "executed"
    }
    if (statusFilter === "issue") {
      return c.status === "deviated" || c.status === "rejected"
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function PrototypeTelemetryCommandsScreen() {
  const { dataSource } = usePrototypeTelemetryContext()
  const stream = useCommandStream()
  const [view, setView] = useState<"cards" | "table">("table")
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  const filtered = useMemo(
    () => filterCommands(stream.commands, triggerFilter, statusFilter),
    [stream.commands, triggerFilter, statusFilter]
  )

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5">
        {/* Historical mode widgets — stats and player controls */}
        {dataSource === "historical" && (
          <>
            {/* Operating Day Summary — overview stats calculated from frames */}
            <HistoricalStatsWidget />
            {/* Replay Player — transport controls and progress */}
            <HistoricalReplayPanel />
          </>
        )}
        
        {/* Shared simulation transport — drives the same context that
            feeds the Day-Sim screen and the Snapshot view, so commands
            issued or replayed here stay aligned with the simulated
            clock everywhere else. Only show in simulated mode. */}
        {dataSource === "simulated" && <SimControlWidget />}

        <ExplainerHeader />

        <KpiStrip
          total={stream.totalCount}
          inFlight={stream.inFlightCount}
          recent={stream.recentExecutedCount}
        />

        <Toolbar
          view={view}
          onView={setView}
          triggerFilter={triggerFilter}
          onTriggerFilter={setTriggerFilter}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          totalCount={stream.commands.length}
          shownCount={filtered.length}
        />

        {stream.commands.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <NowAnchor
              nowMs={stream.nowMs}
              inFlight={stream.inFlightCount}
              latestCmd={stream.commands[0]}
            />

            {view === "cards" ? (
              <CardStack commands={filtered} nowMs={stream.nowMs} />
            ) : (
              <CommandTable commands={filtered} nowMs={stream.nowMs} />
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// Header / explainer (matches the polish of Time-series, Events, Stream)
// ---------------------------------------------------------------------------

function ExplainerHeader() {
  // Collapsed by default — operators just want the live stack. The
  // explanation is one click away for newcomers.
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-expanded={open}
            className="w-full flex items-center gap-3 p-4 md:p-5 text-left hover:bg-muted/40 transition-colors rounded-lg"
          >
            <div className="size-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Cpu className="size-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base md:text-lg font-semibold leading-tight">
                Command Stream — live dispatch stack
              </h2>
              <p className="text-xs md:text-sm text-muted-foreground leading-snug mt-0.5 truncate">
                {open
                  ? "Hide explanation"
                  : "What you’re looking at, how to read it, what to watch for"}
              </p>
            </div>
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground shrink-0 transition-transform",
                open && "rotate-180"
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 md:px-5 pb-5 md:pb-6 -mt-1">
            <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
              The optimizer evaluates one telemetry tick per second and only
              writes a new command on the Dispatching API when the pilot
              strategy materially changes. Each entry below is a real{" "}
              <code className="text-[12px]">POST /dispatch</code> payload with
              its full ack / execution status loop. New commands stream in from
              the top — <strong>NOW</strong> sits just above the most recent
              entry.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <ExplainBlock
                icon={Target}
                title="Purpose"
                body="Show what was dispatched, why, and how the site responded — so an integrator can see the optimizer is well-behaved (no chatter, no churn) and that ChargePost honoured every setpoint."
              />
              <ExplainBlock
                icon={Filter}
                title="How to read it"
                body="Top is newest. Trigger badges name what changed in the observed state to cause the dispatch. The status timeline (pending → acked → executing → executed) carries the API feedback loop end-to-end."
              />
              <ExplainBlock
                icon={Sparkles}
                title="Watch for"
                body="Long stretches with no new commands = stable steady state (good). A burst of commands = an EV event or a price boundary. Deviated rows mean the site clipped to honour an envelope — investigate, don't ignore."
              />
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <TriggerLegend
                icon={PlugZap}
                label="Plug events"
                color="text-violet-600"
                ring="ring-violet-500/30"
                desc="EV plug / unplug — primary driver"
              />
              <TriggerLegend
                icon={DollarSign}
                label="Price"
                color="text-amber-600"
                ring="ring-amber-500/30"
                desc="Spot price crosses a band"
              />
              <TriggerLegend
                icon={Activity}
                label="SOC"
                color="text-sky-600"
                ring="ring-sky-500/30"
                desc="Pack SOC crosses a guard band"
              />
              <TriggerLegend
                icon={Zap}
                label="Baseline / refresh"
                color="text-emerald-600"
                ring="ring-emerald-500/30"
                desc="Reset baseline or periodic refresh"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

function ExplainBlock({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Target
  title: string
  body: string
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3.5">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
          {title}
        </span>
      </div>
      <p className="text-[13px] text-foreground leading-snug text-pretty">
        {body}
      </p>
    </div>
  )
}

function TriggerLegend({
  icon: Icon,
  label,
  desc,
  color,
  ring,
}: {
  icon: typeof Target
  label: string
  desc: string
  color: string
  ring: string
}) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-md border p-2.5 ring-1", ring)}>
      <Icon className={cn("size-4 mt-0.5 shrink-0", color)} />
      <div>
        <div className="text-xs font-semibold">{label}</div>
        <div className="text-[11px] text-muted-foreground leading-snug text-pretty">
          {desc}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function KpiStrip({
  total,
  inFlight,
  recent,
}: {
  total: number
  inFlight: number
  recent: number
}) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      <KpiTile
        label="Stack depth"
        value={total}
        helper="commands"
        icon={Layers3}
      />
      <KpiTile
        label="In flight"
        value={inFlight}
        helper={inFlight === 0 ? "all settled" : "ack / exec"}
        icon={Radio}
        accent={inFlight > 0 ? "amber" : "emerald"}
        pulse={inFlight > 0}
      />
      <KpiTile
        label="Last 5 min"
        value={recent}
        helper="executed"
        icon={CheckCircle2}
        accent="emerald"
      />
    </div>
  )
}

/**
 * Compact, dense KPI tile. Single horizontal row with the metric reading
 * dominant — designed to sit in a 3-up strip without dwarfing the live
 * command list it's there to support.
 */
function KpiTile({
  label,
  value,
  helper,
  icon: Icon,
  accent,
  pulse,
}: {
  label: string
  value: number | string
  helper: string
  icon: typeof Target
  accent?: "emerald" | "amber"
  pulse?: boolean
}) {
  const accentColor =
    accent === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : accent === "amber"
      ? "text-amber-600 dark:text-amber-500"
      : "text-foreground"
  const accentRing =
    accent === "emerald"
      ? "bg-emerald-500/10"
      : accent === "amber"
      ? "bg-amber-500/10"
      : "bg-muted"
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-2.5 flex items-center gap-3">
        <div
          className={cn(
            "relative size-9 rounded-md flex items-center justify-center shrink-0",
            accentRing
          )}
        >
          <Icon className={cn("size-4 relative z-10", accentColor)} />
          {pulse && (
            <span className="absolute inset-0 rounded-md bg-amber-500/30 animate-ping pointer-events-none" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "text-lg font-semibold tabular-nums leading-none",
                accentColor
              )}
            >
              {value}
            </span>
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
              {label}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 truncate">
            {helper}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({
  view,
  onView,
  triggerFilter,
  onTriggerFilter,
  statusFilter,
  onStatusFilter,
  totalCount,
  shownCount,
}: {
  view: "cards" | "table"
  onView: (v: "cards" | "table") => void
  triggerFilter: TriggerFilter
  onTriggerFilter: (f: TriggerFilter) => void
  statusFilter: StatusFilter
  onStatusFilter: (f: StatusFilter) => void
  totalCount: number
  shownCount: number
}) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mr-1">
          Trigger
        </span>
        {(["all", "ev", "price", "soc"] as TriggerFilter[]).map((f) => (
          <Button
            key={f}
            variant={triggerFilter === f ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs capitalize"
            onClick={() => onTriggerFilter(f)}
          >
            {f === "ev" ? "EV plug" : f}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mr-1">
          Status
        </span>
        {(["all", "in_flight", "executed", "issue"] as StatusFilter[]).map((f) => (
          <Button
            key={f}
            variant={statusFilter === f ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => onStatusFilter(f)}
          >
            {f === "in_flight"
              ? "in flight"
              : f === "issue"
              ? "deviated / rejected"
              : f}
          </Button>
        ))}
      </div>

      <div className="lg:ml-auto flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {shownCount === totalCount
            ? `${totalCount} commands`
            : `${shownCount} of ${totalCount}`}
        </span>
        <ButtonGroup>
          <Button
            variant={view === "cards" ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => onView("cards")}
          >
            <Layers3 className="size-3.5 mr-1" />
            Cards
          </Button>
          <Button
            variant={view === "table" ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => onView("table")}
          >
            <Table2 className="size-3.5 mr-1" />
            Table
          </Button>
        </ButtonGroup>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// NOW anchor
// ---------------------------------------------------------------------------

function NowAnchor({
  nowMs,
  inFlight,
  latestCmd,
}: {
  nowMs: number | null
  inFlight: number
  latestCmd: LiveCommand
}) {
  const sinceLast =
    nowMs !== null ? formatRelative(latestCmd.issuedAt, nowMs) : "—"
  const subtitle =
    inFlight > 0
      ? `${inFlight} dispatch${inFlight === 1 ? "" : "es"} in flight`
      : "Idle — awaiting next state change"

  return (
    <div className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-2.5 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-y">
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center">
          <span className="absolute inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 opacity-60 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </div>
        <div className="flex items-baseline gap-2 flex-1 min-w-0">
          <span className="text-xs font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            NOW
          </span>
          <span className="text-sm font-mono tabular-nums text-foreground">
            {nowMs !== null ? formatClock(nowMs) : "—"}
          </span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            · {subtitle}
          </span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
          last command {sinceLast}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <Card>
      <CardContent className="p-10 flex flex-col items-center text-center">
        <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-3">
          <Inbox className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold">No commands yet</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md text-pretty">
          The optimizer dispatches when the observed site state changes. As soon
          as the first telemetry frame arrives, a baseline command will fire and
          appear here. Subsequent commands will follow plug events, price-zone
          transitions, or SOC threshold crossings.
        </p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Card stack
// ---------------------------------------------------------------------------

function CardStack({
  commands,
  nowMs,
}: {
  commands: LiveCommand[]
  nowMs: number | null
}) {
  return (
    <div className="space-y-3">
      {commands.map((c, idx) => (
        <CommandCard key={c.id} cmd={c} isLatest={idx === 0} nowMs={nowMs} />
      ))}
    </div>
  )
}

function CommandCard({
  cmd,
  isLatest,
  nowMs,
}: {
  cmd: LiveCommand
  isLatest: boolean
  nowMs: number | null
}) {
  const [expanded, setExpanded] = useState(false)
  // Briefly highlight when the card is fresh
  const [justArrived, setJustArrived] = useState(false)
  const idRef = useRef<string | null>(null)
  useEffect(() => {
    if (idRef.current !== cmd.id) {
      idRef.current = cmd.id
      setJustArrived(true)
      const t = setTimeout(() => setJustArrived(false), 1400)
      return () => clearTimeout(t)
    }
  }, [cmd.id])

  const tone = statusTone(cmd.status)
  const priceTone = priceZoneTone(cmd.request.metadata.price_zone)
  const diffs = diffSetpoints(cmd.prev_request, cmd.request)
  const impact = deriveCommandImpact(cmd)

  return (
    <Card
      className={cn(
        "overflow-hidden border-l-4 transition-shadow",
        cmd.status === "pending" || cmd.status === "acked" || cmd.status === "executing"
          ? "border-l-amber-500"
          : cmd.status === "deviated"
          ? "border-l-amber-500"
          : cmd.status === "rejected"
          ? "border-l-red-500"
          : "border-l-emerald-500",
        isLatest && justArrived && "ring-2 ring-emerald-500/50 shadow-md",
        isLatest && !justArrived && "ring-1 ring-border"
      )}
    >
      <CardContent className="p-4">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn("gap-1.5 font-mono text-[10px]", tone.bg, tone.text, tone.border)}
          >
            <span
              className={cn(
                "inline-block size-1.5 rounded-full",
                tone.dot,
                (cmd.status === "pending" || cmd.status === "executing") &&
                  "animate-pulse"
              )}
            />
            {tone.label}
          </Badge>
          <span className="text-[11px] font-mono text-muted-foreground">
            #{String(cmd.seq).padStart(3, "0")}
          </span>
          <span className="text-[11px] font-mono text-muted-foreground">
            {cmd.id}
          </span>
          <Badge
            variant="outline"
            className={cn("text-[10px]", priceTone.bg, priceTone.text, priceTone.border)}
          >
            {cmd.request.metadata.price_zone}{" "}
            <span className="ml-1 font-mono">
              €{cmd.request.metadata.price_eur_mwh}
            </span>
          </Badge>
          <span className="ml-auto text-xs font-mono tabular-nums text-muted-foreground">
            {formatClock(cmd.issuedAt)}
            {nowMs !== null && (
              <span className="hidden sm:inline">
                {" · "}
                {formatRelative(cmd.issuedAt, nowMs)}
              </span>
            )}
          </span>
        </div>

        {/* Triggers */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <IntentBadge impact={impact} />
          {cmd.triggers.map((t) => (
            <TriggerChip key={t} t={t} />
          ))}
        </div>

        {/* What this command does — the headline narrative */}
        <div className="mt-3 rounded-md border bg-muted/30 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              What this command does
            </span>
            <span className="text-[10px] text-muted-foreground/70 font-mono">
              dispatch · P_grid_request only
            </span>
          </div>
          <p className="text-sm leading-snug text-pretty">
            {impact.primaryEffect}
          </p>
          {impact.secondaryEffect && (
            <p className="mt-0.5 text-[12px] text-muted-foreground leading-snug">
              {impact.secondaryEffect}
            </p>
          )}
          <p className="mt-1.5 text-[12px] text-muted-foreground italic leading-snug">
            <span className="not-italic font-medium text-foreground">
              Gate reason —
            </span>{" "}
            {cmd.gate_reason}
          </p>
        </div>

        {/* Impact tiles — Site flow · BESS · EVs */}
        <div className="mt-3 grid gap-2 grid-cols-2 lg:grid-cols-3">
          <ImpactTile
            label="Site grid flow"
            sublabel={
              impact.siteGridFlowW > 1_000
                ? "import from grid"
                : impact.siteGridFlowW < -1_000
                ? "export to grid"
                : "no grid flow"
            }
          >
            <SignedFlow w={impact.siteGridFlowW} size="lg" />
          </ImpactTile>
          <ImpactTile
            label="BESS effect"
            sublabel={bessEffectSublabel(impact)}
          >
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-base font-semibold",
                bessEffectColor(impact)
              )}
            >
              <BatteryCharging className="size-4" aria-hidden />
              {bessEffectLabel(impact)}
            </span>
          </ImpactTile>
          <ImpactTile
            label="EV connectors"
            sublabel={
              impact.plugCount === 0
                ? "no connectors plugged"
                : `${impact.plugCount} plugged · BESS-buffered`
            }
          >
            <span className="inline-flex items-center gap-1.5 text-base font-semibold">
              <PlugZap
                className={cn(
                  "size-4",
                  impact.plugCount > 0 ? "text-violet-600" : "text-muted-foreground"
                )}
                aria-hidden
              />
              {impact.plugCount === 0 ? "Idle" : `C${cmd.request.metadata.ev_active_c1 ? "1" : ""}${cmd.request.metadata.ev_active_c1 && cmd.request.metadata.ev_active_c2 ? " + C" : ""}${cmd.request.metadata.ev_active_c2 ? "2" : ""}`}
            </span>
          </ImpactTile>
        </div>

        {/* Per-unit dispatch values — the canonical wire numbers, kept visible
            but secondary to the narrative above. */}
        <div className="mt-2 flex items-baseline justify-between gap-2 flex-wrap text-[11px] text-muted-foreground">
          <span className="font-mono">
            <span className="uppercase tracking-wider mr-1.5">P_grid_request</span>
            {formatPerUnitGrid(cmd)}
          </span>
          <span className="font-mono">
            sum {formatKw(impact.siteGridFlowW)}
          </span>
        </div>

        {/* Diff chips */}
        {diffs.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-0.5">
              Δ vs prev
            </span>
            {diffs.map((d) => (
              <DiffChip key={d.field} d={d} />
            ))}
          </div>
        )}

        {/* Status timeline */}
        <StatusTimeline cmd={cmd} />

        {/* Result */}
        {cmd.result && (
          <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <ResultTile label="Commanded" value={formatKw(cmd.result.commanded_P_grid_w)} />
            <ResultTile
              label="Actual"
              value={formatKw(cmd.result.actual_P_grid_w)}
              accent={cmd.status === "deviated" ? "amber" : undefined}
            />
            <ResultTile
              label="Deviation"
              value={`${cmd.result.deviation_pct.toFixed(1)}%`}
              accent={cmd.result.deviation_pct > 5 ? "amber" : "emerald"}
            />
            {cmd.ack_latency_ms !== undefined && (
              <ResultTile
                label="Ack / exec"
                value={`${cmd.ack_latency_ms}ms / ${cmd.exec_latency_s ?? "—"}s`}
              />
            )}
          </div>
        )}

        {cmd.result?.note && (
          <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-500 flex items-center gap-1.5">
            <CircleAlert className="size-3.5" />
            {cmd.result.note}
          </p>
        )}

        {/* Expand */}
        <div className="mt-3 -mx-4 px-4 pt-2 border-t border-dashed">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              {expanded ? "Hide payload" : "Show full payload"}
            </button>
          </div>
          {expanded && (
            <div className="mt-2.5">
              <CommandDetailsTabs cmd={cmd} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TriggerChip({ t }: { t: DispatchTrigger }) {
  const kind = triggerKind(t)
  const tone =
    kind === "ev"
      ? {
          bg: "bg-violet-500/10",
          text: "text-violet-700 dark:text-violet-400",
          border: "border-violet-500/40",
          icon: PlugZap,
        }
      : kind === "price"
      ? {
          bg: "bg-amber-500/10",
          text: "text-amber-700 dark:text-amber-500",
          border: "border-amber-500/40",
          icon: DollarSign,
        }
      : kind === "soc"
      ? {
          bg: "bg-sky-500/10",
          text: "text-sky-700 dark:text-sky-400",
          border: "border-sky-500/40",
          icon: Activity,
        }
      : {
          bg: "bg-emerald-500/10",
          text: "text-emerald-700 dark:text-emerald-500",
          border: "border-emerald-500/40",
          icon: Zap,
        }
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 text-[11px] font-medium", tone.bg, tone.text, tone.border)}
    >
      <tone.icon className="size-3" />
      {triggerLabel(t)}
    </Badge>
  )
}

/**
 * Impact tile — used in CommandCard and CommandDetailsVisual to render a
 * labelled "what this command affects" cell. Same visual as SetpointTile
 * but the value content is fully composable (so it can carry an icon, a
 * signed flow readout, etc) and the helper sublabel gives one line of
 * supporting context.
 */
function ImpactTile({
  label,
  sublabel,
  children,
}: {
  label: string
  sublabel?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 leading-none">{children}</div>
      {sublabel && (
        <div className="mt-1 text-[11px] text-muted-foreground leading-snug">
          {sublabel}
        </div>
      )}
    </div>
  )
}

/** Resolve the BESS direction from the impact intent. */
function bessEffectLabel(impact: CommandImpact): string {
  switch (impact.intent) {
    case "bess_charge":
      return "Charging"
    case "bess_export":
      return "Discharging"
    case "bess_serve_ev":
    case "mixed_serve_ev":
      return "Discharging"
    case "grid_serve_ev":
      return "Holding / topping up"
    case "idle":
      return "Idle"
  }
}
function bessEffectSublabel(impact: CommandImpact): string {
  switch (impact.intent) {
    case "bess_charge":
      return "absorbing grid import"
    case "bess_export":
      return "pushing power to grid"
    case "bess_serve_ev":
      return "carrying EV load alone"
    case "mixed_serve_ev":
      return "serving EV + exporting"
    case "grid_serve_ev":
      return "supplementing the EV draw"
    case "idle":
      return "no power flow"
  }
}
function bessEffectColor(impact: CommandImpact): string {
  switch (impact.intent) {
    case "bess_charge":
    case "grid_serve_ev":
      return "text-sky-700 dark:text-sky-400"
    case "bess_export":
    case "bess_serve_ev":
    case "mixed_serve_ev":
      return "text-emerald-700 dark:text-emerald-400"
    case "idle":
      return "text-muted-foreground"
  }
}

function DiffChip({ d }: { d: SetpointDiff }) {
  const tone =
    d.kind === "tightens"
      ? "border-amber-500/40 text-amber-700 dark:text-amber-500 bg-amber-500/10"
      : d.kind === "loosens"
      ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-500 bg-emerald-500/10"
      : d.kind === "flips"
      ? "border-violet-500/40 text-violet-700 dark:text-violet-400 bg-violet-500/10"
      : "border-border text-foreground bg-muted/40"
  const Icon =
    d.kind === "tightens"
      ? ArrowDownRight
      : d.kind === "loosens"
      ? ArrowUpRight
      : d.kind === "flips"
      ? RotateCw
      : ArrowRight
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded border",
        tone
      )}
    >
      <span>{d.field}</span>
      <span className="opacity-70">{d.from}</span>
      <Icon className="size-3" />
      <span className="font-semibold">{d.to}</span>
    </span>
  )
}

function StatusTimeline({ cmd }: { cmd: LiveCommand }) {
  const steps: { key: CommandStatus; label: string; ts?: number }[] = [
    { key: "pending", label: "issued", ts: cmd.issuedAt },
    { key: "acked", label: "acked", ts: cmd.ackedAt },
    { key: "executing", label: "executing", ts: cmd.executingAt },
    {
      key: "executed",
      label:
        cmd.status === "deviated"
          ? "deviated"
          : cmd.status === "rejected"
          ? "rejected"
          : "executed",
      ts: cmd.finalizedAt,
    },
  ]
  // Compute reached state
  const reachedIndex =
    cmd.status === "pending"
      ? 0
      : cmd.status === "acked"
      ? 1
      : cmd.status === "executing"
      ? 2
      : 3

  return (
    <div className="mt-3 flex items-center gap-1.5">
      {steps.map((s, i) => {
        const reached = i <= reachedIndex
        const active = i === reachedIndex && cmd.status !== "executed" && cmd.status !== "deviated" && cmd.status !== "rejected"
        const color =
          (cmd.status === "rejected" && i === 3 && "bg-red-500") ||
          (cmd.status === "deviated" && i === 3 && "bg-amber-500") ||
          (reached && "bg-emerald-500") ||
          "bg-muted"
        return (
          <div key={s.key} className="flex-1 min-w-0 flex items-center gap-1.5">
            <div className="flex flex-col items-start min-w-0">
              <div className="flex items-center w-full gap-1.5">
                <span
                  className={cn(
                    "inline-block size-2 rounded-full shrink-0",
                    color,
                    active && "animate-pulse"
                  )}
                />
                {i < steps.length - 1 && (
                  <span
                    className={cn(
                      "h-0.5 flex-1 rounded",
                      reached && i < reachedIndex ? "bg-emerald-500" : "bg-muted"
                    )}
                  />
                )}
              </div>
              <div className="text-[10px] mt-1 font-medium leading-none whitespace-nowrap">
                {s.label}
              </div>
              <div className="text-[9px] font-mono tabular-nums text-muted-foreground leading-none mt-0.5">
                {s.ts ? formatClock(s.ts) : "—"}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ResultTile({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: "emerald" | "amber"
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          accent === "emerald" && "text-emerald-700 dark:text-emerald-500",
          accent === "amber" && "text-amber-700 dark:text-amber-500"
        )}
      >
        {value}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------

/**
 * The shared CSS-grid template that drives both the column header strip
 * and every command row. Defining it once means the labels always line
 * up with the values underneath, and changing column proportions is a
 * one-place edit. Columns: chevron · when · state · triggers · what ·
 * flow. The `what` column gets the largest fractional weight because
 * it's the operator's primary narrative.
 */
const COMMAND_GRID_COLS_XL =
  "xl:grid-cols-[28px_104px_136px_minmax(120px,1fr)_minmax(240px,2.4fr)_minmax(150px,auto)]"

function CommandTable({
  commands,
  nowMs,
}: {
  commands: LiveCommand[]
  nowMs: number | null
}) {
  return (
    <Card>
      <CardContent className="p-0">
        {/* Column header — only rendered at the `xl+` breakpoint where
            the row laid out as a single horizontal grid. Below that the
            row reflows into a stacked card and per-section labels live
            inline next to the values, which works much better than
            trying to keep a wide column header anchored to wrapping
            content. */}
        <div
          className={cn(
            "hidden xl:grid items-center gap-x-3 px-4 py-2 bg-muted/40 border-b text-[10px] uppercase tracking-wider font-medium text-muted-foreground",
            COMMAND_GRID_COLS_XL,
          )}
          role="presentation"
        >
          <span className="sr-only">Expand</span>
          <span>When</span>
          <span>State</span>
          <span>Triggers</span>
          <span>What it does</span>
          <span className="text-right">Site grid flow</span>
        </div>

        <ul role="list" className="divide-y">
          {commands.map((c, idx) => (
            <CommandGridRow
              key={c.id}
              cmd={c}
              nowMs={nowMs}
              isLatest={idx === 0}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/**
 * Intent badge — the at-a-glance "what does this command do" pill used in
 * the table and impact panels. Tone follows the import / export / hold
 * direction so the column scans like a heatmap.
 */
function IntentBadge({ impact }: { impact: CommandImpact }) {
  const Icon =
    impact.tone.direction === "import"
      ? ArrowDown
      : impact.tone.direction === "export"
      ? ArrowUp
      : Minus
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 text-[10px] font-medium whitespace-nowrap",
        impact.tone.bg,
        impact.tone.text,
        impact.tone.border
      )}
    >
      <Icon className="size-3" aria-hidden />
      {impact.intentLabel}
    </Badge>
  )
}

/**
 * Signed grid-flow readout. Positive = import (sky), negative = export
 * (emerald), zero = muted. Used in the table and the impact panels so a
 * scanner can read direction off the colour alone.
 */
function SignedFlow({ w, size = "sm" }: { w: number; size?: "sm" | "lg" }) {
  const isImport = w > 1_000
  const isExport = w < -1_000
  const cls = isImport
    ? "text-sky-700 dark:text-sky-400"
    : isExport
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-muted-foreground"
  return (
    <span
      className={cn(
        "inline-flex items-center justify-end gap-1 font-mono tabular-nums",
        cls,
        size === "lg" ? "text-base font-semibold" : "text-xs"
      )}
    >
      {formatKw(w)}
    </span>
  )
}

/**
 * Single command row — a CSS Grid card that morphs between two layouts:
 *
 *   • `< xl` (mobile / tablet) — three columns: a chevron rail on the
 *     left, the row's main content stack in the middle, and the site
 *     grid flow pinned top-right. State, triggers, and the wrapped
 *     "what it does" narrative each get their own row so they can
 *     breathe at any width without horizontal scroll.
 *
 *   • `xl+` (desktop) — six columns laid out edge-to-edge in a single
 *     horizontal row, lining up perfectly with the column header strip
 *     above the list.
 *
 * Same DOM, same data, no duplication — `grid-template-areas` reorders
 * the cells purely in CSS. Tiny on-screen labels (When · State ·
 * Triggers · …) live inside each cell and only show below `xl`,
 * standing in for the column header that's hidden in the stacked
 * layout.
 */
function CommandGridRow({
  cmd,
  nowMs,
  isLatest,
}: {
  cmd: LiveCommand
  nowMs: number | null
  isLatest: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const tone = statusTone(cmd.status)
  const impact = deriveCommandImpact(cmd)
  const [justArrived, setJustArrived] = useState(false)
  const idRef = useRef<string | null>(null)
  useEffect(() => {
    if (idRef.current !== cmd.id) {
      idRef.current = cmd.id
      if (isLatest) {
        setJustArrived(true)
        const t = setTimeout(() => setJustArrived(false), 1600)
        return () => clearTimeout(t)
      }
    }
  }, [cmd.id, isLatest])

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} command ${String(cmd.seq).padStart(3, "0")} details`}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
        className={cn(
          // ── Layout ─────────────────────────────────────────────────
          // Stacked card layout up to `xl`; horizontal grid at `xl+`.
          // Areas: chev (chevron), when, state, trig (triggers), what,
          // flow (site grid flow). Below xl every content area takes
          // the full content column so wrapped narrative never gets
          // squeezed; flow stays pinned top-right next to `when`.
          "group grid w-full cursor-pointer gap-x-3 gap-y-2 px-3 py-3 text-left transition-colors",
          "grid-cols-[28px_minmax(0,1fr)_auto]",
          "[grid-template-areas:'chev_when_flow''chev_state_state''chev_trig_trig''chev_what_what']",
          COMMAND_GRID_COLS_XL,
          "xl:items-start xl:gap-y-0 xl:[grid-template-areas:'chev_when_state_trig_what_flow']",
          // ── Interactive states ─────────────────────────────────────
          "hover:bg-muted/50 focus:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
          "shadow-[inset_2px_0_0_0_transparent] hover:shadow-[inset_2px_0_0_0_var(--color-border)]",
          (cmd.status === "pending" || cmd.status === "executing") &&
            "bg-amber-500/5",
          justArrived && "bg-emerald-500/10",
          isLatest && justArrived && "animate-row-in",
        )}
      >
        {/* ── Chevron rail ──────────────────────────────────────────── */}
        <div className="[grid-area:chev] flex items-start pt-0.5">
          <span
            aria-hidden
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors",
              "group-hover:border-primary/40 group-hover:bg-primary/10 group-hover:text-primary",
              expanded && "border-primary/40 bg-primary/10 text-primary",
            )}
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-150",
                expanded && "rotate-90",
              )}
            />
          </span>
        </div>

        {/* ── When · clock + seq + relative age ──────────────────────── */}
        <div className="[grid-area:when] min-w-0 font-mono tabular-nums">
          <div className="text-xs text-foreground whitespace-nowrap">
            {formatClock(cmd.issuedAt)}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            #{String(cmd.seq).padStart(3, "0")}
            {nowMs !== null && (
              <>
                <span className="mx-1 opacity-50">·</span>
                {formatRelative(cmd.issuedAt, nowMs)}
              </>
            )}
          </div>
        </div>

        {/* ── State · lifecycle badge + intent badge ─────────────────── */}
        <div className="[grid-area:state] min-w-0">
          <FieldLabel className="xl:hidden">State</FieldLabel>
          <div className="flex flex-wrap items-center gap-1">
            <Badge
              variant="outline"
              className={cn(
                "gap-1 text-[10px] font-mono",
                tone.bg,
                tone.text,
                tone.border,
              )}
            >
              <span
                className={cn(
                  "inline-block size-1.5 rounded-full",
                  tone.dot,
                  (cmd.status === "pending" ||
                    cmd.status === "executing") &&
                    "animate-pulse",
                )}
              />
              {tone.label}
            </Badge>
            <IntentBadge impact={impact} />
          </div>
        </div>

        {/* ── Triggers · existing wrap-friendly chip stack ───────────── */}
        <div className="[grid-area:trig] min-w-0">
          <FieldLabel className="xl:hidden">Triggers</FieldLabel>
          <div className="flex flex-wrap gap-1">
            {cmd.triggers.map((t) => (
              <TriggerChip key={t} t={t} />
            ))}
          </div>
        </div>

        {/* ── What it does · primary narrative, wraps freely ─────────── */}
        <div className="[grid-area:what] min-w-0">
          <FieldLabel className="xl:hidden">What it does</FieldLabel>
          <p className="text-[12px] leading-snug text-foreground text-pretty whitespace-normal">
            {impact.primaryEffect}
          </p>
          {cmd.gate_reason && (
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground/85 whitespace-normal">
              {cmd.gate_reason}
            </p>
          )}
        </div>

        {/* ── Site grid flow · big number + per-unit + perf subtext ──── */}
        <div className="[grid-area:flow] min-w-0 text-right font-mono tabular-nums">
          <SignedFlow w={impact.siteGridFlowW} />
          <div className="mt-0.5 text-[10px] text-muted-foreground/85 whitespace-nowrap">
            {formatPerUnitGrid(cmd)}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground/70 leading-snug">
            {cmd.ack_latency_ms !== undefined && (
              <>
                ack {cmd.ack_latency_ms}ms
                {cmd.exec_latency_s !== undefined && (
                  <>
                    <span className="mx-1 opacity-50">·</span>
                    exec {cmd.exec_latency_s}s
                  </>
                )}
              </>
            )}
            {cmd.result && (
              <>
                {cmd.ack_latency_ms !== undefined && (
                  <span className="mx-1 opacity-50">·</span>
                )}
                <span
                  className={cn(
                    cmd.status === "deviated" &&
                      "text-amber-700 dark:text-amber-500",
                    cmd.status === "executed" &&
                      "text-emerald-700 dark:text-emerald-500",
                  )}
                >
                  Δ {cmd.result.deviation_pct.toFixed(1)}%
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted/30 px-3 py-4 sm:px-4">
          <div className="mb-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
            Command #{String(cmd.seq).padStart(3, "0")} — details
          </div>
          <CommandDetailsTabs cmd={cmd} />
        </div>
      )}
    </li>
  )
}

/**
 * Tiny inline section label used inside stacked-layout cells (mobile /
 * tablet) to stand in for the desktop column header. Hidden at `xl+`
 * via the parent's `xl:hidden` class.
 */
function FieldLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "mb-1 text-[9px] uppercase tracking-wider font-medium text-muted-foreground/80",
        className,
      )}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Expanded details — shared by Cards and Table view (Tabs: Summary, Details, RAW JSON)
// ---------------------------------------------------------------------------

/**
 * Three-tab presentation of an expanded command. Summary is the focused
 * default — the optimizer's narrative + setpoint diff vs. the previous
 * command. Details = the polished full-payload visual layout. RAW JSON =
 * the canonical wire payload for engineers debugging integrations.
 */
function CommandDetailsTabs({ cmd }: { cmd: LiveCommand }) {
  return (
    <Tabs defaultValue="summary" className="w-full">
      <TabsList className="grid w-full max-w-md grid-cols-3 h-9">
        <TabsTrigger value="summary" className="text-xs gap-1.5">
          <Sparkles className="size-3.5" />
          Summary
        </TabsTrigger>
        <TabsTrigger value="details" className="text-xs gap-1.5">
          <LayoutGrid className="size-3.5" />
          Details
        </TabsTrigger>
        <TabsTrigger value="raw" className="text-xs gap-1.5">
          <Braces className="size-3.5" />
          RAW JSON
        </TabsTrigger>
      </TabsList>
      <TabsContent value="summary" className="mt-3 focus-visible:outline-none">
        <CommandDetailsSummary cmd={cmd} />
      </TabsContent>
      <TabsContent value="details" className="mt-3 focus-visible:outline-none">
        <CommandDetailsVisual cmd={cmd} />
      </TabsContent>
      <TabsContent value="raw" className="mt-3 focus-visible:outline-none">
        <CommandDetailsRaw cmd={cmd} />
      </TabsContent>
    </Tabs>
  )
}

/**
 * Summary view — answers "what changed and why?" by visualizing the
 * diff between this command's setpoints and the previous command's
 * setpoints, alongside the optimizer's gate reason and trigger badges.
 */
function CommandDetailsSummary({ cmd }: { cmd: LiveCommand }) {
  const diffs = diffSetpoints(cmd.prev_request, cmd.request)
  const isBaseline = !cmd.prev_request
  const impact = deriveCommandImpact(cmd)

  return (
    <div className="space-y-3">
      {/* What this command does — leads, because the headline answer is
          "what physical effect does this dispatch have on the site?" */}
      <div className="rounded-md border bg-card px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            What this command does
          </span>
          <IntentBadge impact={impact} />
        </div>
        <p className="text-sm leading-relaxed text-foreground text-pretty">
          {impact.primaryEffect}
        </p>
        {impact.secondaryEffect && (
          <p className="mt-1 text-[12px] text-muted-foreground leading-snug">
            {impact.secondaryEffect}
          </p>
        )}
        {/* Three-up effect breakdown */}
        <div className="mt-3 grid gap-2 grid-cols-1 sm:grid-cols-3">
          <ImpactTile
            label="Site grid flow"
            sublabel={
              impact.siteGridFlowW > 1_000
                ? "import from grid"
                : impact.siteGridFlowW < -1_000
                ? "export to grid"
                : "no grid flow"
            }
          >
            <SignedFlow w={impact.siteGridFlowW} size="lg" />
          </ImpactTile>
          <ImpactTile label="BESS effect" sublabel={bessEffectSublabel(impact)}>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-base font-semibold",
                bessEffectColor(impact)
              )}
            >
              <BatteryCharging className="size-4" aria-hidden />
              {bessEffectLabel(impact)}
            </span>
          </ImpactTile>
          <ImpactTile
            label="EV connectors"
            sublabel={
              impact.plugCount === 0
                ? "no connectors plugged"
                : `${impact.plugCount} plugged · BESS-buffered`
            }
          >
            <span className="inline-flex items-center gap-1.5 text-base font-semibold">
              <PlugZap
                className={cn(
                  "size-4",
                  impact.plugCount > 0 ? "text-violet-600" : "text-muted-foreground"
                )}
                aria-hidden
              />
              {impact.plugCount === 0
                ? "Idle"
                : `${cmd.request.metadata.ev_active_c1 ? "C1" : ""}${
                    cmd.request.metadata.ev_active_c1 && cmd.request.metadata.ev_active_c2
                      ? " + C2"
                      : cmd.request.metadata.ev_active_c2
                      ? "C2"
                      : ""
                  }`}
            </span>
          </ImpactTile>
        </div>
      </div>

      {/* Why issued — the optimizer's narrative */}
      <div className="rounded-md border bg-card px-3.5 py-3">
        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Why this command was issued
          </span>
        </div>
        <p className="text-sm leading-relaxed text-foreground">
          {cmd.gate_reason}
        </p>
        {/* Trigger chips — what observed-state change drove the dispatch */}
        {cmd.triggers.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Triggers
            </span>
            {cmd.triggers.map((t) => (
              <SummaryTriggerChip key={t} trigger={t} />
            ))}
          </div>
        )}
      </div>

      {/* Diff vs previous command */}
      <div className="rounded-md border bg-card px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            What changed vs. previous command
          </span>
          {!isBaseline && (
            <span className="text-[11px] text-muted-foreground font-mono">
              {diffs.length === 0
                ? "no setpoint deltas"
                : `${diffs.length} field${diffs.length === 1 ? "" : "s"} changed`}
            </span>
          )}
        </div>
        {isBaseline ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Baseline command.</strong>{" "}
            This is the first dispatch in the current session — there is no
            prior command to diff against. Subsequent rows will show the
            field-level deltas relative to this one.
          </p>
        ) : diffs.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            All setpoints match the previous command. This is a{" "}
            <strong className="text-foreground">periodic refresh</strong> —
            Middleware re-asserts the active envelope so the watchdog stays
            healthy and integrators get a heartbeat.
          </p>
        ) : (
          <div className="space-y-1.5">
            {diffs.map((d, i) => (
              <DiffRow key={`${d.field}-${i}`} diff={d} />
            ))}
          </div>
        )}
      </div>

      {/* Latency + result snapshot */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <SummaryStat
          label="Status"
          value={cmd.status}
          tone={
            cmd.status === "executed"
              ? "emerald"
              : cmd.status === "deviated"
              ? "amber"
              : cmd.status === "rejected"
              ? "rose"
              : "muted"
          }
        />
        <SummaryStat
          label="Ack latency"
          value={cmd.ack_latency_ms !== undefined ? `${cmd.ack_latency_ms} ms` : "—"}
          mono
        />
        <SummaryStat
          label="Exec latency"
          value={cmd.exec_latency_s !== undefined ? `${cmd.exec_latency_s} s` : "—"}
          mono
        />
        <SummaryStat
          label="Deviation"
          value={
            cmd.result
              ? `${cmd.result.deviation_pct.toFixed(1)}%`
              : "—"
          }
          tone={
            cmd.result && cmd.result.deviation_pct > 12 ? "amber" : "muted"
          }
          mono
        />
      </div>
    </div>
  )
}

/**
 * One row in the diff list: field name, "before", arrow, "after",
 * tinted by the diff's kind (tightens / loosens / flips / set).
 */
function DiffRow({ diff }: { diff: SetpointDiff }) {
  const kindColor: Record<SetpointDiff["kind"], string> = {
    tightens: "text-amber-700 dark:text-amber-500 bg-amber-500/10 ring-amber-500/20",
    loosens: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
    flips: "text-violet-700 dark:text-violet-400 bg-violet-500/10 ring-violet-500/20",
    set: "text-sky-700 dark:text-sky-400 bg-sky-500/10 ring-sky-500/20",
  }
  const kindLabel: Record<SetpointDiff["kind"], string> = {
    tightens: "tighter",
    loosens: "looser",
    flips: "flipped",
    set: "set",
  }
  return (
    <div className="flex items-center gap-2 text-[12px] flex-wrap">
      <span className="font-mono text-muted-foreground min-w-[8.5rem] shrink-0">
        {diff.field}
      </span>
      <span className="font-mono tabular-nums text-muted-foreground line-through decoration-muted-foreground/50">
        {diff.from}
      </span>
      <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
      <span className="font-mono tabular-nums font-semibold text-foreground">
        {diff.to}
      </span>
      <span
        className={cn(
          "ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1",
          kindColor[diff.kind]
        )}
      >
        {kindLabel[diff.kind]}
      </span>
    </div>
  )
}

/**
 * Color-coded chip for a single dispatch trigger. Reuses the same tone
 * vocabulary as the trigger legend in the explainer header.
 */
function SummaryTriggerChip({ trigger }: { trigger: DispatchTrigger }) {
  const kind = triggerKind(trigger)
  const tone =
    kind === "ev"
      ? "text-violet-700 dark:text-violet-400 bg-violet-500/10 ring-violet-500/20"
      : kind === "price"
      ? "text-amber-700 dark:text-amber-500 bg-amber-500/10 ring-amber-500/20"
      : kind === "soc"
      ? "text-sky-700 dark:text-sky-400 bg-sky-500/10 ring-sky-500/20"
      : "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 ring-emerald-500/20"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
        tone
      )}
    >
      {triggerLabel(trigger)}
    </span>
  )
}

/**
 * Compact KPI tile used in the summary footer row.
 */
function SummaryStat({
  label,
  value,
  mono,
  tone,
}: {
  label: string
  value: string
  mono?: boolean
  tone?: "emerald" | "amber" | "rose" | "muted"
}) {
  const toneCls =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "amber"
      ? "text-amber-700 dark:text-amber-500"
      : tone === "rose"
      ? "text-rose-700 dark:text-rose-400"
      : "text-foreground"
  return (
    <div className="rounded-md border bg-card px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold capitalize",
          mono && "font-mono tabular-nums normal-case",
          toneCls
        )}
      >
        {value}
      </div>
    </div>
  )
}

/**
 * Polished, scannable layout for the full command payload. Split into
 * three rows: Request → Station, Request → Chargers, Result + Latencies.
 * Designed so an integrator can read the dispatch the same way they'd
 * read the wire — but at a glance.
 */
function CommandDetailsVisual({ cmd }: { cmd: LiveCommand }) {
  const r = cmd.request
  const impact = deriveCommandImpact(cmd)
  return (
    <div className="space-y-3">
      {/* Identity strip */}
      <div className="rounded-md border bg-muted/30 px-3 py-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
        <DetailKV label="Command id" mono value={cmd.id} />
        <DetailKV label="Sequence" mono value={`#${String(cmd.seq).padStart(4, "0")}`} />
        <DetailKV
          label="Issued"
          mono
          value={new Date(cmd.issuedAt).toISOString().replace("T", " ").slice(0, 19) + "Z"}
        />
      </div>

      {/* What it affects — primary view */}
      <DetailGroup
        title="What it affects"
        subtitle="Physical effect of this dispatch on grid, BESS, and EV connectors"
      >
        <div className="rounded-md border bg-card px-3 py-2.5 mb-2">
          <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold">{impact.primaryEffect}</span>
            <IntentBadge impact={impact} />
          </div>
          {impact.secondaryEffect && (
            <p className="text-[11px] text-muted-foreground leading-snug">
              {impact.secondaryEffect}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <ImpactTile
            label="Site grid flow"
            sublabel={
              impact.siteGridFlowW > 1_000
                ? "import from grid"
                : impact.siteGridFlowW < -1_000
                ? "export to grid"
                : "no grid flow"
            }
          >
            <SignedFlow w={impact.siteGridFlowW} size="lg" />
          </ImpactTile>
          <ImpactTile label="BESS effect" sublabel={bessEffectSublabel(impact)}>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-base font-semibold",
                bessEffectColor(impact)
              )}
            >
              <BatteryCharging className="size-4" aria-hidden />
              {bessEffectLabel(impact)}
            </span>
          </ImpactTile>
          <ImpactTile
            label="EV connectors"
            sublabel={
              impact.plugCount === 0
                ? "no connectors plugged"
                : `${impact.plugCount} plugged · BESS-buffered`
            }
          >
            <span className="inline-flex items-center gap-1.5 text-base font-semibold">
              <PlugZap
                className={cn(
                  "size-4",
                  impact.plugCount > 0 ? "text-violet-600" : "text-muted-foreground"
                )}
                aria-hidden
              />
              {impact.plugCount === 0
                ? "Idle"
                : `${r.metadata.ev_active_c1 ? "C1" : ""}${
                    r.metadata.ev_active_c1 && r.metadata.ev_active_c2
                      ? " + C2"
                      : r.metadata.ev_active_c2
                      ? "C2"
                      : ""
                  }`}
            </span>
          </ImpactTile>
        </div>
      </DetailGroup>

      {/* Per-unit dispatch — the only volatile field on the wire */}
      <DetailGroup
        title="Dispatch payload"
        subtitle="The only field this command writes is per-unit P_grid_request_w"
      >
        <div className="grid gap-2.5 md:grid-cols-2">
          {r.chargers.map((c) => (
            <div
              key={c.unit_id}
              className="rounded-md border bg-card px-3 py-2.5"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">
                  C{c.unit_id} ·{" "}
                  <span className="font-normal text-muted-foreground">
                    {c.unit_id === 1
                      ? r.metadata.ev_active_c1
                        ? "EV connected"
                        : "idle"
                      : r.metadata.ev_active_c2
                      ? "EV connected"
                      : "idle"}
                  </span>
                </span>
                <Badge variant="outline" className="text-[10px] font-mono">
                  unit_id {c.unit_id}
                </Badge>
              </div>
              <DetailKV
                label="P_grid_request_w"
                mono
                signed
                value={formatKw(c.P_grid_request_w)}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground leading-snug">
                {c.P_grid_request_w > 1_000
                  ? "Pulls power from the grid into this unit (BESS top-up + EV serve)."
                  : c.P_grid_request_w < -1_000
                  ? "Pushes power from this unit to the grid (BESS export)."
                  : "Holds at zero — this unit neither imports nor exports."}
              </p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug mt-1">
          Other site fields ({" "}
          <code className="text-[11px]">P_grid_clearance_w</code>,{" "}
          <code className="text-[11px]">grid_mgmt_mode</code>,{" "}
          <code className="text-[11px]">P_ev_limit_w</code>, charging mode) are
          commissioning-time configuration on{" "}
          <code className="text-[11px]">/site/config</code> and never travel on
          a dispatch.
        </p>
      </DetailGroup>

      {/* Site state at issue time — context, not setpoints */}
      <DetailGroup
        title="Site state at issue time"
        subtitle="The observed snapshot the optimizer reasoned over for this dispatch"
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <DetailField
            label="Price zone"
            value={`${r.metadata.price_zone} · €${r.metadata.price_eur_mwh}/MWh`}
          />
          <DetailField
            label="Pack SOC"
            value={`${r.metadata.pack_soc_pct}%`}
            mono
          />
          <DetailField
            label="C1 plug"
            value={r.metadata.ev_active_c1 ? "EV connected" : "idle"}
          />
          <DetailField
            label="C2 plug"
            value={r.metadata.ev_active_c2 ? "EV connected" : "idle"}
          />
        </div>
      </DetailGroup>

      {/* Result + latencies */}
      <DetailGroup
        title="Execution result"
        subtitle="Site response observed by Middleware after the setpoint window closed"
      >
        {cmd.result ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <DetailField
              label="Commanded"
              value={formatKw(cmd.result.commanded_P_grid_w)}
              mono
            />
            <DetailField
              label="Actual"
              value={formatKw(cmd.result.actual_P_grid_w)}
              mono
              accent={cmd.status === "deviated" ? "amber" : undefined}
            />
            <DetailField
              label="Deviation"
              value={`${cmd.result.deviation_pct.toFixed(1)}%`}
              mono
              accent={cmd.result.deviation_pct > 12 ? "amber" : "emerald"}
            />
            <DetailField
              label="Ack / exec latency"
              value={`${cmd.ack_latency_ms ?? "—"} ms / ${
                cmd.exec_latency_s ?? "—"
              } s`}
              mono
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Awaiting execution feedback — status loop still in flight.
          </p>
        )}
        {cmd.result?.note && (
          <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-500 flex items-center gap-1.5">
            <CircleAlert className="size-3.5" />
            {cmd.result.note}
          </p>
        )}
      </DetailGroup>
    </div>
  )
}

function DetailGroup({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-foreground">
          {title}
        </span>
        {subtitle && (
          <span className="text-[11px] text-muted-foreground truncate">
            · {subtitle}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function DetailField({
  label,
  value,
  mono,
  accent,
}: {
  label: string
  value: string
  mono?: boolean
  accent?: "emerald" | "amber"
}) {
  const accentColor =
    accent === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : accent === "amber"
      ? "text-amber-700 dark:text-amber-500"
      : "text-foreground"
  return (
    <div className="rounded-md border bg-card px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold",
          mono && "font-mono tabular-nums",
          accentColor
        )}
      >
        {value}
      </div>
    </div>
  )
}

function DetailKV({
  label,
  value,
  mono,
  signed,
}: {
  label: string
  value: string
  mono?: boolean
  signed?: boolean
}) {
  const signedColor =
    signed && value.trim().startsWith("+")
      ? "text-sky-700 dark:text-sky-400"
      : signed && value.trim().startsWith("-")
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-foreground"
  return (
    <div className="min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div
        className={cn(
          "text-[12px] font-medium truncate",
          mono && "font-mono tabular-nums",
          signedColor
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

function CommandDetailsRaw({ cmd }: { cmd: LiveCommand }) {
  const payload = {
    command_id: cmd.id,
    seq: cmd.seq,
    timestamp: new Date(cmd.issuedAt).toISOString(),
    triggers: cmd.triggers,
    status: cmd.status,
    ack_latency_ms: cmd.ack_latency_ms,
    exec_latency_s: cmd.exec_latency_s,
    gate_reason: cmd.gate_reason,
    request: cmd.request,
    result: cmd.result,
  }
  return (
    <pre className="rounded-md bg-muted/60 p-3 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-[480px] overflow-y-auto">
      {JSON.stringify(payload, null, 2)}
    </pre>
  )
}

// ---------------------------------------------------------------------------
// (No default export — the matching route page imports the named symbol)
// ---------------------------------------------------------------------------
