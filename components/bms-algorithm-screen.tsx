"use client"

import { useSimulation } from "@/lib/simulation-store"
import { PageHeader } from "@/components/page-header"
import { SourcesCitation } from "@/components/sources-citation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  BatteryCharging,
  Car,
  Sun,
  Plug,
  ArrowRight,
  ArrowDown,
  Zap,
  Clock,
  Gauge,
  ShieldCheck,
  Info,
  GitBranch,
} from "lucide-react"

// ─── Decision node for the flow diagram ───
function DecisionNode({ question, className = "" }: { question: string; className?: string }) {
  return (
    <div className={`relative rounded-lg border-2 border-chart-1/40 bg-chart-1/5 px-4 py-2.5 text-center text-sm font-medium text-foreground ${className}`}>
      <div className="absolute -top-2.5 left-3 rounded bg-chart-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">Decision</div>
      {question}
    </div>
  )
}

function ActionNode({ action, sources, color = "chart-3" }: { action: string; sources: string[]; color?: string }) {
  const bgMap: Record<string, string> = {
    "chart-1": "bg-chart-1/8 border-chart-1/30",
    "chart-2": "bg-chart-2/8 border-chart-2/30",
    "chart-3": "bg-chart-3/8 border-chart-3/30",
    "chart-4": "bg-chart-4/8 border-chart-4/30",
    "destructive": "bg-destructive/8 border-destructive/30",
  }
  return (
    <div className={`rounded-lg border ${bgMap[color] ?? bgMap["chart-3"]} px-4 py-2.5`}>
      <p className="text-sm font-medium text-foreground">{action}</p>
      {sources.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {sources.map((s) => (
            <Badge key={s} variant="outline" className="text-[10px] font-normal">{s}</Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function FlowArrow({ label, yes, no }: { label?: string; yes?: boolean; no?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1">
      <ArrowDown className="size-4 text-muted-foreground" />
      {(label || yes || no) && (
        <span className={`text-[10px] font-medium ${yes ? "text-chart-3" : no ? "text-destructive" : "text-muted-foreground"}`}>
          {label ?? (yes ? "YES" : "NO")}
        </span>
      )}
    </div>
  )
}

function ConstraintRow({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border px-4 py-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">{icon}</div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <Badge variant="secondary" className="text-[10px] font-mono">{value}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{detail}</p>
      </div>
    </div>
  )
}

export function BmsAlgorithmScreen() {
  const { siteSetup, bmsConfig } = useSimulation()
  const { battery, grid, charger, wear } = siteSetup
  const deratingFull = bmsConfig.deratingStartSoc
  const socFloor = battery.socFloor

  return (
    <div className="flex flex-col">
      <PageHeader
        title="BMS Reactive Algorithm"
        description="Complete rule-based energy management logic -- how every minute of the simulation is decided"
      />
      <div className="flex-1 overflow-auto">
        <div className="space-y-6 p-4 md:p-6">

          {/* Overview */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-chart-1/10">
                  <Info className="size-4 text-chart-1" />
                </div>
                <div>
                  <CardTitle className="text-base">Algorithm Overview</CardTitle>
                  <CardDescription>Core design principles</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <p>
                  The <span className="font-medium text-foreground">Reactive BMS</span> is a rule-based energy management system that runs at
                  <span className="font-medium text-foreground"> 1-minute resolution</span> (1440 steps per day). It is <span className="font-medium text-foreground">purely reactive</span> --
                  it makes each decision based only on the current state, with <span className="font-medium text-foreground">no forward knowledge</span> of future sessions, prices, or PV output.
                </p>
                <p>
                  Every minute, the algorithm asks one question: <span className="font-semibold text-foreground italic">Is an EV connected right now?</span> This
                  branches into two completely different operating modes with different priorities and constraints.
                </p>
                <div className="grid gap-3 pt-2 sm:grid-cols-3">
                  <div className="rounded-lg border px-3 py-2">
                    <p className="text-xs font-medium text-foreground">Resolution</p>
                    <p className="text-lg font-bold tabular-nums text-foreground">1 min</p>
                    <p className="text-[10px]">1440 steps / day</p>
                  </div>
                  <div className="rounded-lg border px-3 py-2">
                    <p className="text-xs font-medium text-foreground">Strategy</p>
                    <p className="text-lg font-bold text-foreground">Reactive</p>
                    <p className="text-[10px]">No lookahead or optimization</p>
                  </div>
                  <div className="rounded-lg border px-3 py-2">
                    <p className="text-xs font-medium text-foreground">Inputs</p>
                    <p className="text-lg font-bold text-foreground">5 signals</p>
                    <p className="text-[10px]">EV, SOC, PV, grid, budget</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Main Decision Flow */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-chart-4/10">
                  <GitBranch className="size-4 text-chart-4" />
                </div>
                <div>
                  <CardTitle className="text-base">Decision Flow</CardTitle>
                  <CardDescription>The full minute-by-minute decision tree</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-1">

                {/* Root decision */}
                <DecisionNode question="Is an EV connected to the charger?" />

                <div className="grid gap-4 pt-2 md:grid-cols-2">

                  {/* ─── LEFT: EV Connected ─── */}
                  <div className="space-y-1 rounded-xl border-2 border-chart-1/20 bg-chart-1/[0.02] p-4">
                    <div className="flex items-center gap-2 pb-2">
                      <Car className="size-4 text-chart-1" />
                      <p className="text-sm font-bold text-chart-1">YES -- EV Connected</p>
                    </div>

                    <p className="text-xs text-muted-foreground pb-2 leading-relaxed">
                      Primary goal: <span className="font-medium text-foreground">deliver maximum power to the EV.</span> The charger does not know how long the driver will stay, so it pushes energy as fast as possible using all available sources.
                    </p>

                    <div className="space-y-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Step 1: Calculate EV power request</p>
                      <ActionNode
                        action={`EV requests min(maxAcceptRate, remaining energy x 60) capped by hardware output (${charger.maxHardwareOutput} kW)`}
                        sources={["CCS protocol", "ISO 15118"]}
                        color="chart-1"
                      />

                      <FlowArrow />

                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Step 2: Fill the request (priority cascade)</p>
                      <div className="space-y-1.5 rounded-lg border border-dashed border-chart-3/40 bg-chart-3/[0.03] p-3">
                        <div className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className="text-[10px] bg-chart-3/10 text-chart-3 border-chart-3/30">Priority 1</Badge>
                          <Sun className="size-3.5 text-chart-3" />
                          <span className="font-medium">PV to EV</span>
                          <ArrowRight className="size-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Free energy, zero marginal cost</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className="text-[10px] bg-chart-2/10 text-chart-2 border-chart-2/30">Priority 2</Badge>
                          <Plug className="size-3.5 text-chart-2" />
                          <span className="font-medium">Grid to EV</span>
                          <ArrowRight className="size-3 text-muted-foreground" />
                          <span className="text-muted-foreground">{'Up to grid limit ('}{grid.gridConnectionLimit}{' kW)'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className="text-[10px] bg-chart-4/10 text-chart-4 border-chart-4/30">Priority 3</Badge>
                          <BatteryCharging className="size-3.5 text-chart-4" />
                          <span className="font-medium">Battery to EV</span>
                          <ArrowRight className="size-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Fill the gap (subject to constraints)</span>
                        </div>
                      </div>

                      <FlowArrow />

                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Step 3: Battery discharge constraints</p>
                      <div className="space-y-1.5 rounded-lg border border-dashed border-chart-4/40 bg-chart-4/[0.03] p-3 text-xs text-muted-foreground">
                        <p className="flex items-center gap-1.5"><Gauge className="size-3" /><span className="text-foreground font-medium">Max discharge rate:</span> {battery.maxDischargeRate} kW x derating factor</p>
                        <p className="flex items-center gap-1.5"><ShieldCheck className="size-3" /><span className="text-foreground font-medium">SOC derating:</span> 100% power above {deratingFull}% SOC, linear ramp to 0% at {socFloor}% SOC</p>
                        <p className="flex items-center gap-1.5"><Clock className="size-3" /><span className="text-foreground font-medium">Cycle budget:</span> max {wear.maxDailyDischarge} kWh discharge per day</p>
                        <p className="flex items-center gap-1.5"><BatteryCharging className="size-3" /><span className="text-foreground font-medium">SOC floor:</span> never below {socFloor}% ({(socFloor / 100 * battery.totalCapacity).toFixed(0)} kWh)</p>
                      </div>

                      <FlowArrow />

                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Step 4: Trickle recharge (if enabled)</p>
                      <div className="rounded-lg border border-dashed border-chart-2/40 bg-chart-2/[0.03] p-3 text-xs text-muted-foreground leading-relaxed">
                        <p>If <span className="text-foreground font-medium">gridToEV {'<'} gridLimit</span>, the spare grid capacity plus any leftover PV recharges the battery while the EV charges.</p>
                        <p className="mt-1">Capped by: <Badge variant="outline" className="text-[10px]">maxChargeRate ({battery.maxChargeRate} kW)</Badge> <Badge variant="outline" className="text-[10px]">SOC ceiling ({battery.socCeiling}%)</Badge></p>
                        <p className="mt-1 text-[10px]">Status: <span className={bmsConfig.trickleRechargeEnabled ? "text-chart-3 font-medium" : "text-destructive font-medium"}>{bmsConfig.trickleRechargeEnabled ? "Enabled" : "Disabled"}</span></p>
                      </div>

                      <FlowArrow />

                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Step 5: PV surplus</p>
                      <ActionNode action="Any remaining PV after EV + battery trickle is exported to grid" sources={["EEG feed-in"]} color="chart-3" />
                    </div>
                  </div>

                  {/* ─── RIGHT: Idle ─── */}
                  <div className="space-y-1 rounded-xl border-2 border-muted bg-muted/30 p-4">
                    <div className="flex items-center gap-2 pb-2">
                      <Clock className="size-4 text-muted-foreground" />
                      <p className="text-sm font-bold text-foreground">NO -- Idle (no EV)</p>
                    </div>

                    <p className="text-xs text-muted-foreground pb-2 leading-relaxed">
                      Primary goal: <span className="font-medium text-foreground">recharge battery to target SOC</span> so it is ready for the next session.
                      Secondary: export PV surplus to grid for feed-in revenue.
                    </p>

                    <div className="space-y-1.5">
                      <DecisionNode question={`Battery SOC < idle target (${bmsConfig.idleTargetSoc}%)?`} className="!text-xs" />

                      {/* YES branch */}
                      <div className="grid gap-3 pt-2 md:grid-cols-2">
                        <div className="space-y-1.5 rounded-lg border border-chart-3/30 bg-chart-3/[0.03] p-3">
                          <Badge variant="outline" className="text-[10px] bg-chart-3/10 text-chart-3 border-chart-3/30">YES -- Recharge</Badge>
                          <div className="space-y-1.5 text-xs text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[9px]">1st</Badge>
                              <Sun className="size-3 text-chart-3" />
                              <span>PV to battery</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[9px]">2nd</Badge>
                              <Plug className="size-3 text-chart-2" />
                              <span>Grid to battery</span>
                            </div>
                            <p className="pt-1 text-[10px]">
                              Grid capped at <span className="font-medium text-foreground">{bmsConfig.idleRechargeRateKw} kW</span>
                            </p>
                            <p className="text-[10px]">
                              Total capped at <span className="font-medium text-foreground">{battery.maxChargeRate} kW</span>
                            </p>
                            <p className="text-[10px]">
                              PV surplus after battery {'-->'} grid export
                            </p>
                          </div>
                        </div>
                        <div className="space-y-1.5 rounded-lg border border-muted p-3">
                          <Badge variant="outline" className="text-[10px]">NO -- SOC at target</Badge>
                          <div className="text-xs text-muted-foreground">
                            <p>Battery is full enough.</p>
                            <p className="mt-1">All PV output {'-->'} grid export</p>
                            <p className="mt-1">Grid draw = 0 kW</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Common: state update */}
                <div className="pt-4">
                  <FlowArrow label="BOTH PATHS" />
                  <div className="rounded-lg border-2 border-border bg-muted/30 p-4 text-sm">
                    <p className="font-medium text-foreground">State Update (every minute)</p>
                    <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <p><span className="font-mono text-foreground">batterySocKwh</span> += chargeKwh - dischargeKwh</p>
                      <p><span className="font-mono text-foreground">totalDischarged</span> += dischargeKwh</p>
                      <p><span className="font-mono text-foreground">gridCost</span> = gridKwh x (EPEX[slot] + fees)</p>
                      <p><span className="font-mono text-foreground">evRevenue</span> = evKwh x {(siteSetup.gridPricing?.retailPricePerKwh ?? 0.59).toFixed(2)} EUR</p>
                      <p><span className="font-mono text-foreground">wearCost</span> = dischargeKwh x {wear.wearCostPerKwh.toFixed(3)} EUR</p>
                      <p><span className="font-mono text-foreground">SOC</span> clamped to [{socFloor}%, {battery.socCeiling}%]</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SOC Derating Deep Dive */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-chart-4/10">
                  <Gauge className="size-4 text-chart-4" />
                </div>
                <div>
                  <CardTitle className="text-base">SOC Derating Curve</CardTitle>
                  <CardDescription>Battery discharge power limit as a function of SOC</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground leading-relaxed pb-3">
                Real battery management systems reduce discharge power as SOC drops to protect cell voltage. Our model uses a
                simple two-zone linear derating curve:
              </p>

              {/* Visual derating bar */}
              <div className="mb-4 rounded-lg border p-4">
                <div className="relative h-12 w-full rounded-md overflow-hidden">
                  {/* Dead zone */}
                  <div
                    className="absolute inset-y-0 left-0 bg-destructive/20 border-r border-destructive/40 flex items-center justify-center"
                    style={{ width: `${socFloor}%` }}
                  >
                    <span className="text-[9px] font-bold text-destructive">CUTOFF</span>
                  </div>
                  {/* Derating zone */}
                  <div
                    className="absolute inset-y-0 flex items-center justify-center"
                    style={{
                      left: `${socFloor}%`,
                      width: `${deratingFull - socFloor}%`,
                      background: "linear-gradient(to right, oklch(0.75 0.18 55 / 0.3), oklch(0.72 0.17 145 / 0.3))",
                    }}
                  >
                    <span className="text-[9px] font-bold text-foreground">DERATING</span>
                  </div>
                  {/* Full power zone */}
                  <div
                    className="absolute inset-y-0 bg-chart-3/20 flex items-center justify-center"
                    style={{ left: `${deratingFull}%`, width: `${battery.socCeiling - deratingFull}%` }}
                  >
                    <span className="text-[9px] font-bold text-chart-3">FULL POWER</span>
                  </div>
                  {/* Above ceiling */}
                  <div
                    className="absolute inset-y-0 right-0 bg-muted flex items-center justify-center"
                    style={{ width: `${100 - battery.socCeiling}%` }}
                  >
                    <span className="text-[9px] font-bold text-muted-foreground">CEILING</span>
                  </div>
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-muted-foreground tabular-nums">
                  <span>0%</span>
                  <span>{socFloor}%</span>
                  <span>{deratingFull}%</span>
                  <span>{battery.socCeiling}%</span>
                  <span>100%</span>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-xs font-medium text-foreground">Example: SOC at 25%</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Derating factor = (25 - {socFloor}) / ({deratingFull} - {socFloor}) = {((25 - socFloor) / (deratingFull - socFloor)).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Effective discharge = {battery.maxDischargeRate} x {((25 - socFloor) / (deratingFull - socFloor)).toFixed(2)} = {(battery.maxDischargeRate * (25 - socFloor) / (deratingFull - socFloor)).toFixed(0)} kW
                  </p>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <p className="text-xs font-medium text-foreground">Example: SOC at 80%</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Above {deratingFull}% threshold -- no derating
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Effective discharge = {battery.maxDischargeRate} x 1.00 = {battery.maxDischargeRate} kW
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* All Constraints Summary */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-destructive/10">
                  <ShieldCheck className="size-4 text-destructive" />
                </div>
                <div>
                  <CardTitle className="text-base">Hard Constraints (Never Violated)</CardTitle>
                  <CardDescription>Physical and configuraton limits enforced every minute</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-2">
              <ConstraintRow
                icon={<Plug className="size-3.5 text-chart-2" />}
                label="Grid connection limit"
                value={`${grid.gridConnectionLimit} kW`}
                detail="Total grid import (to EV + to battery) never exceeds this. Physical fuse / DSO contractual limit."
              />
              <ConstraintRow
                icon={<BatteryCharging className="size-3.5 text-chart-4" />}
                label="Max discharge rate"
                value={`${battery.maxDischargeRate} kW`}
                detail="Battery power output to EV. Subject to SOC derating (reduced linearly below derating threshold)."
              />
              <ConstraintRow
                icon={<BatteryCharging className="size-3.5 text-chart-3" />}
                label="Max charge rate"
                value={`${battery.maxChargeRate} kW`}
                detail="Total power into battery (PV + grid) never exceeds this. BMS / inverter limit. Applies in both idle and trickle modes."
              />
              <ConstraintRow
                icon={<Zap className="size-3.5 text-chart-1" />}
                label="Max hardware output"
                value={`${charger.maxHardwareOutput} kW`}
                detail="Charger hardware limit per connector. Total EV delivery never exceeds this even if sources can provide more."
              />
              <ConstraintRow
                icon={<Gauge className="size-3.5 text-destructive" />}
                label="SOC floor"
                value={`${battery.socFloor}% (${(battery.socFloor / 100 * battery.totalCapacity).toFixed(0)} kWh)`}
                detail="Battery never discharged below this. Protects LFP cell voltage and longevity."
              />
              <ConstraintRow
                icon={<Gauge className="size-3.5 text-chart-3" />}
                label="SOC ceiling"
                value={`${battery.socCeiling}% (${(battery.socCeiling / 100 * battery.totalCapacity).toFixed(0)} kWh)`}
                detail="Battery never charged above this. Reduces calendar aging at high SOC."
              />
              <ConstraintRow
                icon={<Clock className="size-3.5 text-chart-4" />}
                label="Daily cycle budget"
                value={`${wear.maxDailyDischarge} kWh/day`}
                detail={`Limits total discharge per day to protect cycle life. At ${battery.totalCapacity} kWh capacity, this is ~${(wear.maxDailyDischarge / battery.totalCapacity).toFixed(1)} full equivalent cycles/day.`}
              />
            </CardContent>
          </Card>

          {/* What this algorithm does NOT do */}
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                  <Info className="size-4 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-base">Limitations of Reactive Strategy</CardTitle>
                  <CardDescription>What this algorithm does NOT do (but the EMS Optimizer will)</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-destructive/20 bg-destructive/[0.03] p-3">
                    <p className="font-medium text-foreground text-xs">No price awareness</p>
                    <p className="text-xs mt-1">Recharges battery at the same rate regardless of whether EPEX price is 2 ct or 14 ct. An optimizer would buy cheap and discharge during expensive slots.</p>
                  </div>
                  <div className="rounded-lg border border-destructive/20 bg-destructive/[0.03] p-3">
                    <p className="font-medium text-foreground text-xs">No session forecasting</p>
                    <p className="text-xs mt-1">Does not anticipate upcoming sessions. Cannot pre-charge battery before a known busy period. Treats every idle minute the same.</p>
                  </div>
                  <div className="rounded-lg border border-destructive/20 bg-destructive/[0.03] p-3">
                    <p className="font-medium text-foreground text-xs">No PV forecast</p>
                    <p className="text-xs mt-1">Does not know that solar will be available later. Cannot defer grid recharging to wait for free PV energy.</p>
                  </div>
                  <div className="rounded-lg border border-destructive/20 bg-destructive/[0.03] p-3">
                    <p className="font-medium text-foreground text-xs">No grid export optimization</p>
                    <p className="text-xs mt-1">Exports PV surplus passively. Does not strategically store PV for later self-consumption or time grid export to high-price slots.</p>
                  </div>
                </div>
                <p className="text-xs border-l-2 border-chart-1/40 pl-3">
                  The <span className="font-medium text-foreground">EMS Optimizer</span> (coming soon) will address all of these by using lookahead optimization
                  (e.g. rolling horizon MPC or MILP) to minimize total cost while respecting the same physical constraints.
                  The Reactive BMS serves as the <span className="font-medium text-foreground">baseline</span> to measure how much value the optimizer adds.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Sources */}
          <SourcesCitation
            title="Sources: BMS Algorithm Design"
            sources={[
              {
                label: "ADS-TEC Energy -- ChargePost EMS Architecture",
                url: "https://www.ads-tec-energy.com/en/solutions/grid-friendly-charging/",
                detail: "Priority cascade (PV > grid > battery), trickle recharge during sessions, idle SOC target management.",
                date: "2024",
              },
              {
                label: "NREL -- Rule-Based vs Optimal Battery Dispatch for Commercial BESS",
                url: "https://www.nrel.gov/docs/fy21osti/79444.pdf",
                detail: "Comparison of reactive/rule-based dispatch vs MPC optimization. Reactive baseline typically captures 65-80% of optimal value.",
                date: "2021",
              },
              {
                label: "Battery University -- BU-808: SOC Derating & Cell Protection",
                url: "https://batteryuniversity.com/article/bu-808-how-to-prolong-lithium-based-batteries",
                detail: "SOC-based power derating behavior: BMS reduces discharge below 25-30% SOC to protect minimum cell voltage.",
              },
              {
                label: "ISO 15118 -- Vehicle-to-Grid Communication Interface",
                url: "https://www.iso.org/standard/69113.html",
                detail: "CCS protocol: vehicle sends instantaneous power request, charger provides up to min(request, available). Charger has no forward knowledge of session duration.",
                date: "2019",
              },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
