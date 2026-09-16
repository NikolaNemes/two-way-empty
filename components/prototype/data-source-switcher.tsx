"use client"

import { useState, useMemo } from "react"
import { usePrototypeTelemetryContext, type DataSourceMode } from "@/lib/prototype-telemetry-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Radio,
  History,
  CalendarDays,
  Play,
  Pause,
  RotateCcw,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { format, addDays, subDays, startOfDay, setHours, parseISO, isValid, startOfWeek, startOfMonth, endOfMonth } from "date-fns"
import type { DateRange } from "react-day-picker"

// Operating day starts at 06:00 and ends at 06:00 next day
const OPERATING_DAY_START_HOUR = 6

/**
 * Convert a Date to an operating-day ISO-8601 range (06:00 → 06:00 next day)
 */
function toOperatingDayRange(date: Date): { dayStart: string; dayEnd: string } {
  const start = setHours(startOfDay(date), OPERATING_DAY_START_HOUR)
  const end = addDays(start, 1)
  // Format as ISO-8601 with timezone
  const formatISO = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0")
    const offset = -d.getTimezoneOffset()
    const sign = offset >= 0 ? "+" : "-"
    const absOffset = Math.abs(offset)
    const tzHours = pad(Math.floor(absOffset / 60))
    const tzMins = pad(absOffset % 60)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${tzHours}:${tzMins}`
  }
  return { dayStart: formatISO(start), dayEnd: formatISO(end) }
}

/**
 * Parse an ISO-8601 dayStart string back to a Date representing the operating day
 */
function parseOperatingDay(dayStart: string): Date | null {
  try {
    const d = parseISO(dayStart)
    if (!isValid(d)) return null
    return startOfDay(d)
  } catch {
    return null
  }
}

/**
 * Get today's operating day range (06:00 today → 06:00 tomorrow)
 */
function getTodayOperatingDayRange() {
  return toOperatingDayRange(new Date())
}

interface DataSourceSwitcherProps {
  /** Modes to hide from the tab strip. Useful for pages that only support
   *  a subset of modes (e.g. Data Analysis = historical only). */
  hiddenModes?: DataSourceMode[]
  /** Hide the date picker entirely (useful for live-only pages) */
  hideDatePicker?: boolean
}

export function DataSourceSwitcher({ hiddenModes = [], hideDatePicker = false }: DataSourceSwitcherProps) {
  const {
    dataSource,
    setDataSource,
    historicalRange,
    setHistoricalRange,
    live,
    historical,
  } = usePrototypeTelemetryContext()

  // Calendar popover state.
  //
  // We deliberately keep this as a local *draft* (`pendingRange`) and only
  // commit to the global historicalRange when the user clicks Apply. The
  // previous design auto-committed the moment `range.to` was first set,
  // which had two failure modes:
  //   1. If the user wanted to revise the end date they had to reopen
  //      the popover from scratch.
  //   2. If react-day-picker fired an intermediate `{ from, to: undefined }`
  //      after the user clicked an earlier date to "start over", the
  //      popover would never re-commit and the range silently desynced.
  // Explicit Apply also lets us show a live "N days selected" summary
  // before the user confirms.
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>()

  // Parse the current historical range to display
  const currentHistoricalDate = useMemo(() => {
    return parseOperatingDay(historicalRange.dayStart)
  }, [historicalRange.dayStart])

  // Calculate number of days in current range
  const rangeDays = useMemo(() => {
    const start = parseOperatingDay(historicalRange.dayStart)
    const end = parseOperatingDay(historicalRange.dayEnd)
    if (!start || !end) return 1
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)))
  }, [historicalRange])

  // Status for live mode
  const liveStatus = live.error
    ? "error"
    : live.isLoading
      ? "loading"
      : "connected"

  // Handle mode change
  const handleModeChange = (mode: string) => {
    if (mode === "live") {
      // Switch to live mode with today's operating day
      setDataSource("live")
      setHistoricalRange(getTodayOperatingDayRange())
    } else {
      // Switch to historical mode
      setDataSource("historical")
    }
  }

  // Navigate to previous/next day(s)
  const navigateDays = (direction: "prev" | "next") => {
    const current = parseOperatingDay(historicalRange.dayStart)
    if (!current) return
    const newDate = direction === "prev"
      ? subDays(current, rangeDays)
      : addDays(current, rangeDays)
    const newEnd = addDays(newDate, rangeDays)
    setHistoricalRange({
      dayStart: toOperatingDayRange(newDate).dayStart,
      dayEnd: toOperatingDayRange(newEnd).dayStart, // Use start of end day as the end
    })
  }

  // Seed the draft from whatever range is currently committed when the
  // popover opens. Without this, opening the picker after picking a
  // preset would show an empty calendar with no visible "current"
  // selection — the user couldn't tell what they were editing.
  const openCalendar = (open: boolean) => {
    if (open) {
      const start = parseOperatingDay(historicalRange.dayStart)
      const endExclusive = parseOperatingDay(historicalRange.dayEnd)
      // Range is stored as [start, end-exclusive); the displayed last
      // day is therefore endExclusive − 1 day.
      const endInclusive = endExclusive ? subDays(endExclusive, 1) : start
      if (start) {
        setPendingRange({ from: start, to: endInclusive ?? start })
      } else {
        setPendingRange(undefined)
      }
    }
    setCalendarOpen(open)
  }

  // Draft selection handler. We DO NOT auto-commit; the user clicks
  // Apply (or a preset, which commits directly).
  const handleRangeSelect = (range: DateRange | undefined) => {
    setPendingRange(range)
  }

  // Commit the current draft to the global historicalRange.
  const applyPendingRange = () => {
    if (!pendingRange?.from) return
    const start = pendingRange.from
    // If the user only picked one day, treat it as a single-day range.
    const endInclusive = pendingRange.to ?? pendingRange.from
    // Internal representation is [start, end-exclusive).
    const endExclusive = addDays(endInclusive, 1)
    setHistoricalRange({
      dayStart: toOperatingDayRange(start).dayStart,
      dayEnd: toOperatingDayRange(endExclusive).dayStart,
    })
    setCalendarOpen(false)
    setPendingRange(undefined)
    setDataSource("historical")
  }

  const clearPendingRange = () => setPendingRange(undefined)

  // Apply a preset range (start and end inclusive)
  const applyRangePreset = (start: Date, endInclusive: Date, switchToHistorical = true) => {
    const endExclusive = addDays(endInclusive, 1)
    setHistoricalRange({
      dayStart: toOperatingDayRange(start).dayStart,
      dayEnd: toOperatingDayRange(endExclusive).dayStart,
    })
    setCalendarOpen(false)
    setPendingRange(undefined)
    if (switchToHistorical) setDataSource("historical")
  }

  // Quick presets for date ranges
  const today = new Date()
  const presets: { label: string; run: () => void }[] = [
    {
      label: "Today",
      run: () => {
        setHistoricalRange(getTodayOperatingDayRange())
        setCalendarOpen(false)
        setDataSource("live")
      },
    },
    { label: "Yesterday", run: () => applyRangePreset(subDays(today, 1), subDays(today, 1)) },
    { label: "Last 7 days", run: () => applyRangePreset(subDays(today, 6), today) },
    { label: "Last 30 days", run: () => applyRangePreset(subDays(today, 29), today) },
    { label: "This week", run: () => applyRangePreset(startOfWeek(today, { weekStartsOn: 1 }), today) },
    { label: "This month", run: () => applyRangePreset(startOfMonth(today), today) },
    { label: "Last month", run: () => {
      const lastMonthEnd = endOfMonth(subDays(startOfMonth(today), 1))
      const lastMonthStart = startOfMonth(lastMonthEnd)
      applyRangePreset(lastMonthStart, lastMonthEnd)
    } },
  ]

  return (
    <div className="flex items-center gap-1.5 rounded-lg border bg-background p-1">
      {/* Mode tabs — only render if at least 2 modes are visible */}
      {hiddenModes.length < 2 && (
        <Tabs
          value={dataSource === "live" ? "live" : "historical"}
          onValueChange={handleModeChange}
          className="h-8"
        >
          <TabsList className="h-8 p-0.5">
            {!hiddenModes.includes("live") && (
              <TabsTrigger value="live" className="h-7 gap-1.5 px-3 text-xs">
                <Radio className="size-3" />
                <span className="hidden sm:inline">Today</span>
                {dataSource === "live" && liveStatus === "connected" && (
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                  </span>
                )}
                {dataSource === "live" && liveStatus === "loading" && (
                  <Loader2 className="size-3 animate-spin" />
                )}
                {dataSource === "live" && liveStatus === "error" && (
                  <AlertCircle className="size-3 text-destructive" />
                )}
              </TabsTrigger>
            )}
            {!hiddenModes.includes("historical") && (
              <TabsTrigger value="historical" className="h-7 gap-1.5 px-3 text-xs">
                <History className="size-3" />
                <span className="hidden sm:inline">Historical</span>
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
      )}

      {/* Date range picker — hidden for live-only pages */}
      {!hideDatePicker && (
      <div className="flex items-center gap-0.5">
        {/* Previous day(s) button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => navigateDays("prev")}
          disabled={dataSource === "live"}
        >
          <ChevronLeft className="size-4" />
          <span className="sr-only">Previous</span>
        </Button>

        {/* Date range display / picker trigger */}
        <Popover open={calendarOpen} onOpenChange={openCalendar}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 gap-1.5 px-2 text-xs font-mono",
                dataSource === "live" && "text-emerald-600"
              )}
            >
              <CalendarDays className="size-3.5" />
              {dataSource === "live" ? (
                <span>
                  Today {format(new Date(), "MMM d")}
                </span>
              ) : currentHistoricalDate ? (
                rangeDays > 1 ? (
                  <span>
                    {format(currentHistoricalDate, "MMM d")} 06:00 → {format(addDays(currentHistoricalDate, rangeDays), "MMM d")} 06:00
                  </span>
                ) : (
                  <span>
                    {format(currentHistoricalDate, "MMM d")} 06:00 → {format(addDays(currentHistoricalDate, 1), "MMM d")} 06:00
                  </span>
                )
              ) : (
                <span>Select operating day</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex">
              {/* Quick presets */}
              <div className="border-r p-2 space-y-1 min-w-[140px]">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
                  Quick ranges
                </div>
                <div className="text-[9px] text-muted-foreground px-2 pb-1 border-b mb-1">
                  06:00 → 06:00 next day
                </div>
                {presets.map((preset) => (
                  <Button
                    key={preset.label}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start h-8 text-xs"
                    onClick={preset.run}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              {/* Calendar with explicit Start/End summary + Apply */}
              <div className="p-3 flex flex-col gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Select date range
                  </div>
                  <div className="text-[9px] text-muted-foreground mb-1">
                    Click a start date, then an end date. Each day runs
                    06:00 → 06:00 (24h operating window).
                  </div>
                </div>

                {/* Live Start / End summary so the user always knows
                    what they're about to apply. The two pill values are
                    the source of truth — the calendar below just edits
                    them. */}
                <div className="flex items-center gap-2 text-xs">
                  <div className="flex flex-col items-start">
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                      Start
                    </span>
                    <span
                      className={cn(
                        "font-mono tabular-nums px-2 py-0.5 rounded border",
                        pendingRange?.from
                          ? "border-foreground/20 bg-muted/40 text-foreground"
                          : "border-dashed border-muted-foreground/40 text-muted-foreground"
                      )}
                    >
                      {pendingRange?.from
                        ? format(pendingRange.from, "MMM d, yyyy")
                        : "—"}
                    </span>
                  </div>
                  <span className="text-muted-foreground">→</span>
                  <div className="flex flex-col items-start">
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                      End
                    </span>
                    <span
                      className={cn(
                        "font-mono tabular-nums px-2 py-0.5 rounded border",
                        pendingRange?.to
                          ? "border-foreground/20 bg-muted/40 text-foreground"
                          : "border-dashed border-muted-foreground/40 text-muted-foreground"
                      )}
                    >
                      {pendingRange?.to
                        ? format(pendingRange.to, "MMM d, yyyy")
                        : pendingRange?.from
                          ? "click end date"
                          : "—"}
                    </span>
                  </div>
                  <div className="ml-auto text-[10px] text-muted-foreground">
                    {pendingRange?.from && pendingRange?.to ? (
                      <>
                        {Math.max(
                          1,
                          Math.round(
                            (pendingRange.to.getTime() -
                              pendingRange.from.getTime()) /
                              (24 * 60 * 60 * 1000),
                          ) + 1,
                        )}{" "}
                        day(s)
                      </>
                    ) : null}
                  </div>
                </div>

                <Calendar
                  mode="range"
                  numberOfMonths={2}
                  selected={pendingRange}
                  onSelect={handleRangeSelect}
                  disabled={(date) => date > new Date()}
                  defaultMonth={pendingRange?.from ?? currentHistoricalDate ?? new Date()}
                  className="rounded-md"
                />

                {/* Apply / Cancel — explicit commit. Apply is disabled
                    until at least a start date is picked; an end-only
                    selection is impossible because the calendar always
                    sets `from` first. */}
                <div className="flex items-center justify-end gap-2 pt-1 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={clearPendingRange}
                    disabled={!pendingRange?.from}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      setCalendarOpen(false)
                      setPendingRange(undefined)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={applyPendingRange}
                    disabled={!pendingRange?.from}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Next day(s) button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => navigateDays("next")}
          disabled={dataSource === "live"}
        >
          <ChevronRight className="size-4" />
          <span className="sr-only">Next</span>
        </Button>
      </div>
      )}

      {/* Compact historical status - full controls in HistoricalReplayPanel */}
      {dataSource === "historical" && (
        <div className="flex items-center gap-2 border-l pl-2 ml-1">
          {historical.isLoading ? (
            <Badge variant="outline" className="h-6 text-[10px] text-muted-foreground gap-1">
              <Loader2 className="size-3 animate-spin" />
              Loading...
            </Badge>
          ) : historical.telemetry.error ? (
            <Badge variant="outline" className="h-6 text-[10px] text-destructive border-destructive/40">
              Error
            </Badge>
          ) : historical.telemetry.frames.length > 0 ? (
            <Badge
              variant="outline"
              className={cn(
                "h-6 text-[10px] font-mono tabular-nums gap-1.5",
                historical.telemetry.playback.isPlaying
                  ? "border-emerald-500/40 text-emerald-600"
                  : "border-muted-foreground/40"
              )}
            >
              {historical.telemetry.playback.isPlaying ? (
                <Play className="size-3" />
              ) : (
                <Pause className="size-3" />
              )}
              {historical.telemetry.playback.currentIndex + 1}/{historical.telemetry.frames.length}
            </Badge>
          ) : (
            <Badge variant="outline" className="h-6 text-[10px] text-muted-foreground">
              No data
            </Badge>
          )}
        </div>
      )}

      {/* Live status */}
      {dataSource === "live" && !live.error && live.rawFrame && (
        <Badge variant="outline" className="h-6 gap-1 text-[10px] font-mono border-emerald-500/40 text-emerald-600">
          <span className="text-muted-foreground">Age:</span>
          {(live.ageMs / 1000).toFixed(0)}s
        </Badge>
      )}

      {/* Station selection intentionally NOT here: the global sidebar
          station switcher (registry-driven) is the single source of truth.
          A hardcoded per-page selector used to live here and drifted stale
          (it listed stations that no longer exist), fighting the global
          switcher — removed Aug 21 2026. */}
    </div>
  )
}
