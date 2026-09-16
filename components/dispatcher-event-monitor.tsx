"use client"

import { useMemo } from "react"
import { Activity, CheckCircle2, XCircle, Zap, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ReplanLogEntry } from "@/lib/dispatcher-status"

/** Human label + ordering for the known replan triggers. */
const EVENT_META: Record<string, { label: string; hint: string }> = {
  manual: { label: "Manual", hint: "Operator pressed Replan now" },
  ev_plug_event: { label: "Car connect/disconnect", hint: "A vehicle plugged or unplugged" },
  connect: { label: "Car connect", hint: "A vehicle plugged in" },
  disconnect: { label: "Car disconnect", hint: "A vehicle unplugged" },
  idm: { label: "IDM divergence", hint: "Intraday price diverged from day-ahead" },
  price_update: { label: "Price update", hint: "New day-ahead/intraday prices landed" },
  soc_threshold: { label: "SOC threshold", hint: "Buffer SOC crossed a guard level" },
  safety: { label: "Safety interval", hint: "Periodic safety re-solve" },
  scheduled: { label: "Scheduled", hint: "Autonomous slot-rollover re-solve" },
  test: { label: "Liveness probe", hint: "Inert test command — no actuation" },
}

interface EventStat {
  key: string
  label: string
  hint: string
  count: number
  okCount: number
  failCount: number
  lastSolvedAt: number
  lastOk: boolean | null
  lastCommandKw: number | null
}

function ageLabel(ms: number): string {
  if (ms < 0) return "now"
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}

/**
 * EVENT TRIGGERS — the right monitor for an event/replan-driven dispatcher.
 *
 * Instead of asking "is it ticking fast enough?" (meaningless without a fixed
 * cadence), this aggregates the replan history by trigger and answers what
 * actually matters now: which triggers are firing, how often, and — critically —
 * what fraction of each trigger's replans successfully dispatched to Amperio.
 * A trigger with failing dispatches is the real failure mode, surfaced per type.
 */
export function DispatcherEventMonitor({ replanLog }: { replanLog: ReplanLogEntry[] }) {
  const { stats, totalFails } = useMemo(() => {
    const map = new Map<string, EventStat>()
    let totalFails = 0
    for (const e of replanLog) {
      const key = e.eventType ?? "scheduled"
      const meta = EVENT_META[key] ?? { label: key, hint: "" }
      const ok = e.status !== "error" && e.dispatched !== false
      if (!ok && !e.isTest) totalFails++
      const cur =
        map.get(key) ??
        ({
          key,
          label: meta.label,
          hint: meta.hint,
          count: 0,
          okCount: 0,
          failCount: 0,
          lastSolvedAt: 0,
          lastOk: null,
          lastCommandKw: null,
        } as EventStat)
      cur.count++
      if (ok) cur.okCount++
      else cur.failCount++
      if (e.solvedAt > cur.lastSolvedAt) {
        cur.lastSolvedAt = e.solvedAt
        cur.lastOk = e.isTest ? null : ok
        cur.lastCommandKw = e.commandKw ?? null
      }
      map.set(key, cur)
    }
    const stats = [...map.values()].sort((a, b) => b.lastSolvedAt - a.lastSolvedAt)
    return { stats, totalFails }
  }, [replanLog])

  const now = Date.now()

  return (
    <Card className={cn(totalFails > 0 && "border-amber-500/50")}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4" />
          Event triggers
          <Badge variant="outline" className="ml-1 font-mono text-muted-foreground">
            {stats.length} type{stats.length === 1 ? "" : "s"}
          </Badge>
          {totalFails > 0 && (
            <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600">
              <AlertTriangle className="size-3" />
              {totalFails} failed dispatch{totalFails === 1 ? "" : "es"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent>
        {stats.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No replans recorded yet. Triggers will appear here as the plan re-solves on events,
            price updates, or manual replans.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border text-sm">
            {stats.map((s) => {
              const rate = s.count > 0 ? Math.round((s.okCount / s.count) * 100) : 0
              const rateBad = s.failCount > 0
              return (
                <li key={s.key} className="flex items-start gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{s.label}</span>
                      {s.lastOk === false && (
                        <span className="shrink-0 text-[10px] text-red-600">last: failed</span>
                      )}
                    </div>
                    {s.hint && (
                      <p className="truncate text-[11px] text-muted-foreground">{s.hint}</p>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">last {ageLabel(now - s.lastSolvedAt)}</span>
                      {s.lastCommandKw != null && (
                        <span className="inline-flex items-center gap-0.5 tabular-nums">
                          <Zap className="size-3" />
                          {s.lastCommandKw.toFixed(1)} kW
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {s.count}×
                    </Badge>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-mono text-[10px] tabular-nums",
                        rateBad ? "text-amber-600" : "text-emerald-600",
                      )}
                    >
                      {rateBad ? <XCircle className="size-3" /> : <CheckCircle2 className="size-3" />}
                      {rate}% ok
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
