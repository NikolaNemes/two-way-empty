"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, X } from "lucide-react"

/**
 * Per-day savings breakdown for multi-day historical simulations.
 *
 * Sign convention:
 *   upliftEur = baselineCostEur - optCostEur
 *   When optimizer costs LESS than baseline, upliftEur is POSITIVE.
 *   Positive upliftEur = savings = good = green bar going UP.
 */
export type DailyUpliftEntry = {
  dateKey: string // YYYY-MM-DD, Berlin local
  baselineCostEur: number
  optCostEur: number
  baselineImportKwh: number
  optImportKwh: number
  upliftEur: number // baselineCost - optCost (positive = savings)
  /**
   * Number of EV charging sessions that STARTED on this op-day.
   * Counted at every prev→curr "InProgress" transition per
   * charger, matching the historical-stats widget. 0 on quiet days.
   */
  sessionCount: number
  /**
   * Time-weighted average DAM (EPEX day-ahead) price for the op-day,
   * in €/MWh. Used by the spread sub-chart.
   */
  damAvgEurMwh: number
  /**
   * Time-weighted average IDM (intraday) price for the op-day, in
   * €/MWh. The spread = idm − dam visualises how much the IDM
   * deviates from the day-ahead — positive = IDM premium, negative
   * = IDM discount (which is exactly when re-timing imports into
   * IDM-cheap slots wins).
   */
  idmAvgEurMwh: number
}

interface DailyUpliftChartProps {
  data: DailyUpliftEntry[]
  /**
   * Optional SOC start/end for both modes. When supplied, the chart shows a
   * one-line conservation-law reconciliation:
   *
   *   Imports_opt − Imports_baseline = (SOC_baseline_delta − SOC_opt_delta)
   *
   * i.e. with identical EV sessions and aux load, the only legitimate reason
   * imports differ between modes is the battery-energy delta between start
   * and end of the period (the optimizer "stores" or "releases" energy
   * vs. baseline). This makes the kWh gap explainable instead of mysterious.
   */
  socBaseline?: { startPct: number; endPct: number; changeKwh: number; valueEur?: number }
  socOptimized?: { startPct: number; endPct: number; changeKwh: number; valueEur?: number }
}

const fmtEur = (v: number) => {
  const sign = v < 0 ? "-" : ""
  const abs = Math.abs(v)
  return `${sign}€${abs.toFixed(2)}`
}

const fmtDate = (dateKey: string) => {
  const d = new Date(dateKey + "T00:00:00")
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "short" })
}

const fmtWeekday = (dateKey: string) => {
  const d = new Date(dateKey + "T00:00:00")
  return d.toLocaleDateString("en-GB", { weekday: "short" })
}

/**
 * Operating-day window label, e.g. "13. → 14. Mai" for the slice that
 * runs 13 May 06:00 → 14 May 06:00 Berlin time. Used in the per-bar
 * details panel so the user sees the actual 24 h slice each bar
 * represents (not just the start date), mirroring the 06:00→06:00
 * convention used by the range picker, the replay control, and the
 * dispatch loop's `getDateKey`.
 */
const fmtOpDayWindow = (dateKey: string) => {
  const start = new Date(dateKey + "T00:00:00")
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  const sameMonth = start.getMonth() === end.getMonth()
  const startStr = start.toLocaleDateString("de-DE", {
    day: "numeric",
    ...(sameMonth ? {} : { month: "short" }),
  })
  const endStr = end.toLocaleDateString("de-DE", { day: "numeric", month: "short" })
  return `${startStr}. → ${endStr}, 06:00 → 06:00`
}

const fmtKwh = (v: number) => `${v.toFixed(1)} kWh`

export function DailyUpliftChart({ data, socBaseline, socOptimized }: DailyUpliftChartProps) {
  // Click-to-pin selection (replaces ephemeral hover tooltip).
  // null = no bar selected → details panel hidden.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  // ESC closes the details panel for keyboard users.
  useEffect(() => {
    if (selectedIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedIndex(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectedIndex])

  if (data.length === 0) return null

  const W = 760
  const H = 260
  const padL = 56
  const padR = 16
  const padT = 24
  const padB = 56
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  // Calculate totals for the entire period
  const totalBaselineImport = data.reduce((sum, d) => sum + d.baselineImportKwh, 0)
  const totalOptImport = data.reduce((sum, d) => sum + d.optImportKwh, 0)
  const importDifference = totalOptImport - totalBaselineImport
  const importDiffPercent = totalBaselineImport > 0 ? (importDifference / totalBaselineImport) * 100 : 0
  
  // Check if imports are reasonably balanced (within 10% is acceptable given battery cycling)
  const importsBalanced = Math.abs(importDiffPercent) <= 10

  // upliftEur > 0 means savings (green, up)
  // upliftEur < 0 means loss (amber, down)

  const totalUplift = data.reduce((s, d) => s + d.upliftEur, 0)
  const avgPerDay = totalUplift / data.length

  // SOC-adjusted total uplift (multi-day): the optimizer can end the
  // window at a different SOC than baseline, which means part of the
  // raw energy uplift is really just "energy parked in the pack" (or
  // "energy taken out of the pack") rather than realised cash savings.
  // Adding (optSocValue − baselineSocValue) to the raw uplift converts
  // it into the right comparable number — same idea as the SOC-adjusted
  // line in the procurement-cost panel, but here aggregated across the
  // full selected range so the user can read total realised value at
  // a glance instead of mentally summing per-day bars.
  const socDeltaEur =
    socOptimized?.valueEur != null && socBaseline?.valueEur != null
      ? socOptimized.valueEur - socBaseline.valueEur
      : null
  const socAdjustedUplift = socDeltaEur != null ? totalUplift + socDeltaEur : null
  const showSocAdjusted =
    socAdjustedUplift != null &&
    data.length >= 2 &&
    Math.abs(socDeltaEur ?? 0) > 0.05

  // Per-day SOC adjustment, amortised evenly across the selected
  // window. The raw `socDeltaEur` is a single window-level number
  // (the optimizer can end the horizon at a different SOC than the
  // baseline, which means part of the raw uplift is "energy parked
  // in the pack" not realised cash). We don't have a per-day SOC
  // valuation series, so amortising the total over `data.length`
  // days gives every bar the same correction term — visually this
  // is just a horizontal tick a constant distance above/below the
  // raw bar, which is exactly what the user wants to see at a
  // glance: "here's the green bar, here's where it would be after
  // the SOC-banking correction."
  //
  // ORDERING NOTE: this declaration MUST come BEFORE `maxPositive`/
  // `maxNegative` below, because those reference `perDayAdjEur` to
  // make the y-scale wide enough to fit the SOC-adjusted tick. The
  // previous version declared `perDayAdjEur` AFTER the y-scale,
  // producing a ReferenceError ("Cannot access 'perDayAdjEur' before
  // initialization") that only fired on multi-day reports — i.e.
  // exactly the path that mounts this chart. The single-day path
  // skips this component entirely (`dailyBreakdown.length > 1`),
  // which is why the bug masqueraded as a "two-day-only" crash.
  const perDayAdjEur =
    showSocAdjusted && data.length > 0 ? socDeltaEur! / data.length : 0

  // y-scale: max of raw uplift AND of SOC-adjusted uplift, so the
  // adjusted tick never escapes the chart frame on days where the
  // adjustment pushes the bar past its raw extreme.
  const maxPositive = Math.max(
    ...data.map((d) => Math.max(0, d.upliftEur, d.upliftEur + perDayAdjEur)),
    0.01,
  )
  const maxNegative = Math.max(
    ...data.map((d) => Math.max(0, -d.upliftEur, -(d.upliftEur + perDayAdjEur))),
    0.01,
  )

  // Use SYMMETRIC scale so visual height is proportional to actual value.
  // A €2.8 loss should look small compared to €68 gain (not fill half the chart).
  const maxAbsolute = Math.max(maxPositive, maxNegative)

  // Calculate proportional space allocation based on actual data range
  const positiveRatio = maxPositive / (maxPositive + maxNegative)
  const negativeRatio = maxNegative / (maxPositive + maxNegative)

  // Allocate vertical space proportionally (with min 10% for either side if present)
  const hasNegative = maxNegative > 0.01
  const hasPositive = maxPositive > 0.01
  const minRatio = 0.1
  const positiveH = hasNegative
    ? innerH * Math.max(minRatio, Math.min(0.9, positiveRatio))
    : innerH
  const negativeH = hasPositive
    ? innerH * Math.max(minRatio, Math.min(0.9, negativeRatio))
    : innerH
  const zeroY = padT + positiveH

  const slotW = innerW / data.length
  const barW = Math.min(slotW * 0.7, 36)

  const selectedData = selectedIndex !== null ? data[selectedIndex] : null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="size-4 text-emerald-500" />
          Day-by-Day Savings vs Auto Mode
          <Badge variant="outline" className="ml-auto text-[10px] font-mono">
            {data.length} op-days · 06:00 → 06:00 · avg {fmtEur(avgPerDay)}/day
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline gap-4 text-xs text-muted-foreground flex-wrap">
            <span>
              Total savings:{" "}
              <span
                className={
                  totalUplift >= 0
                    ? "text-emerald-600 font-mono font-semibold text-sm"
                    : "text-amber-600 font-mono font-semibold text-sm"
                }
              >
                {fmtEur(totalUplift)}
              </span>
            </span>
            {/* SOC-adjusted total — only meaningful on multi-day
                ranges where the optimizer's net pack-energy delta vs
                baseline is non-trivial. On a single day the same
                signal is already shown in the procurement-cost
                panel; replicating it there too would just be visual
                noise. */}
            {showSocAdjusted && (
              <span title="Total savings adjusted for the difference in pack energy parked at end-of-window between Manual and Auto Mode. This is the number that survives once both modes are returned to the same SOC.">
                SOC-adjusted:{" "}
                <span
                  className={
                    socAdjustedUplift! >= 0
                      ? "text-emerald-600 font-mono font-semibold text-sm"
                      : "text-amber-600 font-mono font-semibold text-sm"
                  }
                >
                  {fmtEur(socAdjustedUplift!)}
                </span>
                <span className="text-muted-foreground/60 text-[10px] ml-1 font-mono">
                  ({totalUplift >= 0 ? "+" : ""}
                  {fmtEur(totalUplift)} energy {socDeltaEur! >= 0 ? "+" : ""}
                  {fmtEur(socDeltaEur!)} SOC)
                </span>
              </span>
            )}
            <span className="text-muted-foreground/70">
              ({data.length} operating days, Optimized Mode vs Auto Mode)
            </span>
            {/* Import balance indicator */}
            <span className="ml-auto flex items-center gap-2">
              <span className="text-muted-foreground/60">
                Grid import: Auto {totalBaselineImport.toFixed(0)} kWh vs Manual {totalOptImport.toFixed(0)} kWh
              </span>
              {!importsBalanced && (
                <span className="text-amber-600 text-[10px] font-medium" title="Import difference exceeds 10% - savings include battery SOC value transfer">
                  ({importDiffPercent > 0 ? "+" : ""}{importDiffPercent.toFixed(1)}% diff)
                </span>
              )}
              {importsBalanced && (
                <span className="text-emerald-600 text-[10px]" title="Imports are balanced within 10%">
                  ✓ balanced
                </span>
              )}
            </span>
          </div>

          {/*
            ENERGY-CONSERVATION RECONCILIATION
            Shown only when caller supplied SOC start/end for both modes.
            Physics: with identical EV sessions and aux load, the gap in
            grid imports must equal the gap in net battery-energy stored.
                Imports_opt − Imports_baseline = ΔE_baseline − ΔE_opt
            (where ΔE = energy_end − energy_start, in kWh)

            If the right-hand side ≈ left-hand side, the simulator is
            self-consistent and the kWh difference is fully explained by
            where each mode "parked" battery energy at the boundaries —
            not by a bug. If they diverge, that residual is round-trip
            losses (RTE) plus any per-day SOC-reset artifacts in the
            optimizer's planning windows.
          */}
          {socBaseline && socOptimized && (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-[11px] flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="font-semibold text-foreground">
                Conservation check:
              </span>
              <span className="text-muted-foreground">
                Auto SOC{" "}
                <span className="font-mono text-foreground">
                  {socBaseline.startPct.toFixed(0)}% → {socBaseline.endPct.toFixed(0)}%
                </span>{" "}
                ({socBaseline.changeKwh >= 0 ? "+" : ""}
                {socBaseline.changeKwh.toFixed(1)} kWh stored)
              </span>
              <span className="text-muted-foreground">
                Manual SOC{" "}
                <span className="font-mono text-foreground">
                  {socOptimized.startPct.toFixed(0)}% → {socOptimized.endPct.toFixed(0)}%
                </span>{" "}
                ({socOptimized.changeKwh >= 0 ? "+" : ""}
                {socOptimized.changeKwh.toFixed(1)} kWh stored)
              </span>
              {(() => {
                const importGapKwh = totalOptImport - totalBaselineImport
                // Predicted gap from SOC delta alone:
                //   Imports_opt − Imports_baseline = ΔE_baseline − ΔE_opt
                const socExplainedKwh = socBaseline.changeKwh - socOptimized.changeKwh
                const residualKwh = importGapKwh - socExplainedKwh
                const reconciled = Math.abs(residualKwh) < Math.max(20, totalBaselineImport * 0.02)
                return (
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-muted-foreground">
                      kWh gap{" "}
                      <span className="font-mono text-foreground">
                        {importGapKwh >= 0 ? "+" : ""}
                        {importGapKwh.toFixed(1)}
                      </span>{" "}
                      = SOC delta{" "}
                      <span className="font-mono text-foreground">
                        {socExplainedKwh >= 0 ? "+" : ""}
                        {socExplainedKwh.toFixed(1)}
                      </span>{" "}
                      + residual{" "}
                      <span
                        className={`font-mono ${
                          reconciled ? "text-emerald-600" : "text-amber-600"
                        }`}
                      >
                        {residualKwh >= 0 ? "+" : ""}
                        {residualKwh.toFixed(1)}
                      </span>
                    </span>
                    {reconciled ? (
                      <span
                        className="text-emerald-600 text-[10px] font-medium"
                        title="Imports gap is fully explained by SOC delta — energy conservation holds."
                      >
                        ✓ reconciled
                      </span>
                    ) : (
                      <span
                        className="text-amber-600 text-[10px] font-medium"
                        title="Residual = round-trip losses + per-day SOC-reset artifacts in the optimizer."
                      >
                        unexplained
                      </span>
                    )}
                  </span>
                )
              })()}
            </div>
          )}

          <div className="relative">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full h-auto"
              role="img"
              aria-label="Daily savings versus Auto mode"
            >
              {/* Y-axis grid lines and labels */}
              {[0, 0.5, 1].map((frac) => {
                const y = zeroY - frac * positiveH
                const labelVal = (frac * maxPositive).toFixed(1)
                return (
                  <g key={`y-pos-${frac}`}>
                    <line
                      x1={padL}
                      x2={W - padR}
                      y1={y}
                      y2={y}
                      className="stroke-border"
                      strokeWidth={frac === 0 ? 1 : 0.5}
                      strokeDasharray={frac === 0 ? "" : "2 3"}
                    />
                    {frac > 0 && (
                      <text
                        x={padL - 6}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-emerald-600 text-[10px] font-mono"
                      >
                        +€{labelVal}
                      </text>
                    )}
                  </g>
                )
              })}
              {/* Negative zone grid */}
              {[0.5, 1].map((frac) => {
                const y = zeroY + frac * negativeH
                const labelVal = (frac * maxNegative).toFixed(1)
                return (
                  <g key={`y-neg-${frac}`}>
                    <line
                      x1={padL}
                      x2={W - padR}
                      y1={y}
                      y2={y}
                      className="stroke-border"
                      strokeWidth={0.5}
                      strokeDasharray="2 3"
                    />
                    <text
                      x={padL - 6}
                      y={y + 3}
                      textAnchor="end"
                      className="fill-amber-600 text-[10px] font-mono"
                    >
                      -€{labelVal}
                    </text>
                  </g>
                )
              })}

              {/* Zero baseline label */}
              <text
                x={padL - 6}
                y={zeroY + 3}
                textAnchor="end"
                className="fill-muted-foreground text-[10px] font-mono"
              >
                €0
              </text>

              {/* Bars */}
              {data.map((d, i) => {
                const cx = padL + slotW * (i + 0.5)
                const x = cx - barW / 2
                const isGood = d.upliftEur >= 0
                
                // Bar height calculation
                let barH: number
                let y: number
                if (isGood) {
                  barH = (d.upliftEur / maxPositive) * positiveH
                  y = zeroY - barH
                } else {
                  barH = (Math.abs(d.upliftEur) / maxNegative) * negativeH
                  y = zeroY
                }
                barH = Math.max(2, barH) // minimum visible height
                
                const fill = isGood ? "#10b981" : "#f59e0b"
                const isSelected = selectedIndex === i

                const showLabel =
                  data.length <= 14 || i === 0 || i === data.length - 1 || i % 2 === 0

                return (
                  <g key={d.dateKey}>
                    {/* Click hit area — toggles the details panel below the chart */}
                    <rect
                      x={padL + slotW * i}
                      y={padT}
                      width={slotW}
                      height={innerH}
                      fill="transparent"
                      className="cursor-pointer"
                      onClick={() =>
                        setSelectedIndex((prev) => (prev === i ? null : i))
                      }
                    />
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={barH}
                      fill={fill}
                      opacity={isSelected ? 1 : selectedIndex === null ? 0.85 : 0.4}
                      stroke={isSelected ? fill : "none"}
                      strokeWidth={isSelected ? 2 : 0}
                      rx={2}
                      className="transition-opacity duration-100 pointer-events-none"
                    />
                    {/* SOC-adjusted savings tick.
                        Per-day adjusted = raw upliftEur + perDayAdjEur,
                        where perDayAdjEur amortises the window-wide
                        SOC-banking delta across all days. We render a
                        small horizontal cap at the adjusted level
                        plus a connector line back to the bar's top —
                        this lets the user read "raw" (the green bar)
                        and "real after SOC correction" (the cap) in
                        one glance. The cap is always darker than the
                        bar so it pops without dominating; on bars
                        where the adjustment moves the savings into
                        loss territory, the cap renders below zero in
                        amber to signal the sign change.
                        Skipped entirely when the SOC delta is small
                        (< €0.05/day) — the marker would just sit on
                        top of the bar and add noise. */}
                    {showSocAdjusted && Math.abs(perDayAdjEur) >= 0.05 && (() => {
                      const adjVal = d.upliftEur + perDayAdjEur
                      const adjIsGood = adjVal >= 0
                      const adjY = adjIsGood
                        ? zeroY - (adjVal / maxPositive) * positiveH
                        : zeroY + (Math.abs(adjVal) / maxNegative) * negativeH
                      const barTopY = isGood ? y : zeroY
                      const capColor = adjIsGood ? "#047857" : "#b45309"
                      return (
                        <g className="pointer-events-none">
                          {/* Vertical connector — dashed, thin, runs
                              from the bar's relevant edge to the
                              adjusted level so the offset reads as
                              "the bar moved by this much" rather
                              than as a free-floating mark. */}
                          <line
                            x1={cx}
                            x2={cx}
                            y1={barTopY}
                            y2={adjY}
                            stroke={capColor}
                            strokeWidth={1}
                            strokeDasharray="2 2"
                            opacity={isSelected ? 1 : 0.7}
                          />
                          {/* Horizontal cap — wider than the bar so
                              it visually crowns/floors the bar. */}
                          <line
                            x1={cx - barW / 2 - 2}
                            x2={cx + barW / 2 + 2}
                            y1={adjY}
                            y2={adjY}
                            stroke={capColor}
                            strokeWidth={2}
                            strokeLinecap="round"
                            opacity={isSelected ? 1 : 0.85}
                          />
                        </g>
                      )
                    })()}
                    {/* Per-bar value label when not too crowded.
                        We also suppress labels whose magnitude rounds
                        to zero at the chart's display precision (€0.01),
                        otherwise barely-non-zero days print "-€0.0" /
                        "+€0.0" which is just visual noise. The bar
                        itself still renders as a hairline so the user
                        can see the day was simulated; only the
                        meaningless label is hidden. */}
                    {data.length <= 10 && Math.abs(d.upliftEur) >= 0.05 && (
                      <text
                        x={cx}
                        y={isGood ? y - 4 : y + barH + 11}
                        textAnchor="middle"
                        className={
                          isGood
                            ? "fill-emerald-600 text-[9px] font-mono font-semibold"
                            : "fill-amber-600 text-[9px] font-mono font-semibold"
                        }
                      >
                        {fmtEur(d.upliftEur)}
                      </text>
                    )}
                    {/* X-axis day label */}
                    {showLabel && (
                      <>
                        <text
                          x={cx}
                          y={H - padB + 16}
                          textAnchor="middle"
                          className="fill-foreground text-[10px] font-medium"
                        >
                          {fmtDate(d.dateKey)}
                        </text>
                        <text
                          x={cx}
                          y={H - padB + 30}
                          textAnchor="middle"
                          className="fill-muted-foreground text-[9px]"
                        >
                          {fmtWeekday(d.dateKey)}
                        </text>
                      </>
                    )}
                  </g>
                )
              })}

              {/* Zero baseline line (on top) */}
              <line
                x1={padL}
                x2={W - padR}
                y1={zeroY}
                y2={zeroY}
                className="stroke-foreground/50"
                strokeWidth={1}
              />
            </svg>
          </div>

          {/*
            ─────────────────────────────────────────────────────────
            SUB-CHART — CHARGING SESSIONS PER DAY
            ─────────────────────────────────────────────────────────
            Sits directly under the savings chart and shares the SAME
            column geometry (padL, padR, slotW, barW, ordering) so
            every session-count bar lines up vertically with its
            matching savings bar above. The exact session count is
            printed just above each bar — operators specifically
            asked for the number to be visible on-chart so they don't
            have to click into the details panel just to read it.
          */}
          {(() => {
            // Geometry — give the count labels enough headroom so a
            // bar at full height (`y === subPadT`) still has clear
            // space ABOVE it for its number. The previous layout used
            // `subPadT = 16` and clamped the label with
            // `Math.max(y - 3, subPadT + 9)`, which dragged the label
            // back DOWN into the bar on tall days. Result: most days
            // had a number floating above the bar, but the tallest
            // ones had the number jammed inside, producing a
            // staircase/jumpy visual the user flagged as ugly.
            //
            // Fix: bump `subPadT` to 28 so a 14px-tall label always
            // fits above the bar without overlap, and drop the clamp
            // entirely — every label now sits 8 px above its bar
            // top, perfectly aligned in a single horizontal band on
            // flat days and stepping naturally on uneven days.
            const subH = 150
            const subPadT = 28
            const subPadB = 28
            const subInnerH = subH - subPadT - subPadB
            const maxSessions = Math.max(
              ...data.map((d) => d.sessionCount),
              1, // never let the y-axis collapse to 0 on a quiet horizon
            )
            const totalSessions = data.reduce(
              (sum, d) => sum + d.sessionCount,
              0,
            )
            const yTicks = maxSessions <= 4 ? [0, maxSessions] : [0, Math.ceil(maxSessions / 2), maxSessions]
            return (
              <div className="-mt-1">
                <div className="flex items-baseline justify-between gap-2 px-1 pb-2">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                    <span className="size-2 rounded-sm bg-sky-500" />
                    Charging sessions started
                  </div>
                  <div className="flex items-baseline gap-3 text-[10px] tabular-nums text-muted-foreground/70">
                    <span>
                      <span className="font-semibold text-foreground">
                        {totalSessions}
                      </span>{" "}
                      total
                    </span>
                    <span>
                      peak{" "}
                      <span className="font-semibold text-foreground">
                        {maxSessions}
                      </span>
                      /day
                    </span>
                  </div>
                </div>
                <svg
                  viewBox={`0 0 ${W} ${subH}`}
                  className="w-full h-auto"
                  role="img"
                  aria-label="Charging sessions per day"
                >
                  {yTicks.map((tick) => {
                    const y = subPadT + subInnerH - (tick / maxSessions) * subInnerH
                    return (
                      <g key={`sess-y-${tick}`}>
                        <line
                          x1={padL}
                          x2={W - padR}
                          y1={y}
                          y2={y}
                          className="stroke-border"
                          strokeWidth={tick === 0 ? 1 : 0.5}
                          strokeDasharray={tick === 0 ? "" : "2 3"}
                        />
                        <text
                          x={padL - 8}
                          y={y + 3}
                          textAnchor="end"
                          className="fill-muted-foreground text-[10px] font-mono tabular-nums"
                        >
                          {tick}
                        </text>
                      </g>
                    )
                  })}
                  {data.map((d, i) => {
                    const cx = padL + slotW * (i + 0.5)
                    const x = cx - barW / 2
                    const h = (d.sessionCount / maxSessions) * subInnerH
                    const y = subPadT + subInnerH - h
                    const isSelected = selectedIndex === i
                    // Show the count number on every bar when the
                    // horizon is short enough that the labels won't
                    // overlap. On dense horizons (>20 days) the
                    // labels collide visually, so we degrade to
                    // "show the selected day's count only" — the
                    // user can still read every value via the
                    // details panel after clicking.
                    const showCountLabel =
                      d.sessionCount > 0 &&
                      (data.length <= 20 || isSelected)
                    return (
                      <g key={`sess-${d.dateKey}`}>
                        <rect
                          x={padL + slotW * i}
                          y={subPadT}
                          width={slotW}
                          height={subInnerH}
                          fill="transparent"
                          className="cursor-pointer"
                          onClick={() =>
                            setSelectedIndex((prev) => (prev === i ? null : i))
                          }
                        />
                        <rect
                          x={x}
                          y={y}
                          width={barW}
                          height={Math.max(d.sessionCount > 0 ? 2 : 0, h)}
                          fill="#0ea5e9"
                          opacity={isSelected ? 1 : selectedIndex === null ? 0.85 : 0.35}
                          stroke={isSelected ? "#0284c7" : "none"}
                          strokeWidth={isSelected ? 1.5 : 0}
                          rx={3}
                          className="transition-opacity duration-150 pointer-events-none"
                        />
                        {showCountLabel && (
                          <text
                            x={cx}
                            // Sit the number 8 px above the bar top.
                            // `subPadT` is now 28, big enough that
                            // even a max-height bar clears the
                            // tickline and leaves room for an 11 px
                            // label without overlap or clamping.
                            y={y - 8}
                            textAnchor="middle"
                            className={`fill-foreground text-[11px] tabular-nums pointer-events-none ${
                              isSelected ? "font-semibold" : "font-medium"
                            }`}
                          >
                            {d.sessionCount}
                          </text>
                        )}
                      </g>
                    )
                  })}
                  {/* X-axis day labels — owned by the bottom-most
                      sub-chart in the stack so date labels appear
                      exactly once at the foot of the whole widget,
                      perfectly aligned with the columns above. */}
                  {data.map((d, i) => {
                    const cx = padL + slotW * (i + 0.5)
                    const showLabel =
                      data.length <= 14 ||
                      i === 0 ||
                      i === data.length - 1 ||
                      i % Math.ceil(data.length / 14) === 0
                    if (!showLabel) return null
                    return (
                      <text
                        key={`sess-x-${d.dateKey}`}
                        x={cx}
                        y={subH - 8}
                        textAnchor="middle"
                        className="fill-muted-foreground text-[10px] tabular-nums"
                      >
                        {fmtDate(d.dateKey)}
                      </text>
                    )
                  })}
                </svg>
              </div>
            )
          })()}

          {/* Per-day details panel — shown when a bar is clicked.
              Replaces the old hover tooltip per user request: clicking a
              bar pins the breakdown here instead of having it disappear
              the moment the cursor moves. Click the same bar again, the
              X button, or press Esc to dismiss. */}
          {selectedData && (
            <div className="rounded-lg border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {fmtOpDayWindow(selectedData.dateKey)}
                  </span>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {fmtWeekday(selectedData.dateKey)} · op-day {selectedIndex! + 1} of {data.length}
                  </Badge>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedIndex(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 -m-1"
                  aria-label="Close details"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                {/* Headline savings/loss row */}
                <div
                  className={`flex items-center justify-between rounded-md px-3 py-2.5 ${
                    selectedData.upliftEur >= 0
                      ? "bg-emerald-500/10 border border-emerald-500/20"
                      : "bg-amber-500/10 border border-amber-500/20"
                  }`}
                >
                  <span className="text-sm font-medium">
                    {selectedData.upliftEur >= 0 ? "Daily savings" : "Daily loss"}
                  </span>
                  <span
                    className={`font-mono text-base font-bold ${
                      selectedData.upliftEur >= 0 ? "text-emerald-600" : "text-amber-600"
                    }`}
                  >
                    {selectedData.upliftEur >= 0 ? "+" : ""}
                    {fmtEur(selectedData.upliftEur)}
                  </span>
                </div>

                {/* Cost & import breakdown */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
                      Auto Mode
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-muted-foreground">Cost</span>
                      <span className="font-mono font-semibold text-foreground">
                        {fmtEur(selectedData.baselineCostEur)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-muted-foreground">Imports</span>
                      <span className="font-mono text-foreground">
                        {fmtKwh(selectedData.baselineImportKwh)}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                      Optimized Mode
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-muted-foreground">Cost</span>
                      <span className="font-mono font-semibold text-foreground">
                        {fmtEur(selectedData.optCostEur)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-muted-foreground">Imports</span>
                      <span className="font-mono text-foreground">
                        {fmtKwh(selectedData.optImportKwh)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Diff row (only when imports actually differ) */}
                {Math.abs(selectedData.baselineImportKwh - selectedData.optImportKwh) > 0.05 && (
                  <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
                    <span className="text-muted-foreground">Import difference (Manual − Auto)</span>
                    <span
                      className={`font-mono font-semibold ${
                        selectedData.optImportKwh < selectedData.baselineImportKwh
                          ? "text-emerald-600"
                          : "text-amber-600"
                      }`}
                    >
                      {selectedData.optImportKwh < selectedData.baselineImportKwh ? "-" : "+"}
                      {fmtKwh(
                        Math.abs(selectedData.optImportKwh - selectedData.baselineImportKwh),
                      )}
                    </span>
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground/70 pt-1">
                  Tip: click any bar to pin its details, click the same bar (or press Esc) to close.
                </p>
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground pt-1">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-emerald-500" />
              Net savings (manual cheaper than auto)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-amber-500" />
              Net loss (manual costlier than auto)
            </span>
            {showSocAdjusted && (
              <span className="flex items-center gap-1.5" title="Per-day SOC-adjusted savings — accounts for end-of-window pack-energy difference between Manual and Auto, amortised across the selected range.">
                <span className="block h-[2px] w-3 bg-emerald-800" />
                SOC-adjusted level (per day)
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
