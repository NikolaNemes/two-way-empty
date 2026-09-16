"use client"

import { useMemo, useState } from "react"
import {
  AlertTriangle,
  AlertOctagon,
  Info,
  Check,
  CheckCheck,
  ShieldCheck,
  Activity,
  Battery,
  PlugZap,
  Zap,
  Building2,
  Inbox,
  Clock,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty"
import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import { InfoHint } from "@/components/prototype/info-hint"
import { cn } from "@/lib/utils"
import type { Severity, TelemetryEvent } from "@/lib/prototype-telemetry"

type StatusFilter = "all" | "open" | "ack"
type SeverityFilter = Severity | "all"

// ----------------------------------------------------------------------------
// Visual metadata
// ----------------------------------------------------------------------------

const SEVERITY_META: Record<
  Severity,
  {
    label: string
    icon: typeof AlertTriangle
    badgeCls: string
    rowAccent: string
    iconCls: string
  }
> = {
  error: {
    label: "Error",
    icon: AlertOctagon,
    badgeCls: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
    rowAccent: "before:bg-red-500",
    iconCls: "text-red-600 dark:text-red-400",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    badgeCls:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    rowAccent: "before:bg-amber-500",
    iconCls: "text-amber-600 dark:text-amber-400",
  },
  info: {
    label: "Info",
    icon: Info,
    badgeCls:
      "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
    rowAccent: "before:bg-sky-500",
    iconCls: "text-sky-600 dark:text-sky-400",
  },
}

const SOURCE_META: Record<
  TelemetryEvent["source"],
  { label: string; icon: typeof Battery }
> = {
  battery_1: { label: "Battery 1", icon: Battery },
  battery_2: { label: "Battery 2", icon: Battery },
  charger_1: { label: "Connector 1", icon: PlugZap },
  charger_2: { label: "Connector 2", icon: PlugZap },
  grid: { label: "Grid", icon: Zap },
  station: { label: "Station", icon: Building2 },
}

// ----------------------------------------------------------------------------
// Screen
// ----------------------------------------------------------------------------

export function PrototypeTelemetryEventsScreen() {
  const { simulated, frame } = usePrototypeTelemetryContext()
  const { allEvents, ackEvent, ackAll } = simulated
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all")

  const filtered = useMemo(() => {
    return allEvents
      .filter((e) =>
        statusFilter === "all"
          ? true
          : statusFilter === "open"
            ? !e.acknowledged
            : e.acknowledged,
      )
      .filter((e) =>
        severityFilter === "all" ? true : e.severity === severityFilter,
      )
      .slice()
      .reverse()
  }, [allEvents, statusFilter, severityFilter])

  const counts = useMemo(() => {
    return {
      open: allEvents.filter((e) => !e.acknowledged).length,
      ack: allEvents.filter((e) => e.acknowledged).length,
      error: allEvents.filter((e) => e.severity === "error").length,
      warning: allEvents.filter((e) => e.severity === "warning").length,
      info: allEvents.filter((e) => e.severity === "info").length,
      total: allEvents.length,
    }
  }, [allEvents])

  // Derived: the "loudest" event still open (highest severity, most recent)
  const headlineEvent = useMemo<TelemetryEvent | null>(() => {
    const open = allEvents.filter((e) => !e.acknowledged)
    if (open.length === 0) return null
    const rank: Record<Severity, number> = { error: 3, warning: 2, info: 1 }
    return open.slice().sort(
      (a, b) =>
        rank[b.severity] - rank[a.severity] ||
        Date.parse(b.ts) - Date.parse(a.ts),
    )[0]
  }, [allEvents])

  const sessionStartTs = frame ? Math.max(0, frame.t_s) : 0
  const eventsPerMin =
    sessionStartTs > 0 ? (counts.total / sessionStartTs) * 60 : 0

  return (
    <>
      {/* ------------------------- HEADER CARD ------------------------- */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="text-lg font-semibold tracking-tight">
                  Event &amp; alarm log
                </h2>
                <Badge variant="outline" className="font-mono text-[10px]">
                  warnings[] + errors[]
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed text-pretty max-w-3xl">
                Operator&rsquo;s view onto everything Middleware emits while
                running. Each row is a real event from the live simulation
                &mdash; nothing here is pre-seeded &mdash; so an empty list
                literally means the site is healthy. Acknowledge an event to
                clear it from the active{" "}
                <code className="text-xs">station.warnings</code> /{" "}
                <code className="text-xs">station.errors</code> arrays.
              </p>
            </div>
          </div>

          {/* Three-column "how to read it" strip, same pattern as Time-series */}
          <div className="grid gap-4 border-t pt-4 sm:grid-cols-3">
            <NarrativeBlock
              title="Purpose"
              body="Audit trail for compliance, post-incident review, and operator hand-off. Every limit excursion, contactor anomaly and curtailment lands here with an ID and ISO timestamp matching the wire payload."
            />
            <NarrativeBlock
              title="How to use it"
              body="Filter by status to triage open issues, by severity to focus on errors first. Acknowledge once you&rsquo;ve handled it &mdash; the Snapshot banner and header chip update immediately."
            />
            <NarrativeBlock
              title="Watch for"
              body={
                <>
                  Repeated <code>EV_CURTAILED</code> &mdash; site is hitting
                  the import envelope. Repeated{" "}
                  <code>BATTERY_SOC_LOW</code> &mdash; arbitrage strategy
                  draining packs faster than they recover.
                </>
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ------------------------- KPI ROW ------------------------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label="Open"
          value={counts.open}
          icon={Inbox}
          tone={
            counts.error > 0
              ? "red"
              : counts.warning > 0 && counts.open > 0
                ? "amber"
                : "muted"
          }
          subtitle={
            counts.open === 0
              ? "all clear"
              : counts.open === 1
                ? "needs review"
                : "need review"
          }
        />
        <Kpi
          label="Acknowledged"
          value={counts.ack}
          icon={CheckCheck}
          tone="muted"
          subtitle="this session"
        />
        <Kpi
          label="Errors"
          value={counts.error}
          icon={AlertOctagon}
          tone={counts.error > 0 ? "red" : "muted"}
          subtitle="lifetime in run"
        />
        <Kpi
          label="Warnings"
          value={counts.warning}
          icon={AlertTriangle}
          tone={counts.warning > 0 ? "amber" : "muted"}
          subtitle={`~${eventsPerMin.toFixed(1)}/min total`}
        />
      </div>

      {/* ------------------------- HEADLINE ------------------------- */}
      {headlineEvent ? (
        <HeadlineBanner event={headlineEvent} onAck={() => ackEvent(headlineEvent.id)} />
      ) : counts.total > 0 ? (
        <HealthyBanner ackd={counts.ack} />
      ) : null}

      {/* ------------------------- TABLE ------------------------- */}
      <Card>
        <CardHeader className="gap-2 pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                Event timeline
                <InfoHint side="bottom">
                  <p className="font-medium mb-1">Columns</p>
                  <p>
                    <strong>Severity</strong>: error/warning/info.{" "}
                    <strong>Timestamp</strong>: ISO 8601 UTC at the moment the
                    event was emitted by Middleware.{" "}
                    <strong>Source</strong>: which subsystem raised it.{" "}
                    <strong>Code</strong>: stable machine identifier (use this
                    for runbooks). <strong>Message</strong>: human summary.
                  </p>
                </InfoHint>
              </CardTitle>
              <CardDescription className="text-xs">
                Showing{" "}
                <span className="font-mono text-foreground">
                  {filtered.length}
                </span>{" "}
                of{" "}
                <span className="font-mono text-foreground">
                  {counts.total}
                </span>{" "}
                entries
                {frame && (
                  <>
                    {" "}
                    &middot; last tick{" "}
                    <span className="font-mono text-foreground">
                      {frame.ts.split("T")[1].slice(0, 8)}Z
                    </span>
                  </>
                )}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                size="sm"
                value={statusFilter}
                onValueChange={(v) => v && setStatusFilter(v as StatusFilter)}
                variant="outline"
              >
                <ToggleGroupItem value="all" className="text-xs">
                  All
                  <span className="ml-1.5 font-mono text-muted-foreground">
                    {counts.total}
                  </span>
                </ToggleGroupItem>
                <ToggleGroupItem value="open" className="text-xs">
                  Open
                  <span className="ml-1.5 font-mono text-muted-foreground">
                    {counts.open}
                  </span>
                </ToggleGroupItem>
                <ToggleGroupItem value="ack" className="text-xs">
                  Ack&rsquo;d
                  <span className="ml-1.5 font-mono text-muted-foreground">
                    {counts.ack}
                  </span>
                </ToggleGroupItem>
              </ToggleGroup>
              <ToggleGroup
                type="single"
                size="sm"
                value={severityFilter}
                onValueChange={(v) =>
                  v && setSeverityFilter(v as SeverityFilter)
                }
                variant="outline"
              >
                <ToggleGroupItem value="all" className="text-xs">
                  Any
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="error"
                  className="text-xs text-red-600 dark:text-red-400 data-[state=on]:bg-red-500/10"
                >
                  <AlertOctagon className="size-3" />
                  {counts.error}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="warning"
                  className="text-xs text-amber-600 dark:text-amber-400 data-[state=on]:bg-amber-500/10"
                >
                  <AlertTriangle className="size-3" />
                  {counts.warning}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="info"
                  className="text-xs text-sky-600 dark:text-sky-400 data-[state=on]:bg-sky-500/10"
                >
                  <Info className="size-3" />
                  {counts.info}
                </ToggleGroupItem>
              </ToggleGroup>
              <Button
                variant="outline"
                size="sm"
                disabled={counts.open === 0}
                onClick={ackAll}
                className="gap-1.5"
              >
                <CheckCheck className="size-3.5" />
                Ack all
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia
                  variant="icon"
                  className={cn(
                    counts.total === 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground",
                  )}
                >
                  {counts.total === 0 ? (
                    <ShieldCheck className="size-5" />
                  ) : (
                    <Activity className="size-5" />
                  )}
                </EmptyMedia>
                <EmptyTitle>
                  {counts.total === 0
                    ? "Site is healthy"
                    : "No events match these filters"}
                </EmptyTitle>
                <EmptyDescription className="max-w-md">
                  {counts.total === 0 ? (
                    <>
                      Middleware emits events only on real transitions
                      (envelope-approach, low-SOC, contactor faults, EV
                      curtailment). Let the simulation run, or pick a more
                      demanding scenario from the header to push limits.
                    </>
                  ) : (
                    <>
                      Try widening the status or severity filter &mdash;
                      there are{" "}
                      <span className="font-medium text-foreground">
                        {counts.total}
                      </span>{" "}
                      events in this session that are simply hidden by the
                      current view.
                    </>
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[110px]">Severity</TableHead>
                    <TableHead className="w-[180px]">Timestamp</TableHead>
                    <TableHead className="w-[140px]">Source</TableHead>
                    <TableHead className="w-[170px]">Code</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="w-[100px] text-right">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((ev) => (
                    <EventRow
                      key={ev.id}
                      ev={ev}
                      onAck={() => ackEvent(ev.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function NarrativeBlock({
  title,
  body,
}: {
  title: string
  body: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      <p className="text-xs leading-relaxed text-foreground/80 text-pretty">
        {body}
      </p>
    </div>
  )
}

function Kpi({
  label,
  value,
  subtitle,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  subtitle: string
  icon: typeof AlertTriangle
  tone: "red" | "amber" | "muted"
}) {
  const toneCls =
    tone === "red"
      ? "text-red-600 dark:text-red-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground"
  const bgCls =
    tone === "red"
      ? "bg-red-500/10"
      : tone === "amber"
        ? "bg-amber-500/10"
        : "bg-muted"
  return (
    <div className="rounded-lg border bg-card p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-md",
            bgCls,
            toneCls,
          )}
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      <div
        className={cn(
          "mt-2 font-mono text-2xl font-semibold tabular-nums leading-none",
          toneCls,
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">{subtitle}</div>
    </div>
  )
}

function HeadlineBanner({
  event,
  onAck,
}: {
  event: TelemetryEvent
  onAck: () => void
}) {
  const meta = SEVERITY_META[event.severity]
  const Icon = meta.icon
  const SourceIcon = SOURCE_META[event.source].icon
  const isError = event.severity === "error"
  return (
    <div
      className={cn(
        "rounded-lg border p-4 flex flex-col gap-3 sm:flex-row sm:items-center",
        isError
          ? "border-red-500/40 bg-red-500/5"
          : "border-amber-500/40 bg-amber-500/5",
      )}
    >
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          isError
            ? "bg-red-500/15 text-red-600 dark:text-red-400"
            : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-semibold uppercase tracking-wider">
            Active {meta.label.toLowerCase()}
          </span>
          <span className="text-muted-foreground">&middot;</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <SourceIcon className="size-3" />
            {SOURCE_META[event.source].label}
          </span>
          <span className="text-muted-foreground">&middot;</span>
          <code className="text-[11px] text-foreground">{event.code}</code>
        </div>
        <p className="text-sm leading-snug text-pretty">{event.message}</p>
      </div>
      <Button size="sm" onClick={onAck} className="gap-1.5 sm:self-center">
        <Check className="size-3.5" />
        Acknowledge
      </Button>
    </div>
  )
}

function HealthyBanner({ ackd }: { ackd: number }) {
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <ShieldCheck className="size-5" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold">No active alarms</p>
        <p className="text-xs text-muted-foreground">
          {ackd > 0
            ? `All ${ackd} earlier event${ackd === 1 ? "" : "s"} from this session have been acknowledged.`
            : "Site is operating within all configured envelopes and per-unit limits."}
        </p>
      </div>
    </div>
  )
}

function EventRow({
  ev,
  onAck,
}: {
  ev: TelemetryEvent
  onAck: () => void
}) {
  const meta = SEVERITY_META[ev.severity]
  const Icon = meta.icon
  const sourceMeta = SOURCE_META[ev.source]
  const SourceIcon = sourceMeta.icon
  // 2026-04-29T14:33:21.000Z -> 14:33:21
  const time = ev.ts.split("T")[1]?.slice(0, 8) ?? ev.ts
  const date = ev.ts.split("T")[0]
  return (
    <TableRow
      className={cn(
        "relative",
        // left-edge severity rail
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
        meta.rowAccent,
        ev.acknowledged && "opacity-55",
      )}
    >
      <TableCell className="pl-4">
        <Badge
          variant="outline"
          className={cn(
            "gap-1 font-medium uppercase text-[10px] tracking-wide",
            meta.badgeCls,
          )}
        >
          <Icon className="size-3" />
          {meta.label}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-xs">
        <span className="text-foreground">{time}</span>
        <span className="ml-1 text-muted-foreground/70">Z</span>
        <div className="text-[10px] text-muted-foreground">{date}</div>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-xs">
          <SourceIcon
            className={cn("size-3.5 shrink-0", meta.iconCls)}
            aria-hidden="true"
          />
          {sourceMeta.label}
        </span>
      </TableCell>
      <TableCell>
        <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
          {ev.code}
        </code>
      </TableCell>
      <TableCell className="text-xs leading-relaxed">{ev.message}</TableCell>
      <TableCell className="text-right">
        {ev.acknowledged ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="size-3" />
            Ack&rsquo;d
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={onAck}
          >
            <Check className="size-3" />
            Ack
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}
