"use client"

import { useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { useToast } from "@/hooks/use-toast"
import {
  Copy,
  Check,
  CheckCircle2,
  Database,
  Settings,
  Activity,
  UserPlus,
  Zap,
  HeartPulse,
  FileJson,
  Server,
  ShieldCheck,
  Bell,
} from "lucide-react"

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

type Endpoint = {
  id: string
  method: HttpMethod
  path: string
  baseUrl: string
  summary: string
  description: string
  auth: string
  when: string
  requestSample?: string
  responseSample: string
  statusCodes?: Array<{ code: string; meaning: string }>
}

type EndpointGroup = {
  id: string
  title: string
  purpose: string
  icon: typeof Database
  host: "enexa" | "amperio"
  endpoints: Endpoint[]
}

/* ------------------------------------------------------------------ */
/*  Data                                                              */
/* ------------------------------------------------------------------ */

const ENEXA_BASE = "https://api.enexa.io/v1"
const AMPERIO_BASE = "https://api.amperio.io/v1"

/* ---------- ENEXA-HOSTED GROUPS ---------- */

const masterDataGroup: EndpointGroup = {
  id: "master-data",
  title: "Config API \u2014 Master Data",
  purpose:
    "Read-only half of the Config API: asset registry for sites, controllers, and equipment inventory. Middleware pulls these on bootstrap and whenever a controller sees a new asset ID it doesn\u2019t recognise. Matches the \u201cConfig API\u201d entry in the sidebar (read path).",
  icon: Database,
  host: "enexa",
  endpoints: [
    {
      id: "list-sites",
      method: "GET",
      path: "/sites",
      baseUrl: ENEXA_BASE,
      summary: "List all sites assigned to the calling middleware tenant",
      description:
        "Returns the complete list of ChargePost sites that this Amperio tenant is authorised to control. Paginated, filterable by status. Used by ops tooling to reconcile middleware-side inventory against Enexa.",
      auth: "Bearer {tenant_api_key}",
      when: "On middleware startup and once per hour for reconciliation",
      requestSample: `GET ${ENEXA_BASE}/sites?status=active&limit=50
Authorization: Bearer {tenant_api_key}
Accept: application/json`,
      responseSample: `HTTP/1.1 200 OK
Content-Type: application/json

{
  // Cursor for the next page (null when exhausted)
  "next_cursor": "eyJpZCI6InNpdGVfYWJjMTIzIn0",
  // Total matching rows across all pages
  "total": 137,
  "sites": [
    {
      // Stable UUID used on every downstream call
      "site_id": "site_abc123",
      // Human-friendly label shown in Enexa portal
      "name": "Amperio Depot Belgrade North",
      // ISO 3166-1 alpha-2 country code — drives tariff & grid-code lookup
      "country": "RS",
      // active | maintenance | decommissioned
      "status": "active",
      // ISO 8601 — last time master data changed for this site
      "updated_at": "2025-04-18T09:21:04Z"
    }
  ]
}`,
      statusCodes: [
        { code: "200", meaning: "OK — list returned" },
        { code: "401", meaning: "Missing / invalid bearer token" },
        { code: "403", meaning: "Tenant not authorised" },
      ],
    },
    {
      id: "site-assets",
      method: "GET",
      path: "/sites/{site_id}/assets",
      baseUrl: ENEXA_BASE,
      summary: "Fetch the full asset inventory for one site",
      description:
        "Returns every controllable asset at a site: ChargePost units, battery strings, grid meters, solar inverters (if any), and their addressing info (Modbus unit ID, serial number, etc.). Middleware uses this to build its internal address book before accepting telemetry or dispatch.",
      auth: "Bearer {tenant_api_key}",
      when: "On site onboarding and on asset-change events (MQTT push hint)",
      requestSample: `GET ${ENEXA_BASE}/sites/site_abc123/assets
Authorization: Bearer {tenant_api_key}
Accept: application/json`,
      responseSample: `HTTP/1.1 200 OK
Content-Type: application/json

{
  "site_id": "site_abc123",
  "assets": [
    {
      // Stable ID used in telemetry & dispatch
      "asset_id": "cp_01",
      // chargepost | battery | grid_meter | solar
      "type": "chargepost",
      // Manufacturer / model for firmware & Modbus map selection
      "vendor": "ADS-TEC",
      "model": "ChargePost 150kW",
      // Serial from hardware nameplate — audit & warranty
      "serial_number": "CP2024-0815-0042",
      // Modbus unit ID on the site LAN
      "modbus_unit_id": 1,
      // Firmware currently reported by the hardware
      "firmware_version": "1.10.2"
    },
    {
      "asset_id": "grid_mid_main",
      "type": "grid_meter",
      "vendor": "EMH",
      // MID-certified serial — appears on every billing record
      "serial_number": "1EMH0010123456",
      "modbus_unit_id": 50,
      // Whether meter carries valid MID conformity marking
      "mid_certified": true,
      // Seal expiry — Enexa blocks billing past this date
      "mid_expiry": "2029-03-15"
    }
  ]
}`,
      statusCodes: [
        { code: "200", meaning: "OK" },
        { code: "404", meaning: "site_id unknown or not in tenant scope" },
      ],
    },
    {
      id: "controller-details",
      method: "GET",
      path: "/controllers/{controller_id}",
      baseUrl: ENEXA_BASE,
      summary: "Fetch controller registration details",
      description:
        "Returns the gateway / edge controller record as known by Enexa — which site it belongs to, which assets it's authorised to speak for, and its enrolment certificate fingerprint.",
      auth: "Bearer {tenant_api_key}",
      when: "After a controller boot, or when Enexa needs to verify a controller is still paired to its site",
      requestSample: `GET ${ENEXA_BASE}/controllers/ctrl_001
Authorization: Bearer {tenant_api_key}`,
      responseSample: `HTTP/1.1 200 OK
Content-Type: application/json

{
  // Unique controller identifier — issued during registration
  "controller_id": "ctrl_001",
  // Site this controller is pinned to (1:1 for MVP)
  "site_id": "site_abc123",
  // Asset IDs this controller may report telemetry / accept dispatch for
  "authorised_assets": ["cp_01", "cp_02", "grid_mid_main"],
  // SHA-256 fingerprint of the enrolment X.509 cert
  "cert_fingerprint": "A1:B2:C3:...:EF",
  // active | suspended | revoked
  "status": "active",
  // ISO 8601 timestamp of last successful heartbeat
  "last_seen_at": "2025-04-22T11:02:17Z"
}`,
    },
    {
      id: "equipment-specs",
      method: "GET",
      path: "/equipment/{type}/{id}/specs",
      baseUrl: ENEXA_BASE,
      summary: "Fetch static hardware specifications for a piece of equipment",
      description:
        "Machine-readable datasheet: rated power, energy capacity, min/max SOC, efficiency curves, Modbus register map profile. Used by middleware to validate dispatch commands against hardware capabilities before issuing them downstream.",
      auth: "Bearer {tenant_api_key}",
      when: "On first sight of a new asset type; cached locally",
      requestSample: `GET ${ENEXA_BASE}/equipment/chargepost/cp_01/specs
Authorization: Bearer {tenant_api_key}`,
      responseSample: `HTTP/1.1 200 OK
Content-Type: application/json

{
  "equipment_id": "cp_01",
  "type": "chargepost",
  "specs": {
    // Max grid intake at PCC (kW)
    "grid_import_max_kw": 87,
    // Max feed-in to grid (kW)
    "grid_export_max_kw": 87,
    // Max DC output to a single EV in coupled mode (kW)
    "ev_output_max_kw": 300,
    // Max DC output per power unit in single mode (kW)
    "ev_output_per_unit_max_kw": 150,
    // Nominal usable battery energy (kWh)
    "battery_usable_kwh": 201,
    // SOC floor — optimizer must never command below this
    "soc_min_pct": 10,
    // SOC ceiling — above this, only discharge allowed
    "soc_max_pct": 95,
    // Round-trip DC→AC→DC efficiency (decimal)
    "rte_efficiency": 0.92,
    // ADS-TEC Modbus map profile the middleware should load
    "modbus_profile": "ads-tec-chargepost-v2.6"
  }
}`,
    },
  ],
}

const configGroup: EndpointGroup = {
  id: "configuration",
  title: "Config API \u2014 Site Configuration",
  purpose:
    "Runtime settings — tariffs, safety limits, optimization policy, alert recipients. Versioned, signed, and acknowledged. Delivery is push-first: Enexa notifies the Middleware, which fans out via MQTT to the edge; polling is fallback only. See the dedicated Config API page for the full schema and flow.",
  icon: Settings,
  host: "enexa",
  endpoints: [
    {
      id: "get-config",
      method: "GET",
      path: "/config/{site_id}",
      baseUrl: ENEXA_BASE,
      summary: "Fetch the current authoritative configuration for a site (pulled by edge)",
      description:
        "Called by the edge controller to pull the signed config document. Triggered PRIMARILY by the Amperio MQTT push (amperio/sites/{id}/config/updated); FALLBACK is a 15-minute polling loop used only when MQTT is unhealthy. Edge validates the signature, checks config_version is >= its currently-running one, and applies the delta atomically.",
      auth: "Bearer {tenant_api_key} + X-Device-ID header",
      when: "Primary: on every MQTT config/updated notification. Secondary: on controller cold-boot. Fallback: every 15 min when MQTT is down.",
      requestSample: `GET ${ENEXA_BASE}/config/site_abc123
Authorization: Bearer {tenant_api_key}
X-Device-ID: gateway_001
X-Firmware-Version: 2.1.0
If-None-Match: "a1b2c3d4e5f6"`,
      responseSample: `HTTP/1.1 200 OK
Content-Type: application/json
ETag: "a1b2c3d4e5f6"
X-Config-Version: 42

{
  // Monotonic integer — higher always wins
  "config_version": 42,
  // ISO 8601 — when Enexa published this version
  "published_at": "2025-04-22T08:15:00Z",
  "site": {
    "site_id": "site_abc123",
    // Grid-side configuration (limits, meter, grid code)
    "grid_connection": {
      "import_limit_kw": 80,
      "export_limit_kw": 50,
      // Serial of the MID-certified PCC meter
      "meter_serial_number": "1EMH0010123456",
      "meter_mid_certified": true,
      "meter_mid_expiry": "2029-03-15",
      // Regulatory profile — drives ramp-rate & reactive-power rules
      "grid_code": "VDE-AR-N-4105"
    },
    // Day-ahead tariff & feed-in rates (truncated)
    "tariff": { "provider": "epex", "currency": "EUR" },
    // Optimization policy (risk factor, cycle budget, etc.)
    "optimization": { "enabled": true, "risk_factor": 0.3 }
  },
  // Detached Ed25519 signature over the canonicalised JSON
  "signature": "base64:..."
}`,
      statusCodes: [
        { code: "200", meaning: "OK — new config returned" },
        { code: "304", meaning: "Not Modified — ETag matches, no body" },
        { code: "401", meaning: "Bad bearer / device ID" },
        { code: "404", meaning: "site_id unknown" },
      ],
    },
    {
      id: "config-ack",
      method: "POST",
      path: "/config/{site_id}/ack",
      baseUrl: ENEXA_BASE,
      summary: "Acknowledge a config version was applied (or rejected)",
      description:
        "Middleware must ack every version it sees. success=true means the config is live on the hardware; success=false means validation or rollout failed and Enexa should surface an error in the portal.",
      auth: "Bearer {tenant_api_key} + X-Device-ID header",
      when: "Immediately after applying (success) or rolling back (failure)",
      requestSample: `POST ${ENEXA_BASE}/config/site_abc123/ack
Authorization: Bearer {tenant_api_key}
X-Device-ID: gateway_001
Content-Type: application/json

{
  // Version being ack'd
  "config_version": 42,
  // true = applied, false = rolled back
  "success": true,
  // ISO 8601 — when middleware finished applying
  "applied_at": "2025-04-22T08:15:42Z",
  // Only present on failure — short error code
  "error": null
}`,
      responseSample: `HTTP/1.1 204 No Content`,
    },
    {
      id: "config-history",
      method: "GET",
      path: "/config/{site_id}/history",
      baseUrl: ENEXA_BASE,
      summary: "Audit trail of past config versions",
      description:
        "Returns the last N versions (default 20) with who published them, when, and the resulting application status per device. Used by audit / compliance to prove a given value was (or was not) in force at a given time.",
      auth: "Bearer {tenant_api_key}",
      when: "On-demand from ops tooling / audit dashboard",
      requestSample: `GET ${ENEXA_BASE}/config/site_abc123/history?limit=20
Authorization: Bearer {tenant_api_key}`,
      responseSample: `HTTP/1.1 200 OK

{
  "site_id": "site_abc123",
  "versions": [
    {
      "config_version": 42,
      "published_at": "2025-04-22T08:15:00Z",
      // User or system principal that made the change
      "published_by": "ops@amperio.io",
      // Short human summary (auto-generated from diff)
      "summary": "export_limit_kw 30 -> 50",
      // Per-device apply status for this version
      "applied_on": [
        { "device_id": "gateway_001", "success": true, "applied_at": "2025-04-22T08:15:42Z" }
      ]
    }
  ]
}`,
    },
    {
      id: "controller-config-version",
      method: "GET",
      path: "/controllers/{id}/config/version",
      baseUrl: ENEXA_BASE,
      summary: "Lightweight version check — fetch just the current version number",
      description:
        "Lightweight version check returning only the current config_version and ETag (no payload). Used exclusively by the FALLBACK polling loop to decide whether a full /config fetch is needed. Not called during normal push-driven operation.",
      auth: "Bearer {tenant_api_key} + X-Device-ID header",
      when: "Fallback only: every 15 min when the edge controller cannot reach the Amperio MQTT broker",
      requestSample: `GET ${ENEXA_BASE}/controllers/ctrl_001/config/version
Authorization: Bearer {tenant_api_key}
X-Device-ID: gateway_001`,
      responseSample: `HTTP/1.1 200 OK

{
  // Current version Enexa considers authoritative for this controller
  "config_version": 42,
  // Matching ETag — middleware compares to its cached value
  "etag": "a1b2c3d4e5f6"
}`,
    },
  ],
}

  const telemetryGroup: EndpointGroup = {
    id: "telemetry",
    title: "Telemetry API",
    purpose:
      "State uplink from Middleware to Enexa. Per-site snapshot (envelope + batteries[] + chargers[] + grid{}) pushed on a configurable cadence (telemetry.report_interval_s, default 1 s, range 1\u201360 s), at-most-once. Also carries equipment alerts and a low-frequency heartbeat. Dispatch-feedback is NOT here \u2014 it lives on the separate Command Status API group below. Matches the \u201cTelemetry API\u201d entry in the sidebar.",
    icon: Activity,
    host: "enexa",
  endpoints: [
    {
      id: "push-telemetry",
      method: "POST",
      path: "/telemetry",
      baseUrl: ENEXA_BASE,
      summary: "Push site telemetry snapshot to Enexa",
      description:
        "Primary telemetry channel. Middleware aggregates readings from every asset at the site — batteries[], chargers[], grid{} — and pushes one combined snapshot per cycle. Enexa stores it, feeds the optimizer, and updates the monitoring dashboard. Dispatch-feedback events travel on the separate /command-events endpoint.",
      auth: "Bearer {tenant_api_key} + X-Device-ID header",
      when: "Every telemetry.report_interval_s seconds (Middleware app config, default 1 s, configurable 1–60 s via Config API). A new value takes effect on the next push — no Middleware restart needed.",
      requestSample: `POST ${ENEXA_BASE}/telemetry
Authorization: Bearer {tenant_api_key}
X-Device-ID: gateway_001
Content-Type: application/json

  // Envelope + 3 payload blocks: batteries[], chargers[], grid{}.
  // Field-level reference (purpose, Modbus source, optimizer usage) lives on the
  // Telemetry API page — this sample is the wire contract only.
{
  "site_id": "site_abc123",
  // Stable ChargePost ID from master data (/sites/{id}/assets)
  "asset_id": "cp_01",
  // ISO 8601 — when readings were taken on device
  "timestamp": "2025-04-22T11:00:15Z",

  // Per power unit — ADS-TEC ChargePost has 2 independent battery strings
  "batteries": [
    {
      "unit_id": 1,
      // Battery SOC (%)
      "soc_pct": 65,
      // Battery power (W). Negative = charging, Positive = discharging
      "power_w": -25000,
      // Cell temperature range (°C)
      "temp_min_c": 28.5,
      "temp_max_c": 32.5,
      // Real-time headroom — optimizer caps setpoints at these
      "max_charge_w": 110000,
      "max_discharge_w": 110000,
      // Usable energy remaining to discharge / to fill (kWh)
      "energy_empty_kwh": 45.2,
      "energy_full_kwh": 12.8,
      // open | closed — must be closed for power flow
      "contactor_state": "closed"
    },
    { "unit_id": 2, "soc_pct": 62, "power_w": -22000, "...": "..." }
  ],

  // Per charger/connector — same unit_id indexing as batteries
  "chargers": [
    {
      "unit_id": 1,
      // Available | InProgress | NotAvailable
      "charging_state": "InProgress",
      // ReadyToCharge | Authorization | Charging | ChargingFinished | ChargingError | ...
      "charging_process_state": "Charging",
      // Plugged | Unplugged
      "plug_state": "Plugged",
      // Actual power delivered to EV (W)
      "P_EV_w": 145000,
      // EV-negotiated max (W, ISO 15118 / CHAdeMO)
      "P_EV_max_w": 150000,
      // ChargePost hardware max (W)
      "P_cp_max_w": 150000,
      // Current per-charger grid-side import / export ceilings (W)
      "P_grid_chg_max_w": 75000,
      "P_grid_dischg_max_w": 75000,
      // EV-reported SOC (%) — null if EV doesn't publish
      "soc_EV_pct": 45,
      // Seconds until bulk / 100% SOC (EV-reported)
      "t_bulk_s": 420,
      "t_full_s": 1260,
      // Session energy — internal counter + MID-certified DC meter (kWh)
      "E_EV_chg_kwh": 23.5,
      "E_EVse_kwh": 23.48,
      // open | closed
      "grid_contactor_state": "closed"
    }
  ],

  // Grid meter readings at point of common coupling (PCC)
  "grid": {
    // Real-time grid power (W, producer counting — negative = import)
    "P_grid_w": 35000,
    // Cumulative import / export (kWh, MID-certified)
    "E_grid_imp_kwh": 245.6,
    "E_grid_exp_kwh": 12.3,
    // Auxiliary load (HVAC, displays) — up to 8 kW
    "P_aux_w": 3200,
    // Grid frequency (Hz)
    "f_grid_hz": 50.01,
    // Power factor
    "cos_phi": 0.98
  }

  // Dispatch feedback is NOT part of this payload — it flows over /command-events
  // (event-driven, individually acked) so feedback latency is independent of
  // telemetry cadence.
}`,
      responseSample: `HTTP/1.1 202 Accepted

{
  // Server-assigned correlation ID for this snapshot
  "telemetry_id": "tlm_01HX9ZA...",
  // Confirmed ingest timestamp (server clock)
  "received_at": "2025-04-22T11:00:16Z"
}`,
      statusCodes: [
        { code: "202", meaning: "Accepted — queued for processing" },
        { code: "400", meaning: "Schema validation failed" },
        { code: "413", meaning: "Payload too large — split into smaller batches" },
        { code: "429", meaning: "Rate-limited" },
      ],
    },
    {
      id: "push-alerts",
      method: "POST",
      path: "/telemetry/alerts",
      baseUrl: ENEXA_BASE,
      summary: "Push equipment alerts, faults and safety triggers",
      description:
        "Out-of-band channel for events that shouldn't wait for the next snapshot — watchdog trips, clearance violations, contactor faults, OCPP protocol errors. Posted immediately when observed.",
      auth: "Bearer {tenant_api_key} + X-Device-ID header",
      when: "On event — not on a schedule",
      requestSample: `POST ${ENEXA_BASE}/telemetry/alerts
Authorization: Bearer {tenant_api_key}
X-Device-ID: gateway_001
Content-Type: application/json

{
  "site_id": "site_abc123",
  "alerts": [
    {
      // Stable event code — used by Enexa alert rules
      "code": "WATCHDOG_TRIGGERED",
      // info | warning | error | critical
      "severity": "error",
      // Which asset produced it
      "asset_id": "cp_01",
      // ISO 8601 observation time on device
      "observed_at": "2025-04-22T11:00:12Z",
      // Free-form context — shown in dashboard
      "message": "Modbus watchdog expired; system reverted to fallback",
      // Optional structured detail
      "context": { "timeout_s": 60, "last_write_at": "2025-04-22T10:59:10Z" }
    }
  ]
}`,
      responseSample: `HTTP/1.1 202 Accepted

{
  // Per-alert correlation IDs
  "alert_ids": ["alrt_01HX9ZB..."]
}`,
    },
    {
      id: "push-status",
      method: "POST",
      path: "/status",
      baseUrl: ENEXA_BASE,
      summary: "Controller heartbeat — liveness, firmware, health roll-up",
      description:
        "Low-frequency health signal. Confirms the controller is alive and reports its current firmware, config version, and a rolling error count. Used by Enexa to detect silent failures where telemetry stops arriving.",
      auth: "Bearer {tenant_api_key} + X-Device-ID header",
      when: "Every 5 minutes",
      requestSample: `POST ${ENEXA_BASE}/status
Authorization: Bearer {tenant_api_key}
X-Device-ID: gateway_001
Content-Type: application/json

{
  "controller_id": "ctrl_001",
  // ISO 8601 — device clock
  "timestamp": "2025-04-22T11:00:00Z",
  // healthy | degraded | faulted
  "status": "healthy",
  // Firmware version currently running on the controller
  "firmware_version": "2.1.0",
  // Config version currently applied
  "config_version": 42,
  // Uptime in seconds since last boot
  "uptime_s": 864321,
  // Rolling counts over the last 5 min
  "counters": {
    "telemetry_sent": 300,
    "dispatch_received": 18,
    "errors": 0
  }
}`,
      responseSample: `HTTP/1.1 204 No Content`,
    },
  ],
}

const commandStatusGroup: EndpointGroup = {
  id: "command-status",
  title: "Command Status API",
  purpose:
    "Dispatch-feedback channel from Middleware to Enexa. One event per dispatch-command state transition (accepted \u2192 executing \u2192 executed / deviated / superseded / timed_out / rejected), keyed by the command_id the Dispatching API issued. Individually acked, at-least-once: Enexa deduplicates by event_id. Event-driven \u2014 independent of telemetry cadence. Matches the \u201cCommand Status API\u201d entry in the sidebar.",
  icon: CheckCircle2,
  host: "enexa",
  endpoints: [
    {
      id: "push-command-events",
      method: "POST",
      path: "/command-events",
      baseUrl: ENEXA_BASE,
      summary: "Push a single dispatch-command state transition",
      description:
        "One flat event per transition, keyed by command_id. Individually acked, at-least-once: Middleware persists every event in a local queue, retries on 5xx / network failure / timeout, and Enexa deduplicates by event_id so replays are a no-op. A typical dispatch emits 3\u20135 events across its lifetime (accepted, executing, executed OR deviated / superseded / timed_out / rejected).",
      auth: "Bearer {tenant_api_key} + X-Device-ID header",
      when: "On every dispatch-state transition \u2014 not on a schedule. First event typically within ~50 ms of the dispatch ack.",
      requestSample: `POST ${ENEXA_BASE}/command-events
Authorization: Bearer {tenant_api_key}
X-Device-ID: gateway_001
Content-Type: application/json

// Flat event \u2014 one row per state transition of a single command_id.
// Shown here: the "executing" transition on the happy path, so all three
// exception fields are null. Field-level reference lives on the Command
// Status API page.
{
  // ---------- envelope ----------
  // Idempotency key \u2014 Enexa deduplicates retried events by this
  "event_id":      "evt_20260422_110000_182",
  "site_id":       "site_abc123",
  // Echoes the command_id issued on the Dispatching API
  "command_id":    "cmd_20260422_110000_001",

  // ---------- lifecycle ----------
  // accepted | executing | executed | deviated | superseded | timed_out | rejected
  "status":        "executing",
  // ISO 8601 \u2014 moment the transition was observed at the Middleware
  "event_ts":      "2026-04-22T11:00:00.612Z",
  // ISO 8601 \u2014 when the parent dispatch arrived at the Middleware
  "received_at":   "2026-04-22T11:00:00.182Z",
  // ISO 8601 \u2014 when setpoints were written to Modbus (null until executing)
  "applied_at":    "2026-04-22T11:00:00.612Z",
  // Echoes the valid_until from the dispatch
  "valid_until":   "2026-04-22T11:15:00Z",

  // ---------- exception detail (null on the happy path) ----------
  // Rolling 60-s tracking error (%) \u2014 populated only when status == "deviated"
  "deviation_pct": null,
  // Populated on deviated | timed_out | rejected | superseded
  "reason":        null,
  // command_id this one replaced \u2014 null if not a re-plan
  "supersedes":    null,

  // ---------- uplift attribution (populated only when status == "executed") ----------
  // Per-unit delivered energy over the dispatch window (producer counting:
  // positive = grid import, <0 = export). Middleware integrates P_grid_w
  // from telemetry between applied_at and event_ts on the executed event.
  "realized_energy_kwh":       null,
  // Cleared spot price (EUR/MWh) for the dispatch slot, from Middleware's
  // cached day-ahead feed keyed by the parent dispatch timestamp. Compare
  // against metadata.price_trajectory[] on the dispatch to isolate forecast
  // error from control error.
  "spot_price_eur_mwh_actual": null
}`,
      responseSample: `HTTP/1.1 202 Accepted`,
      statusCodes: [
        { code: "202", meaning: "Accepted \u2014 event persisted, drop from queue" },
        { code: "400", meaning: "Schema validation failed \u2014 do NOT retry (terminal for this event)" },
        { code: "401", meaning: "Unauthorized \u2014 refresh tenant_api_key and retry" },
        { code: "409", meaning: "Duplicate event_id \u2014 idempotent success, drop from queue" },
        { code: "429", meaning: "Rate-limited \u2014 back off per Retry-After; order preserved per command_id" },
        { code: "5xx", meaning: "Enexa server error \u2014 exponential-backoff retry with the same event_id" },
        { code: "timeout", meaning: "Request > 5 s \u2014 treated as 5xx, retry with the same event_id" },
      ],
    },
  ],
}

const onboardingGroup: EndpointGroup = {
  id: "onboarding",
  title: "Onboarding & Provisioning APIs",
  purpose:
    "Bootstrap flow for new sites and controllers — one-time registration, certificate enrolment, and activation confirmation. Called during field commissioning.",
  icon: UserPlus,
  host: "enexa",
  endpoints: [
    {
      id: "register-controller",
      method: "POST",
      path: "/controllers/register",
      baseUrl: ENEXA_BASE,
      summary: "Register a new controller and exchange enrolment token for long-lived credentials",
      description:
        "First call from a freshly-flashed controller. Presents a one-time enrolment token (printed on the install sheet or scanned QR) along with hardware serial. Enexa issues an X.509 client certificate and a bearer token bound to the site.",
      auth: "Bearer {enrolment_token} (one-time)",
      when: "Once per controller, at physical install",
      requestSample: `POST ${ENEXA_BASE}/controllers/register
Authorization: Bearer {enrolment_token}
Content-Type: application/json

{
  // Serial printed on the gateway nameplate
  "hardware_serial": "GW-2024-0042",
  // Initial firmware version
  "firmware_version": "2.1.0",
  // Certificate Signing Request — PEM
  "csr_pem": "-----BEGIN CERTIFICATE REQUEST-----\\n..."
}`,
      responseSample: `HTTP/1.1 201 Created
Content-Type: application/json

{
  // Enexa-assigned controller ID
  "controller_id": "ctrl_001",
  // Which site this controller is now bound to
  "site_id": "site_abc123",
  // Signed client certificate — used for mTLS going forward
  "client_cert_pem": "-----BEGIN CERTIFICATE-----\\n...",
  // Long-lived bearer token for REST APIs (rotate yearly)
  "api_token": "ey...",
  // Base URL the controller should call for all subsequent requests
  "api_base_url": "${ENEXA_BASE}",
  // MQTT broker details for push notifications
  "mqtt": {
    "host": "mqtt.enexa.io",
    "port": 8883,
    "topic_prefix": "enexa/amperio/site_abc123/gateway/ctrl_001"
  }
}`,
      statusCodes: [
        { code: "201", meaning: "Created — credentials issued" },
        { code: "401", meaning: "Enrolment token invalid / already redeemed" },
        { code: "409", meaning: "Hardware serial already registered" },
      ],
    },
    {
      id: "controller-bootstrap",
      method: "GET",
      path: "/controllers/{id}/bootstrap",
      baseUrl: ENEXA_BASE,
      summary: "Fetch initial runtime bundle after registration",
      description:
        "Convenience endpoint that returns everything the controller needs to come online in one shot: current config, asset inventory, firmware policy, and MQTT topic layout. Equivalent to calling /config, /sites/{id}/assets, and /firmware/policy in sequence, but atomic.",
      auth: "mTLS + Bearer {api_token}",
      when: "Immediately after /register, and on cold-start if local cache is empty",
      requestSample: `GET ${ENEXA_BASE}/controllers/ctrl_001/bootstrap
Authorization: Bearer {api_token}`,
      responseSample: `HTTP/1.1 200 OK

{
  "controller_id": "ctrl_001",
  "site_id": "site_abc123",
  // Full config payload (same schema as GET /config/{site_id})
  "config": { "config_version": 42, "site": { "...": "..." } },
  // Asset inventory (same schema as GET /sites/{site_id}/assets)
  "assets": [ { "asset_id": "cp_01", "type": "chargepost" } ],
  // Current firmware policy — what version to run, where to get it
  "firmware_policy": {
    "target_version": "2.1.0",
    "download_url": "${ENEXA_BASE}/firmware/gateway/2.1.0.bin",
    "sha256": "..."
  }
}`,
    },
    {
      id: "activate-controller",
      method: "POST",
      path: "/controllers/{id}/activate",
      baseUrl: ENEXA_BASE,
      summary: "Confirm controller has completed bootstrap and is live",
      description:
        "Final onboarding step. Controller reports back that it has applied config, reached all its Modbus assets, and is ready to accept dispatch. Enexa flips the site status from 'commissioning' to 'active'.",
      auth: "Bearer {api_token}",
      when: "Once, after successful bootstrap",
      requestSample: `POST ${ENEXA_BASE}/controllers/ctrl_001/activate
Authorization: Bearer {api_token}
Content-Type: application/json

{
  // ISO 8601 — device clock
  "activated_at": "2025-04-22T09:00:00Z",
  // Results of the self-check performed before activation
  "self_check": {
    // All configured Modbus assets reachable?
    "modbus_reachable": true,
    // Config signature verified locally?
    "config_signature_valid": true,
    // OCPP listener up (if applicable)?
    "ocpp_listener_up": true
  }
}`,
      responseSample: `HTTP/1.1 200 OK

{
  "controller_id": "ctrl_001",
  "site_id": "site_abc123",
  // active | activation_failed
  "status": "active",
  // Enexa's server-side activation timestamp
  "activated_at": "2025-04-22T09:00:01Z"
}`,
    },
    {
      id: "firmware-latest",
      method: "GET",
      path: "/firmware/latest/{device_type}",
      baseUrl: ENEXA_BASE,
      summary: "Query the latest firmware version available for a device class",
      description:
        "Read-only firmware catalogue. Middleware calls this to know whether an OTA update is available for a given gateway or ChargePost model. Actual binary download is a separate signed URL.",
      auth: "Bearer {api_token}",
      when: "Daily, or on demand before staging an update window",
      requestSample: `GET ${ENEXA_BASE}/firmware/latest/gateway
Authorization: Bearer {api_token}`,
      responseSample: `HTTP/1.1 200 OK

{
  // Device class this version targets
  "device_type": "gateway",
  // Version string (semver)
  "version": "2.1.3",
  // ISO 8601 release date
  "released_at": "2025-04-18T00:00:00Z",
  // Signed URL to download the binary — expires in 1h
  "download_url": "https://firmware.enexa.io/gateway/2.1.3.bin?sig=...",
  // SHA-256 for integrity verification
  "sha256": "...",
  // Short human-readable changelog
  "changelog": "Fix Modbus reconnect storm on flaky links"
}`,
    },
  ],
}

/* ---------- AMPERIO-HOSTED GROUPS ---------- */

const notificationsGroup: EndpointGroup = {
  id: "notifications",
  title: "Notification APIs",
  purpose:
    "Event push path owned by Amperio. Enexa calls this webhook whenever a new config version is published; the Middleware immediately re-publishes the event on MQTT to the edge controller, which then pulls the new config from Enexa. This is what makes config rollout push-driven (typical latency < 2 s) instead of waiting for the 15-min polling fallback.",
  icon: Bell,
  host: "amperio",
  endpoints: [
    {
      id: "config-notify",
      method: "POST",
      path: "/internal/config/notify",
      baseUrl: AMPERIO_BASE,
      summary: "Enexa → Amperio webhook: new config version is available for a site",
      description:
        "Fired by Enexa immediately after a new config_version is signed and persisted in its database. the Middleware acknowledges with 202 Accepted within 2 s, then asynchronously publishes an MQTT message on amperio/sites/{site_id}/config/updated (QoS 1, retained). The edge controller — already subscribed to that topic — reacts by pulling GET /config/{site_id} from Enexa. Payload here is a NOTIFICATION only; authoritative config data always comes from the HTTPS pull.",
      auth: "Bearer {enexa_shared_secret} + X-Signature (HMAC-SHA256 over the body)",
      when: "Every time Enexa publishes a new config_version (operator edit, rollback, or bulk update)",
      requestSample: `POST ${AMPERIO_BASE}/internal/config/notify
Authorization: Bearer {enexa_shared_secret}
X-Signature: hmac-sha256=a1b2c3d4e5f6...
Content-Type: application/json

{
  // Site whose config changed
  "site_id": "site_abc123",
  // New authoritative version number (monotonic per site)
  "config_version": 43,
  // Matching ETag — passed through to the edge so it can short-circuit stale pulls
  "etag": "b7f2e9a1",
  // When the new version was signed & persisted in Enexa
  "published_at": "2024-01-15T10:30:00Z",
  // Which top-level sections changed vs. the previous version (hint for the edge)
  "changed_sections": ["battery", "ev_chargers"],
  // "normal" | "urgent" — urgent skips Amperio's internal dedup window
  "priority": "normal",
  // Who/what produced the change (operator email, rollback job id, etc.)
  "published_by": "ops@amperio.io"
}`,
      responseSample: `HTTP/1.1 202 Accepted
Content-Type: application/json

{
  // Amperio has recorded the event and queued the MQTT fan-out
  "received": true,
  // MQTT publish succeeded synchronously (false ⇒ queued for retry)
  "mqtt_published": true,
  // Which device(s) were notified at this site
  "notified_devices": ["gateway_001"],
  // MQTT topic on Amperio's broker that was published
  "mqtt_topic": "amperio/sites/site_abc123/config/updated",
  // Amperio server time — used by Enexa for webhook latency SLO tracking
  "server_time": "2024-01-15T10:30:00.842Z"
}`,
      statusCodes: [
        { code: "202", meaning: "Accepted — Amperio will fan out via MQTT (async)" },
        { code: "401", meaning: "Bad or expired shared secret / missing signature" },
        { code: "409", meaning: "Duplicate notification for the same version (safe to ignore)" },
        { code: "422", meaning: "Payload failed validation (missing site_id / version, bad signature)" },
        { code: "503", meaning: "MQTT broker down — Enexa should retry with backoff" },
      ],
    },
  ],
}

const dispatchGroup: EndpointGroup = {
  id: "dispatch",
  title: "Dispatching API",
  purpose:
    "Downlink from Enexa to Middleware \u2014 station-level mode and per-unit battery / EV setpoints. Sync ack is pure receipt (accepted | rejected, no \u201cpartial\u201d); real execution outcome and any setpoint clipping flow back asynchronously on the Command Status API, keyed by the same command_id. Matches the \u201cDispatching API\u201d entry in the sidebar.",
  icon: Zap,
  host: "amperio",
  endpoints: [
    {
      id: "dispatch-command",
      method: "POST",
      path: "/dispatch",
      baseUrl: AMPERIO_BASE,
      summary: "Send a dispatch command to a ChargePost site",
      description:
        "Core dispatch endpoint. Enexa's optimizer computes the next 15-min setpoint block and posts it here. The sync response is a PURE ACK (accepted | rejected) echoing the Enexa-generated command_id — it proves only that the Middleware received and queued the payload, NOT that any setpoint has been validated against site limits or written to Modbus. Real execution state for every dispatch (accepted → executing → executed / deviated / superseded / timed_out / rejected) plus any setpoint clipping is reported asynchronously over the separate /command-events endpoint, keyed by the same command_id. Events are individually acked and at-least-once, so no state transition is ever lost. Field-level reference lives on the Dispatching API page.",
      auth: "Bearer {enexa_service_token} (mTLS recommended)",
      when: "Every 15 minutes (optimizer tick) + ad-hoc intraday corrections",
      requestSample: `POST ${AMPERIO_BASE}/dispatch
Authorization: Bearer {enexa_service_token}
Content-Type: application/json

// Envelope + metadata{} + station{} + per-unit chargers[{unit_id, ...}].
// Full field-level semantics & Modbus register mapping live on the Dispatching
// API page. metadata.* never touches Modbus — it is echoed into the audit log.
{
  // ---------- envelope ----------
  "site_id":     "site_abc123",
  // Enexa-generated idempotency key — a retry with the same value is a no-op
  "command_id":  "cmd_20260422_110000_001",
  // ISO 8601 — when the optimizer committed these setpoints
  "timestamp":   "2026-04-22T11:00:00Z",
  // Command expiry — after this the Middleware reverts to safe fallback
  "valid_until": "2026-04-22T11:15:00Z",

  // ---------- metadata (informational — never written to Modbus) ----------
  "metadata": {
    // cheap | moderate | expensive | peak — operator-dashboard copy
    "price_zone":  "cheap",
    // Human-readable explanation, e.g. "cheap_slot", "peak_pricing"
    "gate_reason": "cheap_slot",
    // Price curve the optimizer saw when issuing this command. Stamped on
    // the dispatch so uplift attribution is deterministic and replayable —
    // no external EPEX join at post-hoc. Typically 96 quarter-hour entries
    // for the next 24 h (truncated below). Middleware echoes verbatim.
    "price_trajectory": [
      { "slot_ts": "2026-04-22T11:00:00Z", "eur_mwh": 32.1 },
      { "slot_ts": "2026-04-22T11:15:00Z", "eur_mwh": 31.8 },
      { "slot_ts": "2026-04-22T11:30:00Z", "eur_mwh": 33.4 }
      // ...93 more entries
    ]
  },

  // ---------- station (site-wide mode + grid-clearance lever) ----------
  "station": {
    // 0 = Off, 1 = On (Enexa control)
    "operation_mode":      1,
    // 0 = Automatic, 1 = Manual per-unit
    "grid_mgmt_mode":      1,
    // Grid import ceiling (W) — the ONLY grid-throttling lever. 0 blocks import.
    "P_grid_clearance_w":  80000
  },

  // ---------- chargers[] (per power-unit setpoints) ----------
  "chargers": [
    {
      "unit_id":        1,
      // 0=Off, 1=Single(150 kW), 2=Dual/Coupled(300 kW), 3=Disabled
      "charging_mode":  2,
      // Manual-mode per-unit grid setpoint (W, producer counting).
      // Negative = export to grid (also the export gate: clamp to >=0 if no
      // export contract). Positive = import from grid.
      "P_grid_w":       -30000,
      // EV power ceiling (W, 0–300 kW) — for load management
      "P_cp_lim_w":     150000,
      // Battery SOC target ceiling (%)
      "soc_cp_max_pct": 90,
      // Battery SOC reserve floor (%) — hardware-enforced, commissioning-disabled
      // register on ADS-TEC. Closes the tail-risk gap where optimizer-side
      // constraints alone cannot guarantee a reserve for a forecast peak.
      "soc_cp_min_pct": 20
    },
    {
      "unit_id":        2,
      "charging_mode":  2,
      "P_grid_w":       -30000,
      "P_cp_lim_w":     150000,
      "soc_cp_max_pct": 90,
      "soc_cp_min_pct": 20
    }
  ]
}`,
      responseSample: `HTTP/1.1 202 Accepted
Content-Type: application/json

// Pure ack — Middleware RECEIVED & QUEUED the command. Not an execution outcome
// and not a validation verdict: any setpoint clip / drop, plus the full state
// machine (executing / executed / deviated / timed_out / rejected), is reported
// asynchronously over POST /command-events, keyed by this command_id.
// See Command Status API for the full state machine.
{
  // Echoed from the request — no Middleware-side remapping
  "command_id":  "cmd_20260422_110000_001",
  // accepted | rejected — no "partial" at this layer
  "status":      "accepted",
  // Server-side receive timestamp
  "received_at": "2026-04-22T11:00:00.182Z"
}`,
      statusCodes: [
        { code: "202", meaning: "Accepted — queued for Modbus write; await /command-events for execution state" },
        { code: "400", meaning: "Schema / value out of spec — rejected, will not be retried" },
        { code: "401", meaning: "Bad service token" },
        { code: "429", meaning: "Rate-limited (10 commands/min per site)" },
      ],
    },
  ],
}

const healthGroup: EndpointGroup = {
  id: "health",
  title: "Health APIs",
  purpose:
    "Liveness & readiness for Middleware. Used by Enexa's monitoring to detect middleware outages and by ops tooling to orchestrate deployments.",
  icon: HeartPulse,
  host: "amperio",
  endpoints: [
    {
      id: "health-check",
      method: "GET",
      path: "/health",
      baseUrl: AMPERIO_BASE,
      summary: "Middleware liveness + readiness probe",
      description:
        "Unauthenticated liveness endpoint (for load balancers) and authenticated readiness detail. When called with a service token, returns per-site connectivity status so Enexa can distinguish middleware outage from site outage.",
      auth: "None for liveness; Bearer {enexa_service_token} for detail",
      when: "Every 30 seconds from Enexa's monitoring probe",
      requestSample: `GET ${AMPERIO_BASE}/health
Authorization: Bearer {enexa_service_token}`,
      responseSample: `HTTP/1.1 200 OK

{
  // ok | degraded | unhealthy
  "status": "ok",
  // Middleware build / git sha
  "version": "amperio-mw-1.8.4",
  // ISO 8601
  "timestamp": "2025-04-22T11:00:00Z",
  // Per-site connectivity — only present with service token
  "sites": [
    {
      "site_id": "site_abc123",
      // Modbus reachable right now?
      "modbus_up": true,
      // Seconds since last successful Modbus read
      "last_modbus_read_s": 4,
      // Pending dispatch commands in the local queue
      "pending_commands": 0
    }
  ]
}`,
      statusCodes: [
        { code: "200", meaning: "Healthy or degraded — check body" },
        { code: "503", meaning: "Unhealthy — do not route traffic" },
      ],
    },
  ],
}

// Ordering mirrors the sidebar's API Specifications flow:
//   Telemetry \u2192 Command Status \u2192 Dispatching \u2192 Config (Master Data + Site Config)
// Auxiliary support APIs (Onboarding, Notifications, Health) follow at the end.
// The screen groups by host underneath, so Dispatching + Health land in the
// Amperio-hosted section regardless of their position in this array.
const ALL_GROUPS: EndpointGroup[] = [
  telemetryGroup,
  commandStatusGroup,
  dispatchGroup,
  masterDataGroup,
  configGroup,
  onboardingGroup,
  notificationsGroup,
  healthGroup,
]

/* ------------------------------------------------------------------ */
/*  UI                                                                */
/* ------------------------------------------------------------------ */

function methodBadgeClass(method: HttpMethod): string {
  switch (method) {
    case "GET":
      return "bg-emerald-600 hover:bg-emerald-600 text-white"
    case "POST":
      return "bg-blue-600 hover:bg-blue-600 text-white"
    case "PUT":
      return "bg-amber-600 hover:bg-amber-600 text-white"
    case "PATCH":
      return "bg-violet-600 hover:bg-violet-600 text-white"
    case "DELETE":
      return "bg-rose-600 hover:bg-rose-600 text-white"
  }
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast({ title: "Copied", description: `${label} copied to clipboard.` })
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-xs"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="size-3.5" /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" /> Copy
            </>
          )}
        </Button>
      </div>
      <pre className="p-3 text-xs leading-relaxed overflow-x-auto font-mono">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function EndpointAccordionItem({ endpoint }: { endpoint: Endpoint }) {
  return (
    <AccordionItem
      value={endpoint.id}
      className="border rounded-lg px-0 [&[data-state=open]]:bg-muted/20"
    >
      <AccordionTrigger className="px-4 py-3 hover:no-underline">
        <div className="flex flex-1 items-center gap-3 min-w-0">
          <Badge className={`font-mono text-xs shrink-0 ${methodBadgeClass(endpoint.method)}`}>
            {endpoint.method}
          </Badge>
          <code className="font-mono text-sm truncate text-left">{endpoint.path}</code>
          <span className="ml-auto text-xs text-muted-foreground text-right truncate hidden md:block max-w-sm">
            {endpoint.summary}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4 space-y-4">
        {/* Description */}
        <div className="space-y-2">
          <p className="text-sm leading-relaxed">{endpoint.description}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <Server className="size-3.5" />
            <span>
              {endpoint.baseUrl}
              <span className="text-foreground">{endpoint.path}</span>
            </span>
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border p-3 bg-muted/20">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
              <ShieldCheck className="size-3" /> Auth
            </div>
            <div className="text-xs font-mono">{endpoint.auth}</div>
          </div>
          <div className="rounded-md border p-3 bg-muted/20">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              When called
            </div>
            <div className="text-xs">{endpoint.when}</div>
          </div>
        </div>

        {/* Request */}
        {endpoint.requestSample && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Request
            </div>
            <CodeBlock label="Request" code={endpoint.requestSample} />
          </div>
        )}

        {/* Response */}
        <div className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Response
          </div>
          <CodeBlock label="Response" code={endpoint.responseSample} />
        </div>

        {/* Status codes */}
        {endpoint.statusCodes && endpoint.statusCodes.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Status codes
            </div>
            <div className="rounded-md border divide-y overflow-hidden">
              {endpoint.statusCodes.map((sc) => (
                <div
                  key={sc.code}
                  className="flex items-start gap-3 px-3 py-2 text-xs bg-muted/10"
                >
                  <code className="font-mono font-semibold text-foreground shrink-0 w-12">
                    {sc.code}
                  </code>
                  <span className="text-muted-foreground">{sc.meaning}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

function GroupSection({ group }: { group: EndpointGroup }) {
  const Icon = group.icon
  const isEnexa = group.host === "enexa"
  const hostBadge = isEnexa ? (
    <Badge className="bg-blue-600 hover:bg-blue-600 text-white text-xs shrink-0">
      Enexa hosts
    </Badge>
  ) : (
    <Badge className="bg-orange-600 hover:bg-orange-600 text-white text-xs shrink-0">
      Amperio hosts
    </Badge>
  )

  const borderTone = isEnexa ? "border-blue-500/20" : "border-orange-500/20"
  const tintTone = isEnexa ? "bg-blue-500/[0.03]" : "bg-orange-500/[0.03]"

  return (
    <Card className={`${borderTone} ${tintTone}`}>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div
              className={`size-8 rounded-md grid place-items-center ${
                isEnexa ? "bg-blue-500/10 text-blue-600" : "bg-orange-500/10 text-orange-600"
              }`}
            >
              <Icon className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{group.title}</CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                {group.purpose}
              </CardDescription>
            </div>
          </div>
          {hostBadge}
        </div>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="space-y-2">
          {group.endpoints.map((ep) => (
            <EndpointAccordionItem key={ep.id} endpoint={ep} />
          ))}
        </Accordion>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Screen                                                            */
/* ------------------------------------------------------------------ */

export function ApiRepositoryScreen() {
  const enexaGroups = ALL_GROUPS.filter((g) => g.host === "enexa")
  const amperioGroups = ALL_GROUPS.filter((g) => g.host === "amperio")
  const totalEndpoints = ALL_GROUPS.reduce((n, g) => n + g.endpoints.length, 0)

  return (
    <div className="w-full py-8 px-6 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] tracking-wider uppercase">
            Reference
          </Badge>
          <Badge variant="outline" className="text-[10px] tracking-wider uppercase">
            Copy-ready payloads
          </Badge>
          <Badge variant="outline" className="text-[10px] tracking-wider uppercase">
            {totalEndpoints} endpoints
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">API Repository</h1>
        <p className="text-muted-foreground max-w-3xl leading-relaxed">
          A single, Swagger-style catalogue of every HTTP API exchanged between{" "}
          <strong>Enexa</strong> and <strong>Middleware</strong>. Endpoints are
          grouped by <em>who hosts them</em> and <em>what they&apos;re for</em>. Expand any
          entry to see the proposed URL, authentication, timing, request / response samples
          (with inline field explanations), and status codes &mdash; each block has a
          <span className="font-medium"> Copy </span> button for quick paste into Postman,
          Insomnia, or a <code className="text-xs">curl</code> script.
        </p>
      </div>

      {/* Enexa-hosted groups */}
      <section className="space-y-4">
        <HostHeading
          title="Enexa-hosted APIs"
          subtitle="Called by Middleware against api.enexa.io"
          host="enexa"
          count={enexaGroups.reduce((n, g) => n + g.endpoints.length, 0)}
        />
        <div className="space-y-4">
          {enexaGroups.map((g) => (
            <GroupSection key={g.id} group={g} />
          ))}
        </div>
      </section>

      {/* Amperio-hosted groups */}
      <section className="space-y-4">
        <HostHeading
          title="Amperio-hosted APIs"
          subtitle="Called by Enexa against api.amperio.io"
          host="amperio"
          count={amperioGroups.reduce((n, g) => n + g.endpoints.length, 0)}
        />
        <div className="space-y-4">
          {amperioGroups.map((g) => (
            <GroupSection key={g.id} group={g} />
          ))}
        </div>
      </section>

      {/* Footnote */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <FileJson className="size-4 mt-0.5 shrink-0" />
            <p>
              Payload samples use <strong>JSONC</strong> (JSON with{" "}
              <code className="text-xs">{"//"}</code> comments) for readability. Strip
              comments before sending on the wire &mdash; the endpoints themselves only
              accept standard <code className="text-xs">application/json</code>. Fields
              marked with placeholders like{" "}
              <code className="text-xs">{"{tenant_api_key}"}</code> must be substituted
              before copy-paste into a live request.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function HostHeading({
  title,
  subtitle,
  host,
  count,
}: {
  title: string
  subtitle: string
  host: "enexa" | "amperio"
  count: number
}) {
  const color = host === "enexa" ? "text-blue-600" : "text-orange-600"
  const bgBar = host === "enexa" ? "bg-blue-500" : "bg-orange-500"
  return (
    <div className="flex items-center gap-4">
      <div className={`h-8 w-1 rounded-full ${bgBar}`} aria-hidden />
      <div className="flex-1">
        <h2 className={`text-lg font-semibold ${color}`}>{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <Badge variant="outline" className="text-xs shrink-0">
        {count} endpoints
      </Badge>
    </div>
  )
}

