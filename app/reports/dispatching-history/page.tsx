"use client"

import { useCallback, useRef, useState } from "react"
import { History } from "lucide-react"
import { ActualVsOptimisedCard } from "@/components/prototype/actual-vs-optimised-card"
import { ExportExcelButton } from "@/components/reports/export-excel-button"
import { ReportPeriodHeader, ReportNotRun, type ReportRange } from "@/components/reports/report-range-picker"

/**
 * Dispatching History — the SAME view as Live Dispatching, only for a
 * historical window the user picks.
 *
 * Live Dispatching renders `ActualVsOptimisedCard` in its "telemetry" variant
 * anchored to "today". This screen reuses that exact card (identical KPIs and
 * visualisations) over the selected period. The period strip is the shared
 * report header (period always printed, `ReportRangePicker` with the common
 * presets, `ExportExcelButton` top-right) — identical to Financial Breakdown.
 * The report renders immediately for the default period (yesterday, the last
 * closed operating day); "Run" in the picker swaps the period in place.
 */
export default function DispatchingHistoryPage() {
  // CONFIGURE-FIRST (client feedback sep 3 2026): no period is selected on
  // load; the replay runs only after the user picks one and presses Run.
  const [range, setRange] = useState<ReportRange>(null)

  // The card owns the data; it hands us an export action once a result is on
  // screen (null while loading/empty). Kept in a ref so re-registration on
  // every card render never re-renders the page.
  const exportRef = useRef<(() => Promise<void>) | null>(null)
  const [exportReady, setExportReady] = useState(false)
  const registerExport = useCallback((fn: (() => Promise<void>) | null) => {
    exportRef.current = fn
    setExportReady(fn != null)
  }, [])

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-6 lg:px-6">
      <PageIntro />
      <ReportPeriodHeader
        range={range}
        onRun={setRange}
        actions={
          <ExportExcelButton
            disabled={!exportReady}
            onExport={async () => {
              await exportRef.current?.()
            }}
          />
        }
      />
      {/* Same card + variant as Live Dispatching — identical UI & charts — but
          live={false} so the chart spans the WHOLE selected range (multi-day
          curves + dated axis) instead of pinning to a single 24h "today". */}
      {range ? (
        <ActualVsOptimisedCard
          from={range.from}
          to={range.to}
          variant="telemetry"
          live={false}
          registerExport={registerExport}
        />
      ) : (
        <ReportNotRun what="The replay compares what the station actually did with the optimised dispatch for exactly those days." />
      )}
    </div>
  )
}

function PageIntro() {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10">
        <History className="size-5 text-rose-600" />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Dispatching History</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The same live dispatching view, replayed over a historical window. The page shows the
          metered evidence for the selected days — measured pack SOC, grid import, EV delivered
          (C1+C2), AUX and grid-cap breaches — with the exact KPIs and charts from Live Dispatching.
        </p>
      </div>
    </div>
  )
}
