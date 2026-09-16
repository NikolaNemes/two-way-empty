"use client"

/**
 * PriceVsGridChart
 * ────────────────────────────────────────────────────────────────────────
 * Composite timeline showing four series on a shared x-axis:
 *
 *   TOP PANEL (dual y-axis)
 *     Left axis  (€/MWh) :: DAM price · stepped amber line
 *     Right axis (kW)    :: Optimizer grid import   · solid emerald
 *                            BMS-actual grid import · dashed slate
 *
 *   BOTTOM PANEL (single y-axis)
 *     €              :: Cumulative uplift (baseline − optimizer) · area fill
 *
 * The two panels are stacked Recharts ComposedCharts that share the same
 * x-axis ticks. Visualising price next to optimizer-vs-BMS grid kW makes
 * it obvious *where* the optimizer wins (the emerald line dips below the
 * dashed BMS line during expensive hours and rises above it during the
 * cheap windows). The cumulative-uplift curve below converts those
 * per-step deltas into a running € number that ends at the headline
 * savings figure shown in the cost card.
 *
 * Imports are plotted as POSITIVE kW for legibility (a typical DAM
 * spike around 19:00 should pair with two POSITIVE bars going up, not
 * down). We flip the sign at the boundary because the upstream API
 * convention is negative = import.
 */

import { useMemo } from "react"
import {
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts"

import type { TelemetryFrame } from "@/lib/prototype-telemetry"
import { cn } from "@/lib/utils"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Battery, Bolt, Clock, Gauge, Plug, Target, Zap } from "lucide-react"

interface OptimizedFrameLite {
  ts: string
  gridKw: number // API convention: negative = import
  priceEurMwh: number
  costEurStep: number
  baselineCostEurStep: number
  /** Per-pack SOC in % at this frame, if available. The price chart
   *  itself does not need them, but the SOC sub-chart underneath does
   *  — they're optional so live-mode callers (which don't run the
   *  optimizer counterfactual) can still pass `optimizedFrames`. */
  b1SocPct?: number
  b2SocPct?: number
}

export interface PriceVsGridChartProps {
  /** Per-step optimizer output, ordered chronologically. */
  optimizedFrames: OptimizedFrameLite[]
  /**
   * Real BMS telemetry frames matching `optimizedFrames` 1:1 by index.
   * The two arrays are co-iterated; if their lengths differ we fall
   * back to the shorter run rather than misalign timestamps.
   */
  bmsFrames: TelemetryFrame[]
  /**
   * Start-of-operating-day timestamp (ms) that maps to x=0. When set, the
   * x-axis is anchored here (06:00) rather than to the first available
   * frame, so a day that only has data from e.g. 08:00 onward still draws
   * its line starting at the 08:00 mark with the 06:00→08:00 stretch left
   * empty — exactly like the Grid Power Flow chart. Falls back to the
   * first optimizer frame when omitted.
   */
  periodStartTs?: number
  /**
   * Full operating-day span in hours that the x-axis must cover (24 for a
   * single 06:00→06:00 day, more for multi-day ranges). When set, the axis
   * always spans the whole day regardless of how much data exists, and the
   * series simply stop where the data stops. Falls back to the data extent
   * when omitted.
   */
  totalHours?: number
}

interface Row {
  /** ISO timestamp — used as a stable key + tooltip label. */
  ts: string
  /** Hours since chart start, used as the numeric x value so multi-day
   *  spans render with the right horizontal proportions. */
  hour: number
  damEurMwh: number | null
  optGridKw: number // positive = import
  bmsGridKw: number // positive = import
  cumUpliftEur: number
}

/**
 * One of the two cheapest hours within a single operating day, picked
 * by raw rank (no percentile, no €-threshold). Each band is exactly
 * one hour wide on the x-axis and is rendered as a translucent green
 * vertical stripe behind both panels of the chart, so the user can
 * see at a glance:
 *
 *   "the optimizer's grid-import line spikes inside the green stripes
 *    (charging during the day's cheapest hours) and dips outside them
 *    (discharging the rest of the day) — that's where the uplift
 *    comes from."
 *
 * We tag rank-1 and rank-2 with separate tiers so the absolute
 * cheapest hour of the day can be tinted slightly stronger than the
 * runner-up, mirroring the optimizer's own "decisive cheap" priority.
 */
interface CheapBand {
  /** x-axis start of the stripe, in hours since chart t0. */
  startHour: number
  /** x-axis end of the stripe, in hours since chart t0 (exclusive). */
  endHour: number
  /** 1 = cheapest 15-min slot of the operating day, 8 = 8th cheapest. */
  tier: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}

/**
 * A contiguous run of slots in one of two CHEAP-PRICE tiers, drawn as
 * an emphasized band on top of the standard cheap-tier gradient so the
 * eye locks onto these windows even on long horizons.
 *
 *   • `negative`   — DAM cleared below €0/MWh. The grid is paying us
 *                    to consume. Red wash + dashed red border.
 *   • `nearZero`   — DAM cleared at or just above €0/MWh (0 ≤ p <
 *                    NEAR_ZERO_THRESHOLD_EUR_MWH). Effectively free
 *                    energy, but distinct from "the market pays you"
 *                    so it gets a cooler, less alarming sky-blue
 *                    dashed wash. Threshold matches the optimizer's
 *                    own "decisive cheap" tolerance.
 *
 * The two tiers are kept SEPARATE in the data (no merging across the
 * tier boundary) so the legend swatch and band colour line up 1-to-1.
 * Inline band labels were removed — they crowded the chart and the
 * same information is now communicated by the (run-count badge) in
 * the legend at top-right.
 */
type CheapRunTier = "negative" | "nearZero"
interface CheapRunBand {
  tier: CheapRunTier
  startHour: number
  endHour: number
  /** Most-extreme price in the run (€/MWh). Most-negative for `negative`,
   *  closest-to-zero for `nearZero`. */
  minPrice: number
  /** Mean price across the run (€/MWh). */
  avgPrice: number
}

/** Anything below this in €/MWh counts as "near zero — effectively free". */
const NEAR_ZERO_THRESHOLD_EUR_MWH = 5

// Tailwind-mapped tokens for the chart series. Kept in one place so a
// future theme swap only touches this object.
const COLORS = {
  price: "hsl(38 92% 50%)", // amber — DAM
  opt: "hsl(160 84% 39%)", // emerald — optimizer
  bms: "hsl(215 20% 45%)", // slate — BMS as-is
  uplift: "hsl(142 71% 45%)", // green — savings
  upliftLoss: "hsl(0 72% 51%)", // red — when cum uplift goes negative
  axis: "hsl(0 0% 60%)",
  // ── Cheap-run tier accents ────────────────────────────────────
  // `negative`: warm red — alarm-style, "the market is paying you,
  // pay attention". Same hue family the codebase uses for losses.
  negFill: "hsl(0 80% 55% / 0.18)",
  negStroke: "hsl(0 80% 45%)",
  // `nearZero`: cool sky-blue — calmer than red, distinct from the
  // emerald cheap-tier gradient so it doesn't blend into the green
  // wash, distinct from the amber DAM line so it doesn't read as
  // "this is the price". Sky-blue at low alpha + dashed border
  // gives a clear "almost free" cue without screaming.
  nearZeroFill: "hsl(205 90% 55% / 0.16)",
  nearZeroStroke: "hsl(205 85% 40%)",
}

export function PriceVsGridChart({
  optimizedFrames,
  bmsFrames,
  periodStartTs,
  totalHours: totalHoursProp,
}: PriceVsGridChartProps) {
  // Eight-tier emerald gradient for the 8 cheapest 15-min slots per
  // operating day. Tier 1 (the absolute cheapest slot of the day) gets
  // the strongest green saturation + alpha and a thin border so the
  // single best charging slot reads as a discrete glow even on long
  // multi-day horizons. Each subsequent tier fades in lightness AND
  // alpha — by tier 8 the band is barely-there scaffolding that
  // disappears under the price line, which is exactly what we want:
  // the eye latches onto the deepest greens first ("most green = best
  // hours to charge"), and the lighter ones fill in as supporting
  // context only when the user looks closely.
  const CHEAP_GRADIENT: Record<CheapBand["tier"], string> = {
    1: "hsl(160 90% 30% / 0.42)",
    2: "hsl(158 82% 36% / 0.36)",
    3: "hsl(156 76% 42% / 0.30)",
    4: "hsl(154 70% 48% / 0.24)",
    5: "hsl(152 66% 54% / 0.19)",
    6: "hsl(150 62% 60% / 0.14)",
    7: "hsl(148 58% 66% / 0.10)",
    8: "hsl(146 54% 72% / 0.07)",
  }
  const CHEAP_BORDER_RANK1 = "hsl(160 84% 26% / 0.7)"

  // `totalUpliftEur` and the per-row `cumUpliftEur` running sum are
  // computed but no longer rendered — the cumulative-uplift sub-chart
  // that consumed them was removed. We deliberately keep the maths in
  // place (it's a few additions per frame) so re-introducing the
  // panel later is a one-line JSX change rather than a re-derivation
  // of the row schema.
  const { rows, peakOptKw, peakBmsKw, priceMin, priceMax, cheapBands, cheapRuns } =
    useMemo(() => {
      const n = Math.min(optimizedFrames.length, bmsFrames.length)
      if (n === 0) {
        return {
          rows: [] as Row[],
          peakOptKw: 0,
          peakBmsKw: 0,
          priceMin: 0,
          priceMax: 0,
          cheapBands: [] as CheapBand[],
          cheapRuns: [] as CheapRunBand[],
        }
      }

      // Anchor x=0 on the operating-day start (06:00) when provided, so the
      // line begins at its true clock position and the pre-data stretch of
      // the day stays empty rather than being squeezed out of the axis.
      const t0 = periodStartTs ?? new Date(optimizedFrames[0].ts).getTime()
      let cumUpliftEur = 0
      let peakOptKw = 0
      let peakBmsKw = 0
      let priceMin = Infinity
      let priceMax = -Infinity

      const rows: Row[] = []
      for (let i = 0; i < n; i++) {
        const o = optimizedFrames[i]
        const b = bmsFrames[i]
        // Per-step uplift = baseline cost − optimizer cost. Both are
        // signed in € (positive when we paid, negative when we earned),
        // so the subtraction yields the running savings.
        cumUpliftEur += o.baselineCostEurStep - o.costEurStep
        // Flip sign so import shows as positive kW going UP, which
        // pairs intuitively with price spikes also going up.
        const optKw = Math.max(0, -o.gridKw)
        const bmsKw = Math.max(0, -(b.grid.P_grid_w / 1000))
        if (optKw > peakOptKw) peakOptKw = optKw
        if (bmsKw > peakBmsKw) peakBmsKw = bmsKw
        if (o.priceEurMwh < priceMin) priceMin = o.priceEurMwh
        if (o.priceEurMwh > priceMax) priceMax = o.priceEurMwh

        rows.push({
          ts: o.ts,
          hour: (new Date(o.ts).getTime() - t0) / 3_600_000,
          damEurMwh: o.priceEurMwh,
          optGridKw: optKw,
          bmsGridKw: bmsKw,
          cumUpliftEur,
        })
      }
      // ── Cheapest 15-min slots per operating day (8 picks) ────────
      // For each operating day (06:00 → 06:00 Berlin) we pick the 8
      // cheapest 15-MINUTE intervals by DAM price and emit one band
      // per slot. 15 min was chosen because (a) the German DAM auction
      // moved to a 15-min product in 2024, and (b) the optimizer
      // works frame-by-frame at sub-hourly resolution — picking
      // hourly bands hides the fact that prices can swing within a
      // single hour and the optimizer routinely prefers e.g. the
      // 02:15-02:30 slot over 02:00-02:15.
      //
      // Tier 1 = the day's cheapest 15-min slot, tier 8 = the 8th
      // cheapest. The renderer maps tier to a green-gradient fill so
      // the very best slots glow strongly and the borderline picks
      // fade out — the eye locks onto the deep green first, which is
      // exactly the cue the user wanted ("most green = best hours to
      // charge"). Picking 8 slots × 15 min = 2 h of total coverage,
      // which is the same energy budget the optimizer commits to per
      // operating day for BESS recharging.
      // Operating-day key — must be derived from LOCAL clock fields,
      // never from a UTC ISO slice. The previous implementation
      // subtracted 6 h from the UTC timestamp and called
      // `.toISOString().slice(0,10)`, which silently split a 06:00 →
      // 06:00 Berlin window into TWO buckets whenever Berlin's UTC
      // offset wasn't zero (i.e. always — CET is UTC+1, CEST UTC+2).
      // That misbucketing was the visible bug: the morning half-day
      // bucket (06:00 → 01:59 local) had no truly cheap data on a
      // typical day, so its "cheapest 8 slots" landed on the high-
      // price plateau around 06:00–09:00 instead of the midday
      // valley. Keying purely off `getHours()` / `getDate()` keeps
      // every timestamp in the same operating day regardless of
      // timezone or DST.
      const opDayKey = (ts: string) => {
        const d = new Date(ts)
        const shifted = new Date(d)
        if (shifted.getHours() < 6) {
          shifted.setDate(shifted.getDate() - 1)
        }
        return `${shifted.getFullYear()}-${shifted.getMonth() + 1}-${shifted.getDate()}`
      }

      // Bucket each row into its operating day at 15-min granularity.
      // The slot key is `hour-of-day * 4 + floor(minute/15)`, giving
      // 96 unique buckets per day — matching the DAM 15-min auction
      // grid. We keep the FIRST row we see for each (day, slot) pair
      // because the band's left edge has to be a real frame on the
      // x-axis, and the row's `hour` field is precomputed in fractional
      // hours-since-chart-start.
      interface DaySlotEntry {
        slot: number // 0..95
        price: number
        startHour: number
      }
      const dayBuckets = new Map<string, Map<number, DaySlotEntry>>()
      for (const r of rows) {
        if (r.damEurMwh == null) continue
        const d = new Date(r.ts)
        const k = opDayKey(r.ts)
        const slot = d.getHours() * 4 + Math.floor(d.getMinutes() / 15)
        if (!dayBuckets.has(k)) dayBuckets.set(k, new Map())
        const m = dayBuckets.get(k)!
        if (!m.has(slot)) {
          m.set(slot, { slot, price: r.damEurMwh, startHour: r.hour })
        }
      }

      // For each operating day, take the 8 cheapest 15-min slots and
      // tag them with their rank (1..8). When the day's data has
      // fewer than 8 distinct slots — typically only on the edge
      // operating day at the start/end of the selected range — we
      // simply emit fewer bands rather than padding with arbitrary
      // picks; better to under-mark than to mislead.
      const CHEAP_SLOT_COUNT = 8
      const cheapBands: CheapBand[] = []
      for (const [, m] of dayBuckets) {
        const sorted = [...m.values()].sort((a, b) => a.price - b.price)
        const picks = sorted.slice(0, CHEAP_SLOT_COUNT)
        picks.forEach((p, i) => {
          cheapBands.push({
            startHour: p.startHour,
            // Each band is exactly 0.25 h (15 min) wide on the
            // x-axis, matching the DAM 15-min auction product.
            endHour: p.startHour + 0.25,
            tier: (i + 1) as CheapBand["tier"],
          })
        })
      }
      // Render bands left-to-right so SVG stacking order is stable.
      cheapBands.sort((a, b) => a.startHour - b.startHour)

      // ── Negative-price runs ─────────────────────────────────────
      // The cheap-band gradient marks the day's *relatively* cheap
      // slots, but it cannot tell the user that a slot is actually
      // negative — €−5/MWh and €+5/MWh both end up green if they're
      // the day's floor. Negative prices are economically *very*
      // ── Cheap-price runs (two tiers, kept separate) ───────────────
      // We group consecutive slots that share the SAME tier into one
      // band. Crossing a tier boundary (e.g. negative → near-zero)
      // closes the open run and opens a new one, so the legend swatch
      // colours map 1-to-1 onto what's drawn on the chart.
      //
      // Tier classification:
      //   p < 0                 → "negative"  (grid pays us)
      //   0 ≤ p < threshold     → "nearZero"  (effectively free)
      //   else                  → no run      (price line carries it)
      //
      // We collapse same-tier slots rather than per-slot bands so the
      // visual reads as a single window of opportunity instead of a
      // row of stripes. The eye picks up the tier colour first, the
      // exact slot count second.
      type OpenRun = {
        tier: CheapRunTier
        startHour: number
        endHour: number
        prices: number[]
      }
      const classify = (p: number | null | undefined): CheapRunTier | null => {
        if (p == null) return null
        if (p < 0) return "negative"
        if (p < NEAR_ZERO_THRESHOLD_EUR_MWH) return "nearZero"
        return null
      }
      const cheapRuns: CheapRunBand[] = []
      const closeRun = (run: OpenRun) => {
        const minPrice =
          run.tier === "negative"
            ? Math.min(...run.prices)
            : // For nearZero, "min" means closest-to-zero (i.e. cheapest).
              Math.min(...run.prices)
        cheapRuns.push({
          tier: run.tier,
          startHour: run.startHour,
          endHour: run.endHour,
          minPrice,
          avgPrice:
            run.prices.reduce((a, b) => a + b, 0) / run.prices.length,
        })
      }
      let openRun: OpenRun | null = null
      // Slot stride from the data grid (15 min in fractional hours).
      const SLOT_STRIDE = 0.25
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const tier = classify(r.damEurMwh)
        if (tier !== null) {
          if (!openRun || openRun.tier !== tier) {
            // Tier change (or first cheap slot after a non-cheap stretch)
            // → close the previous run if any, start a new one.
            if (openRun) closeRun(openRun)
            openRun = {
              tier,
              startHour: r.hour,
              endHour: r.hour + SLOT_STRIDE,
              prices: [r.damEurMwh as number],
            }
          } else {
            openRun.endHour = r.hour + SLOT_STRIDE
            openRun.prices.push(r.damEurMwh as number)
          }
        } else if (openRun) {
          closeRun(openRun)
          openRun = null
        }
      }
      if (openRun) closeRun(openRun)

      return {
        rows,
        peakOptKw,
        peakBmsKw,
        priceMin: priceMin === Infinity ? 0 : priceMin,
        priceMax: priceMax === -Infinity ? 0 : priceMax,
        cheapBands,
        cheapRuns,
      }
    }, [optimizedFrames, bmsFrames, periodStartTs])

  if (rows.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded border border-dashed border-muted-foreground/30 text-xs text-muted-foreground">
        No data to chart for the selected window.
      </div>
    )
  }

  // Symmetric kW domain so the optimizer and BMS lines share a comparable
  // visual scale and the user can read "delta" off the chart by eye.
  const kwMax = Math.ceil(Math.max(peakOptKw, peakBmsKw) / 10) * 10 || 10

  // Tick formatter — switches between hour-of-day for a single 24 h
  // span and "Day N · HH:00" for multi-day spans. Avoids axis clutter
  // when zoomed out across many days.
  // x=0 anchor in ms — the operating-day start when provided, else the first
  // frame. Used both by the tick formatter and to keep the three stacked
  // layers (price, session strip, SOC) on a single shared time origin.
  const t0Ms = periodStartTs ?? new Date(rows[0].ts).getTime()
  // The axis ALWAYS spans the full operating day when the caller passes a
  // span; the data extent is only a fallback for standalone usage. This is
  // what makes the line stop where data ends instead of stretching the axis
  // to fit the data — matching the Grid Power Flow chart.
  const dataExtentHours = rows[rows.length - 1]?.hour ?? 0
  const totalHours =
    totalHoursProp != null && totalHoursProp > 0 ? totalHoursProp : dataExtentHours
  const formatHourTick = (h: number) => {
    if (totalHours <= 36) {
      const t = t0Ms + h * 3_600_000
      return new Date(t).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    }
    return `D${Math.floor(h / 24) + 1}`
  }

  // Helper: render the cheapest-slot stripes once and reuse in both
  // panels so they line up perfectly across the price+grid chart and
  // the cumulative-uplift chart below it. Tier-1 (the day's single
  // best 15-min slot) gets a slim emerald border in addition to the
  // stronger fill so it reads as a discrete "decisive slot" marker
  // even on multi-day windows where each 15-min band is only ~1.5 %
  // of the plot width.
  const renderCheapBands = (yAxisId?: string) =>
    cheapBands.map((b, i) => {
      const isRank1 = b.tier === 1
      return (
        <ReferenceArea
          key={`cheap-${i}`}
          x1={b.startHour}
          x2={b.endHour}
          {...(yAxisId ? { yAxisId } : {})}
          fill={CHEAP_GRADIENT[b.tier]}
          stroke={isRank1 ? CHEAP_BORDER_RANK1 : "none"}
          strokeWidth={isRank1 ? 1 : 0}
          ifOverflow="extendDomain"
        />
      )
    })

  /**
   * Render one band per cheap-price run, coloured by tier. The fill
   * sits ON TOP of the cheap-tier emerald gradient — intentional: a
   * sub-zero or near-zero slot IS by definition one of the day's
   * cheapest, so it would already carry green; layering the tier
   * accent on top lets the user see "this is cheap AND it's
   * exceptionally so" in a single glance. Drawing the accent later
   * (later siblings render on top in SVG) cleanly overrides the
   * underlying green wash.
   *
   * Per the user's feedback we no longer place an inline
   * "FREE • avg €X/MWh" label inside the band — those labels crowded
   * the chart and overlapped the price line on dense horizons. The
   * legend at top-right now carries the run count for each tier; the
   * actual price value is read from the (amber) DAM line itself,
   * which already runs through the band.
   */
  const renderCheapRuns = (yAxisId?: string) =>
    cheapRuns.map((b, i) => {
      const isNeg = b.tier === "negative"
      return (
        <ReferenceArea
          key={`run-${b.tier}-${i}`}
          x1={b.startHour}
          x2={b.endHour}
          {...(yAxisId ? { yAxisId } : {})}
          fill={isNeg ? COLORS.negFill : COLORS.nearZeroFill}
          stroke={isNeg ? COLORS.negStroke : COLORS.nearZeroStroke}
          strokeWidth={1.25}
          strokeDasharray="3 2"
          ifOverflow="extendDomain"
        />
      )
    })

  return (
    <div className="space-y-2">
      {/* TOP PANEL — Price + grid kW */}
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-xs font-medium tracking-wide">
            Dispatching Overview — IDM Price Forecast & Grid Import
          </h4>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              {/* 8-stop emerald gradient bar — left = cheapest 15-min
                  slot of the operating day, right = 8th cheapest.
                  Mirrors the palette used to fill the chart bands so
                  the legend reads as a literal key, not a stylised
                  abstraction. */}
              <span
                aria-hidden
                className="inline-block h-3 w-12 rounded-sm border border-emerald-700/40"
                style={{
                  background: `linear-gradient(to right, ${CHEAP_GRADIENT[1]}, ${CHEAP_GRADIENT[2]}, ${CHEAP_GRADIENT[3]}, ${CHEAP_GRADIENT[4]}, ${CHEAP_GRADIENT[5]}, ${CHEAP_GRADIENT[6]}, ${CHEAP_GRADIENT[7]}, ${CHEAP_GRADIENT[8]})`,
                }}
              />
              8 cheapest 15-min slots / op-day
            </span>
            {/*
              Two separate legend chips — one per tier — only rendered
              when the corresponding tier has at least one run in
              view. The chips carry the run count, which is the only
              information the inline band labels used to surface; we
              dropped those labels to keep the chart legible.
            */}
            {(() => {
              const negCount = cheapRuns.filter(
                (r) => r.tier === "negative",
              ).length
              const nzCount = cheapRuns.filter(
                (r) => r.tier === "nearZero",
              ).length
              return (
                <>
                  {negCount > 0 && (
                    <span
                      className="flex items-center gap-1"
                      title={`${negCount} negative-price ${
                        negCount === 1 ? "window" : "windows"
                      } in view — grid is paying us to charge`}
                    >
                      <span
                        aria-hidden
                        className="inline-block h-3 w-4 rounded-sm"
                        style={{
                          background: COLORS.negFill,
                          border: `1px dashed ${COLORS.negStroke}`,
                        }}
                      />
                      <span className="font-medium text-rose-700 dark:text-rose-400">
                        Negative · FREE
                      </span>
                      <span className="font-mono tabular-nums text-rose-700/70 dark:text-rose-400/70">
                        ({negCount})
                      </span>
                    </span>
                  )}
                  {nzCount > 0 && (
                    <span
                      className="flex items-center gap-1"
                      title={`${nzCount} near-zero-price ${
                        nzCount === 1 ? "window" : "windows"
                      } in view — DAM cleared between €0 and €${NEAR_ZERO_THRESHOLD_EUR_MWH}/MWh`}
                    >
                      <span
                        aria-hidden
                        className="inline-block h-3 w-4 rounded-sm"
                        style={{
                          background: COLORS.nearZeroFill,
                          border: `1px dashed ${COLORS.nearZeroStroke}`,
                        }}
                      />
                      <span className="font-medium text-sky-700 dark:text-sky-400">
                        Near zero · &lt;€{NEAR_ZERO_THRESHOLD_EUR_MWH}
                      </span>
                      <span className="font-mono tabular-nums text-sky-700/70 dark:text-sky-400/70">
                        ({nzCount})
                      </span>
                    </span>
                  )}
                </>
              )
            })()}
            <span className="flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-[2px] w-3"
                style={{ background: COLORS.price }}
              />
              DAM €/MWh
            </span>
            <span className="flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-[2px] w-3"
                style={{ background: COLORS.opt }}
              />
              Optimizer kW
            </span>
            <span className="flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-[2px] w-3 border-t border-dashed"
                style={{ borderColor: COLORS.bms }}
              />
              BMS Real kW
            </span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart
            data={rows}
            margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(0 0% 90%)"
              vertical={false}
            />
            {renderCheapBands("price")}
            {renderCheapRuns("price")}
            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, totalHours]}
              tickFormatter={formatHourTick}
              stroke={COLORS.axis}
              fontSize={10}
            />
            {/* Left axis — €/MWh */}
            <YAxis
              yAxisId="price"
              orientation="left"
              stroke={COLORS.price}
              fontSize={10}
              domain={[
                Math.floor(Math.min(0, priceMin) / 50) * 50,
                Math.ceil(priceMax / 50) * 50 || 50,
              ]}
              tickFormatter={(v: number) => `€${v}`}
              width={48}
            />
            {/* Right axis — kW */}
            <YAxis
              yAxisId="kw"
              orientation="right"
              stroke={COLORS.opt}
              fontSize={10}
              domain={[0, kwMax]}
              tickFormatter={(v: number) => `${v}`}
              width={36}
            />
            <ReferenceLine
              yAxisId="price"
              y={0}
              stroke={COLORS.axis}
              strokeWidth={1}
            />
            <Tooltip
              cursor={{ stroke: "hsl(0 0% 50%)", strokeDasharray: "3 3" }}
              labelFormatter={(_, payload) => {
                const ts = payload?.[0]?.payload?.ts
                return ts
                  ? new Date(ts).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })
                  : ""
              }}
              formatter={(value: number, name: string) => {
                if (name === "DAM €/MWh") return [`€${value.toFixed(1)}`, name]
                return [`${value.toFixed(1)} kW`, name]
              }}
              contentStyle={{
                background: "hsl(0 0% 100%)",
                border: "1px solid hsl(0 0% 85%)",
                borderRadius: 6,
                fontSize: 11,
              }}
            />
            {/* DAM price — stepped (auction prices hold for the hour) */}
            <Line
              yAxisId="price"
              type="stepAfter"
              dataKey="damEurMwh"
              name="DAM €/MWh"
              stroke={COLORS.price}
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
            />
            {/* Optimizer (Manual) grid import — solid */}
            <Line
              yAxisId="kw"
              type="monotone"
              dataKey="optGridKw"
              name="Optimizer kW"
              stroke={COLORS.opt}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {/* BMS-as-is grid import — dashed for visual separation */}
            <Line
              yAxisId="kw"
              type="monotone"
              dataKey="bmsGridKw"
              name="BMS Real kW"
              stroke={COLORS.bms}
              strokeWidth={1.75}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
            <Legend wrapperStyle={{ display: "none" }} />
          </ComposedChart>
        </ResponsiveContainer>
        {/* SESSION STRIP — horizontal bars marking when each charger had
            an EV plugged in. Mirrors the simulation player's session
            overlay so the user can read "this spike happened while C1
            was active" without cross-referencing another panel.

            Alignment math: Recharts is configured with
              margin.left = 0, YAxis(price) width = 48
              margin.right = 12, YAxis(kw) width = 36
            so the plot area sits at left = 48 px, right = 48 px from
            the container edges. We pad the strip's positioning track
            with the same insets so segment start/end pixels match the
            x-axis ticks above. */}
        <SessionStrip
          frames={bmsFrames}
          optimizedFrames={optimizedFrames}
          totalHours={totalHours}
          periodStartTs={periodStartTs}
          paddingLeft={48}
          paddingRight={48}
        />
        {/* Per-battery SOC trajectory under the session strip — gives
            an immediate read on how each pack (B1, B2) was driven by
            the BMS vs by the optimizer over the same window the price
            chart above is showing. We render this inside the same
            wrapper (rather than as a sibling card) so the x-axis
            scale, padding, and session strip all line up vertically
            without further math. Padding matches the price chart's
            48 px gutters so 06:00 lines up with 06:00 across all
            three layers. */}
        <BatterySocSubChart
          bmsFrames={bmsFrames}
          optimizerFrames={optimizedFrames}
          totalHours={totalHours}
          periodStartTs={periodStartTs}
        />
      </div>
    </div>
  )
}

/**
 * Per-charger session segments, derived directly from BMS telemetry.
 * Each `(start, end)` is expressed in hours since chart t0, matching
 * the chart's `hour` x-axis exactly. We additionally precompute a
 * rich metrics bundle per segment so the hover tooltip can render
 * source-of-charge breakdown / fulfilment / power profile without a
 * second pass over the frames at hover time (the strip can have
 * dozens of segments and the user may be scrubbing).
 */
interface SessionMetrics {
  /** Wall-clock duration in minutes (lastMs − startMs). */
  durationMin: number
  /** Total energy delivered to the EV across the session, kWh.
   *  Derived as Σ P_EV_w · Δt over the session's frames. */
  energyKwh: number
  /** Theoretical max delivery if the connector ran at its
   *  `P_EV_max_w` ceiling for the same duration, kWh. We use this
   *  as the denominator for "demand fulfilment" — i.e. did the
   *  optimiser/BMS keep the EV at its pull rate, or curtail it. */
  requestedKwh: number
  /** Delivered ÷ requested ceiling, in %. Capped at 100 — values
   *  above 100 only happen due to numerical drift in the integral
   *  and would mislead the eye. */
  fulfilmentPct: number
  /** Peak instantaneous EV power, kW. */
  peakKw: number
  /** Time-weighted mean EV power, kW. */
  avgKw: number
  /** Energy attributable to GRID-IMPORT during the session, kWh,
   *  derived from the BMS frames — i.e. what the *Auto Mode*
   *  on-site controller actually did. Per-frame attribution is
   *  proportional: when both BESS and grid feed the EV at the same
   *  instant, each gets credit for its share of total source power. */
  gridSourcedKwh: number
  /** Energy attributable to BESS DISCHARGE during the session, kWh,
   *  in Auto Mode (BMS truth). */
  bessSourcedKwh: number
  /** Same proportional split, but computed against the optimizer's
   *  counterfactual frames — i.e. what the merit-order *Optimized
   *  (Manual)* planner would have routed during this exact session
   *  window. Lets the tooltip put Auto-vs-Optimized side-by-side so
   *  the user can read at a glance how much the planner shifted
   *  toward BESS (cheap-slot) sourcing vs grid-direct draw. May be
   *  zero if no optimizer frames overlap the session. */
  optGridSourcedKwh: number
  /** Optimized-mode BESS-discharge energy attribution, kWh. */
  optBessSourcedKwh: number
  /** EV-side SOC at the start of the session, %. May be 0 if BMS
   *  hadn't yet read the EV's BMS over CCS handshake. */
  startSocEvPct: number
  /** EV-side SOC at the end of the session, %. Together with start
   *  this gives the user "EV pack went 18 → 64 %" at a glance. */
  endSocEvPct: number
}

interface SessionSegment {
  chargerId: string
  startHour: number
  endHour: number
  /** ISO timestamp of session start, used by the tooltip header. */
  startTs: string
  /** ISO timestamp of session end. */
  endTs: string
  metrics: SessionMetrics
}

/**
 * Build session segments by walking the BMS frames in order and
 * collapsing consecutive `InProgress` frames into a single (start, end)
 * pair per charger. We allow up to 5 minutes of dropout inside a
 * session before we split it — matches the heuristic the simulation
 * player uses, so the strips render identically.
 *
 * In the same single pass we accumulate the per-segment metrics
 * (energy, source-of-charge breakdown, fulfilment, peaks, …) so we
 * never need a second sweep at hover time.
 */
function buildSessionSegments(
  frames: TelemetryFrame[],
  optimizedFrames: OptimizedFrameLite[],
  t0Ms: number,
): SessionSegment[] {
  if (frames.length === 0) return []
  const SESSION_GAP_MS = 5 * 60_000

  // ── Optimizer-frame lookup table ──────────────────────────────
  // The optimizer produces one frame per dispatch step (typically
  // 5 min). To attribute the optimizer's source mix to BMS-frame
  // cadence (which can be denser, e.g. every minute), we index the
  // optimized frames by ISO timestamp and pick the most-recent
  // optimizer frame at-or-before each BMS tick.
  //
  // We additionally pre-compute the optimizer's *BESS discharge*
  // power per frame, which the optimizer doesn't emit directly:
  //   bessDisch_kW ≈ (ΣSOC_now − ΣSOC_prev) negative half × CAP_kWh
  // The fall-back is "0" — when SOC actually rose between frames
  // the BESS was charging, not discharging, and contributes 0 to
  // the source mix for the EV.
  const BATT_KWH_PER_PACK = 280 // matches optimizer's BATT_CAPACITY_KWH
  interface OptFrameDerived {
    tsMs: number
    /** Grid IMPORT kW at this optimizer frame (always ≥ 0). */
    gridImportKw: number
    /** Inferred BESS DISCHARGE kW at this optimizer frame
     *  (always ≥ 0; 0 when packs were charging or idle). */
    bessDischargeKw: number
  }
  const optDerived: OptFrameDerived[] = []
  for (let i = 0; i < optimizedFrames.length; i++) {
    const f = optimizedFrames[i]
    // Optimizer API convention: gridKw is signed with negative =
    // import. Flip sign and clamp to [0, ∞) for the source-mix.
    const gridImportKw = Math.max(0, -f.gridKw)
    let bessDischargeKw = 0
    if (i > 0) {
      const prev = optimizedFrames[i - 1]
      const prevTotal = (prev.b1SocPct ?? 0) + (prev.b2SocPct ?? 0)
      const currTotal = (f.b1SocPct ?? 0) + (f.b2SocPct ?? 0)
      const dtH = Math.max(
        (new Date(f.ts).getTime() - new Date(prev.ts).getTime()) /
          3_600_000,
        1e-6,
      )
      // ΔSOC% × cap kWh / 100 = ΔkWh per pack. Sum across both
      // packs and divide by Δt to get average discharge kW over
      // the interval. SOC dropping → packs supplied energy.
      const dSocPp = prevTotal - currTotal
      if (dSocPp > 0) {
        const dKwh = (dSocPp / 100) * BATT_KWH_PER_PACK
        bessDischargeKw = dKwh / dtH
      }
    }
    optDerived.push({
      tsMs: new Date(f.ts).getTime(),
      gridImportKw,
      bessDischargeKw,
    })
  }
  /** Binary search for the latest optimizer frame with tsMs ≤ targetMs.
   *  Returns null if no such frame exists (i.e. BMS frame predates
   *  the entire optimizer run). */
  const findOptFrameAt = (targetMs: number): OptFrameDerived | null => {
    if (optDerived.length === 0) return null
    let lo = 0
    let hi = optDerived.length - 1
    if (optDerived[0].tsMs > targetMs) return null
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (optDerived[mid].tsMs <= targetMs) lo = mid
      else hi = mid - 1
    }
    return optDerived[lo]
  }

  // Per-charger running state. We track:
  //   start/lastMs       — segment time bounds
  //   startSocEv         — EV SOC reading at first frame
  //   lastSocEv          — most recent EV SOC reading
  //   prevTickMs         — last frame ts we accumulated against, for Δt
  //   eKwh / eReqKwh     — running integrals
  //   eGridKwh/eBessKwh  — proportional source-attribution integrals
  //                        against BMS-truth source mix (Auto Mode)
  //   eOptGridKwh/eOptBessKwh — same integrals but against the
  //                        optimizer counterfactual (Optimized Mode)
  //   peakKw / pAvgNum   — peak + numerator for time-weighted avg
  interface OpenState {
    startMs: number
    lastMs: number
    prevTickMs: number
    startSocEv: number
    lastSocEv: number
    eKwh: number
    eReqKwh: number
    eGridKwh: number
    eBessKwh: number
    eOptGridKwh: number
    eOptBessKwh: number
    peakKw: number
    pAvgNum: number // Σ P_kw · Δt_h
  }
  const open = new Map<string, OpenState>()
  const out: SessionSegment[] = []

  const newOpenState = (tsMs: number, evSoc: number, evKw: number): OpenState => ({
    startMs: tsMs,
    lastMs: tsMs,
    prevTickMs: tsMs,
    startSocEv: evSoc,
    lastSocEv: evSoc,
    eKwh: 0,
    eReqKwh: 0,
    eGridKwh: 0,
    eBessKwh: 0,
    eOptGridKwh: 0,
    eOptBessKwh: 0,
    peakKw: evKw,
    pAvgNum: 0,
  })

  const finalise = (chargerId: string, st: OpenState): SessionSegment => {
    const durationH = Math.max((st.lastMs - st.startMs) / 3_600_000, 1e-6)
    const avgKw = st.pAvgNum / durationH
    const fulfilmentPct = st.eReqKwh > 0
      ? Math.min(100, (st.eKwh / st.eReqKwh) * 100)
      : 100
    return {
      chargerId,
      startHour: (st.startMs - t0Ms) / 3_600_000,
      endHour: (st.lastMs - t0Ms) / 3_600_000,
      startTs: new Date(st.startMs).toISOString(),
      endTs: new Date(st.lastMs).toISOString(),
      metrics: {
        durationMin: (st.lastMs - st.startMs) / 60_000,
        energyKwh: st.eKwh,
        requestedKwh: st.eReqKwh,
        fulfilmentPct,
        peakKw: st.peakKw,
        avgKw,
        gridSourcedKwh: st.eGridKwh,
        bessSourcedKwh: st.eBessKwh,
        optGridSourcedKwh: st.eOptGridKwh,
        optBessSourcedKwh: st.eOptBessKwh,
        startSocEvPct: st.startSocEv,
        endSocEvPct: st.lastSocEv,
      },
    }
  }

  for (const f of frames) {
    const tsMs = new Date(f.ts).getTime()
    // Pre-compute frame-level grid + BESS source power once. We
    // re-use the same numbers for both chargers' attribution below.
    // Sign convention (matches the dashed BMS line in the top
    // panel): the BMS reports `P_grid_w` SIGNED with NEGATIVE =
    // IMPORT (energy flowing INTO the site from the grid) and
    // positive = export. Earlier this code clamped the raw value
    // with `max(0, P_grid_w)`, which silently flipped the
    // semantics: every grid-import moment registered as zero grid
    // and got 100 % credited to BESS, while only the rare export
    // moments got grid credit. The visible bug was a session
    // tooltip showing "Auto Mode 3 % grid / 97 % BESS" while the
    // dashed import line on the chart was clearly elevated through
    // most of the same session window. We negate first, then
    // clamp, exactly mirroring the chart's own BMS-line derivation
    // earlier in this file (`Math.max(0, -(P_grid_w / 1000))`).
    const gridImportKw = Math.max(0, -f.grid.P_grid_w / 1000)
    const bessDischargeKw = f.batteries.reduce(
      (acc, b) => acc + Math.max(0, -b.power_w / 1000),
      0,
    )
    const totalSourceKw = gridImportKw + bessDischargeKw

    // Optimizer counterfactual source mix at this same wall-clock
    // moment. May be null if the BMS frame predates the optimizer
    // window — in that case we fall back to BMS-truth attribution
    // for both bars (no counterfactual available).
    const optAt = findOptFrameAt(tsMs)
    const optGridKw = optAt ? optAt.gridImportKw : gridImportKw
    const optBessKw = optAt ? optAt.bessDischargeKw : bessDischargeKw
    const optTotalKw = optGridKw + optBessKw

    for (const c of f.chargers) {
      const chargerLabel = `C${c.unit_id}`
      if (c.charging_state !== "InProgress") continue

      const evKw = Math.max(0, c.P_EV_w / 1000)
      const evMaxKw = Math.max(0, c.P_EV_max_w / 1000)
      const evSoc = c.soc_EV_pct
      const prev = open.get(chargerLabel)

      if (!prev) {
        open.set(chargerLabel, newOpenState(tsMs, evSoc, evKw))
        continue
      }

      if (tsMs - prev.lastMs > SESSION_GAP_MS) {
        out.push(finalise(chargerLabel, prev))
        open.set(chargerLabel, newOpenState(tsMs, evSoc, evKw))
        continue
      }

      const dtH = (tsMs - prev.prevTickMs) / 3_600_000
      if (dtH > 0) {
        prev.eKwh += evKw * dtH
        prev.eReqKwh += evMaxKw * dtH
        prev.pAvgNum += evKw * dtH
        // Auto-mode (BMS-truth) attribution.
        if (totalSourceKw > 0.01 && evKw > 0) {
          const gridShare = gridImportKw / totalSourceKw
          prev.eGridKwh += evKw * dtH * gridShare
          prev.eBessKwh += evKw * dtH * (1 - gridShare)
        } else if (evKw > 0) {
          prev.eGridKwh += evKw * dtH
        }
        // Optimized-mode (counterfactual) attribution. Same EV
        // demand (evKw is the physical pull, mode-independent),
        // split against the optimizer's source mix instead of the
        // BMS-truth mix. When the optimizer says "0 grid, all
        // BESS" at a moment the BMS actually pulled from grid,
        // this is what reveals the routing delta.
        if (optTotalKw > 0.01 && evKw > 0) {
          const gridShare = optGridKw / optTotalKw
          prev.eOptGridKwh += evKw * dtH * gridShare
          prev.eOptBessKwh += evKw * dtH * (1 - gridShare)
        } else if (evKw > 0) {
          prev.eOptGridKwh += evKw * dtH
        }
      }
      if (evKw > prev.peakKw) prev.peakKw = evKw
      prev.lastMs = tsMs
      prev.prevTickMs = tsMs
      prev.lastSocEv = evSoc
    }
  }

  // Flush any still-open segments at end-of-history.
  for (const [chargerId, st] of open) out.push(finalise(chargerId, st))
  return out
}

/**
 * Color per charger. Matches the simulation player's palette so the
 * "C1 = emerald, C2 = violet" mental model is consistent across both
 * surfaces. Falls back to slate for any unmapped charger id, which
 * keeps the strip readable on multi-charger sites we haven't styled
 * explicitly yet.
 */
const SESSION_COLORS: Record<string, { bar: string; text: string; dot: string }> = {
  C1: { bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-500", dot: "bg-emerald-500" },
  C2: { bar: "bg-violet-500", text: "text-violet-600 dark:text-violet-500", dot: "bg-violet-500" },
}
const FALLBACK_COLOR = { bar: "bg-slate-500", text: "text-slate-600", dot: "bg-slate-500" }

/**
 * Pixel-aligned session strip rendered *below* the chart, in absolute
 * coords scaled to `totalHours`. We deliberately don't use Recharts
 * here because:
 *   - Recharts ReferenceArea would compete with the price/kw y-axes
 *     and force a third axis that has no semantic meaning.
 *   - A plain DOM track gives us crisp 6 px tall bars (matching the
 *     player) without Recharts' min-height clamps.
 *   - It keeps the chart's tooltip/legend logic clean: a session
 *     overlay shouldn't show up in the price tooltip.
 */
function SessionStrip({
  frames,
  optimizedFrames,
  totalHours,
  periodStartTs,
  paddingLeft,
  paddingRight,
}: {
  frames: TelemetryFrame[]
  /** Optimizer counterfactual frames, co-iterated by timestamp with
   *  `frames`. Used by the session-tooltip to compute a *second*
   *  source-of-charge breakdown reflecting what the merit-order
   *  planner would have done in this same window. */
  optimizedFrames: OptimizedFrameLite[]
  totalHours: number
  /** Operating-day start (ms). Must match the price chart's x=0 anchor so
   *  session segments line up with the price/grid lines above. */
  periodStartTs?: number
  paddingLeft: number
  paddingRight: number
}) {
  if (frames.length === 0 || totalHours <= 0) return null
  const t0Ms = periodStartTs ?? new Date(frames[0].ts).getTime()
  const segments = buildSessionSegments(frames, optimizedFrames, t0Ms)
  if (segments.length === 0) return null

  // Group segments by charger so each charger gets its own row.
  // Sorted alphabetically (C1 → C2 → ...) for stable visual order
  // regardless of the order chargers appear in the telemetry.
  const byCharger = new Map<string, SessionSegment[]>()
  for (const s of segments) {
    const arr = byCharger.get(s.chargerId) ?? []
    arr.push(s)
    byCharger.set(s.chargerId, arr)
  }
  const chargerRows = Array.from(byCharger.entries()).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1 leading-none">
        <span>Charging sessions</span>
        <span className="flex items-center gap-3">
          {chargerRows.map(([chargerId]) => {
            const c = SESSION_COLORS[chargerId] ?? FALLBACK_COLOR
            return (
              <span key={chargerId} className="flex items-center gap-1">
                <span aria-hidden className={cn("inline-block size-2 rounded-full", c.dot)} />
                <span className={c.text}>{chargerId}</span>
              </span>
            )
          })}
        </span>
      </div>
      <div
        className="relative"
        style={{ paddingLeft, paddingRight }}
      >
        {/* Stacked rows — one per charger. Height stays compact (8 px
            per row + 2 px gap) so the strip never dominates the price
            chart visually but is still tappable on touch devices. */}
        <div className="relative flex flex-col gap-[2px]">
          {chargerRows.map(([chargerId, segs]) => {
            const c = SESSION_COLORS[chargerId] ?? FALLBACK_COLOR
            return (
              <div
                key={chargerId}
                className="relative h-[8px] rounded-sm bg-muted/40"
              >
                {segs.map((s, i) => {
                  const leftPct = Math.max(0, Math.min(100, (s.startHour / totalHours) * 100))
                  const widthPct = Math.max(
                    0.15, // ensures very short sessions stay visible (≥ 1px @ 700 px wide)
                    Math.min(100 - leftPct, ((s.endHour - s.startHour) / totalHours) * 100),
                  )
                  return (
                    <HoverCard key={`${chargerId}-${i}`} openDelay={120} closeDelay={80}>
                      <HoverCardTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${chargerId} session ${formatSegmentRange(s)}`}
                          className={cn(
                            "absolute top-0 h-full rounded-sm cursor-pointer outline-none",
                            "ring-offset-background transition-[transform,filter]",
                            "hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                            c.bar,
                          )}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        />
                      </HoverCardTrigger>
                      <HoverCardContent
                        side="top"
                        align="start"
                        className="w-[22rem] p-0 overflow-hidden"
                      >
                        <SessionTooltipBody
                          chargerId={chargerId}
                          segment={s}
                          accentDot={c.dot}
                          accentText={c.text}
                        />
                      </HoverCardContent>
                    </HoverCard>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function formatSegmentRange(s: SessionSegment): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  return `${fmt(s.startTs)} → ${fmt(s.endTs)}`
}

/**
 * Rich tooltip body for a single charging session.
 *
 * Layout philosophy:
 *   ┌──────────────────────────────────────────────┐
 *   │ HEADER     charger pill + time range         ���
 *   ├──────────────────────────────────────────────┤
 *   │ KEY METRICS GRID                             │
 *   │   2 × 2 of (Energy / Duration / Peak / Avg)  │
 *   ├──────────────────────────────────────────────┤
 *   │ DEMAND FULFILMENT BAR                        │
 *   │   delivered ÷ requested ceiling, with %      │
 *   ├──────────────────────────────────────────────┤
 *   │ SOURCE OF CHARGE BAR                         │
 *   │   Grid (BMS-direct) vs BESS (Optimised) split│
 *   ├───────────��──────────────────────────────────┤
 *   │ EV SOC FOOTNOTE   start → end %              │
 *   └──────────────────────────────────────────────┘
 *
 * Each row is purposely independent so the eye can scan top-to-bottom
 * and drop out as soon as the answer is found. Numbers are
 * monospaced-aligned to the right and labels left-aligned, which is
 * the convention every other tooltip in the prototype already uses.
 */
function SessionTooltipBody({
  chargerId,
  segment,
  accentDot,
  accentText,
}: {
  chargerId: string
  segment: SessionSegment
  accentDot: string
  accentText: string
}) {
  const m = segment.metrics
  // Auto-mode (BMS truth): what the on-site controller actually
  // delivered, attributed proportionally to grid vs BESS at every
  // tick.
  const autoTotal = m.gridSourcedKwh + m.bessSourcedKwh
  const autoGridPct = autoTotal > 0 ? (m.gridSourcedKwh / autoTotal) * 100 : 0
  const autoBessPct = autoTotal > 0 ? (m.bessSourcedKwh / autoTotal) * 100 : 0
  // Optimized (Manual) counterfactual: what the merit-order planner
  // would have routed during the same window, against the same EV
  // pull. Same denominator semantics so the two bars can be read
  // side-by-side without a unit-conversion in the user's head.
  const optTotal = m.optGridSourcedKwh + m.optBessSourcedKwh
  const optGridPct = optTotal > 0 ? (m.optGridSourcedKwh / optTotal) * 100 : 0
  const optBessPct = optTotal > 0 ? (m.optBessSourcedKwh / optTotal) * 100 : 0
  // BESS-share delta: positive means the optimizer would have
  // sourced MORE from BESS (i.e. shifted off the grid into cheap-
  // slot energy). Used as the headline number on the comparison
  // row because that's the routing benefit of the planner.
  const bessShareDeltaPp = optBessPct - autoBessPct
  const fulfilment = Math.max(0, Math.min(100, m.fulfilmentPct))
  // Visual badge for fulfilment quality. Above 95 % is green
  // ("nominal"), 75–95 % is amber ("mild curtail"), below 75 % is
  // red ("significant curtail"). These thresholds match what the
  // exception-handling screen already uses for charger health.
  const fulfilTone =
    fulfilment >= 95
      ? "text-emerald-600 dark:text-emerald-500"
      : fulfilment >= 75
        ? "text-amber-600 dark:text-amber-500"
        : "text-rose-600 dark:text-rose-500"
  const fulfilBar =
    fulfilment >= 95
      ? "bg-emerald-500"
      : fulfilment >= 75
        ? "bg-amber-500"
        : "bg-rose-500"
  const socDelta = m.endSocEvPct - m.startSocEvPct

  return (
    <div className="text-xs">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-muted/40">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-semibold">
            <span aria-hidden className={cn("inline-block size-2 rounded-full", accentDot)} />
            <Plug className="size-3.5 text-muted-foreground" />
            <span className={accentText}>{chargerId}</span>
            <span className="text-muted-foreground font-normal">charging session</span>
          </span>
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground font-mono">
          {formatSegmentRange(segment)}
        </div>
      </div>

      {/* Key metrics — 2 × 2 grid */}
      <div className="grid grid-cols-2 gap-px bg-border">
        <MetricCell
          icon={<Bolt className="size-3.5" />}
          label="Delivered"
          value={`${m.energyKwh.toFixed(1)} kWh`}
        />
        <MetricCell
          icon={<Clock className="size-3.5" />}
          label="Duration"
          value={formatDuration(m.durationMin)}
        />
        <MetricCell
          icon={<Zap className="size-3.5" />}
          label="Peak power"
          value={`${m.peakKw.toFixed(1)} kW`}
        />
        <MetricCell
          icon={<Gauge className="size-3.5" />}
          label="Avg power"
          value={`${m.avgKw.toFixed(1)} kW`}
        />
      </div>

      {/* Demand fulfilment */}
      <div className="px-3 py-2 border-t border-border">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Target className="size-3.5" />
            Demand fulfilment
          </span>
          <span className={cn("font-mono font-semibold tabular-nums", fulfilTone)}>
            {fulfilment.toFixed(0)}%
          </span>
        </div>
        <div
          className="h-1.5 rounded-full bg-muted overflow-hidden"
          role="progressbar"
          aria-valuenow={Math.round(fulfilment)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Demand fulfilment"
        >
          <div
            className={cn("h-full rounded-full", fulfilBar)}
            style={{ width: `${fulfilment}%` }}
          />
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground font-mono leading-tight">
          {m.energyKwh.toFixed(1)} delivered / {m.requestedKwh.toFixed(1)} requested kWh
        </div>
      </div>

      {/* Source-of-charge comparison: Auto (BMS truth) vs Optimized
          (planner counterfactual). Two compact stacked bars stacked
          vertically inside the same section so the eye can compare
          the BESS shares at a glance — they share the exact same
          x-scale (0–100 %) and the exact same colour mapping (slate
          = grid, sky = BESS). The headline delta line at the top
          of the section calls out how many percentage points of EV
          demand the optimizer would have shifted from grid to
          BESS, which is the routing benefit. */}
      <div className="px-3 py-2 border-t border-border">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Battery className="size-3.5" />
            Source of charge
          </span>
          {autoTotal > 0 && optTotal > 0 && Math.abs(bessShareDeltaPp) >= 1 && (
            <span
              className={cn(
                "text-[10px] font-mono tabular-nums px-1.5 py-px rounded-sm border",
                bessShareDeltaPp > 0
                  ? "text-sky-700 border-sky-200 bg-sky-50 dark:text-sky-400 dark:bg-sky-950 dark:border-sky-900"
                  : "text-slate-700 border-slate-200 bg-slate-50 dark:text-slate-400 dark:bg-slate-900 dark:border-slate-800",
              )}
              title="Optimizer's BESS share minus Auto Mode's BESS share"
            >
              {bessShareDeltaPp > 0 ? "+" : ""}
              {bessShareDeltaPp.toFixed(0)} pp BESS
            </span>
          )}
        </div>
        <SourceSplitRow
          label="Auto Mode"
          sublabel="BMS truth"
          gridKwh={m.gridSourcedKwh}
          bessKwh={m.bessSourcedKwh}
          gridPct={autoGridPct}
          bessPct={autoBessPct}
        />
        <div className="h-1.5" />
        <SourceSplitRow
          label="Optimized"
          sublabel="Manual / planner"
          gridKwh={m.optGridSourcedKwh}
          bessKwh={m.optBessSourcedKwh}
          gridPct={optGridPct}
          bessPct={optBessPct}
        />
        {/* Shared legend — one line, dedup'd across the two bars
            since the colour semantics are identical. */}
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-sm bg-slate-500" />
            Grid import
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-sm bg-sky-500" />
            BESS discharge
          </span>
        </div>
      </div>

      {/* EV SOC footnote */}
      {(m.startSocEvPct > 0 || m.endSocEvPct > 0) && (
        <div className="px-3 py-1.5 border-t border-border bg-muted/30 text-[10px] text-muted-foreground font-mono leading-tight flex items-center justify-between">
          <span>EV pack SOC</span>
          <span className="tabular-nums">
            {m.startSocEvPct.toFixed(0)}% → {m.endSocEvPct.toFixed(0)}%
            {socDelta !== 0 && (
              <span className={socDelta > 0 ? "text-emerald-600 ml-1" : "text-rose-600 ml-1"}>
                ({socDelta > 0 ? "+" : ""}
                {socDelta.toFixed(0)} pp)
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * One stacked-bar row in the source-of-charge comparison block.
 * Two of these are stacked vertically inside the tooltip — one for
 * Auto Mode (BMS truth) and one for Optimized Mode (planner
 * counterfactual). They share the same fixed-width label column
 * (68 px) so the bar starts at the same x-pixel in both rows; that
 * alignment is what lets the eye compare BESS shares visually
 * without doing arithmetic. Bars also share the slate / sky colour
 * mapping (grid / BESS) so a single legend serves both rows.
 *
 * Empty-data fallback: if both kWh are 0 (e.g. optimizer frames
 * don't cover this session window) we render a muted "no data" hint
 * instead of an empty bar, so the row never collapses to a
 * confusing sliver.
 */
function SourceSplitRow({
  label,
  sublabel,
  gridKwh,
  bessKwh,
  gridPct,
  bessPct,
}: {
  label: string
  sublabel: string
  gridKwh: number
  bessKwh: number
  gridPct: number
  bessPct: number
}) {
  const total = gridKwh + bessKwh
  return (
    <div className="grid grid-cols-[68px_1fr] gap-2 items-center">
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-[11px] font-semibold text-foreground truncate">
          {label}
        </span>
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground truncate">
          {sublabel}
        </span>
      </div>
      <div className="min-w-0">
        {total > 0.01 ? (
          <>
            <div
              className="h-2 rounded-full bg-muted overflow-hidden flex"
              role="img"
              aria-label={`${label}: grid ${gridPct.toFixed(0)} percent, BESS ${bessPct.toFixed(0)} percent`}
            >
              {gridPct > 0 && (
                <div
                  className="h-full bg-slate-500"
                  style={{ width: `${Math.max(gridPct, 1)}%` }}
                />
              )}
              {bessPct > 0 && (
                <div
                  className="h-full bg-sky-500"
                  style={{ width: `${Math.max(bessPct, 1)}%` }}
                />
              )}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums leading-tight">
              <span className="text-slate-700 dark:text-slate-300">
                {gridKwh.toFixed(1)} kWh
                <span className="text-muted-foreground">
                  {" "}
                  ({gridPct.toFixed(0)}%)
                </span>
              </span>
              <span className="text-sky-700 dark:text-sky-400">
                {bessKwh.toFixed(1)} kWh
                <span className="text-muted-foreground">
                  {" "}
                  ({bessPct.toFixed(0)}%)
                </span>
              </span>
            </div>
          </>
        ) : (
          <div className="h-2 rounded-full bg-muted/60 flex items-center justify-center">
            <span className="text-[9px] text-muted-foreground italic">
              no data in window
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Single key/value cell inside the 2 × 2 metrics grid in the
 *  session tooltip. Pulled out into its own component so the four
 *  cells render with identical padding/typography without copy-paste. */
function MetricCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="bg-popover px-3 py-2 flex flex-col gap-0.5 min-w-0">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-mono font-semibold tabular-nums text-sm truncate">
        {value}
      </span>
    </div>
  )
}

/** Format a duration in minutes into "Xh Ym" / "Xm" / "Xs". */
function formatDuration(mins: number): string {
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`
  if (mins < 60) return `${Math.round(mins)}m`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins - h * 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/**
 * Per-pack SOC sub-chart, BMS Real vs Optimizer (Manual). Four lines:
 *   B1 / B2 from `bmsFrames`     → solid (BMS truth)
 *   B1 / B2 from `optimizerFrames` → dashed (Manual-mode counterfactual)
 *
 * Sharing one chart instead of two side-by-side panels keeps the
 * comparison tight: at any x the user sees how the four packs differ
 * within the same minute. We use the absolute-hour x-axis convention
 * the price chart uses so the SessionStrip above and this chart line
 * up automatically — no axis math needed downstream.
 */
function BatterySocSubChart({
  bmsFrames,
  optimizerFrames,
  totalHours,
  periodStartTs,
}: {
  bmsFrames: TelemetryFrame[]
  optimizerFrames: OptimizedFrameLite[]
  totalHours: number
  /** Operating-day start (ms). Must match the price chart's x=0 anchor so
   *  the SOC lines line up with the price/grid lines above. */
  periodStartTs?: number
}) {
  const data = useMemo(() => {
    if (bmsFrames.length === 0) return []
    const t0Ms = periodStartTs ?? new Date(bmsFrames[0].ts).getTime()
    // Index optimizer frames by ts so we can left-join to BMS without
    // assuming identical lengths (in practice they're aligned, but a
    // missing tail or a dropped frame should not blank the whole
    // optimizer line).
    const optByTs = new Map<string, OptimizedFrameLite>()
    for (const f of optimizerFrames) optByTs.set(f.ts, f)
    return bmsFrames.map((b) => {
      const o = optByTs.get(b.ts)
      const bmsB1 = b.batteries.find((bt) => bt.unit_id === 1)?.soc_pct ?? null
      const bmsB2 = b.batteries.find((bt) => bt.unit_id === 2)?.soc_pct ?? null
      const optB1 = o?.b1SocPct ?? null
      const optB2 = o?.b2SocPct ?? null
      return {
        hour: (new Date(b.ts).getTime() - t0Ms) / 3_600_000,
        bmsB1,
        bmsB2,
        optB1,
        optB2,
      }
    })
  }, [bmsFrames, optimizerFrames, periodStartTs])

  if (data.length === 0) return null

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1 leading-none">
        <span>Battery SOC — BMS vs Optimizer</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span aria-hidden className="inline-block w-3 h-[2px] bg-sky-500" />
            <span className="text-sky-600 dark:text-sky-500">BMS B1</span>
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="inline-block w-3 h-[2px] bg-indigo-500" />
            <span className="text-indigo-600 dark:text-indigo-500">BMS B2</span>
          </span>
          <span className="flex items-center gap-1">
            {/* Dashed swatch: render two stacked 1-px dashes via background-image so
                the swatch reads as "dashed line" without an SVG dependency. */}
            <span
              aria-hidden
              className="inline-block w-3 h-[2px]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to right, currentColor 0 3px, transparent 3px 6px)",
                color: "rgb(16 185 129)",
              }}
            />
            <span className="text-emerald-600 dark:text-emerald-500">Opt B1</span>
          </span>
          <span className="flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block w-3 h-[2px]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to right, currentColor 0 3px, transparent 3px 6px)",
                color: "rgb(124 58 237)",
              }}
            />
            <span className="text-violet-600 dark:text-violet-500">Opt B2</span>
          </span>
        </span>
      </div>
      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, totalHours]}
              tick={{ fontSize: 10, fill: "currentColor" }}
              className="text-muted-foreground"
              tickLine={false}
              axisLine={false}
              hide
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: 10, fill: "currentColor" }}
              className="text-muted-foreground"
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                fontSize: 11,
                backgroundColor: "hsl(var(--popover))",
                borderColor: "hsl(var(--border))",
                borderRadius: 6,
              }}
              labelFormatter={(h) => `t = ${(h as number).toFixed(2)} h`}
              formatter={(v: number, name: string) => [
                v != null ? `${v.toFixed(1)}%` : "—",
                name,
              ]}
            />
            <Line
              type="monotone"
              dataKey="bmsB1"
              name="BMS B1"
              stroke="rgb(14 165 233)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="bmsB2"
              name="BMS B2"
              stroke="rgb(99 102 241)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="optB1"
              name="Opt B1"
              stroke="rgb(16 185 129)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="optB2"
              name="Opt B2"
              stroke="rgb(124 58 237)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
