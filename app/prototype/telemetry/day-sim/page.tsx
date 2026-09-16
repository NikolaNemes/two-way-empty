"use client"

import { useEffect, useState } from "react"
import { ActualVsOptimisedCard } from "@/components/prototype/actual-vs-optimised-card"

// How often the live timeline re-runs the backtest to pull new frames.
const LIVE_REFRESH_MS = 60_000

/**
 * Live "Today" dispatching timeline route.
 *
 * The v5 MPC is now in production, so the metered telemetry IS the optimiser's
 * behaviour — there's no point overlaying a counterfactual against it here.
 * This renders ActualVsOptimisedCard in its "telemetry" variant: the card pulls
 * today's real (LIVE) frames via the Neon backtest action and shows pure
 * metered evidence — measured pack SOC, grid import, EV delivered, and grid-cap
 * breaches — with the optimised overlays and savings KPIs dropped. The
 * historical Data Analysis page keeps the counterfactual variant.
 */
function localMidnightToday(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export default function PrototypeDaySimPage() {
  // Today's calendar day, local midnight. The card re-anchors to a UTC
  // calendar-day window internally (same convention as the Backtest Lab).
  const [day, setDay] = useState<Date>(() => localMidnightToday())

  // Keep "today" honest across a midnight rollover: check periodically and
  // advance the window when the calendar day changes. Changing the Date prop
  // makes the card reload for the new day. (A stable ref-equal Date is kept
  // while the day is unchanged so we don't trigger needless reloads.)
  useEffect(() => {
    const id = setInterval(() => {
      setDay((prev) => {
        const today = localMidnightToday()
        return today.getTime() === prev.getTime() ? prev : today
      })
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <ActualVsOptimisedCard
        from={day}
        to={day}
        variant="telemetry"
        refreshMs={LIVE_REFRESH_MS}
      />
    </div>
  )
}
