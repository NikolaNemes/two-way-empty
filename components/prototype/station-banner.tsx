"use client"

import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { type TelemetryFrame, formatCapKW } from "@/lib/prototype-telemetry"
import { InfoHint, LabelHint } from "@/components/prototype/info-hint"

interface Props {
  frame: TelemetryFrame
}

export function StationBanner({ frame }: Props) {
  const hasError = frame.station.errors.length > 0
  const hasWarn = frame.station.warnings.length > 0

  const tone = hasError
    ? {
        border: "border-l-red-500",
        bg: "bg-red-500/5",
        Icon: XCircle,
        color: "text-red-500",
      }
    : hasWarn
      ? {
          border: "border-l-amber-500",
          bg: "bg-amber-500/5",
          Icon: AlertTriangle,
          color: "text-amber-500",
        }
      : {
          border: "border-l-emerald-500",
          bg: "bg-emerald-500/5",
          Icon: CheckCircle2,
          color: "text-emerald-500",
        }

  const Icon = tone.Icon
  const epex = frame.market.epex_price_eur_mwh
  const epexTone =
    epex > 110
      ? "text-red-500"
      : epex < 60
        ? "text-emerald-500"
        : "text-amber-500"

  const bannerNarrative = hasError
    ? "Station is reporting active errors — operation may be derated until cleared."
    : hasWarn
      ? "Operation is healthy but at least one warning is active. Check the alarms panel below."
      : "Station is healthy. All units in nominal envelope, no active warnings or errors."

  return (
    <Card className={`border-l-4 ${tone.border} ${tone.bg}`}>
      <CardContent className="py-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <Icon className={`size-5 shrink-0 mt-0.5 ${tone.color}`} />
            <div className="space-y-0.5">
              <p className="font-medium leading-tight inline-flex items-center gap-1.5">
                Station: {frame.station.operation_state}
                {hasError
                  ? " (errors active)"
                  : hasWarn
                    ? " (warnings active)"
                    : ""}
                <InfoHint>
                  <p className="font-medium mb-1">Station status banner</p>
                  <p>
                    A one-line health summary of the whole ChargePost. The
                    coloured stripe and icon match severity: green = healthy,
                    amber = warnings present, red = errors derating
                    operation. The right-hand strip shows the inputs Enexa is
                    optimising against right now.
                  </p>
                  <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                    API: GET /telemetry/latest<br />
                    Path: station.operation_state
                  </p>
                </InfoHint>
              </p>
              <p className="text-xs text-muted-foreground leading-snug text-pretty">
                {bannerNarrative}
              </p>
              <p className="text-xs text-muted-foreground">
                  <LabelHint
                  label="Grid envelope"
                  hint={
                    <>
                      <p className="font-medium mb-1">
                        Permitted grid window
                      </p>
                      <p>
                        Hard import / export limits the dispatcher must stay
                        within. Set by the grid operator and the connection contract.
                      </p>
                      <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                        API fields: station.p_grid_consumption_limit_w, station.p_grid_generation_limit_w
                      </p>
                    </>
                  }
                />
                :&nbsp;
                {formatCapKW(frame.station.P_grid_consumption_limit_w)} import /{" "}
                {formatCapKW(frame.station.P_grid_generation_limit_w)} export
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-stretch gap-3 md:gap-4 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                <LabelHint
                  label="EPEX"
                  hint={
                    <>
                      <p className="font-medium mb-1">EPEX spot price</p>
                      <p>
                        Cleared day-ahead price for the current 15-minute slot
                        in €/MWh. The single most important arbitrage signal:
                        green &lt; 60, amber 60–110, red &gt; 110.
                      </p>
                      <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                        API: GET /telemetry/latest<br />
                        Path: prices.idm (fallback: prices.dam)
                      </p>
                    </>
                  }
                />
              </p>
              <p className={`font-mono font-semibold ${epexTone}`}>
                {epex.toFixed(1)}{" "}
                <span className="text-xs font-normal">€/MWh</span>
              </p>
            </div>
            <Separator orientation="vertical" className="h-9 hidden md:block" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <LabelHint
                  label="Slot"
                  hint="Active 15-minute EPEX settlement slot (HH:MM). API field: prices.bucket_ts (converted to Europe/Berlin time)"
                />
              </p>
              <p className="font-mono">{frame.market.slot_label}</p>
            </div>
            <Separator orientation="vertical" className="h-9 hidden md:block" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <LabelHint
                  label="Grid f"
                  hint={
                    <>
                      <p className="font-medium mb-1">Grid frequency</p>
                      <p>
                        Measured AC frequency at the PCC. Nominal 50 Hz; large
                        excursions indicate grid stress and could trigger
                        primary-response actions on a frequency-aware site.
                      </p>
                      <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                        API field: grid.f_grid_hz
                      </p>
                    </>
                  }
                />
              </p>
              <p className="font-mono">
                {frame.grid.f_grid_hz.toFixed(2)}{" "}
                <span className="text-xs font-normal">Hz</span>
              </p>
            </div>
            <Separator orientation="vertical" className="h-9 hidden md:block" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <LabelHint
                  label="cos φ"
                  hint={
                    <>
                      <p className="font-medium mb-1">Power factor</p>
                      <p>
                        Ratio of real to apparent power at the PCC. Close to
                        1.000 means almost purely real power; lower values
                        mean significant reactive power, which most contracts
                        penalise.
                      </p>
                      <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                        API field: grid.cos_phi
                      </p>
                    </>
                  }
                />
              </p>
              <p className="font-mono">{frame.grid.cos_phi.toFixed(3)}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
