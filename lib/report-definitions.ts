/**
 * Report terminology — the ONE glossary every report, tooltip and workbook
 * draws from ("osnova je definicija iz aneksa").
 *
 * The Annex (app/reports/settlement-methodology) is the contractual source of
 * truth. Every quantity a report prints must be one of these terms: the same
 * label on Financial Breakdown, Dispatching History, Fleet Monthly (hist + live),
 * Fleet Yearly and Price Analysis, the same tooltip everywhere, and a
 * "Definitions" sheet in every Excel export listing exactly these rows.
 *
 * `annex` is the clause of the Settlement Methodology Annex the term is
 * defined in (A1 = Clause 1 Definitions, A5.1 = Clause 5.1, …). `formula`
 * mirrors the Annex formula verbatim so software and contract can't drift.
 *
 * Framework-free on purpose: imported by client components, server route
 * handlers (xlsx) and the printable Annex page. The only dependency is a
 * type-only exceljs import (erased at compile time — nothing ships to clients).
 */

import type ExcelJS from "exceljs"

export type ReportTermKey =
  // ── Annex Clause 1 — base definitions ──
  | "site"
  | "frame"
  | "settlementWindow"
  | "slot"
  | "flatRate"
  | "dynamicTariff"
  | "batteryThroughput"
  | "evFirstPolicy"
  // ── Energy quantities ──
  | "gridImport"
  | "evDelivered"
  | "aux"
  | "battNet"
  | "siteLoad"
  | "sessions"
  | "shiftedKwh"
  | "counterfactualImport"
  // ── Price & cost ──
  | "priceSourceMix"
  | "flatCost"
  | "counterfactualCost"
  | "dynamicCost"
  | "effectiveCt"
  | "idmSpread"
  | "dayVerdict"
  // ── Wear ──
  | "wear"
  | "wearNoShift"
  | "wearAsRun"
  | "extraWear"
  // ── Results ──
  | "procurementSaving"
  | "netTotalSaving"
  | "timingValue"
  | "loadShiftingContribution"
  // ── Constraints ──
  | "gridCap"
  // ── Provenance & audit ──
  | "measuredMonth"
  | "archiveMonth"
  | "dataFrom"
  | "dataThrough"
  | "coveredDays"
  | "methodologyVersion"

export type ReportTerm = {
  key: ReportTermKey
  /** Canonical label — table headers, KPI cards and xlsx columns MUST use this. */
  label: string
  /** Compact label for narrow tables (same tooltip; label is still canonical). */
  short?: string
  /** Unit printed after the label where it fits (kWh, €, ct/kWh, …). */
  unit?: string
  /** Annex clause the term is defined in. */
  annex: string
  /** Plain-language definition (Annex wording). */
  definition: string
  /** Annex formula, verbatim, when the term is a computed quantity. */
  formula?: string
}

/** Wear rate used by both the optimizer and the settlement — Annex Clause 4.1. */
export const WEAR_CT_PER_KWH = 3.5
/** Default reference flat tariff — Annex Clause 1 "Flat Rate". */
export const DEFAULT_FLAT_RATE_CT = 12.5
/** Uniform grid-import ceiling — Annex Clause 7.1. */
export const GRID_CAP_KW = 90
/** Session-island filters shared by BOTH session methods (live counters and
 *  archive per-connector power). Values mirror lib/backtest deriveSessionsFromRows
 *  and lib/ccr-sessions DEFAULT_CCR_SESSION_PARAMS — keep in sync. */
export const SESSION_GAP_MIN = 8
export const SESSION_MIN_KWH = 0.1
export const SESSION_ACTIVE_W = 500

const TERMS: ReportTerm[] = [
  // ── Annex Clause 1 — base definitions ────────────────────────────────────
  {
    key: "site",
    label: "Site",
    annex: "A1",
    definition:
      "The Amperio ChargePost installation: two DC charging connectors (C1, C2), two battery storage strings (B1, B2), auxiliary (hotel) load, and one grid connection point.",
  },
  {
    key: "frame",
    label: "Frame",
    annex: "A1",
    definition:
      "One telemetry sample of the full site state (grid power, per-battery power and state of charge, per-connector EV power, cumulative energy counters), recorded at the native device cadence.",
  },
  {
    key: "settlementWindow",
    label: "Settlement window",
    short: "Window",
    annex: "A1",
    definition:
      "The date range over which a report is computed. A window ending on the current day is clipped at the last ingested Frame (the data-through timestamp).",
  },
  {
    key: "slot",
    label: "Slot",
    annex: "A1",
    definition:
      "A 15-minute market interval, indexed as floor(unix time / 900 s), matching the German intraday market (IDM) product granularity.",
  },
  {
    key: "flatRate",
    label: "Flat rate",
    unit: "ct/kWh",
    annex: "A1",
    definition: `The reference flat retail tariff in ct/kWh (default ${DEFAULT_FLAT_RATE_CT} ct/kWh unless otherwise agreed), representing procurement without a dynamic tariff.`,
  },
  {
    key: "dynamicTariff",
    label: "Dynamic tariff",
    annex: "A1",
    definition:
      "Per-slot pricing indexed to the intraday market: each Slot's kWh is priced at that Slot's IDM price, plus any contractually agreed adder.",
  },
  {
    key: "batteryThroughput",
    label: "Battery throughput",
    short: "Throughput",
    unit: "kWh",
    annex: "A1",
    definition:
      "Total energy that flowed through the battery terminals in either direction over the window, measured from the BMS power registers.",
    formula: "Throughput = Σ |P_battery| · Δt",
  },
  {
    key: "evFirstPolicy",
    label: "EV-first policy",
    annex: "A1",
    definition:
      "The Algorithm never curtails EV charging. Vehicles are always served at the maximum the site can physically deliver; the Algorithm only decides when the battery is recharged and when it discharges to serve load.",
  },

  // ── Energy quantities ─────────────────────────────────────────────────────
  {
    key: "gridImport",
    label: "Grid import",
    short: "Import",
    unit: "kWh",
    annex: "A1, A2.2",
    definition:
      "Metered energy drawn from the grid at the connection point, integrated over all Frames in the window at full metering resolution. Includes EV charging, battery charging and auxiliary load.",
    formula: "GridImport = Σ max(P_grid, 0) · Δt",
  },
  {
    key: "evDelivered",
    label: "EV delivered",
    short: "EV",
    unit: "kWh",
    annex: "A1, A7.3",
    definition:
      "Energy delivered to vehicles, read from the metered per-connector energy counters (C1 + C2). Never derived from the power balance, which would absorb the auxiliary load and phantom-inflate EV energy when no car is charging.",
    formula: "EVdelivered = ΔE_C1 + ΔE_C2 (per-connector counters)",
  },
  {
    key: "aux",
    label: "AUX (ChargePost self-consumption)",
    short: "AUX",
    unit: "kWh",
    annex: "A7.2",
    definition:
      "Electricity the ChargePost consumed but did not deliver to a vehicle: standby load (~0.2–0.5 kW, measured when both connectors are idle and the battery rests), thermal management under load, and power-electronics conversion losses across the rectifier, battery DC/DC and charger stages. It is NOT a flat background load — it scales with charging throughput (typically 20–25% of EV delivered). It is a residual of the site power balance, not a separate meter, and it is non-dispatchable: the battery cannot offset it. Included in Grid import on both sides of every comparison and reported separately so it is never mistaken for EV energy.",
    formula: "AUX = GridImport − GridExport − EVdelivered − BatteryNet   (so GridImport = EVdelivered + AUX + BatteryNet on every row)",
  },
  {
    key: "battNet",
    label: "Battery net",
    short: "Batt net",
    unit: "kWh",
    annex: "A7.2",
    definition:
      "Metered battery charge minus discharge over the window. Positive: the pack holds more energy at the end than at the start (that energy was imported but not yet delivered); negative: the pack released stored energy into the site. Closes the energy identity Grid import = EV delivered + AUX + Battery net. Diagnostic: a large |Battery net| against a small change in state of charge points at a battery-meter bias (Norderstedt, Aug 2026: −149 kWh vs ≈ −16 kWh from SOC).",
    formula: "BatteryNet = Σ BatteryCharge − Σ BatteryDischarge",
  },
  {
    key: "siteLoad",
    label: "Site load (EV + AUX)",
    short: "Site load",
    unit: "kWh",
    annex: "A7.2",
    definition:
      "Total energy consumed at the site: EV delivered plus auxiliary load. Equals Grid import net of battery charge/discharge.",
    formula: "SiteLoad = EVdelivered + AUX",
  },
  {
    key: "sessions",
    label: "Sessions",
    annex: "A2.1",
    definition: `Number of charging sessions — one per connector per uninterrupted charge. Measured months: charge events from the per-connector energy counters. Archive months: per-connector charging islands re-derived from the station's CCR export (connector power > ${SESSION_ACTIVE_W} W). Both apply the same filters: idle gaps ≤ ${SESSION_GAP_MIN} min are bridged, a session needs ≥ 2 frames and > ${SESSION_MIN_KWH} kWh. "n/a" = the station's export has not been imported; no estimate is ever shown.`,
  },
  {
    key: "shiftedKwh",
    label: "Shifted energy",
    short: "Shifted",
    unit: "kWh",
    annex: "A6.2",
    definition:
      "Energy the Algorithm bought at a different time than the grid-first counterfactual would have — the volume actually moved by load shifting. Reported for context; its value is priced through Timing value.",
  },
  {
    key: "counterfactualImport",
    label: "Counterfactual import (no load shifting)",
    short: "No-LS import",
    unit: "kWh",
    annex: "A6.2, A6.3",
    definition:
      "Grid import of the grid-first counterfactual simulated over the identical Frames, anchored to measured SOC at both window edges. Must approximately equal the actual Grid import (energy conservation) — only the timing differs.",
  },

  // ── Price & cost ──────────────────────────────────────────────────────────
  {
    key: "priceSourceMix",
    label: "Price-source mix (IDM / DAM)",
    short: "IDM / DAM",
    unit: "% of kWh",
    annex: "A3.1",
    definition:
      "Share of kWh priced on the live IDM intraday price vs. the day-ahead (DAM) fallback, on the same energy basis as the meter total. Residual gaps carry the last resolved price forward.",
  },
  // The THREE procurement costs of one window. Every fleet table prints all
  // three as columns (client request sep 3 2026): the reader must see the
  // assumed cost at the Flat rate, the assumed cost on the Dynamic tariff
  // WITHOUT load shifting, and the cost actually run — not back-solve one
  // from a saving.
  {
    key: "flatCost",
    label: "Procurement — at Flat rate",
    short: "Flat €",
    unit: "€",
    annex: "A3.3",
    definition:
      "Assumed procurement cost of the window's Grid import had it all been bought at the reference Flat rate — the tariff the site would be on without the Dynamic tariff.",
    formula: "Cost_flat = kWh_total × FlatRate",
  },
  {
    key: "counterfactualCost",
    label: "Procurement — without load shifting",
    short: "No-LS €",
    unit: "€",
    annex: "A6.2",
    definition:
      "Assumed procurement cost on the Dynamic tariff had the battery NOT load-shifted. Its VOLUME is an energy balance on the billed grid meter, not a rebuilt absolute: both worlds serve the same site load and start/end at the same SOC, so they differ only by battery cycling — kWh_noLS = measured import − 3 % × max(0, battery-meter gross charge − peak-shave charge). The 3 % (client rule, Sep 2026) is the share of every extra kWh cycled that is lost in conversion (fleet meters read 1.4–4.5 % monthly); by construction the no-LS import is at or below the as-run import. Its PRICE follows the grid-first counterfactual's 15-min shape (same Frames, same per-slot prices, SOC anchored at both window edges), scaled to the rule's kWh. Applied per settled day and summed, so a month equals the sum of its days. Each report prints the extra-charge figure, the window's own meter round trip and the simulated shape next to the result.",
    formula: "kWh_noLS = kWh_import − 0.03 × max(0, C_meter − C_peakShave);  Cost_noLS = Cost_sim × kWh_noLS ÷ kWh_sim + adder × kWh_noLS   (Cost_sim = Σ_slots kWh_cf_slot × price_slot)",
  },
  {
    key: "dynamicCost",
    label: "Procurement — with load shifting (as run)",
    short: "As-run €",
    unit: "€",
    annex: "A3.2",
    definition:
      "Procurement cost actually incurred under the Dynamic tariff with the battery load-shifting as it did — a true per-slot summation of each Slot's metered kWh at that Slot's price, never an average-price shortcut.",
    formula: "Cost_dynamic = Σ_slots (kWh_slot × price_slot) + adder × kWh_total",
  },
  {
    key: "effectiveCt",
    label: "Effective price",
    short: "Eff. ct/kWh",
    unit: "ct/kWh",
    annex: "A3.2",
    definition:
      "Energy-weighted average price of the window (cost ÷ kWh). Reported for context only — an output of the per-slot summation, never an input.",
    formula: "Effective = Cost ÷ kWh_total",
  },
  {
    key: "idmSpread",
    label: "Daily IDM spread",
    short: "Spread",
    unit: "ct/kWh",
    annex: "A6.4",
    definition:
      "Average over the window of each day's (max − min) 15-minute IDM price. A flat profile (low spread) leaves no room to shift into; the contribution may legitimately be near zero or negative on such days.",
    formula: "Spread = mean_days(max(price_slot) − min(price_slot))",
  },
  {
    key: "dayVerdict",
    label: "Day verdict",
    annex: "A3, A6.4",
    definition:
      "Market classification of a day against the fleet's weighted Flat rate: Favorable (average IDM below flat), Headwind (average above flat but some slots below), Guaranteed loss (even the cheapest slot costs more than flat — no dispatch strategy can win).",
  },

  // ── Wear ──────────────────────────────────────────────────────────────────
  {
    key: "wear",
    label: "Battery wear",
    short: "Wear €",
    unit: "€",
    annex: "A4.1",
    definition: `Battery cycling cost priced at the agreed ${WEAR_CT_PER_KWH} ct per kWh of Battery throughput (35 €/MWh per direction of flow) — the same rate the Algorithm optimizes against.`,
    formula: `Wear = Σ |P_battery| · Δt × ${WEAR_CT_PER_KWH} ct/kWh`,
  },
  // The TWO wear bases behind the extra-wear figure — both printed as columns
  // on every fleet table (client request sep 3 2026: "my wear cost in case of
  // no load shifting" is a number the reader needs, not a difference to solve).
  {
    key: "wearNoShift",
    label: "Battery wear — without load shifting",
    short: "Wear no-LS €",
    unit: "€",
    annex: "A4.2",
    definition: `Assumed battery cycling cost had the battery NOT load-shifted: the grid-first counterfactual's throughput — only the unavoidable peak-shaving cycling the ${GRID_CAP_KW} kW grid cap forces — priced at ${WEAR_CT_PER_KWH} ct/kWh. Unknown ("—") for archive months, which carry no measured battery series.`,
    formula: `Wear_noLS = Σ |P_battery,cf| · Δt × ${WEAR_CT_PER_KWH} ct/kWh`,
  },
  {
    key: "wearAsRun",
    label: "Battery wear — with load shifting (as run)",
    short: "Wear as-run €",
    unit: "€",
    annex: "A4.1",
    definition: `Battery cycling cost actually incurred: the full MEASURED battery throughput of the window (BMS power registers from the station's own Frames) priced at ${WEAR_CT_PER_KWH} ct/kWh. This is everything the battery physically did — cycling commanded by the Amperio dispatcher AND cycling the unit's local controller ran on its own. It is a measurement, never a simulation.`,
    formula: `Wear_asRun = Σ |P_battery| �� Δt × ${WEAR_CT_PER_KWH} ct/kWh`,
  },
  {
    key: "extraWear",
    label: "Extra wear from load shifting",
    short: "Extra wear €",
    unit: "€",
    annex: "A4.2, A5.1",
    definition:
      "Wear with load shifting (as run) minus wear without load shifting (unavoidable peak-shaving cycling only) — the wear of ALL battery activity beyond forced peak-shaving, whether commanded by the Amperio dispatcher or by the unit's local controller. In windows before dispatch control was active, this delta is entirely the local controller's own shifting. This, not the as-run wear, is what Net total saving charges against the Procurement saving.",
    formula: "ExtraWear = Wear_asRun − Wear_noLS",
  },

  // ── Results ───────────────────────────────���───────────────────────────────
  {
    key: "procurementSaving",
    label: "Procurement saving",
    short: "Saving €",
    unit: "€",
    annex: "A5.1",
    definition:
      "Energy-cost saving of the Dynamic tariff versus the Flat rate over the window, before battery wear.",
    formula: "EnergySaving = Cost_flat − Cost_dynamic",
  },
  {
    key: "netTotalSaving",
    label: "Net total saving",
    short: "Net €",
    unit: "€",
    annex: "A5.1, A5.2",
    definition:
      "The headline settlement figure: Procurement saving minus the extra battery wear that load shifting incurs. Contains both the market-level effect of the tariff switch and the Algorithm's timing value.",
    formula: "NetTotalSaving = EnergySaving − ExtraWear",
  },
  {
    key: "timingValue",
    label: "Timing value",
    unit: "€",
    annex: "A6.2",
    definition:
      "Cost of the grid-first counterfactual minus the actual Dynamic-tariff cost, both priced at the same per-slot prices — the value created purely by deciding WHEN energy is bought.",
    formula: "TimingValue = Cost_counterfactual − Cost_dynamic",
  },
  {
    key: "loadShiftingContribution",
    label: "Load-shifting contribution",
    short: "LS gain €",
    unit: "€",
    annex: "A6.2, A6.4",
    definition:
      "The load-shifting contribution within Net total saving: Timing value net of the extra wear the shifting caused. It scores the site's ACTUAL battery behaviour (dispatcher-commanded AND local-controller cycling alike) against the peak-shave-only baseline — in periods before Amperio dispatch was active, this figure, including a negative one, belongs to the unit's local controller, not the Algorithm. May be near zero or negative on flat-price days; such results are reported as computed.",
    formula: "LoadShiftingContribution = TimingValue − ExtraWear",
  },

  // ── Constraints ───────────────────────────────────────────────────────────
  {
    key: "gridCap",
    label: "Grid-import ceiling",
    short: "Grid cap",
    unit: "kW",
    annex: "A7.1",
    definition: `Uniform ${GRID_CAP_KW} kW grid-import ceiling applied on both sides of every comparison (planning and counterfactual), so no scenario is credited with energy beyond the modelled limit. A breach is a Frame whose metered grid power exceeds the ceiling.`,
  },

  // ── Provenance & audit ────────────────────────────────────────────────────
  {
    key: "measuredMonth",
    label: "Measured station-month",
    short: "Measured",
    annex: "A2.1",
    definition:
      "A station-month whose volumes come from the station's own high-resolution telemetry (Frames) in the archive. Sessions are counted from session records.",
  },
  {
    key: "archiveMonth",
    label: "Archive station-month",
    short: "Archive",
    annex: "A2.1",
    definition:
      "A station-month whose volumes come from the operator's historical energy archive (daily/hourly totals) rather than Frames. Priced block-for-block on the same IDM history; sessions are re-derived from the station's CCR export per connector (n/a until imported). Synthetic, seasonal and zero-volume months are excluded — they never produce rows.",
  },
  {
    key: "dataFrom",
    label: "Data from",
    short: "From",
    annex: "A8.1",
    definition:
      "First calendar day (Europe/Berlin) with a Frame inside the report window. For a station onboarded mid-month this is the onboarding day, not the 1st — every euro in the row covers only the period from here to Data-through. (Gifhorn, August 2026: data from 20 Aug — 12 of 31 days.)",
  },
  {
    key: "dataThrough",
    label: "Data-through",
    annex: "A8.1, A8.2",
    definition:
      "Timestamp of the last Frame included in the report. A window that includes the current day continues to fill until the day completes; final settlement uses completed days only.",
  },
  {
    key: "coveredDays",
    label: "Days with data",
    short: "Days",
    annex: "A8.1",
    definition:
      "Number of calendar days (Europe/Berlin) inside the window that carry at least one Frame. Fewer than the calendar length means onboarding mid-window or a telemetry outage; the euros are settled on these days only and are NOT scaled up to a full month. (Norderstedt, August 2026: 25 of 31 — no frames 24–31 Aug.)",
  },
  {
    key: "methodologyVersion",
    label: "Methodology version",
    annex: "A8.3",
    definition:
      "Version stamp of the calculation methodology. Reports computed under different versions are not directly comparable and are flagged as such.",
  },
]

export const REPORT_TERMS: Readonly<Record<ReportTermKey, ReportTerm>> = Object.fromEntries(
  TERMS.map((t) => [t.key, t]),
) as Record<ReportTermKey, ReportTerm>

/** Ordered list — the order rows appear on the Annex page and in xlsx sheets. */
export const REPORT_TERM_LIST: readonly ReportTerm[] = TERMS

/** Annex Clause 1 base definitions (rendered by the printable Annex). */
export const ANNEX_BASE_TERM_KEYS: readonly ReportTermKey[] = [
  "site",
  "frame",
  "settlementWindow",
  "gridImport",
  "slot",
  "flatRate",
  "dynamicTariff",
  "batteryThroughput",
  "evFirstPolicy",
]

/** Reporting terms — the labels software prints, formally listed in the Annex. */
export const ANNEX_REPORT_TERM_KEYS: readonly ReportTermKey[] = TERMS.map((t) => t.key).filter(
  (k) => !ANNEX_BASE_TERM_KEYS.includes(k),
)

export function term(key: ReportTermKey): ReportTerm {
  return REPORT_TERMS[key]
}

/** `label (unit)` — for xlsx column headers where a tooltip isn't available. */
export function termHeader(key: ReportTermKey, opts?: { short?: boolean; unit?: string | false }): string {
  const t = REPORT_TERMS[key]
  const base = opts?.short && t.short ? t.short : t.label
  const unit = opts?.unit === false ? undefined : (opts?.unit ?? t.unit)
  // Short labels like "Flat €" already carry their unit.
  if (!unit || (opts?.short && t.short)) return base
  return `${base} (${unit})`
}

/**
 * Rows for the "Definitions" sheet every workbook carries:
 * [Term, Unit, Annex clause, Definition, Formula].
 */
export const DEFINITIONS_SHEET_HEADER = ["Term", "Unit", "Annex clause", "Definition", "Formula"] as const

export function definitionsSheetRows(keys?: readonly ReportTermKey[]): (string | number)[][] {
  const list = keys ? keys.map((k) => REPORT_TERMS[k]) : TERMS
  return list.map((t) => [t.label, t.unit ?? "", t.annex, t.definition, t.formula ?? ""])
}

/** Column widths matching DEFINITIONS_SHEET_HEADER (Excel character units). */
export const DEFINITIONS_SHEET_WIDTHS = [34, 10, 12, 90, 56] as const

/**
 * Append the standard "Definitions" sheet to an exceljs workbook (server-side
 * xlsx routes). `import type` keeps exceljs out of client bundles — this module
 * is also imported by client components; the SheetJS (client) builders use
 * definitionsSheetRows() instead.
 */
export function appendDefinitionsSheet(wb: ExcelJS.Workbook, keys?: readonly ReportTermKey[]) {
  const s = wb.addWorksheet("Definitions")
  s.columns = DEFINITIONS_SHEET_HEADER.map((h, i) => ({
    header: h,
    key: h.toLowerCase().replace(/\s+/g, "_"),
    width: DEFINITIONS_SHEET_WIDTHS[i],
  }))
  for (const row of definitionsSheetRows(keys)) s.addRow(row)
  s.getRow(1).font = { bold: true }
  // Long definitions wrap instead of spilling across the sheet.
  s.getColumn(4).alignment = { wrapText: true, vertical: "top" }
  s.getColumn(5).alignment = { wrapText: true, vertical: "top" }
  return s
}
