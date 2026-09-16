"use client"

import { Building2, MapPin, Radio, Zap, Loader2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { LabelHint } from "@/components/prototype/info-hint"
import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import { useStationConfig } from "@/lib/use-live-telemetry"
import { type TelemetryFrame, formatCapKW } from "@/lib/prototype-telemetry"

interface Props {
  frame: TelemetryFrame
}

/**
 * Pilot-site identity strip.
 *
 * Shown above the live monitoring widgets so users always know which
 * physical ChargePost they are looking at. Fetches station config from
 * the Amperio API and displays the real station ID, site ID, and
 * hardware configuration.
 */
export function SiteContextHeader({ frame }: Props) {
  const { stationId, dataSource } = usePrototypeTelemetryContext()
  const { config, isLoading: configLoading } = useStationConfig({
    stationId,
    enabled: dataSource !== "simulated",
  })

  // Use API config when available, fall back to static data for simulated mode
  const site = config
    ? {
        name: formatStationName(config.station_id),
        address: "Pilot Installation",
        city: config.site_id,
        country: "Germany",
        stationId: config.station_id,
        siteId: config.site_id,
        middlewareVersion: config.middleware_version,
        firstSeenAt: config.first_seen_at,
        batteryUnits: config.battery_units,
        chargerUnits: config.charger_units,
        biddingZone: "DE-LU",
      }
    : PILOT_SITE

  // Exact, never rounded UP: Math.round turned Gifhorn's real 86.6 kW register
  // clearance into an "87 kW" chip, so a genuine 86.9 kW draw read as if it
  // were still inside the envelope.
  const importLimitKW = formatCapKW(frame.station.P_grid_consumption_limit_w, {
    unit: false,
  })
  const exportLimitKW = formatCapKW(frame.station.P_grid_generation_limit_w, {
    unit: false,
  })

  return (
    <Card className="overflow-hidden border-l-4 border-l-primary/70">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-6">
        {/* Identity */}
        <div className="flex shrink-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/20">
            <Building2 className="size-5" />
          </div>
          <div className="space-y-0.5 min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Pilot site
            </p>
            <p className="font-semibold leading-tight truncate">
              {site.name}
            </p>
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5 leading-tight">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">
                {site.address} &middot; {site.city}, {site.country}
              </span>
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="hidden md:block h-12 w-px bg-border" />

        {/* Meta */}
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-xs md:flex md:flex-wrap md:items-center md:gap-6">
          <MetaItem
            icon={<Radio className="size-3.5" />}
            label={
              <LabelHint
                label="Station ID"
                hint="Stable identifier used by the dispatching API and middleware logs to route commands and telemetry to this physical site. API: GET /stations/:id/config → station_id"
              />
            }
            value={
              configLoading ? (
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
              ) : (
                <span className="font-mono text-foreground/90">
                  {site.stationId}
                </span>
              )
            }
          />
          <MetaItem
            label={
              <LabelHint
                label="Site ID"
                hint="Logical site grouping. Multiple stations can belong to the same site for aggregate reporting. API: GET /stations/:id/config → site_id"
              />
            }
            value={
              <span className="font-mono text-foreground/90">
                {site.siteId}
              </span>
            }
          />
          <MetaItem
            label={
              <LabelHint
                label="Hardware"
                hint="Number of battery and charger units connected to this station. API: GET /stations/:id/config → battery_units, charger_units"
              />
            }
            value={
              <span className="font-mono text-foreground/90">
                {site.batteryUnits?.length ?? 2}B / {site.chargerUnits?.length ?? 2}C
              </span>
            }
          />
          <MetaItem
            label={
              <LabelHint
                label="Bidding zone"
                hint="EPEX market bidding zone. Determines which intraday spot price applies to this site. (Static config, not from API)"
              />
            }
            value={
              <span className="font-mono text-foreground/90">
                {site.biddingZone}
              </span>
            }
          />
          <MetaItem
            icon={<Zap className="size-3.5" />}
            label={
              <LabelHint
                label="Envelope"
                hint="Hard import/export limits the dispatcher must respect at the PCC. Live values come from the station telemetry, not a static config. API: GET /telemetry/latest → station.p_grid_consumption_limit_w, station.p_grid_generation_limit_w"
              />
            }
            value={
              <span className="font-mono">
                <span className="text-emerald-600 dark:text-emerald-500">
                  {importLimitKW}
                </span>
                <span className="text-muted-foreground"> / </span>
                <span className="text-sky-600 dark:text-sky-500">
                  {exportLimitKW}
                </span>
                <span className="text-muted-foreground"> kW</span>
              </span>
            }
          />
        </div>
      </div>
    </Card>
  )
}

function MetaItem({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode
  label: React.ReactNode
  value: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert station_id like "chargepost_gronau_001" to "ChargePost Gronau 001" */
function formatStationName(stationId: string): string {
  return stationId
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

// ---------------------------------------------------------------------------
// Fallback for simulated mode when API config is not available
// ---------------------------------------------------------------------------
const PILOT_SITE = {
  name: "ChargePost Gronau (Simulated)",
  address: "Simulation Environment",
  city: "sim_site_001",
  country: "Germany",
  stationId: "chargepost_sim_001",
  siteId: "sim_site_001",
  middlewareVersion: "0.0.0-sim",
  firstSeenAt: null as string | null,
  batteryUnits: [1, 2] as number[],
  chargerUnits: [1, 2] as number[],
  biddingZone: "DE-LU",
}
