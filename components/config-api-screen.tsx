"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Database,
  Download,
  RefreshCw,
  FileJson,
  Lock,
  Server,
  ArrowRight,
  CheckCircle2,
  BatteryCharging,
  Sun,
  Car,
  Zap,
  Settings,
  Bell,
  History,
  ShieldCheck,
  AlertTriangle,
  BookOpen,
  Cpu,
  Cable,
} from "lucide-react"

export function ConfigApiScreen() {
  return (
    <div className="w-full py-8 px-6 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] tracking-wider uppercase">
            Enexa &rarr; Middleware
          </Badge>
          <Badge variant="outline" className="text-[10px] tracking-wider uppercase">
            Pull-based
          </Badge>
          <Badge variant="outline" className="text-[10px] tracking-wider uppercase">
            HTTPS / JSON
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Config API</h1>
        <p className="text-muted-foreground max-w-3xl leading-relaxed">
          The interface Middleware uses to pull authoritative site configuration
          from Enexa. Everything that describes <em>what a site looks like</em> &mdash; assets,
          limits, tariffs, safety thresholds, optimization policy &mdash; is owned by Enexa
          and delivered through this API.
        </p>
      </div>

      {/* Narrative / What is it */}
      <Card className="border-primary/30 bg-primary/[0.02]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            What the Config API is for
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <p>
            A ChargePost site is defined by dozens of parameters: grid connection capacity,
            battery chemistry and SOC limits, charger power envelopes, tariff and feed-in
            rates, safety interlocks, alert recipients, and the optimization policy that
            ties it all together. <strong>Enexa is the master source of truth</strong> for every one of
            those values &mdash; operators edit them once in the Enexa portal, and they are
            versioned, signed, and published through the Config API.
          </p>
          <p>
            <strong>Middleware is the consumer.</strong> At startup and on a periodic
            schedule, the middleware calls this API to fetch the latest config for each
            site it controls. It then translates those parameters into the runtime
            constraints it enforces over Modbus (ADS-TEC ChargePost), OCPP (individual
            chargers), and other downstream protocols.
          </p>
          <p className="text-muted-foreground">
            Without this API, every site change would require a manual truck-roll or an
            out-of-band SSH session. With it, a dispatcher can raise a grid export limit,
            rotate an alert recipient, or retune the optimization risk factor from a web UI
            and have all affected sites reflect the change within minutes.
          </p>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Key principles</h4>
              <ul className="text-sm space-y-1.5 text-muted-foreground">
                <li className="flex gap-2"><span className="text-primary">-</span> Enexa owns the data; middleware reads, never writes.</li>
                <li className="flex gap-2"><span className="text-primary">-</span> Pull-based &mdash; device initiates requests, no inbound firewall holes.</li>
                <li className="flex gap-2"><span className="text-primary">-</span> Versioned with monotonic <code className="text-xs">config_version</code> and ETag.</li>
                <li className="flex gap-2"><span className="text-primary">-</span> Cryptographically signed &mdash; device verifies before applying.</li>
                <li className="flex gap-2"><span className="text-primary">-</span> Idempotent acknowledgments close the loop back to Enexa.</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Who uses it</h4>
              <ul className="text-sm space-y-1.5 text-muted-foreground">
                <li className="flex gap-2"><span className="text-primary">-</span> <strong>Middleware</strong> &mdash; primary consumer, one request per site.</li>
                <li className="flex gap-2"><span className="text-primary">-</span> <strong>Enexa Portal</strong> &mdash; produces config via admin UI.</li>
                <li className="flex gap-2"><span className="text-primary">-</span> <strong>Ops tooling</strong> &mdash; CI pipelines apply bulk config via Enexa backend.</li>
                <li className="flex gap-2"><span className="text-primary">-</span> <strong>Audit &amp; compliance</strong> &mdash; history endpoint for change logs.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data flow */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="size-5 text-primary" />
            How config flows end-to-end
          </CardTitle>
          <CardDescription>
            Push-first: Enexa notifies Middleware the moment a new version is published; Middleware fans out to the edge over MQTT; the edge pulls the signed payload from Enexa. Polling is fallback only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border bg-primary/5 border-primary/30 p-4 text-sm">
            <p className="font-semibold mb-1 flex items-center gap-2">
              <Bell className="size-4 text-primary" />
              Delivery model (primary vs. fallback)
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Primary:</strong> event-driven push. When Enexa publishes a new <code className="text-xs">config_version</code>, it calls the Amperio-hosted <code className="text-xs">POST /internal/config/notify</code> webhook; the Middleware immediately publishes an MQTT notification on <code className="text-xs">amperio/sites/&#123;id&#125;/config/updated</code> to the edge controller, which pulls the signed payload from Enexa and applies it (typical end-to-end latency &lt; 2 s).
            </p>
            <p className="text-muted-foreground mt-2">
              <strong className="text-foreground">Fallback:</strong> time-based polling. If the edge controller loses its MQTT session (network outage, broker restart) or missed a notification during a cold boot, it falls back to polling <code className="text-xs">GET /config/&#123;site_id&#125;/version</code> every 15 minutes with ETag. This guarantees eventual consistency even when push fails.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-center">
            <FlowStep icon={Server} label="1. Edit in Portal" sub="Ops / admin changes a value in Enexa" color="blue" />
            <ArrowRight className="size-5 text-muted-foreground mx-auto hidden md:block" />
            <FlowStep icon={Database} label="2. Version & Sign" sub="Enexa bumps config_version, signs payload" color="blue" />
            <ArrowRight className="size-5 text-muted-foreground mx-auto hidden md:block" />
            <FlowStep icon={Bell} label="3. Webhook → Amperio" sub="Enexa calls POST /internal/config/notify on Amperio MW" color="orange" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-center">
            <FlowStep icon={Cable} label="4. MQTT Fan-out" sub="Amperio MW publishes amperio/sites/{id}/config/updated" color="orange" />
            <ArrowRight className="size-5 text-muted-foreground mx-auto hidden md:block" />
            <FlowStep icon={Download} label="5. Edge Pulls" sub="Controller GETs /config/{site_id} from Enexa" color="green" />
            <ArrowRight className="size-5 text-muted-foreground mx-auto hidden md:block" />
            <FlowStep icon={ShieldCheck} label="6. Verify, Apply & Ack" sub="Signature check, runtime update, POST /ack back to Enexa" color="green" />
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-4 rounded-lg border bg-muted/20">
              <h4 className="font-semibold mb-1 flex items-center gap-2"><Cpu className="size-4 text-muted-foreground" /> Producers (Enexa)</h4>
              <p className="text-muted-foreground">Enexa admin portal, internal ops tools, and API clients using the Enexa backoffice credentials. Every write goes through the same validation + version bump, then triggers the webhook to Amperio.</p>
            </div>
            <div className="p-4 rounded-lg border bg-muted/20">
              <h4 className="font-semibold mb-1 flex items-center gap-2"><Bell className="size-4 text-muted-foreground" /> Notifier (Amperio)</h4>
              <p className="text-muted-foreground">Middleware owns the MQTT broker facing the edge and exposes the <code className="text-xs">POST /internal/config/notify</code> webhook consumed by Enexa. Its only job in the config flow is to translate Enexa&apos;s HTTPS notification into a local MQTT event the controller already subscribes to.</p>
            </div>
            <div className="p-4 rounded-lg border bg-muted/20">
              <h4 className="font-semibold mb-1 flex items-center gap-2"><Download className="size-4 text-muted-foreground" /> Consumer (Edge Controller)</h4>
              <p className="text-muted-foreground">Edge controller on the ChargePost. On MQTT push (or on the 15-min fallback tick) it pulls the signed config from Enexa over HTTPS, verifies the signature, applies the delta to runtime state, propagates values to hardware via Modbus, and posts an ack back.</p>
            </div>
          </div>

          <div className="p-4 rounded-lg border bg-muted/20 text-sm">
            <h4 className="font-semibold mb-2 flex items-center gap-2"><Server className="size-4 text-muted-foreground" /> Transport</h4>
            <ul className="space-y-1 text-muted-foreground">
              <li>- <strong className="text-foreground">Enexa ↔ Amperio:</strong> HTTPS (TLS 1.3), mutual auth via API key + HMAC-signed webhook. Retries with exponential backoff if Amperio returns 5xx.</li>
              <li>- <strong className="text-foreground">Amperio ↔ Edge:</strong> MQTT over TLS with X.509 client certs. Edge opens the connection outbound, no inbound ports on site.</li>
              <li>- <strong className="text-foreground">Edge ↔ Enexa (pull):</strong> HTTPS (TLS 1.3) with bearer API key. Authoritative payload — signature verified on the device before apply.</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Endpoints */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="size-5 text-primary" />
            Endpoints
          </CardTitle>
          <CardDescription>
            All endpoints are rooted at <code className="text-xs">https://api.enexa.io/v1/</code> and require
            a bearer API key issued during onboarding.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <EndpointBlock
            method="GET"
            path="/config/{site_id}"
            purpose="Fetch the complete, current configuration for a site (authoritative)"
            when="(Primary) Triggered by MQTT push from Middleware whenever Enexa publishes a new version. (Secondary) At controller cold-boot. (Fallback) Every 15 min when MQTT is unavailable."
            request={`GET https://api.enexa.io/v1/config/site_abc123
Authorization: Bearer {api_key}
X-Device-ID: gateway_001
X-Firmware-Version: 2.1.0
Accept: application/json`}
            response={`HTTP/1.1 200 OK
Content-Type: application/json
ETag: "a1b2c3d4e5f6"
X-Config-Version: 42
Cache-Control: max-age=300

{ "config_version": 42, "site": { ... }, "signature": "..." }`}
          />

          <EndpointBlock
            method="GET"
            path="/config/{site_id}"
            purpose="Conditional fetch using ETag to save bandwidth"
            when="Used by the 15-minute fallback poll &mdash; returns 304 when config hasn't changed since the last successful pull"
            request={`GET https://api.enexa.io/v1/config/site_abc123
Authorization: Bearer {api_key}
If-None-Match: "a1b2c3d4e5f6"`}
            response={`HTTP/1.1 304 Not Modified`}
            variant="conditional"
          />

          <EndpointBlock
            method="POST"
            path="/config/{site_id}/ack"
            purpose="Confirm that a specific config version has been applied on-site"
            when="Immediately after the middleware successfully writes new values to runtime state"
            request={`POST https://api.enexa.io/v1/config/site_abc123/ack
Authorization: Bearer {api_key}
Content-Type: application/json

{
  "version": 43,
  "status": "applied",
  "applied_at": "2024-01-15T10:30:05Z",
  "device_id": "gateway_001",
  "applied_sections": ["battery", "ev_chargers", "optimization"]
}`}
            response={`HTTP/1.1 202 Accepted
Content-Type: application/json

{ "recorded": true, "server_time": "2024-01-15T10:30:05Z" }`}
          />

          <EndpointBlock
            method="POST"
            path="/config/{site_id}/ack"
            purpose="Report a failed apply so ops can react"
            when="If the middleware cannot apply new config (validation error, downstream hardware rejected a value, etc.)"
            request={`POST https://api.enexa.io/v1/config/site_abc123/ack
Authorization: Bearer {api_key}

{
  "version": 43,
  "status": "rejected",
  "device_id": "gateway_001",
  "reason": "battery.max_charge_rate_kw exceeds BMS nameplate",
  "rolled_back_to_version": 42
}`}
            response={`HTTP/1.1 202 Accepted

{ "recorded": true, "incident_id": "inc_9f2a..." }`}
            variant="error"
          />

          <EndpointBlock
            method="GET"
            path="/config/{site_id}/history"
            purpose="Retrieve version history of a site's configuration (audit / rollback UI)"
            when="Consumed by the Enexa portal and by ops tooling; not used by middleware at runtime"
            request={`GET https://api.enexa.io/v1/config/site_abc123/history?limit=20
Authorization: Bearer {api_key}`}
            response={`HTTP/1.1 200 OK

{
  "versions": [
    { "version": 43, "updated_at": "...", "updated_by": "ops@amperio.io", "summary": "raised export_limit_kw to 60" },
    { "version": 42, "updated_at": "...", "updated_by": "admin@enexa.io", "summary": "initial go-live config" }
  ]
}`}
            variant="audit"
          />

          <Separator />

          {/* Push notification: Amperio-hosted webhook + MQTT fan-out */}
          <div className="space-y-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Badge className="bg-orange-600 hover:bg-orange-600 text-white">Hosted by Amperio</Badge>
                <Badge variant="outline">Push (primary)</Badge>
              </div>
              <h4 className="font-semibold flex items-center gap-2">
                <Bell className="size-4 text-primary" />
                Change-notification API (Middleware)
              </h4>
              <p className="text-sm text-muted-foreground mt-1">
                The notification path is owned by <strong>Amperio</strong>, not Enexa. When Enexa
                publishes a new <code className="text-xs">config_version</code>, it calls the
                Amperio-hosted webhook below; the Middleware then publishes an MQTT
                message to the edge controller so it can pull the new config immediately
                (without waiting for the 15-minute fallback poll). The MQTT payload is a
                notification only &mdash; authoritative config data always comes from the
                HTTPS pull to Enexa.
              </p>
            </div>

            <EndpointBlock
              method="POST"
              path="/internal/config/notify"
              purpose="Enexa → Amperio webhook: new config version is available for a site"
              when="Fired by Enexa immediately after a new config version is signed and persisted. Amperio must respond with 202 within 2 s and handle the MQTT fan-out asynchronously."
              request={`POST https://api.amperio.io/v1/internal/config/notify
Authorization: Bearer {enexa_shared_secret}
X-Signature: hmac-sha256=a1b2c3...
Content-Type: application/json

{
  "site_id": "site_abc123",
  "config_version": 43,
  "etag": "b7f2e9a1",
  "published_at": "2024-01-15T10:30:00Z",
  "changed_sections": ["battery", "ev_chargers"],
  "priority": "normal"
}`}
              response={`HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "received": true,
  "mqtt_published": true,
  "notified_devices": ["gateway_001"],
  "server_time": "2024-01-15T10:30:00.842Z"
}`}
            />

            <div>
              <h5 className="font-semibold text-sm mb-2">MQTT fan-out (Amperio → Edge controller)</h5>
              <p className="text-sm text-muted-foreground mb-3">
                As soon as the webhook above is received, the Middleware publishes
                the following MQTT message to the edge controller subscribed at this site.
                The controller reacts by pulling <code className="text-xs">GET /config/&#123;site_id&#125;</code> from
                Enexa within ~500 ms.
              </p>
              <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs space-y-2">
                <p className="text-muted-foreground"># Topic (Amperio-owned broker)</p>
                <p>amperio/sites/{"{site_id}"}/config/updated</p>
                <p className="text-muted-foreground mt-3"># QoS = 1, retained = true</p>
                <p className="text-muted-foreground mt-3"># Payload</p>
                <pre>{`{
  "action": "config_updated",
  "config_version": 43,
  "etag": "b7f2e9a1",
  "changed_sections": ["battery", "ev_chargers"],
  "source": "enexa",
  "timestamp": "2024-01-15T10:30:00.842Z"
}`}</pre>
              </div>
            </div>

            <div className="p-3 rounded-lg border bg-muted/20 text-xs text-muted-foreground">
              <strong className="text-foreground">Delivery guarantees:</strong> MQTT QoS 1 with retained
              messages means a controller that was offline when the notification fired will
              receive the latest one as soon as it reconnects &mdash; no additional catch-up logic
              needed. On true broker outage, the 15-min polling fallback still guarantees the
              controller reaches the latest version within one tick.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Full schema */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="size-5 text-primary" />
            Complete configuration schema
          </CardTitle>
          <CardDescription>
            Full JSON returned by <code className="text-xs">GET /config/{"{site_id}"}</code>.
            Every top-level section maps to a concern that the middleware enforces on-site.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs overflow-x-auto">
            <pre>{`{
  "config_version": 43,
  "updated_at": "2024-01-15T10:30:00Z",
  "updated_by": "admin@enexa.io",
  "valid_until": "2024-01-16T10:30:00Z",

  "site": {
    "site_id": "site_abc123",
    "name": "Berlin Mitte - Alexanderplatz",
    "timezone": "Europe/Berlin",
    "location": {
      "latitude": 52.5200,
      "longitude": 13.4050,
      "address": "Alexanderplatz 1, 10178 Berlin"
    },
    "commissioning_date": "2024-02-01"
  },

  "grid_connection": {
    "import_limit_kw": 80,
    "export_limit_kw": 50,
    "meter_type": "modbus",
    "meter_address": 1,
    "meter_serial_number": "1EMH0010123456",
    "meter_manufacturer": "EMH",
    "meter_mid_certified": true,
    "meter_mid_expiry": "2029-03-15",
    "voltage_nominal_v": 400,
    "phases": 3,
    "grid_code": "VDE-AR-N-4105"
  },

  "battery": {
    "enabled": true,
    "capacity_kwh": 200,
    "usable_capacity_kwh": 180,
    "max_charge_rate_kw": 50,
    "max_discharge_rate_kw": 50,
    "min_soc_percent": 10,
    "max_soc_percent": 90,
    "idle_target_soc_percent": 50,
    "round_trip_efficiency": 0.92,
    "bms_protocol": "can",
    "bms_address": "0x100"
  },

  "solar_pv": {
    "enabled": true,
    "peak_capacity_kwp": 100,
    "inverter_protocol": "sunspec",
    "inverter_address": 2,
    "orientation_azimuth": 180,
    "orientation_tilt": 30,
    "curtailment_allowed": true
  },

  "ev_chargers": [
    {
      "id": "charger_01",
      "name": "Charger 1",
      "enabled": true,
      "protocol": "ocpp16",
      "max_power_kw": 150,
      "connector_type": "CCS2",
      "phases": 3,
      "modbus_unit_id": 1,
      "grid_mgmt_mode_default": "cloud"
    },
    {
      "id": "charger_02",
      "name": "Charger 2",
      "enabled": true,
      "protocol": "ocpp16",
      "max_power_kw": 150,
      "connector_type": "CCS2",
      "phases": 3,
      "modbus_unit_id": 2,
      "grid_mgmt_mode_default": "cloud"
    }
  ],

  "optimization": {
    "risk_factor": 50,
    "price_source": "epex_spot_de",
    "grid_fees_eur_kwh": 0.08,
    "feed_in_tariff_eur_kwh": 0.07,
    "daily_cycle_budget": 2.0,
    "peak_hours_avoid": true,
    "forecast_horizon_hours": 24
  },

  "safety": {
    "e_stop_enabled": true,
    "ground_fault_detection": true,
    "over_temperature_limit_c": 45,
    "autonomous_mode_timeout_s": 60,
    "heartbeat_interval_s": 10,
    "watchdog_fallback_profile": "conservative"
  },

  "telemetry": {
    "report_interval_s": 1,
    "batch_size": 10,
    "include_detailed_bms": true,
    "include_per_cell_data": false
  },

  "alerts": {
    "email_recipients": ["ops@amperio.io"],
    "sms_recipients": ["+49170..."],
    "slack_webhook": "https://hooks.slack.com/..."
  },

  "signature": "RSA-SHA256:abc123...",
  "signed_at": "2024-01-15T10:30:00Z"
}`}</pre>
          </div>
        </CardContent>
      </Card>

      {/* Field reference */}
      <Card>
        <CardHeader>
          <CardTitle>Field reference</CardTitle>
          <CardDescription>
            Semantics and runtime impact for every field the middleware actively consumes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <FieldTable
            icon={Zap}
            iconColor="text-orange-500"
            title="grid_connection"
            rows={[
              ["import_limit_kw", "number", "Contracted maximum power drawn from grid. Enforced by optimizer as a hard ceiling on combined charger + battery import."],
              ["export_limit_kw", "number", "Contracted maximum feed-in. Bounds any V2G / battery-export dispatch. 0 if feed-in is not permitted at this site."],
              ["meter_type", "enum", "\"modbus\" | \"pulse\" | \"mqtt\". Tells middleware how to read the grid meter at the point of common coupling."],
              ["meter_address", "number", "Modbus unit id (or pulse channel) of the grid meter."],
              ["meter_serial_number", "string", "Serial number of the MID-certified grid meter at the PCC (exposed by ADS-TEC as grid_mid_data.status.meter_serial_number). Static identifier — pulled once at onboarding, re-fetched only on hardware replacement. Used on every kWh-billing record and on regulatory audit reports so a given energy reading can be traced to the exact physical meter that produced it."],
              ["meter_manufacturer", "string", "Manufacturer code of the grid meter (e.g. \"EMH\", \"Iskra\", \"Landis+Gyr\"). Helps ops distinguish fleets and matches the asset to the correct firmware / Modbus map profile."],
              ["meter_mid_certified", "boolean", "Whether the grid meter carries a valid MID (Measuring Instruments Directive 2014/32/EU) conformity marking. Must be true for any site that bills customers per kWh inside the EU; false puts the site into \"informational metering only\" mode and blocks invoicing features in Enexa."],
              ["meter_mid_expiry", "ISO date", "Date the MID conformity seal expires (typically 8–16 years from commissioning depending on meter class). Enexa surfaces a warning 6 months before expiry and blocks billing once past the date — prevents invoices being issued against a legally-invalid meter."],
              ["voltage_nominal_v", "number", "Nominal line-to-line voltage for p.u. calculations and sanity checks on telemetry."],
              ["phases", "number", "1 or 3. Governs per-phase constraint handling in the optimizer."],
              ["grid_code", "string", "Regulatory code the site must comply with (e.g. VDE-AR-N-4105). Drives which grid-support features are enabled."],
            ]}
          />

          <FieldTable
            icon={BatteryCharging}
            iconColor="text-green-500"
            title="battery"
            rows={[
              ["enabled", "boolean", "Master switch. If false, optimizer treats battery as absent."],
              ["capacity_kwh", "number", "Nameplate energy capacity. Used only for reporting / sanity."],
              ["usable_capacity_kwh", "number", "Actual usable energy between min_soc and max_soc. Core input for optimization."],
              ["max_charge_rate_kw", "number", "Hard ceiling on charge power. Must be <= BMS nameplate."],
              ["max_discharge_rate_kw", "number", "Hard ceiling on discharge power."],
              ["min_soc_percent", "number", "Lower SOC bound (battery health). Optimizer will not discharge below this."],
              ["max_soc_percent", "number", "Upper SOC bound. Optimizer will not charge above this."],
              ["idle_target_soc_percent", "number", "SOC the battery drifts to when no optimization signal is active."],
              ["round_trip_efficiency", "number", "0.85-0.95. Used by optimizer to price battery cycles accurately."],
              ["bms_protocol", "enum", "\"can\" | \"rs485\" | \"modbus\". Middleware driver selector."],
              ["bms_address", "string", "Device address on the BMS bus."],
            ]}
          />

          <FieldTable
            icon={Sun}
            iconColor="text-yellow-500"
            title="solar_pv"
            rows={[
              ["enabled", "boolean", "Master switch."],
              ["peak_capacity_kwp", "number", "DC peak capacity. Used by forecast engine as the scale factor."],
              ["inverter_protocol", "enum", "\"sunspec\" | \"modbus\" | \"mqtt\"."],
              ["inverter_address", "number", "Modbus unit id of the inverter."],
              ["orientation_azimuth", "number", "Degrees from north (180 = south). Used for solar yield forecast."],
              ["orientation_tilt", "number", "Panel tilt in degrees from horizontal."],
              ["curtailment_allowed", "boolean", "If true, optimizer may command inverter to clip production for grid export compliance."],
            ]}
          />

          <FieldTable
            icon={Car}
            iconColor="text-blue-500"
            title="ev_chargers[]"
            rows={[
              ["id", "string", "Stable identifier used in telemetry and dispatch payloads."],
              ["enabled", "boolean", "Per-charger master switch."],
              ["protocol", "enum", "\"ocpp16\" | \"ocpp201\" | \"modbus\". How middleware speaks to this charger."],
              ["max_power_kw", "number", "Nameplate power. The actual runtime ceiling is min(this, P_grid_chg_max from telemetry)."],
              ["connector_type", "enum", "\"CCS2\" | \"CHAdeMO\" | \"Type2\" &mdash; informational for dispatch UI."],
              ["phases", "number", "1 or 3. Needed for AC chargers only."],
              ["modbus_unit_id", "number", "ADS-TEC ChargePost per-unit Modbus id (1 or 2)."],
              ["grid_mgmt_mode_default", "enum", "\"cloud\" | \"autonomous\". Fallback mode when cloud watchdog expires."],
            ]}
          />

          <FieldTable
            icon={Settings}
            iconColor="text-primary"
            title="optimization"
            rows={[
              ["risk_factor", "number", "0-100 slider. 0 = most conservative (keep battery full, avoid arbitrage). 100 = most aggressive."],
              ["price_source", "enum", "\"epex_spot_de\" | \"nordpool\" | \"fixed\". Which tariff feed the optimizer uses."],
              ["grid_fees_eur_kwh", "number", "All additive fees, taxes, and levies per kWh. Added on top of the spot price."],
              ["feed_in_tariff_eur_kwh", "number", "Rate paid for energy exported to the grid."],
              ["daily_cycle_budget", "number", "Soft cap on battery full-cycle equivalents per day (degradation guard)."],
              ["peak_hours_avoid", "boolean", "If true, optimizer applies a penalty to consumption during the distribution peak window."],
              ["forecast_horizon_hours", "number", "Planning horizon. Longer = more foresight, higher compute cost."],
            ]}
          />

          <FieldTable
            icon={RefreshCw}
            iconColor="text-orange-500"
            title="telemetry"
            rows={[
              ["report_interval_s", "number", "How often the Middleware pushes aggregated state telemetry to Enexa, in seconds. Controls the POST /api/v1/telemetry cadence — default 1 s, accepted range 1–60 s. Longer intervals mean time-averaged battery/grid readings; the wire contract itself does not change. A new value takes effect on the next push — no Middleware restart needed. Note: dispatch-feedback events are NOT governed by this setting — they flow over the separate POST /api/v1/command-events endpoint on observation, so feedback latency stays sub-second regardless of report_interval_s."],
              ["batch_size", "number", "Maximum number of telemetry snapshots buffered before a forced flush. Protects the Middleware→Enexa link during transient backpressure. Default 10."],
              ["include_detailed_bms", "boolean", "If true, the telemetry payload includes extended battery management data (cell-level voltages, thermal gradients). Adds ~2 KB per push — disable on bandwidth-constrained sites."],
            ]}
          />

          <FieldTable
            icon={AlertTriangle}
            iconColor="text-red-500"
            title="safety"
            rows={[
              ["e_stop_enabled", "boolean", "Whether a physical E-stop is wired and monitored."],
              ["ground_fault_detection", "boolean", "Enable insulation / GFI protection logic."],
              ["over_temperature_limit_c", "number", "Cut-out threshold for battery / power electronics."],
              ["autonomous_mode_timeout_s", "number", "How long after cloud silence the ChargePost falls back to autonomous operation (0 = stay in cloud forever, do not use)."],
              ["heartbeat_interval_s", "number", "How often the middleware must refresh the Modbus watchdog on the ChargePost."],
              ["watchdog_fallback_profile", "enum", "\"conservative\" | \"aggressive\" &mdash; named profile used after watchdog expiry."],
            ]}
          />
        </CardContent>
      </Card>

      {/* Versioning & rollback */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5 text-primary" />
            Versioning, rollback &amp; polling
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="p-4 rounded-lg border">
              <h4 className="font-semibold mb-2">Version semantics</h4>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>- <code className="text-xs">config_version</code> is a strictly monotonic integer per site.</li>
                <li>- Every write in the Enexa portal produces a new version &mdash; no in-place edits.</li>
                <li>- The middleware records the last-applied version; it ignores pushes for equal or lower versions.</li>
                <li>- Ops can invoke a rollback through the portal, which publishes the old payload under a fresh, higher version.</li>
              </ul>
            </div>
            <div className="p-4 rounded-lg border">
              <h4 className="font-semibold mb-2">Refresh schedule (push-first)</h4>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>- <strong className="text-foreground">Primary &mdash; push:</strong> on every MQTT <code className="text-xs">config/updated</code> message from Amperio, fetch immediately.</li>
                <li>- <strong className="text-foreground">Cold boot:</strong> single fetch at controller startup, before subscribing to MQTT.</li>
                <li>- <strong className="text-foreground">Fallback &mdash; poll:</strong> every 15 minutes with ETag, used only when MQTT is unhealthy (missed heartbeat &gt; 60 s).</li>
                <li>- <strong className="text-foreground">On error:</strong> exponential backoff 1m, 2m, 4m up to 30m.</li>
              </ul>
            </div>
            <div className="p-4 rounded-lg border">
              <h4 className="font-semibold mb-2">Fallback behavior</h4>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>- API unreachable: keep running on last-known cached config.</li>
                <li>- No cached config (fresh gateway): use factory defaults from the firmware image.</li>
                <li>- Signature verification fails: reject the update, log, alert ops &mdash; continue on previous version.</li>
                <li>- Persistent failure &gt; 1h: surface high-severity alert to configured recipients.</li>
              </ul>
            </div>
            <div className="p-4 rounded-lg border">
              <h4 className="font-semibold mb-2">HTTP status codes</h4>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>- <code className="text-xs">200</code> OK &mdash; config payload returned.</li>
                <li>- <code className="text-xs">202</code> Accepted &mdash; ack recorded.</li>
                <li>- <code className="text-xs">304</code> Not Modified &mdash; ETag match, no body.</li>
                <li>- <code className="text-xs">401</code> &mdash; bad or expired API key.</li>
                <li>- <code className="text-xs">404</code> &mdash; unknown <code className="text-xs">site_id</code>.</li>
                <li>- <code className="text-xs">409</code> &mdash; ack version is behind current Enexa version.</li>
                <li>- <code className="text-xs">429</code> &mdash; rate-limited (poll less often).</li>
                <li>- <code className="text-xs">5xx</code> &mdash; transient &mdash; retry with backoff.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-5 text-primary" />
            Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border">
              <h4 className="font-semibold mb-2">Transport</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>- TLS 1.3 required; older versions rejected at the edge.</li>
                <li>- Certificate pinning on the device (pinned to Enexa root).</li>
                <li>- API key in the <code className="text-xs">Authorization</code> header; never in URL.</li>
                <li>- <code className="text-xs">X-Device-ID</code> must match the cert CN &mdash; rejected on mismatch.</li>
              </ul>
            </div>
            <div className="p-4 rounded-lg border">
              <h4 className="font-semibold mb-2">Payload integrity</h4>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>- Config JSON is signed with Enexa&apos;s private key (RSA-SHA256).</li>
                <li>- Device verifies the signature before applying any value.</li>
                <li>- <code className="text-xs">valid_until</code> prevents indefinite reuse of a cached payload.</li>
                <li>- All config changes are audit-logged and available via the history endpoint.</li>
              </ul>
            </div>
          </div>
          <div className="bg-muted/30 rounded-lg p-4 font-mono text-xs">
            <p className="text-muted-foreground mb-2"># Signed envelope excerpt</p>
            <pre>{`{
  "config": { ... },
  "signature": "RSA-SHA256:abc123...",
  "signed_at": "2024-01-15T10:30:00Z",
  "valid_until": "2024-01-16T10:30:00Z"
}`}</pre>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* ---------- small presentational helpers ---------- */

function FlowStep({
  icon: Icon,
  label,
  sub,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  sub: string
  color: "blue" | "purple" | "orange" | "green"
}) {
  const colorMap = {
    blue: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    purple: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    orange: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    green: "bg-green-500/10 text-green-600 border-green-500/20",
  } as const

  return (
    <div className={`p-4 rounded-lg border text-center ${colorMap[color]}`}>
      <Icon className="size-6 mx-auto mb-2" />
      <p className="font-semibold text-sm text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground leading-snug mt-1">{sub}</p>
    </div>
  )
}

function EndpointBlock({
  method,
  path,
  purpose,
  when,
  request,
  response,
  variant = "default",
}: {
  method: "GET" | "POST"
  path: string
  purpose: string
  when: string
  request: string
  response: string
  variant?: "default" | "conditional" | "error" | "audit"
}) {
  const methodColors = {
    GET: "bg-blue-500/10 text-blue-700 border-blue-500/30",
    POST: "bg-orange-500/10 text-orange-700 border-orange-500/30",
  } as const
  const variantAccent = {
    default: "",
    conditional: "border-l-4 border-l-blue-400",
    error: "border-l-4 border-l-red-400",
    audit: "border-l-4 border-l-purple-400",
  }[variant]

  return (
    <div className={`rounded-lg border p-5 space-y-3 ${variantAccent}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <Badge className={`font-mono text-xs ${methodColors[method]}`} variant="outline">
          {method}
        </Badge>
        <code className="font-mono text-sm font-semibold">{path}</code>
      </div>
      <p className="text-sm">{purpose}</p>
      <p className="text-xs text-muted-foreground">
        <strong>When:</strong> {when}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Request</p>
          <pre className="bg-muted/50 rounded p-3 font-mono text-xs overflow-x-auto">{request}</pre>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Response</p>
          <pre className="bg-muted/50 rounded p-3 font-mono text-xs overflow-x-auto">{response}</pre>
        </div>
      </div>
    </div>
  )
}

function FieldTable({
  icon: Icon,
  iconColor,
  title,
  rows,
}: {
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
  title: string
  rows: Array<[string, string, string]>
}) {
  return (
    <div>
      <h4 className="font-semibold mb-3 flex items-center gap-2">
        <Icon className={`size-4 ${iconColor}`} />
        <code className="text-sm font-mono">{title}</code>
      </h4>
      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">Field</TableHead>
              <TableHead className="w-[100px]">Type</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([field, type, desc]) => (
              <TableRow key={field}>
                <TableCell className="font-mono text-xs">{field}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{type}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{desc}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
