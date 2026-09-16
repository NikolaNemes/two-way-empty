"use server"

import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { fleetMonthReport } from "@/lib/db/schema"
import { METHODOLOGY_VERSION } from "@/lib/methodology-version"
import { fleetMonthForWindow } from "@/lib/report-window"
import { settleStationDays, type StationSettlement } from "@/lib/settlement"

/**
 * Financial Report entry point. Prices `stationId` over the inclusive Berlin
 * day range through lib/settlement — the same function the Fleet Monthly cron
 * uses — and, when the range is exactly a fleet month, reads that station's
 * frozen Fleet Monthly row so the page can PROVE the two agree.
 */
export interface Reconciliation {
  /** yyyy-mm the window corresponds to. */
  month: string
  /** The frozen Fleet Monthly row (current methodology) — null if not filled yet. */
  fleet: { netEur: number; lsEur: number; flatEur: number; asRunEur: number; computedAt: string } | null
  /** Live figures equal the frozen row to the cent. */
  matches: boolean | null
  /** Largest absolute difference across the compared euros (0 when matching). */
  maxDiffEur: number | null
}

export type StationSettlementResult = StationSettlement & {
  methodologyVersion: string
  reconciliation: Reconciliation | null
}

export async function settleStationRange(input: {
  stationId: string
  fromDay: string
  toDay: string
}): Promise<StationSettlementResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(input.toDay)) {
    throw new Error("Invalid day range")
  }
  const s = await settleStationDays(input)

  let reconciliation: Reconciliation | null = null
  const month = fleetMonthForWindow(input.fromDay, input.toDay)
  if (month) {
    const [row] = await db
      .select({
        netEur: fleetMonthReport.netEur,
        lsEur: fleetMonthReport.lsEur,
        flatEur: fleetMonthReport.flatEur,
        asRunEur: fleetMonthReport.asRunEur,
        computedAt: fleetMonthReport.computedAt,
        methodologyVersion: fleetMonthReport.methodologyVersion,
      })
      .from(fleetMonthReport)
      .where(and(eq(fleetMonthReport.stationId, input.stationId), eq(fleetMonthReport.month, month)))
      .limit(1)
    const fleet =
      row && row.methodologyVersion === METHODOLOGY_VERSION
        ? {
            netEur: row.netEur,
            lsEur: row.lsEur,
            flatEur: row.flatEur,
            asRunEur: row.asRunEur,
            computedAt: row.computedAt.toISOString(),
          }
        : null
    let matches: boolean | null = null
    let maxDiffEur: number | null = null
    if (fleet && s.figures) {
      const diffs = [
        Math.abs(fleet.netEur - s.figures.netEur),
        Math.abs(fleet.lsEur - s.figures.lsEur),
        Math.abs(fleet.flatEur - s.figures.flatEur),
        Math.abs(fleet.asRunEur - s.figures.asRunEur),
      ]
      maxDiffEur = Math.max(...diffs)
      matches = maxDiffEur < 0.005
    }
    reconciliation = { month, fleet, matches, maxDiffEur }
  }

  return { ...s, methodologyVersion: METHODOLOGY_VERSION, reconciliation }
}
