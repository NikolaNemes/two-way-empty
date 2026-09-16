"use client"

/**
 * Charging Session Vertical Timeline
 * ──────────────────────────────────
 *
 * A scrollable, top-to-bottom list of EV charging sessions for the
 * selected operating period. Each session card shows:
 *
 *  • Time range, vehicle, plate, connector, energy delivered, SOC
 *    arrival → target.
 *  • EV fulfilment breakdown — for the SAME minutes the car was
 *    plugged in, where did the kWh come from? Three buckets per
 *    control mode:
 *      – BESS discharge (the on-site battery served the car)
 *      – Grid import   (the grid topped the car up directly)
 *      – PV / aux offset (currently 0 for this prototype but kept
 *        in the data model so we don't have to re-thread later)
 *  • Inner mini-timeline rendering the per-frame EV power split
 *    twice — once for the BMS (Auto) reference run, once for the
 *    Optimized (manual) run — stacked so the user can SEE which
 *    asset served which minute under each strategy and compare
 *    the same session side-by-side.
 *
 * Why a separate file
 * ───────────────────
 * The existing horizontal `SessionTimeline` in
 * `prototype-day-sim-screen.tsx` is a wide, two-row strip showing
 * sessions across an X-axis. That view is great for spotting
 * overlap and density across a day, but terrible for inspecting
 * what actually HAPPENED inside each session. The user asked for
 * a vertical, scrollable view because they want to read each
 * session like a row in a list and see its fulfilment at a glance,
 * including a direct BMS-vs-Optimizer A/B inside the row. Doing
 * that as a true list — one card per session, full width per row —
 * makes per-session detail readable without competing with
 * neighbouring sessions for horizontal space.
 *
 * Sign conventions (matches `lib/prototype-telemetry.ts`):
 *  • battery.power_w  > 0  → CHARGING  (energy into pack)
 *  • battery.power_w  < 0  → DISCHARGING (energy out of pack)
 *  • grid.P_grid_w    > 0  → IMPORTING from grid
 *  • grid.P_grid_w    < 0  → EXPORTING to grid
 *  • charger.P_EV_w   > 0  → delivering to the car
 *
 * The fulfilment split uses the same proportional-attribution
 * method as `buildEvSourcingPoints` in the day-sim screen so the
 * two visualizations stay numerically consistent.
 */

import { useMemo, useState } from "react"
import { Battery, ChevronDown, ChevronUp, PlugZap, Zap, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  type ScheduledSession,
  type TelemetryFrame,
} from "@/lib/prototype-telemetry"

// ─────────────────────────────────────────────────────────────────
// Per-frame fulfilment point for ONE session in ONE control mode.
// ─────────────────────────────────────────────────────────────────
interface FulfilmentSample {
  /** ms since the start of the session — used as the inner X axis. */
  t_ms: number
  /** Total power the car drew at this frame, kW. */
  evKw: number
  /** Portion that came out of the BESS, kW. */
  fromBessKw: number
  /** Portion that came directly from the grid, kW. */
  fromGridKw: number
}

interface FulfilmentTotals {
  /** kWh delivered from the BESS to the EV across the whole session. */
  bessKwh: number
  /** kWh imported from the grid to feed the EV across the whole session. */
  gridKwh: number
  /** Total kWh delivered to the EV across the session. */
  totalKwh: number
}

interface ModeFulfilment {
  samples: FulfilmentSample[]
  totals: FulfilmentTotals
  /** Peak instantaneous EV power across the session, kW. Used for axis scaling. */
  peakEvKw: number
}

interface SessionFulfilment {
  optimized: ModeFulfilment
  baseline: ModeFulfilment
  /** Shared peak across BOTH modes so the inner mini-timelines use one Y axis. */
  sharedPeakKw: number
  /** Shared session duration in ms, derived from the longer of the two runs. */
  durationMs: number
}

/**
 * Build the per-frame fulfilment samples for a single session under one
 * control-mode telemetry history.
 *
 * The proportional attribution mirrors `buildEvSourcingPoints` so the
 * vertical schedule and the EV-Sourcing chart never disagree about how
 * much of the car's draw came from which source.
 */
function buildModeFulfilment(
  history: TelemetryFrame[],
  session: ScheduledSession,
  connectorIndex: 0 | 1,
  startMs: number,
  endMs: number,
): ModeFulfilment {
  const samples: FulfilmentSample[] = []
  let bessKwh = 0
  let gridKwh = 0
  let peak = 0

  // Walk frames in window [startMs, endMs]. We integrate kWh across each
  // step using the trailing-edge rectangle method (consistent with the
  // existing diagnostics passes elsewhere in the codebase).
  let prevTms: number | null = null
  let prevBessKw = 0
  let prevGridKw = 0

  for (const f of history) {
    const tms = new Date(f.ts).getTime()
    if (tms < startMs || tms > endMs) {
      prevTms = null // reset rectangle accumulator across gaps
      continue
    }
    const charger = f.chargers[connectorIndex]
    if (!charger) continue
    const evW = Math.max(0, charger.P_EV_w ?? 0)
    const auxW = Math.max(0, f.grid.P_aux_w)
    const batSumW = f.batteries.reduce((acc, b) => acc + b.power_w, 0)
    // Battery DISCHARGING when signed power < 0. We attribute the discharge
    // to EV demand proportionally to its share of total consumption.
    const bessOutW = Math.max(0, -batSumW)
    const evShare = evW + auxW > 0 ? evW / (evW + auxW) : 0
    const fromBessW = Math.min(evW, bessOutW * evShare)
    const fromGridW = Math.max(0, evW - fromBessW)
    const evKw = evW / 1000
    const fromBessKw = fromBessW / 1000
    const fromGridKw = fromGridW / 1000

    samples.push({
      t_ms: tms - startMs,
      evKw,
      fromBessKw,
      fromGridKw,
    })

    if (evKw > peak) peak = evKw

    if (prevTms != null) {
      const dt_h = (tms - prevTms) / 3_600_000
      // Trapezoidal integration would be marginally better here but the
      // delivered kWh in each bucket is an attribution, not a physical
      // measurement, so trailing-edge stays consistent with the rest of
      // the day-sim diagnostics passes that integrate the same way.
      bessKwh += prevBessKw * dt_h
      gridKwh += prevGridKw * dt_h
    }
    prevTms = tms
    prevBessKw = fromBessKw
    prevGridKw = fromGridKw
  }

  return {
    samples,
    peakEvKw: peak,
    totals: {
      bessKwh,
      gridKwh,
      totalKwh: bessKwh + gridKwh,
    },
  }
}

/**
 * Resolve a session's wall-clock window from either its `arriveElapsed`
 * (multi-day historical mode) or `arriveHour` (single-day sim mode).
 *
 * For historical mode we use the period start (= first frame timestamp)
 * as the time origin so absolute Date math lines up with frame timestamps.
 * For the simulated single-day mode we still need an absolute window —
 * we anchor it to the first frame's UTC date and add the session's
 * `arriveHour` interpreted as elapsed hours since the day-sim's origin.
 */
function resolveSessionWindowMs(
  session: ScheduledSession,
  history: TelemetryFrame[],
): { startMs: number; endMs: number } | null {
  if (history.length < 2) return null
  const t0 = new Date(history[0].ts).getTime()
  if (session.arriveElapsed != null && session.departElapsed != null) {
    return {
      startMs: t0 + session.arriveElapsed * 3_600_000,
      endMs: t0 + session.departElapsed * 3_600_000,
    }
  }
  // Single-day sim: arriveHour is in hours since DAY_START_HOUR; the
  // first frame already corresponds to that origin in this layout, so
  // we can fall back to it directly.
  const startElapsed = session.arriveHour - (history[0] ? 0 : 0)
  return {
    startMs: t0 + startElapsed * 3_600_000,
    endMs: t0 + session.departHour * 3_600_000,
  }
}

function buildSessionFulfilment(
  session: ScheduledSession,
  historyOptimized: TelemetryFrame[],
  historyBaseline: TelemetryFrame[],
): SessionFulfilment | null {
  const winOpt = resolveSessionWindowMs(session, historyOptimized)
  const winBase = resolveSessionWindowMs(session, historyBaseline)
  if (!winOpt || !winBase) return null

  const connectorIndex = (session.connector - 1) as 0 | 1
  const optimized = buildModeFulfilment(
    historyOptimized,
    session,
    connectorIndex,
    winOpt.startMs,
    winOpt.endMs,
  )
  const baseline = buildModeFulfilment(
    historyBaseline,
    session,
    connectorIndex,
    winBase.startMs,
    winBase.endMs,
  )

  const sharedPeakKw = Math.max(optimized.peakEvKw, baseline.peakEvKw, 1) // floor at 1 kW so flat sessions still draw
  const durationMs = Math.max(winOpt.endMs - winOpt.startMs, winBase.endMs - winBase.startMs)
  return { optimized, baseline, sharedPeakKw, durationMs }
}

// ─────────────────────────────────────────────────────────────────
// Inner mini-timeline — a stacked area: Grid (amber) + BESS (emerald).
// Width = 100 % of the right column; height fixed at 56 px so two
// rows (BMS + Optimizer) stack comfortably inside the card.
// ─────────────────────────────────────────────────────────────────
function FulfilmentMiniChart({
  samples,
  durationMs,
  peakKw,
  emptyLabel,
}: {
  samples: FulfilmentSample[]
  durationMs: number
  peakKw: number
  emptyLabel: string
}) {
  const W = 1000 // SVG viewBox width — scales fluidly to the parent column
  const H = 56
  const padL = 0
  const padR = 0
  const padT = 4
  const padB = 4

  if (samples.length === 0 || durationMs <= 0) {
    return (
      <div className="h-14 rounded border border-border/60 bg-muted/30 grid place-items-center text-[10px] text-muted-foreground italic">
        {emptyLabel}
      </div>
    )
  }

  const xAt = (t_ms: number) =>
    padL + ((t_ms / durationMs) * (W - padL - padR))
  const yAt = (kw: number) =>
    H - padB - (kw / peakKw) * (H - padT - padB)

  // Build two polygons: grid (full EV stack), BESS (only the BESS portion).
  // Drawing order: amber GRID first as the full envelope, then green BESS
  // on top from the bottom up. This creates the visual "BESS at the
  // bottom, grid stacked above" effect.
  const totalPath = (() => {
    const top = samples.map((s) => `${xAt(s.t_ms)},${yAt(s.evKw)}`).join(" L ")
    return `M ${xAt(samples[0].t_ms)},${H - padB} L ${top} L ${xAt(samples[samples.length - 1].t_ms)},${H - padB} Z`
  })()
  const bessPath = (() => {
    const top = samples.map((s) => `${xAt(s.t_ms)},${yAt(s.fromBessKw)}`).join(" L ")
    return `M ${xAt(samples[0].t_ms)},${H - padB} L ${top} L ${xAt(samples[samples.length - 1].t_ms)},${H - padB} Z`
  })()

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-14 rounded border border-border/60 bg-muted/20"
      aria-hidden
    >
      {/* baseline */}
      <line
        x1={0}
        x2={W}
        y1={H - padB}
        y2={H - padB}
        className="stroke-border"
        strokeWidth={0.5}
      />
      {/* total = grid (amber); the BESS layer painted over it cuts the
          amber away from the bottom upward, so visible amber = grid share. */}
      <path d={totalPath} className="fill-amber-500/55 stroke-amber-600/70" strokeWidth={0.75} />
      <path d={bessPath} className="fill-emerald-500/65 stroke-emerald-600/80" strokeWidth={0.75} />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────
// Bar showing the kWh split between BESS, Grid for one mode.
// Uses flexbox grow proportions so the bar fills the row width with
// segments sized by their kWh share. Zero-kWh segments collapse out.
// ─────────────────────────────────────────────────────────────────
function FulfilmentSplitBar({ totals }: { totals: FulfilmentTotals }) {
  const total = Math.max(totals.totalKwh, 0.001)
  const bessPct = (totals.bessKwh / total) * 100
  const gridPct = (totals.gridKwh / total) * 100
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
      {bessPct > 0.5 && (
        <div
          className="bg-emerald-500"
          style={{ width: `${bessPct}%` }}
          title={`BESS: ${totals.bessKwh.toFixed(1)} kWh (${bessPct.toFixed(0)}%)`}
        />
      )}
      {gridPct > 0.5 && (
        <div
          className="bg-amber-500"
          style={{ width: `${gridPct}%` }}
          title={`Grid: ${totals.gridKwh.toFixed(1)} kWh (${gridPct.toFixed(0)}%)`}
        />
      )}
    </div>
  )
}

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—"
  const totalMin = Math.round(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// ─────────────────────────────────────────────────────────────────
// One row in the vertical schedule.
// ─────────────────────────────────────────────────────────────────
function SessionRowCard({
  session,
  windowMs,
  fulfilment,
  isExpandedDefault,
}: {
  session: ScheduledSession
  windowMs: { startMs: number; endMs: number }
  fulfilment: SessionFulfilment | null
  isExpandedDefault: boolean
}) {
  const [expanded, setExpanded] = useState(isExpandedDefault)

  // Per-mode summary numbers — these surface the headline takeaway
  // even when the row is collapsed, so the user doesn't need to
  // expand every card to skim the comparison.
  const optBess = fulfilment?.optimized.totals.bessKwh ?? 0
  const optGrid = fulfilment?.optimized.totals.gridKwh ?? 0
  const optTot = fulfilment?.optimized.totals.totalKwh ?? 0
  const baseBess = fulfilment?.baseline.totals.bessKwh ?? 0
  const baseGrid = fulfilment?.baseline.totals.gridKwh ?? 0
  const baseTot = fulfilment?.baseline.totals.totalKwh ?? 0

  const optBessPct = optTot > 0 ? (optBess / optTot) * 100 : 0
  const baseBessPct = baseTot > 0 ? (baseBess / baseTot) * 100 : 0
  const bessPctDelta = optBessPct - baseBessPct
  const gridDeltaKwh = optGrid - baseGrid // negative = optimizer imported less

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header row — always visible. Click to expand/collapse. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-stretch text-left hover:bg-muted/30 transition-colors"
      >
        {/* Left: vehicle/session metadata */}
        <div className="flex-1 p-3 flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-mono shrink-0",
                session.connector === 1
                  ? "border-violet-500/40 text-violet-600 dark:text-violet-400"
                  : "border-sky-500/40 text-sky-600 dark:text-sky-400",
              )}
            >
              C{session.connector}
            </Badge>
            <span className="text-sm font-semibold truncate">{session.vehicle}</span>
            <span className="text-[11px] text-muted-foreground font-mono shrink-0">{session.plate}</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {fmtClock(windowMs.startMs)} → {fmtClock(windowMs.endMs)}
            </span>
            <span className="text-muted-foreground/70">·</span>
            <span>{fmtDate(windowMs.startMs)}</span>
            <span className="text-muted-foreground/70">·</span>
            <span>{fmtDuration(windowMs.endMs - windowMs.startMs)}</span>
          </div>
          <div className="text-[11px] text-muted-foreground italic truncate">{session.context}</div>
        </div>

        {/* Middle: SOC + energy headline */}
        <div className="hidden md:flex flex-col justify-center gap-1 px-3 border-l border-border/60 min-w-[140px]">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Battery className="size-3" />
            SOC {session.arrivalSoc}% → {session.targetSoc}%
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Zap className="size-3" />
            {optTot.toFixed(1)} kWh delivered
          </div>
        </div>

        {/* Right: comparison summary chips */}
        <div className="hidden lg:flex flex-col justify-center gap-1 px-3 border-l border-border/60 min-w-[200px]">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Optimizer vs BMS</div>
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className={cn("inline-flex items-center gap-1", bessPctDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
              BESS {bessPctDelta >= 0 ? "+" : ""}{bessPctDelta.toFixed(0)} pp
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span className={cn("inline-flex items-center gap-1", gridDeltaKwh <= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
              Grid {gridDeltaKwh <= 0 ? "" : "+"}{gridDeltaKwh.toFixed(1)} kWh
            </span>
          </div>
        </div>

        <div className="flex items-center justify-center px-3 border-l border-border/60 text-muted-foreground">
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </div>
      </button>

      {/* Expanded body — fulfilment breakdowns, two stacked mini-charts. */}
      {expanded && fulfilment && (
        <div className="border-t border-border/60 p-3 bg-muted/10 space-y-4">
          {/* Two-column compare — Optimizer (manual) on the left, BMS Auto on the right.
              On mobile they collapse to a single column. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Optimized run */}
            <FulfilmentBlock
              title="Optimizer (manual)"
              accent="emerald"
              fulfilment={fulfilment.optimized}
              durationMs={fulfilment.durationMs}
              peakKw={fulfilment.sharedPeakKw}
              emptyLabel="No optimized telemetry for this window"
            />
            {/* Baseline / BMS run */}
            <FulfilmentBlock
              title="BMS (Auto)"
              accent="sky"
              fulfilment={fulfilment.baseline}
              durationMs={fulfilment.durationMs}
              peakKw={fulfilment.sharedPeakKw}
              emptyLabel="No baseline telemetry for this window"
            />
          </div>

          {/* Legend bar — same colour key as the EV-Sourcing chart on the
              main day-sim screen so users carry the mental model over. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground pt-2 border-t border-border/40">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded-sm bg-emerald-500/65 border border-emerald-600/80" />
              From BESS (battery discharge)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-2 rounded-sm bg-amber-500/55 border border-amber-600/70" />
              From Grid (direct import)
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5 font-mono">
              peak {fulfilment.sharedPeakKw.toFixed(0)} kW · shared Y-axis
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// One half of the side-by-side compare (header + bar + mini-chart).
// ─────────────────────────────────────────────────────────────────
function FulfilmentBlock({
  title,
  accent,
  fulfilment,
  durationMs,
  peakKw,
  emptyLabel,
}: {
  title: string
  accent: "emerald" | "sky"
  fulfilment: ModeFulfilment
  durationMs: number
  peakKw: number
  emptyLabel: string
}) {
  const accentClass =
    accent === "emerald"
      ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
      : "border-sky-500/40 text-sky-700 dark:text-sky-400"

  const t = fulfilment.totals
  const bessPct = t.totalKwh > 0 ? (t.bessKwh / t.totalKwh) * 100 : 0
  const gridPct = t.totalKwh > 0 ? (t.gridKwh / t.totalKwh) * 100 : 0

  return (
    <div className="rounded-md border border-border/60 bg-card p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={cn("text-[10px] font-mono", accentClass)}>
          {title}
        </Badge>
        <span className="text-[11px] font-mono text-muted-foreground">
          {t.totalKwh.toFixed(1)} kWh total
        </span>
      </div>

      {/* Split bar */}
      <FulfilmentSplitBar totals={t} />

      {/* Numeric breakdown */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-emerald-500" />
          <span className="text-muted-foreground">BESS</span>
          <span className="ml-auto font-mono">{t.bessKwh.toFixed(1)} kWh</span>
          <span className="font-mono text-muted-foreground/70">({bessPct.toFixed(0)}%)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-amber-500" />
          <span className="text-muted-foreground">Grid</span>
          <span className="ml-auto font-mono">{t.gridKwh.toFixed(1)} kWh</span>
          <span className="font-mono text-muted-foreground/70">({gridPct.toFixed(0)}%)</span>
        </div>
      </div>

      {/* Mini stacked timeline */}
      <FulfilmentMiniChart
        samples={fulfilment.samples}
        durationMs={durationMs}
        peakKw={peakKw}
        emptyLabel={emptyLabel}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Public component
// ─────────────────────────────────────────────────────────────────
export function ChargingSessionVerticalTimeline({
  sessions,
  historyOptimized,
  historyBaseline,
  /** Auto-expand the first N sessions for an immediate "show me, don't make me click" feel. */
  initiallyExpandedCount = 1,
}: {
  sessions: readonly ScheduledSession[]
  historyOptimized: TelemetryFrame[]
  historyBaseline: TelemetryFrame[]
  initiallyExpandedCount?: number
}) {
  // Sort sessions chronologically — the vertical list reads top-to-bottom
  // as "first session of the period at the top, last at the bottom".
  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const aH = a.arriveElapsed ?? a.arriveHour
      const bH = b.arriveElapsed ?? b.arriveHour
      return aH - bH
    })
  }, [sessions])

  // Pre-compute fulfilment so the children stay pure presentational.
  const items = useMemo(() => {
    return sorted.map((s) => {
      const win = resolveSessionWindowMs(s, historyOptimized) ?? resolveSessionWindowMs(s, historyBaseline)
      const fulfilment = buildSessionFulfilment(s, historyOptimized, historyBaseline)
      return { session: s, windowMs: win, fulfilment }
    })
  }, [sorted, historyOptimized, historyBaseline])

  // Aggregate header KPIs — sum BESS / grid kWh across all sessions and
  // both modes so the operator can see the period-wide effect at a
  // glance without scrolling through every card.
  const totals = useMemo(() => {
    let optBess = 0,
      optGrid = 0,
      baseBess = 0,
      baseGrid = 0
    for (const it of items) {
      if (!it.fulfilment) continue
      optBess += it.fulfilment.optimized.totals.bessKwh
      optGrid += it.fulfilment.optimized.totals.gridKwh
      baseBess += it.fulfilment.baseline.totals.bessKwh
      baseGrid += it.fulfilment.baseline.totals.gridKwh
    }
    return { optBess, optGrid, baseBess, baseGrid }
  }, [items])

  const [allExpanded, setAllExpanded] = useState<null | boolean>(null)

  if (sorted.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No charging sessions in the selected period.
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <PlugZap className="size-4 text-violet-500" />
          Charging Session Schedule
          <Badge variant="outline" className="text-[10px] font-mono">
            {sorted.length} {sorted.length === 1 ? "session" : "sessions"}
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => setAllExpanded((v) => (v === true ? null : true))}
            >
              Expand all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => setAllExpanded((v) => (v === false ? null : false))}
            >
              Collapse all
            </Button>
          </div>
        </CardTitle>

        {/* Period totals strip — gives the user the BMS-vs-Optimizer
            comparison at a glance before they scroll into individual rows. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-3">
          <KpiPill label="Optimizer · BESS → EV" value={`${totals.optBess.toFixed(1)} kWh`} accent="emerald" />
          <KpiPill label="Optimizer · Grid → EV" value={`${totals.optGrid.toFixed(1)} kWh`} accent="amber" />
          <KpiPill label="BMS · BESS → EV" value={`${totals.baseBess.toFixed(1)} kWh`} accent="sky" />
          <KpiPill label="BMS · Grid → EV" value={`${totals.baseGrid.toFixed(1)} kWh`} accent="zinc" />
        </div>
      </CardHeader>
      <CardContent>
        {/* Scrollable vertical list. Max height keeps the surrounding
            page navigable; on tall screens it grows up to ~70 vh. The
            inner spacing is tight enough that ~3 collapsed rows fit
            inside the default viewport. */}
        <div
          className="space-y-3 overflow-y-auto pr-1"
          style={{ maxHeight: "min(70vh, 720px)" }}
        >
          {items.map((it, i) => {
            if (!it.windowMs) return null
            const expanded =
              allExpanded === true
                ? true
                : allExpanded === false
                  ? false
                  : i < initiallyExpandedCount
            return (
              <SessionRowCard
                key={`${it.session.id}-${i}-${expanded}`}
                session={it.session}
                windowMs={it.windowMs}
                fulfilment={it.fulfilment}
                isExpandedDefault={expanded}
              />
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function KpiPill({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: "emerald" | "amber" | "sky" | "zinc"
}) {
  const dot =
    accent === "emerald"
      ? "bg-emerald-500"
      : accent === "amber"
        ? "bg-amber-500"
        : accent === "sky"
          ? "bg-sky-500"
          : "bg-zinc-500"
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <span className={cn("size-2 rounded-sm shrink-0", dot)} />
      <div className="flex flex-col min-w-0">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</span>
        <span className="text-sm font-mono font-semibold tabular-nums">{value}</span>
      </div>
    </div>
  )
}
