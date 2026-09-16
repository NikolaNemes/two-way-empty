"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { CoverageDay } from "@/lib/ingestion"

const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""]

/** Map completeness (0..1) to a discrete intensity bucket → Tailwind class. */
function cellClass(day: CoverageDay): string {
  if (day.count === 0) return "bg-muted border-border"
  const c = day.completeness
  if (c >= 0.99) return "bg-teal-600 border-teal-700"
  if (c >= 0.9) return "bg-teal-500 border-teal-600"
  if (c >= 0.6) return "bg-teal-400 border-teal-500"
  if (c >= 0.25) return "bg-teal-300 border-teal-400"
  return "bg-teal-200 border-teal-300"
}

/** ISO weekday index 0=Mon … 6=Sun for a YYYY-MM-DD string (UTC). */
function weekdayIndex(isoDay: string): number {
  const d = new Date(`${isoDay}T00:00:00Z`)
  return (d.getUTCDay() + 6) % 7
}

interface CoverageCalendarProps {
  days: CoverageDay[]
  expectedPerDay: number
}

/**
 * GitHub-style calendar heatmap of per-day telemetry completeness. Each cell is
 * one day; color intensity encodes the fraction of expected frames present, and
 * empty (gap) days render in the muted track so missing data is impossible to
 * miss. Weeks are columns, weekdays are rows.
 */
export function CoverageCalendar({ days, expectedPerDay }: CoverageCalendarProps) {
  if (days.length === 0) return null

  // Build week columns. Pad the first week so the first day lands on its weekday row.
  const columns: Array<Array<CoverageDay | null>> = []
  let current: Array<CoverageDay | null> = new Array(weekdayIndex(days[0].day)).fill(null)

  for (const day of days) {
    if (current.length === 7) {
      columns.push(current)
      current = []
    }
    current.push(day)
  }
  if (current.length > 0) {
    while (current.length < 7) current.push(null)
    columns.push(current)
  }

  // Month labels above the week columns.
  const monthLabel = (col: Array<CoverageDay | null>): string => {
    const first = col.find((d): d is CoverageDay => d !== null)
    if (!first) return ""
    return new Date(`${first.day}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      timeZone: "UTC",
    })
  }
  let lastMonth = ""

  return (
    <TooltipProvider delayDuration={100}>
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {/* Weekday row labels */}
        <div className="flex flex-col gap-1 pr-1 pt-5">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={i}
              className="h-3.5 text-[9px] leading-3.5 text-muted-foreground"
              style={{ height: 14 }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Week columns */}
        <div className="flex gap-1">
          {columns.map((col, ci) => {
            const m = monthLabel(col)
            const showMonth = m && m !== lastMonth
            if (showMonth) lastMonth = m
            return (
              <div key={ci} className="flex flex-col gap-1">
                <div className="h-4 text-[9px] leading-4 text-muted-foreground">
                  {showMonth ? m : ""}
                </div>
                {col.map((day, ri) =>
                  day === null ? (
                    <div key={ri} className="size-3.5 rounded-[3px]" style={{ height: 14, width: 14 }} />
                  ) : (
                    <Tooltip key={ri}>
                      <TooltipTrigger asChild>
                        <div
                          className={`size-3.5 rounded-[3px] border ${cellClass(day)}`}
                          style={{ height: 14, width: 14 }}
                        />
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        <div className="font-medium">{day.day}</div>
                        <div className="tabular-nums">
                          {day.count.toLocaleString()} / {expectedPerDay.toLocaleString()} frames
                        </div>
                        <div className="tabular-nums text-muted-foreground">
                          {day.count === 0
                            ? "no data"
                            : `${(day.completeness * 100).toFixed(1)}% complete`}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ),
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>Gap</span>
        <span className="size-3 rounded-[3px] border border-border bg-muted" />
        <span className="ml-1">Less</span>
        <span className="size-3 rounded-[3px] border border-teal-300 bg-teal-200" />
        <span className="size-3 rounded-[3px] border border-teal-400 bg-teal-300" />
        <span className="size-3 rounded-[3px] border border-teal-500 bg-teal-400" />
        <span className="size-3 rounded-[3px] border border-teal-600 bg-teal-500" />
        <span className="size-3 rounded-[3px] border border-teal-700 bg-teal-600" />
        <span>More</span>
      </div>
    </div>
    </TooltipProvider>
  )
}
