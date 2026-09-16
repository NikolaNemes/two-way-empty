"use client"

import { useMemo } from "react"
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

/**
 * Month-grain period picker shared by Fleet Monthly (hist + live), Price
 * Analysis and Fleet Yearly (from–to). `YYYY-MM` strings in and out.
 *
 *   • one Select listing every month between `min` and `max` (newest first),
 *     with an optional per-month annotation ("— no data", "— 3 stations"),
 *   • ‹ › steppers for the very common "previous month" click,
 *   • `lastClosedMonth()` — the default period everywhere: the most recent
 *     month that is fully in the past.
 */

export function lastClosedMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return monthKey(d)
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export function monthLabel(m: string, style: "short" | "long" = "short"): string {
  const [y, mm] = m.split("-").map(Number)
  if (!y || !mm) return m
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-GB", {
    month: style,
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Inclusive ascending list of `YYYY-MM` between two keys. */
export function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number)
  const [ty, tm] = to.split("-").map(Number)
  if (!fy || !fm || !ty || !tm) return []
  const out: string[] = []
  let y = fy
  let m = fm
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

export function clampMonth(m: string, min: string, max: string): string {
  if (m < min) return min
  if (m > max) return max
  return m
}

export interface ReportMonthPickerProps {
  value: string
  onChange: (month: string) => void
  /** Earliest / latest selectable month (inclusive). */
  min: string
  max: string
  /** Optional suffix per month, e.g. "— no data". Return null for none. */
  annotate?: (month: string) => string | null
  /** Extra leading option, e.g. { value: "all", label: "Last 12 months" }. */
  extraOption?: { value: string; label: string }
  disabled?: boolean
  /** Hide the ‹ › steppers (e.g. inside a from–to pair). */
  steppers?: boolean
  className?: string
  /** Forwarded to the trigger so a <Label htmlFor> can target it. */
  id?: string
  "aria-label"?: string
}

export function ReportMonthPicker({
  value,
  onChange,
  min,
  max,
  annotate,
  extraOption,
  disabled = false,
  steppers = true,
  className,
  id,
  "aria-label": ariaLabel = "Report month",
}: ReportMonthPickerProps) {
  const monthsDesc = useMemo(() => monthsBetween(min, max).reverse(), [min, max])
  const idx = monthsDesc.indexOf(value)
  const canPrev = idx >= 0 && idx < monthsDesc.length - 1
  const canNext = idx > 0

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {steppers ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0 bg-transparent"
          disabled={disabled || !canPrev}
          onClick={() => onChange(monthsDesc[idx + 1])}
          aria-label="Previous month"
        >
          <ChevronLeft className="size-4" />
        </Button>
      ) : null}
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="h-9 w-44 gap-2" aria-label={ariaLabel}>
          <CalendarRange className="size-4 shrink-0 text-muted-foreground" />
          <SelectValue>
            {extraOption && value === extraOption.value ? extraOption.label : monthLabel(value)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {extraOption ? <SelectItem value={extraOption.value}>{extraOption.label}</SelectItem> : null}
          {monthsDesc.map((m) => {
            const note = annotate?.(m)
            return (
              <SelectItem key={m} value={m}>
                {monthLabel(m)}
                {note ? <span className="ml-1 text-muted-foreground">{note}</span> : null}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      {steppers ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0 bg-transparent"
          disabled={disabled || !canNext}
          onClick={() => onChange(monthsDesc[idx - 1])}
          aria-label="Next month"
        >
          <ChevronRight className="size-4" />
        </Button>
      ) : null}
    </div>
  )
}

/** From–to pair for the yearly reports. Keeps from ≤ to. */
export function ReportMonthRangePicker({
  from,
  to,
  onChange,
  min,
  max,
  disabled,
  className,
}: {
  from: string
  to: string
  onChange: (range: { from: string; to: string }) => void
  min: string
  max: string
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <ReportMonthPicker
        value={from}
        min={min}
        max={max}
        steppers={false}
        disabled={disabled}
        aria-label="From month"
        onChange={(m) => onChange({ from: m, to: m > to ? m : to })}
      />
      <span className="text-muted-foreground">→</span>
      <ReportMonthPicker
        value={to}
        min={min}
        max={max}
        steppers={false}
        disabled={disabled}
        aria-label="To month"
        onChange={(m) => onChange({ from: m < from ? m : from, to: m })}
      />
    </div>
  )
}
