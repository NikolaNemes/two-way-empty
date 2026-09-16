"use client"

/**
 * Price Analysis — dynamic tariff vs flat, day by day (client request aug 24
 * 2026 after the Aug-18 loss day). Two layers:
 *   MARKET — every IDM day classified vs the fleet's weighted flat rate
 *   ACTUAL — real archive euros (portfolio_daily) where volumes exist
 * The headline story: on "guaranteed-loss" days the whole market sits above
 * the flat rate, so NO strategy can win — that cost comes from the tariff
 * switch itself, not from the software.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { TrendingDown, TrendingUp, Scale, CalendarRange, ExternalLink } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExportExcelButton } from "@/components/reports/export-excel-button"
import { TermHead } from "@/components/reports/term"
import { Badge } from "@/components/ui/badge"
import { ReportMonthPicker } from "@/components/reports/report-month-picker"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts"
import type { PriceAnalysis, PriceDay, DayVerdict } from "@/lib/price-analysis"

const VERDICT_LABEL: Record<DayVerdict, string> = {
  favorable: "Favorable",
  headwind: "Headwind",
  guaranteed_loss: "Guaranteed loss",
}
const VERDICT_COLOR: Record<DayVerdict, string> = {
  favorable: "#16a34a",
  headwind: "#d97706",
  guaranteed_loss: "#dc2626",
}

const fmtEur = (v: number) =>
  v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
const fmtEur2 = (v: number) =>
  v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 })
const fmtCt = (v: number) => `${v.toLocaleString("de-DE", { maximumFractionDigits: 1 })} ct`
const monthLabel = (m: string) => {
  const [y, mm] = m.split("-").map(Number)
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

/** 12 months back from the last data day, clamped to coverage start. */
function defaultWindow(days: PriceDay[]): [number, number] {
  if (days.length === 0) return [0, 0]
  return [Math.max(0, days.length - 366), days.length]
}

export function PriceAnalysisScreen({ analysis }: { analysis: PriceAnalysis }) {
  const [monthFilter, setMonthFilter] = useState<string | "all">("all")

  const visibleDays = useMemo(() => {
    if (monthFilter === "all") {
      const [from, to] = defaultWindow(analysis.days)
      return analysis.days.slice(from, to)
    }
    return analysis.days.filter((d) => d.day.startsWith(monthFilter))
  }, [analysis.days, monthFilter])

  const chartData = useMemo(
    () =>
      visibleDays.map((d) => ({
        ...d,
        // stacked band: base = min, band = max−min (rendered as area on top of base)
        bandBase: d.minCt,
        bandHeight: d.maxCt - d.minCt,
      })),
    [visibleDays],
  )

  const actualDays = useMemo(() => visibleDays.filter((d) => d.deltaEur != null), [visibleDays])

  // KPI tiles follow the SAME period as the charts (Gronau usability 4:
  // one period control, everything on the page obeys it). Previously the
  // tiles always showed whole-coverage totals (489 days) while the picker
  // narrowed only the charts — the header said "Jul 2026", the tiles didn't.
  const t = useMemo(() => {
    let favorableDays = 0
    let headwindDays = 0
    let lossDays = 0
    let actualFlatEur = 0
    let actualDynEur = 0
    let actualImportKwh = 0
    let bestDay: { day: string; deltaEur: number } | null = null
    let worstDay: { day: string; deltaEur: number } | null = null
    for (const d of visibleDays) {
      if (d.verdict === "favorable") favorableDays += 1
      else if (d.verdict === "headwind") headwindDays += 1
      else lossDays += 1
      if (d.deltaEur == null) continue
      actualFlatEur += d.flatEur ?? 0
      actualDynEur += d.dynEur ?? 0
      actualImportKwh += d.importKwh ?? 0
      if (d.deltaEur > 0 && (!bestDay || d.deltaEur > bestDay.deltaEur)) bestDay = { day: d.day, deltaEur: d.deltaEur }
      if (d.deltaEur < 0 && (!worstDay || d.deltaEur < worstDay.deltaEur)) worstDay = { day: d.day, deltaEur: d.deltaEur }
    }
    return {
      favorableDays,
      headwindDays,
      lossDays,
      actualDeltaEur: actualFlatEur - actualDynEur,
      actualFlatEur,
      actualDynEur,
      actualImportKwh,
      bestDay,
      worstDay,
    }
  }, [visibleDays])
  const totalDays = t.favorableDays + t.headwindDays + t.lossDays

  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      {/* ── Header ── */}
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-balance">Price Analysis — dynamic vs flat</h1>
          {/* Same period control + export CTA as every other report page
              (Gronau usability 3 + 4). "Last 12 months" is the analysis's
              natural window; a single month narrows the charts and tables. */}
          <div className="flex flex-wrap items-center gap-2">
            {analysis.months.length > 0 ? (
              <ReportMonthPicker
                value={monthFilter}
                onChange={setMonthFilter}
                min={analysis.months[0].month}
                max={analysis.months[analysis.months.length - 1].month}
                extraOption={{ value: "all", label: "Last 12 months" }}
                steppers={false}
                aria-label="Analysis period"
              />
            ) : null}
            <ExportExcelButton href={`/api/reports/price-analysis/xlsx?from=${analysis.fromDay}&to=${analysis.toDay}`} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl text-pretty">
          Every day since {dayLabel(analysis.fromDay)} classified against the fleet&apos;s weighted flat rate of{" "}
          <strong>{fmtCt(analysis.weightedFlatCt)}/kWh</strong>. On a{" "}
          <span className="font-medium text-red-700">guaranteed-loss</span> day even the cheapest 15-minute slot
          costs more than flat — no dispatch strategy can win; that cost comes from the tariff switch, not the
          software. Actual euros are shown where the telemetry archive has volumes
          {analysis.actualsThroughDay ? ` (through ${dayLabel(analysis.actualsThroughDay)})` : ""}.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Badge variant="outline" className="gap-1.5 font-normal">
            <CalendarRange className="size-3" />
            IDM DE-LU · 15-min
          </Badge>
          {/* Selected period always printed in the header, like the other reports. */}
          <Badge variant="secondary" className="font-normal tabular-nums">
            {monthFilter === "all"
              ? visibleDays.length > 0
                ? `${dayLabel(visibleDays[0].day)} – ${dayLabel(visibleDays[visibleDays.length - 1].day)}`
                : "Last 12 months"
              : monthLabel(monthFilter)}
          </Badge>
          <Link
            href="/portfolio/yearly"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Fleet Yearly Report
            <ExternalLink className="size-3" />
          </Link>
        </div>
      </header>

      {/* ── KPI cards ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Scale className="size-4" />
              Day verdicts ({totalDays} days)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-green-700">Favorable</span>
              <span className="font-semibold tabular-nums">{t.favorableDays}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-amber-700">Headwind</span>
              <span className="font-semibold tabular-nums">{t.headwindDays}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-red-700">Guaranteed loss</span>
              <span className="font-semibold tabular-nums">{t.lossDays}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              {t.actualDeltaEur >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
              Actual Δ vs flat (archive)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-semibold tabular-nums ${t.actualDeltaEur >= 0 ? "text-green-700" : "text-red-700"}`}
            >
              {t.actualDeltaEur >= 0 ? "+" : "−"}
              {fmtEur(Math.abs(t.actualDeltaEur))}
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              flat {fmtEur(t.actualFlatEur)} vs dynamic {fmtEur(t.actualDynEur)} ·{" "}
              {Math.round(t.actualImportKwh).toLocaleString("de-DE")} kWh
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <TrendingUp className="size-4 text-green-700" />
              Best day
            </CardTitle>
          </CardHeader>
          <CardContent>
            {t.bestDay ? (
              <>
                <div className="text-2xl font-semibold tabular-nums text-green-700">
                  +{fmtEur2(t.bestDay.deltaEur)}
                </div>
                <p className="pt-1 text-xs text-muted-foreground">{dayLabel(t.bestDay.day)}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <TrendingDown className="size-4 text-red-700" />
              Worst day
            </CardTitle>
          </CardHeader>
          <CardContent>
            {t.worstDay ? (
              <>
                <div className="text-2xl font-semibold tabular-nums text-red-700">
                  −{fmtEur2(Math.abs(t.worstDay.deltaEur))}
                </div>
                <p className="pt-1 text-xs text-muted-foreground">{dayLabel(t.worstDay.day)}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Chart 1: daily price band vs flat ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Daily price band vs flat rate
            {monthFilter !== "all" ? (
              <Badge variant="outline" className="ml-2 align-middle">
                {monthLabel(monthFilter)}
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d: string) => d.slice(5)}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  width={44}
                  label={{ value: "ct/kWh", angle: -90, position: "insideLeft", fontSize: 11 }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as PriceDay
                    return (
                      <div className="rounded-md border bg-background p-2 text-xs shadow-md">
                        <div className="font-medium">{dayLabel(d.day)}</div>
                        <div style={{ color: VERDICT_COLOR[d.verdict] }} className="font-medium">
                          {VERDICT_LABEL[d.verdict]}
                        </div>
                        <div>min {fmtCt(d.minCt)} · avg {fmtCt(d.avgCt)} · max {fmtCt(d.maxCt)}</div>
                        <div>spread {fmtCt(d.spreadCt)}</div>
                        {d.deltaEur != null ? (
                          <div className={d.deltaEur >= 0 ? "text-green-700" : "text-red-700"}>
                            actual Δ {d.deltaEur >= 0 ? "+" : "−"}
                            {fmtEur2(Math.abs(d.deltaEur))}
                          </div>
                        ) : null}
                      </div>
                    )
                  }}
                />
                {/* min–max band: transparent base + tinted height */}
                <Area dataKey="bandBase" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
                <Area
                  dataKey="bandHeight"
                  stackId="band"
                  stroke="none"
                  fill="hsl(215 60% 60% / 0.25)"
                  isAnimationActive={false}
                />
                <Line
                  dataKey="avgCt"
                  stroke="hsl(215 70% 45%)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <ReferenceLine
                  y={analysis.weightedFlatCt}
                  stroke="#dc2626"
                  strokeDasharray="6 3"
                  label={{
                    value: `flat ${fmtCt(analysis.weightedFlatCt)}`,
                    fontSize: 11,
                    fill: "#dc2626",
                    position: "insideTopRight",
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="pt-2 text-xs text-muted-foreground text-pretty">
            Shaded band = daily min–max of IDM 15-min prices; solid line = daily average; dashed red = weighted
            flat rate. Days where the whole band sits above the dashed line are guaranteed losses — the market
            never dipped below flat, so buying &quot;cheap&quot; was impossible.
          </p>
        </CardContent>
      </Card>

      {/* ── Chart 2: actual daily delta (archive window) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actual daily result vs flat (archive euros)</CardTitle>
        </CardHeader>
        <CardContent>
          {actualDays.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No archive volumes in the selected window — the telemetry archive ends{" "}
              {analysis.actualsThroughDay ? dayLabel(analysis.actualsThroughDay) : "—"}.
            </p>
          ) : (
            <>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={actualDays} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(d: string) => d.slice(5)}
                      minTickGap={40}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      width={44}
                      label={{ value: "Δ €/day", angle: -90, position: "insideLeft", fontSize: 11 }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload as PriceDay
                        return (
                          <div className="rounded-md border bg-background p-2 text-xs shadow-md">
                            <div className="font-medium">{dayLabel(d.day)}</div>
                            <div className={d.deltaEur != null && d.deltaEur >= 0 ? "text-green-700" : "text-red-700"}>
                              Δ {d.deltaEur != null && d.deltaEur >= 0 ? "+" : "−"}
                              {fmtEur2(Math.abs(d.deltaEur ?? 0))}
                            </div>
                            <div>
                              flat {fmtEur2(d.flatEur ?? 0)} · dynamic {fmtEur2(d.dynEur ?? 0)}
                            </div>
                            <div style={{ color: VERDICT_COLOR[d.verdict] }}>{VERDICT_LABEL[d.verdict]}</div>
                          </div>
                        )
                      }}
                    />
                    <ReferenceLine y={0} stroke="hsl(215 15% 60%)" />
                    <Bar dataKey="deltaEur" isAnimationActive={false}>
                      {actualDays.map((d) => (
                        <Cell key={d.day} fill={(d.deltaEur ?? 0) >= 0 ? "#16a34a" : "#dc2626"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="pt-2 text-xs text-muted-foreground text-pretty">
                Green = dynamic tariff beat flat that day; red = flat would have been cheaper. This is the real
                invoice-level difference from the telemetry archive (fleet-wide import × per-station flat rates
                vs actually paid weighted prices).
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Monthly table ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Month by month</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TermHead term="dayVerdict" className="text-right text-green-700">
                    Favorable
                  </TermHead>
                  <TermHead term="dayVerdict" className="text-right text-amber-700">
                    Headwind
                  </TermHead>
                  <TermHead term="dayVerdict" className="text-right text-red-700">
                    Loss
                  </TermHead>
                  <TermHead term="dynamicTariff" className="text-right">
                    Avg price
                  </TermHead>
                  <TermHead term="idmSpread" className="text-right">
                    Avg spread
                  </TermHead>
                  <TermHead term="flatCost" className="text-right">
                    Flat €
                  </TermHead>
                  <TermHead term="dynamicCost" className="text-right">
                    Dynamic €
                  </TermHead>
                  <TermHead term="procurementSaving" className="text-right">
                    Δ €
                  </TermHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.months.map((m) => (
                  <TableRow
                    key={m.month}
                    className="cursor-pointer"
                    onClick={() => setMonthFilter(monthFilter === m.month ? "all" : m.month)}
                    data-state={monthFilter === m.month ? "selected" : undefined}
                  >
                    <TableCell className="font-medium">{monthLabel(m.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.days}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.favorableDays}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.headwindDays}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.lossDays > 0 ? (
                        <span className="font-semibold text-red-700">{m.lossDays}</span>
                      ) : (
                        m.lossDays
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCt(m.avgPriceCt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCt(m.avgSpreadCt)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.flatEur != null ? fmtEur(m.flatEur) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.dynEur != null ? fmtEur(m.dynEur) : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium tabular-nums ${
                        m.deltaEur == null ? "" : m.deltaEur >= 0 ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      {m.deltaEur == null ? "—" : `${m.deltaEur >= 0 ? "+" : "−"}${fmtEur(Math.abs(m.deltaEur))}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="pt-2 text-xs text-muted-foreground text-pretty">
            Flat / Dynamic / Δ come from the telemetry archive and end{" "}
            {analysis.actualsThroughDay ? dayLabel(analysis.actualsThroughDay) : "—"}; later months show market
            verdicts only. Click a row to focus the charts on that month.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
