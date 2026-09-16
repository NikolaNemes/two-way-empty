"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/page-header"
import { Separator } from "@/components/ui/separator"
import { Battery, Zap, TrendingUp, ArrowDown, CheckCircle, Sun } from "lucide-react"

export function ExplainerScreen() {
  return (
    <>
      <PageHeader
        title="How It Works"
        description="Timeline comparison: Reactive BMS vs Smart EMS v1"
      />
      <div className="p-4 md:p-6 space-y-6 w-full">

        {/* Intro Narrative */}
        <Card className="bg-muted/30">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p>
              Both algorithms share the same goal: reliably charge EVs while managing a battery storage system. 
              The key difference is <strong>when and how they decide</strong> to charge the battery during idle periods. 
              Reactive BMS uses simple fixed rules. Smart EMS uses price forecasts to plan ahead.
            </p>
          </CardContent>
        </Card>

        {/* Timeline Header */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-4 py-2 rounded-full font-medium">
              <Zap className="size-4" />
              Reactive BMS
            </div>
            <p className="text-xs text-muted-foreground mt-1">Simple, predictable, no forecasts</p>
          </div>
          <div className="text-center text-sm text-muted-foreground font-medium">vs</div>
          <div className="text-center">
            <div className="inline-flex items-center gap-2 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-4 py-2 rounded-full font-medium">
              <TrendingUp className="size-4" />
              Smart EMS v1
            </div>
            <p className="text-xs text-muted-foreground mt-1">Price-aware, optimized, requires forecasts</p>
          </div>
        </div>

        {/* PHASE 1: Setup/Planning */}
        <p className="text-sm text-muted-foreground text-center italic">
          Before any EV arrives, each system prepares differently...
        </p>
        <div className="relative">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border -translate-x-1/2" />
          
          <div className="grid grid-cols-[1fr_auto_1fr] gap-4">
            {/* Reactive: Fixed Setup */}
            <Card className="border-blue-200 dark:border-blue-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs">1</span>
                  Fixed Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p className="mb-2">No planning phase. Uses static parameters:</p>
                <ul className="space-y-1 text-xs">
                  <li>- Target SOC: <strong>80% fixed</strong></li>
                  <li>- Grid limit: 80 kW</li>
                  <li>- Priority: Grid &gt; PV &gt; Battery</li>
                </ul>
              </CardContent>
            </Card>

            {/* Center Phase Label */}
            <div className="flex flex-col items-center justify-center">
              <div className="bg-background border rounded-full px-3 py-1 text-xs font-medium z-10">
                Phase 1
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">Setup</div>
            </div>

            {/* Smart: Planning */}
            <Card className="border-green-200 dark:border-green-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs">1</span>
                  Day-Ahead Planning
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p className="mb-2">Analyzes forecasts and creates optimal schedule:</p>
                <ul className="space-y-1 text-xs">
                  <li>- EPEX spot prices (24h)</li>
                  <li>- PV generation forecast</li>
                  <li>- EV arrival probability</li>
                  <li>- Output: <strong>Dynamic SOC curve</strong></li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Arrow Down */}
        <div className="flex justify-center">
          <ArrowDown className="size-6 text-muted-foreground" />
        </div>

        {/* PHASE 2: EV Charging - SAME LOGIC */}
        <p className="text-sm text-muted-foreground text-center italic">
          When an EV plugs in, both systems follow the exact same dispatch priority...
        </p>
        <div className="relative">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border -translate-x-1/2" />
          
          <div className="grid grid-cols-[1fr_auto_1fr] gap-4">
            {/* Reactive: EV Charging */}
            <Card className="border-blue-200 dark:border-blue-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs">2</span>
                  EV Charging Dispatch
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-4 h-4 rounded bg-blue-500 text-white flex items-center justify-center text-[10px]">1</span>
                    <span>Grid provides up to 80 kW</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-4 h-4 rounded bg-blue-400 text-white flex items-center justify-center text-[10px]">2</span>
                    <span>PV covers additional demand</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-4 h-4 rounded bg-blue-300 text-white flex items-center justify-center text-[10px]">3</span>
                    <span>Battery discharges for remainder</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Center Phase Label */}
            <div className="flex flex-col items-center justify-center">
              <div className="bg-background border rounded-full px-3 py-1 text-xs font-medium z-10">
                Phase 2
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">EV Charging</div>
              <div className="mt-2 bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 text-[10px] px-2 py-1 rounded">
                Same Logic
              </div>
            </div>

            {/* Smart: EV Charging */}
            <Card className="border-green-200 dark:border-green-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs">2</span>
                  EV Charging Dispatch
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-4 h-4 rounded bg-green-500 text-white flex items-center justify-center text-[10px]">1</span>
                    <span>Grid provides up to 80 kW</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-4 h-4 rounded bg-green-400 text-white flex items-center justify-center text-[10px]">2</span>
                    <span>PV covers additional demand</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-4 h-4 rounded bg-green-300 text-white flex items-center justify-center text-[10px]">3</span>
                    <span>Battery discharges for remainder</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Arrow Down */}
        <div className="flex justify-center">
          <ArrowDown className="size-6 text-muted-foreground" />
        </div>

        {/* PHASE 3: Idle Period - KEY DIFFERENCE */}
        <p className="text-sm text-muted-foreground text-center italic">
          Between charging sessions, the systems diverge significantly...
        </p>
        <div className="relative">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border -translate-x-1/2" />
          
          <div className="grid grid-cols-[1fr_auto_1fr] gap-4">
            {/* Reactive: Idle */}
            <Card className="border-blue-200 dark:border-blue-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs">3</span>
                  Idle Period
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p className="text-xs mb-2">Maintains fixed 80% SOC regardless of price:</p>
                <div className="bg-blue-50 dark:bg-blue-950 rounded p-2 text-xs">
                  <p>If SOC &lt; 80%: Charge from Grid + PV</p>
                  <p>If SOC &gt; 80%: Hold (no discharge)</p>
                </div>
                <p className="text-xs mt-2 text-amber-600 dark:text-amber-400">
                  No price awareness - may charge during expensive hours
                </p>
              </CardContent>
            </Card>

            {/* Center Phase Label */}
            <div className="flex flex-col items-center justify-center">
              <div className="bg-background border rounded-full px-3 py-1 text-xs font-medium z-10">
                Phase 3
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">Idle Period</div>
              <div className="mt-2 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 text-[10px] px-2 py-1 rounded">
                Key Difference
              </div>
            </div>

            {/* Smart: Idle */}
            <Card className="border-green-200 dark:border-green-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs">3</span>
                  Idle Period
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p className="text-xs mb-2">Follows dynamic SOC target from planning:</p>
                <div className="bg-green-50 dark:bg-green-950 rounded p-2 text-xs">
                  <p>Cheap hour: Charge to high SOC target</p>
                  <p>Expensive hour: Allow lower SOC target</p>
                </div>
                <p className="text-xs mt-2 text-green-600 dark:text-green-400">
                  Charges when cheap, reserves capacity for peaks
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Arrow Down */}
        <div className="flex justify-center">
          <ArrowDown className="size-6 text-muted-foreground" />
        </div>

        {/* PHASE 4: Results */}
        <div className="relative">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-4">
            {/* Reactive: Result */}
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle className="size-4 text-blue-500" />
                  Outcome
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p><strong>Reliability:</strong> EVs always charged</p>
                <p><strong>Simplicity:</strong> Predictable behavior</p>
                <p><strong>Cost:</strong> Higher - no optimization</p>
              </CardContent>
            </Card>

            {/* Center */}
            <div className="flex flex-col items-center justify-center">
              <div className="bg-background border rounded-full px-3 py-1 text-xs font-medium z-10">
                Result
              </div>
            </div>

            {/* Smart: Result */}
            <Card className="border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle className="size-4 text-green-500" />
                  Outcome
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p><strong>Reliability:</strong> EVs always charged</p>
                <p><strong>Complexity:</strong> Requires forecasts</p>
                <p><strong>Cost:</strong> Lower - price arbitrage</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <Separator />

        {/* Summary */}
        <Card className="bg-muted/30">
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-start gap-3">
              <Battery className="size-6 text-primary mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium mb-2">Key Insight: Identical EV Charging</p>
                <p className="text-muted-foreground">
                  The EV charging logic (Phase 2) is <strong>identical</strong> in both algorithms - grid-first priority 
                  ensures reliable charging. The difference is in <strong>idle period management</strong> (Phase 3): 
                  Reactive maintains a fixed 80% SOC at any cost, while Smart EMS follows a price-optimized SOC curve 
                  that charges during cheap hours and reserves discharge capacity for expensive peaks.
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex items-start gap-3">
              <Sun className="size-6 text-yellow-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium mb-2">Key Insight: PV Maximization</p>
                <p className="text-muted-foreground">
                  Smart EMS deliberately <strong>lowers SOC before peak PV hours</strong> (typically late morning), 
                  creating headroom in the battery to absorb solar generation. This minimizes grid export and maximizes 
                  self-consumption of free PV energy. Reactive BMS, by always targeting 80% SOC, often has a nearly-full 
                  battery when PV peaks - forcing valuable solar energy to be exported at low feed-in rates instead of stored.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
    </>
  )
}
