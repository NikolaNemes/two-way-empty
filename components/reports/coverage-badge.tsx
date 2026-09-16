"use client"

/**
 * Telemetry-coverage indicator for a settled window — "days with data / days
 * in the window" — shown right next to the figures it qualifies.
 *
 * Why it exists (Aug 2026 fleet review): Gifhorn's August row was 12 of 31
 * days (commissioned 20 Aug) and Norderstedt lost 24–31 Aug to a 165-hour
 * telemetry outage (876 kWh charged in the blackout appear in neither import
 * nor EV), yet Fleet Monthly presented both as ordinary full months. Euros and
 * volumes are settled on the covered days only and are NEVER scaled up, so a
 * partial window must be visible wherever the number is.
 *
 * Renders nothing when coverage is complete (the common case stays quiet);
 * an amber badge for a partial window; a muted "n/a" when the row predates
 * the coverage columns.
 */

import { AlertTriangle } from "lucide-react"
import { berlinMonthWindow } from "@/lib/report-window"

/**
 * Denominator for a month: the number of SETTLED Berlin days, i.e. the same
 * window the row was priced on. A closed month is its calendar length; a
 * RUNNING month is clipped at yesterday (Annex A8.1) — so on 4 Sep a fully
 * covered September reads 3/3 (quiet), not 3/30 (false alarm).
 */
export function settledDaysInMonth(month: string, now = new Date()): number {
  return berlinMonthWindow(month, now)?.days ?? 0
}

const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" }) : null

export function CoverageBadge({
  coveredDays,
  totalDays,
  month,
  dataFrom,
  dataThrough,
  className,
}: {
  coveredDays: number | null | undefined
  /** Denominator. Pass either `totalDays` directly or `month` ("YYYY-MM"). */
  totalDays?: number
  month?: string
  dataFrom?: string | null
  dataThrough?: string | null
  className?: string
}) {
  const denom = totalDays ?? (month ? settledDaysInMonth(month) : null)
  if (coveredDays == null || denom == null || denom <= 0) return null
  if (coveredDays >= denom) return null

  const from = fmtDay(dataFrom ?? null)
  const through = fmtDay(dataThrough ?? null)
  const range = from && through ? ` (${from}–${through})` : ""
  const missing = denom - coveredDays

  return (
    <span
      className={`mt-1 inline-flex items-center gap-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-amber-700 dark:text-amber-400 ${className ?? ""}`}
      title={`Partial window: telemetry on ${coveredDays} of ${denom} days${range}. ${missing} day${missing === 1 ? "" : "s"} without data — volumes and euros cover the measured days only and are not scaled up.`}
    >
      <AlertTriangle className="size-3" aria-hidden />
      <span className="tabular-nums">
        {coveredDays}/{denom} days
      </span>
      <span className="sr-only">
        {" "}
        with telemetry — partial window, figures are not scaled to a full period
      </span>
    </span>
  )
}
