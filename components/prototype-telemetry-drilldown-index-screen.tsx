"use client"

import Link from "next/link"
import {
  Battery,
  PlugZap,
  ArrowRight,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import { cn } from "@/lib/utils"
import { formatKW } from "@/lib/prototype-telemetry"

export function PrototypeTelemetryDrilldownIndexScreen() {
  const { frame } = usePrototypeTelemetryContext()

  if (!frame) {
    return (
      <p className="text-muted-foreground text-sm">
        Initialising telemetry stream…
      </p>
    )
  }

  return (
    <>
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground leading-relaxed text-pretty">
        Per-asset deep dives. Each card below opens a dedicated page with
        every field exposed by the v1 contract for that asset plus a small
        history sparkline and contactor-state log. Pick a battery to see
        SOC/SOH/temperature spread; pick a connector to see the session-level
        breakdown.
      </div>

      <section className="space-y-3">
        <SectionTitle icon={<Battery className="size-4 text-emerald-500" />} label="Stationary batteries" />
        <div className="grid gap-3 md:grid-cols-2">
          {frame.batteries.map((b) => {
            const charging = b.power_w > 200
            const discharging = b.power_w < -200
            return (
              <Link
                key={b.unit_id}
                href={`/prototype/telemetry/drill-down/battery/${b.unit_id}`}
                className="group"
              >
                <Card className="transition-colors group-hover:border-primary/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        Battery {b.unit_id}
                      </CardTitle>
                      <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <CardDescription className="text-xs">
                      225 kWh nominal &middot; 110 kW C-rate &middot;{" "}
                      <span className={cn(
                        charging && "text-emerald-600",
                        discharging && "text-amber-600"
                      )}>
                        {charging ? "charging" : discharging ? "discharging" : "idle"}
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-3 gap-3 text-xs">
                    <Stat label="SOC" value={`${b.soc_pct.toFixed(1)} %`} />
                    <Stat label="Power" value={formatKW(b.power_w, { signed: true })} />
                    <Stat label="Temp max" value={`${b.temp_max_c.toFixed(1)} °C`} />
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle icon={<PlugZap className="size-4 text-primary" />} label="EV connectors" />
        <div className="grid gap-3 md:grid-cols-2">
          {frame.chargers.map((c) => {
            const isPlugged = c.plug_state === "Plugged"
            return (
              <Link
                key={c.unit_id}
                href={`/prototype/telemetry/drill-down/connector/${c.unit_id}`}
                className="group"
              >
                <Card className="transition-colors group-hover:border-primary/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        Connector {c.unit_id}
                      </CardTitle>
                      <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <CardDescription className="text-xs flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono text-[10px]",
                          isPlugged
                            ? "border-emerald-500/40 text-emerald-600"
                            : "text-muted-foreground"
                        )}
                      >
                        {c.plug_state}
                      </Badge>
                      {c.charging_process_state}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-3 gap-3 text-xs">
                    <Stat label="Power" value={formatKW(c.P_EV_w)} />
                    <Stat
                      label="EV SOC"
                      value={isPlugged ? `${c.soc_EV_pct.toFixed(1)} %` : "—"}
                    />
                    <Stat label="Session" value={`${c.E_EV_chg_kwh.toFixed(1)} kWh`} />
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </section>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono tabular-nums">{value}</div>
    </div>
  )
}

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1.5">
      {icon}
      {label}
    </h2>
  )
}
