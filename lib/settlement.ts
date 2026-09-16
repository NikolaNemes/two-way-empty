import "server-only"
import { runBacktestForRange, type RangeBacktestResult } from "@/app/actions/backtest"
import { getIdmPricesForRange, type IdmRangeResult } from "@/app/actions/idm-prices"
import { berlinDayWindow, type ReportWindow } from "@/lib/report-window"
import {
  compute,
  settlementFigures,
  DEFAULT_FLAT_CT,
  DEFAULT_ADDER_CT,
  DEFAULT_CYCLING_CT,
  type Computed,
  type SettlementFigures,
} from "@/lib/tariff-compute"
import { GRID_REAL_POWER_CAP_KW } from "@/lib/dispatch-kernel"

/**
 * STATION SETTLEMENT — the ONE function that prices a station over a window.
 *
 * Callers (and there must be no others):
 *  - the site Financial Report      → app/actions/settlement.ts  (user-chosen days)
 *  - the Fleet Monthly row builder  → lib/fleet-report-builder.ts (calendar month)
 *  - the Fleet Yearly report        → Σ of Fleet Monthly rows (never re-priced)
 *  - scripts/verify-fleet-vs-financial.ts → asserts the three agree to the cent
 *
 * Same window rule (lib/report-window), same replay (runBacktestForRange), same
 * price curve (getIdmPricesForRange), same engine (compute) and the same Annex
 * arithmetic (settlementFigures). A page may only RENDER what comes out of here.
 */

/** The vetted market defaults every report uses unless the user is doing what-if. */
export const SETTLEMENT_PARAMS = {
  flatCt: DEFAULT_FLAT_CT,
  adderCt: DEFAULT_ADDER_CT,
  wearCt: DEFAULT_CYCLING_CT,
  gridCapKw: GRID_REAL_POWER_CAP_KW,
} as const

export type SettlementParams = { flatCt: number; adderCt: number; wearCt: number; gridCapKw: number }

export interface StationSettlement {
  window: ReportWindow
  params: SettlementParams
  /** Full replay result — charts, sessions, per-day rows, totals. */
  bt: RangeBacktestResult
  /** IDM/DAM price curve the window was priced with (per 15-min slot). */
  idm: IdmRangeResult | null
  /** Engine output. `null` when the window drew no grid import. */
  c: Computed | null
  /** The Annex euros — derived ONCE here, rendered everywhere. */
  figures: SettlementFigures | null
  /** Why `c` is null (empty telemetry, MPC unavailable, no import). */
  reason: "ok" | "empty" | "mpc-unavailable" | "no-import" | "no-prices"
}

export async function settleStationWindow(input: {
  stationId: string
  window: ReportWindow
  params?: Partial<SettlementParams>
}): Promise<StationSettlement> {
  const params: SettlementParams = { ...SETTLEMENT_PARAMS, ...(input.params ?? {}) }
  const { fromIso, toIso } = input.window
  const bt = await runBacktestForRange({ stationId: input.stationId, fromIso, toIso })
  const base = { window: input.window, params, bt, idm: null, c: null, figures: null } as const
  if (!bt || bt.empty) return { ...base, reason: "empty" }
  if (bt.mpcStatus === "unavailable") return { ...base, reason: "mpc-unavailable" }
  const idm = await getIdmPricesForRange({ fromIso, toIso })
  const idmBySlot = new Map<number, number>((idm?.prices ?? []).map((p) => [p.slot, p.priceEurMwh]))
  const c = compute(bt, idmBySlot, params.flatCt, params.adderCt, params.wearCt, params.gridCapKw)
  if (!c) return { ...base, idm, reason: "no-import" }
  return { ...base, idm, c, figures: settlementFigures(c, params.wearCt), reason: "ok" }
}

/** Convenience: settle an inclusive Berlin day range. */
export function settleStationDays(input: {
  stationId: string
  fromDay: string
  toDay: string
  params?: Partial<SettlementParams>
}): Promise<StationSettlement> {
  return settleStationWindow({
    stationId: input.stationId,
    window: berlinDayWindow(input.fromDay, input.toDay),
    params: input.params,
  })
}
