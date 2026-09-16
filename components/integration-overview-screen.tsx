"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import Link from "next/link"
import { 
  BookOpen,
  ArrowDown,
  ArrowUp,
  Cloud,
  Server,
  Cpu,
  Cable,
  FileText,
  Settings,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Wifi,
  WifiOff,
  ShieldOff,
  Shield,
  Activity,
  BatteryCharging,
  Car,
  Zap,
  Target,
  Database,
  UserPlus,
  Layers,
  TrendingUp,
  BarChart3,
  Clock,
  Rocket,
} from "lucide-react"

export function IntegrationOverviewScreen() {
  return (
    <div className="w-full py-8 px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <BookOpen className="size-7 text-primary" />
          Solution Overview
        </h1>
      </div>

      {/* Document Purpose */}
      <Card className="mb-8 border-primary/30 bg-primary/5">
        <CardContent className="pt-6">
          <p className="text-sm mb-4">
            This document provides a high-level overview of the integration between{" "}
            <strong>NITES Enexa</strong> and the <strong>Amperio Middleware</strong>. It is intended to:
          </p>
          <ul className="text-sm space-y-2">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-primary mt-0.5 shrink-0" />
              <span>Explain the <strong>solution approach</strong> and system architecture</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-primary mt-0.5 shrink-0" />
              <span>Define <strong>operational modes</strong> for Amperio confirmation</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-primary mt-0.5 shrink-0" />
              <span>Outline <strong>exception handling scope</strong> to enable effort planning</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-primary mt-0.5 shrink-0" />
              <span>Present <strong>onboarding phases</strong> for timeline agreement</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Separator className="my-8" />

      {/* SECTION 1: SOLUTION APPROACH */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-6">
          <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Target className="size-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">1. Solution Approach</h2>
            <p className="text-sm text-muted-foreground">What we are building and why</p>
          </div>
        </div>

        {/* Business Goal */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Business Objective</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>
              Optimize electricity procurement costs at EV charging sites with integrated battery storage through intelligent energy arbitrage:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                <p className="font-semibold text-green-700 mb-1">Charging Battery</p>
                <p className="text-muted-foreground text-xs">During cheap electricity price periods (night, high renewable generation)</p>
              </div>
              <div className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/20">
                <p className="font-semibold text-orange-700 mb-1">Discharging Battery</p>
                <p className="text-muted-foreground text-xs">During expensive periods (peaks) to serve EV demand from stored energy</p>
              </div>
              <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                <p className="font-semibold text-blue-700 mb-1">Always Serve EVs</p>
                <p className="text-muted-foreground text-xs">EV charging demand is never compromised - customer experience is priority</p>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 mt-4">
              <p className="font-semibold text-primary mb-1">Phase 1: Procurement Control</p>
              <p className="text-muted-foreground text-xs">
                The initial optimization focuses on State of Charge (SOC) management and price arbitrage. 
                The system will schedule battery charging during low-price periods and discharge during high-price periods, 
                reducing overall energy procurement costs.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Architecture */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="size-4" />
              System Architecture
            </CardTitle>
            <CardDescription>Simplified integration with clear responsibility boundaries</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Layer 1: Enexa */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-24 text-right pt-1">
                  <Badge className="bg-blue-600">Cloud</Badge>
                </div>
                <div className="flex-1 p-4 rounded-lg border bg-blue-500/5 border-blue-500/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Cloud className="size-5 text-blue-600" />
                    <h4 className="font-semibold">Enexa</h4>
                    <Badge variant="outline" className="text-xs ml-auto">NITES Responsibility</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Energy optimization, master data management, and operator interface.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="p-2 bg-background rounded border text-center">
                      <Database className="size-4 mx-auto mb-1 text-blue-600" />
                      <p className="font-medium">Asset Registry</p>
                      <p className="text-muted-foreground">Master data</p>
                    </div>
                    <div className="p-2 bg-background rounded border text-center">
                      <Settings className="size-4 mx-auto mb-1 text-blue-600" />
                      <p className="font-medium">Configuration</p>
                      <p className="text-muted-foreground">Central repository</p>
                    </div>
                    <div className="p-2 bg-background rounded border text-center">
                      <TrendingUp className="size-4 mx-auto mb-1 text-blue-600" />
                      <p className="font-medium">Optimizer</p>
                      <p className="text-muted-foreground">SOC / Arbitrage</p>
                    </div>
                    <div className="p-2 bg-background rounded border text-center">
                      <BarChart3 className="size-4 mx-auto mb-1 text-blue-600" />
                      <p className="font-medium">Dashboards</p>
                      <p className="text-muted-foreground">Monitoring</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center">
                <div className="flex flex-col items-center text-xs">
                  <ArrowDown className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Dispatch Commands</span>
                  <div className="my-2 px-3 py-1.5 rounded border bg-muted/50 text-center">
                    <p className="font-medium text-foreground">REST API</p>
                    <p className="text-muted-foreground">Enexa calls Amperio API</p>
                    <p className="text-muted-foreground">for command dispatch</p>
                  </div>
                  <span className="text-muted-foreground">Telemetry Data</span>
                  <ArrowUp className="size-4 text-muted-foreground" />
                </div>
              </div>

              {/* Layer 2: Middleware */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-24 text-right pt-1">
                  <Badge className="bg-orange-600">Middleware</Badge>
                </div>
                <div className="flex-1 p-4 rounded-lg border bg-orange-500/5 border-orange-500/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Server className="size-5 text-orange-600" />
                    <h4 className="font-semibold">Middleware</h4>
                    <Badge variant="outline" className="text-xs ml-auto border-orange-500 text-orange-600">Amperio Responsibility</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Centralized backend that handles communication with ADS-TEC ChargePost hardware. 
                    Exposes REST API for Enexa integration and translates commands to Modbus/TCP registers.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                    <div className="p-2 bg-background rounded border text-center">
                      <Cable className="size-4 mx-auto mb-1 text-orange-600" />
                      <p className="font-medium">API Gateway</p>
                      <p className="text-muted-foreground">Enexa integration</p>
                    </div>
                    <div className="p-2 bg-background rounded border text-center">
                      <Activity className="size-4 mx-auto mb-1 text-orange-600" />
                      <p className="font-medium">Modbus/TCP</p>
                      <p className="text-muted-foreground">ChargePost control</p>
                    </div>
                    <div className="p-2 bg-background rounded border text-center">
                      <Cpu className="size-4 mx-auto mb-1 text-orange-600" />
                      <p className="font-medium">Watchdog Mgmt</p>
                      <p className="text-muted-foreground">2-60s heartbeat</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center">
                <div className="flex flex-col items-center text-muted-foreground text-xs">
                  <ArrowDown className="size-4" />
                  <span>Modbus/TCP (internal)</span>
                  <ArrowUp className="size-4" />
                </div>
              </div>

              {/* Layer 3: Site Controllers & Hardware */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-24 text-right pt-1">
                  <Badge variant="outline">Field</Badge>
                </div>
                <div className="flex-1 p-4 rounded-lg border">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="size-5 text-gray-600" />
                    <h4 className="font-semibold">ADS-TEC ChargePost Hardware</h4>
                    <Badge variant="outline" className="text-xs ml-auto border-orange-500 text-orange-600">Amperio</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    All-in-one ultrafast charging solution with integrated battery storage. Controlled via Modbus/TCP interface.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
                    <div className="p-2 rounded border bg-background">
                      <p className="font-medium">Grid Connection</p>
                      <p className="text-muted-foreground">Up to 87 kVA</p>
                    </div>
                    <div className="p-2 rounded border bg-background">
                      <p className="font-medium">2x Power Units</p>
                      <p className="text-muted-foreground">110 kW each (battery)</p>
                    </div>
                    <div className="p-2 rounded border bg-background">
                      <p className="font-medium">EV Charging</p>
                      <p className="text-muted-foreground">Up to 300 kW coupled</p>
                    </div>
                    <div className="p-2 rounded border bg-background">
                      <p className="font-medium">Modbus Interface</p>
                      <p className="text-muted-foreground">v2.6 / FW 1.10.2+</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* API Surface */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Cable className="size-4" />
              Integration API Surface
            </CardTitle>
            <CardDescription>Complete set of APIs between Enexa and Middleware</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* API Ownership Legend */}
            <div className="p-4 bg-muted/30 rounded-lg border">
              <h4 className="font-semibold mb-3">API Ownership</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2 p-2 bg-blue-500/10 border border-blue-500/30 rounded">
                  <Badge className="bg-blue-600 shrink-0">Enexa hosts</Badge>
                  <span className="text-muted-foreground">Amperio calls to fetch data or push telemetry</span>
                </div>
                <div className="flex items-center gap-2 p-2 bg-orange-500/10 border border-orange-500/30 rounded">
                  <Badge className="bg-orange-600 shrink-0">Amperio hosts</Badge>
                  <span className="text-muted-foreground">Enexa calls to dispatch commands</span>
                </div>
              </div>
            </div>
            
            {/* API Categories */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Master Data APIs */}
              <div className="p-4 rounded-lg border bg-blue-500/5 border-blue-500/20">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold flex items-center gap-2 text-blue-600">
                    <Database className="size-4" />
                    Master Data APIs
                  </h4>
                  <Badge className="bg-blue-600 text-xs">Enexa hosts</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Amperio calls these APIs to fetch asset registry
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <ArrowDown className="size-3 mt-1 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-medium">Asset Registry</span>
                      <p className="text-xs text-muted-foreground">Sites, controllers, equipment inventory</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowDown className="size-3 mt-1 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-medium">Equipment Specifications</span>
                      <p className="text-xs text-muted-foreground">Battery capacity, charger limits, meter IDs</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowDown className="size-3 mt-1 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-medium">Controller Mapping</span>
                      <p className="text-xs text-muted-foreground">Which controller manages which assets</p>
                    </div>
                  </li>
                </ul>
              </div>

              {/* Configuration APIs */}
              <div className="p-4 rounded-lg border bg-blue-500/5 border-blue-500/20">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold flex items-center gap-2 text-blue-600">
                    <Settings className="size-4" />
                    Configuration APIs
                  </h4>
                  <Badge className="bg-blue-600 text-xs">Enexa hosts</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Amperio calls these APIs to fetch settings
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <ArrowDown className="size-3 mt-1 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-medium">Controller Settings</span>
                      <p className="text-xs text-muted-foreground">Operating parameters, thresholds, timeouts</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowDown className="size-3 mt-1 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-medium">Safety Limits</span>
                      <p className="text-xs text-muted-foreground">Min/max SOC, power limits, grid constraints</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowDown className="size-3 mt-1 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-medium">Firmware Versions</span>
                      <p className="text-xs text-muted-foreground">Expected versions, update availability</p>
                    </div>
                  </li>
                </ul>
              </div>

              {/* Operational APIs */}
              <div className="p-4 rounded-lg border bg-orange-500/5 border-orange-500/20">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold flex items-center gap-2 text-orange-600">
                    <Zap className="size-4" />
                    Operational APIs (Commands)
                  </h4>
                  <Badge className="bg-orange-600 text-xs">Amperio hosts</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Enexa calls these APIs to dispatch commands
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <ArrowDown className="size-3 mt-1 text-orange-600 shrink-0" />
                    <div>
                      <span className="font-medium">Dispatch Commands</span>
                      <p className="text-xs text-muted-foreground">Battery setpoints, EV limits, schedules</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowDown className="size-3 mt-1 text-orange-600 shrink-0" />
                    <div>
                      <span className="font-medium">Mode Changes</span>
                      <p className="text-xs text-muted-foreground">Switch operational modes, emergency stops</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowDown className="size-3 mt-1 text-orange-600 shrink-0" />
                    <div>
                      <span className="font-medium">Schedule Updates</span>
                      <p className="text-xs text-muted-foreground">Day-ahead and intraday optimization plans</p>
                    </div>
                  </li>
                </ul>
              </div>

              {/* Telemetry APIs */}
              <div className="p-4 rounded-lg border bg-blue-500/5 border-blue-500/20">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold flex items-center gap-2 text-blue-600">
                    <Activity className="size-4" />
                    Telemetry APIs
                  </h4>
                  <Badge className="bg-blue-600 text-xs">Enexa hosts</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Amperio calls these APIs to push telemetry data
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <ArrowUp className="size-3 mt-1 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-medium">Real-time State</span>
                      <p className="text-xs text-muted-foreground">Battery SOC, power, EV sessions, grid meter</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowUp className="size-3 mt-1 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-medium">Alerts & Faults</span>
                      <p className="text-xs text-muted-foreground">Equipment faults, safety triggers, warnings</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowUp className="size-3 mt-1 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-medium">Controller Status</span>
                      <p className="text-xs text-muted-foreground">Online/offline, firmware version, heartbeat</p>
                    </div>
                  </li>
                </ul>
              </div>

              {/* Onboarding APIs */}
              <div className="p-4 rounded-lg border bg-blue-500/5 border-blue-500/20 md:col-span-2">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold flex items-center gap-2 text-blue-600">
                    <UserPlus className="size-4" />
                    Onboarding APIs
                  </h4>
                  <Badge className="bg-blue-600 text-xs">Enexa hosts</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Amperio calls these APIs during site setup and controller registration
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-start gap-2">
                    <ArrowDown className="size-3 mt-1 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-medium">Site Registration</span>
                      <p className="text-xs text-muted-foreground">Create site record, assign credentials</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <ArrowDown className="size-3 mt-1 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-medium">Controller Provisioning</span>
                      <p className="text-xs text-muted-foreground">Register controller, fetch initial config</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <ArrowUp className="size-3 mt-1 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-medium">Activation Confirmation</span>
                      <p className="text-xs text-muted-foreground">Controller confirms successful setup</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/30 text-sm">
              <p className="text-muted-foreground">
                <strong>Single Source of Truth:</strong> All configuration and firmware data is stored in Enexa. 
                Middleware fetches the latest settings via API, ensuring consistency across all sites.
                Changes made in Enexa are automatically available to all controllers on their next sync.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Separator className="my-8" />

      {/* SECTION 2: OPERATIONAL MODES */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-6">
          <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Shield className="size-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">2. Operational Modes</h2>
            <p className="text-sm text-muted-foreground">Proposed system behaviors - requires Amperio confirmation</p>
          </div>
        </div>

        <Card className="mb-4 border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-4">
            <p className="text-sm flex items-start gap-2">
              <AlertTriangle className="size-4 text-yellow-600 mt-0.5 shrink-0" />
              <span>The following operational modes are proposed by Enexa. Amperio should review and confirm these behaviors align with their operational requirements and middleware capabilities.</span>
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-green-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="size-5 text-green-600" />
                <span className="text-green-700">Normal Operation</span>
              </CardTitle>
              <CardDescription>Enexa optimization active (grid_mgmt_mode = 1)</CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p className="font-medium">Trigger: Active Modbus watchdog maintained</p>
              <ul className="text-muted-foreground space-y-1">
                <li>- Middleware writes watchdog_interval every 2-60s</li>
                <li>- Enexa commands translated to Modbus registers</li>
                <li>- Manual grid_mgmt_mode with per-unit P_grid control</li>
                <li>- Telemetry polled from ChargePost registers</li>
                <li>- Full price arbitrage optimization active</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-yellow-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="size-5 text-yellow-600" />
                <span className="text-yellow-700">Fallback Mode</span>
              </CardTitle>
              <CardDescription>Watchdog expired (grid_mgmt_mode = 0)</CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p className="font-medium">Trigger: Watchdog timer expires (no write for 60s)</p>
              <ul className="text-muted-foreground space-y-1">
                <li>- ChargePost reverts to fallback config values</li>
                <li>- Automatic grid_mgmt_mode enabled</li>
                <li>- System uses P_grid_clearance_cfg as limit</li>
                <li>- EV charging continues with battery assist</li>
                <li>- Batteries recharge to soc_cp_max when available</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-red-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="size-5 text-red-600" />
                <span className="text-red-700">Safe State</span>
              </CardTitle>
              <CardDescription>Critical failure (operation_mode = 0)</CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <p className="font-medium">Trigger: E-stop, crash sensor, BMS fault</p>
              <ul className="text-muted-foreground space-y-1">
                <li>- station.status.errors registers indicate fault</li>
                <li>- Battery contactors open (no charge/discharge)</li>
                <li>- EV charging unavailable</li>
                <li>- Alert via station.status.warnings bitlist</li>
                <li>- Manual reset required via station.mgmt.operation_mode</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator className="my-8" />

      {/* SECTION 3: EXCEPTION HANDLING SCOPE */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-6">
          <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
            <ShieldAlert className="size-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">3. Exception Handling Scope</h2>
            <p className="text-sm text-muted-foreground">Failure scenarios to be handled by each system</p>
          </div>
        </div>

        <Card className="mb-4 border-orange-500/30 bg-orange-500/5">
          <CardContent className="pt-4">
            <p className="text-sm flex items-start gap-2">
              <AlertTriangle className="size-4 text-orange-600 mt-0.5 shrink-0" />
              <span><strong>Important:</strong> Clear ownership of exception handling is critical for effort planning. The following outlines which system handles which failures. Full details in <Link href="/exception-handling" className="text-primary underline">Exception Handling</Link> documentation.</span>
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Middleware Responsibilities */}
          <Card className="border-orange-500/30">
            <CardHeader className="pb-2 bg-orange-500/5">
              <CardTitle className="text-sm flex items-center gap-2">
                <Server className="size-4 text-orange-600" />
                Middleware Handles
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 text-sm space-y-3">
              <div>
                <p className="font-medium">Modbus/TCP Connectivity</p>
                <p className="text-muted-foreground text-xs">ChargePost unreachable, reconnection, watchdog maintenance</p>
              </div>
              <div>
                <p className="font-medium">Hardware Fault Detection</p>
                <p className="text-muted-foreground text-xs">Monitor station.status.errors, charger.X.status.errors bitlists</p>
              </div>
              <div>
                <p className="font-medium">Clearance Violation</p>
                <p className="text-muted-foreground text-xs">Handle P_clearance_violation warnings (Bit 3 in station.status.warnings)</p>
              </div>
              <div>
                <p className="font-medium">Telemetry Buffering</p>
                <p className="text-muted-foreground text-xs">Store data during Enexa outage, flush on reconnection</p>
              </div>
              <div>
                <p className="font-medium">Register Translation</p>
                <p className="text-muted-foreground text-xs">Map REST API commands to correct Modbus holding registers</p>
              </div>
            </CardContent>
          </Card>

            {/* NITES Responsibilities */}
          <Card className="border-blue-500/30">
            <CardHeader className="pb-2 bg-blue-500/5">
              <CardTitle className="text-sm flex items-center gap-2">
                <Cloud className="size-4 text-blue-600" />
                Enexa Handles
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 text-sm space-y-3">
              <div>
                <p className="font-medium">Middleware API Unavailable</p>
                <p className="text-muted-foreground text-xs">Retry logic, queue commands, alert operators</p>
              </div>
              <div>
                <p className="font-medium">Telemetry Gaps</p>
                <p className="text-muted-foreground text-xs">Missing data interpolation, stale data warnings</p>
              </div>
              <div>
                <p className="font-medium">Optimization Failures</p>
                <p className="text-muted-foreground text-xs">Fallback to safe schedules, conservative dispatch</p>
              </div>
              <div>
                <p className="font-medium">Configuration Errors</p>
                <p className="text-muted-foreground text-xs">Validation, rollback to known-good config</p>
              </div>
              <div>
                <p className="font-medium">Alerting & Monitoring</p>
                <p className="text-muted-foreground text-xs">Dashboard alerts, operator notifications</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator className="my-8" />

      {/* SECTION 4: ONBOARDING & CONFIGURATION PHASES */}
      <div className="mb-12">
        <div className="flex items-center gap-3 mb-6">
          <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Rocket className="size-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">4. Onboarding & Configuration Phases</h2>
            <p className="text-sm text-muted-foreground">Deployment timeline - requires Amperio confirmation</p>
          </div>
        </div>

        <Card className="mb-4 border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-4">
            <p className="text-sm flex items-start gap-2">
              <AlertTriangle className="size-4 text-yellow-600 mt-0.5 shrink-0" />
              <span>The following phases and timelines are proposed. Amperio should confirm feasibility and adjust based on their development capacity.</span>
            </p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Phase 1 */}
          <Card>
            <CardHeader className="py-4 border-b bg-blue-500/5">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">1</div>
                <div>
                  <CardTitle className="text-base">API Integration Setup</CardTitle>
                  <CardDescription>Establish communication between Enexa and Middleware</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium text-blue-600 mb-2">Enexa</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>- Provide API specification for dispatch commands</li>
                    <li>- Set up sandbox environment</li>
                    <li>- Create API credentials and documentation</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-orange-600 mb-2">Amperio</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>- Implement API endpoints for receiving commands</li>
                    <li>- Implement telemetry push to Enexa</li>
                    <li>- Test connectivity with sandbox</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Phase 2 */}
          <Card>
            <CardHeader className="py-4 border-b bg-purple-500/5">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-bold">2</div>
                <div>
                  <CardTitle className="text-base">Asset & Configuration Setup</CardTitle>
                  <CardDescription>Register sites and configure parameters in Enexa</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium text-blue-600 mb-2">Enexa</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>- Create site records in asset registry</li>
                    <li>- Configure battery, charger, grid parameters</li>
                    <li>- Set up optimization parameters</li>
                    <li>- Provide configuration API for Amperio</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-orange-600 mb-2">Amperio</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>- Provide site hardware specifications</li>
                    <li>- Implement config fetch from Enexa API</li>
                    <li>- Map Enexa config to internal parameters</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Phase 3 */}
          <Card>
            <CardHeader className="py-4 border-b bg-orange-500/5">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-orange-600 text-white flex items-center justify-center text-sm font-bold">3</div>
                <div>
                  <CardTitle className="text-base">Integration Testing</CardTitle>
                  <CardDescription>Validate end-to-end functionality</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium text-blue-600 mb-2">Enexa</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>- Send test dispatch commands</li>
                    <li>- Verify telemetry reception</li>
                    <li>- Test dashboard and monitoring</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-orange-600 mb-2">Amperio</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>- Execute commands on test site</li>
                    <li>- Verify fallback mode behavior</li>
                    <li>- Test exception scenarios</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Phase 4 */}
          <Card>
            <CardHeader className="py-4 border-b bg-green-500/5">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-bold">4</div>
                <div>
                  <CardTitle className="text-base">Production Go-Live</CardTitle>
                  <CardDescription>Deploy to production with monitoring</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium text-blue-600 mb-2">Enexa</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>- Enable production optimization</li>
                    <li>- Monitor system performance</li>
                    <li>- Provide operator dashboards</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-orange-600 mb-2">Amperio</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li>- Switch to production endpoints</li>
                    <li>- Monitor site controller health</li>
                    <li>- Support initial operations</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator className="my-8" />

      {/* Major Work Items */}
      <Card className="mb-8">
        <CardHeader className="border-b">
          <CardTitle>Major Work Items</CardTitle>
          <CardDescription>Development responsibilities for each team</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Enexa Team */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="size-3 rounded-full bg-primary" />
                <h4 className="font-semibold">Enexa Team</h4>
              </div>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Asset registry and master data management</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Centralized configuration repository with API</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Optimization engine (SOC planning, price arbitrage)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Dispatch command API (call Middleware)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Telemetry ingestion and storage</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Monitoring dashboards and alerting</span>
                </li>
              </ul>
            </div>

            {/* Amperio */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="size-3 rounded-full bg-orange-500" />
                <h4 className="font-semibold">Amperio</h4>
              </div>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <Target className="size-4 text-orange-500 mt-0.5 shrink-0" />
                  <span>Middleware backend with API for Enexa integration</span>
                </li>
                <li className="flex items-start gap-2">
                  <Target className="size-4 text-orange-500 mt-0.5 shrink-0" />
                  <span>Internal MQTT routing to site controllers</span>
                </li>
                <li className="flex items-start gap-2">
                  <Target className="size-4 text-orange-500 mt-0.5 shrink-0" />
                  <span>Site controller software and hardware deployment</span>
                </li>
                <li className="flex items-start gap-2">
                  <Target className="size-4 text-orange-500 mt-0.5 shrink-0" />
                  <span>Telemetry collection and aggregation</span>
                </li>
                <li className="flex items-start gap-2">
                  <Target className="size-4 text-orange-500 mt-0.5 shrink-0" />
                  <span>Command execution on field equipment</span>
                </li>
                <li className="flex items-start gap-2">
                  <Target className="size-4 text-orange-500 mt-0.5 shrink-0" />
                  <span>Fallback mode and exception handling</span>
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 5. EV Charging Strategy */}
      <div className="mb-6 flex items-center gap-3">
        <div className="size-8 rounded-full bg-chart-4/15 flex items-center justify-center text-chart-4 font-bold">5</div>
        <h2 className="text-xl font-bold">EV Charging Strategy</h2>
        <Badge variant="outline" className="ml-1">Solution context</Badge>
      </div>
      <p className="text-sm text-muted-foreground mb-4 max-w-3xl">
        Before diving into the wire-level levers, here&apos;s the mental model Enexa uses to steer
        EV charging on an ADS-TEC ChargePost. The station does most of the physical orchestration
        automatically &mdash; Enexa only tunes the <em>constraints</em> that shape it. This frames
        every field you&apos;ll later see on the Dispatching API.
      </p>

      <Card className="mb-6 border-chart-4/30 bg-chart-4/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Car className="size-4 text-chart-4" />
            How ADS-TEC ChargePost handles EV charging
          </CardTitle>
          <CardDescription>Hardware behaviour is fixed. Enexa tunes the constraints around it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border bg-background">
              <div className="flex items-center gap-2 mb-2">
                <BatteryCharging className="size-4 text-chart-2" />
                <h5 className="font-semibold">Automatic battery assist</h5>
              </div>
              <p className="text-muted-foreground">
                When EV demand exceeds <code className="text-xs">P_grid_clearance</code>, the
                internal battery automatically supplements power. This is hardware-level
                behaviour &mdash; it happens <strong>without Enexa intervention</strong>.
              </p>
            </div>

            <div className="p-4 rounded-lg border bg-background">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="size-4 text-primary" />
                <h5 className="font-semibold">Grid-priority mode</h5>
              </div>
              <p className="text-muted-foreground">
                ChargePost always prefers grid over battery. If the EV demands 100&nbsp;kW and
                grid clearance is 80&nbsp;kW, it takes <strong>80&nbsp;kW from grid and 20&nbsp;kW
                from battery</strong> &mdash; never the other way round.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-lg border bg-background">
            <div className="flex items-center gap-2 mb-3">
              <Target className="size-4 text-chart-4" />
              <h5 className="font-semibold">Enexa&apos;s four levers</h5>
            </div>
            <p className="text-muted-foreground mb-3">
              Enexa doesn&apos;t command the EV directly. It tunes four constraints, and the
              ChargePost resolves physical power flow within them:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-md border bg-muted/30">
                <code className="text-xs font-semibold text-foreground">P_cp_lim</code>
                <p className="text-xs text-muted-foreground mt-1">
                  Max power to the EV (0&ndash;300&nbsp;kW). Set low during expensive hours.
                </p>
              </div>
              <div className="p-3 rounded-md border bg-muted/30">
                <code className="text-xs font-semibold text-foreground">charging_mode</code>
                <p className="text-xs text-muted-foreground mt-1">
                  Single (150&nbsp;kW max) vs Dual/Coupled (300&nbsp;kW max) vs Disabled.
                </p>
              </div>
              <div className="p-3 rounded-md border bg-muted/30">
                <code className="text-xs font-semibold text-foreground">soc_cp_max</code>
                <p className="text-xs text-muted-foreground mt-1">
                  Battery SOC ceiling. Keep high to preserve buffer for the EV-boost moment.
                </p>
              </div>
              <div className="p-3 rounded-md border bg-muted/30">
                <code className="text-xs font-semibold text-foreground">P_grid_clearance</code>
                <p className="text-xs text-muted-foreground mt-1">
                  How much grid to draw before the battery is allowed to help.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="size-4 text-destructive" />
              Peak pricing &mdash; throttle &amp; preserve
            </CardTitle>
            <CardDescription>Limit EV charging, keep battery full for boost</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs overflow-x-auto">
              <pre>{`{
  "station": {
    "P_grid_clearance_w": 40000  // reduce grid usage
  },
  "chargers": [
    {
      "unit_id": 1,
      "P_cp_lim_w":     80000,   // cap EV at 80 kW
                                 // (forces battery assist)
      "soc_cp_max_pct": 95       // keep battery topped up
    }
  ]
}`}</pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="size-4 text-green-600" />
              Cheap hours &mdash; open the taps
            </CardTitle>
            <CardDescription>Maximise grid-to-EV and grid-to-battery</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs overflow-x-auto">
              <pre>{`{
  "station": {
    "P_grid_clearance_w": 87000  // full grid capacity
  },
  "chargers": [
    {
      "unit_id": 1,
      "P_cp_lim_w":     300000,  // no EV throttle
      "soc_cp_max_pct": 95       // charge battery to max
    }
  ]
}`}</pre>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Coupled mode <span className="text-muted-foreground font-normal">&mdash; <code className="text-xs">charging_mode = 2</code></span>
            </CardTitle>
            <CardDescription>One EV, maximum power</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" /> Both power units serve one connector</li>
              <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" /> Up to 300&nbsp;kW to a single EV</li>
              <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" /> 220&nbsp;kW battery discharge available</li>
              <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" /> Use case: ultrafast charging demand</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Single mode <span className="text-muted-foreground font-normal">&mdash; <code className="text-xs">charging_mode = 1</code></span>
            </CardTitle>
            <CardDescription>Two EVs, split power</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" /> Each power unit serves its own connector</li>
              <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" /> Up to 150&nbsp;kW per EV</li>
              <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" /> Two EVs charging simultaneously</li>
              <li className="flex gap-2"><CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" /> Use case: multiple vehicles on site</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Separator className="my-8" />

      {/* Detailed Documentation Links */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Detailed Documentation</CardTitle>
          <CardDescription>For technical implementation details, refer to these pages</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link href="/comm-architecture" className="block p-4 rounded-lg border hover:border-primary/50 hover:bg-primary/5 transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <Cable className="size-4 text-primary" />
                <span className="font-semibold">Comm Architecture</span>
              </div>
              <p className="text-sm text-muted-foreground">API patterns, data flows, security</p>
            </Link>

            <Link href="/middleware-api" className="block p-4 rounded-lg border hover:border-primary/50 hover:bg-primary/5 transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="size-4 text-primary" />
                <span className="font-semibold">Middleware API</span>
              </div>
              <p className="text-sm text-muted-foreground">Telemetry schema, command schema, field definitions</p>
            </Link>

            <Link href="/onboarding-config" className="block p-4 rounded-lg border hover:border-primary/50 hover:bg-primary/5 transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <Settings className="size-4 text-primary" />
                <span className="font-semibold">Onboarding & Config</span>
              </div>
              <p className="text-sm text-muted-foreground">Configuration API, deployment phases, config schema</p>
            </Link>

            <Link href="/exception-handling" className="block p-4 rounded-lg border hover:border-primary/50 hover:bg-primary/5 transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className="size-4 text-primary" />
                <span className="font-semibold">Exception Handling</span>
              </div>
              <p className="text-sm text-muted-foreground">Complete failure scenarios, fallback behaviors</p>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
