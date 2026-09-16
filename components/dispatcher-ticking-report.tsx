"use client"

import { useMemo } from "react"
import useSWR from "swr"
import { Activity, Clock, AlertTriangle, CheckCircle2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { TickReport } from "@/lib/dispatcher-status"
import { useStation } from "@/components/station-context"

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json() as Promise<TickReport>)

/** One hour-aligned segment of the today bar. */
interface HourColumn {
  startMs: number
  count: number
  activeBuckets: number
  totalBuckets: number
  /** "full" = every sub-bucket ticked, "partial" = some, "miss" = none. */
  status: "full" | "partial" | "miss"
}

function fmtGap(ms: number): string {
  if (ms <= 0) return "none"
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, "0")}m`
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "never"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return "just now"
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, "0")}m ago`
}

function fmtHour(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric" })
}

/**
 * TICKING REPORT — at-a-glance proof of dispatch-loop continuity.
 * ────────────────────────────────────────────────────────────────────────
 * The Pingers card answers "who is driving right now?"; this answers "how
 * continuously has the loop actually been driven over the last day?" It renders
 * a single green/red coverage bar across the last 24h — one segment per hour,
 * green where ticks ran, red where the loop went dark — plus a coverage /
 * biggest-gap / total-ticks summary so an operator can prove uptime and spot
 * outages instantly. It revalidates on every tick (via the global SWR refresh
 * the ticker fires) and also polls on its own as a backstop.
 */
export function DispatcherTickingReport() {
  // MULTI-LOCATION: shows the sidebar-selected station's tick history.
  const { stationId } = useStation()
  const { data, isLoading } = useSWR(
    `/api/dispatcher/ticks?stationId=${encodeURIComponent(stationId)}`,
    fetcher,
    {
      refreshInterval: 10_000,
      revalidateOnFocus: true,
    },
  )

  const hours = useMemo<HourColumn[]>(() => {
    if (!data?.buckets?.length) return []
    // Fold fine-grained buckets into hour-aligned columns, tracking how many of
    // each hour's sub-buckets actually ticked (for full / partial / miss).
    const map = new Map<number, { count: number; active: number; total: number }>()
    for (const b of data.buckets) {
      const t = new Date(b.startAt).getTime()
      const hourStart = Math.floor(t / 3_600_000) * 3_600_000
      const cur = map.get(hourStart) ?? { count: 0, active: 0, total: 0 }
      cur.count += b.count
      cur.total += 1
      if (b.count > 0) cur.active += 1
      map.set(hourStart, cur)
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([startMs, v]) => ({
        startMs,
        count: v.count,
        activeBuckets: v.active,
        totalBuckets: v.total,
        status: v.active === 0 ? "miss" : v.active >= v.total ? "full" : "partial",
      }))
  }, [data])

  // A "gap" worth flagging is at least 2 empty buckets (≥10 min of no ticks).
  const hasGap = (data?.longestGapMs ?? 0) >= 2 * (data?.bucketMs ?? 5 * 60_000)
  const noData = !isLoading && (data?.totalTicks ?? 0) === 0
  const coverage = data?.coveragePct ?? 0
  const activeHours = hours.filter((h) => h.status !== "miss").length

  // Final verdict on 24h ticking health, driven primarily by coverage and
  // tempered by the biggest gap. This is the single headline an operator reads.
  const verdict: "good" | "partial" | "poor" =
    coverage >= 90 && !hasGap ? "good" : coverage >= 50 ? "partial" : "poor"
  const VERDICT_META = {
    good: {
      label: "Good",
      icon: CheckCircle2,
      blurb: "Dispatch loop ran continuously across the last 24h.",
      className: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
      dot: "bg-emerald-500",
    },
    partial: {
      label: "Partial",
      icon: AlertTriangle,
      blurb: "The loop ran for much of the day but had coverage gaps.",
      className: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
      dot: "bg-amber-400",
    },
    poor: {
      label: "Poor",
      icon: AlertTriangle,
      blurb: "The loop was dark for most of the last 24h — keep this tab open or run a pinger.",
      className: "border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400",
      dot: "bg-red-500",
    },
  } as const
  const v = VERDICT_META[verdict]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Activity className="size-4" />
          Ticking report
          <span className="text-xs font-normal text-muted-foreground">last 24h</span>
          {!noData && (
            <Badge
              variant="outline"
              className={cn(
                "ml-auto gap-1 font-mono",
                coverage >= 95
                  ? "border-emerald-500/40 text-emerald-600"
                  : coverage >= 50
                    ? "border-amber-500/40 text-amber-600"
                    : "border-red-500/40 text-red-600",
              )}
            >
              {coverage.toFixed(0)}% coverage
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {noData ? (
          <p className="text-sm text-muted-foreground">
            No ticks recorded in the last 24 hours yet. Start dispatching (or point a pinger at{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/dispatcher/tick</code>) and this report will
            fill in.
          </p>
        ) : (
          <>
            {/* Final verdict: the single headline on 24h ticking health. */}
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-3",
                v.className,
              )}
            >
              <span className={cn("flex size-9 items-center justify-center rounded-full", v.dot)}>
                <v.icon className="size-5 text-white" />
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-foreground">Ticking health</span>
                  <span className="text-base font-semibold">{v.label}</span>
                </div>
                <p className="text-xs text-foreground/70">{v.blurb}</p>
              </div>
            </div>

            {/* Today coverage bar: one segment per hour, green = ticked, red = dark. */}
            <div>
              <div
                className="flex h-7 w-full overflow-hidden rounded-md border bg-muted/30"
                role="img"
                aria-label={`Tick coverage over the last 24 hours: ${activeHours} of ${hours.length} hours active`}
              >
                {hours.map((h) => (
                  <div
                    key={h.startMs}
                    title={`${fmtHour(h.startMs)} · ${h.count} tick${h.count === 1 ? "" : "s"} · ${h.activeBuckets}/${h.totalBuckets} slots`}
                    className={cn(
                      "h-full flex-1 border-r border-background/40 last:border-r-0 transition-colors",
                      h.status === "full" && "bg-emerald-500",
                      h.status === "partial" && "bg-amber-400",
                      h.status === "miss" && "bg-red-500/70",
                    )}
                  />
                ))}
              </div>
              {/* Axis */}
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>{hours[0] ? fmtHour(hours[0].startMs) : "−24h"}</span>
                <span>
                  {hours[Math.floor(hours.length / 2)] ? fmtHour(hours[Math.floor(hours.length / 2)].startMs) : ""}
                </span>
                <span>now</span>
              </div>
              {/* Legend */}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                <LegendDot className="bg-emerald-500" label="Ticking" />
                <LegendDot className="bg-amber-400" label="Partial" />
                <LegendDot className="bg-red-500/70" label="No ticks" />
              </div>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total ticks" value={(data?.totalTicks ?? 0).toLocaleString()} />
              <Stat label="Active hours" value={`${activeHours}/${hours.length || 24}`} />
              <Stat
                label="Biggest gap"
                value={fmtGap(data?.longestGapMs ?? 0)}
                tone={hasGap ? "warn" : "ok"}
                icon={hasGap ? AlertTriangle : CheckCircle2}
              />
              <Stat label="Last tick" value={fmtAgo(data?.lastTickBucketAt ?? null)} />
            </div>

            {hasGap && (
              <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <Clock className="mt-0.5 size-3 shrink-0" />
                Longest dispatch gap was {fmtGap(data?.longestGapMs ?? 0)} — the loop was not driven during that
                window. Keep this tab open or run an external pinger for full coverage.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-sm", className)} />
      {label}
    </span>
  )
}

function Stat({
  label,
  value,
  tone = "default",
  icon: Icon,
}: {
  label: string
  value: string
  tone?: "default" | "ok" | "warn"
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border px-3 py-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={cn(
          "flex items-center gap-1 font-mono text-sm tabular-nums",
          tone === "warn" && "text-amber-600",
          tone === "ok" && "text-emerald-600",
        )}
      >
        {Icon && <Icon className="size-3.5" />}
        {value}
      </span>
    </div>
  )
}
