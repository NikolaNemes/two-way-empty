"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { 
  Cable,
  Cloud,
  Server,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Shield,
  Clock,
  Database,
  Layers,
  Lock,
  Key,
  RefreshCw,
  Zap,
} from "lucide-react"

export function CommArchitectureScreen() {
  return (
    <div className="w-full py-8 px-6">
      <div className="space-y-3 mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Communication Architecture</h1>
        <p className="text-muted-foreground text-lg">
          API integration patterns between Enexa and Middleware
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="text-muted-foreground">Legend:</span>
          <Badge variant="outline" className="border-green-600/40 text-green-700 bg-green-500/5 font-normal">
            <CheckCircle2 className="size-3 mr-1" />
            Pilot &mdash; in scope now
          </Badge>
          <Badge variant="outline" className="border-amber-500/50 text-amber-700 bg-amber-500/5 font-normal">
            <Clock className="size-3 mr-1" />
            Future state &mdash; post-pilot
          </Badge>
          <span className="text-muted-foreground italic">
            Items tagged &ldquo;Future state&rdquo; describe the target operating model and are not part of the pilot contract.
          </span>
        </div>
      </div>

      {/* Key Terminology */}
      <Card className="mb-8 border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5 text-primary" />
            Key Terminology
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="p-3 rounded-lg bg-background border">
              <p className="font-semibold text-primary mb-1">Enexa</p>
              <p className="text-muted-foreground">
                Cloud-based optimization platform that manages asset registry, configuration, and dispatch scheduling.
                Sends commands to Middleware and receives telemetry data.
                <span className="block mt-1 text-xs italic">Enexa is responsible for the platform, dashboards, and optimization algorithms.</span>
              </p>
            </div>
            <div className="p-3 rounded-lg bg-background border">
              <p className="font-semibold text-orange-600 mb-1">Middleware</p>
              <p className="text-muted-foreground">
                Centralized backend that handles communication with ADS-TEC ChargePost hardware.
                Exposes REST API for Enexa integration and translates commands to Modbus/TCP registers.
                <span className="block mt-1 text-xs italic">Amperio is responsible for the Middleware and all ChargePost communication.</span>
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            The Modbus/TCP communication between Middleware and ChargePost units is internal to Amperio&apos;s implementation.
            Enexa only interacts with the Middleware REST API.
          </p>
        </CardContent>
      </Card>

      {/* Integration Overview */}
      <Card className="mb-8 border-green-500/50">
        <CardHeader className="border-b bg-green-500/5">
          <CardTitle className="flex items-center gap-2">
            <Layers className="size-5 text-green-600" />
            Integration Architecture
          </CardTitle>
          <CardDescription>
            Simplified API-based integration between Enexa and Amperio systems
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {/* Architecture Diagram */}
          <div className="bg-muted/20 rounded-xl p-6 mb-6">
            <div className="grid grid-cols-1 gap-4 max-w-4xl mx-auto">
              {/* Layer 1: Enexa */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Cloud className="size-5 text-blue-600" />
                  <span className="font-semibold text-blue-600">Enexa</span>
                  <Badge variant="outline" className="ml-auto text-blue-600 border-blue-600">Enexa-hosted</Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="bg-background rounded p-2 text-center text-xs">
                    <p className="font-semibold">Asset Registry</p>
                    <p className="text-muted-foreground">Master data</p>
                  </div>
                  <div className="bg-background rounded p-2 text-center text-xs">
                    <p className="font-semibold">Config Repository</p>
                    <p className="text-muted-foreground">Central settings</p>
                  </div>
                  <div className="bg-background rounded p-2 text-center text-xs">
                    <p className="font-semibold">Optimization Engine</p>
                    <p className="text-muted-foreground">SOC / Arbitrage</p>
                  </div>
                  <div className="bg-background rounded p-2 text-center text-xs">
                    <p className="font-semibold">Dashboards</p>
                    <p className="text-muted-foreground">Monitoring</p>
                  </div>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <div className="flex flex-col items-center text-muted-foreground">
                  <ArrowDown className="size-6" />
                  <div className="px-4 py-2 bg-background border rounded-lg text-center">
                    <p className="text-xs font-semibold">REST API over HTTPS</p>
                    <p className="text-xs text-muted-foreground">Commands & Telemetry</p>
                  </div>
                  <ArrowUp className="size-6" />
                </div>
              </div>

              {/* Layer 2: Middleware */}
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Server className="size-5 text-orange-600" />
                  <span className="font-semibold text-orange-600">Middleware</span>
                  <Badge variant="outline" className="ml-auto text-orange-600 border-orange-600">Amperio-hosted</Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-background rounded p-2 text-center text-xs">
                    <p className="font-semibold">API Gateway</p>
                    <p className="text-muted-foreground">Enexa integration</p>
                  </div>
                  <div className="bg-background rounded p-2 text-center text-xs">
                    <p className="font-semibold">Modbus Client</p>
                    <p className="text-muted-foreground">Register read/write</p>
                  </div>
                  <div className="bg-background rounded p-2 text-center text-xs">
                    <p className="font-semibold">Watchdog Manager</p>
                    <p className="text-muted-foreground">2-60s heartbeat</p>
                  </div>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <div className="flex flex-col items-center text-muted-foreground">
                  <ArrowDown className="size-6" />
                  <div className="px-4 py-2 bg-muted/50 border rounded-lg text-center">
                    <p className="text-xs font-semibold">Modbus/TCP (Internal)</p>
                    <p className="text-xs text-muted-foreground">Port 502, Function Codes 03/04/06/16</p>
                  </div>
                  <ArrowUp className="size-6" />
                </div>
              </div>

              {/* Layer 3: Field Devices */}
              <div className="bg-muted/50 border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="size-5 text-gray-600" />
                  <span className="font-semibold text-gray-600">ADS-TEC ChargePost Hardware</span>
                  <Badge variant="outline" className="ml-auto">Amperio-managed</Badge>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Ultrafast charging (up to 300kW), integrated battery storage (2x 110kW units), grid metering - all via Modbus interface v2.6
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/30 text-sm">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-5 text-green-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-green-700 mb-1">Clean Separation of Concerns</p>
                <p className="text-muted-foreground">
                  Enexa handles optimization, configuration, and UI. Amperio handles all IoT communication and hardware control.
                  The integration point is a well-defined REST API between the two platforms.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API Communication Patterns */}
      <Card className="mb-8">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Cable className="size-5 text-primary" />
            API Communication Patterns
          </CardTitle>
          <CardDescription>
            How data flows between Enexa and Amperio
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {/* API Ownership Legend */}
          <div className="mb-6 p-4 bg-muted/30 rounded-lg border">
            <h4 className="font-semibold mb-3">API Ownership Guide</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <div className="shrink-0">
                  <Badge className="bg-blue-600">Hosted by Enexa</Badge>
                </div>
                <div>
                  <p className="font-medium">Enexa provides the API endpoint</p>
                  <p className="text-muted-foreground text-xs">Amperio calls these APIs to fetch data or push telemetry</p>
                  <p className="text-xs mt-1 font-mono text-blue-600">api.enexa.io/*</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                <div className="shrink-0">
                  <Badge className="bg-orange-600">Hosted by Amperio</Badge>
                </div>
                <div>
                  <p className="font-medium">Amperio provides the API endpoint</p>
                  <p className="text-muted-foreground text-xs">Enexa calls these APIs to dispatch commands</p>
                  <p className="text-xs mt-1 font-mono text-orange-600">api.amperio.io/*</p>
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Commands: Enexa to Amperio */}
            <div className="border rounded-lg p-4 border-orange-500/30">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <ArrowDown className="size-4 text-orange-600" />
                  Dispatch Commands
                </h3>
                <Badge className="bg-orange-600">Hosted by Amperio</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Enexa calls Amperio&apos;s API to send commands</p>
              <div className="bg-muted/30 rounded-lg p-3 mb-3 font-mono text-xs">
                <p className="text-orange-600 font-semibold">// Amperio hosts this endpoint</p>
                <p>POST https://api.amperio.io/v1/dispatch</p>
                <p>Authorization: Bearer {`{token}`}</p>
                <p className="mt-2">{`{`}</p>
                <p className="pl-4">{`"site_id": "SITE001",`}</p>
                <p className="pl-4">{`"command": "set_battery_power",`}</p>
                <p className="pl-4">{`"params": { "power_kw": -25 },`}</p>
                <p className="pl-4">{`"timestamp": "2024-01-15T10:00:00Z"`}</p>
                <p>{`}`}</p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Enexa initiates all commands</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Amperio routes to correct site controller internally</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Response includes acknowledgment status</span>
                </div>
              </div>
            </div>

            {/* Telemetry: Amperio to Enexa */}
            <div className="border rounded-lg p-4 border-blue-500/30">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <ArrowUp className="size-4 text-blue-600" />
                  Telemetry Data
                </h3>
                <Badge className="bg-blue-600">Hosted by Enexa</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Amperio calls Enexa&apos;s API to push telemetry</p>
              <div className="bg-muted/30 rounded-lg p-3 mb-3 font-mono text-xs">
                <p className="text-blue-600 font-semibold">// Enexa hosts this endpoint</p>
                <p>POST https://api.enexa.io/v1/telemetry</p>
                <p>Authorization: Bearer {`{token}`}</p>
                <p className="mt-2">{`{`}</p>
                <p className="pl-4">{`"site_id": "SITE001",`}</p>
                <p className="pl-4">{`"timestamp": "2024-01-15T10:00:01Z",`}</p>
                <p className="pl-4">{`"battery": { "soc_pct": 65, ... },`}</p>
                <p className="pl-4">{`"grid": { "import_kw": 35, ... }`}</p>
                <p>{`}`}</p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Amperio aggregates data from site controllers</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>
                    Push frequency:{" "}
                    <code className="text-[11px] font-mono bg-muted px-1 py-0.5 rounded">
                      telemetry.report_interval_s
                    </code>{" "}
                    &mdash; default <strong>1 s</strong>, configurable (1&ndash;60 s) via Config API
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Enexa stores and processes for optimization</span>
                </div>
              </div>
            </div>

            {/* Configuration: Enexa to Amperio */}
            <div className="border rounded-lg p-4 border-amber-500/40 bg-amber-500/5">
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <h3 className="font-semibold flex items-center gap-2">
                  <ArrowDown className="size-4 text-blue-600" />
                  Configuration Sync
                </h3>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-amber-500/50 text-amber-700 bg-amber-500/10 font-normal text-[10px]">
                    <Clock className="size-3 mr-1" />
                    Future state
                  </Badge>
                  <Badge className="bg-blue-600">Hosted by Enexa</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Amperio calls Enexa&apos;s API to fetch configuration</p>
              <div className="bg-muted/30 rounded-lg p-3 mb-3 font-mono text-xs">
                <p className="text-blue-600 font-semibold">// Enexa hosts this endpoint</p>
                <p>GET https://api.enexa.io/v1/config/{`{site_id}`}</p>
                <p>Authorization: Bearer {`{token}`}</p>
                <p className="mt-2 text-muted-foreground">// Returns site configuration</p>
                <p>{`{ "battery": {...}, "grid": {...} }`}</p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Enexa is master for configuration</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Amperio polls on startup and periodically</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Version tracking for change detection</span>
                </div>
              </div>
              <p className="mt-3 pt-3 border-t border-amber-500/20 text-[11px] text-amber-800/90">
                <strong>Pilot note:</strong> for the pilot, site configuration is exchanged
                out-of-band during onboarding (CSV / spreadsheet) and held by Amperio.
                Enexa-hosted config distribution is part of the post-pilot target model.
              </p>
            </div>

            {/* Status Updates */}
            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  <RefreshCw className="size-4 text-gray-600" />
                  Status & Health
                </h3>
                <Badge variant="outline">Both systems host APIs</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Each system exposes health endpoints</p>
              <div className="bg-muted/30 rounded-lg p-3 mb-3 font-mono text-xs">
                <p className="text-blue-600 font-semibold">// Enexa hosts - Amperio calls to report status</p>
                <p>POST https://api.enexa.io/v1/status</p>
                <p className="mt-2">{`{ "site_id": "SITE001", "online": true }`}</p>
                <p className="mt-2 text-orange-600 font-semibold">// Amperio hosts - Enexa calls to check health</p>
                <p>GET https://api.amperio.io/v1/health</p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Site online/offline status</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Middleware health monitoring</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-green-500 mt-0.5 shrink-0" />
                  <span>Alert propagation</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Master Data & Onboarding APIs */}
      <Card className="mb-8">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5 text-primary" />
            Master Data & Onboarding APIs
          </CardTitle>
          <CardDescription>
            APIs for asset registry, controller settings, and onboarding process
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm">
            <p className="text-muted-foreground">
              <strong>Single Source of Truth:</strong> Enexa stores all asset master data, configuration, and firmware information. 
              Middleware fetches this data via API, ensuring consistency across all sites and controllers.
            </p>
          </div>

          {/* Asset Registry APIs */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <h3 className="font-semibold text-blue-600">Asset Registry APIs</h3>
              <Badge className="bg-blue-600">Hosted by Enexa</Badge>
              <span className="text-xs text-muted-foreground">Amperio calls these to fetch master data</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-blue-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowDown className="size-4 text-blue-600" />
                  <span className="font-mono text-sm">GET /v1/sites</span>
                </div>
                <p className="text-sm text-muted-foreground mb-2">List all sites accessible to the middleware</p>
                <div className="bg-muted/30 rounded p-2 font-mono text-xs">
                  <p>{`{ "sites": [{ "id": "SITE001", "name": "..." }] }`}</p>
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowDown className="size-4 text-blue-600" />
                  <span className="font-mono text-sm">GET /v1/sites/{`{site_id}`}/assets</span>
                </div>
                <p className="text-sm text-muted-foreground mb-2">Get all equipment registered at a site</p>
                <div className="bg-muted/30 rounded p-2 font-mono text-xs">
                  <p>{`{ "battery": {...}, "chargers": [...], "meters": [...] }`}</p>
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowDown className="size-4 text-blue-600" />
                  <span className="font-mono text-sm">GET /v1/controllers/{`{controller_id}`}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-2">Get controller details and assigned assets</p>
                <div className="bg-muted/30 rounded p-2 font-mono text-xs">
                  <p>{`{ "id": "CTRL001", "assets": ["BAT1", "CHG1"] }`}</p>
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowDown className="size-4 text-blue-600" />
                  <span className="font-mono text-sm">GET /v1/equipment/{`{type}`}/{`{id}`}/specs</span>
                </div>
                <p className="text-sm text-muted-foreground mb-2">Get equipment specifications (capacity, limits)</p>
                <div className="bg-muted/30 rounded p-2 font-mono text-xs">
                  <p>{`{ "capacity_kwh": 200, "max_power_kw": 100 }`}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Controller Settings APIs */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <h3 className="font-semibold text-blue-600">Controller Settings APIs</h3>
              <Badge className="bg-blue-600">Hosted by Enexa</Badge>
              <span className="text-xs text-muted-foreground">Amperio calls these to fetch/sync configuration</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowDown className="size-4 text-purple-600" />
                  <span className="font-mono text-sm">GET /v1/controllers/{`{id}`}/config</span>
                </div>
                <p className="text-sm text-muted-foreground mb-2">Fetch full controller configuration</p>
                <div className="bg-muted/30 rounded p-2 font-mono text-xs">
                  <p>{`{ "version": 5, "settings": {...}, "limits": {...} }`}</p>
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowDown className="size-4 text-purple-600" />
                  <span className="font-mono text-sm">GET /v1/controllers/{`{id}`}/config/version</span>
                </div>
                <p className="text-sm text-muted-foreground mb-2">Check if config has changed (for polling)</p>
                <div className="bg-muted/30 rounded p-2 font-mono text-xs">
                  <p>{`{ "version": 5, "updated_at": "2024-01-15T..." }`}</p>
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowDown className="size-4 text-purple-600" />
                  <span className="font-mono text-sm">GET /v1/firmware/latest/{`{device_type}`}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-2">Get latest available firmware version</p>
                <div className="bg-muted/30 rounded p-2 font-mono text-xs">
                  <p>{`{ "version": "2.1.0", "url": "...", "sha256": "..." }`}</p>
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ArrowUp className="size-4 text-orange-600" />
                  <span className="font-mono text-sm">POST /v1/controllers/{`{id}`}/firmware/status</span>
                </div>
                <p className="text-sm text-muted-foreground mb-2">Report current firmware version to Enexa</p>
                <div className="bg-muted/30 rounded p-2 font-mono text-xs">
                  <p>{`{ "current_version": "2.0.5", "status": "ok" }`}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Onboarding APIs */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <h3 className="font-semibold text-blue-600">Onboarding APIs</h3>
              <Badge className="bg-blue-600">Hosted by Enexa</Badge>
              <span className="text-xs text-muted-foreground">Amperio calls these during site setup</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-cyan-600">Step 1</span>
                </div>
                <span className="font-mono text-sm">POST /v1/controllers/register</span>
                <p className="text-sm text-muted-foreground mt-2">Register new controller with Enexa, receive credentials</p>
                <div className="bg-muted/30 rounded p-2 font-mono text-xs mt-2">
                  <p>Request: {`{ "serial": "...", "site_id": "..." }`}</p>
                  <p>Response: {`{ "api_key": "...", "config_url": "..." }`}</p>
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-cyan-600">Step 2</span>
                </div>
                <span className="font-mono text-sm">GET /v1/controllers/{`{id}`}/bootstrap</span>
                <p className="text-sm text-muted-foreground mt-2">Fetch initial configuration for first-time setup</p>
                <div className="bg-muted/30 rounded p-2 font-mono text-xs mt-2">
                  <p>Response: {`{ "config": {...}, "assets": [...] }`}</p>
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-cyan-600">Step 3</span>
                </div>
                <span className="font-mono text-sm">POST /v1/controllers/{`{id}`}/activate</span>
                <p className="text-sm text-muted-foreground mt-2">Confirm successful setup and go live</p>
                <div className="bg-muted/30 rounded p-2 font-mono text-xs mt-2">
                  <p>Request: {`{ "status": "ready", "tests_passed": true }`}</p>
                  <p>Response: {`{ "activated": true }`}</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card className="mb-8">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Shield className="size-5 text-primary" />
            Security Requirements
          </CardTitle>
          <CardDescription>
            Authentication and data protection
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Lock className="size-5 text-primary mt-0.5" />
                <div>
                  <p className="font-semibold">TLS Encryption</p>
                  <p className="text-sm text-muted-foreground">All API communication over HTTPS with TLS 1.3</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Key className="size-5 text-primary mt-0.5" />
                <div>
                  <p className="font-semibold">OAuth 2.0 / API Keys</p>
                  <p className="text-sm text-muted-foreground">Bearer token authentication for all API calls</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Shield className="size-5 text-primary mt-0.5" />
                <div>
                  <p className="font-semibold">IP Allowlisting</p>
                  <p className="text-sm text-muted-foreground">Optional: restrict API access to known IPs</p>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Clock className="size-5 text-primary mt-0.5" />
                <div>
                  <p className="font-semibold">Token Expiry</p>
                  <p className="text-sm text-muted-foreground">Access tokens expire after 1 hour, refresh tokens for renewal</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Database className="size-5 text-primary mt-0.5" />
                <div>
                  <p className="font-semibold">Audit Logging</p>
                  <p className="text-sm text-muted-foreground">All API calls logged with timestamp, source, action</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-5 text-primary mt-0.5" />
                <div>
                  <p className="font-semibold">Rate Limiting</p>
                  <p className="text-sm text-muted-foreground">API rate limits to prevent abuse (configurable)</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Handling */}
      <Card className="mb-8">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-primary" />
            API Error Handling
          </CardTitle>
          <CardDescription>
            How to handle communication failures
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <XCircle className="size-4 text-red-500" />
                  Enexa Cannot Reach Amperio
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>- Retry with exponential backoff (1s, 2s, 4s, ...)</li>
                  <li>- Queue commands for later delivery</li>
                  <li>- Alert operators after 60 seconds</li>
                  <li>- Dashboard shows middleware status</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg border">
                <h4 className="font-semibold mb-2 flex items-center gap-2">
                  <XCircle className="size-4 text-red-500" />
                  Amperio Cannot Reach Enexa
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>- Continue with last known schedule</li>
                  <li>- Buffer telemetry locally (up to 24 hours)</li>
                  <li>- Switch to fallback mode after 60 seconds</li>
                  <li>- Replay buffered data when reconnected</li>
                </ul>
              </div>
            </div>

            {/* Disconnection Handling - Both Sides */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Amperio Side */}
              <div className="p-4 rounded-lg border border-orange-500/30 bg-orange-500/5">
                <h4 className="font-semibold mb-3 flex items-center gap-2 text-orange-600">
                  <Database className="size-4" />
                  Amperio Disconnection Handling
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  When Enexa API is unreachable, Middleware must buffer data locally:
                </p>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="font-medium mb-1">1. Telemetry Buffering</p>
                    <ul className="text-muted-foreground space-y-1 text-xs">
                      <li>- Continue collecting telemetry at normal intervals</li>
                      <li>- Store in local buffer with timestamps</li>
                      <li>- Maintain buffer for minimum 24 hours</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium mb-1">2. Event Logging</p>
                    <ul className="text-muted-foreground space-y-1 text-xs">
                      <li>- Log all EV session start/stop events</li>
                      <li>- Record fault occurrences with details</li>
                      <li>- Track mode changes and operator actions</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium mb-1">3. Local Autonomous Mode</p>
                    <ul className="text-muted-foreground space-y-1 text-xs">
                      <li>- Switch to fallback operation mode</li>
                      <li>- Use last known schedule if available</li>
                      <li>- Apply safety-first conservative limits</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium mb-1">4. Reconnection Flush</p>
                    <ul className="text-muted-foreground space-y-1 text-xs">
                      <li>- Transmit buffered telemetry in batches</li>
                      <li>- Send events in chronological order</li>
                      <li>- Confirm receipt before clearing buffer</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Enexa Side */}
              <div className="p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
                <h4 className="font-semibold mb-3 flex items-center gap-2 text-blue-600">
                  <RefreshCw className="size-4" />
                  Enexa Reconnection Procedure
                </h4>
              <p className="text-sm text-muted-foreground mb-3">
                When connection is re-established after an outage, Enexa must perform additional steps to ensure optimal operation:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium mb-1">1. State Synchronization</p>
                  <ul className="text-muted-foreground space-y-1 text-xs">
                    <li>- Fetch current telemetry from all sites</li>
                    <li>- Compare actual SOC with expected SOC</li>
                    <li>- Identify any missed EV sessions or events</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium mb-1">2. Schedule Re-evaluation</p>
                  <ul className="text-muted-foreground space-y-1 text-xs">
                    <li>- Re-run optimization with current state</li>
                    <li>- Generate new dispatch schedule</li>
                    <li>- Account for time elapsed during outage</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium mb-1">3. Command Re-dispatch</p>
                  <ul className="text-muted-foreground space-y-1 text-xs">
                    <li>- Send updated setpoints to middleware</li>
                    <li>- Verify command acknowledgment</li>
                    <li>- Log reconciliation actions</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium mb-1">4. Data Reconciliation</p>
                  <ul className="text-muted-foreground space-y-1 text-xs">
                    <li>- Process buffered telemetry from Amperio</li>
                    <li>- Update historical records</li>
                    <li>- Recalculate metrics for reporting</li>
                  </ul>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                <strong>Note:</strong> The re-planning process adds complexity as the optimizer must account for state drift during the disconnection period. 
                If the actual SOC diverges significantly from the planned SOC, the new schedule may differ substantially from the original plan.
              </p>
              </div>
            </div>

            <div className="bg-muted/30 rounded-lg p-4">
              <h4 className="font-semibold mb-2">Standard HTTP Error Codes</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="font-mono text-green-600">200 OK</p>
                  <p className="text-muted-foreground text-xs">Success</p>
                </div>
                <div>
                  <p className="font-mono text-yellow-600">401 Unauthorized</p>
                  <p className="text-muted-foreground text-xs">Invalid/expired token</p>
                </div>
                <div>
                  <p className="font-mono text-orange-600">429 Too Many Requests</p>
                  <p className="text-muted-foreground text-xs">Rate limited</p>
                </div>
                <div>
                  <p className="font-mono text-red-600">503 Service Unavailable</p>
                  <p className="text-muted-foreground text-xs">System down</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator className="my-8" />

      {/* Summary */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-primary mt-0.5 shrink-0" />
              <span><strong>Simple REST API integration</strong> - No complex IoT protocols for Enexa to implement</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-primary mt-0.5 shrink-0" />
              <span><strong>Clear ownership</strong> - Amperio owns IoT/MQTT, Enexa owns optimization/UI</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-primary mt-0.5 shrink-0" />
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span><strong>Enexa is master for configuration</strong> - Single source of truth for site settings</span>
                <Badge variant="outline" className="border-amber-500/50 text-amber-700 bg-amber-500/10 font-normal text-[10px]">
                  <Clock className="size-3 mr-1" />
                  Future state
                </Badge>
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-primary mt-0.5 shrink-0" />
              <span><strong>Standard security</strong> - HTTPS + OAuth 2.0, no special infrastructure</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-4 text-primary mt-0.5 shrink-0" />
              <span><strong>Graceful degradation</strong> - Both systems handle disconnection scenarios</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
