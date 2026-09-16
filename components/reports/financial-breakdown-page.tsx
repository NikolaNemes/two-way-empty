"use client"

import { useCallback, useRef, useState } from "react"
import { Receipt } from "lucide-react"
import { TariffComparisonReport } from "@/components/reports/tariff-comparison-report"
import { ExportExcelButton } from "@/components/reports/export-excel-button"
import {
  ReportPeriodHeader,
  ReportNotRun,
  fromDay,
  type ReportRange,
} from "@/components/reports/report-range-picker"

/**
 * Financial Breakdown — prices the metered grid import over a chosen window two
 * ways and compares them: a German FLAT rate (default 12.5 ct/kWh) vs a DYNAMIC
 * tariff indexed to the IDM intraday price, net of battery wear (Annex A5/A6).
 *
 * Same shell as Dispatching History: the shared period header (`ReportRangePicker`
 * presets + Run, `ExportExcelButton` top-right). CONFIGURE-FIRST: nothing runs
 * until the user picks a period and presses Run (client feedback sep 3 2026 —
 * auto-running "yesterday" took the choice away). Run swaps the period in place.
 *
 * DEEP LINK: `?from=yyyy-mm-dd&to=yyyy-mm-dd` (plus `?stationId=` handled by the
 * station context) pre-commits the period and runs — that is how a Fleet
 * Monthly row opens "its" Financial Report so the two can be compared side by
 * side. An explicit link IS the user's choice, so configure-first is honoured.
 */
export function FinancialBreakdownPage({ initialFrom, initialTo }: { initialFrom?: string; initialTo?: string }) {
  const [range, setRange] = useState<ReportRange>(() => {
    const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
    if (ok(initialFrom) && ok(initialTo) && initialFrom! <= initialTo!) {
      return { from: fromDay(initialFrom!), to: fromDay(initialTo!) }
    }
    return null
  })

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
      {range ? (
        <TariffComparisonReport from={range.from} to={range.to} registerExport={registerExport} />
      ) : (
        <ReportNotRun what="The report prices the metered grid import for exactly those days under the flat and the dynamic tariff." />
      )}
    </div>
  )
}

function PageIntro() {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10">
        <Receipt className="size-5 text-rose-600" />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Financial Report</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Price the metered grid import over the selected period and compare what it would cost on a
          German flat rate (12.5 ct/kWh) versus a dynamic tariff indexed to the IDM intraday price.
          The report shows the cost under each tariff, the effective price per kWh, the battery wear
          the load shifting incurs, and the net total saving — every term as defined in the
          Settlement Methodology Annex. A calendar month here is the same computation as its Fleet
          Monthly row.
        </p>
      </div>
    </div>
  )
}
