"use client"

import { useState } from "react"
import { addDays, format, startOfMonth, subDays, subMonths } from "date-fns"
import type { DateRange } from "react-day-picker"
import { CalendarRange, Loader2, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"

/**
 * Data Analysis intake card.
 *
 * The Data Analysis screen is now an explicit three-step flow:
 *
 *   1. Configure  — user picks a range + clicks Run Report (this card)
 *   2. Loading    — frames stream in from the API
 *   3. Report     — full dashboard renders
 *
 * This component owns step 1: the user assembles a *draft* range, and
 * only when they click Run Report do we commit it upstream. We never
 * call setHistoricalRange on every keystroke — that would re-fetch
 * frames continuously while the user is still deciding. A single
 * commit on click keeps network traffic predictable and matches the
 * "report run" mental model.
 */

// Presets are expressed as inclusive day offsets back from today's
// 06:00 boundary. The range we hand back to the page is then
// converted to ISO with timezone via toIsoDayBoundary in the caller.
type Preset = {
  label: string
  description: string
  daysBack: number
}

const PRESETS: Preset[] = [
  { label: "Yesterday", description: "Single operating day", daysBack: 1 },
  { label: "Last 2 days", description: "06:00 to 06:00 ×2", daysBack: 2 },
  { label: "Last 7 days", description: "Week-over-week view", daysBack: 7 },
  { label: "Last 14 days", description: "Two-week trend", daysBack: 14 },
  { label: "Last 30 days", description: "Monthly performance", daysBack: 30 },
]

export interface DataAnalysisIntakeProps {
  /** Initial draft range to seed the picker with. */
  initialRange: DateRange
  /**
   * Submit handler. Called with a confirmed inclusive [from, to] day
   * range (each `Date` is local midnight; the page converts to the
   * 06:00→06:00 operating-day window).
   */
  onRun: (range: { from: Date; to: Date }) => void
  /**
   * True while the report from a previous click is still loading. Used
   * to disable the button + show a spinner so the user can't fire
   * overlapping requests.
   */
  isRunning?: boolean
}

export function DataAnalysisIntake({
  initialRange,
  onRun,
  isRunning = false,
}: DataAnalysisIntakeProps) {
  const [draft, setDraft] = useState<DateRange | undefined>(initialRange)
  /**
   * Controlled month for the two-month picker. We anchor on the FIRST
   * day of last month so the picker shows [previous month, current
   * month] — never an entirely-future month. This is a controlled
   * value, not a `defaultMonth`, because `defaultMonth` only seeds the
   * very first render: any later prop change (or any quick-range
   * click) silently re-anchors the picker, which is exactly what was
   * causing the right pane to show the next, all-future month. With a
   * controlled `month`, we own the truth and the calendar follows.
   */
  const [visibleMonth, setVisibleMonth] = useState<Date>(() =>
    startOfMonth(subMonths(new Date(), 1)),
  )

  // Apply a preset by computing [today − daysBack, yesterday] inclusive
  // and writing the result to the draft. We don't auto-submit — the
  // user still has to click Run Report. This makes presets a shortcut
  // for "fill the calendar" rather than a one-click run, which is
  // friendlier when the user is iterating on options.
  const applyPreset = (daysBack: number) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const to = subDays(today, 1) // yesterday inclusive
    const from = subDays(today, daysBack) // daysBack days ago
    setDraft({ from, to })
  }

  // Number of days currently selected (inclusive). Used both for the
  // helper line under the calendar and for nudging the user when the
  // window is large enough that loading might take a noticeable while.
  const selectedDayCount =
    draft?.from && draft?.to
      ? Math.max(
          1,
          Math.round(
            (draft.to.getTime() - draft.from.getTime()) /
              (24 * 60 * 60 * 1000),
          ) + 1,
        )
      : draft?.from
        ? 1 // a single picked day is a valid one-day report
        : 0

  const canRun = !!draft?.from && !isRunning

  const handleRun = () => {
    if (!draft?.from) return
    const from = draft.from
    const to = draft.to ?? draft.from
    onRun({ from, to })
  }

  return (
    <Card className="max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="size-5 text-primary" />
          Configure Data Analysis Report
        </CardTitle>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Pick a date range, then run the report. Each day spans 06:00
          → 06:00 next morning. The optimizer carries SOC continuously
          across day boundaries, so longer windows show realistic
          carryover effects.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Quick presets */}
          <div className="lg:w-44 lg:shrink-0">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Quick ranges
            </div>
            <div className="flex flex-col gap-1">
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  variant="ghost"
                  size="sm"
                  className="justify-start h-auto py-2 px-2 text-left"
                  onClick={() => applyPreset(p.daysBack)}
                >
                  <div className="flex flex-col items-start">
                    <span className="text-xs font-medium">{p.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {p.description}
                    </span>
                  </div>
                </Button>
              ))}
            </div>
          </div>

          {/* Calendar + summary + submit */}
          <div className="flex-1 flex flex-col gap-3">
            {/* Live Start / End summary so the user always knows what
                they're about to commit. The calendar below just edits
                this draft. */}
            <div className="flex flex-wrap items-center gap-3">
              <SummaryPill
                label="Start"
                value={
                  draft?.from
                    ? format(draft.from, "MMM d, yyyy")
                    : "—"
                }
                placeholder={!draft?.from}
              />
              <span className="text-muted-foreground">→</span>
              <SummaryPill
                label="End"
                value={
                  draft?.to
                    ? format(draft.to, "MMM d, yyyy")
                    : draft?.from
                      ? `${format(draft.from, "MMM d, yyyy")} · single day`
                      : "—"
                }
                placeholder={!draft?.to && !draft?.from}
              />
              {selectedDayCount > 0 && (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {selectedDayCount} day{selectedDayCount === 1 ? "" : "s"}
                  {selectedDayCount > 14 ? " · longer ranges take a bit to load" : ""}
                </span>
              )}
            </div>

            <div className="rounded-md border p-2">
              <Calendar
                mode="range"
                numberOfMonths={2}
                selected={draft}
                onSelect={setDraft}
                disabled={(date) => date > new Date()}
                /* CONTROLLED month anchor.
                   Previously this was `defaultMonth = draft?.from ?? prevMonth`,
                   but `defaultMonth` only seeds the very first render —
                   and the `draft?.from` fallback meant that the moment a
                   quick-range like "Yesterday" set `from = today − 1`,
                   react-day-picker re-anchored on the CURRENT month and
                   showed [May, June], i.e. the next month was entirely
                   future and disabled. We now drive the visible months
                   ourselves: left = previous month, right = current
                   month, both unconditionally. We also clamp paging via
                   `endMonth` so the user can't navigate forward past
                   the current month and re-create the bug. */
                month={visibleMonth}
                onMonthChange={setVisibleMonth}
                endMonth={startOfMonth(new Date())}
                className="rounded-md"
              />
            </div>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Tip: click one day and hit Run Report for a single-day breakdown, or click a start then
              an end day for a range.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(undefined)}
                disabled={!draft?.from || isRunning}
              >
                Clear
              </Button>
              <Button
                size="sm"
                onClick={handleRun}
                disabled={!canRun}
                className="gap-2"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Loading…
                  </>
                ) : (
                  <>
                    <Play className="size-4" />
                    Run Report
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SummaryPill({
  label,
  value,
  placeholder,
}: {
  label: string
  value: string
  placeholder?: boolean
}) {
  return (
    <div className="flex flex-col items-start">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-mono tabular-nums px-2 py-0.5 rounded border text-xs",
          placeholder
            ? "border-dashed border-muted-foreground/40 text-muted-foreground"
            : "border-foreground/20 bg-muted/40 text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Convert a local-midnight Date pair from the calendar into the
 * 06:00→06:00 operating-day ISO range that the historical pipeline
 * expects. Exported so the page can call it on submit without
 * duplicating the formatter.
 */
export function rangeToOperatingDayIso(from: Date, to: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  const formatISO = (d: Date) => {
    const offset = -d.getTimezoneOffset()
    const sign = offset >= 0 ? "+" : "-"
    const absOffset = Math.abs(offset)
    const tzHours = pad(Math.floor(absOffset / 60))
    const tzMins = pad(absOffset % 60)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${tzHours}:${tzMins}`
  }
  // Start = 06:00 on `from`, end = 06:00 on (to + 1 day) — the upper
  // bound is exclusive, so we add a day to make the picked end date
  // inclusive in the resulting window.
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 6, 0, 0)
  const endBase = addDays(to, 1)
  const end = new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate(), 6, 0, 0)
  return { dayStart: formatISO(start), dayEnd: formatISO(end) }
}
