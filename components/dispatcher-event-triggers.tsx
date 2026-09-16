"use client"

import { useMemo } from "react"
import { Webhook, CheckCircle2, XCircle, CircleSlash, Clock } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ReplanLogEntry } from "@/lib/dispatcher-status"

/** Human label for each known trigger source. */
const TRIGGER_LABEL: Record<string, string> = {
  manual: "Manual replan",
  price_update: "Price update",
  ev_plug_event: "EV plug / unplug",
  soc_threshold: "SoC threshold",
  idm_divergence: "IDM divergence",
  safety_interval: "Safety interval",
  slot_rollover: "Slot rollover",
}

interface TriggerStat {
  key: string
  label: string
  total: number
  dispatched: number
  failed: number
  /** optimal / infeasible / error breakdown of the most recent solve. */
  lastStatus: ReplanLogEntry["status"]
  lastAt: number
  lastDispatched: boolean | null
}

function ageLabel(ms: number): string {
  if (ms < 0) return "now"
  const s = Math.round(ms / 1000)
  if (s < 90) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 90) return `${m}m ago`
  return `${(m / 60).toFixed(1)}h ago`
}

/**
 * EVENT TRIGGERS — the primary monitor for the replan-driven dispatcher.
 * ────────────────────────────────────────────────────────────────────────
 * Dispatch is no longer a fixed tick loop: every command is the result of a
 * discrete trigger firing a replan. This card aggregates the replan log by
 * trigger type so an operator can answer the questions that actually matter
 * now: which triggers are firing, how often, and — critically — what fraction
 * of them successfully reached Amperio. A trigger with failed dispatches is the
 * direct successor to the old "over-frequency" alarm.
 */
export function DispatcherEventTriggers({ replanLog }: { replanLog: ReplanLogEntry[] | undefined }) {
  const { stats, totals } = useMemo(() => {
    const log = replanLog ?? []
    const byKey = new Map<string, TriggerStat>()
    let total = 0
    let failed = 0

    for (const e of log) {
      if (e.isTest) continue
      total += 1
      const key = e.eventType ?? "scheduled"
      const ok = e.dispatched === true
      if (!ok) failed += 1
      const existing = byKey.get(key)
      if (existing) {
        existing.total += 1
        if (ok) existing.dispatched += 1
        else existing.failed += 1
        // Log is newest-first, so the first row we see for a key is the latest.
      } else {
        byKey.set(key, {
          key,
          label: TRIGGER_LABEL[key] ?? (key === "scheduled" ? "Scheduled" : key),
          total: 1,
          dispatched: ok ? 1 : 0,
          failed: ok ? 0 : 1,
          lastStatus: e.status,
          lastAt: e.solvedAt,
          lastDispatched: e.isTest ? null : e.dispatched ?? null,
        })
      }
    }

    const stats = [...byKey.values()].sort((a, b) => b.lastAt - a.lastAt)
    return { stats, totals: { total, failed } }
  }, [replanLog])

  const anyFailures = totals.failed > 0

  return (
    <Card className={cn(anyFailures && "border-amber-500/50")}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Webhook className="size-4" />
          Event triggers
          <Badge variant="outline" className="ml-1 font-mono">
            {totals.total} replans
          </Badge>
          {anyFailures && (
            <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600">
              <XCircle className="size-3" />
              {totals.failed} dispatch{totals.failed === 1 ? "" : "es"} failed
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          What fired each replan and whether the resulting command reached Amperio. Dispatch is
          event-driven, so a trigger with failed dispatches — not tick cadence — is the real alarm.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {stats.length === 0 ? (
          <p className="text-xs text-muted-foreground">No replans recorded yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border text-sm">
            {stats.map((s) => {
              const rate = s.total > 0 ? Math.round((s.dispatched / s.total) * 100) : 0
              const rateTone =
                rate === 100 ? "text-emerald-600" : rate >= 50 ? "text-amber-600" : "text-red-600"
              const LastIcon =
                s.lastDispatched === true
                  ? CheckCircle2
                  : s.lastDispatched === false
                    ? XCircle
                    : CircleSlash
              const lastTone =
                s.lastDispatched === true
                  ? "text-emerald-600"
                  : s.lastDispatched === false
                    ? "text-red-600"
                    : "text-muted-foreground"
              return (
                <li key={s.key} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{s.label}</span>
                      {s.lastStatus !== "optimal" && (
                        <Badge variant="outline" className="border-red-500/40 text-red-600 text-[10px]">
                          {s.lastStatus}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span className="font-mono">{s.total}×</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" />
                        {ageLabel(Date.now() - s.lastAt)}
                      </span>
                    </div>
                  </div>

                  {/* Dispatch success rate */}
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <span className={cn("font-mono text-sm tabular-nums", rateTone)}>{rate}%</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {s.dispatched}/{s.total} dispatched
                    </span>
                  </div>

                  {/* Last outcome */}
                  <LastIcon className={cn("size-4 shrink-0", lastTone)} />
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
