"use client"

// ════════════════════════════════════════════════════════════════════════
// DISPATCHING OVERVIEW — shared multi-layer view reused by Backtest Lab
// (optimized vs actual) and Dataset Explorer (BMS-only / non-optimised).
// ════════════════════════════════════════════════════════════════════════
//
// Four time-aligned layers on a shared numeric "hours from window start" axis:
//   1. Price + grid import (actual, plus optimized when in optimized mode)
//   2. C1/C2 charging-session strip (derived from charger state + energy
//      counter — see lib/charger-sessions, because p_ev_w is broken)
//   3. B1/B2 pack SOC curves
//   4. Import vs EV: grid import up, derived EV delivered mirrored below zero
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import { analyzeDayPrices, arbitrageWorthIt } from "@/lib/optimizer/cheap-slot"
import { OPTIMIZER_DEFAULTS } from "@/lib/optimizer/params"
import { formatCapKW } from "@/lib/prototype-telemetry"
import { SessionDetailDialog } from "./session-detail-dialog"

export interface DispatchPoint {
  ts: string
  hour: number
  priceEurMwh: number | null
  /** Actual / BMS grid import, positive kW. */
  actualImportKw: number | null
  /** Optimized counterfactual grid import, positive kW (optimized mode only). */
  optimizedImportKw?: number | null
  /**
   * Real metered grid import from telemetry, positive kW. In "engine" mode the
   * primary area is the engine-CALCULATED import; this is overlaid as a dashed
   * comparison line so the replay can be checked against what the site actually
   * did (they should coincide when the live kernel matches this version).
   */
  meteredImportKw?: number | null
  /** Derived EV load, positive kW. */
  evKw: number | null
  /** EV charge REQUESTED this frame (kW) — what the car(s) asked for. */
  evRequestedKw?: number | null
  /** EV charge actually SERVED this frame (kW). Should equal requested unless physical curtailment. */
  evServedKw?: number | null
  /**
   * PER-CONNECTOR MAX DELIVERABLE this frame (kW) = min(car handshake limit
   * min(p_ev_max_w, p_cp_max_w), SITE deliverable = grid headroom + SOC-limited
   * battery discharge). The raw register is a STATIC handshake maximum (e.g.
   * flat 250 kW all session while the car tapers 169→106 kW on its own CC/CV
   * curve), so it is capped at what the site could physically push. Null when
   * the car reports no limit, so the per-connector chart hides the line.
   */
  ev1AcceptKw?: number | null
  ev2AcceptKw?: number | null
  /** Per-connector CAR state-of-charge this frame (%). Null when no car / not reported. */
  ev1SocCarPct?: number | null
  ev2SocCarPct?: number | null
  /** Per-connector charger time-to-full ETA this frame (seconds). Null/0 when idle. */
  ev1FullS?: number | null
  ev2FullS?: number | null
  /** Site-wide grid import ceiling that applied this frame (kW), for the cap line. */
  siteGridLimitKw?: number | null
  /** Primary SOC curve. In optimized mode this is the simulated/optimized SOC. */
  b1SocPct: number | null
  b2SocPct: number | null
  /** Actual measured per-pack SOC, shown as a reference in optimized mode. */
  actualB1SocPct?: number | null
  actualB2SocPct?: number | null
  /**
   * Optimized per-unit setpoints, for the per-connector energy-flow tooltip.
   * Unit 1 → Connector A, Unit 2 → Connector B. gXKw = grid import (+),
   * bXKw = battery power (+ charge / − discharge). EV at connector = gXKw − bXKw.
   */
  g1Kw?: number | null
  g2Kw?: number | null
  b1Kw?: number | null
  b2Kw?: number | null
  /** SIMULATED EV charge delivered per connector this frame (kW). Unit 1 → A, Unit 2 → B. */
  ev1Kw?: number | null
  ev2Kw?: number | null
  /**
   * METERED per-connector EV power (kW) from the cumulative counter delta —
   * the measured ground truth to compare against the simulated (g − b) split.
   */
  mEv1Kw?: number | null
  mEv2Kw?: number | null
  /** Cumulative EV energy per connector within the window (kWh): metered vs simulated. */
  mEv1Kwh?: number | null
  mEv2Kwh?: number | null
  sEv1Kwh?: number | null
  sEv2Kwh?: number | null
}

export interface SessionLite {
  unitId: string
  label: string
  startMs: number
  endMs: number
  energyKwh: number
  avgKw: number
  /** Car SoC % at the first / last frame of the session (null when not reported). */
  startSocPct?: number | null
  endSocPct?: number | null
  /** Charger-reported time-to-full (seconds) at the last frame (null when not estimated). */
  etaFullS?: number | null
}

export interface DispatchOverviewProps {
  /**
   * - "optimized": optimizer counterfactual overlaid on metered actual (Backtest Lab).
   * - "bms-only": single metered/BMS series, no optimizer overlay (Dataset Explorer).
   * - "engine": single series computed by the production dispatch engine — the
   *   walk-forward Backtesting harness. Renders exactly one grid-import curve,
   *   one buffer-SOC curve and served-EV (no optimised-vs-actual concept).
   */
  mode: "optimized" | "bms-only" | "engine"
  points: DispatchPoint[]
  sessions: SessionLite[]
  totals: {
    actualImportKwh: number
    optimizedImportKwh?: number
    evKwh: number
    /**
     * Per-connector "could I serve more?" energy (kWh). Null when that car never
     * reported an acceptance limit, so the panel shows "no acceptance limit
     * reported" instead of a misleading percentage. servedKwh is the metered
     * per-connector energy measured while a ceiling was reported (the matching
     * basis for acceptableKwh).
     */
    ev1AcceptableKwh?: number | null
    ev2AcceptableKwh?: number | null
    ev1ServedKwh?: number | null
    ev2ServedKwh?: number | null
    ev1HeadroomKwh?: number | null
    ev2HeadroomKwh?: number | null
  }
  /**
   * Live "today" mode (Dispatching Timeline). When true the x-axis is pinned to
   * the full 24h calendar day (00:00→24:00, anchored to the local midnight of
   * the data's day) instead of just spanning the frames present, and a "NOW"
   * marker is drawn at the current time on every panel — sweeping right as the
   * day progresses. Off everywhere else (Backtest Lab, Data Analysis), where the
   * window is a fixed historical range with no live cursor.
   */
  fullDayAxis?: boolean
  /**
   * Full-day day-ahead (DAM) price curve (epoch-ms slot start + €/MWh), used in
   * live "today" mode to draw the price line and the cheap/expensive colour
   * bands across the ENTIRE calendar day — including future slots that have no
   * telemetry yet (DAM prices are published for the whole day). When absent the
   * chart falls back to the price carried on the telemetry frames (covered range
   * only). Only consumed when fullDayAxis is set.
   */
  dayPrices?: { ts: number; priceEurMwh: number }[]
  /**
   * Historical range pin (Dispatching History). When both are set (and
   * fullDayAxis is off) EVERY panel's x-axis — main chart, session lanes, SOC,
   * served-vs-max — is anchored to exactly this selected window instead of the
   * span of whatever frames/sessions happen to exist. This keeps the axes of
   * different stations (and the session lane vs the main chart) vertically
   * aligned even when telemetry only covers part of the window or there are no
   * sessions at all (client report aug 24 2026: axes diverged between two
   * stations over the same picked range). Epoch ms, end exclusive.
   */
  rangeStartMs?: number
  rangeEndMs?: number
}

const SESSION_COLORS: Record<string, string> = {
  "1": "var(--chart-2)",
  "2": "var(--chart-4)",
}

/**
 * ONE plot-area geometry for every panel in the stack.
 *
 * Recharts maps the numeric X domain onto
 *   [margin.left + leftAxisWidth, panelWidth − margin.right − rightAxisWidth].
 * The session strip is plain CSS, not Recharts, so it MUST use the very same
 * insets or its bars drift against the events drawn above them (client report
 * sep 3 2026: "sesije su smaknute" — the lane started at 36 px and ran to the
 * panel edge while the plot started at 52 px and stopped 52 px short, so a
 * 07:11 session rendered ~40 px right of the 07:11 EV spike). Every chart
 * derives its margin from these constants, so the price bands, the NOW cursor,
 * the SOC curves and the session bars all share one x-pixel per timestamp.
 */
const PLOT_INSET_LEFT = 52
const PLOT_INSET_RIGHT = 52
/** Panel 1 (price + grid) has two axes; the others a single left axis. */
const Y_AXIS_KW_W = 48
const Y_AXIS_PRICE_W = 44
const Y_AXIS_SINGLE_W = 44
const chartMargin = (leftAxisW: number, rightAxisW = 0) => ({
  left: PLOT_INSET_LEFT - leftAxisW,
  right: PLOT_INSET_RIGHT - rightAxisW,
  top: 8,
})

/** Epoch ms of local-timezone midnight for the calendar day containing `ms`. */
function localMidnight(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function DispatchingOverview({
  mode,
  points,
  sessions,
  totals,
  fullDayAxis = false,
  dayPrices,
  rangeStartMs,
  rangeEndMs,
}: DispatchOverviewProps) {
  const isOpt = mode === "optimized"

  const {
    originMs,
    totalHours,
    data,
    priceBands,
    kwDomain,
    priceDomain,
    gridCapKw,
    hasEvDemand,
    hasAnyPrice,
    perConnector,
    lastFrameRow,
    lastFrameHour,
  } = useMemo(() => {
    const firstMs = points.length ? new Date(points[0].ts).getTime() : 0
    // Live "today" mode: pin the axis to the full local calendar day so 0 = local
    // midnight and the domain is a fixed 24h, regardless of which frames exist
    // yet. Historical mode with an explicit range pin: anchor to the SELECTED
    // window so every panel (and every station) shares the same axis regardless
    // of data coverage. Everywhere else the origin is just the first frame and
    // the span grows with the data.
    const rangePinned = !fullDayAxis && rangeStartMs != null && rangeEndMs != null && rangeEndMs > rangeStartMs
    const dayStart = fullDayAxis ? localMidnight(firstMs) : rangePinned ? (rangeStartMs as number) : firstMs
    const origin = dayStart
    const lastHour = points.length ? (new Date(points[points.length - 1].ts).getTime() - origin) / 3_600_000 : 0
    const sessionMaxHour = sessions.reduce(
      (m, s) => Math.max(m, (s.endMs - origin) / 3_600_000),
      0,
    )
    const total = fullDayAxis
      ? 24
      : rangePinned
        ? ((rangeEndMs as number) - (rangeStartMs as number)) / 3_600_000
        : Math.max(lastHour, sessionMaxHour, 1)
    const reanchor = fullDayAxis || rangePinned
    // ── ONE EV definition (Gronau defect 2, sep 2 2026) ─────────────────────
    // `p.evKw` is the kernel demand signal = power-balance reconstruction
    // max(0, batt − grid). It ABSORBS the ChargePost aux/hotel draw, so with no
    // car plugged it still shows ~0.9 kW — the client saw "EV demand 0.9 kW,
    // 0 sessions". The chart's EV series is therefore the METERED per-connector
    // power (mEv1Kw + mEv2Kw, counter deltas: exactly 0 outside sessions), and
    // AUX is the residual site load − metered EV. Only when a series carries no
    // connector counters at all (foreign hardware) do we fall back to the
    // reconstruction — and then it is labelled "Site load", never "EV".
    const hasMeteredEv = points.some((p) => p.mEv1Kw != null || p.mEv2Kw != null)
    const meteredEvKwOf = (p: (typeof points)[number]): number | null =>
      p.mEv1Kw == null && p.mEv2Kw == null ? null : Math.abs(p.mEv1Kw ?? 0) + Math.abs(p.mEv2Kw ?? 0)
    const evSeriesKwOf = (p: (typeof points)[number]): number | null => {
      if (!hasMeteredEv) return p.evKw != null ? Math.abs(p.evKw) : null
      const m = meteredEvKwOf(p)
      // A frame without counter readings inside a metered series = no EV
      // charging measured at that instant (the counters only tick when a car
      // draws), so it is 0 — not the AUX-polluted reconstruction.
      return m ?? (p.evKw != null ? 0 : null)
    }
    const auxKwOf = (p: (typeof points)[number]): number | null => {
      if (!hasMeteredEv || p.evKw == null) return null
      const m = meteredEvKwOf(p) ?? 0
      return Math.max(0, Math.abs(p.evKw) - m)
    }
    const mapped = points.map((p) => ({
      // In full-day or range-pinned mode re-anchor each point to hours-since-
      // origin so the curves line up with the fixed axis; otherwise keep the
      // first-frame-relative hour the series already carries.
      hour: reanchor ? (new Date(p.ts).getTime() - dayStart) / 3_600_000 : p.hour,
      price: p.priceEurMwh,
      // sign convention (UI): grid import drawn DOWN (negative), EV delivered UP (positive)
      importNegKw: p.actualImportKw != null ? -Math.abs(p.actualImportKw) : null,
      optimizedImportNegKw: p.optimizedImportKw != null ? -Math.abs(p.optimizedImportKw) : null,
      // Real metered grid import (engine-mode comparison line), drawn DOWN.
      meteredImportNegKw: p.meteredImportKw != null ? -Math.abs(p.meteredImportKw) : null,
      // EV delivered = METERED (C1+C2). Stacked with AUX so the top of the
      // stack is the site load the kernel actually had to serve.
      evPosKw: evSeriesKwOf(p),
      auxPosKw: auxKwOf(p),
      // Site load (EV + AUX) as the kernel saw it — tooltip only.
      siteLoadKw: p.evKw != null ? Math.abs(p.evKw) : null,
      // Optimised EV delivered. EV demand is exogenous (must-serve), so the
      // optimiser delivers the SAME energy as actual — this dashed series
      // therefore tracks evPosKw and visually confirms optimisation only
      // changes the grid/battery split, not what the cars receive.
      optEvPosKw: evSeriesKwOf(p),
      // Served-vs-Requested panel. Requested falls back to evKw when the
      // explicit field is absent (older runs); served falls back to requested
      // (no curtailment recorded ⇒ assume fully served).
      evReqKw: (p.evRequestedKw ?? p.evKw) != null ? Math.abs((p.evRequestedKw ?? p.evKw) as number) : null,
      evServedKw:
        p.evServedKw != null
          ? Math.abs(p.evServedKw)
          : (p.evRequestedKw ?? p.evKw) != null
            ? Math.abs((p.evRequestedKw ?? p.evKw) as number)
            : null,
      // Per-connector served (metered, ground truth) and acceptance ceiling (the
      // "max power the car would take" — null when the car reports no limit so
      // the line is hidden). Power the C1/C2 panels.
      c1ServedKw: p.mEv1Kw != null ? Math.abs(p.mEv1Kw) : null,
      c2ServedKw: p.mEv2Kw != null ? Math.abs(p.mEv2Kw) : null,
      c1CeilKw: p.ev1AcceptKw != null ? Math.abs(p.ev1AcceptKw) : null,
      c2CeilKw: p.ev2AcceptKw != null ? Math.abs(p.ev2AcceptKw) : null,
      b1SocPct: p.b1SocPct,
      b2SocPct: p.b2SocPct,
      actualB1SocPct: p.actualB1SocPct ?? null,
      actualB2SocPct: p.actualB2SocPct ?? null,
      // mirror panel: actual + optimized import drawn UP, EV delivered (metered) mirrored DOWN
      evNegKw: (() => {
        const v = evSeriesKwOf(p)
        return v != null ? -v : null
      })(),
      importKw: p.actualImportKw != null ? Math.abs(p.actualImportKw) : null,
      optImportKw: p.optimizedImportKw != null ? Math.abs(p.optimizedImportKw) : null,
      // Optimized per-unit setpoints for the per-connector flow tooltip.
      g1Kw: p.g1Kw ?? null,
      g2Kw: p.g2Kw ?? null,
      b1Kw: p.b1Kw ?? null,
      b2Kw: p.b2Kw ?? null,
      // Metered per-connector EV (ground truth) + cumulative metered/simulated.
      mEv1Kw: p.mEv1Kw ?? null,
      mEv2Kw: p.mEv2Kw ?? null,
      mEv1Kwh: p.mEv1Kwh ?? null,
      mEv2Kwh: p.mEv2Kwh ?? null,
      sEv1Kwh: p.sEv1Kwh ?? null,
      sEv2Kwh: p.sEv2Kwh ?? null,
    }))

    // ── Full-day day-ahead price extension (live "today" mode) ───────────────
    // Day-ahead prices are published for the whole day, so we extend the price
    // line and the cheap/expensive bands across slots that have no telemetry yet
    // (before the first frame and after the last). We map each DAM slot to
    // hours-since-midnight, then keep only those OUTSIDE the telemetry-covered
    // range so the historical price (carried on frames, kept for tooltips) is
    // not duplicated. The price Line uses connectNulls, so these price-only rows
    // stitch into one continuous curve while grid/EV areas stay empty there.
    const useDayPrices = fullDayAxis && !!dayPrices && dayPrices.length > 0
    const firstFrameHour = mapped.length ? mapped[0].hour : Number.POSITIVE_INFINITY
    const lastFrameHour = mapped.length ? mapped[mapped.length - 1].hour : Number.NEGATIVE_INFINITY
    const dayPriceByHour = useDayPrices
      ? dayPrices!
          .map((dp) => ({ hour: (dp.ts - dayStart) / 3_600_000, price: dp.priceEurMwh }))
          .filter((e) => e.hour >= 0 && e.hour <= 24 && Number.isFinite(e.price))
      : []
    const priceExtras = dayPriceByHour
      .filter((e) => e.hour < firstFrameHour - 1e-3 || e.hour > lastFrameHour + 1e-3)
      .map((e) => ({ hour: e.hour, price: e.price }) as unknown as (typeof mapped)[number])
    const dataRows = priceExtras.length
      ? [...mapped, ...priceExtras].sort((a, b) => a.hour - b.hour)
      : mapped

    // Site-wide grid import ceiling that applied over the window (the modal /
    // max applicable limit). Used to draw the cap line so it's clear the
    // optimised import respects it while the actual meter may breach it.
    let gridCapKw = 0
    for (const p of points) {
      const lim = p.siteGridLimitKw
      if (lim != null && Number.isFinite(lim)) gridCapKw = Math.max(gridCapKw, lim)
    }

    // Symmetric domains so the 0 kW gridline lines up with the 0 €/MWh gridline.
    let kwAbs = 0
    let priceAbs = 0
    let hasEvDemand = false
    // Per-connector axis max (served + ceiling) and "did this connector see any
    // car / any reported ceiling" flags. The headroom %/kWh come from the
    // full-resolution backtest totals (props), not these downsampled points.
    let c1KwAbs = 0
    let c2KwAbs = 0
    let c1HasData = false
    let c2HasData = false
    let c1HasCeil = false
    let c2HasCeil = false
    for (const m of mapped) {
      if (m.importNegKw != null) kwAbs = Math.max(kwAbs, Math.abs(m.importNegKw))
      // EV + AUX are stacked → the axis must fit the top of the stack (site load).
      if (m.evPosKw != null || m.auxPosKw != null) {
        kwAbs = Math.max(kwAbs, Math.abs(m.evPosKw ?? 0) + Math.abs(m.auxPosKw ?? 0))
      }
      if (m.optimizedImportNegKw != null) kwAbs = Math.max(kwAbs, Math.abs(m.optimizedImportNegKw))
      if (m.meteredImportNegKw != null) kwAbs = Math.max(kwAbs, Math.abs(m.meteredImportNegKw))
      if (m.price != null) priceAbs = Math.max(priceAbs, Math.abs(m.price))
      if (m.evPosKw != null && m.evPosKw > 0.01) hasEvDemand = true
      if (m.c1ServedKw != null && m.c1ServedKw > 0.01) {
        c1HasData = true
        c1KwAbs = Math.max(c1KwAbs, m.c1ServedKw)
      }
      if (m.c2ServedKw != null && m.c2ServedKw > 0.01) {
        c2HasData = true
        c2KwAbs = Math.max(c2KwAbs, m.c2ServedKw)
      }
      if (m.c1CeilKw != null && m.c1CeilKw > 0.01) {
        c1HasCeil = true
        c1KwAbs = Math.max(c1KwAbs, m.c1CeilKw)
      }
      if (m.c2CeilKw != null && m.c2CeilKw > 0.01) {
        c2HasCeil = true
        c2KwAbs = Math.max(c2KwAbs, m.c2CeilKw)
      }
    }
    // Make sure the price axis fits the WHOLE day's prices (incl. future slots),
    // not just the frames present, so the extended line never clips.
    for (const e of dayPriceByHour) priceAbs = Math.max(priceAbs, Math.abs(e.price))
    // Keep the cap line inside the plotted domain.
    if (gridCapKw > 0) kwAbs = Math.max(kwAbs, gridCapKw)
    const kwMax = niceCeil(kwAbs)
    const priceMax = niceCeil(priceAbs)

    return {
      originMs: origin,
      totalHours: total,
      data: dataRows,
      // Colour bands rank cheap/expensive over the FULL day when DAM prices are
      // available, so future slots are correctly tinted; otherwise fall back to
      // the telemetry-covered prices only.
      priceBands: useDayPrices
        ? computePriceBands(dayPriceByHour)
        : computePriceBands(points.map((p) => ({ hour: p.hour, price: p.priceEurMwh }))),
      kwDomain: [-kwMax, kwMax] as [number, number],
      priceDomain: [-priceMax, priceMax] as [number, number],
      gridCapKw,
      hasEvDemand,
      // Whether we have ANY finite price to draw (line + cheap/expensive bands).
      // When false in live mode, the day-ahead curve for this day is null/unpublished
      // upstream, so we show an explanatory notice instead of a silently blank chart.
      hasAnyPrice: useDayPrices
        ? dayPriceByHour.length > 0
        : points.some((p) => Number.isFinite(p.priceEurMwh)),
      // Per-connector chart metadata. The headroom %/kWh shown in each badge come
      // from the full-resolution backtest totals (props.totals), so they stay
      // accurate even though the plotted points are downsampled.
      perConnector: {
        c1: { hasData: c1HasData, hasCeil: c1HasCeil, kwMax: niceCeil(c1KwAbs) },
        c2: { hasData: c2HasData, hasCeil: c2HasCeil, kwMax: niceCeil(c2KwAbs) },
      },
      // Last TELEMETRY frame (not a future price-only row) for the "hold to NOW"
      // carry-forward of the grid/EV/SOC curves.
      lastFrameRow: mapped.length ? mapped[mapped.length - 1] : null,
      lastFrameHour: mapped.length ? lastFrameHour : Number.NEGATIVE_INFINITY,
    }
  }, [points, sessions, fullDayAxis, dayPrices, rangeStartMs, rangeEndMs])

  // Live "NOW" cursor. Tick every 30s so the marker visibly sweeps right across
  // the fixed 24h axis as the day progresses. Only runs in full-day (live) mode.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!fullDayAxis) return
    setNowMs(Date.now())
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [fullDayAxis])
  // Hours since the axis origin (local midnight). Only shown when it falls
  // inside the plotted day — i.e. we're actually viewing today.
  const nowHour = (nowMs - originMs) / 3_600_000
  const showNow = fullDayAxis && nowHour >= 0 && nowHour <= totalHours

  // Live "hold to NOW": telemetry frames lag behind wall-clock, and between the
  // 30s marker ticks the NOW line drifts right while the data stays put — opening
  // a visible gap before the cursor. Carry the last frame's values forward to the
  // NOW position so the curves always reach the marker (standard last-known-state
  // hold for a live dashboard). Only in full-day mode, and only forward in time.
  const chartData = useMemo(() => {
    if (!showNow || data.length === 0 || lastFrameRow == null) return data
    if (nowHour <= lastFrameHour + 1e-3) return data
    // Carry the last telemetry frame's grid/EV/SOC forward to NOW. Price is set
    // null: the full-day day-ahead price line already covers this range, so we
    // only hold the kW/SOC curves (which genuinely lag wall-clock). Insert in
    // sorted x-order since the price extras already extend past lastFrameHour.
    const carry = { ...lastFrameRow, hour: nowHour, price: null }
    return [...data, carry].sort((a, b) => (a.hour ?? 0) - (b.hour ?? 0))
  }, [data, showNow, nowHour, lastFrameRow, lastFrameHour])

  // Axis ticks: always real clock time in the browser's local timezone, with the
  // calendar date prepended once the window spans more than a single day.
  const fmtAxis = (h: number) => {
    const d = new Date(originMs + h * 3_600_000)
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    if (totalHours <= 36) return time
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`
  }

  // Tooltip label: full local-browser timestamp shared by every panel.
  const fmtTooltipTime = (h: number) =>
    new Date(originMs + h * 3_600_000).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })

  const xAxis = (
    <XAxis
      dataKey="hour"
      type="number"
      domain={[0, totalHours]}
      tickFormatter={fmtAxis}
      fontSize={10}
      tickLine={false}
      minTickGap={56}
      allowDataOverflow
    />
  )

  // "NOW" vertical marker for the live timeline. Returns null outside full-day
  // mode (or when now is off the axis). `yAxisId` is required on charts that
  // declare ids on their YAxis (the price/grid panel); single-axis charts omit it.
  const nowLine = (yAxisId?: string) =>
    showNow ? (
      <ReferenceLine
        {...(yAxisId ? { yAxisId } : {})}
        x={nowHour}
        stroke="var(--chart-1)"
        strokeWidth={1.5}
        strokeDasharray="2 2"
        ifOverflow="extendDomain"
        label={{
          value: "NOW",
          position: "insideTopRight",
          fontSize: 9,
          fill: "var(--chart-1)",
        }}
      />
    ) : null

  if (points.length === 0) {
    return (
      <div className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">
        No frames in this range.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ── Panel 1: Price + grid import + mirrored EV ────────────────── */}
      <Panel
        title="Dispatching Overview"
        right={<PriceBandLegend />}
      >
        {fullDayAxis && !hasAnyPrice && (
          <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Day-ahead prices are not yet published for this day — the price line and cheap/expensive
            shading are hidden. The dispatcher keeps running on its last known price curve.
          </div>
        )}
        <ChartContainer config={gridConfig(isOpt)} className="h-64 w-full">
          <ComposedChart data={chartData} margin={chartMargin(Y_AXIS_KW_W, Y_AXIS_PRICE_W)}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            {/* cheapest (green) / priciest (red) 15-min windows, intensity-scaled */}
            {priceBands.map((b, i) => (
              <ReferenceArea
                key={`band-${i}`}
                yAxisId="kw"
                x1={b.x1}
                x2={b.x2}
                fill={b.fill}
                fillOpacity={b.opacity}
                stroke="none"
                ifOverflow="extendDomain"
              />
            ))}
            {xAxis}
            {/* Symmetric domains keep the 0 kW gridline aligned with 0 €/MWh */}
            <YAxis yAxisId="kw" domain={kwDomain} tickCount={5} fontSize={11} tickLine={false} axisLine={false} width={Y_AXIS_KW_W} unit="kW" />
            <YAxis yAxisId="price" orientation="right" domain={priceDomain} tickCount={5} fontSize={11} tickLine={false} axisLine={false} width={Y_AXIS_PRICE_W} />
            <ReferenceLine yAxisId="kw" y={0} stroke="var(--foreground)" strokeOpacity={0.25} />
            {/* Grid import cap. Import is drawn DOWN, so the ceiling sits at −cap.
                Makes it explicit the optimised import respects the limit while the
                actual meter (real site) may breach it. */}
            {gridCapKw > 0 ? (
              <ReferenceLine
                yAxisId="kw"
                y={-gridCapKw}
                stroke="var(--destructive)"
                strokeDasharray="4 4"
                strokeOpacity={0.7}
                label={{
                  value: `Grid cap ${formatCapKW(gridCapKw * 1000)}`,
                  position: "insideBottomLeft",
                  fontSize: 10,
                  fill: "var(--destructive)",
                }}
              />
            ) : null}
            {nowLine("kw")}
            <ChartTooltip content={<PriceTooltip originMs={originMs} isOpt={isOpt} singleTitle={mode === "engine" ? "Engine (calculated)" : "Actual (BMS)"} />} />
            {/* grid import drawn below zero (consumption) */}
            <Area
              yAxisId="kw"
              dataKey="importNegKw"
              name="Grid import kW"
              stroke="var(--chart-5)"
              fill="var(--chart-5)"
              fillOpacity={0.2}
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
            {/* EV delivered (METERED C1+C2) drawn above zero, with the
                ChargePost AUX/hotel draw stacked on top: the top edge of the
                stack is the site load the kernel had to serve; the EV band is
                exactly 0 outside sessions (Gronau defect 2). */}
            <Area
              yAxisId="kw"
              dataKey="evPosKw"
              name="EV delivered (metered) kW"
              stackId="load"
              stroke="var(--chart-4)"
              fill="var(--chart-4)"
              fillOpacity={0.18}
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
            <Area
              yAxisId="kw"
              dataKey="auxPosKw"
              name="AUX (ChargePost) kW"
              stackId="load"
              stroke="var(--muted-foreground)"
              fill="var(--muted-foreground)"
              fillOpacity={0.12}
              strokeWidth={1}
              strokeDasharray="2 2"
              dot={false}
              connectNulls
            />
            {isOpt ? (
              <Line
                yAxisId="kw"
                dataKey="optEvPosKw"
                name="EV delivered (optimised) kW"
                stroke="var(--chart-4)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
              />
            ) : null}
            {isOpt ? (
              <Line
                yAxisId="kw"
                dataKey="optimizedImportNegKw"
                name="Optimized import kW"
                stroke="var(--chart-2)"
                strokeWidth={1.75}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
              />
            ) : null}
            {/* Engine mode: overlay the REAL metered grid import as a dashed
                comparison against the engine-calculated area. They should
                coincide when the deployed kernel matches this replay version. */}
            {mode === "engine" ? (
              <Line
                yAxisId="kw"
                dataKey="meteredImportNegKw"
                name="Actual import (metered) kW"
                stroke="var(--chart-2)"
                strokeWidth={1.75}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
              />
            ) : null}
            {/* price on the right axis, drawn last so it sits on top.
                stepAfter renders the true 15-min DAM slot "stairway": each slot
                price holds flat until the next slot starts. */}
            <Line
              yAxisId="price"
              type="stepAfter"
              dataKey="price"
              name="Price €/MWh"
              stroke="var(--chart-1)"
              strokeWidth={1.5}
              connectNulls
              dot={false}
            />
          </ComposedChart>
        </ChartContainer>
        <DispatchOverviewLegend mode={mode} showPrice={hasAnyPrice} gridCapKw={gridCapKw} />
      </Panel>

      {/* ── Panel 2: C1/C2 charging-session strip ─────────────────────── */}
      <Panel
        title="Charging Sessions — C1 / C2"
        right={
          <div className="flex items-center gap-3 text-[11px]">
            <Swatch color={SESSION_COLORS["1"]} label="C1" />
            <Swatch color={SESSION_COLORS["2"]} label="C2" />
          </div>
        }
      >
        <SessionStrip
          sessions={sessions}
          points={points}
          originMs={originMs}
          totalHours={totalHours}
          fmtHour={fmtAxis}
          nowHour={showNow ? nowHour : null}
        />
      </Panel>

      {/* ── Panel 3: B1/B2 pack SOC ───────────────────────���──��─────────��� */}
      <Panel
        title={
          mode === "optimized"
            ? "Battery State of Charge — B1 / B2 (optimised vs actual)"
            : mode === "engine"
              ? "Battery State of Charge — B1 / B2 (engine-calculated)"
              : "Battery State of Charge — B1 / B2"
        }
      >
        <ChartContainer config={socConfig(isOpt, mode)} className="h-52 w-full">
          <LineChart data={chartData} margin={chartMargin(Y_AXIS_SINGLE_W)}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            {xAxis}
            <YAxis domain={[0, 100]} fontSize={11} tickLine={false} axisLine={false} width={Y_AXIS_SINGLE_W} unit="%" />
            {nowLine()}
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => fmtTooltipTime(Number(p?.[0]?.payload?.hour ?? 0))} />} />
            {/* Optimized mode: actual = faded solid, optimised = dashed (existing convention). */}
            {isOpt ? (
              <Line dataKey="actualB1SocPct" name="B1 SOC % (actual)" stroke="var(--chart-2)" strokeOpacity={0.45} strokeWidth={1.5} dot={false} connectNulls />
            ) : null}
            {isOpt ? (
              <Line dataKey="actualB2SocPct" name="B2 SOC % (actual)" stroke="var(--chart-3)" strokeOpacity={0.45} strokeWidth={1.5} dot={false} connectNulls />
            ) : null}
            {/* Engine (replay) mode: overlay the REAL metered per-pack SOC as
                DASHED lines (like the grid-import overlay) against the solid
                engine-simulated SOC, so the two can be compared directly. */}
            {mode === "engine" ? (
              <Line dataKey="actualB1SocPct" name="B1 SOC % (actual)" stroke="var(--chart-2)" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
            ) : null}
            {mode === "engine" ? (
              <Line dataKey="actualB2SocPct" name="B2 SOC % (actual)" stroke="var(--chart-3)" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
            ) : null}
            <Line dataKey="b1SocPct" name={isOpt ? "B1 SOC % (optimised)" : mode === "engine" ? "B1 SOC % (simulated)" : "B1 SOC %"} stroke="var(--chart-2)" strokeWidth={isOpt ? 2 : 1.75} strokeDasharray={mode === "engine" ? undefined : "4 3"} dot={false} connectNulls />
            <Line dataKey="b2SocPct" name={isOpt ? "B2 SOC % (optimised)" : mode === "engine" ? "B2 SOC % (simulated)" : "B2 SOC %"} stroke="var(--chart-3)" strokeWidth={isOpt ? 2 : 1.75} strokeDasharray={mode === "engine" ? undefined : "4 3"} dot={false} connectNulls />
          </LineChart>
        </ChartContainer>
        <SocLegend mode={mode} />
        {isOpt ? (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Dashed lines are the optimised SOC simulated forward from the kernel&apos;s commanded battery
            power; solid faded lines are the actual measured pack SOC recorded in telemetry.
          </p>
        ) : mode === "engine" ? (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Solid lines are the engine-simulated per-pack SOC (both packs run in dual mode and balance
            toward each other); dashed lines are the actual measured pack SOC from telemetry. They
            coincide when the deployed kernel matches this version.
          </p>
        ) : null}
      </Panel>

      {/* ── Panel 4: Per-connector EV charge (C1, C2) ─────────────────────
          One panel per connector: SERVED (metered, filled area on the kW axis)
          vs the car's ACCEPTANCE CEILING (dotted, only when the car reports a
          limit) plus the CAR SoC % on the right axis. Splitting C1/C2 keeps the
          comparison honest — a site-level "served vs ceiling" mixed a connector
          that reports no acceptance limit with one that does.

          Stacked full-width (C2 BELOW C1, not side-by-side): a half-width panel
          compressed the time axis so its NOW cursor no longer lined up with the
          full-width grid/price/SOC panels above. Keeping every panel full width
          makes the sweeping NOW line read as one continuous vertical cursor down
          the whole page. */}
      <div className="grid grid-cols-1 gap-3">
        <ConnectorEvPanel
          label="C1"
          data={chartData}
          servedKey="c1ServedKw"
          ceilKey="c1CeilKw"
          kwMax={perConnector.c1.kwMax}
          hasData={perConnector.c1.hasData}
          hasCeil={perConnector.c1.hasCeil}
          acceptableKwh={totals.ev1AcceptableKwh ?? null}
          headroomKwh={totals.ev1HeadroomKwh ?? null}
          xAxis={xAxis}
          nowLineNode={nowLine("kw")}
          tooltipLabel={(h) => fmtTooltipTime(h)}
        />
        <ConnectorEvPanel
          label="C2"
          data={chartData}
          servedKey="c2ServedKw"
          ceilKey="c2CeilKw"
          kwMax={perConnector.c2.kwMax}
          hasData={perConnector.c2.hasData}
          hasCeil={perConnector.c2.hasCeil}
          acceptableKwh={totals.ev2AcceptableKwh ?? null}
          headroomKwh={totals.ev2HeadroomKwh ?? null}
          xAxis={xAxis}
          nowLineNode={nowLine("kw")}
          tooltipLabel={(h) => fmtTooltipTime(h)}
        />
      </div>
      {!hasEvDemand ? (
        <p className="text-[10px] text-muted-foreground">No EV charging in this window.</p>
      ) : null}
    </div>
  )
}

/**
 * One connector's EV panel: served (metered, filled) vs the car's acceptance
 * ceiling (dotted, hidden when the car reports no limit) on the kW axis, plus
 * the car's SoC % on a right axis. The header badge reports "served X% of
 * acceptance" only when a ceiling was actually reported.
 */
function ConnectorEvPanel({
  label,
  data,
  servedKey,
  ceilKey,
  kwMax,
  hasData,
  hasCeil,
  acceptableKwh,
  headroomKwh,
  xAxis,
  nowLineNode,
  tooltipLabel,
}: {
  label: string
  data: Array<Record<string, unknown>>
  servedKey: string
  ceilKey: string
  kwMax: number
  hasData: boolean
  hasCeil: boolean
  acceptableKwh: number | null
  headroomKwh: number | null
  xAxis: React.ReactNode
  nowLineNode: React.ReactNode
  tooltipLabel: (hour: number) => string
}) {
  const config: ChartConfig = {
    [servedKey]: { label: `${label} served kW`, color: "var(--chart-4)" },
    [ceilKey]: { label: `${label} max deliverable kW`, color: "var(--chart-5)" },
  }
  return (
    <Panel
      title={`${label} — Served vs Max Deliverable`}
      right={
        <ConnectorServeBadge
          hasData={hasData}
          hasCeil={hasCeil}
          acceptableKwh={acceptableKwh}
          headroomKwh={headroomKwh}
        />
      }
    >
      <ChartContainer config={config} className="h-48 w-full">
        <ComposedChart data={data} margin={chartMargin(Y_AXIS_SINGLE_W)}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          {xAxis}
          <YAxis
            yAxisId="kw"
            domain={[0, kwMax || "auto"]}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={Y_AXIS_SINGLE_W}
            unit="kW"
          />
          {nowLineNode}
          <ChartTooltip
            content={
              <ChartTooltipContent labelFormatter={(_, p) => tooltipLabel(Number(p?.[0]?.payload?.hour ?? 0))} />
            }
          />
          {/* Served = filled metered power. */}
          <Area
            yAxisId="kw"
            dataKey={servedKey}
            name={`${label} served kW`}
            stroke="var(--chart-4)"
            fill="var(--chart-4)"
            fillOpacity={0.22}
            strokeWidth={1.75}
            dot={false}
            connectNulls
          />
          {/* Max deliverable ceiling — car handshake limit capped at what the
              site (grid headroom + battery discharge) could physically push.
              Only drawn when the car reports a limit. */}
          {hasCeil ? (
            <Line
              yAxisId="kw"
              dataKey={ceilKey}
              name={`${label} max deliverable kW`}
              stroke="var(--chart-5)"
              strokeWidth={1.5}
              strokeDasharray="2 2"
              dot={false}
              connectNulls
            />
          ) : null}
          <ChartLegend content={<ChartLegendContent />} />
        </ComposedChart>
      </ChartContainer>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {!hasData
          ? `No charging on ${label} in this window.`
          : `Filled = metered EV power delivered;${
              hasCeil
                ? " dotted = max deliverable (car's handshake limit capped by grid + battery capability). Served below the dotted line is the car's own charging curve (taper), not missed delivery — the dispatcher never curtails EV."
                : " This car did not report an acceptance limit, so no ceiling is shown."
            }`}
      </p>
    </Panel>
  )
}

/**
 * Header badge for a connector panel. headroomKwh now counts ONLY site-limited
 * energy (served pinned at the site's deliverable ceiling while the car's
 * handshake register asked for more) — the honest "we failed to deliver"
 * figure. Frames where the car tapered below the ceiling on its own CC/CV
 * curve are car-limited: the dispatcher never curtails EV, so served there IS
 * the max possible. The old "% of acceptance" divided served by a static
 * handshake register (flat 250 kW all session) and read as missed delivery
 * during every normal taper — fiction, now removed.
 */
function ConnectorServeBadge({
  hasData,
  hasCeil,
  acceptableKwh,
  headroomKwh,
}: {
  hasData: boolean
  hasCeil: boolean
  acceptableKwh: number | null
  headroomKwh: number | null
}) {
  if (!hasData) {
    return <span className="text-[11px] text-muted-foreground">No session</span>
  }
  if (!hasCeil || acceptableKwh == null || acceptableKwh <= 0) {
    return <span className="text-[11px] text-muted-foreground">No acceptance limit reported</span>
  }
  const carLimited = (headroomKwh ?? 0) < 0.1
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-[11px] font-semibold tabular-nums",
        carLimited ? "text-emerald-600" : "text-amber-600",
      )}
      title={
        carLimited
          ? "The site delivered everything the car would take — any gap below the dotted ceiling is the car's own charging curve (taper), not missed delivery."
          : `Site-limited: the car asked for ${(headroomKwh ?? 0).toFixed(1)} kWh more than the site (grid + battery) could physically deliver.`
      }
    >
      <span
        className={cn("inline-block size-2 rounded-full", carLimited ? "bg-emerald-500" : "bg-amber-500")}
        aria-hidden
      />
      {carLimited ? "full acceptance served" : `site-limited · ${(headroomKwh ?? 0).toFixed(1)} kWh short`}
    </span>
  )
}

/** Header badge for the Served-vs-Requested panel — green when 100% served. */
// ── Session strip ────────────────────────────────��───���─────────────────────
function SessionStrip({
  sessions,
  points,
  originMs,
  totalHours,
  fmtHour,
  nowHour = null,
}: {
  sessions: SessionLite[]
  points: DispatchPoint[]
  originMs: number
  totalHours: number
  fmtHour: (h: number) => string
  /** Hours-since-origin of the live "NOW" cursor, or null to hide it. */
  nowHour?: number | null
}) {
  const units = ["1", "2"]
  const span = totalHours * 3_600_000 || 1
  const nowPct =
    nowHour != null && totalHours > 0
      ? Math.max(0, Math.min((nowHour / totalHours) * 100, 100))
      : null
  // Clicking a session bar opens its per-session supply breakdown.
  const [selected, setSelected] = useState<SessionLite | null>(null)

  // Measure the lane width so we can give each session a PIXEL-based minimum
  // size. Over a multi-day window a real 15–40 min charge is only ~0.2 % of the
  // span — sub-pixel and invisible if we size purely in %. We position in % but
  // clamp the rendered width to at least MIN_BAR_PX so every session shows up.
  const MIN_BAR_PX = 4
  const laneRef = useRef<HTMLDivElement>(null)
  const [laneWidth, setLaneWidth] = useState(0)
  useEffect(() => {
    const el = laneRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setLaneWidth(entries[0]?.contentRect.width ?? 0)
    })
    ro.observe(el)
    setLaneWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const minWidthPct = laneWidth > 0 ? (MIN_BAR_PX / laneWidth) * 100 : 0.4
  const totalSessions = sessions.length

  return (
    <div className="space-y-1.5 py-1">
      {units.map((u, ui) => {
        const rows = sessions.filter((s) => s.unitId === u)
        return (
          <div key={u} className="relative flex items-center">
            {/* Label lives INSIDE the left inset so the lane itself starts
                exactly where the chart plot area above starts. */}
            <span
              className="absolute w-7 text-[11px] font-medium tabular-nums text-muted-foreground"
              style={{ left: PLOT_INSET_LEFT - Y_AXIS_KW_W }}
            >
              {`C${u}`}
            </span>
            <div
              ref={ui === 0 ? laneRef : undefined}
              className="relative h-3.5 flex-1 rounded bg-muted/40"
              style={{ marginLeft: PLOT_INSET_LEFT, marginRight: PLOT_INSET_RIGHT }}
            >
              {rows.map((s, i) => {
                const left = Math.max(0, Math.min(((s.startMs - originMs) / span) * 100, 100))
                const rawWidth = ((s.endMs - s.startMs) / span) * 100
                const width = Math.min(Math.max(rawWidth, minWidthPct), 100 - left)
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelected(s)}
                    className="absolute top-0 h-full cursor-pointer rounded-sm transition-[outline] hover:outline hover:outline-2 hover:outline-offset-1 hover:outline-foreground/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: SESSION_COLORS[u] ?? "var(--chart-2)",
                    }}
                    title={`C${u}: ${s.energyKwh} kWh · ${s.avgKw} kW avg — click for breakdown`}
                    aria-label={`Connector C${u} session: ${s.energyKwh} kWh, ${s.avgKw} kW average. Click for supply breakdown.`}
                  />
                )
              })}
              {/* Live "NOW" cursor, aligned to the same time span as the bars. */}
              {nowPct != null ? (
                <div
                  className="pointer-events-none absolute inset-y-0 w-px bg-[var(--chart-1)]"
                  style={{ left: `${nowPct}%` }}
                  aria-hidden
                />
              ) : null}
            </div>
          </div>
        )
      })}
      <div
        className="flex justify-between text-[9px] text-muted-foreground"
        style={{ paddingLeft: PLOT_INSET_LEFT, paddingRight: PLOT_INSET_RIGHT }}
      >
        <span>{fmtHour(0)}</span>
        <span>{`${totalSessions} session${totalSessions === 1 ? "" : "s"} · click a bar for its supply breakdown`}</span>
        <span>{fmtHour(totalHours)}</span>
      </div>
      <SessionDetailDialog
        session={selected}
        points={points}
        open={selected != null}
        onOpenChange={(o) => {
          if (!o) setSelected(null)
        }}
      />
    </div>
  )
}

// ── Small UI helpers ───────────────────────────��─────────────────────────
function Panel({
  title,
  right,
  children,
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium tracking-wide">{title}</h4>
        {right}
      </div>
      {children}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "up" | "down" | "opt" | "ok" | "warn"
}) {
  const dot = tone === "ok" || tone === "warn"
  return (
    <span className="flex items-center gap-1.5">
      {dot ? null : (
        <span
          className={cn(
            "inline-block size-2 rounded-full",
            tone === "up" && "bg-[var(--chart-5)]",
            tone === "down" && "bg-[var(--chart-4)]",
            tone === "opt" && "bg-[var(--chart-2)]",
          )}
          aria-hidden
        />
      )}
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          tone === "ok" && "text-emerald-600",
          tone === "warn" && "text-amber-600",
        )}
      >
        {value}
      </span>
    </span>
  )
}

/** Compact kWh formatter — thins large numbers to k where helpful. */
function fmtKwh(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

/** Inline legend swatch for the session strip (C1 / C2). */
function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
      {label}
    </span>
  )
}

/** A small line sample showing the actual stroke style (solid vs dashed, plus an
 *  optional faded opacity) so the legend distinguishes dashed/faded comparison
 *  lines from solid ones. */
function LineSample({
  color,
  dashed,
  area,
  opacity = 1,
}: {
  color: string
  dashed?: boolean
  area?: boolean
  opacity?: number
}) {
  return (
    <svg width={18} height={10} viewBox="0 0 18 10" aria-hidden className="shrink-0">
      {area && <rect x={0} y={4} width={18} height={6} fill={color} fillOpacity={0.2} />}
      <line
        x1={0}
        y1={area ? 4 : 5}
        x2={18}
        y2={area ? 4 : 5}
        stroke={color}
        strokeOpacity={opacity}
        strokeWidth={2}
        strokeDasharray={dashed ? "3 2" : undefined}
      />
    </svg>
  )
}

/** Mode-aware legend for the Dispatching Overview chart. Unlike the default
 *  swatch legend, it renders each series with its true line style so the DASHED
 *  lines (metered/actual in engine mode, optimised in optimised mode, and the
 *  grid-cap limit) read as dashed, and the solid lines read as solid. */
function DispatchOverviewLegend({
  mode,
  showPrice,
  gridCapKw,
}: {
  mode: "optimized" | "bms-only" | "engine"
  showPrice: boolean
  gridCapKw: number
}) {
  const item = (color: string, label: string, opts?: { dashed?: boolean; area?: boolean }) => (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <LineSample color={color} dashed={opts?.dashed} area={opts?.area} />
      {label}
    </span>
  )
  const importLabel = mode === "engine" ? "Grid import — engine (below 0)" : "Grid import (below 0)"
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-3 text-[11px]">
      {item("var(--chart-5)", importLabel, { area: true })}
      {item("var(--chart-4)", "EV delivered — metered C1+C2", { area: true })}
      {item("var(--muted-foreground)", "AUX ChargePost — stacked on EV", { area: true, dashed: true })}
      {mode === "engine" && item("var(--chart-2)", "Actual import — metered (dashed)", { dashed: true })}
      {mode === "optimized" && item("var(--chart-2)", "Optimised import (dashed)", { dashed: true })}
      {mode === "optimized" && item("var(--chart-4)", "EV delivered — optimised (dashed)", { dashed: true })}
      {showPrice && item("var(--chart-1)", "Price €/MWh (right axis)")}
          {gridCapKw > 0 && item("var(--destructive)", `Grid cap ${formatCapKW(gridCapKw * 1000)} (dashed)`, { dashed: true })}
    </div>
  )
}

/** Mode-aware legend for the Battery State of Charge (B1/B2) chart. The default
 *  swatch legend can't show that the packs are solid vs dashed, or that the
 *  "actual" comparison lines are faded/dashed — so render true line styles.
 *   • engine: simulated packs = solid, metered actuals = dashed.
 *   • optimised: optimised packs = dashed, actuals = faded solid.
 *   • bms-only: packs = dashed. */
function SocLegend({ mode }: { mode: "optimized" | "bms-only" | "engine" }) {
  const item = (
    color: string,
    label: string,
    opts?: { dashed?: boolean; opacity?: number },
  ) => (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <LineSample color={color} dashed={opts?.dashed} opacity={opts?.opacity} />
      {label}
    </span>
  )
  const b1 = "var(--chart-2)"
  const b2 = "var(--chart-3)"
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-3 text-[11px]">
      {mode === "engine" && (
        <>
          {item(b1, "B1 SOC — simulated")}
          {item(b2, "B2 SOC — simulated")}
          {item(b1, "B1 SOC — actual (dashed)", { dashed: true, opacity: 0.6 })}
          {item(b2, "B2 SOC — actual (dashed)", { dashed: true, opacity: 0.6 })}
        </>
      )}
      {mode === "optimized" && (
        <>
          {item(b1, "B1 SOC — optimised (dashed)", { dashed: true })}
          {item(b2, "B2 SOC — optimised (dashed)", { dashed: true })}
          {item(b1, "B1 SOC — actual", { opacity: 0.45 })}
          {item(b2, "B2 SOC — actual", { opacity: 0.45 })}
        </>
      )}
      {mode === "bms-only" && (
        <>
          {item(b1, "B1 SOC (dashed)", { dashed: true })}
          {item(b2, "B2 SOC (dashed)", { dashed: true })}
        </>
      )}
    </div>
  )
}

/** Legend chip explaining the green (cheap) / red (peak) price-band shading. */
function PriceBandLegend() {
  const frac = ((OPTIMIZER_DEFAULTS.cheapSpreadFrac ?? 0.3) * 100).toFixed(0)
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span
        className="flex items-center gap-1.5"
        title={`Slots the dispatch algorithm classifies as cheap: price within the bottom ${frac}% of the day's min→max spread (same rule as buy-now / firm cheap+car import). Dimmed when the day spread can't beat round-trip battery wear.`}
      >
        <span className="inline-block h-2.5 w-4 rounded-sm" style={{ backgroundColor: BAND_GREEN, opacity: 0.5 }} aria-hidden />
        Cheap (dispatch rule)
      </span>
      <span
        className="flex items-center gap-1.5"
        title={`Slots in the top ${frac}% of the day's price spread — the peak the algorithm avoids importing in / discharges into.`}
      >
        <span className="inline-block h-2.5 w-4 rounded-sm" style={{ backgroundColor: BAND_RED, opacity: 0.5 }} aria-hidden />
        Peak (dispatch rule)
      </span>
    </div>
  )
}

/** Rich tooltip for the Price & Grid Import panel — exact timestamp + values. */
function PriceTooltip({
  active,
  payload,
  originMs,
  isOpt,
  singleTitle = "Actual (BMS)",
}: {
  active?: boolean
  payload?: Array<{ payload: Record<string, number | null> }>
  originMs: number
  isOpt: boolean
  /** Column heading for the single-world (non-optimised) layout. */
  singleTitle?: string
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const t = new Date(originMs + Number(row.hour) * 3_600_000)
  const timeLabel = t.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const fmt = (v: number, d = 1) => v.toLocaleString(undefined, { maximumFractionDigits: d })
  const num = (v: number | null | undefined) => (v == null ? null : Number(v))

  // ── Shared signals (identical in both worlds) ──────────────────────────
  const price = num(row.price)
  // EV delivered = METERED (C1+C2); AUX = ChargePost hotel draw; site load =
  // what the kernel serves (EV + AUX). Shown separately so "EV 0.9 kW with no
  // car plugged" can never appear again (Gronau defect 2).
  const evKw = row.evPosKw != null ? Math.abs(Number(row.evPosKw)) : null
  const auxKw = row.auxPosKw != null ? Math.abs(Number(row.auxPosKw)) : null
  const siteLoadKw = row.siteLoadKw != null ? Math.abs(Number(row.siteLoadKw)) : null

  // ── Actual (metered BMS) side ��─────────────────────────────────────────
  const actGrid = row.importNegKw != null ? Math.abs(Number(row.importNegKw)) : null
  const actB1Soc = num(row.actualB1SocPct) ?? (isOpt ? null : num(row.b1SocPct))
  const actB2Soc = num(row.actualB2SocPct) ?? (isOpt ? null : num(row.b2SocPct))

  // ── Optimised counterfactual side ──────────────────────────────────────
  const optGrid = row.optimizedImportNegKw != null ? Math.abs(Number(row.optimizedImportNegKw)) : null
  const optB1Soc = num(row.b1SocPct)
  const optB2Soc = num(row.b2SocPct)

  // ── Engine mode: real metered grid import for comparison vs the calculated
  // area (actGrid). delta = engine − metered; ≈0 means the replay reproduced
  // what the site actually did.
  const metGrid = row.meteredImportNegKw != null ? Math.abs(Number(row.meteredImportNegKw)) : null
  const engineVsMetered = actGrid != null && metGrid != null ? actGrid - metGrid : null

  // Per-connector energy flow (optimised dispatch only). Unit 1 → Connector A,
  // Unit 2 → Connector B. With gXKw = grid import (+) and bXKw = battery power
  // (+ charge / − discharge): EV at connector = g − b; the battery (discharge)
  // supplies max(0,−b), the grid supplies the rest, and any +b is grid → pack.
  const EPS = 0.05
  const flows = [
    { conn: "A", unit: "1", g: row.g1Kw, b: row.b1Kw, mEvKw: row.mEv1Kw, mKwh: row.mEv1Kwh, sKwh: row.sEv1Kwh },
    { conn: "B", unit: "2", g: row.g2Kw, b: row.b2Kw, mEvKw: row.mEv2Kw, mKwh: row.mEv2Kwh, sKwh: row.sEv2Kwh },
  ]
    .filter((c) => c.g != null && c.b != null)
    .map((c) => {
      const g = Number(c.g)
      const b = Number(c.b)
      const evOut = g - b // SIMULATED EV delivered at this connector
      const battToEv = Math.max(0, -b)
      const gridToEv = Math.max(0, evOut - battToEv)
      const charge = Math.max(0, b)
      // METERED EV power (ground truth) from the cumulative-counter delta.
      const meteredEv = c.mEvKw != null ? Math.max(0, Number(c.mEvKw)) : null
      // Cumulative within-window energy: metered vs simulated.
      const meteredKwh = c.mKwh != null ? Number(c.mKwh) : null
      const simKwh = c.sKwh != null ? Number(c.sKwh) : null
      return { ...c, evOut, battToEv, gridToEv, charge, meteredEv, meteredKwh, simKwh }
    })

  // Grid-import delta (optimised vs actual): negative = optimiser imported less.
  const gridDelta = actGrid != null && optGrid != null ? optGrid - actGrid : null

  // ── Semantic colors: ONE meaning each (this tooltip is the primary debug aid) ──
  //   WORLD axis   → Actual/metered = neutral foreground · Optimised/sim = blue
  //   SOURCE axis  → grid = terracotta · battery = green
  //   SHARED       → price = amber
  // No color carries two meanings, and purple (old chart-5) is dropped entirely.
  const C_PRICE = "var(--chart-1)" // amber
  const C_OPT = "var(--chart-2)" // blue  → optimised / simulated
  const C_BATTERY = "var(--chart-3)" // green → battery energy
  const C_GRID = "var(--chart-4)" // terracotta → grid energy
  const optTint = "color-mix(in oklch, var(--chart-2) 7%, transparent)"
  const optBand = "color-mix(in oklch, var(--chart-2) 14%, transparent)"

  // One metric row inside a world column.
  const Row = ({
    label,
    value,
    unit,
    dot,
    strong,
  }: {
    label: string
    value: number | null
    unit: string
    dot?: string
    strong?: boolean
  }) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {dot ? <span className="inline-block size-2 rounded-[3px]" style={{ backgroundColor: dot }} aria-hidden /> : null}
        {label}
      </span>
      <span className={`tabular-nums ${strong ? "text-sm font-bold text-foreground" : "font-medium text-foreground"}`}>
        {value == null ? "—" : `${fmt(value)} ${unit}`}
      </span>
    </div>
  )

  // A metered-vs-simulated value pair: metered = neutral (ground truth), sim = blue.
  const Pair = ({ metered, sim, unit }: { metered: number | null; sim: number | null; unit: string }) => (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <span className="font-semibold text-foreground">{metered != null ? fmt(metered) : "—"}</span>
      <span className="text-muted-foreground/60" aria-hidden>·</span>
      <span className="font-semibold" style={{ color: C_OPT }}>{sim != null ? `${fmt(sim)} ${unit}` : "—"}</span>
    </span>
  )

  // A single world column (Actual or Optimised) in the top split.
  const WorldColumn = ({
    title,
    accent,
    band,
    bg,
    grid,
    b1Soc,
    b2Soc,
    children,
  }: {
    title: string
    accent: string
    band: string
    bg?: string
    grid: number | null
    b1Soc: number | null
    b2Soc: number | null
    children?: React.ReactNode
  }) => (
    <div className="flex flex-col" style={bg ? { backgroundColor: bg } : undefined}>
      <div
        className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: accent, backgroundColor: band }}
      >
        {title}
      </div>
      <div className="grid gap-1 px-3 py-2 text-xs">
        <Row label="Grid import" value={grid} unit="kW" dot={C_GRID} strong />
        <Row label="SOC B1" value={b1Soc} unit="%" />
        <Row label="SOC B2" value={b2Soc} unit="%" />
        {children}
      </div>
    </div>
  )

  return (
    <div className="w-[300px] overflow-hidden rounded-lg border bg-background/95 text-xs shadow-lg backdrop-blur">
      {/* Header: timestamp · shared price · shared EV demand */}
      <div className="flex flex-col gap-0.5 border-b px-3 py-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="font-semibold text-foreground">{timeLabel}</span>
          <span className="flex items-center gap-1.5 tabular-nums" style={{ color: C_PRICE }}>
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: C_PRICE }} aria-hidden />
            <span className="font-semibold">{price == null ? "—" : `${fmt(price)} €/MWh`}</span>
          </span>
        </div>
        {evKw != null ? (
          <div className="flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
            <span>{auxKw != null ? "EV delivered, metered C1+C2 (shared)" : "Site load (shared)"}</span>
            <span className="font-medium tabular-nums text-foreground">{`${fmt(evKw)} kW`}</span>
          </div>
        ) : null}
        {auxKw != null ? (
          <div className="flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
            <span>AUX ChargePost (non-dispatchable)</span>
            <span className="font-medium tabular-nums">{`${fmt(auxKw)} kW`}</span>
          </div>
        ) : null}
        {auxKw != null && siteLoadKw != null ? (
          <div className="flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
            <span>Site load served (EV + AUX)</span>
            <span className="font-medium tabular-nums">{`${fmt(siteLoadKw)} kW`}</span>
          </div>
        ) : null}
      </div>

      {isOpt ? (
        <>
          {/* MAJOR split: Actual (neutral) | Optimised (blue, tinted) */}
          <div className="grid grid-cols-2 divide-x-2">
            <WorldColumn
              title="Actual (BMS)"
              accent="var(--foreground)"
              band="var(--muted)"
              grid={actGrid}
              b1Soc={actB1Soc}
              b2Soc={actB2Soc}
            />
            <WorldColumn
              title="Optimised"
              accent={C_OPT}
              band={optBand}
              bg={optTint}
              grid={optGrid}
              b1Soc={optB1Soc}
              b2Soc={optB2Soc}
            >
              {gridDelta != null && Math.abs(gridDelta) > EPS ? (
                <div
                  className="mt-0.5 inline-flex w-fit items-center gap-1 self-end rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                  style={{
                    color: gridDelta < 0 ? C_BATTERY : C_GRID,
                    backgroundColor:
                      gridDelta < 0
                        ? "color-mix(in oklch, var(--chart-3) 14%, transparent)"
                        : "color-mix(in oklch, var(--chart-4) 14%, transparent)",
                  }}
                >
                  {`${gridDelta < 0 ? "▼ −" : "▲ +"}${fmt(Math.abs(gridDelta))} kW grid vs actual`}
                </div>
              ) : null}
            </WorldColumn>
          </div>

          {flows.length > 0 ? (
            <div className="border-t px-3 py-2">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Per-connector EV
                </span>
                <span className="flex items-center gap-2.5 text-[10px]">
                  <span className="flex items-center gap-1">
                    <span className="inline-block size-2 rounded-full bg-foreground" aria-hidden />
                    <span className="text-muted-foreground">metered</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block size-2 rounded-full" style={{ backgroundColor: C_OPT }} aria-hidden />
                    <span className="text-muted-foreground">sim</span>
                  </span>
                </span>
              </div>
              <div className="grid gap-1.5">
                {flows.map((f) => {
                  const serving = f.evOut > EPS || (f.meteredEv != null && f.meteredEv > EPS)
                  // Simulated source breakdown: grid=terracotta, battery=green (consistent
                  // with the SOURCE axis). grid→EV + grid→pack = unit grid import;
                  // grid→EV + battery→car = EV delivered at this connector.
                  const breakdown = [
                    { label: "battery → car", value: f.battToEv, color: C_BATTERY },
                    { label: "grid → car", value: f.gridToEv, color: C_GRID },
                    { label: "grid → pack", value: f.charge, color: C_GRID },
                  ].filter((l) => l.value > EPS)
                  // Instantaneous metered-vs-sim power agreement.
                  const delta = f.meteredEv != null ? f.evOut - f.meteredEv : null
                  return (
                    <div key={f.conn} className="rounded-md border bg-muted/30 px-2 py-1.5 leading-tight">
                      {/* Headline: connector + EV power (metered · sim) */}
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-foreground">
                          {`Connector ${f.conn}`}
                          <span className="font-normal text-muted-foreground">{` ← Battery ${f.unit}`}</span>
                        </span>
                        {serving ? (
                          <Pair metered={f.meteredEv} sim={f.evOut} unit="kW" />
                        ) : (
                          <span className="font-medium tabular-nums text-muted-foreground">
                            {breakdown.length ? "charging" : "idle"}
                          </span>
                        )}
                      </div>

                      {/* Simulated source split (one aligned row per source) */}
                      {breakdown.length ? (
                        <div className="mt-1 grid gap-0.5">
                          {breakdown.map((l) => (
                            <div key={l.label} className="flex items-center justify-between gap-3 text-[11px]">
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />
                                {l.label}
                              </span>
                              <span className="font-medium tabular-nums" style={{ color: l.color }}>
                                {`${fmt(l.value)} kW`}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {/* Cumulative within-window energy + agreement */}
                      {f.meteredKwh != null || f.simKwh != null ? (
                        <div className="mt-1 flex items-center justify-between gap-3 border-t pt-1 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-2">
                            <span>Σ window</span>
                            <Pair metered={f.meteredKwh} sim={f.simKwh} unit="kWh" />
                          </span>
                          {delta != null && Math.abs(delta) > EPS ? (
                            <span
                              className="rounded px-1 font-medium tabular-nums"
                              style={{
                                color: C_GRID,
                                backgroundColor: "color-mix(in oklch, var(--chart-4) 12%, transparent)",
                              }}
                            >
                              {`Δ ${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta))} kW`}
                            </span>
                          ) : delta != null ? (
                            <span style={{ color: C_BATTERY }}>matched</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <WorldColumn
          title={singleTitle}
          accent="var(--foreground)"
          band="var(--muted)"
          grid={actGrid}
          b1Soc={actB1Soc}
          b2Soc={actB2Soc}
        >
          {metGrid != null ? (
            <div className="mt-0.5 border-t pt-1">
              <Row label="Actual import (metered)" value={metGrid} unit="kW" dot={C_OPT} />
              {engineVsMetered != null ? (
                <div
                  className="mt-0.5 inline-flex w-fit items-center gap-1 self-end rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                  style={{
                    color: Math.abs(engineVsMetered) <= EPS ? C_BATTERY : C_GRID,
                    backgroundColor:
                      Math.abs(engineVsMetered) <= EPS
                        ? "color-mix(in oklch, var(--chart-3) 14%, transparent)"
                        : "color-mix(in oklch, var(--chart-4) 14%, transparent)",
                  }}
                >
                  {Math.abs(engineVsMetered) <= EPS
                    ? "matches actual"
                    : `${engineVsMetered < 0 ? "▼ −" : "▲ +"}${fmt(Math.abs(engineVsMetered))} kW vs actual`}
                </div>
              ) : null}
            </div>
          ) : null}
        </WorldColumn>
      )}
    </div>
  )
}

// ── Chart configs ─────────────────────���────────────────────────────────────
function gridConfig(isOpt: boolean): ChartConfig {
  const base: ChartConfig = {
    importNegKw: { label: "Grid import kW", color: "var(--chart-5)" },
    optimizedImportNegKw: { label: "Optimized import kW", color: "var(--chart-2)" },
    meteredImportNegKw: { label: "Actual import (metered) kW", color: "var(--chart-2)" },
    evPosKw: { label: "EV delivered (metered) kW", color: "var(--chart-4)" },
    auxPosKw: { label: "AUX (ChargePost) kW", color: "var(--muted-foreground)" },
    price: { label: "Price €/MWh", color: "var(--chart-1)" },
  }
  if (isOpt) base.optEvPosKw = { label: "EV delivered (optimised) kW", color: "var(--chart-4)" }
  return base
}

function socConfig(isOpt: boolean, mode?: "optimized" | "bms-only" | "engine"): ChartConfig {
  if (isOpt) {
    return {
      b1SocPct: { label: "B1 SOC % (optimised)", color: "var(--chart-2)" },
      b2SocPct: { label: "B2 SOC % (optimised)", color: "var(--chart-3)" },
      actualB1SocPct: { label: "B1 SOC % (actual)", color: "var(--chart-2)" },
      actualB2SocPct: { label: "B2 SOC % (actual)", color: "var(--chart-3)" },
    }
  }
  if (mode === "engine") {
    return {
      b1SocPct: { label: "B1 SOC % (simulated)", color: "var(--chart-2)" },
      b2SocPct: { label: "B2 SOC % (simulated)", color: "var(--chart-3)" },
      actualB1SocPct: { label: "B1 SOC % (actual)", color: "var(--chart-2)" },
      actualB2SocPct: { label: "B2 SOC % (actual)", color: "var(--chart-3)" },
    }
  }
  return {
    b1SocPct: { label: "B1 SOC %", color: "var(--chart-2)" },
    b2SocPct: { label: "B2 SOC %", color: "var(--chart-3)" },
  }
}

// Price-band shading colors. Exported so other charts (e.g. the financial
// report's grid-import comparison) render the exact same visual language.
export const BAND_GREEN = "var(--chart-3)"
export const BAND_RED = "var(--destructive)"

export interface PriceBand {
  x1: number
  x2: number
  fill: string
  opacity: number
}

/** Round a magnitude up to a clean axis bound (1/2/2.5/5 × 10ⁿ). */
function niceCeil(v: number): number {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * mag
}

/**
 * Per operating day, average price into 15-minute buckets and shade them with
 * the DISPATCH ALGORITHM'S OWN cheap-slot rule (lib/optimizer/cheap-slot.ts
 * analyzeDayPrices, same V5 params the engine solves with) — NOT a fixed
 * "8 cheapest" rank:
 *
 *   • GREEN  = price ≤ cheapCutoff = min + cheapSpreadFrac·(max−min) — exactly
 *     the day-spread-relative "cheap" the planner uses for buy-now / firm
 *     cheap+car import decisions. On a flat day few (or no) slots qualify; on a
 *     volatile day the whole trough does.
 *   • RED    = the mirrored top of the spread: price ≥ max − frac·(max−min) —
 *     the slots the planner treats as the day's genuine peak (discharge /
 *     avoid-import territory).
 *
 * Opacity scales with DEPTH into the band (distance past the cutoff toward the
 * extreme), so the trough/peak itself is the most saturated. When the day
 * spread is too small for arbitrage to beat round-trip degradation
 * (arbitrageWorthIt=false), bands are dimmed — the algorithm won't cycle the
 * battery on those days, price shape notwithstanding.
 */
export function computePriceBands(points: { hour: number; price: number | null }[]): PriceBand[] {
  if (points.length === 0) return []
  const SLOT_H = 0.25 // 15 minutes

  // average price per 15-min bucket
  const agg = new Map<number, { sum: number; n: number }>()
  for (const p of points) {
    if (p.price == null) continue
    const slot = Math.floor(p.hour / SLOT_H)
    const cur = agg.get(slot) ?? { sum: 0, n: 0 }
    cur.sum += p.price
    cur.n += 1
    agg.set(slot, cur)
  }
  const buckets = [...agg.entries()].map(([slot, v]) => ({
    startHour: slot * SLOT_H,
    price: v.sum / v.n,
    day: Math.floor((slot * SLOT_H) / 24),
  }))

  // group by operating day (bands are classified per-day, like the planner's
  // day-spread stats)
  const byDay = new Map<number, typeof buckets>()
  for (const b of buckets) {
    if (!byDay.has(b.day)) byDay.set(b.day, [])
    byDay.get(b.day)!.push(b)
  }

  const bands: PriceBand[] = []
  for (const day of byDay.values()) {
    const prices = day.map((b) => b.price)
    const stats = analyzeDayPrices(prices, OPTIMIZER_DEFAULTS)
    const spread = stats.maxP - stats.minP
    if (!(spread > 0)) continue // flat day: nothing is cheap or expensive

    // Mirror of the cheap cutoff for the expensive side of the spread.
    const frac = OPTIMIZER_DEFAULTS.cheapSpreadFrac ?? 0.3
    const expensiveCutoff = stats.maxP - frac * spread

    // Dim everything when cycling the battery can't beat round-trip wear —
    // the engine won't act on this day's spread, so don't shout about it.
    const arb = arbitrageWorthIt(prices, OPTIMIZER_DEFAULTS)
    const dim = arb.worthIt ? 1 : 0.45

    // Classify each slot, then COALESCE contiguous same-colour slots into one
    // band whose opacity is the run's average depth. One rect per run kills
    // both artefacts of the old per-slot rendering: the anti-aliasing hairline
    // ("white stripes") between adjacent 15-min rects, and the stepped
    // per-slot opacity that read as vertical banding inside a cheap window.
    type Slot = { x1: number; x2: number; fill: string; opacity: number }
    const slots: Slot[] = []
    const daySorted = [...day].sort((a, b) => a.startHour - b.startHour)
    for (const b of daySorted) {
      if (b.price <= stats.cheapCutoff) {
        // Depth 0 at the cutoff → 1 at the day minimum.
        const denom = stats.cheapCutoff - stats.minP
        const depth = denom > 0 ? (stats.cheapCutoff - b.price) / denom : 1
        slots.push({
          x1: b.startHour,
          x2: b.startHour + SLOT_H,
          fill: BAND_GREEN,
          opacity: (0.12 + 0.22 * depth) * dim,
        })
      } else if (b.price >= expensiveCutoff) {
        // Depth 0 at the cutoff → 1 at the day maximum.
        const denom = stats.maxP - expensiveCutoff
        const depth = denom > 0 ? (b.price - expensiveCutoff) / denom : 1
        slots.push({
          x1: b.startHour,
          x2: b.startHour + SLOT_H,
          fill: BAND_RED,
          opacity: (0.1 + 0.2 * depth) * dim,
        })
      }
    }
    let run: (Slot & { count: number }) | null = null
    const flush = () => {
      if (run) {
        bands.push({ x1: run.x1, x2: run.x2, fill: run.fill, opacity: run.opacity / run.count })
        run = null
      }
    }
    for (const s of slots) {
      if (run && run.fill === s.fill && Math.abs(run.x2 - s.x1) < 1e-6) {
        run.x2 = s.x2
        run.opacity += s.opacity
        run.count++
      } else {
        flush()
        run = { ...s, count: 1 }
      }
    }
    flush()
  }
  return bands
}
