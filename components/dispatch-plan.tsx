"use client"

/**
 * DispatchPlan
 * ────────────────────────────────────────────────────────────────────────
 * Timeline-first visualization of the optimizer's latest receding-horizon plan:
 *
 *   1. HERO — the horizon itself: aligned day-ahead price strip (cheap/peak
 *      bands per the dispatch rule) over the grid-import + projected-SoC
 *      trajectory, "now" marker on the committed step, and the PREVIOUS plan
 *      ghosted so the replan delta is visible at a glance.
 *   2. COMMAND STRIP — the committed decision (Δ vs previous plan), the firm
 *      rule / reserve-guard reason in plain English, and the lookahead used.
 *   3. DETAILS — collapsible how-to-read explainer and the replan history
 *      (drill into any row for its exact solve inputs/outputs).
 *
 * Pure presentational component — it reads the `plan` block from the dispatcher
 * status response (current + previous snapshots) and renders. No data fetching.
 */

import { Fragment, useMemo, useState } from "react"
import {
  ComposedChart,
  Area,
  Bar,
  Cell,
  Line,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Brain,
  ArrowUp,
  ArrowDown,
  Minus,
  Zap,
  BatteryCharging,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Loader2,
  Gauge,
  ScrollText,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { analyzeDayPrices } from "@/lib/optimizer/cheap-slot"
import { OPTIMIZER_DEFAULTS } from "@/lib/optimizer/params"
import type { PlanState, PlanSnapshot, ReplanLogEntry } from "@/lib/dispatcher-status"
import { useStation } from "@/components/station-context"

// v5.1 firm committed-action rules → plain-English "why this command changed".
// Grounded in the kernel's own decision (snapshot.firmCommitReason), never invented.
const FIRM_REASON_LABEL: Record<string, string> = {
  firm_cheap_car_import: "Cheap slot + car connected — grid serves the car in full, sparing the battery",
  firm_no_arb_car_grid:
    "Car connected, no price spread beats the ~7 ct/kWh cycling cost — grid serves the car, sparing the battery",
  low_soc_refill: "Low state of charge + cheap now — importing to proactively refill the battery",
  wait_high_soc:
    "High state of charge + a cheaper slot is still ahead — holding off on grid charging to wait for it",
  buy_now_marginal: "Cheap now; the next cheaper slot saves too little to wait — importing now",
  buy_now_cheapest: "Cheapest reachable slot — importing now to bank cheap energy",
  lp: "Following the optimiser's plan — no firm override this slot",
}

// Plain-English explanation of a real-time reserve-guard override on the
// committed step (lib/optimizer/reserve-guard.ts). Shown when the guard forced the wire
// setpoint above the LP's own choice, so operators see WHY committed ≠ LP intent.
const GUARD_REASON_LABEL: Record<string, string> = {
  "car-guard":
    "Reserve guard — car connected while battery is below the safety floor, so grid import is forced to full capacity to protect the pack (overrides the optimiser this slot).",
  "no-car-recharge":
    "Reserve guard — battery below the emergency floor with no car connected, so a full-capacity recharge is forced and held until it recovers (overrides the optimiser this slot).",
}

// Palette is split by MEANING so no hue means two things at once:
//   • ACTION (what the plan does to the wire) → indigo grid-import bars.
//   • PRICE CONTEXT (why) → green = cheap, red = peak, orange = neutral.
//   • BATTERY state → cyan SOC line.
// Previously grid-import reused the same emerald as the cheap-slot shading, so
// the plan's action visually merged into the price background — the single
// biggest readability problem this palette fixes.
const COLORS = {
  grid: "hsl(224 76% 52%)", // indigo — planned grid-import setpoint (the ACTION)
  gridPrev: "hsl(224 30% 60%)", // muted indigo — previous plan
  soc: "hsl(190 85% 45%)", // cyan — projected SOC (battery, distinct from indigo)
  socPrev: "hsl(190 35% 62%)", // muted cyan — previous SOC
  reserve: "hsl(38 92% 50%)", // amber — reserve floor
  demand: "hsl(0 0% 50%)", // grey — forecast EV demand
  cheap: "hsl(150 65% 43%)", // green — cheap-slot price + background shading
  pricey: "hsl(0 72% 55%)", // red — priciest-slot price bar
  priceBar: "hsl(28 90% 52%)", // orange — neutral DA price bar
  negative: "hsl(170 70% 38%)", // deep teal — negative / near-free price
  now: "hsl(224 76% 52%)", // indigo — committed "now" marker (matches action)
  axis: "hsl(0 0% 60%)",
}

/**
 * Human label for the replan trigger. Keys match the eventType values accepted
 * by POST /api/dispatcher/replan (see EVENT_TYPES in that route).
 */
const TRIGGER_LABEL: Record<string, string> = {
  soc_threshold: "SOC threshold",
  price_update: "Price update",
  ev_plug_event: "Car connected",
  ev_unplug_event: "Car disconnected",
  grid_constraint: "Grid constraint",
  setpoint_deviation: "Setpoint deviation",
  schedule_change: "Schedule change",
  manual: "Manual replan",
  external: "External event",
  test: "Liveness probe",
  // Legacy / internal aliases kept for older log rows.
  connect: "Car connected",
  disconnect: "Car disconnected",
  idm: "IDM price divergence",
  safety: "Safety interval",
  slot: "New slot",
}

/** Tailwind classes for the per-trigger badge tint. */
function triggerTone(eventType?: string): string {
  switch (eventType) {
    case "ev_plug_event":
    case "connect":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
    case "ev_unplug_event":
    case "disconnect":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400"
    case "price_update":
    case "idm":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400"
    case "manual":
      return "bg-primary/15 text-primary"
    case "grid_constraint":
    case "setpoint_deviation":
      return "bg-red-500/15 text-red-700 dark:text-red-400"
    default:
      return "bg-muted text-muted-foreground"
  }
}

function fmtKw(kw: number): string {
  return `${kw.toFixed(1)} kW`
}
function fmtPct(p: number): string {
  return `${p.toFixed(0)}%`
}
function fmtAgo(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}
/** Absolute wall-clock time HH:MM:SS for the history table. */
function fmtClock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`
}

/** One entry in the compact chart legend. `variant` mirrors how the series is
 *  actually drawn: a filled swatch (bars), a solid rule (line) or a dashed rule
 *  (overlay curves) — so the key matches the chart at a glance. */
function LegendKey({
  color,
  label,
  variant = "bar",
}: {
  color: string
  label: string
  variant?: "bar" | "line" | "dashed"
}) {
  return (
    <span className="flex items-center gap-1.5">
      {variant === "bar" ? (
        <span className="inline-block size-2.5 rounded-sm" style={{ background: color }} />
      ) : (
        <span
          className={cn("inline-block h-0 w-4 border-t-2", variant === "dashed" && "border-dashed")}
          style={{ borderColor: color }}
        />
      )}
      {label}
    </span>
  )
}

/** A single Δ stat with up/down/flat arrow + tone. `goodUp` flips the color. */
function DeltaStat({
  label,
  current,
  delta,
  unit,
  icon: Icon,
}: {
  label: string
  current: string
  delta: number | null
  unit: string
  icon: React.ElementType
}) {
  const hasDelta = delta != null && Math.abs(delta) > 1e-6
  const Arrow = !hasDelta ? Minus : delta! > 0 ? ArrowUp : ArrowDown
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-lg font-semibold tabular-nums">{current}</span>
        <span
          className={cn(
            "flex items-center gap-0.5 text-xs font-medium tabular-nums",
            !hasDelta && "text-muted-foreground",
            hasDelta && (delta! > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-blue-600 dark:text-blue-400"),
          )}
        >
          <Arrow className="size-3" />
          {hasDelta ? `${delta! > 0 ? "+" : ""}${delta!.toFixed(1)}${unit}` : "no change"}
        </span>
      </div>
    </div>
  )
}

interface ChartRow {
  step: number
  label: string
  /** Forecast EV demand (kW) — proxy for session/car-appearance likelihood. */
  demand: number | null
  /** Day-ahead price for this slot (€/MWh) — drives the aligned price strip. */
  price: number | null
  /** True when the dispatch rule classifies this slot cheap (≤ day-spread cutoff). */
  cheap: boolean
  /** True when the dispatch rule puts this slot in the mirrored top of the spread. */
  pricey: boolean
  grid: number | null
  soc: number | null
  reserve: number | null
  gridPrev: number | null
  socPrev: number | null
}

/**
 * PlanInputDetail — the exact inputs the optimizer ingested for one solve: anchor
 * SOC, usable capacity, total forecast demand, plus the full per-step demand
 * curve. Rendered inside a replan-history drill-down.
 */
export function PlanInputDetail({ snapshot }: { snapshot: PlanSnapshot }) {
  const anchorSoc = snapshot.steps[0]?.socPct ?? null
  const totalDemand = snapshot.steps.reduce((a, s) => a + s.demandKw * snapshot.stepHours, 0)

  return (
    <div className="rounded-md border bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold">
        <Gauge className="size-3.5 text-primary" />
        Plan input
        <Badge variant="outline" className="font-mono text-[10px]">
          {snapshot.steps.length} steps
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
        <InputTile label="Anchor SOC" value={anchorSoc != null ? `${anchorSoc.toFixed(0)}%` : "—"} icon={BatteryCharging} />
        <InputTile label="Usable capacity" value={`${snapshot.capacityKwh.toFixed(1)} kWh`} icon={Gauge} />
        <InputTile label="Forecast demand" value={`${totalDemand.toFixed(1)} kWh`} sub="over horizon" icon={Zap} />
      </div>
      <div className="max-h-56 overflow-y-auto border-t">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            <tr className="text-muted-foreground">
              <th className="px-3 py-1.5 text-left font-medium">Time</th>
              <th className="px-3 py-1.5 text-right font-medium">Demand kW</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.steps.map((s, i) => {
              const d = new Date(s.ts)
              const label = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
              return (
                <tr key={s.slot} className={cn("border-t border-border/40", i === 0 && "bg-primary/5 font-medium")}>
                  <td className="px-3 py-1.5 tabular-nums">
                    {label}
                    {i === 0 && <span className="ml-1 text-[10px] text-primary">now</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.demandKw.toFixed(1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * PlanOutputDetail — the generated/dispatched output for one replan: the
 * committed command actually sent to the device, plus the optimizer's intended
 * grid + reserve trajectory across the horizon.
 */
export function PlanOutputDetail({ entry }: { entry: ReplanLogEntry }) {
  const snapshot = entry.snapshot
  const cmdKw = entry.commandKw != null ? entry.commandKw : entry.clearanceKw
  return (
    <div className="rounded-md border bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold">
        <Zap className="size-3.5 text-primary" />
        Plan output · dispatched command
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
        <InputTile
          label="Command (kW)"
          value={fmtKw(cmdKw)}
          sub={entry.commandW != null ? `${entry.commandW.toLocaleString()} W` : undefined}
          icon={Zap}
        />
        <InputTile label="Reserve floor" value={`${entry.reserveFloorStep1Pct.toFixed(0)}%`} icon={ShieldCheck} />
        <InputTile
          label="Dispatched"
          value={entry.dispatched === false ? "Not sent" : entry.dispatched ? "Yes" : entry.isTest ? "Probe" : "—"}
          sub={entry.isTest ? "liveness probe" : undefined}
          icon={entry.dispatched === false ? XCircle : CheckCircle2}
        />
      </div>
      {snapshot && snapshot.steps.length > 0 && (
        <div className="max-h-56 overflow-y-auto border-t">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr className="text-muted-foreground">
                <th className="px-3 py-1.5 text-left font-medium">Time</th>
                <th className="px-3 py-1.5 text-right font-medium">Grid import kW</th>
                <th className="px-3 py-1.5 text-right font-medium">SOC %</th>
                <th className="px-3 py-1.5 text-right font-medium">Reserve %</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.steps.map((s, i) => {
                const d = new Date(s.ts)
                const label = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
                return (
                  <tr key={s.slot} className={cn("border-t border-border/40", i === 0 && "bg-primary/5 font-medium")}>
                    <td className="px-3 py-1.5 tabular-nums">
                      {label}
                      {i === 0 && <span className="ml-1 text-[10px] text-primary">committed</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.gridKw.toFixed(1)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.socPct.toFixed(0)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.reserveFloorPct.toFixed(0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function InputTile({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border bg-background px-2.5 py-2">
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </span>
      <span className="font-mono text-sm font-semibold tabular-nums">{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground tabular-nums">{sub}</span>}
    </div>
  )
}

/**
 * ReplanLog — the rolling history of recent plan re-solves (newest first). Shows
 * when each replan fired, why (trigger), the committed setpoint it produced, the
 * reserve it sized, and the LP outcome. This is the "what's happening inside
 * dispatching" feed at the plan level (the tick-level activity feed is separate).
 */
function ReplanLog({ entries }: { entries: ReplanLogEntry[] }) {
  // Which row is drilled-down open (keyed by solvedAt + index).
  const [openKey, setOpenKey] = useState<string | null>(null)
  // Whole panel collapsed by default — keeps the status screen compact.
  const [expanded, setExpanded] = useState(false)
  if (entries.length === 0) return null
  return (
    <div className="rounded-lg border bg-muted/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium"
      >
        <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-90")} />
        <ScrollText className="size-4 text-primary" />
        Replan history
        <Badge variant="outline" className="font-mono text-[10px]">
          {entries.length}
        </Badge>
        <span className="ml-auto text-[11px] font-normal text-muted-foreground">
          {expanded ? "tap a row for input & output" : "tap to expand"}
        </span>
      </button>
      {expanded && (
      <div className="max-h-[28rem] overflow-auto border-t">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="w-6 px-2 py-2 font-medium" />
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-2 py-2 font-medium">Trigger (why)</th>
              <th className="px-2 py-2 text-right font-medium">Output command</th>
              <th className="px-2 py-2 text-right font-medium">Reserve</th>
              <th className="px-3 py-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {entries.map((e, i) => {
              const ok = e.status === "optimal"
              const trig = e.eventType ? (TRIGGER_LABEL[e.eventType] ?? e.eventType) : "Scheduled"
              // Prefer the actual dispatched command (W→kW); fall back to the
              // committed clearance when the row predates command capture.
              const cmdKw = e.commandKw != null ? e.commandKw : e.clearanceKw
              const dispatched = e.dispatched
              const key = `${e.solvedAt}-${i}`
              const isOpen = openKey === key
              return (
                <Fragment key={key}>
                  <tr
                    className={cn("cursor-pointer align-top hover:bg-muted/30", isOpen && "bg-muted/40")}
                    onClick={() => setOpenKey(isOpen ? null : key)}
                  >
                    <td className="px-2 py-2 text-muted-foreground">
                      <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="font-mono tabular-nums">{fmtClock(e.solvedAt)}</div>
                      <div className="text-[10px] text-muted-foreground">{fmtAgo(Date.now() - e.solvedAt)}</div>
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${triggerTone(e.eventType)}`}
                      >
                        {trig}
                      </span>
                      {e.trigger && (
                        <div className="mt-1 max-w-[220px] truncate text-[10px] text-muted-foreground" title={e.trigger}>
                          {e.trigger}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      <div className="font-mono font-medium tabular-nums">{fmtKw(cmdKw)}</div>
                      {e.commandW != null && (
                        <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
                          {e.commandW.toLocaleString()} W
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-muted-foreground">
                      {e.reserveFloorStep1Pct.toFixed(0)}%
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <span className="inline-flex items-center justify-end gap-1">
                        {ok ? (
                          <CheckCircle2 className="size-3.5 text-emerald-500" />
                        ) : (
                          <XCircle className="size-3.5 text-red-500" />
                        )}
                        <span className="text-[10px] capitalize text-muted-foreground">{e.status}</span>
                      </span>
                      {dispatched === false && (
                        <div className="text-[10px] font-medium text-red-600 dark:text-red-400">not sent</div>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/20">
                      <td colSpan={6} className="px-3 py-3">
                        {e.snapshot ? (
                          <div className="grid gap-3 lg:grid-cols-2">
                            <PlanInputDetail snapshot={e.snapshot} />
                            <PlanOutputDetail entry={e} />
                          </div>
                        ) : (
                          <div className="grid gap-3 lg:grid-cols-2">
                            <PlanOutputDetail entry={e} />
                            <div className="flex items-center justify-center rounded-md border bg-background p-4 text-center text-[11px] text-muted-foreground">
                              Plan input not captured for this replan (predates snapshot logging).
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}

export function DispatchPlan({
  plan,
  replanLog,
  onReplanned,
}: {
  plan: PlanState | undefined
  replanLog?: ReplanLogEntry[]
  /** Called after a manual replan resolves so the parent can refresh status. */
  onReplanned?: () => void
}) {
  const current = plan?.current ?? null
  const previous = plan?.previous ?? null

  // Manual replan trigger — fires the same event-driven path as an external
  // pinger (eventType=manual), then asks the parent to revalidate.
  // MULTI-LOCATION: the replan targets the sidebar-selected station.
  const { stationId } = useStation()
  const [replanning, setReplanning] = useState(false)
  const [replanMsg, setReplanMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleManualReplan() {
    setReplanning(true)
    setReplanMsg(null)
    try {
      const res = await fetch(`/api/dispatcher/replan?stationId=${encodeURIComponent(stationId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventType: "manual", note: "Manual replan from dashboard" }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setReplanMsg({ ok: false, text: json?.message ?? json?.error ?? "Replan failed" })
      } else if (!json.ran) {
        setReplanMsg({ ok: false, text: `Did not run: ${json.reason ?? "unknown"}` })
      } else if (json.lastPhase === "error") {
        // The replan ran but the resulting dispatch tick failed (e.g. Amperio
        // rejected the command). Surface it as an error, not a success.
        setReplanMsg({ ok: false, text: "Replanned, but dispatch failed — see activity log" })
      } else if (json.lastPhase === "skipped") {
        setReplanMsg({ ok: true, text: "Replanned (skipped — another pinger is driving)" })
      } else {
        setReplanMsg({
          ok: true,
          text: json.dispatched ? "Replanned and dispatched" : `Replanned (${json.lastPhase ?? "done"})`,
        })
      }
    } catch (err) {
      setReplanMsg({ ok: false, text: (err as Error).message })
    } finally {
      setReplanning(false)
      onReplanned?.()
      // Clear the inline message after a few seconds.
      setTimeout(() => setReplanMsg(null), 5000)
    }
  }

  const rows = useMemo<ChartRow[]>(() => {
    if (!current) return []
    // Index the previous plan by absolute slot so the overlay aligns in time,
    // not by step index (the anchor slot shifts between replans).
    const prevBySlot = new Map<number, PlanSnapshot["steps"][number]>()
    if (previous) for (const s of previous.steps) prevBySlot.set(s.slot, s)

    // Classify cheap/pricey with the DISPATCH ALGORITHM'S OWN day-spread rule
    // (lib/optimizer/cheap-slot.ts analyzeDayPrices, same V5 params the engine solves
    // with) — not a fixed "N cheapest" rank. Cheap = price ≤ cheapCutoff
    // (min + frac·spread); pricey = the mirrored top of the spread.
    const horizonPrices = current.steps
      .map((s) => s.priceEurMwh)
      .filter((p): p is number => Number.isFinite(p))
    const stats = analyzeDayPrices(horizonPrices, OPTIMIZER_DEFAULTS)
    const spread = stats.maxP - stats.minP
    const frac = OPTIMIZER_DEFAULTS.cheapSpreadFrac ?? 0.3
    const expensiveCutoff = stats.maxP - frac * spread
    const cheapSlots = new Set<number>(
      spread > 0
        ? current.steps.filter((s) => s.priceEurMwh <= stats.cheapCutoff).map((s) => s.slot)
        : [],
    )
    const priceySlots = new Set<number>(
      spread > 0
        ? current.steps.filter((s) => s.priceEurMwh >= expensiveCutoff).map((s) => s.slot)
        : [],
    )

    return current.steps.map((s, i) => {
      const prev = prevBySlot.get(s.slot)
      const d = new Date(s.ts)
      return {
        step: i,
        label: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
        demand: s.demandKw,
        price: s.priceEurMwh,
        cheap: cheapSlots.has(s.slot),
        pricey: priceySlots.has(s.slot),
        grid: s.gridKw,
        soc: s.socPct,
        reserve: s.reserveFloorPct,
        gridPrev: prev?.gridKw ?? null,
        socPrev: prev?.socPct ?? null,
      }
    })
  }, [current, previous])

  // Per-slot cheap-window shading, coloured by price: the cheaper the slot, the
  // greener (more opaque) its column. We shade each cheap slot individually
  // rather than merging runs — recharts 2.x ReferenceArea is INCLUSIVE of the
  // x2 band, so a single-category area (x1 === x2) covers exactly one 15-min slot
  // and never bleeds into the neighbouring (non-cheap) slot.
  const cheapShades = useMemo(() => {
    const prices = rows.filter((r) => r.cheap && r.price != null).map((r) => r.price as number)
    if (prices.length === 0) return [] as { label: string; opacity: number }[]
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const span = max - min || 1
    // Cheapest slot → most opaque green; the priciest of the cheap-set → faint.
    const MAX_OP = 0.42
    const MIN_OP = 0.1
    return rows
      .filter((r) => r.cheap && r.price != null)
      .map((r) => {
        const t = ((r.price as number) - min) / span // 0 = cheapest, 1 = least cheap
        return { label: r.label, opacity: MAX_OP - t * (MAX_OP - MIN_OP) }
      })
  }, [rows])

  if (!current) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="size-5 text-primary" />
            Dispatch Plan
          </CardTitle>
          <CardDescription>
            The optimizer&apos;s receding-horizon plan. It appears here after the first replan
            event solves a horizon.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground">
            <Brain className="size-8 opacity-40" />
            <p className="text-sm">No plan yet — waiting for the first replan to solve the horizon.</p>
            <div className="flex flex-col items-center gap-2">
              <Button onClick={handleManualReplan} disabled={replanning} className="gap-2">
                {replanning ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {replanning ? "Replanning…" : "Replan now"}
              </Button>
              {replanMsg && (
                <span className={cn("text-xs", replanMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                  {replanMsg.text}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Diff vs the previous plan (time-aligned on the committed slot).
  const prevAtCommitted = previous?.steps.find((s) => s.slot === current.baseSlot) ?? null
  const dGrid = prevAtCommitted ? current.clearanceKw - prevAtCommitted.gridKw : null
  const dReserve = previous ? current.reserveFloorStep1Pct - previous.reserveFloorStep1Pct : null

  const trigger = current.eventType ? (TRIGGER_LABEL[current.eventType] ?? current.eventType) : "Scheduled"
  const horizonHours = (current.horizonSteps * current.stepHours).toFixed(1)
  const infeasible = current.status !== "optimal"

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Brain className="size-5 text-primary" />
              Dispatch Plan
              <Badge variant="secondary" className="font-mono">
                {current.horizonSteps} steps · {horizonHours}h
              </Badge>
              {current.adaptiveReserve && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <ShieldCheck className="size-3" />
                  Adaptive reserve
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Latest solved horizon · replanned {fmtAgo(Date.now() - current.solvedAt)} ·{" "}
              <span className="font-medium text-foreground">{trigger}</span>
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge
              variant={infeasible ? "destructive" : "default"}
              className={cn(!infeasible && "bg-emerald-600 hover:bg-emerald-600 text-white")}
            >
              {infeasible ? `LP ${current.status}` : "Optimal"}
            </Badge>
            <Button size="sm" onClick={handleManualReplan} disabled={replanning} className="gap-1.5">
              {replanning ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {replanning ? "Replanning…" : "Replan now"}
            </Button>
            {replanMsg && (
              <span className={cn("text-right text-xs", replanMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                {replanMsg.text}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── DAM price strip — horizontally aligned with the trajectory below ── */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-medium text-muted-foreground">Day-ahead price (€/MWh)</span>
            <span className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-sm" style={{ background: COLORS.negative }} />
                free / negative
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-sm" style={{ background: COLORS.cheap }} />
                cheap
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-sm" style={{ background: COLORS.pricey }} />
                peak
              </span>
            </span>
          </div>
          <div className="h-[84px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                syncId="mpc-plan"
                barCategoryGap="12%"
              >
                {/* Left axis — €/MWh. Width MUST match the trajectory's left axis (44). */}
                <YAxis
                  yAxisId="price"
                  tick={{ fontSize: 10, fill: COLORS.axis }}
                  width={44}
                  tickFormatter={(v: number) => `${Math.round(v)}`}
                />
                {/* Invisible right gutter — MUST reserve the same 40px the SOC axis
                    uses below so the plot area width matches column-for-column.
                    Note: `hide` collapses the axis to 0px width (breaking alignment),
                    so instead we keep width and hide only the ticks/lines. */}
                <YAxis
                  yAxisId="rightGutter"
                  orientation="right"
                  width={40}
                  tick={false}
                  tickLine={false}
                  axisLine={false}
                />
                {/* Category axis shared with the chart below; labels hidden here
                    (the trajectory chart shows the time ticks).
                    CRITICAL: both this strip and the trajectory below are forced to
                    a BAND scale (scale="band"). Each slot then owns an equal-width
                    band; the bar fills that band (minus barCategoryGap) and the
                    trajectory's line/areas sit at the same band centres — so a price
                    bar lines up edge-for-edge with its slot interval below. */}
                <XAxis dataKey="label" scale="band" padding="no-gap" hide />
                <Tooltip
                  cursor={{ fill: "hsl(0 0% 50% / 0.08)" }}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(0 0% 80% / 0.4)" }}
                  formatter={(value: number) => [`${value.toFixed(1)} €/MWh`, "DA price"]}
                />
                {/* Zero baseline so negative / near-free prices read as an
                    intentional dip below the line, not as missing data. */}
                <ReferenceLine yAxisId="price" y={0} stroke="hsl(0 0% 55% / 0.5)" strokeWidth={1} />
                <Bar
                  yAxisId="price"
                  dataKey="price"
                  name="DA price"
                  isAnimationActive={false}
                  radius={[2, 2, 0, 0]}
                >
                  {rows.map((r, i) => {
                    const negative = (r.price ?? 0) < 0
                    const fill = negative
                      ? COLORS.negative
                      : r.cheap
                        ? COLORS.cheap
                        : r.pricey
                          ? COLORS.pricey
                          : COLORS.priceBar
                    return (
                      <Cell
                        key={`price-${i}`}
                        fill={fill}
                        fillOpacity={negative || r.cheap || r.pricey ? 0.9 : 0.55}
                      />
                    )
                  })}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Trajectory — grid import + projected SOC + reserve + EV demand ── */}
        <div className="h-[340px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} syncId="mpc-plan">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 80% / 0.3)" vertical={false} />

              {/* Per-slot cheap-window shading — coloured by price (cheapest =
                  greenest). Each area is a single category (x1 === x2); recharts
                  ReferenceArea is inclusive of the x2 band, so this covers exactly
                  one 15-min slot and never bleeds into the next, non-cheap slot. */}
              {cheapShades.map((b, i) => (
                <ReferenceArea
                  key={`cheap-${i}`}
                  yAxisId="kw"
                  x1={b.label}
                  x2={b.label}
                  fill={COLORS.cheap}
                  fillOpacity={b.opacity}
                  ifOverflow="extendDomain"
                />
              ))}

              {/* Committed "now" column highlight — a faint indigo wash behind
                  step 0 that ties to the "now" marker and the full-strength
                  grid bar, making the current decision the focal point. */}
              {rows[0] && (
                <ReferenceArea
                  yAxisId="kw"
                  x1={rows[0].label}
                  x2={rows[0].label}
                  fill={COLORS.now}
                  fillOpacity={0.1}
                  ifOverflow="extendDomain"
                />
              )}

              <XAxis
                dataKey="label"
                scale="band"
                padding="no-gap"
                tick={{ fontSize: 11, fill: COLORS.axis }}
                interval="preserveStartEnd"
                minTickGap={32}
              />
              {/* Hidden twin band axis so the previous-plan grid bars render at
                  FULL band width and overlay the current-plan bars, instead of
                  being shrunk side-by-side (recharts groups same-axis bars). */}
              <XAxis
                xAxisId="gridPrev"
                dataKey="label"
                scale="band"
                padding="no-gap"
                hide
              />
              {/* Left axis — kW (grid import + EV demand) */}
              <YAxis
                yAxisId="kw"
                tick={{ fontSize: 11, fill: COLORS.axis }}
                width={44}
                label={{ value: "kW", angle: -90, position: "insideLeft", fontSize: 11, fill: COLORS.axis }}
              />
              {/* Right axis — SOC % and reserve % */}
              <YAxis
                yAxisId="pct"
                orientation="right"
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: COLORS.axis }}
                width={40}
                label={{ value: "%", angle: 90, position: "insideRight", fontSize: 11, fill: COLORS.axis }}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid hsl(0 0% 80% / 0.4)",
                }}
                formatter={(value: number, name: string) => {
                  if (value == null) return ["—", name]
                  const isPct = name.includes("SOC") || name.includes("Reserve")
                  return [isPct ? `${value.toFixed(0)}%` : `${value.toFixed(1)} kW`, name]
                }}
              />
              {/* Adaptive reserve floor — amber band the SOC must stay above */}
              <Area
                yAxisId="pct"
                type="stepAfter"
                dataKey="reserve"
                name="Reserve floor"
                stroke={COLORS.reserve}
                strokeWidth={1.5}
                strokeDasharray="2 2"
                fill={COLORS.reserve}
                fillOpacity={0.14}
                dot={false}
                isAnimationActive={false}
              />

              {/* Forecast EV demand — proxy for car-appearance/session likelihood */}
              <Area
                yAxisId="kw"
                type="monotone"
                dataKey="demand"
                name="Forecast EV demand"
                stroke={COLORS.demand}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                fill={COLORS.demand}
                fillOpacity={0.12}
                dot={false}
                isAnimationActive={false}
              />

              {/* Previous plan overlay — per-slot column (faded outline). Rendered
                  as a Bar so it fills its slot edge-to-edge, exactly matching the
                  background shading and the top price strip. */}
              {previous && (
                <Bar
                  yAxisId="kw"
                  xAxisId="gridPrev"
                  dataKey="gridPrev"
                  name="Grid import (prev plan)"
                  fill={COLORS.gridPrev}
                  fillOpacity={0.18}
                  stroke={COLORS.gridPrev}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  isAnimationActive={false}
                />
              )}
              {previous && (
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="socPrev"
                  name="SOC (prev plan)"
                  stroke={COLORS.socPrev}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              )}

              {/* Current plan — planned grid import per step (per-slot column,
                  fills its slot exactly) + projected SOC. The COMMITTED step 0
                  is drawn at full strength; future intent is lighter so the eye
                  lands on the decision being made right now. */}
              <Bar
                yAxisId="kw"
                dataKey="grid"
                name="Grid import (plan)"
                fill={COLORS.grid}
                isAnimationActive={false}
              >
                {rows.map((_, i) => (
                  <Cell key={`grid-${i}`} fillOpacity={i === 0 ? 0.95 : 0.5} />
                ))}
              </Bar>
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="soc"
                name="Projected SOC"
                stroke={COLORS.soc}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />

              {/* Committed "now" marker — solid accent line on step 0 so the
                  decision being executed right now is the visual anchor. */}
              <ReferenceLine
                yAxisId="kw"
                x={rows[0]?.label}
                stroke={COLORS.now}
                strokeWidth={2}
                label={{
                  value: "now",
                  fontSize: 10,
                  fontWeight: 600,
                  fill: COLORS.now,
                  position: "insideTopLeft",
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* ── Compact legend — one row, no colour repeated. "Previous plan" is a
               convention (dashed / faded) rather than its own swatches, so the
               replan delta reads without doubling the legend. ─────────────── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-muted-foreground">
          <LegendKey color={COLORS.grid} label="Grid import" />
          <LegendKey color={COLORS.soc} label="Projected SOC" variant="line" />
          <LegendKey color={COLORS.reserve} label="Reserve floor" variant="dashed" />
          <LegendKey color={COLORS.demand} label="Forecast EV demand" variant="dashed" />
          {previous && (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-4 border-t-2 border-dashed"
                style={{ borderColor: COLORS.axis }}
              />
              dashed &amp; faded = previous plan
            </span>
          )}
        </div>

        {/* ── COMMAND STRIP — what the plan commits right now, and why ── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DeltaStat
            label="Committed grid import"
            current={fmtKw(current.clearanceKw)}
            delta={dGrid}
            unit=" kW"
            icon={Zap}
          />
          <DeltaStat
            label="Reserve floor (step 1)"
            current={fmtPct(current.reserveFloorStep1Pct)}
            delta={dReserve}
            unit="%"
            icon={ShieldCheck}
          />
        </div>

        {/* REAL-TIME RESERVE GUARD override — shown when the safety guard forced
            the committed setpoint above the LP's choice, so the plan's committed
            value (and the first grid bar) reflect the wire, not the LP intent. */}
        {current.reserveGuardEngaged && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <p className="text-sm font-medium leading-snug text-pretty text-amber-800 dark:text-amber-300">
                {(current.reserveGuardReason && GUARD_REASON_LABEL[current.reserveGuardReason]) ??
                  "Reserve guard forced grid import to full capacity this slot."}
              </p>
              {current.lpClearanceKw != null && (
                <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
                  Optimiser alone would have committed {fmtKw(current.lpClearanceKw)}; the guard is sending{" "}
                  {fmtKw(current.clearanceKw)} (full cap).
                </p>
              )}
            </div>
          </div>
        )}

        {/* Why the committed action is what it is, plus the SOC-driven dynamic
            horizon actually used this solve. firmCommitReason comes straight
            from the kernel; "lp" means no firm override fired. When the reserve
            guard is engaged its notice above is authoritative, so we suppress
            the (now-contradictory) LP firm-reason line. */}
        {((current.firmCommitReason && !current.reserveGuardEngaged) || current.effectiveHorizonSteps != null) && (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
            <Brain className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              {current.firmCommitReason && !current.reserveGuardEngaged && (
                <p className="text-sm leading-snug text-pretty">
                  {FIRM_REASON_LABEL[current.firmCommitReason] ?? current.firmCommitReason}
                </p>
              )}
              {current.effectiveHorizonSteps != null && (
                <p className="text-xs text-muted-foreground">
                  Lookahead horizon: {current.effectiveHorizonSteps} steps (
                  {(current.effectiveHorizonSteps / 4).toFixed(current.effectiveHorizonSteps % 4 === 0 ? 0 : 1)} h)
                  {" — shrinks as state of charge drops so a low battery acts on the nearest cheap slot."}
                </p>
              )}
            </div>
          </div>
        )}

        {previous == null && (
          <p className="text-xs text-muted-foreground">
            This is the first solved plan — the dashed overlay and deltas appear once a second replan
            produces a plan to compare against.
          </p>
        )}

        {/* ── DETAILS — how to read the chart (collapsed by default) ── */}
        <details className="group rounded-lg border bg-muted/20 px-3 py-2">
          <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            How to read this chart
          </summary>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          The <span className="font-medium text-foreground">price strip</span> at the top shows the day-ahead
          €/MWh for each 15-min slot, aligned column-for-column with the trajectory below —{" "}
          <span className="font-medium" style={{ color: COLORS.cheap }}>
            green
          </span>{" "}
          bars are the slots the dispatch rule classifies as cheap — price within the bottom{" "}
          {((OPTIMIZER_DEFAULTS.cheapSpreadFrac ?? 0.3) * 100).toFixed(0)}% of the horizon&apos;s min→max
          spread, the same cutoff the optimizer uses for buy-now and firm cheap+car import (also shaded
          on the chart) — and{" "}
          <span className="font-medium" style={{ color: COLORS.pricey }}>
            red
          </span>{" "}
          the mirrored top of the spread (the peak it avoids importing in). The green per-slot column is the{" "}
          <span className="font-medium text-foreground">grid-import command</span> the optimizer sends each slot —
          the station runs in <span className="font-medium text-foreground">Automatic mode</span>, so we drive{" "}
          <code className="rounded bg-muted px-1 py-0.5">P_grid_request</code> (how much to import now — 0 when idle
          or discharging, the planned draw when charging the buffer from grid) plus{" "}
          <code className="rounded bg-muted px-1 py-0.5">soc_cp_max</code> for the charge ceiling. Aux load is
          auto-drawn by the device and can&apos;t be offset by the battery. Only the committed first step
          ({fmtKw(current.clearanceKw)}) is sent this cycle; the rest is the optimizer&apos;s intent across the
          receding horizon. The blue SOC curve is the buffer trajectory the plan implies, held above the amber
          adaptive reserve floor, while the grey dashed band is the forecast EV demand (a proxy for how likely a
          car/session is in each slot).
          </p>
        </details>

        {/* Plan logger — replan history; drill down a row for its input + output */}
        <ReplanLog entries={replanLog ?? []} />
      </CardContent>
    </Card>
  )
}
