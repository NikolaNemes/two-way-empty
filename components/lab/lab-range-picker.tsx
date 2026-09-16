"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  endOfMonth,
  format,
  isValid,
  parse,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns"
import type { DateRange } from "react-day-picker"
import { CalendarRange, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * Shared, canonical date-range picker for the whole app.
 *
 * A compact popover trigger opens a two-month range calendar with:
 *   • calendar-aware quick ranges (Today, This week, This month, Last month …)
 *     that highlight when the current draft matches them,
 *   • typeable ISO Start / End fields (keyboard-first, clamped to bounds),
 *   • a live day-count, and full keyboard navigation from react-day-picker.
 *
 * Dates are exchanged with the host screen as plain `YYYY-MM-DD` strings
 * (the `to` value is inclusive), matching existing screen state so the
 * surrounding query logic is untouched.
 */

const ISO = "yyyy-MM-dd"

function parseIso(value: string): Date | undefined {
  const d = parse(value, ISO, new Date())
  return isValid(d) ? d : undefined
}

function isoEq(a: Date | undefined, b: Date | undefined): boolean {
  if (!a || !b) return false
  return format(a, ISO) === format(b, ISO)
}

function clamp(date: Date, min: Date | undefined, max: Date): Date {
  if (date > max) return max
  if (min && date < min) return min
  return date
}

type Preset = {
  label: RangePresetLabel
  description: string
  /** Compute the inclusive range relative to `today`. */
  range: (today: Date) => DateRange
}

export type RangePresetLabel =
  | "Today"
  | "Yesterday"
  | "Last 7 days"
  | "Last 14 days"
  | "Last 30 days"
  | "This week"
  | "This month"
  | "Last month"

const PRESETS: Preset[] = [
  { label: "Today", description: "Single day", range: (t) => ({ from: t, to: t }) },
  {
    label: "Yesterday",
    description: "Single day",
    range: (t) => ({ from: subDays(t, 1), to: subDays(t, 1) }),
  },
  {
    label: "Last 7 days",
    description: "Week-over-week",
    range: (t) => ({ from: subDays(t, 6), to: t }),
  },
  {
    label: "Last 14 days",
    description: "Two-week trend",
    range: (t) => ({ from: subDays(t, 13), to: t }),
  },
  {
    label: "Last 30 days",
    description: "Monthly view",
    range: (t) => ({ from: subDays(t, 29), to: t }),
  },
  {
    label: "This week",
    description: "Mon → today",
    range: (t) => ({ from: startOfWeek(t, { weekStartsOn: 1 }), to: t }),
  },
  {
    label: "This month",
    description: "1st → today",
    range: (t) => ({ from: startOfMonth(t), to: t }),
  },
  {
    label: "Last month",
    description: "Full calendar month",
    range: (t) => ({ from: startOfMonth(subMonths(t, 1)), to: endOfMonth(subMonths(t, 1)) }),
  },
]

export interface LabRangePickerProps {
  /** Inclusive start day, `YYYY-MM-DD`. */
  from: string
  /** Inclusive end day, `YYYY-MM-DD`. */
  to: string
  /** Commit handler — fired on Apply / preset with inclusive day strings. */
  onApply: (from: string, to: string) => void
  /** Disable interaction (e.g. while a query is running). */
  disabled?: boolean
  /** Latest selectable day; defaults to today. */
  maxDate?: Date
  /** Earliest selectable day; optional lower bound. */
  minDate?: Date
  /** Popover alignment. */
  align?: "start" | "center" | "end"
  /** Restrict the quick-range list (default: all). Order follows PRESETS. */
  presets?: readonly RangePresetLabel[]
  /** Label for the commit button (default "Apply"; reports use "Run"). */
  applyLabel?: string
  className?: string
}

export function LabRangePicker({
  from,
  to,
  onApply,
  disabled = false,
  maxDate,
  minDate,
  align = "start",
  presets,
  applyLabel = "Apply",
  className,
}: LabRangePickerProps) {
  const visiblePresets = useMemo(
    () => (presets ? PRESETS.filter((p) => presets.includes(p.label)) : PRESETS),
    [presets],
  )
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => new Date())

  const committed = useMemo<DateRange | undefined>(() => {
    const f = parseIso(from)
    const t = parseIso(to)
    if (!f) return undefined
    return { from: f, to: t ?? f }
  }, [from, to])

  const upperBound = maxDate ?? new Date()

  // Seed the draft from the committed range whenever the popover opens
  // so the user can see and revise what's currently applied.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setDraft(committed)
      setVisibleMonth(startOfMonth(committed?.from ?? subMonths(upperBound, 1)))
    }
    setOpen(next)
  }

  const applyPreset = (preset: Preset) => {
    const range = preset.range(upperBound)
    const nextFrom = range.from ? clamp(range.from, minDate, upperBound) : undefined
    const nextTo = range.to ? clamp(range.to, minDate, upperBound) : nextFrom
    setDraft({ from: nextFrom, to: nextTo })
    if (nextFrom) setVisibleMonth(startOfMonth(nextFrom))
  }

  const activePreset = useMemo(() => {
    if (!draft?.from) return null
    return (
      PRESETS.find((p) => {
        const r = p.range(upperBound)
        return isoEq(r.from, draft.from) && isoEq(r.to ?? r.from, draft.to ?? draft.from)
      })?.label ?? null
    )
  }, [draft, upperBound])

  const dayCount =
    draft?.from && draft?.to
      ? Math.max(
          1,
          Math.round((draft.to.getTime() - draft.from.getTime()) / 86_400_000) + 1,
        )
      : draft?.from
        ? 1
        : 0

  const handleApply = () => {
    if (!draft?.from) return
    const f = draft.from
    const t = draft.to ?? draft.from
    onApply(format(f, ISO), format(t, ISO))
    setOpen(false)
  }

  const triggerLabel = committed?.from ? (
    <span className="font-mono tabular-nums">
      {format(committed.from, "MMM d, yyyy")}
      {committed.to && committed.to.getTime() !== committed.from.getTime()
        ? ` → ${format(committed.to, "MMM d, yyyy")}`
        : ""}
    </span>
  ) : (
    <span className="text-muted-foreground">Select date range</span>
  )

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn("h-9 w-full justify-start gap-2 px-3 text-sm font-normal", className)}
        >
          <CalendarRange className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <div className="flex flex-col sm:flex-row">
          {/* Quick presets */}
          <div className="border-b p-2 sm:w-44 sm:shrink-0 sm:border-b-0 sm:border-r">
            <div className="mb-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Quick ranges
            </div>
            <div className="flex flex-col gap-0.5">
              {visiblePresets.map((p) => {
                const active = activePreset === p.label
                return (
                  <Button
                    key={p.label}
                    variant={active ? "secondary" : "ghost"}
                    size="sm"
                    className="h-auto justify-start px-2 py-1.5 text-left"
                    onClick={() => applyPreset(p)}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="flex flex-col items-start">
                        <span className="text-xs font-medium">{p.label}</span>
                        <span className="text-[10px] text-muted-foreground">{p.description}</span>
                      </span>
                      {active ? <Check className="ml-auto size-3.5 text-foreground" /> : null}
                    </span>
                  </Button>
                )
              })}
            </div>
          </div>

          {/* Calendar + typeable fields + apply */}
          <div className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <DateField
                label="Start"
                value={draft?.from}
                min={minDate}
                max={upperBound}
                onCommit={(d) =>
                  setDraft((prev) => {
                    const end = prev?.to
                    if (end && d > end) return { from: end, to: d }
                    return { from: d, to: end }
                  })
                }
              />
              <span className="pb-1.5 text-muted-foreground">→</span>
              <DateField
                label="End"
                value={draft?.to}
                min={draft?.from ?? minDate}
                max={upperBound}
                placeholder={draft?.from ? "click end date" : undefined}
                onCommit={(d) =>
                  setDraft((prev) => {
                    const start = prev?.from
                    if (start && d < start) return { from: d, to: start }
                    return { from: start ?? d, to: d }
                  })
                }
              />
              {dayCount > 0 ? (
                <span className="ml-auto pb-1.5 text-xs tabular-nums text-muted-foreground">
                  {dayCount} day{dayCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>

            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draft}
              onSelect={setDraft}
              disabled={(date) => date > upperBound || (minDate ? date < minDate : false)}
              month={visibleMonth}
              onMonthChange={setVisibleMonth}
              startMonth={minDate ? startOfMonth(minDate) : undefined}
              endMonth={startOfMonth(upperBound)}
              className="rounded-md"
            />

            <div className="flex items-center justify-end gap-2 border-t pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setDraft(undefined)}
                disabled={!draft?.from}
              >
                Clear
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setDraft(committed)
                  setOpen(false)
                }}
              >
                Cancel
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={handleApply} disabled={!draft?.from}>
                {applyLabel}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Keyboard-first ISO date field. Shows the selected day and lets the user type
 * a `YYYY-MM-DD` value; commits on Enter/blur only when the parse is valid and
 * inside the allowed bounds, otherwise it snaps back to the current value.
 */
function DateField({
  label,
  value,
  min,
  max,
  placeholder,
  onCommit,
}: {
  label: string
  value: Date | undefined
  min?: Date
  max: Date
  placeholder?: string
  onCommit: (date: Date) => void
}) {
  const [text, setText] = useState("")
  const focused = useRef(false)

  // Keep the field in sync with the selected value while it isn't being edited.
  useEffect(() => {
    if (!focused.current) setText(value ? format(value, ISO) : "")
  }, [value])

  const commit = () => {
    const parsed = parseIso(text.trim())
    if (parsed && parsed <= max && (!min || parsed >= min)) {
      onCommit(parsed)
      setText(format(parsed, ISO))
    } else {
      setText(value ? format(value, ISO) : "")
    }
  }

  return (
    <label className="flex flex-col items-start gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <Input
        inputMode="numeric"
        value={text}
        placeholder={placeholder ?? "YYYY-MM-DD"}
        onFocus={() => {
          focused.current = true
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false
          commit()
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          }
        }}
        className="h-7 w-[7.5rem] px-2 font-mono text-xs tabular-nums"
      />
    </label>
  )
}
