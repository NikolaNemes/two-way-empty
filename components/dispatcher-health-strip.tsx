"use client"

import useSWR from "swr"
import { Activity, HeartPulse, ShieldCheck, ShieldAlert, Zap, ZapOff, CircleSlash } from "lucide-react"
import { cn } from "@/lib/utils"
import { useStation } from "@/components/station-context"

interface LiveResponse {
  status: "healthy" | "degraded" | "down" | "disabled"
  reason: string
  lastReplanAt: string | null
  ageMs: number | null
  intervalMs: number
  planStatus: "optimal" | "infeasible" | "error" | null
  lastDispatchOk: boolean | null
  lastEventType: string | null
}

interface ReadyResponse {
  ready: boolean
  checks: Array<{ name: string; ok: boolean; detail: string }>
}

const jsonFetcher = (url: string) => fetch(url).then((r) => r.json())

/** Human label for replan triggers (keep in sync with the dispatch plan card). */
const EVENT_LABEL: Record<string, string> = {
  manual: "Manual",
  price_update: "Price",
  idm: "IDM divergence",
  ev_plug_event: "Car connect",
  connect: "Car connect",
  disconnect: "Car disconnect",
  soc_threshold: "SOC threshold",
  safety: "Safety interval",
  test: "Liveness probe",
}

function liveTone(status: LiveResponse["status"]) {
  switch (status) {
    case "healthy":
      return { className: "border-emerald-500/40 text-emerald-600", icon: HeartPulse, label: "Healthy" }
    case "degraded":
      return { className: "border-amber-500/40 text-amber-600", icon: Activity, label: "Replan overdue" }
    case "disabled":
      return { className: "text-muted-foreground", icon: CircleSlash, label: "Disabled" }
    default:
      return { className: "border-red-500/40 text-red-600", icon: Activity, label: "Down" }
  }
}

/** Compact "N s/m ago" for a plan age in ms. */
function ageLabel(ms: number | null): string | null {
  if (ms == null) return null
  if (ms < 1000) return "just now"
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}

/**
 * Compact health strip for the EVENT/REPLAN-DRIVEN dispatcher. There is no fixed
 * tick cadence to report anymore, so this surfaces what actually matters now:
 * plan freshness (how long since the last replan), the trigger that fired it,
 * whether that replan's dispatch to Amperio succeeded, and dependency readiness.
 */
export function DispatcherHealthStrip() {
  // MULTI-LOCATION: liveness is per-station (selected in the sidebar);
  // readiness (Redis/Amperio deps) is global so it stays unscoped.
  const { stationId } = useStation()
  const { data: live } = useSWR<LiveResponse>(
    `/api/dispatcher/live?stationId=${encodeURIComponent(stationId)}`,
    jsonFetcher,
    { refreshInterval: 5000 },
  )
  const { data: ready } = useSWR<ReadyResponse>("/api/dispatcher/ready", jsonFetcher, {
    refreshInterval: 15000,
  })

  const lt = live ? liveTone(live.status) : null
  const LiveIcon = lt?.icon ?? Activity
  const age = live ? ageLabel(live.ageMs) : null
  const eventLabel =
    live?.lastEventType != null ? (EVENT_LABEL[live.lastEventType] ?? live.lastEventType) : null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium">Health</span>

      {/* Liveness / plan freshness */}
      <span className={cn("inline-flex items-center gap-1", lt?.className)} title={live?.reason}>
        <LiveIcon className="size-3.5" />
        {lt ? lt.label : "…"}
        {age && live?.status !== "disabled" && <span className="font-mono opacity-80">{age}</span>}
      </span>

      {/* Last trigger */}
      {eventLabel && live?.status !== "disabled" && (
        <>
          <span className="opacity-30">·</span>
          <span className="inline-flex items-center gap-1">
            <Activity className="size-3.5" />
            {eventLabel}
          </span>
        </>
      )}

      {/* Last dispatch outcome */}
      {live?.lastDispatchOk != null && (
        <>
          <span className="opacity-30">·</span>
          <span
            className={cn(
              "inline-flex items-center gap-1",
              live.lastDispatchOk ? "text-emerald-600" : "text-red-600",
            )}
          >
            {live.lastDispatchOk ? <Zap className="size-3.5" /> : <ZapOff className="size-3.5" />}
            {live.lastDispatchOk ? "Dispatched" : "Dispatch failed"}
          </span>
        </>
      )}

      <span className="opacity-30">·</span>

      {/* Readiness */}
      <span
        className={cn(
          "inline-flex items-center gap-1",
          ready ? (ready.ready ? "text-emerald-600" : "text-red-600") : "",
        )}
        title={ready?.checks.map((c) => `${c.name}: ${c.detail}`).join("\n")}
      >
        {ready?.ready ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
        {ready ? (ready.ready ? "Ready" : "Not ready") : "…"}
      </span>
    </div>
  )
}
