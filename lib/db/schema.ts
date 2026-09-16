// ════════════════════════════════════════════════════════════════════════
// DRIZZLE SCHEMA — mirrors the DDL applied to Neon via the Neon MCP.
// ════════════════════════════════════════════════════════════════════════
//
// App tables only (no auth tables, no foreign keys — per the Neon stack
// conventions). These back the telemetry data platform: durable frame storage,
// the decision-model registry, ingestion job tracking, and backtest results.
// ════════════════════════════════════════════════════════════════════════

import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core"

// ── Decision-model registry ────────────────────────────────────────────────
// One row per versioned parameterization of the dispatch kernel. v1 is the
// frozen snapshot of the current live constants.
export const modelVersion = pgTable(
  "model_version",
  {
    id: serial("id").primaryKey(),
    label: text("label").notNull(), // e.g. "v1"
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("draft"), // frozen | active | draft
    isDefault: boolean("is_default").notNull().default(false),
    params: jsonb("params").notNull(), // KernelParams snapshot
    kernelNotes: text("kernel_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    labelUidx: uniqueIndex("model_version_label_uidx").on(t.label),
  }),
)

// ── Telemetry frames (durable store, 15s resolution) ────────────────────────
// Denormalized numeric columns for fast analytics + full normalized frame in
// `raw` for fidelity. Unique (station_id, ts) makes backfill idempotent.
export const telemetryFrame = pgTable(
  "telemetry_frame",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    stationId: text("station_id").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    source: text("source").notNull().default("amperio"),
    gridPowerW: doublePrecision("grid_power_w"),
    gridImportLimitW: doublePrecision("grid_import_limit_w"),
    socPackA: doublePrecision("soc_pack_a"),
    socPackB: doublePrecision("soc_pack_b"),
    socAvg: doublePrecision("soc_avg"),
    evLoadW: doublePrecision("ev_load_w"),
    battPowerW: doublePrecision("batt_power_w"),
    priceEurMwh: doublePrecision("price_eur_mwh"),
    chargingModeA: integer("charging_mode_a"),
    chargingModeB: integer("charging_mode_b"),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    stationTsUidx: uniqueIndex("telemetry_frame_station_ts_uidx").on(t.stationId, t.ts),
    stationTsDescIdx: index("telemetry_frame_station_ts_desc_idx").on(t.stationId, t.ts),
  }),
)

// ── Ingestion jobs (backfill tracking) ──────────────────────────────────────
export const ingestionJob = pgTable(
  "ingestion_job",
  {
    id: serial("id").primaryKey(),
    stationId: text("station_id").notNull(),
    fromTs: timestamp("from_ts", { withTimezone: true }).notNull(),
    toTs: timestamp("to_ts", { withTimezone: true }).notNull(),
    stepSeconds: integer("step_seconds").notNull().default(15),
    status: text("status").notNull().default("running"), // running | done | error
    framesIngested: integer("frames_ingested").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    stationIdx: index("ingestion_job_station_idx").on(t.stationId, t.startedAt),
  }),
)

// ── Backtest runs (KPIs per version over the stored dataset) ─────────────────
export const backtestRun = pgTable(
  "backtest_run",
  {
    id: serial("id").primaryKey(),
    modelVersionId: integer("model_version_id").notNull(),
    stationId: text("station_id").notNull(),
    fromTs: timestamp("from_ts", { withTimezone: true }).notNull(),
    toTs: timestamp("to_ts", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("done"),
    params: jsonb("params").notNull(),
    kpis: jsonb("kpis").notNull(),
    series: jsonb("series"),
    sessions: jsonb("sessions"), // derived C1/C2 charging sessions
    totals: jsonb("totals"), // actual vs optimized import + EV delivered (kWh)
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionIdx: index("backtest_run_version_idx").on(t.modelVersionId, t.createdAt),
    stationIdx: index("backtest_run_station_idx").on(t.stationId, t.createdAt),
  }),
)

// ── DAM price cache (durable last-known-good for the price-supply chain) ─────
// One row per (zone, 15-min slot). Warmed on every successful real fetch and
// read as a fallback so the dispatch planner always has forward prices even
// when both live sources are down. `slot` is the epoch-based absolute 15-min
// index (see services/dispatch-worker/src/slots.ts / lib/dispatch-kernel.ts).
export const damPrice = pgTable(
  "dam_price",
  {
    zone: text("zone").notNull().default("DE-LU"),
    slot: bigint("slot", { mode: "number" }).notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    priceEurMwh: doublePrecision("price_eur_mwh").notNull(),
    source: text("source").notNull(), // amperio | awattar | ...
    resampled: boolean("resampled").notNull().default(false), // hourly→15min fill
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.zone, t.slot] }),
    zoneSlotIdx: index("dam_price_zone_slot_idx").on(t.zone, t.slot),
  }),
)

// ── IDM (intraday) price cache ───────────────────────────────────────────────
// Same shape as dam_price but for the continuous intraday market (ID1/ID3-style
// quarter-hourly clearing). Warmed by the IDM backfill from real sources
// (Energy-Charts → SMARD) and read by the v4 MPC for near-term pricing + replan
// triggers. Kept in its own table so DAM remains the canonical planning curve.
export const idmPrice = pgTable(
  "idm_price",
  {
    zone: text("zone").notNull().default("DE-LU"),
    slot: bigint("slot", { mode: "number" }).notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    priceEurMwh: doublePrecision("price_eur_mwh").notNull(),
    source: text("source").notNull(), // energy-charts | smard | ...
    resampled: boolean("resampled").notNull().default(false),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.zone, t.slot] }),
    zoneSlotIdx: index("idm_price_zone_slot_idx").on(t.zone, t.slot),
  }),
)

// ── Station registry (multi-location dispatch) ──────────────────────────────
// One row per Chargepost location. Physical + commercial parameters that were
// previously hardcoded kernel constants (Gronau's physics) live here so a new
// location is onboarded by INSERT, not by deploy. The kernel constants remain
// in code ONLY as seed defaults for this table.
export const stations = pgTable("stations", {
  stationId: text("station_id").primaryKey(),
  name: text("name").notNull(),
  siteId: text("site_id").notNull(),
  assetId: text("asset_id").notNull(),
  /** Telemetry/monitoring flag: the platform tracks this location (ingestion,
   * status polling). It does NOT mean data is actually arriving — the fleet
   * dashboard measures that live. */
  enabled: boolean("enabled").notNull().default(true),
  /** Dispatching flag: the optimizer actively drives this location. Enabling
   * dispatch implies telemetry (enforced in lib/stations.ts setters). */
  dispatchEnabled: boolean("dispatch_enabled").notNull().default(false),
  // Physical
  // OPERATOR OVERRIDE (Aug 21 2026): flat 90 kW ceiling fleet-wide; per-site
  // physical/DSO limits intentionally ignored for now (was 87 / 83.5).
  gridImportLimitKw: doublePrecision("grid_import_limit_kw").notNull().default(90),
  gridRealPowerCapKw: doublePrecision("grid_real_power_cap_kw").notNull().default(90),
  battCount: integer("batt_count").notNull().default(2),
  battCapacityKwh: doublePrecision("batt_capacity_kwh").notNull().default(280),
  battMaxPowerKw: doublePrecision("batt_max_power_kw").notNull().default(120),
  connectorSingleMaxW: doublePrecision("connector_single_max_w").notNull().default(150_000),
  connectorDualMaxW: doublePrecision("connector_dual_max_w").notNull().default(300_000),
  // Commercial
  flatRateCtKwh: doublePrecision("flat_rate_ct_kwh").notNull().default(12.5),
  wearCtKwh: doublePrecision("wear_ct_kwh").notNull().default(3.5),
  idmAdderCtKwh: doublePrecision("idm_adder_ct_kwh").notNull().default(0),
  // Market
  priceZone: text("price_zone").notNull().default("DE-LU"),
  /** Set on a historical twin row that is the SAME physical location as a live
   * pilot station (e.g. hist_AX10095481 → chargepost_gronau_001). Rows with
   * this set are absorbed into their pilot in listStations so location counts
   * match the partner's list (56, not 58). getStation by id still works —
   * fleet reports keep addressing hist ids directly. */
  linkedStationId: text("linked_station_id"),
  /** Partner's site classification: 'ev_only' | 'ev_pv' | null (unknown).
   * NEVER derived from telemetry — a PV-detection attempt from grid-sign data
   * was proven wrong (Norderstedt, aug 2026). Filled manually / from the
   * partner's master list. Drives the site-class split on the yearly report. */
  siteClass: text("site_class"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

// ── Daily report rollups (retention-safe reporting) ─────────────────────────
// One row per (station, closed UTC day), written by the nightly rollup cron
// BEFORE raw telemetry_frame rows age out of the 35-day retention window.
// This is what keeps Dispatching History / Financial Breakdown working for
// ranges older than the raw window — daily granularity only, by design.
//
// dynamic_cost_eur is FROZEN at rollup time (metered import priced on the
// IDM curve, DAM fallback). The flat tariff is intentionally NOT frozen:
// it is recomputed at read time as flat_rate × import_kwh so the user's
// configurable flat rate keeps working over historical ranges.
export const stationDayReport = pgTable(
  "station_day_report",
  {
    stationId: text("station_id").notNull(),
    /** UTC day the row aggregates, as "YYYY-MM-DD". */
    day: text("day").notNull(),
    // Data-quality stamps
    frames: integer("frames").notNull(),
    /** frames / 5760 (15s cadence) — how complete the day's telemetry was. */
    coveragePct: doublePrecision("coverage_pct").notNull(),
    // Energy totals (kWh)
    importKwh: doublePrecision("import_kwh").notNull(),
    evKwh: doublePrecision("ev_kwh").notNull(),
    /** AUX (ChargePost self-consumption). Since method 2026-09-03.3 = the
     *  day's ENERGY BALANCE: import − export − metered EV − battNet, so
     *  import = EV + AUX + battNet closes exactly. Rows frozen earlier hold the
     *  per-frame clamped figure (batt_net_kwh NULL marks them). */
    auxKwh: doublePrecision("aux_kwh"),
    /** Metered battery charge − discharge for the day (kWh, + = pack absorbed
     *  net energy). NULL on rows frozen before 2026-09-03.3. */
    battNetKwh: doublePrecision("batt_net_kwh"),
    // Dispatch savings (production MPC replay, frozen)
    actualCostEur: doublePrecision("actual_cost_eur").notNull(),
    optimizedCostEur: doublePrecision("optimized_cost_eur").notNull(),
    savingsEur: doublePrecision("savings_eur").notNull(),
    // Tariff pricing (frozen)
    dynamicCostEur: doublePrecision("dynamic_cost_eur"),
    /** Fraction of import energy that had a real market price (0..1). */
    pricedFraction: doublePrecision("priced_fraction"),
    /** Fraction of priced energy that used IDM (vs DAM fallback). */
    idmFraction: doublePrecision("idm_fraction"),
    // Provenance
    engineVersion: text("engine_version"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    /** Full per-day DailySaving + totals snapshot for UI rehydration. */
    detail: jsonb("detail"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.stationId, t.day] }),
    dayIdx: index("station_day_report_day_idx").on(t.day),
  }),
)

export type StationDayReportRow = typeof stationDayReport.$inferSelect

/**
 * PRE-COMPUTED Fleet Monthly Report rows (client feedback aug 20 2026: the
 * yearly view must NOT compute on the fly). One row per station × month,
 * filled by /api/cron/fleet-report running the EXACT pipeline the interactive
 * Fleet Monthly page runs (simulateFleetMonth + July-2026 capture calibration
 * + Gronau anchor gate), then frozen here for the yearly page + Excel export.
 */
export const fleetMonthReport = pgTable(
  "fleet_month_report",
  {
    stationId: text("station_id").notNull(),
    /** Calendar month, "YYYY-MM". */
    month: text("month").notNull(),
    // Display identity (frozen so the report renders without joins)
    city: text("city").notNull(),
    zip: text("zip").notNull(),
    brand: text("brand"),
    /** "month" | "seasonal" | "recent" — which archive volume basis was used. */
    volumeSource: text("volume_source").notNull(),
    /** True only for the Gronau anchor month rows that passed the sanity gate. */
    measured: boolean("measured").notNull().default(false),
    // Volumes
    importKwh: doublePrecision("import_kwh").notNull(),
    /** LEGACY site-load figure = kernel EV demand signal (power balance:
     *  max(0, batt − grid)), which ABSORBS the ChargePost aux/hotel draw.
     *  Kept because the archive (hist_*) CSV export carries no connector
     *  counters, so it is the only volume those rows have. Never label it
     *  "EV" in a report — use evDeliveredKwh / auxKwh (Gronau defect 3). */
    evKwh: doublePrecision("ev_kwh").notNull(),
    /** EV delivered (C1+C2) = METERED per-connector counter energy — the same
     *  definition as the site financial KPI and the Annex. NULL on archive
     *  rows (no counters in the export). */
    evDeliveredKwh: doublePrecision("ev_delivered_kwh"),
    /** AUX (ChargePost self-consumption): non-dispatchable grid draw the battery
     *  cannot offset. Since method 2026-09-03.3 = the window ENERGY BALANCE
     *  (import − export − EV delivered − battery net), so the row identity
     *  importKwh = evDeliveredKwh + auxKwh + battNetKwh closes exactly. NULL on
     *  archive rows. */
    auxKwh: doublePrecision("aux_kwh"),
    /** Battery net = metered charge − discharge over the window (kWh, + = the
     *  pack absorbed net energy from the site). Closes the energy identity above.
     *  NULL on archive rows and on rows frozen before 2026-09-03.3. */
    battNetKwh: doublePrecision("batt_net_kwh"),
    /** Charging sessions. Live rows: charge events from the per-connector
     *  energy counters. Archive rows: per-connector power islands derived from
     *  the operator's CCR export (portfolio_session, sep 4 2026) — NULL until
     *  that station's export has been imported (client decision 2 sep 2026:
     *  report n/a, never the import's 5 kW rising-edge estimate). */
    sessions: doublePrecision("sessions"),
    /** HOW `sessions` was obtained — "counters" (live) | "lp-power-islands-v1"
     *  (archive export) | NULL (no session basis → n/a). A row's session count
     *  is reportable iff this is set; see lib/hist-provenance. */
    sessionsBasis: text("sessions_basis"),
    // Economics (EUR)
    flatEur: doublePrecision("flat_eur").notNull(),
    noShiftEur: doublePrecision("no_shift_eur").notNull(),
    asRunEur: doublePrecision("as_run_eur").notNull(),
    procSavingEur: doublePrecision("proc_saving_eur").notNull(),
    /** Battery wear WITHOUT load shifting (A4.2) — the counterfactual's forced
     *  peak-shaving cycling only. NULL on rows frozen before sep 3 2026. */
    wearNoShiftEur: doublePrecision("wear_no_shift_eur"),
    /** Battery wear WITH load shifting, as run (A4.1) — full measured throughput.
     *  wearEur == wearAsRunEur − wearNoShiftEur. NULL on older rows. */
    wearAsRunEur: doublePrecision("wear_as_run_eur"),
    /** EXTRA wear the load shifting added (A6.3) = wearAsRunEur − wearNoShiftEur. */
    wearEur: doublePrecision("wear_eur").notNull(),
    netEur: doublePrecision("net_eur").notNull(),
    lsEur: doublePrecision("ls_eur").notNull(),
    timingEur: doublePrecision("timing_eur").notNull(),
    shiftedKwh: doublePrecision("shifted_kwh").notNull(),
    // Provenance
    /** Capture ratio used for this month's fill (July-2026 calibration). */
    capture: doublePrecision("capture"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    // ── Settlement audit fields (NITES feedback aug 31 2026) ──────────────
    /** Implied flat baseline rate, ct/kWh = 100 × flatEur / importKwh. Persisted
     *  so a basis mismatch (the May/July Gronau 14.21/15.42 finding) is
     *  impossible to miss — must read 12.5 on every row. */
    flatCtApplied: doublePrecision("flat_ct_applied"),
    /** Why this row is (not) measured: "measured" | "fallback_clamp" |
     *  "fallback_volume" | "fallback_unavailable" | "sim". */
    anchorStatus: text("anchor_status"),
    /** Last telemetry frame included (measured rows only) — Annex A8. */
    dataThrough: timestamp("data_through", { withTimezone: true }),
    /** FIRST telemetry frame included (measured rows only). Added 2026-09-03
     *  after the Aug 2026 review: Gifhorn's "month" was 20–31 Aug and the
     *  report gave no hint. NULL on rows frozen before that date. */
    dataFrom: timestamp("data_from", { withTimezone: true }),
    /** Distinct Berlin days with data inside the window (measured rows only).
     *  Norderstedt Aug 2026 = 25 of 31 (24–31 Aug outage). NULL before 2026-09-03. */
    coveredDays: integer("covered_days"),
    /** Price-source mix on the counterfactual/as-run pricing (measured only). */
    pricedFraction: doublePrecision("priced_fraction"),
    idmFraction: doublePrecision("idm_fraction"),
    damFraction: doublePrecision("dam_fraction"),
    /** Constants the row was computed with (A8: reproducibility). */
    methodologyVersion: text("methodology_version"),
    flatCt: doublePrecision("flat_ct"),
    adderCt: doublePrecision("adder_ct"),
    wearCt: doublePrecision("wear_ct"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.stationId, t.month] }),
    monthIdx: index("fleet_month_report_month_idx").on(t.month),
  }),
)

export type FleetMonthReportRow = typeof fleetMonthReport.$inferSelect

export type StationRow = typeof stations.$inferSelect

export type ModelVersionRow = typeof modelVersion.$inferSelect
export type TelemetryFrameRow = typeof telemetryFrame.$inferSelect
export type IngestionJobRow = typeof ingestionJob.$inferSelect
export type BacktestRunRow = typeof backtestRun.$inferSelect
