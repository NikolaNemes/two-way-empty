"use client"

import type { ReactNode } from "react"
import { format, parse, subDays } from "date-fns"
import { LabRangePicker, type RangePresetLabel } from "@/components/lab/lab-range-picker"

/**
 * Day-grain period picker shared by Financial Breakdown and Dispatching
 * History. Same presets, same "Run" commit behaviour, same trigger.
 *
 * Wraps the canonical LabRangePicker with the report preset set; the pages
 * keep their `Date` state and get `YYYY-MM-DD` ↔ Date conversion here.
 */

export const REPORT_RANGE_PRESETS: readonly RangePresetLabel[] = [
  "Yesterday",
  "Last 7 days",
  "Last 14 days",
  "Last 30 days",
  "This month",
  "Last month",
]

const ISO = "yyyy-MM-dd"

export function toDay(d: Date): string {
  return format(d, ISO)
}
export function fromDay(s: string): Date {
  return parse(s, ISO, new Date())
}

/**
 * Last closed operating day = yesterday (local midnight). Reports are settlement
 * reports (Annex A8.1): today is partial and still changing, so it is never
 * priced. This is the same clip `berlinMonthWindow` applies to a running month,
 * so it is what keeps "This month" in the picker equal to the Fleet Monthly row.
 */
export function lastClosedDay(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return subDays(today, 1)
}

/**
 * Earliest reportable day = 1 Jun 2026. Mirrors LIVE_FLEET_FIRST_MONTH
 * (lib/fleet-report-builder): May 2026 has no retained raw frames, so its
 * counterfactual is stale and it is excluded from every report. Kept as a local
 * literal so this client picker doesn't pull the server-only builder module.
 */
export function firstReportableDay(): Date {
  return new Date(2026, 5, 1)
}

/** Default report period: yesterday (the last closed operating day). */
export function defaultReportRange(): { from: Date; to: Date } {
  const y = lastClosedDay()
  return { from: y, to: y }
}

/** A committed report period. `null` = the user has not chosen one yet. */
export type ReportRange = { from: Date; to: Date } | null

export function ReportRangePicker({
  from,
  to,
  onRun,
  disabled,
  className,
}: {
  from: Date | null
  to: Date | null
  onRun: (range: { from: Date; to: Date }) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <LabRangePicker
      from={from ? toDay(from) : ""}
      to={to ? toDay(to) : ""}
      onApply={(f, t) => onRun({ from: fromDay(f), to: fromDay(t) })}
      presets={REPORT_RANGE_PRESETS}
      applyLabel="Run"
      disabled={disabled}
      align="end"
      // Reports never price today — cap selection at the last closed day so a
      // preset like "This month" matches the Fleet Monthly window exactly.
      maxDate={lastClosedDay()}
      // May 2026 is excluded fleet-wide (no raw frames) — floor at 1 Jun 2026.
      minDate={firstReportableDay()}
      className={className ?? "w-auto"}
    />
  )
}

/**
 * The strip under every day-grain report title. CONFIGURE-FIRST (client
 * feedback sep 3 2026): the report does NOT run until the user picks a period
 * and presses Run — a site backtest is expensive and the user must choose what
 * to price. Once run, the period is always printed (Annex A8.1), the picker
 * changes it in place, and actions (Export Excel) sit at the right edge.
 */
export function ReportPeriodHeader({
  range,
  onRun,
  disabled,
  actions,
  note,
}: {
  range: ReportRange
  onRun: (range: { from: Date; to: Date }) => void
  disabled?: boolean
  actions?: ReactNode
  /** Small trailing note, e.g. data-through timestamp. */
  note?: ReactNode
}) {
  const from = range?.from ?? null
  const to = range?.to ?? null
  const dayCount = from && to ? Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1) : 0
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-4 py-2">
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Report period</span>
        {from && to ? (
          <span className="text-sm font-medium tabular-nums">
            {format(from, "MMM d, yyyy")}
            {to.getTime() !== from.getTime() ? ` → ${format(to, "MMM d, yyyy")}` : ""}
            <span className="ml-2 text-xs text-muted-foreground">
              ({dayCount} day{dayCount === 1 ? "" : "s"})
            </span>
            {note ? <span className="ml-2 text-xs text-muted-foreground">{note}</span> : null}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Not selected — choose a period and press Run</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ReportRangePicker from={from} to={to} onRun={onRun} disabled={disabled} />
        {actions}
      </div>
    </div>
  )
}

/** Placeholder shown where the report will render until a period is run. */
export function ReportNotRun({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-6 py-14 text-center">
      <span className="text-sm font-medium">No period selected</span>
      <p className="max-w-md text-pretty text-sm text-muted-foreground">
        Pick a period above (a preset or a custom range) and press <span className="font-medium">Run</span>. {what}
      </p>
    </div>
  )
}
