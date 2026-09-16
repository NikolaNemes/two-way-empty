"use client"

/**
 * FLEET OVERVIEW — operational dashboard for every registered location.
 *
 * Widgets (top → bottom):
 *   1. Status tiers — how many locations are Offline / Telemetry only /
 *      Full dispatching, as clickable filter cards with a proportion bar.
 *   2. Min-SOC clusters — locations bucketed in 10% bands of min(B1,B2,…) SOC,
 *      as a clickable histogram (only locations with live telemetry).
 *   3. Locations table — the full registry with status, SOC, plan intent;
 *      filtered by whatever tier/bucket is selected above.
 *
 * All data comes from ONE aggregate endpoint (/api/fleet/status) so the page
 * costs a single poll regardless of fleet size.
 */

import { useMemo, useState } from "react"
import useSWR from "swr"
import { useRouter } from "next/navigation"
import {
  Activity,
  BatteryMedium,
  CircleOff,
  PowerOff,
  Radio,
  X,
  Zap,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useStation } from "@/components/station-context"
import { authedFetcher } from "@/lib/authed-fetcher"

type Tier = "full" | "telemetry" | "offline" | "disabled"

interface FleetStation {
  stationId: string
  name: string
  enabled: boolean
  dispatchEnabled: boolean
  status: Tier
  reason: string
  minSoc: number | null
  avgSoc: number | null
  batteryCount: number
  gridCapKw: number
  telemetryAgeMs: number | null
  clearanceKw: number | null
  planSolvedAt: string | null
}

const TIER_META: Record<
  Tier,
  { label: string; desc: string; icon: typeof Zap; dot: string; text: string; bar: string }
> = {
  full: {
    label: "Full dispatching",
    desc: "Dispatcher driving with a fresh plan",
    icon: Zap,
    dot: "bg-emerald-500",
    text: "text-emerald-600",
    bar: "bg-emerald-500",
  },
  telemetry: {
    label: "Telemetry only",
    desc: "Data actually arriving, dispatcher not driving",
    icon: Radio,
    dot: "bg-amber-500",
    text: "text-amber-600",
    bar: "bg-amber-500",
  },
  offline: {
    label: "Disconnected",
    desc: "Enabled but data/commands not flowing — needs attention",
    icon: CircleOff,
    dot: "bg-red-500",
    text: "text-red-600",
    bar: "bg-red-500",
  },
  disabled: {
    label: "Disabled",
    desc: "Never enabled or connected (registry only)",
    icon: PowerOff,
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    bar: "bg-muted-foreground/30",
  },
}

function socTone(pct: number | null): string {
  if (pct == null) return "text-muted-foreground"
  if (pct < 25) return "text-red-600"
  if (pct < 45) return "text-amber-600"
  return "text-emerald-600"
}

function fmtAge(ms: number | null): string {
  if (ms == null) return "never"
  if (ms < 90_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 90 * 60_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}

/** 10% SOC bands: bucket 0 = [0,10), … bucket 9 = [90,100]. */
function socBucket(minSoc: number): number {
  return Math.min(9, Math.max(0, Math.floor(minSoc / 10)))
}

export function FleetOverview() {
  const router = useRouter()
  const { setStationId } = useStation()
  const [tierFilter, setTierFilter] = useState<Tier | null>(null)
  const [bucketFilter, setBucketFilter] = useState<number | null>(null)

  const { data, error, isLoading } = useSWR<{ stations: FleetStation[]; at: string }>(
    "/api/fleet/status",
    authedFetcher,
    // revalidateOnFocus ON: refocusing a throttled tab is exactly when the
    // token-expiry gap bites — refetching immediately (through the 401-retry
    // fetcher) replaces potentially minutes-old data right away.
    { refreshInterval: 30_000, revalidateOnFocus: true, keepPreviousData: true },
  )
  const stations = data?.stations ?? []

  const tierCounts = useMemo(() => {
    const c: Record<Tier, number> = { full: 0, telemetry: 0, offline: 0, disabled: 0 }
    for (const s of stations) c[s.status in c ? s.status : "disabled"]++
    return c
  }, [stations])

  // Min-SOC histogram: only stations that actually report battery SOC.
  const buckets = useMemo(() => {
    const b: FleetStation[][] = Array.from({ length: 10 }, () => [])
    for (const s of stations) if (s.minSoc != null) b[socBucket(s.minSoc)].push(s)
    return b
  }, [stations])
  const withSoc = buckets.reduce((a, b) => a + b.length, 0)
  const maxBucket = Math.max(1, ...buckets.map((b) => b.length))

  const visible = useMemo(() => {
    let list = stations
    if (tierFilter) list = list.filter((s) => s.status === tierFilter)
    if (bucketFilter != null)
      list = list.filter((s) => s.minSoc != null && socBucket(s.minSoc) === bucketFilter)
    // Live tiers first, Disconnected (anomaly) before Disabled (expected),
    // then min SOC ascending (risk first), then name.
    const order: Record<Tier, number> = { full: 0, telemetry: 1, offline: 2, disabled: 3 }
    return [...list].sort(
      (a, b) =>
        order[a.status] - order[b.status] ||
        (a.minSoc ?? 101) - (b.minSoc ?? 101) ||
        a.name.localeCompare(b.name),
    )
  }, [stations, tierFilter, bucketFilter])

  const filtered = tierFilter != null || bucketFilter != null
  // Clicking a row switches the app-wide location context to that station and
  // opens Live Dispatching. The ?stationId= param makes the link deep-linkable
  // too (StationProvider resolves URL param first on a hard load).
  const open = (id: string) => {
    setStationId(id)
    router.push(`/prototype/telemetry/day-sim?stationId=${encodeURIComponent(id)}`)
  }

  return (
    <div className="w-full min-w-0 py-6 sm:py-8 px-3 sm:px-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-balance">Fleet Overview</h1>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed text-pretty">
          Operational state of every registered location. Click a status tier or a SOC band to
          filter the table; click a row to open that location&apos;s live dispatching. Manage the
          registry in{" "}
          <a href="/stations" className="underline underline-offset-2 hover:text-foreground">
            Stations
          </a>
          .
        </p>
      </header>

      {/* Full-page error ONLY when there is nothing to show. With previous
          data in hand a transient failure (token-expiry 401 between retries,
          blip 500) must NOT blank the dashboard — keep the data and show a
          small non-blocking notice instead; SWR keeps retrying in background. */}
      {error && stations.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600">
            Fleet status unavailable: {String(error.message ?? error)}
          </CardContent>
        </Card>
      ) : isLoading && stations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Loading fleet…
          </CardContent>
        </Card>
      ) : (
        <>
          {error ? (
            <div
              role="status"
              className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              <span className="inline-flex size-1.5 animate-pulse rounded-full bg-amber-500" />
              Live refresh interrupted ({String(error.message ?? error)}) — showing last known state,
              reconnecting…
            </div>
          ) : null}
          {/* ── Widget 1: status tiers ─────────────────────────────────── */}
          <section aria-label="Locations by operational status" className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(Object.keys(TIER_META) as Tier[]).map((tier) => {
                const meta = TIER_META[tier]
                const Icon = meta.icon
                const active = tierFilter === tier
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => {
                      setTierFilter(active ? null : tier)
                      setBucketFilter(null)
                    }}
                    aria-pressed={active}
                    className={cn(
                      "text-left rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <Card
                      className={cn(
                        "h-full transition-colors hover:border-primary/40",
                        active && "border-primary ring-1 ring-primary/30",
                      )}
                    >
                      <CardContent className="pt-5 pb-4 flex items-start gap-3">
                        <div
                          className={cn(
                            "rounded-lg p-2 bg-muted flex items-center justify-center",
                            meta.text,
                          )}
                        >
                          <Icon className="size-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            {meta.label}
                          </p>
                          <p className={cn("text-2xl font-bold font-mono leading-tight", meta.text)}>
                            {tierCounts[tier]}
                          </p>
                          <p className="text-xs text-muted-foreground text-pretty">{meta.desc}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </button>
                )
              })}
            </div>
            {/* Proportion bar across the whole fleet */}
            <div
              className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`Fleet mix: ${tierCounts.full} full dispatching, ${tierCounts.telemetry} telemetry only, ${tierCounts.offline} disconnected, ${tierCounts.disabled} disabled`}
            >
              {(Object.keys(TIER_META) as Tier[]).map((tier) =>
                tierCounts[tier] > 0 ? (
                  <div
                    key={tier}
                    className={TIER_META[tier].bar}
                    style={{ width: `${(tierCounts[tier] / Math.max(1, stations.length)) * 100}%` }}
                  />
                ) : null,
              )}
            </div>
          </section>

          {/* ── Widget 2: min-SOC 10% clusters ─────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <BatteryMedium className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">Min battery SOC — 10% clusters</CardTitle>
                <span className="text-xs text-muted-foreground">
                  min across a location&apos;s batteries ·{" "}
                  <span className="font-mono font-semibold text-foreground">{withSoc}</span> with
                  telemetry,{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {stations.length - withSoc}
                  </span>{" "}
                  without
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {withSoc === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No location is reporting battery SOC right now.
                </p>
              ) : (
                <div
                  className="flex gap-1.5 sm:gap-2"
                  role="img"
                  aria-label="Histogram of locations by minimum battery state of charge in 10 percent bands"
                >
                  {buckets.map((list, i) => {
                    const active = bucketFilter === i
                    const empty = list.length === 0
                    const risk =
                      i < 3
                        ? { bar: "bg-red-500", tint: "bg-red-500/[0.07]", txt: "text-red-600" }
                        : i < 5
                          ? { bar: "bg-amber-500", tint: "bg-amber-500/[0.07]", txt: "text-amber-600" }
                          : { bar: "bg-emerald-500", tint: "bg-emerald-500/[0.07]", txt: "text-emerald-600" }
                    // Fixed pixel heights: a % height inside the flex-col button
                    // collapses (labels eat the box), which made bars invisible.
                    const CHART_PX = 104
                    const barPx = empty ? 0 : Math.round(14 + (list.length / maxBucket) * (CHART_PX - 14))
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setBucketFilter(active ? null : i)
                          setTierFilter(null)
                        }}
                        aria-pressed={active}
                        aria-label={`${i * 10}–${i * 10 + 10}%: ${list.length} locations`}
                        className={cn(
                          "flex-1 min-w-0 flex flex-col items-stretch rounded-lg border transition-colors outline-none",
                          "focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "border-primary bg-primary/5"
                            : empty
                              ? "border-transparent hover:border-border"
                              : cn("border-border/60 hover:border-foreground/30", risk.tint),
                        )}
                      >
                        {/* count */}
                        <span
                          className={cn(
                            "pt-1.5 text-center text-sm font-mono leading-none",
                            empty ? "text-muted-foreground/35" : cn("font-bold", risk.txt),
                          )}
                        >
                          {empty ? "·" : list.length}
                        </span>
                        {/* bar area with baseline */}
                        <span
                          className="mx-1.5 mt-1 flex flex-col justify-end border-b-2 border-border"
                          style={{ height: CHART_PX }}
                        >
                          <span
                            className={cn("block w-full rounded-t", empty ? "" : risk.bar)}
                            style={{ height: barPx }}
                          />
                        </span>
                        {/* range label */}
                        <span
                          className={cn(
                            "py-1 text-center text-[10px] font-mono",
                            active ? "text-primary font-semibold" : "text-muted-foreground",
                          )}
                        >
                          {i * 10}–{i * 10 + 10}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
              <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-red-500" /> {"<30% critical"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-amber-500" /> 30–50% low
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-emerald-500" /> {">50% healthy"}
                </span>
                <span className="ml-auto hidden sm:inline">click a cluster to filter the table</span>
              </div>
            </CardContent>
          </Card>

          {/* ── Widget 3: locations table ────────────────────────────��─── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Activity className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">Locations</CardTitle>
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono font-semibold text-foreground">{visible.length}</span>
                  {" of "}
                  <span className="font-mono">{stations.length}</span>
                </span>
                {filtered ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTierFilter(null)
                      setBucketFilter(null)
                    }}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    <X className="size-3" />
                    Clear filter
                    {tierFilter ? ` (${TIER_META[tierFilter].label})` : ""}
                    {bucketFilter != null ? ` (SOC ${bucketFilter * 10}–${bucketFilter * 10 + 10}%)` : ""}
                  </button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground text-left">
                      <th className="py-2 pr-3 font-medium">Location</th>
                      <th className="py-2 px-3 font-medium">Status (measured)</th>
                      <th className="py-2 px-3 font-medium">Configured</th>
                      <th className="py-2 px-3 font-medium text-right">Min SOC</th>
                      <th className="py-2 px-3 font-medium text-right">Avg SOC</th>
                      <th className="py-2 px-3 font-medium text-right">Grid cap</th>
                      <th className="py-2 px-3 font-medium">Plan intent</th>
                      <th className="py-2 pl-3 font-medium text-right">Telemetry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((s) => {
                      // Defensive fallback: during deploys/HMR the API can
                      // briefly serve a status this bundle doesn't know (or
                      // vice versa) — render as Disabled instead of crashing.
                      const meta = TIER_META[s.status] ?? TIER_META.disabled
                      return (
                        <tr
                          key={s.stationId}
                          onClick={() => open(s.stationId)}
                          className="border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors"
                        >
                          <td className="py-2 pr-3">
                            <p className="font-medium truncate max-w-[26ch]">{s.name}</p>
                            <p className="text-[11px] text-muted-foreground font-mono truncate max-w-[26ch]">
                              {s.stationId}
                            </p>
                          </td>
                          <td className="py-2 px-3">
                            <Badge variant="outline" className={cn("gap-1.5 text-[10px] uppercase", meta.text)}>
                              <span className={cn("inline-block size-1.5 rounded-full", meta.dot)} />
                              {meta.label}
                            </Badge>
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[30ch]">
                              {s.reason}
                            </p>
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1">
                              <span
                                className={cn(
                                  "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                                  s.enabled
                                    ? "bg-primary/10 text-primary"
                                    : "bg-muted text-muted-foreground",
                                )}
                              >
                                TEL
                              </span>
                              <span
                                className={cn(
                                  "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                                  s.dispatchEnabled
                                    ? "bg-emerald-500/10 text-emerald-600"
                                    : "bg-muted text-muted-foreground",
                                )}
                              >
                                DISP
                              </span>
                            </div>
                          </td>
                          <td className={cn("py-2 px-3 text-right font-mono font-semibold", socTone(s.minSoc))}>
                            {s.minSoc != null ? `${s.minSoc.toFixed(0)}%` : "—"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono">
                            {s.avgSoc != null ? `${s.avgSoc.toFixed(0)}%` : "—"}
                          </td>
                          <td className="py-2 px-3 text-right font-mono">{s.gridCapKw} kW</td>
                          <td className="py-2 px-3 text-xs text-muted-foreground">
                            {s.clearanceKw == null
                              ? "—"
                              : s.clearanceKw > 1
                                ? `Importing ${s.clearanceKw.toFixed(1)} kW`
                                : "Idle / battery"}
                          </td>
                          <td className="py-2 pl-3 text-right text-xs text-muted-foreground font-mono">
                            {fmtAge(s.telemetryAgeMs)}
                          </td>
                        </tr>
                      )
                    })}
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                          No locations match the current filter.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
