"use server"

/**
 * Portfolio history — read-only server actions over the aggregates loaded from
 * the 56-station telemetry archive (portfolio_station / portfolio_daily /
 * portfolio_hourly_profile). All heavy lifting happened offline in
 * scripts/portfolio/aggregate_portfolio.py; these queries only slice
 * pre-aggregated rows, so they stay fast regardless of the raw archive size.
 */

import { sql as sq } from "drizzle-orm"
import { db } from "@/lib/db"
import { archiveSessionsForMonth } from "@/lib/archive-sessions"
import { CCR_SESSION_METHOD } from "@/lib/ccr-sessions"
import { LS_LOSS_SHARE } from "@/lib/tariff-compute"

// Small adapter so the queries below read like tagged-template SQL while
// using the project's shared Drizzle/pg pool (no extra driver dependency).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]> {
  const result = await db.execute(sq(strings, ...values))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (result as unknown as { rows: any[] }).rows
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface PortfolioStation {
  stationId: string
  assetId: string
  brand: string
  city: string
  zip: string
  address: string
  firstTs: string
  lastTs: string
  daysOfData: number
  spanDays: number
  totalImportKwh: number
  totalEvKwh: number
  totalChargeKwh: number
  totalDischargeKwh: number
  totalCostEur: number
  totalPriceSavingsEur: number
  totalSessions: number
  avgDailyEvKwh: number
  utilizationPct: number
}

export interface PortfolioDailyRow {
  stationId: string
  day: string
  importKwh: number
  evKwh: number
  battChargeKwh: number
  battDischargeKwh: number
  socMin: number | null
  socAvg: number | null
  avgPrice: number | null
  importWavgPrice: number | null
  costEur: number | null
  priceSavingsEur: number | null
  sessions: number
  peakEvKw: number | null
  peakImportKw: number | null
  coveragePct: number
}

export interface HourlyProfileRow {
  stationId: string
  hour: number
  importKw: number
  evKw: number
  chargeKw: number
  dischargeKw: number
  avgPrice: number | null
}

export interface PortfolioSummary {
  stations: number
  totalEvKwh: number
  totalImportKwh: number
  totalCostEur: number
  totalSavingsEur: number
  totalSessions: number
  firstDay: string
  lastDay: string
}

export interface PortfolioDailyAggRow {
  day: string
  evKwh: number
  importKwh: number
  costEur: number
  savingsEur: number
  sessions: number
  stationsReporting: number
  avgPrice: number | null
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getPortfolioStations(): Promise<PortfolioStation[]> {
  const rows = await sql`
    SELECT station_id, asset_id, brand, city, zip, address,
           first_ts, last_ts, days_of_data, span_days,
           total_import_kwh, total_ev_kwh, total_charge_kwh, total_discharge_kwh,
           total_cost_eur, total_price_savings_eur, total_sessions,
           avg_daily_ev_kwh, utilization_pct
    FROM portfolio_station
    ORDER BY total_ev_kwh DESC
  `
  return rows.map((r) => ({
    stationId: r.station_id as string,
    assetId: r.asset_id as string,
    brand: r.brand as string,
    city: r.city as string,
    zip: r.zip as string,
    address: r.address as string,
    firstTs: new Date(r.first_ts as string).toISOString(),
    lastTs: new Date(r.last_ts as string).toISOString(),
    daysOfData: Number(r.days_of_data),
    spanDays: Number(r.span_days),
    totalImportKwh: Number(r.total_import_kwh),
    totalEvKwh: Number(r.total_ev_kwh),
    totalChargeKwh: Number(r.total_charge_kwh),
    totalDischargeKwh: Number(r.total_discharge_kwh),
    totalCostEur: Number(r.total_cost_eur),
    totalPriceSavingsEur: Number(r.total_price_savings_eur),
    totalSessions: Number(r.total_sessions),
    avgDailyEvKwh: Number(r.avg_daily_ev_kwh),
    utilizationPct: Number(r.utilization_pct),
  }))
}

export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  const [row] = await sql`
    SELECT count(*)::int AS stations,
           coalesce(sum(total_ev_kwh), 0) AS ev,
           coalesce(sum(total_import_kwh), 0) AS imp,
           coalesce(sum(total_cost_eur), 0) AS cost,
           coalesce(sum(total_price_savings_eur), 0) AS savings,
           coalesce(sum(total_sessions), 0)::int AS sessions,
           min(first_ts) AS first_ts,
           max(last_ts) AS last_ts
    FROM portfolio_station
  `
  return {
    stations: Number(row.stations),
    totalEvKwh: Number(row.ev),
    totalImportKwh: Number(row.imp),
    totalCostEur: Number(row.cost),
    totalSavingsEur: Number(row.savings),
    totalSessions: Number(row.sessions),
    firstDay: new Date(row.first_ts as string).toISOString().slice(0, 10),
    lastDay: new Date(row.last_ts as string).toISOString().slice(0, 10),
  }
}

/** Portfolio-wide daily aggregate (all stations summed per day). */
export async function getPortfolioDailyAgg(): Promise<PortfolioDailyAggRow[]> {
  const rows = await sql`
    SELECT day,
           sum(ev_kwh) AS ev,
           sum(import_kwh) AS imp,
           sum(cost_eur) AS cost,
           sum(price_savings_eur) AS savings,
           sum(sessions)::int AS sessions,
           count(*)::int AS reporting,
           avg(avg_price) AS avg_price
    FROM portfolio_daily
    GROUP BY day
    ORDER BY day
  `
  return rows.map((r) => ({
    day: (r.day as Date | string) instanceof Date ? (r.day as Date).toISOString().slice(0, 10) : String(r.day),
    evKwh: Number(r.ev ?? 0),
    importKwh: Number(r.imp ?? 0),
    costEur: Number(r.cost ?? 0),
    savingsEur: Number(r.savings ?? 0),
    sessions: Number(r.sessions ?? 0),
    stationsReporting: Number(r.reporting ?? 0),
    avgPrice: r.avg_price == null ? null : Number(r.avg_price),
  }))
}

export async function getStationDaily(stationId: string): Promise<PortfolioDailyRow[]> {
  const rows = await sql`
    SELECT station_id, day, import_kwh, ev_kwh, batt_charge_kwh, batt_discharge_kwh,
           soc_min, soc_avg, avg_price, import_wavg_price, cost_eur, price_savings_eur,
           sessions, peak_ev_kw, peak_import_kw, coverage_pct
    FROM portfolio_daily
    WHERE station_id = ${stationId}
    ORDER BY day
  `
  return rows.map((r) => ({
    stationId: r.station_id as string,
    day: (r.day as Date | string) instanceof Date ? (r.day as Date).toISOString().slice(0, 10) : String(r.day),
    importKwh: Number(r.import_kwh ?? 0),
    evKwh: Number(r.ev_kwh ?? 0),
    battChargeKwh: Number(r.batt_charge_kwh ?? 0),
    battDischargeKwh: Number(r.batt_discharge_kwh ?? 0),
    socMin: r.soc_min == null ? null : Number(r.soc_min),
    socAvg: r.soc_avg == null ? null : Number(r.soc_avg),
    avgPrice: r.avg_price == null ? null : Number(r.avg_price),
    importWavgPrice: r.import_wavg_price == null ? null : Number(r.import_wavg_price),
    costEur: r.cost_eur == null ? null : Number(r.cost_eur),
    priceSavingsEur: r.price_savings_eur == null ? null : Number(r.price_savings_eur),
    sessions: Number(r.sessions ?? 0),
    peakEvKw: r.peak_ev_kw == null ? null : Number(r.peak_ev_kw),
    peakImportKw: r.peak_import_kw == null ? null : Number(r.peak_import_kw),
    coveragePct: Number(r.coverage_pct ?? 0),
  }))
}

export async function getStationProfile(stationId: string): Promise<HourlyProfileRow[]> {
  const rows = await sql`
    SELECT station_id, hour, import_kw, ev_kw, charge_kw, discharge_kw, avg_price
    FROM portfolio_hourly_profile
    WHERE station_id = ${stationId}
    ORDER BY hour
  `
  return rows.map((r) => ({
    stationId: r.station_id as string,
    hour: Number(r.hour),
    importKw: Number(r.import_kw ?? 0),
    evKw: Number(r.ev_kw ?? 0),
    chargeKw: Number(r.charge_kw ?? 0),
    dischargeKw: Number(r.discharge_kw ?? 0),
    avgPrice: r.avg_price == null ? null : Number(r.avg_price),
  }))
}

export async function getPortfolioStation(stationId: string): Promise<PortfolioStation | null> {
  const all = await getPortfolioStations()
  return all.find((s) => s.stationId === stationId) ?? null
}

// ── Fleet projection (live billing range × archive run-rates) ────────────────

export type StationSeasonalRate = {
  stationId: string
  city: string
  zip: string
  brand: string
  /** Avg DAILY grid import (kWh/day) in the SAME calendar month across archive years. */
  importKwhDay: number
  /** Avg DAILY EV energy (kWh/day) in the same calendar month. */
  evKwhDay: number
  /** Avg DAILY car sessions in the same calendar month. */
  sessionsDay: number
  /** Days of archive data behind the average (data quality signal). */
  sampleDays: number
  /** Which archive years contributed (e.g. ["2023","2024","2025"]). */
  years: string[]
  /**
   * True when the station has NO archive data for this calendar month, so the
   * run-rate fell back to its all-months daily average. Keeps the full fleet
   * in the projection instead of silently dropping late-onboarded sites.
   */
  monthFallback: boolean
  /**
   * Hour-of-day EV energy distribution in 3 price tiers (0–100 each, sums ≈100):
   *  - cheapSharePct: hours below the station's median hourly price — the
   *    dispatcher wants charging here anyway.
   *  - worthSharePct: expensive hours whose premium over the station's cheap-
   *    hour average EXCEEDS the battery wear cost — shifting these earns money.
   *  - notWorthSharePct: expensive hours whose premium is BELOW the wear cost —
   *    shifting them would cost more in battery wear than it saves.
   */
  cheapSharePct: number | null
  worthSharePct: number | null
  notWorthSharePct: number | null
}

/**
 * Per-station seasonal DAILY run-rates for one calendar month (1–12), averaged
 * across every archive year with data for that month; stations with no history
 * for that month fall back to their all-months average (flagged) so the WHOLE
 * fleet is always projected. The 3-tier hour split classifies each site's EV
 * energy by shifting economics against `wearEurMwh` (battery wear per MWh).
 */
export async function getStationSeasonalRates(month: number, wearEurMwh = 35): Promise<StationSeasonalRate[]> {
  const m = Math.max(1, Math.min(12, Math.round(month)))
  const wear = Math.max(0, Math.min(200, wearEurMwh))
  const rows = await sql`
    WITH seasonal AS (
      SELECT d.station_id,
             sum(d.import_kwh) / count(*) AS import_kwh_day,
             sum(d.ev_kwh) / count(*) AS ev_kwh_day,
             sum(d.sessions)::float / count(*) AS sessions_day,
             count(*) AS sample_days,
             array_agg(DISTINCT to_char(d.day, 'YYYY')) AS years
      FROM portfolio_daily d
      WHERE extract(month FROM d.day) = ${m}
        AND d.coverage_pct > 50
      GROUP BY d.station_id
      HAVING sum(d.ev_kwh) > 0
    ),
    -- Fallback: all-months average, for stations with no data in this month.
    alltime AS (
      SELECT d.station_id,
             sum(d.import_kwh) / count(*) AS import_kwh_day,
             sum(d.ev_kwh) / count(*) AS ev_kwh_day,
             sum(d.sessions)::float / count(*) AS sessions_day,
             count(*) AS sample_days,
             array_agg(DISTINCT to_char(d.day, 'YYYY')) AS years
      FROM portfolio_daily d
      WHERE d.coverage_pct > 50
      GROUP BY d.station_id
      HAVING sum(d.ev_kwh) > 0
    ),
    -- 3-tier hour split: cheap = below the station's median hourly price;
    -- expensive hours divide by whether their premium over the cheap-hour
    -- average beats the battery wear cost (shifting worth it or not).
    med AS (
      SELECT station_id,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_price) AS med_price
      FROM portfolio_hourly_profile
      GROUP BY station_id
    ),
    cheapavg AS (
      SELECT h.station_id, avg(h.avg_price) AS cheap_price
      FROM portfolio_hourly_profile h
      JOIN med mm ON mm.station_id = h.station_id
      WHERE h.avg_price < mm.med_price
      GROUP BY h.station_id
    ),
    tiers AS (
      -- COALESCE each numerator: a tier with no matching hours is 0% of the
      -- mix, not "unknown" (sum FILTER over zero rows yields NULL).
      SELECT h.station_id,
             coalesce(sum(h.ev_kw) FILTER (WHERE h.avg_price < mm.med_price), 0)
               / nullif(sum(h.ev_kw), 0) * 100 AS cheap_share,
             coalesce(sum(h.ev_kw) FILTER (WHERE h.avg_price >= mm.med_price AND h.avg_price - ca.cheap_price > ${wear}), 0)
               / nullif(sum(h.ev_kw), 0) * 100 AS worth_share,
             coalesce(sum(h.ev_kw) FILTER (WHERE h.avg_price >= mm.med_price AND h.avg_price - ca.cheap_price <= ${wear}), 0)
               / nullif(sum(h.ev_kw), 0) * 100 AS not_worth_share
      FROM portfolio_hourly_profile h
      JOIN med mm ON mm.station_id = h.station_id
      JOIN cheapavg ca ON ca.station_id = h.station_id
      GROUP BY h.station_id
    )
    SELECT s.station_id, s.city, s.zip, s.brand,
           COALESCE(se.import_kwh_day, fb.import_kwh_day) AS import_kwh_day,
           COALESCE(se.ev_kwh_day, fb.ev_kwh_day) AS ev_kwh_day,
           COALESCE(se.sessions_day, fb.sessions_day) AS sessions_day,
           COALESCE(se.sample_days, fb.sample_days) AS sample_days,
           COALESCE(se.years, fb.years) AS years,
           (se.station_id IS NULL) AS month_fallback,
           t.cheap_share, t.worth_share, t.not_worth_share
    FROM portfolio_station s
    LEFT JOIN seasonal se ON se.station_id = s.station_id
    LEFT JOIN alltime fb ON fb.station_id = s.station_id
    LEFT JOIN tiers t ON t.station_id = s.station_id
    WHERE COALESCE(se.ev_kwh_day, fb.ev_kwh_day) IS NOT NULL
    ORDER BY COALESCE(se.ev_kwh_day, fb.ev_kwh_day) DESC
  `
  return rows.map((r) => ({
    stationId: r.station_id as string,
    city: r.city as string,
    zip: r.zip as string,
    brand: r.brand as string,
    importKwhDay: Number(r.import_kwh_day ?? 0),
    evKwhDay: Number(r.ev_kwh_day ?? 0),
    sessionsDay: Number(r.sessions_day ?? 0),
    sampleDays: Number(r.sample_days ?? 0),
    years: (r.years ?? []) as string[],
    monthFallback: Boolean(r.month_fallback),
    cheapSharePct: r.cheap_share == null ? null : Number(r.cheap_share),
    worthSharePct: r.worth_share == null ? null : Number(r.worth_share),
    notWorthSharePct: r.not_worth_share == null ? null : Number(r.not_worth_share),
  }))
}

// ── Gronau baseline (real history, not assumptions) ──────────────────────────

export type GronauBaseline = {
  /** Months with meaningful import in Gronau's archive. */
  months: number
  /** Gronau's per-month shifting rate, €/MWh imported, one entry per month. */
  monthlyRates: { month: string; rateEurMwh: number; savingsEur: number; importKwh: number }[]
  /** Best single-month rate Gronau ever achieved (€/MWh). */
  bestRateEurMwh: number
  /** Median monthly rate — what Gronau sustains in a typical month (€/MWh). */
  medianRateEurMwh: number
  /**
   * Gronau's REAL achievement: median monthly rate ÷ best monthly rate.
   * "In a typical month, Gronau sustains X% of its own demonstrated peak."
   * Used as the data-grounded default for the fleet achievement assumption.
   */
  achievementPct: number
  /**
   * Load-shifting participation from real history: total shifting value as a
   * share of what procurement would have cost without shifting
   * (savings ÷ (actual cost + savings)).
   */
  participationPct: number
}

/** Gronau's real historical shifting performance, month by month. */
export async function getGronauBaseline(stationId: string): Promise<GronauBaseline | null> {
  const rows = await sql`
    SELECT to_char(day, 'YYYY-MM') AS month,
           sum(import_kwh) AS import_kwh,
           sum(cost_eur) AS cost_eur,
           sum(price_savings_eur) AS savings_eur
    FROM portfolio_daily
    WHERE station_id = ${stationId}
    GROUP BY 1
    HAVING sum(import_kwh) > 500 -- skip partial commissioning months
    ORDER BY 1
  `
  if (!rows.length) return null
  const monthlyRates = rows.map((r) => {
    const importKwh = Number(r.import_kwh ?? 0)
    const savingsEur = Number(r.savings_eur ?? 0)
    return {
      month: r.month as string,
      importKwh,
      savingsEur,
      rateEurMwh: importKwh > 0 ? (savingsEur / importKwh) * 1000 : 0,
    }
  })
  const rates = monthlyRates.map((m) => m.rateEurMwh).sort((a, b) => a - b)
  const median = rates[Math.floor(rates.length / 2)]
  const best = rates[rates.length - 1]
  const totalCost = rows.reduce((a, r) => a + Number(r.cost_eur ?? 0), 0)
  const totalSavings = rows.reduce((a, r) => a + Number(r.savings_eur ?? 0), 0)
  return {
    months: monthlyRates.length,
    monthlyRates,
    bestRateEurMwh: best,
    medianRateEurMwh: median,
    achievementPct: best > 0 ? (median / best) * 100 : 100,
    participationPct: totalCost + totalSavings > 0 ? (totalSavings / (totalCost + totalSavings)) * 100 : 0,
  }
}

// ── Tariff & forward-outlook report ──────────────────────���───────────────────

export type FleetMonthly = {
  month: string // YYYY-MM
  importKwh: number
  evKwh: number
  costEur: number // actual cost at hourly DAM prices
  savingsEur: number // realized load-shifting value
  avgPrice: number | null // volume-agnostic mean of daily avg prices, €/MWh
  sessions: number
  stationsReporting: number
}

/** Fleet-wide monthly rollup for the flat-vs-DAM tariff comparison. */
export async function getFleetMonthly(): Promise<FleetMonthly[]> {
  const rows = await sql`
    SELECT to_char(day, 'YYYY-MM') AS month,
           sum(import_kwh) AS import_kwh,
           sum(ev_kwh) AS ev_kwh,
           sum(cost_eur) AS cost_eur,
           sum(price_savings_eur) AS savings_eur,
           avg(avg_price) AS avg_price,
           sum(sessions) AS sessions,
           count(DISTINCT station_id) AS stations
    FROM portfolio_daily
    GROUP BY 1
    ORDER BY 1
  `
  return rows.map((r) => ({
    month: r.month as string,
    importKwh: Number(r.import_kwh ?? 0),
    evKwh: Number(r.ev_kwh ?? 0),
    costEur: Number(r.cost_eur ?? 0),
    savingsEur: Number(r.savings_eur ?? 0),
    avgPrice: r.avg_price == null ? null : Number(r.avg_price),
    sessions: Number(r.sessions ?? 0),
    stationsReporting: Number(r.stations ?? 0),
  }))
}

export type StationOutlook = {
  stationId: string
  city: string
  zip: string
  brand: string
  monthsActive: number // distinct months with import in the recent window
  importKwhMo: number // avg monthly import over the recent window
  evKwhMo: number
  savingsEurMo: number // avg monthly realized shifting value
  shiftRateEurMwh: number // realized €/MWh imported (recent window)
  paidEurMwh: number | null // wavg paid price (recent window)
}

/**
 * Per-station run-rates over the trailing 12 months of each station's own
 * data (so recently-commissioned sites aren't diluted by empty months).
 * The client compares each station's shiftRate against the Gronau baseline
 * to derive participation % and the achievable upside.
 */
export async function getStationOutlooks(): Promise<StationOutlook[]> {
  const rows = await sql`
    WITH recent AS (
      SELECT d.*
      FROM portfolio_daily d
      JOIN (
        SELECT station_id, max(day) AS last_day FROM portfolio_daily WHERE import_kwh > 0 GROUP BY 1
      ) l ON l.station_id = d.station_id
      WHERE d.day > l.last_day - INTERVAL '365 days'
    )
    SELECT r.station_id, s.city, s.zip, s.brand,
           count(DISTINCT to_char(r.day, 'YYYY-MM')) AS months_active,
           sum(r.import_kwh) AS import_kwh,
           sum(r.ev_kwh) AS ev_kwh,
           sum(r.price_savings_eur) AS savings_eur,
           sum(r.cost_eur) AS cost_eur
    FROM recent r
    JOIN portfolio_station s ON s.station_id = r.station_id
    GROUP BY r.station_id, s.city, s.zip, s.brand
    ORDER BY sum(r.import_kwh) DESC
  `
  return rows.map((r) => {
    const months = Math.max(1, Number(r.months_active ?? 1))
    const importKwh = Number(r.import_kwh ?? 0)
    const savings = Number(r.savings_eur ?? 0)
    const cost = Number(r.cost_eur ?? 0)
    return {
      stationId: r.station_id as string,
      city: r.city as string,
      zip: r.zip as string,
      brand: r.brand as string,
      monthsActive: months,
      importKwhMo: importKwh / months,
      evKwhMo: Number(r.ev_kwh ?? 0) / months,
      savingsEurMo: savings / months,
      shiftRateEurMwh: importKwh > 0 ? (savings / importKwh) * 1000 : 0,
      paidEurMwh: importKwh > 0 ? (cost / importKwh) * 1000 : null,
    }
  })
}

/** Portfolio-wide average hourly profile (all stations averaged per hour). */
export async function getPortfolioProfile(): Promise<HourlyProfileRow[]> {
  const rows = await sql`
    SELECT hour,
           sum(import_kw) AS import_kw,
           sum(ev_kw) AS ev_kw,
           sum(charge_kw) AS charge_kw,
           sum(discharge_kw) AS discharge_kw,
           avg(avg_price) AS avg_price
    FROM portfolio_hourly_profile
    GROUP BY hour
    ORDER BY hour
  `
  return rows.map((r) => ({
    stationId: "portfolio",
    hour: Number(r.hour),
    importKw: Number(r.import_kw ?? 0),
    evKw: Number(r.ev_kw ?? 0),
    chargeKw: Number(r.charge_kw ?? 0),
    dischargeKw: Number(r.discharge_kw ?? 0),
    avgPrice: r.avg_price == null ? null : Number(r.avg_price),
  }))
}

// ── Fleet month simulation (FinReport-style, per location) ──────────────────

export type StationMonthSim = {
  stationId: string
  city: string
  zip: string
  brand: string
  /** "month" = the selected month's own archive days; "seasonal" = same calendar
   * month from another archive year; "recent" = station's last data days. */
  volumeSource: "month" | "seasonal" | "recent"
  daysWithData: number
  /** Real grid import for the month (kWh) — the no-dispatcher baseline. */
  importKwh: number
  evKwh: number
  /** Charging sessions re-derived from the station's CCR export as
   *  per-connector power islands (lib/archive-sessions → portfolio_session).
   *  NULL = no basis (export not imported for this month, or the row is a
   *  projected `seasonal`/`recent` proxy) → reports show "n/a". The one-time
   *  import's 5 kW rising-edge estimate (portfolio_daily.sessions) is NOT
   *  used here — client decision 2 sep 2026. */
  sessions: number | null
  /** How `sessions` was obtained; null ⇔ sessions is null. */
  sessionsBasis: typeof CCR_SESSION_METHOD | null
  /** Flat-contract cost: importKwh × flat rate. */
  flatEur: number
  /** Procurement WITHOUT load shifting: real import spread over the site's own
   * hourly shape, priced hour-by-hour with the month's REAL IDM curve. */
  noShiftEur: number
  /** UNCALIBRATED timing value the greedy dispatcher captured (€) — the client
   * multiplies by Gronau's measured capture rate before display. */
  timingRawEur: number
  /** UNCALIBRATED energy moved out of expensive hours (kWh). */
  shiftedKwhRaw: number
}

export type FleetMonthSim = {
  month: string
  daysInMonth: number
  /** Hour-of-day IDM price curve actually used (€/MWh, monthly avg, 24 rows). */
  priceCurve: number[]
  pricedDays: number
  stations: StationMonthSim[]
}

/**
 * Simulates one calendar month for every archive location, exactly along the
 * Financial Report's blocks:
 *   1. Baseline (no dispatcher) = the site's REAL archive import, day by day,
 *      spread across hours with the site's own measured hourly load shape and
 *      priced with that month's REAL hourly IDM history (idm_price cache).
 *   2. Flat cost = same real kWh × the flat contract rate.
 *   3. Load shifting = a greedy dispatcher on that hourly ladder: each day it
 *      moves energy from the most expensive hours into that day's cheapest
 *      hours, only where the spread beats the battery wear cost, bounded by
 *      `maxShiftShare` of the day's import (battery/inverter physics).
 *      The result is UNCALIBRATED: the client scales it by Gronau's measured
 *      capture rate (real FinReport timing value ÷ this simulator's value on
 *      Gronau itself) so every site claims only what the proven system
 *      demonstrably captures.
 * Sites without archive data in the selected month fall back to the same
 * calendar month of another year, then to their most recent days (flagged).
 */
export async function simulateFleetMonth(input: {
  month: string // "YYYY-MM"
  flatEurMwh?: number
  wearEurMwh?: number
  maxShiftShare?: number
}): Promise<FleetMonthSim | { error: string }> {
  const m = /^\d{4}-\d{2}$/.test(input.month) ? input.month : null
  if (!m) return { error: "month must be YYYY-MM" }
  const flat = input.flatEurMwh ?? 125
  const wear = Math.max(0, input.wearEurMwh ?? 35)
  const maxShare = Math.max(0.05, Math.min(0.6, input.maxShiftShare ?? 0.3))
  const monthStart = `${m}-01`
  const [yy, mm] = m.split("-").map(Number)
  const daysInMonth = new Date(yy, mm, 0).getDate()

  // 1. REAL hourly IDM curve for the month, per (day, hour) in local time.
  const priceRows = await sql`
    SELECT to_char(ts AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS d,
           extract(hour FROM ts AT TIME ZONE 'Europe/Berlin')::int AS h,
           avg(price_eur_mwh) AS p
    FROM idm_price
    WHERE zone = 'DE-LU'
      AND (ts AT TIME ZONE 'Europe/Berlin')::date >= ${monthStart}::date
      AND (ts AT TIME ZONE 'Europe/Berlin')::date < (${monthStart}::date + interval '1 month')
    GROUP BY 1, 2
  `
  if (priceRows.length === 0) return { error: `no IDM price history cached for ${m}` }
  const priceByDayHour = new Map<string, number>()
  const hourSum = new Array(24).fill(0)
  const hourN = new Array(24).fill(0)
  const pricedDaySet = new Set<string>()
  for (const r of priceRows) {
    const h = Number(r.h)
    const p = Number(r.p)
    priceByDayHour.set(`${r.d}|${h}`, p)
    hourSum[h] += p
    hourN[h] += 1
    pricedDaySet.add(r.d as string)
  }
  const priceCurve = hourSum.map((s, h) => (hourN[h] > 0 ? s / hourN[h] : 0))
  const pricedDays = pricedDaySet.size

  // 2. Per-site hourly load shape (normalized import shares) + the month's
  //    re-derived session counts (independent queries → in parallel).
  const [shapeRows, archiveSessions] = await Promise.all([
    sql`SELECT station_id, hour, import_kw FROM portfolio_hourly_profile ORDER BY station_id, hour`,
    archiveSessionsForMonth(m),
  ])
  const shapeByStation = new Map<string, number[]>()
  for (const r of shapeRows) {
    const arr = shapeByStation.get(r.station_id as string) ?? new Array(24).fill(0)
    arr[Number(r.hour)] = Math.max(0, Number(r.import_kw ?? 0))
    shapeByStation.set(r.station_id as string, arr)
  }

  // 3. Daily volumes: the month itself, else same calendar month another year,
  //    else the station's most recent days.
  const dailyRows = await sql`
    WITH month_rows AS (
      SELECT station_id, day, import_kwh, ev_kwh, sessions, 'month' AS src,
             extract(day FROM day)::int AS dom
      FROM portfolio_daily
      WHERE day >= ${monthStart}::date AND day < (${monthStart}::date + interval '1 month')
        AND coverage_pct > 50
    ),
    has_month AS (SELECT DISTINCT station_id FROM month_rows),
    seasonal_year AS (
      SELECT station_id, max(extract(year FROM day)::int) AS y
      FROM portfolio_daily
      WHERE extract(month FROM day) = ${mm} AND coverage_pct > 50
        AND station_id NOT IN (SELECT station_id FROM has_month)
      GROUP BY station_id
    ),
    seasonal_rows AS (
      SELECT d.station_id, d.day, d.import_kwh, d.ev_kwh, d.sessions, 'seasonal' AS src,
             extract(day FROM d.day)::int AS dom
      FROM portfolio_daily d
      JOIN seasonal_year sy ON sy.station_id = d.station_id AND extract(year FROM d.day)::int = sy.y
      WHERE extract(month FROM d.day) = ${mm} AND d.coverage_pct > 50
    ),
    has_any AS (
      SELECT station_id FROM has_month UNION SELECT station_id FROM seasonal_year
    ),
    recent_rows AS (
      SELECT station_id, day, import_kwh, ev_kwh, sessions, 'recent' AS src,
             row_number() OVER (PARTITION BY station_id ORDER BY day DESC)::int AS dom
      FROM portfolio_daily
      WHERE coverage_pct > 50 AND station_id NOT IN (SELECT station_id FROM has_any)
    )
    SELECT * FROM month_rows
    UNION ALL SELECT * FROM seasonal_rows
    UNION ALL SELECT * FROM recent_rows WHERE dom <= ${daysInMonth}
  `

  const metaRows = await sql`SELECT station_id, city, zip, brand FROM portfolio_station`
  const metaById = new Map(metaRows.map((r) => [r.station_id as string, r]))

  // Group daily rows per station.
  type DayRow = { dom: number; importKwh: number; evKwh: number; sessions: number; src: string }
  const daysByStation = new Map<string, DayRow[]>()
  for (const r of dailyRows) {
    const list = daysByStation.get(r.station_id as string) ?? []
    list.push({
      dom: Number(r.dom),
      importKwh: Number(r.import_kwh ?? 0),
      evKwh: Number(r.ev_kwh ?? 0),
      sessions: Number(r.sessions ?? 0),
      src: r.src as string,
    })
    daysByStation.set(r.station_id as string, list)
  }

  // Priced day-of-month list (for aligning fallback volumes to real prices).
  const pricedDoms = [...pricedDaySet].map((d) => Number(d.slice(8, 10))).sort((a, b) => a - b)

  const stations: StationMonthSim[] = []
  for (const [stationId, days] of daysByStation) {
    const meta = metaById.get(stationId)
    if (!meta) continue
    const shapeRaw = shapeByStation.get(stationId)
    const shapeTotal = shapeRaw ? shapeRaw.reduce((a, b) => a + b, 0) : 0
    const share =
      shapeRaw && shapeTotal > 0 ? shapeRaw.map((v) => v / shapeTotal) : new Array(24).fill(1 / 24)

    let importKwh = 0
    let evKwh = 0
    let noShiftEur = 0
    let timingRawEur = 0
    let shiftedKwhRaw = 0
    let pricedImport = 0

    for (const day of days) {
      importKwh += day.importKwh
      evKwh += day.evKwh
      if (day.importKwh <= 0) continue
      // Align this volume day to a REAL priced day of the month; fallback rows
      // map by day-of-month position onto the days that have price history.
      const domKey =
        day.src === "month"
          ? day.dom
          : pricedDoms.length > 0
            ? pricedDoms[(day.dom - 1) % pricedDoms.length]
            : day.dom
      const dKey = `${m}-${String(domKey).padStart(2, "0")}`
      // Hourly prices for this day (month-hour average fills gaps).
      const prices: number[] = []
      let havePrices = 0
      for (let h = 0; h < 24; h++) {
        const p = priceByDayHour.get(`${dKey}|${h}`)
        if (p != null) havePrices++
        prices.push(p ?? priceCurve[h])
      }
      if (day.src === "month" && havePrices === 0) continue
      pricedImport += day.importKwh
      // Hourly energies from the site's own shape.
      const e = share.map((s) => s * day.importKwh)
      // Cost without shifting.
      for (let h = 0; h < 24; h++) noShiftEur += (e[h] * prices[h]) / 1000
      // Greedy dispatcher: donors (expensive) → receivers (cheap) while the
      // spread beats wear, capped at maxShare of the day's import.
      // ENERGY BALANCE (method 2026-09-04.4, same rule as the live
      // settlement): every kWh moved through the battery costs LS_LOSS_SHARE
      // extra grid energy, bought in the receiving (cheap) hour. The archive
      // import IS the no-load-shifting world, so the loss is charged to the
      // load-shifting side: saving = qty × p_donor − qty × (1 + share) × p_cheap.
      const order = prices.map((p, h) => ({ p, h }))
      const donors = [...order].sort((a, b) => b.p - a.p)
      const receivers = [...order].sort((a, b) => a.p - b.p)
      let cap = day.importKwh * maxShare
      let di = 0
      const moved = new Array(24).fill(0)
      const cheapest = receivers[0]
      const cheapDelivered = cheapest.p * (1 + LS_LOSS_SHARE)
      while (cap > 0.001 && di < donors.length) {
        const d = donors[di]
        if (d.h === cheapest.h || d.p - cheapDelivered <= wear) break
        const avail = e[d.h] - moved[d.h]
        if (avail <= 0.001) {
          di++
          continue
        }
        const qty = Math.min(avail, cap)
        moved[d.h] += qty
        cap -= qty
        timingRawEur += (qty * (d.p - cheapDelivered)) / 1000
        shiftedKwhRaw += qty
        if (e[d.h] - moved[d.h] <= 0.001) di++
      }
    }

    // Scale price-covered results up to the station's full data volume.
    const scale = pricedImport > 0 ? importKwh / pricedImport : 0
    noShiftEur *= scale
    timingRawEur *= scale
    shiftedKwhRaw *= scale

    // Sessions only where the station's own export was imported for THIS
    // month. A projected row (seasonal/recent proxy volumes) never gets a
    // count — its volume is not this month's, so neither would its sessions be.
    const volumeSource = (days[0]?.src ?? "month") as StationMonthSim["volumeSource"]
    const derived = volumeSource === "month" ? archiveSessions.get(stationId) : undefined

    // Keep zero-volume stations (e.g. a site offline for the whole month) as
    // explicit 0 € rows instead of silently dropping them — the fleet report
    // must account for all locations.
    stations.push({
      stationId,
      city: (meta.city as string) ?? "",
      zip: (meta.zip as string) ?? "",
      brand: (meta.brand as string) ?? "",
      volumeSource,
      daysWithData: days.length,
      importKwh,
      evKwh,
      sessions: derived ?? null,
      sessionsBasis: derived != null ? CCR_SESSION_METHOD : null,
      flatEur: (importKwh * flat) / 1000,
      noShiftEur,
      timingRawEur,
      shiftedKwhRaw,
    })
  }

  stations.sort((a, b) => b.evKwh - a.evKwh)
  return { month: m, daysInMonth, priceCurve, pricedDays, stations }
}
