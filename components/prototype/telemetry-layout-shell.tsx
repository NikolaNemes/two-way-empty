"use client"

import { usePathname } from "next/navigation"
import { Activity, AlertTriangle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import { type DataSourceMode } from "@/lib/prototype-telemetry-context"
import { DataSourceSwitcher } from "@/components/prototype/data-source-switcher"

// Route-based mode restrictions — each page can lock to a specific mode
// by hiding the other tabs from the DataSourceSwitcher.
const ROUTE_HIDDEN_MODES: Record<string, DataSourceMode[]> = {
  "/prototype/telemetry": ["historical", "simulated"],            // Snapshot: Today only
  "/prototype/telemetry/day-sim": ["historical", "simulated"],    // Dispatching Timeline: Today only
  "/prototype/telemetry/commands": ["historical", "simulated"],   // Commands: Today only
  "/prototype/telemetry/data-analysis": ["live", "simulated"],    // Data Analysis: Historical only
}

// Routes that own their own range UI in the page body and therefore
// don't want the global DataSourceSwitcher pill in the page header.
// Data Analysis has its own Configure step + ReportHeader pill, so the
// header switcher would just be a duplicate control showing the same
// range twice (and a frame counter that's already implied by the
// loader card). Listing the route here removes the entire switcher
// for that page; the live-only routes (Snapshot, Dispatching Timeline,
// Commands) still get the switcher with `hideDatePicker` so users can
// flip data-source modes from the header.
const ROUTES_HIDE_SWITCHER = new Set([
  "/prototype/telemetry/data-analysis",
  // Live Dispatching locks to "today" with no date picker, so the switcher
  // rendered nothing but an age badge and a redundant station popover —
  // station selection lives in the global sidebar switcher.
  "/prototype/telemetry/day-sim",
])

// Routes where the date picker should be hidden (live-only pages that
// always show "today's operating day" - no need to select dates)
const ROUTES_HIDE_DATE_PICKER = new Set([
  "/prototype/telemetry",
  "/prototype/telemetry/day-sim",
  "/prototype/telemetry/commands",
])

export function TelemetryLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { frame } = usePrototypeTelemetryContext()

  const openIssues =
    (frame?.station.errors.length ?? 0) + (frame?.station.warnings.length ?? 0)

  // Determine which modes to hide based on current route
  const hiddenModes = ROUTE_HIDDEN_MODES[pathname] ?? []
  const hideDatePicker = ROUTES_HIDE_DATE_PICKER.has(pathname)
  const hideSwitcher = ROUTES_HIDE_SWITCHER.has(pathname)

  return (
    <div className="w-full py-6 px-4 md:py-8 md:px-6 space-y-5 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Activity className="size-7 text-emerald-500" />
          <h1 className="text-2xl font-bold tracking-tight">Telemetry</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Unified time period selector with mode toggle, date picker, and playback controls */}
          {!hideSwitcher && (
            <DataSourceSwitcher hiddenModes={hiddenModes} hideDatePicker={hideDatePicker} />
          )}

          {openIssues > 0 && (
            <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/40">
              <AlertTriangle className="size-3" />
              {openIssues} open
            </Badge>
          )}
        </div>
      </div>

      {/* Page content */}
      <div className="space-y-5">{children}</div>
    </div>
  )
}
