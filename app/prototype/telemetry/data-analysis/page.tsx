"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { format, subDays } from "date-fns"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import {
  DataAnalysisIntake,
  rangeToOperatingDayIso,
} from "@/components/prototype/data-analysis-intake"
import { ActualVsOptimisedCard } from "@/components/prototype/actual-vs-optimised-card"
import { beginReport } from "@/lib/report-progress"

/**
 * Data Analysis screen — three-state report flow.
 *
 * State machine:
 *
 *   "configure"  →  user picks a date range and clicks Run Report
 *   "loading"    →  historical frames are streaming from the API
 *   "report"     →  full dashboard renders
 *
 * The previous design auto-applied a default range on mount and kicked
 * straight into the dashboard. That hid the date selector behind the
 * data-source switcher in the page header, made it unclear whether
 * the screen had finished loading, and triggered surprise re-fetches
 * whenever the user changed the range. The explicit Run Report flow
 * makes the report-generation moment visible and predictable.
 */

type ReportState =
  | { kind: "configure" }
  | { kind: "loading"; from: Date; to: Date }
  | { kind: "report"; from: Date; to: Date }

// Initial draft range shown when the user first lands on the page.
// Yesterday (single operating day) is the most common starting point:
// fast to load, matches the "what happened last night" mental model,
// and the user can widen the range from the calendar or the Quick
// Ranges shortcuts before clicking Run Report.
function getInitialDraftRange() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = subDays(today, 1)
  return {
    from: yesterday,
    to: yesterday,
  }
}

export default function DataAnalysisPage() {
  const {
    dataSource,
    setDataSource,
    setHistoricalRange,
    historicalRange,
    isLoading: contextIsLoading,
    frameHistory,
  } = usePrototypeTelemetryContext()

  const [state, setState] = useState<ReportState>({ kind: "configure" })

  // Force historical mode the moment this page mounts so the global
  // data-source switcher in the header reflects it. We do this even
  // before the user clicks Run Report — picking historical mode here
  // does NOT auto-fetch frames (the historical hook is gated by
  // dataSource AND a non-empty range), but it ensures the header pill
  // and the dispatcher hook all agree on "we're in analysis mode".
  useEffect(() => {
    if (dataSource !== "historical") setDataSource("historical")
  }, [dataSource, setDataSource])

  // When the user clicks Run Report:
  //   1. Commit the picked range to the global historicalRange so the
  //      day-view hook starts fetching frames.
  //   2. Move to the "loading" state to render the spinner card.
  //   3. The effect below watches contextIsLoading + frameHistory and
  //      promotes us to "report" once frames are actually present.
  const handleRun = ({ from, to }: { from: Date; to: Date }) => {
    // Reset the progress timeline before kicking off the new fetch
    // pipeline. Cache layers (`frame-cache`, `sibling-cache`) emit
    // events as they walk the request graph; the loading screen
    // subscribes and renders them as a step-by-step feed so the user
    // can see exactly which day / endpoint is in flight, which days
    // came from cache, and how long each network call took.
    beginReport()
    setHistoricalRange(rangeToOperatingDayIso(from, to))
    setState({ kind: "loading", from, to })
  }

  // Promote loading → report once the historical pipeline has frames.
  // We require BOTH "context says it's no longer loading" AND "we have
  // at least one frame" — the SWR loading flag flips false briefly
  // between fetches even when frames haven't arrived yet, so checking
  // it alone would prematurely show an empty dashboard.
  //
  // useRef on the previous state kind avoids re-running this whenever
  // the user scrubs or playback advances within the report.
  const prevKindRef = useRef<ReportState["kind"]>("configure")
  useEffect(() => {
    if (state.kind === "loading" && !contextIsLoading && frameHistory.length > 0) {
      setState({ kind: "report", from: state.from, to: state.to })
    }
    prevKindRef.current = state.kind
  }, [state, contextIsLoading, frameHistory.length])

  // If the global historicalRange changes while we're already on the
  // report view (e.g. the user opened the header data-source picker
  // and applied a new preset), sync the local report state to the new
  // window and force the loader back on. Without this, the local
  // `state.from / state.to` would keep showing the old range in the
  // header even after the dashboard rebound to fresh data.
  useEffect(() => {
    if (state.kind === "configure") return
    const newFrom = new Date(historicalRange.dayStart)
    // The end-exclusive iso is one day past the displayed end day.
    const newToExclusive = new Date(historicalRange.dayEnd)
    const newToInclusive = subDays(newToExclusive, 1)
    if (
      newFrom.getTime() !== state.from.getTime() ||
      newToInclusive.getTime() !== state.to.getTime()
    ) {
      setState({ kind: "loading", from: newFrom, to: newToInclusive })
    }
  }, [historicalRange.dayStart, historicalRange.dayEnd, state])

  // Allow the user to go back to configure from the report header.
  const handleEditRange = () => {
    setState({ kind: "configure" })
  }

  const initialDraft = useMemo(() => getInitialDraftRange(), [])

  if (state.kind === "configure") {
    return <DataAnalysisIntake initialRange={initialDraft} onRun={handleRun} />
  }

  // ─── Report view ────────────────────────────────────────────────────
  //
  // The report is now driven ENTIRELY by the production optimizer via the
  // Neon backtest engine (`ActualVsOptimisedCard`), which runs its own
  // server action over the committed range — and transparently falls
  // back to LIVE-pulled frames for days that were never persisted. It no
  // longer depends on the client-side live-frame pipeline (that only fed
  // the retired heuristic), so we render the optimizer card immediately rather
  // than gating on `frameHistory`. The card shows its own spinner and an
  // explicit "Optimizer unavailable" state when the optimizer can't run — there
  // is deliberately no heuristic fallback.
  return (
    <div className="flex flex-col gap-4">
      <ReportHeader from={state.from} to={state.to} onEditRange={handleEditRange} />
      <ActualVsOptimisedCard from={state.from} to={state.to} />
    </div>
  )
}

/**
 * Strip across the top of the loading + report views. Shows the
 * confirmed range and an "Edit range" button that drops back into the
 * configure state. We disable the button while loading so the user
 * can't tear down a half-fetched window mid-flight (the spinner card
 * would still be in DOM but the historicalRange would already be
 * unset, leading to inconsistent state).
 */
function ReportHeader({
  from,
  to,
  onEditRange,
  editDisabled = false,
}: {
  from: Date
  to: Date
  onEditRange: () => void
  editDisabled?: boolean
}) {
  const dayCount =
    Math.max(
      1,
      Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1,
    )
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-4 py-2">
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Report range
        </span>
        <span className="text-sm font-medium tabular-nums">
          {format(from, "MMM d, yyyy")} → {format(to, "MMM d, yyyy")}
          <span className="ml-2 text-xs text-muted-foreground">
            ({dayCount} day{dayCount === 1 ? "" : "s"})
          </span>
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onEditRange}
        disabled={editDisabled}
        className="gap-2"
      >
        <ArrowLeft className="size-4" />
        Edit range
      </Button>
    </div>
  )
}
