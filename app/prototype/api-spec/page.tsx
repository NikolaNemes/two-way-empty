"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Database,
  Server,
  Zap,
  Clock,
  List,
  BarChart3,
  AlertTriangle,
  FileJson,
  ArrowRight,
  CheckCircle2,
  Circle,
  Layers,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────────────────
// API Specification Page
// ─────────────────────────────────────────────────────────────────────────────

export default function ApiSpecPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Enexa Prototype — Backend API Specification
          </h1>
          <p className="text-muted-foreground">
            APIs required for the Prototype screens to operate against real
            telemetry data instead of the current in-browser simulation.
          </p>
        </div>

        {/* Current State */}
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600" />
              Current State — Raw S3 Ingestion
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>
              The ChargePost station currently pushes JSON telemetry objects to
              a simple ingestion endpoint every second. These are stored as raw
              JSON files on S3 with no transformation, indexing, or queryable
              structure.
            </p>
            <div className="flex items-center gap-2 text-xs font-mono bg-muted/50 rounded px-3 py-2">
              <span className="text-muted-foreground">ChargePost</span>
              <ArrowRight className="size-3" />
              <span className="text-muted-foreground">POST /ingest</span>
              <ArrowRight className="size-3" />
              <span className="text-muted-foreground">S3 (raw JSON)</span>
            </div>
            <p className="text-muted-foreground">
              To power the Prototype UI, we need to load this data into a
              time-series-friendly database and expose query APIs.
            </p>
          </CardContent>
        </Card>

        {/* Architecture Overview */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="size-4 text-blue-500" />
              Target Architecture
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-mono bg-muted/30 rounded-lg p-4">
              <div className="flex flex-col items-center gap-1 px-3 py-2 bg-background rounded border">
                <span className="text-muted-foreground">ChargePost</span>
                <span className="text-[10px] text-muted-foreground/70">
                  1 Hz telemetry
                </span>
              </div>
              <ArrowRight className="size-4 text-muted-foreground" />
              <div className="flex flex-col items-center gap-1 px-3 py-2 bg-background rounded border">
                <span className="text-blue-600">Ingestion API</span>
                <span className="text-[10px] text-muted-foreground/70">
                  validate + store
                </span>
              </div>
              <ArrowRight className="size-4 text-muted-foreground" />
              <div className="flex flex-col items-center gap-1 px-3 py-2 bg-background rounded border border-emerald-500/50">
                <span className="text-emerald-600">TimescaleDB</span>
                <span className="text-[10px] text-muted-foreground/70">
                  hypertable
                </span>
              </div>
              <ArrowRight className="size-4 text-muted-foreground" />
              <div className="flex flex-col items-center gap-1 px-3 py-2 bg-background rounded border">
                <span className="text-violet-600">Query APIs</span>
                <span className="text-[10px] text-muted-foreground/70">
                  REST / WebSocket
                </span>
              </div>
              <ArrowRight className="size-4 text-muted-foreground" />
              <div className="flex flex-col items-center gap-1 px-3 py-2 bg-background rounded border">
                <span className="text-muted-foreground">Prototype UI</span>
                <span className="text-[10px] text-muted-foreground/70">
                  this app
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section Divider */}
        <div className="flex items-center gap-4 pt-4">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Section 1 — Telemetry APIs
          </span>
          <Badge variant="default" className="text-[10px]">
            Implement Now
          </Badge>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Telemetry Payload Schema */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileJson className="size-4 text-blue-500" />
              Inbound Telemetry Payload — ChargePost → Enexa
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This is the JSON structure the ChargePost station sends every
              second. Your ingestion API receives this and must parse, validate,
              and store it.
            </p>
            <PayloadSchema />
          </CardContent>
        </Card>

        {/* Required Services */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Required Telemetry Services</h2>

          {/* Service 1: Ingestion */}
          <ServiceCard
            number={1}
            title="Telemetry Ingestion"
            endpoint="POST /api/telemetry/ingest"
            priority="critical"
            status="replace-existing"
            description="Replace the current S3-dump endpoint with one that validates the payload and inserts into TimescaleDB."
            consumers={["ChargePost station (push)"]}
            details={[
              "Validate JSON schema on ingest",
              "Insert into telemetry_frames hypertable",
              "Denormalise nested objects (batteries, chargers) into separate rows or JSONB columns",
              "Return 202 Accepted + frame_id on success",
              "Idempotency: dedupe by (station_id, ts) composite key",
            ]}
            responseShape={`{
  "status": "accepted",
  "frame_id": "f_abc123",
  "station_id": "station_001",
  "ts": "2024-05-01T12:34:56.000Z"
}`}
          />

          {/* Service 2: Latest Frame */}
          <ServiceCard
            number={2}
            title="Latest Telemetry Frame"
            endpoint="GET /api/telemetry/latest?station_id=..."
            priority="critical"
            status="new"
            description="Return the most recent telemetry frame for a station. Powers the Snapshot screen's live gauges."
            consumers={["Snapshot screen", "Commands screen (observation state)"]}
            details={[
              "Single-row lookup: ORDER BY ts DESC LIMIT 1",
              "Include all nested objects (grid, batteries, chargers, station, market)",
              "Cache with short TTL (1s) or serve directly if DB is fast enough",
              "Return 404 if station has no data",
            ]}
            responseShape={`{
  "frame": { /* full TelemetryFrame */ },
  "station_id": "station_001",
  "age_ms": 342  // how stale this frame is
}`}
          />

          {/* Service 3: Frame Stream */}
          <ServiceCard
            number={3}
            title="Telemetry Stream (WebSocket)"
            endpoint="WS /api/telemetry/stream?station_id=..."
            priority="high"
            status="new"
            description="Push new frames to connected clients in real-time. Powers live-updating UI without polling."
            consumers={["Snapshot screen", "Commands screen", "Dispatching Timeline"]}
            details={[
              "Subscribe client to station_id channel on connect",
              "Push each new frame as it arrives (via DB trigger or in-process fanout)",
              "Include frame sequence number for gap detection",
              "Heartbeat every 5s if no data (keep connection alive)",
              "Support reconnect with last_seq parameter to replay missed frames",
            ]}
            responseShape={`// Server pushes on each tick:
{
  "type": "frame",
  "seq": 12345,
  "frame": { /* full TelemetryFrame */ }
}

// Heartbeat:
{ "type": "heartbeat", "ts": "..." }`}
          />

          {/* Service 4: History Range */}
          <ServiceCard
            number={4}
            title="Telemetry History (Time Range)"
            endpoint="GET /api/telemetry/history?station_id=...&from=...&to=...&resolution=..."
            priority="high"
            status="new"
            description="Return telemetry frames for a time window, with optional downsampling. Powers time-series charts."
            consumers={["Dispatching Timeline (day replay)", "Historical analysis"]}
            details={[
              "Query by (station_id, ts) range",
              "resolution param: 'raw' (1s), '1m', '5m', '15m', '1h'",
              "For downsampled resolutions, return time_bucket aggregates (avg, min, max)",
              "Limit max range to prevent OOM (e.g., 24h for raw, 7d for 1m)",
              "Return frames array ordered by ts ASC",
            ]}
            responseShape={`{
  "station_id": "station_001",
  "from": "2024-05-01T06:00:00Z",
  "to": "2024-05-02T06:00:00Z",
  "resolution": "1m",
  "count": 1440,
  "frames": [ /* array of TelemetryFrame or aggregated rows */ ]
}`}
          />

          {/* Service 5: Events */}
          <ServiceCard
            number={5}
            title="Event Log Query"
            endpoint="GET /api/telemetry/events?station_id=...&from=...&to=...&severity=..."
            priority="medium"
            status="new"
            description="Return system events (warnings, errors, info) for a station. Powers the event log panel."
            consumers={["Snapshot screen (event log)", "Alerts dashboard"]}
            details={[
              "Filter by severity: info, warning, error",
              "Filter by source: battery_1, battery_2, charger_1, charger_2, grid, station",
              "Paginate with limit/offset or cursor",
              "Include acknowledged flag",
              "Support PATCH to mark events acknowledged",
            ]}
            responseShape={`{
  "station_id": "station_001",
  "events": [
    {
      "id": 42,
      "ts": "2024-05-01T14:23:00Z",
      "severity": "warning",
      "source": "battery_1",
      "code": "TEMP_HIGH",
      "message": "Pack temperature above threshold",
      "acknowledged": false
    }
  ],
  "total": 156,
  "has_more": true
}`}
          />

          {/* Service 6: Aggregates */}
          <ServiceCard
            number={6}
            title="Daily/Hourly Aggregates"
            endpoint="GET /api/telemetry/aggregates?station_id=...&date=...&bucket=..."
            priority="medium"
            status="new"
            description="Pre-computed rollups for dashboard KPIs and cost calculations."
            consumers={["Dispatching Timeline (cost panels)", "Reporting"]}
            details={[
              "bucket: 'hour', 'day'",
              "Return: total_grid_import_kwh, total_grid_export_kwh, total_ev_delivered_kwh",
              "Include: avg_price_eur_mwh, min_price, max_price per bucket",
              "Include: peak_power_w, avg_soc_pct per battery",
              "Materialised views or continuous aggregates for performance",
            ]}
            responseShape={`{
  "station_id": "station_001",
  "date": "2024-05-01",
  "bucket": "hour",
  "aggregates": [
    {
      "hour": 6,
      "grid_import_kwh": 12.4,
      "grid_export_kwh": 0,
      "ev_delivered_kwh": 8.2,
      "avg_price_eur_mwh": 42.48,
      "peak_grid_w": 45000
    },
    // ... 24 hourly buckets
  ]
}`}
          />

          {/* Service 7: Station Config */}
          <ServiceCard
            number={7}
            title="Station Configuration"
            endpoint="GET /api/stations/:station_id/config"
            priority="medium"
            status="new"
            description="Static configuration for a station (hardware specs, limits, tariff plan). Used for envelope calculations."
            consumers={["All screens (envelope limits)", "Cost calculations"]}
            details={[
              "Battery capacity per unit (kWh), max charge/discharge (W)",
              "Charger max power per connector (W)",
              "Grid import/export limits (W)",
              "Tariff plan: 'flat' or 'dynamic' + rate details",
              "Timezone, location metadata",
            ]}
            responseShape={`{
  "station_id": "station_001",
  "name": "Hauptbahnhof Charging Hub",
  "timezone": "Europe/Berlin",
  "batteries": [
    { "unit_id": 1, "capacity_kwh": 64, "max_charge_w": 30000, "max_discharge_w": 30000 },
    { "unit_id": 2, "capacity_kwh": 64, "max_charge_w": 30000, "max_discharge_w": 30000 }
  ],
  "chargers": [
    { "unit_id": 1, "max_power_w": 150000 },
    { "unit_id": 2, "max_power_w": 150000 }
  ],
  "grid": {
    "import_limit_w": 50000,
    "export_limit_w": 0
  },
  "tariff": {
    "type": "dynamic",
    "index": "epex_idm_id3",
    "markup_eur_mwh": 5.0
  }
}`}
          />
        </div>

        {/* Section Divider — Dispatching */}
        <div className="flex items-center gap-4 pt-8">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Section 2 — Dispatching Algorithm APIs
          </span>
          <Badge variant="outline" className="text-[10px]">
            Skip for Now
          </Badge>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Card className="border-muted bg-muted/20">
          <CardContent className="py-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-2">
              Dispatching Algorithm APIs — deferred
            </p>
            <p>
              These APIs handle the optimiser's output: sending setpoint commands
              to the ChargePost station, tracking command lifecycle
              (pending/acked/executed/deviated), and logging the dispatch
              history for audit. They depend on the Telemetry APIs being
              operational first, since the optimiser consumes live telemetry as
              input.
            </p>
            <ul className="mt-3 space-y-1 text-xs">
              <li className="flex items-center gap-2">
                <Circle className="size-2" />
                POST /api/dispatch/command — issue a setpoint command
              </li>
              <li className="flex items-center gap-2">
                <Circle className="size-2" />
                GET /api/dispatch/commands — query command history
              </li>
              <li className="flex items-center gap-2">
                <Circle className="size-2" />
                WS /api/dispatch/stream — real-time command lifecycle updates
              </li>
              <li className="flex items-center gap-2">
                <Circle className="size-2" />
                GET /api/market/prices — EPEX DAM/IDM price curves
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Database Schema Suggestion */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="size-4 text-emerald-500" />
              Suggested Database Schema (TimescaleDB)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs font-mono bg-muted/50 rounded-lg p-4 overflow-x-auto">
{`-- Core telemetry hypertable (1 row per frame)
CREATE TABLE telemetry_frames (
  id              BIGSERIAL,
  station_id      TEXT NOT NULL,
  ts              TIMESTAMPTZ NOT NULL,
  t_s             DOUBLE PRECISION,  -- seconds since station boot
  
  -- Grid
  grid_p_w        INTEGER,           -- signed: + import, - export
  grid_p_aux_w    INTEGER,
  grid_e_imp_kwh  DOUBLE PRECISION,
  grid_e_exp_kwh  DOUBLE PRECISION,
  grid_f_hz       DOUBLE PRECISION,
  grid_cos_phi    DOUBLE PRECISION,
  
  -- Batteries (JSONB array or separate columns)
  batteries       JSONB,             -- [{unit_id, soc_pct, power_w, ...}, ...]
  
  -- Chargers (JSONB array)
  chargers        JSONB,             -- [{unit_id, plug_state, P_EV_w, ...}, ...]
  
  -- Station state
  station         JSONB,             -- {operation_state, limits, warnings, errors}
  
  -- Market
  epex_price_eur_mwh  DOUBLE PRECISION,
  slot_label          TEXT,
  
  -- EV demand (for curtailment tracking)
  p_ev_demand_w   INTEGER,
  
  -- Full payload for debugging (optional, can drop after stabilisation)
  raw_payload     JSONB,
  
  PRIMARY KEY (station_id, ts)
);

-- Convert to hypertable (TimescaleDB)
SELECT create_hypertable('telemetry_frames', 'ts');

-- Index for latest-frame queries
CREATE INDEX idx_telemetry_latest ON telemetry_frames (station_id, ts DESC);

-- Events table
CREATE TABLE telemetry_events (
  id              BIGSERIAL PRIMARY KEY,
  station_id      TEXT NOT NULL,
  ts              TIMESTAMPTZ NOT NULL,
  severity        TEXT NOT NULL,     -- 'info', 'warning', 'error'
  source          TEXT NOT NULL,     -- 'battery_1', 'charger_2', 'grid', etc.
  code            TEXT NOT NULL,
  message         TEXT,
  acknowledged    BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT
);

CREATE INDEX idx_events_station_ts ON telemetry_events (station_id, ts DESC);
CREATE INDEX idx_events_severity ON telemetry_events (station_id, severity, ts DESC);

-- Continuous aggregate for hourly rollups (auto-maintained by TimescaleDB)
CREATE MATERIALIZED VIEW telemetry_hourly
WITH (timescaledb.continuous) AS
SELECT
  station_id,
  time_bucket('1 hour', ts) AS bucket,
  AVG(grid_p_w) AS avg_grid_p_w,
  MAX(grid_p_w) AS peak_import_w,
  MIN(grid_p_w) AS peak_export_w,
  AVG(epex_price_eur_mwh) AS avg_price,
  -- Energy deltas would need LAG() or separate calculation
  COUNT(*) AS sample_count
FROM telemetry_frames
GROUP BY station_id, bucket;`}
            </pre>
          </CardContent>
        </Card>

        {/* Implementation Priority */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-500" />
              Implementation Order
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              <PriorityItem
                number={1}
                title="Set up TimescaleDB + schema"
                description="Create the hypertable and indexes. Can use Timescale Cloud for managed hosting."
              />
              <PriorityItem
                number={2}
                title="Replace ingestion endpoint"
                description="Modify the existing S3-dump endpoint to also write to TimescaleDB. Keep S3 as backup initially."
              />
              <PriorityItem
                number={3}
                title="Implement GET /latest"
                description="Simple single-row query. Once this works, the Snapshot screen can switch from simulation to live data."
              />
              <PriorityItem
                number={4}
                title="Implement WebSocket stream"
                description="Enables real-time updates without polling. Can use Postgres LISTEN/NOTIFY or in-process pub/sub."
              />
              <PriorityItem
                number={5}
                title="Implement GET /history"
                description="Enables the Dispatching Timeline to replay real historical days instead of simulated May 1."
              />
              <PriorityItem
                number={6}
                title="Add aggregates + events"
                description="Polish features: pre-computed rollups for dashboards, event log for operational awareness."
              />
            </ol>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-xs text-muted-foreground pt-4 border-t">
          <p>
            This specification is derived from the data shapes currently used by
            the in-browser simulation in{" "}
            <code className="bg-muted px-1 rounded">
              lib/prototype-telemetry.ts
            </code>
            . The API contracts are designed to be drop-in replacements: the UI
            can switch from the simulated hook to a real API client with minimal
            changes.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

function ServiceCard({
  number,
  title,
  endpoint,
  priority,
  status,
  description,
  consumers,
  details,
  responseShape,
}: {
  number: number
  title: string
  endpoint: string
  priority: "critical" | "high" | "medium" | "low"
  status: "new" | "replace-existing"
  description: string
  consumers: string[]
  details: string[]
  responseShape: string
}) {
  const priorityColor = {
    critical: "border-red-500/50 bg-red-500/5",
    high: "border-orange-500/50 bg-orange-500/5",
    medium: "border-blue-500/50 bg-blue-500/5",
    low: "border-muted",
  }[priority]

  const priorityBadge = {
    critical: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
    high: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
    medium: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
    low: "bg-muted text-muted-foreground",
  }[priority]

  return (
    <Card className={cn("transition-colors", priorityColor)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-7 rounded-full bg-foreground/10 text-xs font-bold">
              {number}
            </div>
            <div>
              <CardTitle className="text-sm">{title}</CardTitle>
              <code className="text-xs font-mono text-muted-foreground mt-0.5 block">
                {endpoint}
              </code>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-[10px]", priorityBadge)}>
              {priority}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                status === "replace-existing"
                  ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
                  : "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
              )}
            >
              {status === "replace-existing" ? "replace existing" : "new"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{description}</p>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground font-medium">Consumers:</span>
          {consumers.map((c, i) => (
            <Badge key={i} variant="secondary" className="text-[10px]">
              {c}
            </Badge>
          ))}
        </div>

        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Implementation notes:
          </span>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {details.map((d, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-foreground/50 mt-0.5">•</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Response shape:
          </span>
          <pre className="text-[11px] font-mono bg-muted/50 rounded px-3 py-2 overflow-x-auto">
            {responseShape}
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}

function PriorityItem({
  number,
  title,
  description,
}: {
  number: number
  title: string
  description: string
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="flex items-center justify-center size-6 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-bold shrink-0">
        {number}
      </div>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-muted-foreground text-xs">{description}</div>
      </div>
    </li>
  )
}

function PayloadSchema() {
  return (
    <pre className="text-[11px] font-mono bg-muted/50 rounded-lg p-4 overflow-x-auto">
{`// TelemetryFrame — sent by ChargePost every 1 second
{
  "ts": "2024-05-01T12:34:56.123Z",   // ISO timestamp
  "t_s": 23456,                        // seconds since station boot
  
  "grid": {
    "P_grid_w": 32500,                 // signed: + import, - export
    "P_aux_w": 1200,                   // always positive: aux load
    "E_grid_imp_kwh": 12456.7,         // lifetime import counter
    "E_grid_exp_kwh": 1823.4,          // lifetime export counter
    "E_aux_kwh": 4812.3,               // lifetime aux counter
    "f_grid_hz": 50.02,
    "cos_phi": 0.98
  },
  
  "batteries": [
    {
      "unit_id": 1,
      "soc_pct": 62.4,
      "power_w": -15000,               // signed: + charging, - discharging
      "temp_min_c": 24.2,
      "temp_max_c": 28.1,
      "max_charge_w": 30000,
      "max_discharge_w": 30000,
      "contactor_state": "closed",     // "open" | "closed" | "fault"
      "soh_pct": 98.2,
      "E_charged_kwh": 9320.4,
      "E_discharged_kwh": 8117.6
    },
    { "unit_id": 2, /* ... same shape */ }
  ],
  
  "chargers": [
    {
      "unit_id": 1,
      "plug_state": "Plugged",         // "Unplugged" | "Plugged"
      "charging_state": "InProgress",  // "Idle" | "Preparing" | "InProgress" | ...
      "charging_process_state": "Charging",
      "P_EV_w": 45000,                 // power to EV (always positive)
      "P_EV_max_w": 150000,
      "P_cp_max_w": 150000,            // hardware ceiling
      "soc_EV_pct": 58,                // estimated EV SoC
      "E_EV_chg_kwh": 12.4,            // energy this session
      "boost_contactor": "closed"
    },
    { "unit_id": 2, /* ... same shape */ }
  ],
  
  "station": {
    "operation_state": "Ready",        // "Ready" | "Standby" | "Faulted" | ...
    "P_grid_consumption_limit_w": 50000,
    "P_grid_generation_limit_w": 0,
    "warnings": [],                    // array of TelemetryEvent
    "errors": []
  },
  
  "market": {
    "epex_price_eur_mwh": -91.90,      // current EPEX price
    "slot_label": "12:00-12:15"
  },
  
  "new_events": [],                    // events emitted this tick
  "P_EV_demand_w": 45000               // total EV demand before curtailment
}`}
    </pre>
  )
}
