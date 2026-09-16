// ════════════════════════════════════════════════════════════════════════
// DAILY REPORT ROLLUP — freezes one (station, closed UTC day) into
// station_day_report BEFORE raw telemetry ages out of the retention window.
//
// Written by /api/cron/rollup nightly (02:30 UTC, before retention at 03:15).
// The retention cron REFUSES to delete a day's frames until this row exists
// (safety interlock), so ordering between the two crons is a performance
// detail, not a correctness requirement.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db"
import { modelVersion, stationDayReport } from "@/lib/db/schema"
import { loadFramesFromDb, runBacktest, type BacktestFrameRow, type DailySaving } from "@/lib/backtest"
import { loadLiveBacktestFrames } from "@/lib/ingestion"
import type { KernelParams } from "@/lib/model-registry"
import { desc, sql } from "drizzle-orm"
import { compute, DEFAULT_CYCLING_CT, DEFAULT_FLAT_CT } from "@/lib/tariff-compute"
import { GRID_REAL_POWER_CAP_KW } from "@/lib/dispatch-kernel"
import { getIdmPricesForRange } from "@/app/actions/idm-prices"
import { createNeonIdmStore, createNeonPriceStore } from "@/lib/price-store"
import { DEFAULT_ZONE } from "@/lib/price-supply"
import { compactSeries15, freezeDayTariff, type RollupDetail, type RollupTariffFrozen } from "@/lib/rollup-tariff"
import type { RangeBacktestResult } from "@/app/actions/backtest"

/** Raw retention window (days). Mirrored by the retention cron. */
export const RAW_RETENTION_DAYS = 35

/**
 * Coverage = engine-measured data span / 24h. NOT frames/5760: cadence varies
 * per station (Norderstedt 15s, Gronau 30s — live-verified), so a frame-count
 * denominator would misreport a complete Gronau day as ~50% coverage.
 */
function coverageOf(durationHours: number): number {
  return Math.min(1, Math.max(0, durationHours / 24))
}

export interface RollupDayResult {
  stationId: string
  day: string
  ok: boolean
  frames?: number
  savingsEur?: number
  skipped?: "no-frames" | "already-rolled"
  error?: string
}

/**
 * Frozen market pricing of a day's METERED import (IDM first, DAM fallback).
 * dynamic_cost_eur is frozen at rollup time; the flat tariff is intentionally
 * NOT frozen (recomputed as rate × kWh at read time so the configurable flat
 * rate keeps working).
 */
export interface DayPricing {
  dynamicCostEur: number | null
  pricedFraction: number | null
  idmFraction: number | null
}

/**
 * Price a day's metered import IN MEMORY from the exact frames the kernel ran
 * on (15-min slot buckets, IDM first, DAM fallback). Works for stations whose
 * frames only exist in the Amperio API (Gronau) and for the per-day raw
 * replay path, so both paths price identically.
 *
 * dt is PER-FRAME from the gap to the next frame (capped at 120 s for outage
 * gaps), NOT a hardcoded cadence: Norderstedt streams at 15 s but Gronau at
 * 30 s (live-verified). Sign convention (fleet-wide, live-verified):
 * gridPowerW is NEGATIVE on import, so import W = max(-gridPowerW, 0).
 */
export async function priceFramesImport(frames: BacktestFrameRow[]): Promise<DayPricing> {
  if (frames.length === 0) return { dynamicCostEur: null, pricedFraction: null, idmFraction: null }
  const slotKwh = new Map<number, number>()
  let total = 0
  for (let i = 0; i < frames.length; i++) {
    const t = new Date(frames[i].ts).getTime()
    const next = i + 1 < frames.length ? new Date(frames[i + 1].ts).getTime() : t + 30_000
    const dtS = Math.min(120, Math.max(0, (next - t) / 1000))
    const importW = Math.max(0, -(frames[i].gridPowerW ?? 0))
    const kwh = (importW * dtS) / 3_600_000
    if (kwh <= 0) continue
    const slot = Math.floor(t / 900_000)
    slotKwh.set(slot, (slotKwh.get(slot) ?? 0) + kwh)
    total += kwh
  }
  if (total <= 0) return { dynamicCostEur: null, pricedFraction: null, idmFraction: null }
  const slots = Array.from(slotKwh.keys())
  const minSlot = Math.min(...slots)
  const maxSlot = Math.max(...slots)
  const [idmRows, damRows] = await Promise.all([
    createNeonIdmStore().getRange(DEFAULT_ZONE, minSlot, maxSlot),
    createNeonPriceStore().getRange(DEFAULT_ZONE, minSlot, maxSlot),
  ])
  const idm = new Map(idmRows.map((p) => [p.slot, p.priceEurMwh]))
  const dam = new Map(damRows.map((p) => [p.slot, p.priceEurMwh]))
  let priced = 0
  let idmKwh = 0
  let cost = 0
  for (const [slot, kwh] of slotKwh) {
    const pi = idm.get(slot)
    const pd = dam.get(slot)
    const price = pi ?? pd
    if (price == null || !Number.isFinite(price)) continue
    priced += kwh
    if (pi != null) idmKwh += kwh
    cost += (kwh * price) / 1000
  }
  return {
    dynamicCostEur: priced > 0 ? cost : null,
    pricedFraction: priced / total,
    idmFraction: priced > 0 ? idmKwh / priced : null,
  }
}

export interface FrozenDay {
  pricing: DayPricing
  detail: RollupDetail & { daily: DailySaving | null }
  /** Shape consumed by the tariff engine's `rollupDays`. */
  rollupDay: NonNullable<RangeBacktestResult["rollupDays"]>[number]
}

/**
 * Build the frozen daily payload from a finished kernel run — the SINGLE
 * definition of "a closed day" shared by the nightly rollup writer and the
 * per-day raw replay (`runBacktestForRange`). Whatever path a page takes, a
 * day yields the same import, energy cost, counterfactual, wear and sessions.
 */
export async function freezeDayFromRun(args: {
  day: string
  frames: BacktestFrameRow[]
  result: Awaited<ReturnType<typeof runBacktest>>
  versionLabel: string
  frameSource: "stored" | "live" | "hybrid"
}): Promise<FrozenDay> {
  const { day, frames, result, versionLabel, frameSource } = args
  const fromTs = new Date(`${day}T00:00:00.000Z`)
  const toTs = new Date(fromTs.getTime() + 24 * 3600 * 1000)

  const pricing = await priceFramesImport(frames)

  // ── LOSSLESS PAYLOAD (Gronau defect report, sep 2 2026) ─────────────────
  // Run the tariff engine on the day itself so the frozen row carries the
  // grid-first counterfactual, the wear bases and the throughput diagnostics
  // (adder = 0 → energy-only; the read path adds the configurable adder and
  // cycling rate). Without this a rollup-served month lost "Dynamic
  // no-dispatch", showed negative timing value and ~1/3 of the sessions.
  let tariff: RollupTariffFrozen | undefined
  try {
    const idm = await getIdmPricesForRange({ fromIso: fromTs.toISOString(), toIso: toTs.toISOString() })
    const idmBySlot = new Map<number, number>(idm.prices.map((p) => [p.slot, p.priceEurMwh]))
    const rangeShaped: RangeBacktestResult = {
      versionLabel,
      kpis: result.kpis,
      series: result.series,
      sessions: result.sessions,
      totals: result.totals,
      daily: result.daily,
    }
    const c = compute(rangeShaped, idmBySlot, DEFAULT_FLAT_CT, 0, DEFAULT_CYCLING_CT, GRID_REAL_POWER_CAP_KW)
    if (c) tariff = freezeDayTariff(c, GRID_REAL_POWER_CAP_KW)
  } catch (err) {
    // Non-fatal: the row still freezes import/energy cost; the read path
    // treats a missing `tariff` as a legacy row and flags it.
    console.log(`[v0] freeze ${day}: tariff freeze failed: ${(err as Error)?.message ?? err}`)
  }

  const dayEntry = result.daily?.find((d) => d.bucketIso === day) ?? null
  const detail: RollupDetail & { daily: DailySaving | null } = {
    daily: dayEntry,
    totals: {
      actualImportKwh: result.totals.actualImportKwh,
      optimizedImportKwh: result.totals.optimizedImportKwh,
      evKwh: result.totals.evKwh,
      mEv1Kwh: result.totals.mEv1Kwh ?? 0,
      mEv2Kwh: result.totals.mEv2Kwh ?? 0,
      auxKwh: result.totals.auxKwh ?? 0,
      battNetKwh: result.totals.battNetKwh ?? null,
      exportKwh: result.totals.exportKwh ?? null,
      auxClampedKwh: result.totals.auxClampedKwh ?? null,
      auxGatedKwh: result.totals.auxGatedKwh ?? null,
    },
    kpis: {
      savingsPct: result.kpis.savingsPct,
      batteryThroughputKwh: result.kpis.batteryThroughputKwh,
      batteryCycles: result.kpis.batteryCycles,
      durationHours: result.kpis.durationHours,
    },
    tariff,
    sessions: result.sessions,
    series15: compactSeries15(result.series, day),
    frameSource,
  }
  return {
    pricing,
    detail,
    rollupDay: {
      day,
      importKwh: result.totals.actualImportKwh,
      dynamicCostEur: pricing.dynamicCostEur,
      pricedFraction: pricing.pricedFraction,
      idmFraction: pricing.idmFraction,
      tariff,
    },
  }
}

/**
 * Roll up ONE closed UTC day for one station: replay the production MPC over
 * the stored frames (identical engine to the reports), price the metered
 * import, and upsert the frozen daily row. Idempotent — re-running replaces
 * the row (force=true) or skips it.
 * Stations without locally stored frames (Gronau) are replayed from the
 * Amperio API so their history can be frozen too.
 */
export async function rollupStationDay(
  stationId: string,
  day: string, // "YYYY-MM-DD" (UTC)
  opts: { force?: boolean } = {},
): Promise<RollupDayResult> {
  try {
    if (!opts.force) {
      const existing = await db.execute(
        sql`SELECT 1 FROM station_day_report WHERE station_id = ${stationId} AND day = ${day} LIMIT 1`,
      )
      if (existing.rows.length > 0) return { stationId, day, ok: true, skipped: "already-rolled" }
    }

    // Resolve the production default model (same rule as runBacktestForRange:
    // reports only ever reflect the production MPC).
    const def = await db
      .select()
      .from(modelVersion)
      .orderBy(desc(modelVersion.isDefault), modelVersion.id)
      .limit(1)
    if (def.length === 0 || (def[0].params as KernelParams).engine !== "v4-mpc") {
      return { stationId, day, ok: false, error: "no production MPC model configured" }
    }

    const fromTs = new Date(`${day}T00:00:00.000Z`)
    const toTs = new Date(fromTs.getTime() + 24 * 3600 * 1000 - 1)

    // Frames: stored first, Amperio API when the station has none locally.
    let frames = await loadFramesFromDb(stationId, fromTs, toTs)
    let frameSource: "stored" | "live" = "stored"
    if (frames.length === 0) {
      try {
        frames = await loadLiveBacktestFrames({ stationId, fromIso: fromTs.toISOString(), toIso: toTs.toISOString() })
        frameSource = "live"
      } catch (err) {
        return { stationId, day, ok: false, error: `API frames failed: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
    if (frames.length === 0) return { stationId, day, ok: true, skipped: "no-frames" }

    let result: Awaited<ReturnType<typeof runBacktest>>
    try {
      result = await runBacktest({
        stationId,
        fromTs,
        toTs,
        frames,
        paramOverride: def[0].params as KernelParams,
        // Settlement integrates EVERY frame (method 2026-09-04.3). The 600-pt
        // series is a chart budget; on it the counterfactual was a ratio
        // estimate carrying ± a few kWh/day of sampling error.
        seriesMaxPoints: Infinity,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/no (stored )?frames|no telemetry/i.test(msg)) {
        return { stationId, day, ok: true, skipped: "no-frames" }
      }
      return { stationId, day, ok: false, error: msg }
    }

    if (result.kpis.frames === 0) return { stationId, day, ok: true, skipped: "no-frames" }

    const { pricing, detail } = await freezeDayFromRun({ day, frames, result, versionLabel: def[0].label, frameSource })

    await db
      .insert(stationDayReport)
      .values({
        stationId,
        day,
        frames: result.kpis.frames,
        coveragePct: coverageOf(result.kpis.durationHours),
        importKwh: result.totals.actualImportKwh,
        evKwh: result.totals.evKwh,
        auxKwh: result.totals.auxKwh ?? null,
        battNetKwh: result.totals.battNetKwh ?? null,
        actualCostEur: result.kpis.actualCostEur,
        optimizedCostEur: result.kpis.optimizedCostEur,
        savingsEur: result.kpis.savingsEur,
        dynamicCostEur: pricing.dynamicCostEur,
        pricedFraction: pricing.pricedFraction,
        idmFraction: pricing.idmFraction,
        engineVersion: def[0].label,
        detail,
      })
      .onConflictDoUpdate({
        target: [stationDayReport.stationId, stationDayReport.day],
        set: {
          frames: result.kpis.frames,
          coveragePct: coverageOf(result.kpis.durationHours),
          importKwh: result.totals.actualImportKwh,
          evKwh: result.totals.evKwh,
          auxKwh: result.totals.auxKwh ?? null,
          battNetKwh: result.totals.battNetKwh ?? null,
          actualCostEur: result.kpis.actualCostEur,
          optimizedCostEur: result.kpis.optimizedCostEur,
          savingsEur: result.kpis.savingsEur,
          dynamicCostEur: pricing.dynamicCostEur,
          pricedFraction: pricing.pricedFraction,
          idmFraction: pricing.idmFraction,
          engineVersion: def[0].label,
          computedAt: sql`now()`,
          detail,
        },
      })

    return { stationId, day, ok: true, frames: result.kpis.frames, savingsEur: result.kpis.savingsEur }
  } catch (err) {
    return { stationId, day, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** UTC "YYYY-MM-DD" for a Date. */
export function utcDayOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * List closed UTC days (day < today) in [from, to] that have no rollup row.
 * Source-agnostic since sep 2 2026: a day counts as missing whether or not
 * local frames exist, because `rollupStationDay` replays API-only stations
 * (Gronau) from the Amperio middleware. Days with frames in neither source
 * come back as `skipped: "no-frames"` from the rollup itself.
 */
export async function listMissingRollupDays(
  stationId: string,
  fromDay: string,
  toDay: string,
): Promise<string[]> {
  const today = utcDayOf(new Date())
  const res = await db.execute(sql`
    SELECT to_char(d, 'YYYY-MM-DD') AS day
    FROM generate_series(${fromDay}::date, ${toDay}::date, interval '1 day') AS g(d)
    WHERE to_char(d, 'YYYY-MM-DD') < ${today}
      AND NOT EXISTS (
        SELECT 1 FROM station_day_report r
        WHERE r.station_id = ${stationId}
          AND r.day = to_char(d, 'YYYY-MM-DD')
      )
    ORDER BY 1
  `)
  return (res.rows as { day: string }[]).map((r) => r.day)
}

/**
 * Closed UTC days in [from, to] with NO locally stored frames. The nightly cron
 * backfills these from the Amperio API before rolling up so every enabled
 * station's raw tail (Dispatching History, the accruing day) is served from
 * Neon instead of a full middleware replay per report request.
 */
export async function listDaysWithoutFrames(stationId: string, fromDay: string, toDay: string): Promise<string[]> {
  const today = utcDayOf(new Date())
  const res = await db.execute(sql`
    SELECT to_char(d, 'YYYY-MM-DD') AS day
    FROM generate_series(${fromDay}::date, ${toDay}::date, interval '1 day') AS g(d)
    WHERE to_char(d, 'YYYY-MM-DD') < ${today}
      AND NOT EXISTS (
        SELECT 1 FROM telemetry_frame t
        WHERE t.station_id = ${stationId}
          AND t.ts >= d::timestamptz
          AND t.ts < d::timestamptz + interval '1 day'
      )
    ORDER BY 1
  `)
  return (res.rows as { day: string }[]).map((r) => r.day)
}
