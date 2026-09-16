"use client"

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Battery,
  Cable,
  Zap,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { type TelemetryFrame, formatKW, formatCapKW } from "@/lib/prototype-telemetry"
import { InfoHint, LabelHint } from "@/components/prototype/info-hint"

interface Props {
  frame: TelemetryFrame
}


export function HeroKPIs({ frame }: Props) {
  // Grid: API convention is - import (consuming from grid), + export (pushing to grid)
  const P_grid = frame.grid.P_grid_w
  const importing = P_grid < -50
  const exporting = P_grid > 50

  // Total battery power (signed: + charging, - discharging)
  const P_bat_total = frame.batteries[0].power_w + frame.batteries[1].power_w
  const battCharging = P_bat_total > 50
  const battDischarging = P_bat_total < -50

  const avgSOC =
    (frame.batteries[0].soc_pct + frame.batteries[1].soc_pct) / 2

  const P_ev_total = frame.chargers[0].P_EV_w + frame.chargers[1].P_EV_w
  const activeConnectors = frame.chargers.filter(
    (c) => c.charging_state === "InProgress",
  ).length

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Grid */}
      <Card>
        <CardHeader className="pb-1.5 space-y-1">
          <CardTitle className="text-sm font-medium flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Zap
                className={`size-4 ${
                  exporting
                    ? "text-emerald-500"
                    : importing
                    ? "text-sky-500"
                    : "text-muted-foreground"
                }`}
              />
              Grid
            </span>
            <InfoHint>
              <p className="font-medium mb-1">Grid power flow</p>
              <p>
                Net power across the point of common coupling (PCC) right now.
                Sign convention: <strong>negative = importing</strong> from
                the utility, <strong>positive = exporting</strong> back. The
                value combines the consumption of the ChargePost (battery
                charging + EV delivery + auxiliaries) net of any battery
                export.
              </p>
              <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                API: GET /telemetry/latest<br />
                Field: grid.p_grid_w
              </p>
            </InfoHint>
          </CardTitle>
          <p className="text-[11px] text-muted-foreground leading-snug text-pretty">
            {importing
              ? "Pulling power from the utility — either to charge the battery, serve a car, or both."
              : exporting
                ? "Pushing power back to the utility — battery is discharging more than the site is consuming."
                : "Site is balanced: battery output matches local demand, no net flow on the grid wire."}
          </p>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span
              className={`text-3xl font-bold tabular-nums ${
                exporting
                  ? "text-emerald-500"
                  : importing
                  ? "text-sky-500"
                  : ""
              }`}
            >
              {formatKW(P_grid, { signed: false, digits: 1 })}
            </span>
            <span className="text-xs text-muted-foreground">
              {exporting ? "exporting" : importing ? "importing" : "idle"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            <LabelHint
              label="envelope"
              hint={
                <>
                  <p className="font-medium mb-1">Grid import limit</p>
                  <p>
                    The hard ceiling Enexa must keep the site under.
                    Approaching this triggers a clearance-protection re-solve.
                  </p>
                  <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                    API field: station.p_grid_consumption_limit_w
                  </p>
                </>
              }
            />{" "}
            {formatCapKW(frame.station.P_grid_consumption_limit_w)}
            {" "}&middot;{" "}
            <LabelHint
              label="aux"
              hint={
                <>
                  <p className="font-medium mb-1">Auxiliary load</p>
                  <p>
                    Cabinet electronics, cooling, lighting. Enexa subtracts
                    this from the available envelope before deciding
                    battery / EV setpoints.
                  </p>
                  <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                    API field: grid.p_aux_w
                  </p>
                </>
              }
            />{" "}
            {(frame.grid.P_aux_w / 1000).toFixed(1)} kW
          </p>
        </CardContent>
      </Card>

      {/* Batteries */}
      <Card>
        <CardHeader className="pb-1.5 space-y-1">
          <CardTitle className="text-sm font-medium flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              {battDischarging ? (
                <ArrowUpFromLine className="size-4 text-amber-500" />
              ) : battCharging ? (
                <ArrowDownToLine className="size-4 text-emerald-500" />
              ) : (
                <Battery className="size-4 text-muted-foreground" />
              )}
              Battery flow
            </span>
            <InfoHint>
              <p className="font-medium mb-1">Aggregate battery power</p>
              <p>
                Sum of the instantaneous power on both battery units. Sign
                convention: <strong>positive = charging</strong> (energy in),
                <strong> negative = discharging</strong> (energy out). The
                tile shows the absolute value plus the direction so the eye
                can read it as a flow.
              </p>
              <p className="mt-1">
                The two unit-level values below show how the dispatcher split
                the total — usually evenly to balance temperature and
                cycle wear.
              </p>
              <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                API: batteries[0].power_w + batteries[1].power_w
              </p>
            </InfoHint>
          </CardTitle>
          <p className="text-[11px] text-muted-foreground leading-snug text-pretty">
            {battDischarging
              ? "Both packs delivering energy outward — covering load, EV demand, or exporting at high spot prices."
              : battCharging
                ? "Both packs absorbing energy — storing cheap grid power for later use."
                : "Packs are at rest — no charge or discharge command this tick."}
          </p>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span
              className={`text-3xl font-bold tabular-nums ${
                battDischarging
                  ? "text-amber-500"
                  : battCharging
                  ? "text-emerald-500"
                  : ""
              }`}
            >
              {formatKW(Math.abs(P_bat_total), { digits: 1 })}
            </span>
            <span className="text-xs text-muted-foreground">
              {battDischarging
                ? "discharging"
                : battCharging
                ? "charging"
                : "idle"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            <LabelHint
              label="unit 1"
              hint="Power on Battery Unit 1 (positive = charging, negative = discharging). API field: batteries[0].power_w"
            />{" "}
            {formatKW(frame.batteries[0].power_w, { signed: true, digits: 1 })}
            {" "}&middot;{" "}
            <LabelHint
              label="unit 2"
              hint="Power on Battery Unit 2 (positive = charging, negative = discharging). API field: batteries[1].power_w"
            />{" "}
            {formatKW(frame.batteries[1].power_w, { signed: true, digits: 1 })}
          </p>
        </CardContent>
      </Card>

      {/* SOC */}
      <Card>
        <CardHeader className="pb-1.5 space-y-1">
          <CardTitle className="text-sm font-medium flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Battery className="size-4 text-primary" />
              Stored energy
            </span>
            <InfoHint>
              <p className="font-medium mb-1">State of charge (SOC)</p>
              <p>
                Average state of charge across both battery units, in percent
                of usable capacity. This is the &ldquo;tank gauge&rdquo;
                — how much energy is held right now and therefore how
                much is available to discharge into a price spike or an EV
                session.
              </p>
              <p className="mt-1">
                Enexa keeps SOC in a working window (typically 15&nbsp;%&ndash;90&nbsp;%)
                to protect cycle life.
              </p>
              <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                API: avg(batteries[0].soc_pct, batteries[1].soc_pct)
              </p>
            </InfoHint>
          </CardTitle>
          <p className="text-[11px] text-muted-foreground leading-snug text-pretty">
            {avgSOC > 80
              ? "Packs near full — lots of headroom to discharge, little to absorb if grid prices crash."
              : avgSOC < 25
                ? "Packs nearly empty — needs to charge soon or it can’t serve the next discharge call."
                : "In the working band — full flexibility in either direction."}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold tabular-nums">
              {avgSOC.toFixed(0)}
            </span>
            <span className="text-sm text-muted-foreground">% avg SOC</span>
          </div>
          <Progress value={avgSOC} className="h-1.5" />
          <p className="text-xs text-muted-foreground">
            <LabelHint
              label="unit 1"
              hint="State of charge of Battery Unit 1 in percent of usable capacity. API field: batteries[0].soc_pct"
            />{" "}
            {frame.batteries[0].soc_pct.toFixed(0)}%
            {" "}&middot;{" "}
            <LabelHint
              label="unit 2"
              hint="State of charge of Battery Unit 2 in percent of usable capacity. API field: batteries[1].soc_pct"
            />{" "}
            {frame.batteries[1].soc_pct.toFixed(0)}%
          </p>
        </CardContent>
      </Card>

      {/* EV */}
      <Card>
        <CardHeader className="pb-1.5 space-y-1">
          <CardTitle className="text-sm font-medium flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Cable
                className={`size-4 ${
                  P_ev_total > 50 ? "text-primary" : "text-muted-foreground"
                }`}
              />
              EV delivery
            </span>
            <InfoHint>
              <p className="font-medium mb-1">Power delivered to vehicles</p>
              <p>
                Sum of <code>p_ev_w</code> on both connectors — the
                actual power going into the cars at this instant. Different
                from the connector setpoint (<code>p_cp_max_w</code>): the car
                may draw less than offered, especially as it approaches its
                target SOC and the BMS tapers the rate.
              </p>
              <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                API: chargers[0].p_ev_w + chargers[1].p_ev_w
              </p>
            </InfoHint>
          </CardTitle>
          <p className="text-[11px] text-muted-foreground leading-snug text-pretty">
            {activeConnectors === 0
              ? "No active EV sessions — ChargePost is operating in stationary-storage mode only."
              : activeConnectors === 1
                ? "One vehicle drawing power — the other connector is idle and free for the next car."
                : "Both connectors busy — site is in dual-charging mode."}
          </p>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span
              className={`text-3xl font-bold tabular-nums ${
                P_ev_total > 50 ? "text-primary" : ""
              }`}
            >
              {formatKW(P_ev_total, { digits: 1 })}
            </span>
            <span className="text-xs text-muted-foreground">to vehicles</span>
          </div>
          <p className="text-xs text-muted-foreground">
            <LabelHint
              label={`${activeConnectors} of 2 connectors active`}
              hint={
                <>
                  <p className="font-medium mb-1">Active connectors</p>
                  <p>
                    Number of connectors with{" "}
                    <code>charging_state = InProgress</code>. A connector that
                    is plugged but not yet authorised or that has finished its
                    session is not counted as active.
                  </p>
                  <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                    API: count(chargers where charging_state=&quot;InProgress&quot;)
                  </p>
                </>
              }
            />
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
