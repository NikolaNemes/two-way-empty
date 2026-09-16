"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import {
  CheckCircle2,
  Circle,
  Key,
  Zap,
  BatteryCharging,
  Sun,
  Car,
  AlertTriangle,
  Globe,
  ArrowRight,
} from "lucide-react"

export function OnboardingConfigScreen() {
  return (
    <div className="w-full py-8 px-6">
      {/* Header */}
      <div className="space-y-2 mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Onboarding &amp; Deployment</h1>
        <p className="text-muted-foreground max-w-3xl">
          Step-by-step process for bringing a new ChargePost site online with Enexa. Covers registration,
          hardware integration, sandbox testing, and production go-live. For the configuration data model
          and API contract, see the{" "}
          <Link href="/config-api" className="text-primary underline underline-offset-4 hover:no-underline">
            Config API
          </Link>{" "}
          page.
        </p>
      </div>

      {/* Overview */}
      <Card className="mb-8 border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-5 text-primary" />
            Enexa as Master Data Repository
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Enexa serves as the central source of truth for asset registry and configuration.
            Middleware fetches configuration from Enexa API and applies it to site controllers.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg border bg-blue-500/5 border-blue-500/20 text-center">
              <p className="text-3xl font-bold text-blue-600">1</p>
              <p className="font-semibold">Registration</p>
              <p className="text-xs text-muted-foreground">Site &amp; API credentials</p>
            </div>
            <div className="p-4 rounded-lg border bg-purple-500/5 border-purple-500/20 text-center">
              <p className="text-3xl font-bold text-purple-600">2</p>
              <p className="font-semibold">Configuration</p>
              <p className="text-xs text-muted-foreground">Assets &amp; parameters in Enexa</p>
            </div>
            <div className="p-4 rounded-lg border bg-orange-500/5 border-orange-500/20 text-center">
              <p className="text-3xl font-bold text-orange-600">3</p>
              <p className="font-semibold">Integration</p>
              <p className="text-xs text-muted-foreground">API connectivity testing</p>
            </div>
            <div className="p-4 rounded-lg border bg-green-500/5 border-green-500/20 text-center">
              <p className="text-3xl font-bold text-green-600">4</p>
              <p className="font-semibold">Go-Live</p>
              <p className="text-xs text-muted-foreground">Production optimization</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {/* Phase 1: Registration */}
        <Card>
          <CardHeader className="border-b bg-blue-500/5">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold">1</div>
              <div>
                <CardTitle>Phase 1: Site Registration</CardTitle>
                <CardDescription>Administrative setup in Enexa portal (Duration: 1-2 days)</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-green-500" />
                  NITES Responsibilities
                </h4>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-2">
                    <Circle className="size-3 mt-1.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Create Site Record</p>
                      <p className="text-muted-foreground">Unique site_id, customer association, billing setup</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <Circle className="size-3 mt-1.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Generate API Credentials</p>
                      <p className="text-muted-foreground">API key, secret, and MQTT certificates (X.509)</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <Circle className="size-3 mt-1.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Configure Sandbox Environment</p>
                      <p className="text-muted-foreground">Test endpoints, mock data, and logging enabled</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <Circle className="size-3 mt-1.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Deliver Onboarding Package</p>
                      <p className="text-muted-foreground">Credentials, certificates, and integration guide</p>
                    </div>
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-blue-500" />
                  Amperio Responsibilities
                </h4>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-2">
                    <Circle className="size-3 mt-1.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Provide Site Information</p>
                      <p className="text-muted-foreground">Location, grid connection capacity, hardware inventory</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <Circle className="size-3 mt-1.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Hardware Specifications</p>
                      <p className="text-muted-foreground">Battery model, PV capacity, charger count and types</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <Circle className="size-3 mt-1.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Network Connectivity</p>
                      <p className="text-muted-foreground">Internet connection type, static IP (if any), firewall rules</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <Circle className="size-3 mt-1.5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Technical Contact</p>
                      <p className="text-muted-foreground">Person responsible for integration and testing</p>
                    </div>
                  </li>
                </ul>
              </div>
            </div>

            <div className="bg-muted/30 rounded-lg p-4">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <Key className="size-4" />
                Deliverables from Enexa
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="bg-background rounded p-3 border">
                  <p className="font-mono text-xs text-muted-foreground">credentials.json</p>
                  <p className="text-muted-foreground mt-1">API key, secret, site_id, endpoints</p>
                </div>
                <div className="bg-background rounded p-3 border">
                  <p className="font-mono text-xs text-muted-foreground">certificates.zip</p>
                  <p className="text-muted-foreground mt-1">X.509 device cert, private key, CA chain</p>
                </div>
                <div className="bg-background rounded p-3 border">
                  <p className="font-mono text-xs text-muted-foreground">initial-config.json</p>
                  <p className="text-muted-foreground mt-1">Default site configuration for bootstrap</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Phase 2: Configuration */}
        <Card>
          <CardHeader className="border-b bg-purple-500/5">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-purple-500 text-white flex items-center justify-center font-bold">2</div>
              <div>
                <CardTitle>Phase 2: Site Configuration</CardTitle>
                <CardDescription>Hardware setup and parameter tuning (Duration: 2-3 days)</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold mb-3">Edge Gateway Setup</h4>
                <ol className="space-y-3 text-sm">
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 size-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">1</span>
                    <div>
                      <p className="font-medium">Install Gateway Software</p>
                      <p className="text-muted-foreground">Flash firmware image to edge device (Raspberry Pi, industrial PC, etc.)</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 size-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">2</span>
                    <div>
                      <p className="font-medium">Load Certificates</p>
                      <p className="text-muted-foreground">Copy X.509 certificates to secure storage on device</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 size-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">3</span>
                    <div>
                      <p className="font-medium">Bootstrap Configuration</p>
                      <p className="text-muted-foreground">Load initial-config.json, device auto-registers with Enexa</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 size-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">4</span>
                    <div>
                      <p className="font-medium">Fetch Full Configuration</p>
                      <p className="text-muted-foreground">Device calls Config API to get complete site setup</p>
                    </div>
                  </li>
                </ol>
              </div>
              <div>
                <h4 className="font-semibold mb-3">Hardware Integration</h4>
                <ol className="space-y-3 text-sm">
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 size-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">5</span>
                    <div>
                      <p className="font-medium">Connect BMS</p>
                      <p className="text-muted-foreground">RS485/CAN connection to battery management system</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 size-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">6</span>
                    <div>
                      <p className="font-medium">Connect PV Inverter</p>
                      <p className="text-muted-foreground">Modbus/SunSpec communication to solar inverter</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 size-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">7</span>
                    <div>
                      <p className="font-medium">Connect EV Chargers</p>
                      <p className="text-muted-foreground">OCPP 1.6/2.0 connection to charge points</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 size-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">8</span>
                    <div>
                      <p className="font-medium">Connect Grid Meter</p>
                      <p className="text-muted-foreground">Pulse counter or Modbus energy meter</p>
                    </div>
                  </li>
                </ol>
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="font-semibold mb-3">Configuration via Enexa Portal</h4>
              <p className="text-sm text-muted-foreground mb-4">
                Enexa is the master for all site configuration. Middleware fetches configuration
                from Enexa&apos;s Config API and applies it to site controllers. See the{" "}
                <Link href="/config-api" className="text-primary underline underline-offset-4 hover:no-underline">
                  Config API page
                </Link>{" "}
                for the full schema and field reference.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg border">
                  <BatteryCharging className="size-5 text-green-500 mb-2" />
                  <p className="font-medium text-sm">Battery Settings</p>
                  <p className="text-xs text-muted-foreground">Capacity, SOC limits, charge/discharge rates</p>
                </div>
                <div className="p-3 rounded-lg border">
                  <Sun className="size-5 text-yellow-500 mb-2" />
                  <p className="font-medium text-sm">PV Settings</p>
                  <p className="text-xs text-muted-foreground">Peak capacity, orientation, efficiency</p>
                </div>
                <div className="p-3 rounded-lg border">
                  <Car className="size-5 text-blue-500 mb-2" />
                  <p className="font-medium text-sm">Charger Settings</p>
                  <p className="text-xs text-muted-foreground">Connector types, power limits, OCPP config</p>
                </div>
                <div className="p-3 rounded-lg border">
                  <Zap className="size-5 text-orange-500 mb-2" />
                  <p className="font-medium text-sm">Grid Settings</p>
                  <p className="text-xs text-muted-foreground">Import/export limits, tariff zones</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Phase 3: Testing */}
        <Card>
          <CardHeader className="border-b bg-orange-500/5">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold">3</div>
              <div>
                <CardTitle>Phase 3: Integration Testing</CardTitle>
                <CardDescription>Validate all systems in sandbox environment (Duration: 1-2 weeks)</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold mb-3">Functional Tests</h4>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <Circle className="size-3 text-muted-foreground" />
                    <span>Telemetry data reaches Enexa (all fields populated)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Circle className="size-3 text-muted-foreground" />
                    <span>Commands are received and executed by middleware</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Circle className="size-3 text-muted-foreground" />
                    <span>Battery charges and discharges on command</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Circle className="size-3 text-muted-foreground" />
                    <span>EV charging starts/stops/throttles correctly</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Circle className="size-3 text-muted-foreground" />
                    <span>PV production data is accurate</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Circle className="size-3 text-muted-foreground" />
                    <span>Grid meter readings match utility meter</span>
                  </li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-3">Failure Injection Tests</h4>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <AlertTriangle className="size-3 text-orange-500" />
                    <span>Cloud disconnect (60s timeout to autonomous mode)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <AlertTriangle className="size-3 text-orange-500" />
                    <span>BMS communication failure (safe state)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <AlertTriangle className="size-3 text-orange-500" />
                    <span>E-stop activation (immediate shutdown)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <AlertTriangle className="size-3 text-orange-500" />
                    <span>Grid outage detection (island mode or shutdown)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <AlertTriangle className="size-3 text-orange-500" />
                    <span>Invalid command rejection (safety bounds)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <AlertTriangle className="size-3 text-orange-500" />
                    <span>Certificate expiry simulation</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="bg-orange-500/10 rounded-lg p-4 border border-orange-500/20">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <AlertTriangle className="size-4 text-orange-500" />
                Acceptance Criteria
              </h4>
              <ul className="text-sm space-y-1">
                <li>- All functional tests pass for 48 continuous hours</li>
                <li>- All failure injection tests demonstrate correct fallback behavior</li>
                <li>- Telemetry latency p95 &lt; 2 seconds</li>
                <li>- Command execution latency p95 &lt; 500ms</li>
                <li>- No data loss during brief (&lt;5 min) connectivity interruptions</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Phase 4: Go-Live */}
        <Card>
          <CardHeader className="border-b bg-green-500/5">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-green-500 text-white flex items-center justify-center font-bold">4</div>
              <div>
                <CardTitle>Phase 4: Production Go-Live</CardTitle>
                <CardDescription>Switch to production and monitored operation (Duration: 48 hours monitored)</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg border">
                <h4 className="font-semibold mb-2">Pre-Launch Checklist</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>- Production certificates installed</li>
                  <li>- Production API endpoints configured</li>
                  <li>- Alerting contacts verified</li>
                  <li>- Backup communication path tested</li>
                  <li>- Local autonomous mode validated</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg border">
                <h4 className="font-semibold mb-2">Launch Day</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>- Switch sandbox to production config</li>
                  <li>- Enexa support on standby</li>
                  <li>- Real-time monitoring dashboard active</li>
                  <li>- First EV charging session supervised</li>
                  <li>- First battery cycle supervised</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg border">
                <h4 className="font-semibold mb-2">Post-Launch (48h)</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>- Monitor all systems continuously</li>
                  <li>- Review optimization performance</li>
                  <li>- Address any edge cases</li>
                  <li>- Sign-off meeting with Amperio</li>
                  <li>- Transition to standard support</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cross-link to Config API */}
        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardContent className="pt-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h4 className="font-semibold mb-1">Looking for configuration details?</h4>
              <p className="text-sm text-muted-foreground max-w-2xl">
                The site schema, API endpoints, versioning, signing, and field reference have moved to a
                dedicated page.
              </p>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <Link href="/config-api" className="flex items-center gap-2">
                Open Config API
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
