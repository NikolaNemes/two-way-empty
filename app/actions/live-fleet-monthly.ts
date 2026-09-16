"use server"

/**
 * Live Fleet Monthly Report — real chargepost_* stations ONLY.
 *
 * Reads the pre-computed live rows from fleet_month_report (filled by
 * /api/cron/fleet-report, anchor_status = 'live'). Never touches hist_*
 * twins — the two datasets share the table but are disjoint by station_id
 * prefix and are NEVER combined (client instruction sep 1 2026).
 */

import { db } from "@/lib/db"
import { fleetMonthReport } from "@/lib/db/schema"
import {
  fillLiveFleetMonth,
  LIVE_FLEET_FIRST_MONTH,
  liveFleetMonths,
  METHODOLOGY_VERSION,
} from "@/lib/fleet-report-builder"
import { requireAdmin } from "@/lib/auth"
import { and, gte, notLike } from "drizzle-orm"

export interface LiveMonthlyStationRow {
  stationId: string
  month: string
  city: string
  zip: string
  brand: string | null
  importKwh: number
  /** Site load (kernel demand signal = EV + AUX). Not shown as "EV". */
  evKwh: number
  /** EV delivered (C1+C2), metered connector counters — same as site KPI. */
  evDeliveredKwh: number | null
  /** AUX (ChargePost self-consumption) = import − export − EV delivered − battNet (method 2026-09-03.3). */
  auxKwh: number | null
  /** Battery charge − discharge; closes importKwh = evDeliveredKwh + auxKwh + battNetKwh. NULL pre-2026-09-03.3. */
  battNetKwh: number | null
  sessions: number
  flatEur: number
  flatCtApplied: number | null
  noShiftEur: number
  asRunEur: number
  procSavingEur: number
  /** Battery wear WITHOUT load shifting (A4.2). NULL on rows frozen before the column existed. */
  wearNoShiftEur: number | null
  /** Battery wear WITH load shifting, as run (A4.1). */
  wearAsRunEur: number | null
  /** Extra wear = wearAsRunEur − wearNoShiftEur (A6.3). */
  wearEur: number
  netEur: number
  lsEur: number
  timingEur: number
  /** First telemetry frame in the window. Gifhorn Aug 2026 = 20 Aug, not the
   *  1st — added 2026-09-03 so a partial month is visible on the report. */
  dataFrom: string | null
  dataThrough: string | null
  /** Distinct Berlin days with data (Norderstedt Aug 2026 = 25 of 31). */
  coveredDays: number | null
  pricedFraction: number | null
  idmFraction: number | null
  damFraction: number | null
  computedAt: string
}

export interface LiveMonthlyReport {
  /** All months from LIVE_FLEET_FIRST_MONTH through the current month. */
  months: string[]
  firstMonth: string
  /** Live station rows keyed by month (months without data are absent). */
  rowsByMonth: Record<string, LiveMonthlyStationRow[]>
  /** Station rows per month that were computed on another methodology and are
   * therefore NOT in rowsByMonth (a stale deployment's cron wrote them). */
  staleByMonth: Record<string, number>
  methodologyVersion: string
}

export async function getLiveFleetMonthlyReport(): Promise<LiveMonthlyReport> {
  const rows = await db
    .select()
    .from(fleetMonthReport)
    .where(
      and(gte(fleetMonthReport.month, LIVE_FLEET_FIRST_MONTH), notLike(fleetMonthReport.stationId, "hist_%")),
    )

  // METHODOLOGY GUARD (sep 3 2026): rows a stale deployment wrote on an older
  // builder are not shown — same rule as the yearly reader. Surface them so the
  // page can say why a month is missing instead of showing a wrong figure.
  const staleByMonth: Record<string, number> = {}
  const rowsByMonth: Record<string, LiveMonthlyStationRow[]> = {}
  for (const r of rows) {
    if (r.methodologyVersion !== METHODOLOGY_VERSION) {
      staleByMonth[r.month] = (staleByMonth[r.month] ?? 0) + 1
      continue
    }
    const row: LiveMonthlyStationRow = {
      stationId: r.stationId,
      month: r.month,
      city: r.city,
      zip: r.zip,
      brand: r.brand,
      importKwh: r.importKwh,
      evKwh: r.evKwh,
      evDeliveredKwh: r.evDeliveredKwh,
      auxKwh: r.auxKwh,
      battNetKwh: r.battNetKwh,
      // Live rows always carry real charge events; the column is nullable only
      // for the History Analysis dataset (archive import has no sessions).
      sessions: r.sessions ?? 0,
      flatEur: r.flatEur,
      flatCtApplied: r.flatCtApplied,
      noShiftEur: r.noShiftEur,
      asRunEur: r.asRunEur,
      procSavingEur: r.procSavingEur,
      wearNoShiftEur: r.wearNoShiftEur,
      wearAsRunEur: r.wearAsRunEur,
      wearEur: r.wearEur,
      netEur: r.netEur,
      lsEur: r.lsEur,
      timingEur: r.timingEur,
      dataFrom: r.dataFrom ? r.dataFrom.toISOString() : null,
      dataThrough: r.dataThrough ? r.dataThrough.toISOString() : null,
      coveredDays: r.coveredDays,
      pricedFraction: r.pricedFraction,
      idmFraction: r.idmFraction,
      damFraction: r.damFraction,
      computedAt: r.computedAt.toISOString(),
    }
    ;(rowsByMonth[r.month] ??= []).push(row)
  }
  for (const m of Object.keys(rowsByMonth)) {
    rowsByMonth[m].sort((a, b) => a.city.localeCompare(b.city))
  }

  return {
    months: liveFleetMonths(),
    firstMonth: LIVE_FLEET_FIRST_MONTH,
    rowsByMonth,
    staleByMonth,
    methodologyVersion: METHODOLOGY_VERSION,
  }
}

/** Admin-only: recompute one live month in place (backtest + pricing). */
export async function refreshLiveFleetMonth(month: string): Promise<{
  ok: boolean
  rows: number
  stations: Record<string, string>
  error?: string
}> {
  await requireAdmin()
  if (!/^\d{4}-\d{2}$/.test(month) || !liveFleetMonths().includes(month)) {
    return { ok: false, rows: 0, stations: {}, error: "invalid month" }
  }
  const res = await fillLiveFleetMonth(month)
  return { ok: res.ok, rows: res.rows, stations: res.stations, error: res.error }
}
