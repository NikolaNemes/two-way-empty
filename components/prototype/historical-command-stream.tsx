"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BatteryCharging,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Minus,
  PlugZap,
  Zap,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import {
  advanceCommandStatus,
  buildCommand,
  deriveCommandImpact,
  diffTriggers,
  formatClock,
  formatKw,
  formatRelative,
  observeFrame,
  priceZoneTone,
  resetCommandSeq,
  socBand,
  statusTone,
  triggerKind,
  triggerLabel,
  type CommandImpact,
  type DispatchTrigger,
  type LiveCommand,
  type ObservedState,
} from "@/lib/prototype-command-stream"

// ---------------------------------------------------------------------------
// Historical command stream hook — generates commands from replayed frames
// ---------------------------------------------------------------------------

function useHistoricalCommandStream(): {
  commands: LiveCommand[]
  nowMs: number | null
  totalCount: number
} {
  const { frame, historical, dataSource, historicalRange } = usePrototypeTelemetryContext()
  const [commands, setCommands] = useState<LiveCommand[]>([])
  const lastFrameTsRef = useRef<string | null>(null)
  const seededRef = useRef(false)

  // Reset when historical range changes
  useEffect(() => {
    if (dataSource === "historical") {
      setCommands([])
      resetCommandSeq()
      seededRef.current = false
      lastFrameTsRef.current = null
    }
  }, [dataSource, historicalRange.dayStart, historicalRange.dayEnd])

  // Generate commands from historical frames as they play
  useEffect(() => {
    if (!frame || dataSource !== "historical") return
    
    // Skip if we've already processed this frame
    if (lastFrameTsRef.current === frame.ts) return
    lastFrameTsRef.current = frame.ts

    const cur = observeFrame(frame)
    const issuedAt = new Date(frame.ts).getTime()

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
      const advanced = prev.map((c) => advanceCommandStatus(c, issuedAt, frame))
      const prevAccepted = advanced.find((c) => c.status !== "pending")

      if (triggers.length > 0) {
        const newCmd = buildCommand({
          issuedAt,
          triggers,
          cur,
          prev: prevAccepted,
        })
        return [newCmd, ...advanced]
      }

      return advanced
    })
  }, [frame, dataSource])

  const nowMs = frame ? new Date(frame.ts).getTime() : null

  return {
    commands,
    nowMs,
    totalCount: commands.length,
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HistoricalCommandStream() {
  const stream = useHistoricalCommandStream()
  const [expanded, setExpanded] = useState(true)

  if (stream.commands.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="size-4 text-muted-foreground" />
            Dispatch Commands
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <p className="text-sm text-muted-foreground">
            No commands dispatched yet. Play the historical timeline to see
            commands generated as EV plug events, price zone transitions, or
            SOC threshold crossings occur.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/40 transition-colors rounded-t-lg"
          >
            <Zap className="size-4 text-primary" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold">
                Dispatch Commands
                <Badge variant="secondary" className="ml-2 text-xs">
                  {stream.totalCount}
                </Badge>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Commands dispatched during historical playback
              </p>
            </div>
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                expanded && "rotate-180"
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 max-h-[400px] overflow-y-auto">
            <div className="space-y-2">
              {stream.commands.slice(0, 50).map((cmd) => (
                <CommandRow key={cmd.id} cmd={cmd} nowMs={stream.nowMs} />
              ))}
              {stream.commands.length > 50 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  + {stream.commands.length - 50} more commands
                </p>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Command row — compact display for historical view
// ---------------------------------------------------------------------------

function CommandRow({
  cmd,
  nowMs,
}: {
  cmd: LiveCommand
  nowMs: number | null
}) {
  const [showDetails, setShowDetails] = useState(false)
  const tone = statusTone(cmd.status)
  const priceTone = priceZoneTone(cmd.request.metadata.price_zone)
  const impact = deriveCommandImpact(cmd)

  return (
    <div
      className={cn(
        "rounded-md border bg-card overflow-hidden",
        cmd.status === "deviated" && "border-l-2 border-l-amber-500",
        cmd.status === "rejected" && "border-l-2 border-l-red-500"
      )}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2 p-2.5 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setShowDetails(!showDetails)}
      >
        {/* Time */}
        <span className="text-[11px] font-mono tabular-nums text-muted-foreground w-14 shrink-0">
          {formatClock(cmd.issuedAt)}
        </span>

        {/* Status dot */}
        <span
          className={cn(
            "size-2 rounded-full shrink-0",
            tone.dot,
            (cmd.status === "pending" || cmd.status === "executing") &&
              "animate-pulse"
          )}
        />

        {/* Triggers */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
          {cmd.triggers.slice(0, 2).map((t) => (
            <TriggerBadge key={t} t={t} />
          ))}
          {cmd.triggers.length > 2 && (
            <span className="text-[10px] text-muted-foreground">
              +{cmd.triggers.length - 2}
            </span>
          )}
        </div>

        {/* Intent */}
        <IntentBadge impact={impact} />

        {/* Flow */}
        <span className="text-xs font-mono tabular-nums w-16 text-right shrink-0">
          <SignedFlow w={impact.siteGridFlowW} />
        </span>

        {/* Price zone */}
        <Badge
          variant="outline"
          className={cn(
            "text-[9px] px-1.5 py-0 h-5 shrink-0",
            priceTone.bg,
            priceTone.text,
            priceTone.border
          )}
        >
          €{cmd.request.metadata.price_eur_mwh}
        </Badge>

        <ChevronDown
          className={cn(
            "size-3 text-muted-foreground shrink-0 transition-transform",
            showDetails && "rotate-180"
          )}
        />
      </button>

      {showDetails && (
        <div className="px-2.5 pb-2.5 pt-0 border-t bg-muted/20">
          <div className="grid grid-cols-3 gap-2 mt-2">
            <DetailTile
              label="Site flow"
              value={formatKw(impact.siteGridFlowW)}
              icon={impact.siteGridFlowW > 0 ? ArrowDown : ArrowUp}
            />
            <DetailTile
              label="BESS"
              value={bessLabel(impact)}
              icon={BatteryCharging}
            />
            <DetailTile
              label="EVs"
              value={`${impact.plugCount} plugged`}
              icon={PlugZap}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Gate: </span>
            {cmd.gate_reason}
          </p>
          {nowMs && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {formatRelative(cmd.issuedAt, nowMs)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TriggerBadge({ t }: { t: DispatchTrigger }) {
  const kind = triggerKind(t)
  const config = {
    ev: { icon: PlugZap, color: "text-violet-600 bg-violet-500/10 border-violet-500/30" },
    price: { icon: DollarSign, color: "text-amber-600 bg-amber-500/10 border-amber-500/30" },
    soc: { icon: Activity, color: "text-sky-600 bg-sky-500/10 border-sky-500/30" },
    baseline: { icon: Zap, color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" },
  }[kind] ?? { icon: Zap, color: "text-muted-foreground bg-muted/50 border-border" }

  return (
    <Badge variant="outline" className={cn("gap-0.5 text-[9px] px-1.5 py-0 h-5", config.color)}>
      <config.icon className="size-2.5" />
      <span className="hidden sm:inline ml-0.5">{triggerLabel(t)}</span>
    </Badge>
  )
}

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
        "gap-1 text-[9px] px-1.5 py-0 h-5 font-medium shrink-0",
        impact.tone.bg,
        impact.tone.text,
        impact.tone.border
      )}
    >
      <Icon className="size-2.5" />
      <span className="hidden lg:inline">{impact.tone.direction}</span>
    </Badge>
  )
}

function SignedFlow({ w }: { w: number }) {
  const kw = Math.abs(w) / 1000
  const sign = w > 500 ? "+" : w < -500 ? "-" : ""
  const color =
    w > 500
      ? "text-sky-600 dark:text-sky-400"
      : w < -500
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-muted-foreground"
  return (
    <span className={cn("font-mono", color)}>
      {sign}
      {kw.toFixed(1)}
    </span>
  )
}

function DetailTile({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: typeof ArrowDown
}) {
  return (
    <div className="rounded border bg-card px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] text-muted-foreground uppercase tracking-wider">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="text-xs font-medium mt-0.5">{value}</div>
    </div>
  )
}

function bessLabel(impact: CommandImpact): string {
  switch (impact.intent) {
    case "bess_charge":
      return "Charging"
    case "bess_export":
    case "bess_serve_ev":
    case "mixed_serve_ev":
      return "Discharging"
    case "grid_serve_ev":
      return "Holding"
    case "idle":
      return "Idle"
  }
}
