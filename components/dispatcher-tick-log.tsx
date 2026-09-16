"use client"

import { Fragment, useMemo, useState } from "react"
import {
  Timer,
  Send,
  Lock,
  Pause,
  SkipForward,
  TriangleAlert,
  Monitor,
  Server,
  RefreshCw,
  ChevronRight,
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
import { PlanInputDetail, PlanOutputDetail } from "@/components/dispatch-plan"
import type { ReplanLogEntry, TickLogEntry } from "@/lib/dispatcher-status"

/**
 * TICK LOGGER — the steady-cadence counterpart to the replan history.
 * ────────────────────────────────────────────────────────────────────────
 * The replan history shows event-driven re-solves; this shows EVERY call to
 * /api/dispatcher/tick (the regular pinger endpoint), including the no-ops
 * (locked by another pinger, cooldown spacing, stopped). For each call it shows
 * WHEN it fired, WHO pinged, the OUTCOME, and — when it actually commanded —
 * the OUTPUT setpoint, exactly as the plan-API replan rows visualise their
 * committed command. In Automatic mode the commanded value is the ACTUAL
 * grid-import setpoint (P_grid_request — 0 when idle/discharging, the planned
 * import when charging from grid), NOT the fixed P_grid_clearance envelope;
 * columns also show the reserve floor and the SOC charge ceiling (soc_cp_max).
 */

const INITIAL_ROWS = 12

const OUTCOME_META: Record<
  TickLogEntry["outcome"],
  { label: string; icon: typeof Send; className: string; dot: string }
> = {
  dispatched: {
    label: "Dispatched",
    icon: Send,
    className: "border-emerald-500/40 text-emerald-600",
    dot: "bg-emerald-500",
  },
  skipped: {
    label: "Skipped",
    icon: SkipForward,
    className: "border-amber-500/40 text-amber-600",
    dot: "bg-amber-400",
  },
  locked: {
    label: "Locked",
    icon: Lock,
    className: "border-sky-500/40 text-sky-600",
    dot: "bg-sky-400",
  },
  stopped: {
    label: "Stopped",
    icon: Pause,
    className: "border-muted-foreground/30 text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
  error: {
    label: "Error",
    icon: TriangleAlert,
    className: "border-red-500/40 text-red-600",
    dot: "bg-red-500",
  },
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function fmtAgo(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return "just now"
  const m = Math.round(d / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, "0")}m ago`
}

/**
 * Adapt a TickLogEntry into the ReplanLogEntry shape the shared PlanOutputDetail
 * renders, so a dispatched tick's drill-down matches the replan history exactly.
 */
function toOutputEntry(r: TickLogEntry): ReplanLogEntry {
  const snap = r.snapshot
  return {
    solvedAt: snap?.solvedAt ?? r.at,
    eventType: snap?.eventType,
    trigger: r.source ?? undefined,
    status: snap?.status ?? "optimal",
    clearanceKw: snap?.clearanceKw ?? r.commandKw ?? 0,
    reserveFloorStep1Pct: r.reserveFloorPct ?? snap?.reserveFloorStep1Pct ?? 0,
    objectiveEur: snap?.objectiveEur ?? null,
    horizonSteps: snap?.horizonSteps ?? snap?.steps.length ?? 0,
    commandW: r.commandW ?? null,
    commandKw: r.commandKw ?? null,
    dispatched: r.outcome === "dispatched",
    snapshot: snap,
  }
}

export function DispatcherTickLog({ tickLog }: { tickLog?: TickLogEntry[] }) {
  // Whole-panel collapse — collapsed by default to keep the status screen compact.
  const [panelOpen, setPanelOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [openRow, setOpenRow] = useState<number | null>(null)
  const rows = useMemo(() => tickLog ?? [], [tickLog])
  const visible = expanded ? rows : rows.slice(0, INITIAL_ROWS)

  // Headline counts across the loaded window (newest ~120 calls).
  const counts = useMemo(() => {
    const c = { dispatched: 0, skipped: 0, locked: 0, stopped: 0, error: 0 }
    for (const r of rows) c[r.outcome] += 1
    return c
  }, [rows])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                aria-expanded={panelOpen}
                className="flex items-center gap-2 text-left"
              >
                <ChevronRight
                  className={cn("size-4 text-muted-foreground transition-transform", panelOpen && "rotate-90")}
                />
                <Timer className="size-5 text-sky-500" />
                Tick logger
              </button>
              <Badge variant="secondary" className="ml-1 font-mono">
                {rows.length}
              </Badge>
            </CardTitle>
            <CardDescription>
              Every executed tick · steady{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/dispatcher/tick</code> cadence and event{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">/replan</code> calls · newest first · including
              cooldown/stopped skips. Click a dispatched row to drill into its Plan Input + Plan Output.
            </CardDescription>
          </div>
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {(Object.keys(OUTCOME_META) as TickLogEntry["outcome"][])
                .filter((k) => counts[k] > 0)
                .map((k) => {
                  const m = OUTCOME_META[k]
                  return (
                    <Badge key={k} variant="outline" className={cn("gap-1 font-mono text-xs", m.className)}>
                      <span className={cn("size-2 rounded-sm", m.dot)} />
                      {counts[k]} {m.label.toLowerCase()}
                    </Badge>
                  )
                })}
            </div>
          )}
        </div>
      </CardHeader>

      {panelOpen && (
      <CardContent>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No ticks logged yet. Keep this dashboard open or point a pinger at{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/dispatcher/tick</code> and each call will
            appear here.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[1%]" aria-label="Expand" />
                    <TableHead className="w-[1%] whitespace-nowrap">Time</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Grid import</TableHead>
                    <TableHead className="text-right">Reserve</TableHead>
                    <TableHead className="text-right">SOC ceiling</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r, i) => {
                    const m = OUTCOME_META[r.outcome]
                    const Icon = m.icon
                    const dispatched = r.outcome === "dispatched"
                    const canExpand = dispatched && !!r.snapshot
                    const isOpen = openRow === i
                    return (
                      <Fragment key={`${r.at}-${i}`}>
                      <TableRow
                        className={cn(canExpand && "cursor-pointer hover:bg-muted/40", isOpen && "bg-muted/30")}
                        onClick={canExpand ? () => setOpenRow(isOpen ? null : i) : undefined}
                      >
                        <TableCell className="w-[1%] pr-0">
                          {canExpand ? (
                            <ChevronRight
                              className={cn(
                                "size-4 text-muted-foreground transition-transform",
                                isOpen && "rotate-90",
                              )}
                            />
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          <div>{fmtTime(r.at)}</div>
                          <div className="text-[10px] text-muted-foreground">{fmtAgo(r.at)}</div>
                        </TableCell>
                        <TableCell className="max-w-[12rem]">
                          <span className="flex items-center gap-1.5 text-xs">
                            {r.sourceKind === "external" ? (
                              <Server className="size-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <Monitor className="size-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate">{r.source || "—"}</span>
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("gap-1 font-mono text-xs", m.className)}>
                            <Icon className="size-3" />
                            {m.label}
                          </Badge>
                          {r.subTicks > 1 && (
                            <span className="ml-1 text-[10px] text-muted-foreground">×{r.subTicks}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {dispatched && r.commandKw != null ? (
                            <span className="font-medium text-foreground">{r.commandKw.toFixed(1)} kW</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {dispatched && r.reserveFloorPct != null ? (
                            `${r.reserveFloorPct.toFixed(0)}%`
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {dispatched && r.socCeilingPct != null ? (
                            `${r.socCeilingPct.toFixed(0)}%`
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[16rem]">
                          <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                            {dispatched && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "font-mono text-[10px]",
                                  r.mpcOk
                                    ? "border-emerald-500/40 text-emerald-600"
                                    : "border-amber-500/40 text-amber-600",
                                )}
                              >
                                {r.mpcOk ? "Optimizer" : "SAFE fallback"}
                              </Badge>
                            )}
                            {r.wasReplan && (
                              <Badge variant="outline" className="gap-0.5 font-mono text-[10px] border-primary/40 text-primary">
                                <RefreshCw className="size-2.5" />
                                replan
                              </Badge>
                            )}
                            {!dispatched && <span className="truncate">{r.reason || "—"}</span>}
                          </span>
                        </TableCell>
                      </TableRow>
                      {canExpand && isOpen && r.snapshot && (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={8} className="px-3 py-3">
                            <div className="grid gap-3 lg:grid-cols-2">
                              <PlanInputDetail snapshot={r.snapshot} />
                              <PlanOutputDetail entry={toOutputEntry(r)} />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {rows.length > INITIAL_ROWS && (
              <div className="mt-3 flex justify-center">
                <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "Show fewer" : `Show all ${rows.length}`}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
      )}
    </Card>
  )
}
