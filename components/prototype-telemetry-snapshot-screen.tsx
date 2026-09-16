"use client"

import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import { SiteContextHeader } from "@/components/prototype/site-context-header"
import { StationBanner } from "@/components/prototype/station-banner"
import { HeroKPIs } from "@/components/prototype/hero-kpis"
import { BirdEyeView } from "@/components/prototype/bird-eye-view"
import { SimControlWidget } from "@/components/prototype/sim-control-widget"
import {
  BatteryCard,
  ChargerCard,
  GridCard,
  StationCard,
} from "@/components/prototype/panel-cards"
import { TelemetryHealthWidget } from "@/components/prototype/telemetry-health-widget"
import { HistoricalReplayPanel } from "@/components/prototype/historical-replay-panel"
import { HistoricalStatsWidget } from "@/components/prototype/historical-stats-widget"
import { TelemetryLoader } from "@/components/prototype/telemetry-loader"
import { AlertCircle } from "lucide-react"

export function PrototypeTelemetrySnapshotScreen() {
  const { frame, dataSource, isLoading, live } = usePrototypeTelemetryContext()

  // Show loading state - for historical mode, the HistoricalReplayPanel shows its own fancy loader
  // For live/simulated, show a simple but polished loading indicator
  if (isLoading && !frame && dataSource !== "historical") {
    return <TelemetryLoader mode={dataSource} className="mt-4" />
  }

  // Show error state for live mode
  if (dataSource === "live" && live.error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 mt-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-medium text-destructive">
              Failed to connect to telemetry API
            </div>
            <div className="text-sm text-muted-foreground">
              {live.error.message}
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              Station: {live.stationId}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Fallback if still no frame - show polished loading state
  if (!frame) {
    return (
      <>
        {/* Only show SimControlWidget in simulated mode */}
        {dataSource === "simulated" && <SimControlWidget />}
        <TelemetryLoader mode={dataSource} className="mt-4" />
      </>
    )
  }

  return (
    <>
      {/* Simulation transport controls — only shown in simulated mode */}
      {dataSource === "simulated" && <SimControlWidget />}

      {/* Historical mode widgets — stats and data quality above player */}
      {dataSource === "historical" && (
        <>
          {/* Operating Day Summary — overview stats calculated from frames */}
          <HistoricalStatsWidget />
          {/* Replay Player — transport controls and progress */}
          <HistoricalReplayPanel />
        </>
      )}

      {/* Telemetry health/quality indicator — only for live mode */}
      {dataSource === "live" && <TelemetryHealthWidget />}

      <SiteContextHeader frame={frame} />
      <StationBanner frame={frame} />
      <HeroKPIs frame={frame} />
      <BirdEyeView frame={frame} />

      <div className="grid gap-4 lg:grid-cols-2">
        <GridCard frame={frame} />
        <StationCard frame={frame} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BatteryCard unit={frame.batteries[0]} />
        <BatteryCard unit={frame.batteries[1]} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChargerCard unit={frame.chargers[0]} />
        <ChargerCard unit={frame.chargers[1]} />
      </div>
    </>
  )
}
