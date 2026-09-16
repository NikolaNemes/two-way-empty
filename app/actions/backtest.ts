"use server"

import { db } from "@/lib/db"
import { backtestRun, modelVersion, stationDayReport, type BacktestRunRow, type ModelVersionRow } from "@/lib/db/schema"
import { RAW_RETENTION_DAYS } from "@/lib/rollup"
import { runBacktest, loadFramesFromDb, type BacktestFrameRow, type BacktestKpis, type BacktestSeriesPoint, type DailySaving, type EngineCommandTraceEntry } from "@/lib/backtest"
import { loadLiveBacktestFrames } from "@/lib/ingestion"
import type { ChargerSession } from "@/lib/charger-sessions"
import { expandSeries15, mergeSessions, type RollupDetail, type RollupTariffFrozen } from "@/lib/rollup-tariff"
import { freezeDayFromRun } from "@/lib/rollup"
import { chartStepMs, downsampleSeries, telemetryStatsFromSeries, type TelemetryStats } from "@/lib/series-downsample"
import {
  isClosedChunk,
  isMemoisable,
  memoKey,
  paramsFingerprint,
  readReplayMemo,
  writeReplayMemo,
} from "@/lib/replay-memo"
import { DEFAULT_STATION_ID } from "@/lib/amperio-api"
import type { KernelParams } from "@/lib/model-registry"
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

export interface RunBacktestInput {
  modelVersionId: number
  stationId?: string
  fromIso: string
  toIso: string
  notes?: string
  /**
   * Optional MPC horizon override (steps). Lets the Backtest Lab A/B the
   * look-ahead length (e.g. 96 = 24h vs 140 = 35h) WITHOUT editing the model
   * version. Only applied to v4-mpc params; the realistic DAM publish gate still
   * caps what prices are actually visible, so a longer horizon only helps once
   * tomorrow's day-ahead curve is published. Ignored for non-MPC engines.
   */
  horizonStepsOverride?: number
}

/** Run a backtest for a model version over a stored range and persist it. */
export async function runAndStoreBacktest(input: RunBacktestInput): Promise<BacktestRunRow> {
  const stationId = input.stationId?.trim() || DEFAULT_STATION_ID

  const version = await db
    .select()
    .from(modelVersion)
    .where(eq(modelVersion.id, input.modelVersionId))
    .limit(1)
  if (version.length === 0) throw new Error("Model version not found")

  const baseParams = version[0].params as KernelParams

  // Apply an optional horizon override for A/B testing the look-ahead length.
  // Spread-merge so every other mpc field is preserved (resolveParams merges
  // shallowly, so we must hand it a complete mpc block). Only meaningful for the
  // v4-mpc engine — silently ignored otherwise.
  let params = baseParams
  const ov = input.horizonStepsOverride
  const horizonApplied =
    ov != null && Number.isFinite(ov) && ov > 0 && baseParams.engine === "v4-mpc" && baseParams.mpc != null
  if (horizonApplied) {
    params = {
      ...baseParams,
      mpc: { ...baseParams.mpc!, horizonSteps: Math.round(ov!) },
    }
  }

  const result = await runBacktest({
    stationId,
    fromTs: new Date(input.fromIso),
    toTs: new Date(input.toIso),
    paramOverride: params,
  })

  // Tag horizon-override runs in the notes so they're identifiable in history /
  // A/B compare (e.g. "H=140 (35h)") without inventing a new schema column.
  const hSteps = horizonApplied ? Math.round(ov!) : (params.engine === "v4-mpc" ? params.mpc?.horizonSteps : undefined)
  const horizonNote =
    horizonApplied && hSteps != null
      ? `H=${hSteps} (${((hSteps * (params.mpc?.stepHours ?? 0.25))).toFixed(0)}h)`
      : null
  const notes = [input.notes?.trim() || null, horizonNote].filter(Boolean).join(" · ") || null

  const [run] = await db
    .insert(backtestRun)
    .values({
      modelVersionId: input.modelVersionId,
      stationId,
      fromTs: new Date(input.fromIso),
      toTs: new Date(input.toIso),
      status: "done",
      params: result.params,
      kpis: result.kpis,
      series: result.series,
      sessions: result.sessions,
      totals: result.totals,
      notes,
    })
    .returning()

  revalidatePath("/lab/backtest")
  return run
}

export async function listBacktestRuns(limit = 50): Promise<BacktestRunRow[]> {
  return db.select().from(backtestRun).orderBy(desc(backtestRun.createdAt)).limit(limit)
}

export async function getBacktestRun(id: number): Promise<BacktestRunRow | null> {
  const rows = await db.select().from(backtestRun).where(eq(backtestRun.id, id)).limit(1)
  return rows[0] ?? null
}

export async function compareRuns(idA: number, idB: number): Promise<BacktestRunRow[]> {
  return db.select().from(backtestRun).where(inArray(backtestRun.id, [idA, idB]))
}

export interface RangeBacktestResult {
  versionLabel: string
  kpis: BacktestKpis
  series: BacktestSeriesPoint[]
  sessions: ChargerSession[]
  /** Per-day savings breakdown — present on a successful multi-day run. */
  daily?: DailySaving[]
  /** Per-hour savings breakdown — powers the single-day savings popup. */
  hourly?: DailySaving[]
  totals: {
    actualImportKwh: number
    optimizedImportKwh: number
    evKwh: number
    mEv1Kwh?: number
    mEv2Kwh?: number
    /** NON-EV ChargePost self-consumption (kWh) — the window energy balance
     *  import − export − EV delivered − battNet (method 2026-09-03.3). */
    auxKwh?: number
    /** Metered battery charge − discharge (kWh); closes import = EV + AUX + battNet.
     *  Null when every contributing day predates 2026-09-03.3. */
    battNetKwh?: number | null
    /** Battery-meter legs of the RAW segments only (kWh). Frozen days carry
     *  theirs on `tariff.battMeter*`; compute() adds the two (2026-09-04.1). */
    battChargeKwh?: number | null
    battDischargeKwh?: number | null
    evUnservedKwh?: number
    /** Per-connector "could I serve more?" energy (kWh). Null when that car reported no acceptance limit. */
    ev1AcceptableKwh?: number | null
    ev2AcceptableKwh?: number | null
    ev1ServedKwh?: number | null
    ev2ServedKwh?: number | null
    ev1HeadroomKwh?: number | null
    ev2HeadroomKwh?: number | null
  }
  empty?: boolean
  /**
   * Where the replayed frames came from:
   * - "stored": Neon-backed telemetry (Backtest Lab + closed days).
   * - "live":   pulled straight from the Amperio API for a non-persisted day,
   *             so the production v5 MPC still runs (no client heuristic).
   * - "rollup": entirely from frozen station_day_report daily aggregates
   *             (range is older than the 35-day raw retention window).
   * - "hybrid": stitched — old part from rollups, recent part from raw frames.
   */
  frameSource?: "stored" | "live" | "rollup" | "hybrid"
  /**
   * Set when `chartOnly` downsampled the series for a long window: the bucket
   * width in ms (multiple of 15 min). Power values are then bucket means, so a
   * chart-derived count such as "grid-cap breaches" counts buckets, not frames.
   */
  seriesStepMs?: number
  /**
   * `chartOnly` only: measured SOC range and grid-cap breach count computed on
   * the FULL series before any downsampling, so the card's KPIs keep frame
   * resolution even when the chart shows bucket means.
   */
  chartStats?: TelemetryStats
  /**
   * Present when any part of the range was served from daily rollups.
   * Daily granularity only: series/sessions/hourly are empty for that part.
   */
  rollup?: {
    /** Days served from frozen rollups. */
    days: number
    /** Closed days in the rollup part with neither rollup nor raw data. */
    missingDays: number
    /** Frozen IDM/DAM-priced cost of metered import over the rollup days (€). */
    dynamicCostEur: number | null
    /** Metered import energy over the rollup days (kWh) — flat = rate × this. */
    importKwh: number
    /** Import-weighted fraction of rollup-day energy with a real market price. */
    pricedFraction: number | null
    /** Rollup rows carrying the lossless tariff/sessions/series payload. */
    losslessDays?: number
    /** Legacy rows (import + energy cost only) — surfaced so the UI can flag them. */
    legacyDays?: number
  }
  /**
   * Per-day tariff detail for the rollup part — lets the tariff comparison
   * report price old days from frozen aggregates (flat = rate × importKwh,
   * dynamic = frozen dynamicCostEur) without 15-min re-slotting.
   */
  rollupDays?: {
    day: string
    importKwh: number
    dynamicCostEur: number | null
    pricedFraction: number | null
    idmFraction: number | null
    /**
     * Frozen tariff-engine scalars (grid-first counterfactual, wear bases,
     * throughput diagnostics). Present on rows frozen by the lossless rollup
     * (sep 2 2026); absent on legacy rows, which then only price import.
     */
    tariff?: RollupTariffFrozen
  }[]
  /**
   * Explicit MPC status for the report UI. When the engine could not produce a
   * result we surface WHY instead of silently falling back to a heuristic.
   */
  mpcStatus?: "ok" | "unavailable"
  /** Human-readable reason when mpcStatus === "unavailable". */
  mpcMessage?: string
  /**
   * The sub-window simply had NO telemetry (station not yet commissioned,
   * outage) — as opposed to the MPC failing on frames it did have. A
   * no-telemetry part never poisons a merged range that has data elsewhere
   * (a station commissioned mid-month kept reporting `no_data` for its whole
   * first month because the Berlin-local window head was empty).
   */
  noTelemetry?: boolean
}

// ── Rollup read path (ranges older than the raw retention window) ───────────

interface RollupPart {
  daily: DailySaving[]
  days: number
  missingDays: number
  importKwh: number
  evKwh: number
  mEv1Kwh: number
  mEv2Kwh: number
  auxKwh: number
  /** Σ batt_net_kwh over rows that carry it; null when none do (pre-2026-09-03.3 rows). */
  battNetKwh: number | null
  actualCostEur: number
  optimizedCostEur: number
  savingsEur: number
  dynamicCostEur: number | null
  pricedImportKwh: number
  frames: number
  batteryThroughputKwh: number
  batteryCycles: number
  durationHours: number
  tariffDays: NonNullable<RangeBacktestResult["rollupDays"]>
  /** Frozen per-day sessions (merged across midnight by the caller). */
  sessions: ChargerSession[]
  /** Frozen 15-min chart series, expanded and tagged `fromRollup`. */
  series: BacktestSeriesPoint[]
  /** Rows that carry the lossless `tariff` block vs legacy import-only rows. */
  losslessDays: number
  legacyDays: number
}

/**
 * Read frozen station_day_report rows for [fromDay, toDay] (UTC days,
 * inclusive) and reduce them to the DailySaving[] + totals the report UI
 * consumes. Since the lossless rollup (sep 2 2026) rows also carry the tariff
 * counterfactual, the day's sessions and a 15-min chart series, so a report
 * over rollups equals the raw replay instead of losing those parts.
 * `originMs` = report window start, so expanded chart points share the hour
 * axis with the raw-replayed segments.
 */
async function readRollupPart(stationId: string, fromDay: string, toDay: string, originMs: number): Promise<RollupPart> {
  const rows = await db
    .select()
    .from(stationDayReport)
    .where(and(eq(stationDayReport.stationId, stationId), gte(stationDayReport.day, fromDay), lte(stationDayReport.day, toDay)))
    .orderBy(stationDayReport.day)

  const part: RollupPart = {
    daily: [],
    days: rows.length,
    missingDays: 0,
    importKwh: 0,
    evKwh: 0,
    mEv1Kwh: 0,
    mEv2Kwh: 0,
    auxKwh: 0,
    battNetKwh: null,
    actualCostEur: 0,
    optimizedCostEur: 0,
    savingsEur: 0,
    dynamicCostEur: null,
    pricedImportKwh: 0,
    frames: 0,
    batteryThroughputKwh: 0,
    batteryCycles: 0,
    durationHours: 0,
    tariffDays: [],
    sessions: [],
    series: [],
    losslessDays: 0,
    legacyDays: 0,
  }

  // Battery net is a balance term (import = EV + AUX + battNet). A month is
  // only allowed to claim it when EVERY frozen day carries it — a partial sum
  // over the few re-frozen days of a month would read as a real figure
  // (Norderstedt Jul 2026: 2 of 31 days → "+2 kWh"). Otherwise NULL, shown "—".
  let battNetComplete = rows.length > 0
  for (const r of rows) {
    const detail = (r.detail ?? {}) as RollupDetail & { daily?: DailySaving | null }
    // Prefer the frozen DailySaving snapshot (exact UI shape); reconstruct
    // from columns when a row predates the detail field.
    part.daily.push(
      (detail.daily as DailySaving | null | undefined) ?? {
        bucketIso: r.day,
        actualCostEur: r.actualCostEur,
        optimizedCostEur: r.optimizedCostEur,
        savingsEur: r.savingsEur,
        savingsPct: r.actualCostEur !== 0 ? (r.savingsEur / Math.abs(r.actualCostEur)) * 100 : 0,
        evKwh: r.evKwh,
        frames: r.frames,
      },
    )
    part.importKwh += r.importKwh
    part.evKwh += r.evKwh
    part.mEv1Kwh += detail.totals?.mEv1Kwh ?? 0
    part.mEv2Kwh += detail.totals?.mEv2Kwh ?? 0
    part.auxKwh += r.auxKwh ?? detail.totals?.auxKwh ?? 0
    {
      const bn = r.battNetKwh ?? (detail.totals as { battNetKwh?: number | null } | undefined)?.battNetKwh ?? null
      if (bn == null) battNetComplete = false
      else part.battNetKwh = (part.battNetKwh ?? 0) + bn
    }
    part.actualCostEur += r.actualCostEur
    part.optimizedCostEur += r.optimizedCostEur
    part.savingsEur += r.savingsEur
    part.frames += r.frames
    part.batteryThroughputKwh += detail.kpis?.batteryThroughputKwh ?? 0
    part.batteryCycles += detail.kpis?.batteryCycles ?? 0
    part.durationHours += detail.kpis?.durationHours ?? 24
    if (r.dynamicCostEur != null) {
      part.dynamicCostEur = (part.dynamicCostEur ?? 0) + r.dynamicCostEur
      part.pricedImportKwh += (r.pricedFraction ?? 0) * r.importKwh
    }
    part.tariffDays.push({
      day: r.day,
      importKwh: r.importKwh,
      dynamicCostEur: r.dynamicCostEur,
      pricedFraction: r.pricedFraction,
      idmFraction: r.idmFraction,
      tariff: detail.tariff,
    })
    if (detail.tariff) part.losslessDays++
    else part.legacyDays++
    if (Array.isArray(detail.sessions)) part.sessions.push(...detail.sessions)
    if (detail.series15) part.series.push(...expandSeries15(detail.series15, originMs))
  }

  if (!battNetComplete) part.battNetKwh = null

  // Count calendar days in the window that have no rollup row (gap reporting).
  const spanDays = Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000) + 1
  part.missingDays = Math.max(0, spanDays - rows.length)
  return part
}

/** UTC "YYYY-MM-DD". */
function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Run the actual-vs-optimised backtest over an arbitrary date range using the
 * default (production) model version, WITHOUT persisting a run. Powers the
 * "Actual vs optimised" card on the Data Analytics report so it shares the
 * exact same Neon-backed engine as the Backtest Lab.
 *
 * RETENTION-AWARE: raw telemetry only lives RAW_RETENTION_DAYS (35). Ranges
 * reaching past that boundary are served from frozen daily rollups
 * (station_day_report) for the old part and stitched with the raw replay for
 * the recent part. Rollup parts are daily-granularity: no series/sessions.
 */
export async function runBacktestForRange(input: {
  fromIso: string
  toIso: string
  stationId?: string
  /**
   * CHART CONSUMERS ONLY (Dispatching History / Actual-vs-optimised card).
   * Trims the payload to what a chart needs: for windows > 3 days the series
   * is bucketed server-side to ≤ 2,000 points (lib/series-downsample, same
   * rules as the frozen 15-min rollup series) and the per-day tariff blocks /
   * hourly breakdown are dropped. Totals, KPIs and sessions are untouched.
   * NEVER set this for the tariff engine — it integrates the full series.
   */
  chartOnly?: boolean
}): Promise<RangeBacktestResult> {
  const result = await runBacktestForRangeFull(input)
  if (!input.chartOnly) return result

  // KPI stats at full resolution, BEFORE the chart series is bucketed.
  result.chartStats = telemetryStatsFromSeries(result.series)

  const windowMs = new Date(input.toIso).getTime() - new Date(input.fromIso).getTime()
  const stepMs = chartStepMs(windowMs)
  if (stepMs > 0 && result.series.length > 0) {
    const originMs = new Date(result.series[0].ts).getTime()
    const before = result.series.length
    result.series = downsampleSeries(result.series, stepMs, originMs)
    if (result.series.length < before) {
      result.seriesStepMs = stepMs
      // Downsampled ⇒ multi-day ⇒ the card breaks down by day, never by hour.
      delete result.hourly
    }
  }
  // Per-day frozen tariff blocks are for the Financial engine, not the chart.
  delete result.rollupDays
  return result
}

async function runBacktestForRangeFull(input: {
  fromIso: string
  toIso: string
  stationId?: string
}): Promise<RangeBacktestResult> {
  const stationId = input.stationId?.trim() || DEFAULT_STATION_ID

  // Resolve the production-default version. Kept inside try/catch so a transient
  // DB error degrades the report card to a clean empty state instead of bubbling
  // a raw SQL query dump up to the UI.
  let def: ModelVersionRow[]
  try {
    def = await db
      .select()
      .from(modelVersion)
      .orderBy(desc(modelVersion.isDefault), modelVersion.id)
      .limit(1)
  } catch {
    return { versionLabel: "—", kpis: emptyKpis(), series: [], sessions: [], totals: emptyTotals(), empty: true }
  }
  if (def.length === 0) {
    return {
      versionLabel: "—",
      kpis: emptyKpis(),
      series: [],
      sessions: [],
      totals: emptyTotals(),
      empty: true,
      mpcStatus: "unavailable",
      mpcMessage: "No production model version configured.",
    }
  }

  const params = def[0].params as KernelParams

  // Hard guard: the daily report must ONLY ever reflect the production v5 MPC.
  // If the resolved default model is somehow not an MPC engine (e.g. a v1–v3
  // heuristic was flagged default), refuse rather than silently render
  // heuristic numbers. The Backtest Lab stays free to run older engines for
  // comparison — this guard only protects the report surface.
  if (params.engine !== "v4-mpc") {
    return {
      versionLabel: def[0].label,
      kpis: emptyKpis(),
      series: [],
      sessions: [],
      totals: emptyTotals(),
      empty: true,
      mpcStatus: "unavailable",
      mpcMessage: `Default model "${def[0].label}" is not an MPC engine. The report only runs the production v5 MPC — set an MPC model as default.`,
    }
  }

  const fromTs = new Date(input.fromIso)
  const toTs = new Date(input.toIso)

  // Turn a finished chunk run into a result. A chunk that is exactly one FULL
  // closed UTC day is frozen IN MEMORY with the same `freezeDayFromRun` the
  // nightly rollup uses: its scalars ride in `rollupDays` and its (fine) chart
  // series is tagged `fromRollup` so the tariff engine plots it but takes the
  // totals from the frozen block. Hence: raw today == frozen tomorrow, exactly.
  // Partial chunks (window head/tail, the accruing day) stay series-integrated.
  const finishChunk = async (
    partFrom: Date,
    partTo: Date,
    frames: BacktestFrameRow[],
    result: Awaited<ReturnType<typeof runBacktest>>,
    source: "stored" | "live" | "hybrid",
  ): Promise<RangeBacktestResult> => {
    const MS_DAY = 86_400_000
    const fromMs = partFrom.getTime()
    const isFullClosedDay =
      fromMs % MS_DAY === 0 && partTo.getTime() === fromMs + MS_DAY - 1 && partTo.getTime() < Date.now()
    const out: RangeBacktestResult = {
      versionLabel: def[0].label,
      kpis: result.kpis,
      series: result.series,
      sessions: result.sessions,
      daily: result.daily,
      hourly: result.hourly,
      totals: result.totals,
      frameSource: source,
      mpcStatus: "ok",
    }
    if (!isFullClosedDay || result.kpis.frames === 0) return out
    try {
      const day = utcDay(partFrom)
      const frozen = await freezeDayFromRun({ day, frames, result, versionLabel: def[0].label, frameSource: source })
      for (const p of out.series) p.fromRollup = true
      out.rollupDays = [frozen.rollupDay]
    } catch (err) {
      console.log(`[v0] in-memory freeze failed for ${utcDay(partFrom)}: ${(err as Error)?.message ?? err}`)
    }
    return out
  }

  // Closed-chunk memo (lib/replay-memo): a chunk whose window is already in the
  // past has fixed inputs, so its finished replay is remembered in Redis keyed
  // by station + window + engine label + params fingerprint. This is what makes
  // the Berlin-local HEAD/TAIL of a report window (raw by construction, ~1.8 s
  // of LP for the 22-hour tail) cost one Redis read on every later load.
  const paramsHash = paramsFingerprint(params)
  const runRawChunk = async (partFrom: Date, partTo: Date): Promise<RangeBacktestResult> => {
    const key = isClosedChunk(partTo)
      ? memoKey({
          stationId,
          fromIso: partFrom.toISOString(),
          toIso: partTo.toISOString(),
          versionLabel: def[0].label,
          paramsHash,
        })
      : null
    if (key) {
      const hit = await readReplayMemo(key)
      if (hit) return hit
    }
    const out = await runRawChunkUncached(partFrom, partTo)
    if (key && isMemoisable(out)) await writeReplayMemo(key, out)
    return out
  }

  // Raw replay over a sub-window: stored frames first, live API fallback.
  // (Unchanged legacy behavior, just callable per-part for the hybrid path.)
  const runRawChunkUncached = async (partFrom: Date, partTo: Date): Promise<RangeBacktestResult> => {
    // A window that is still ACCRUING (its end is in the future — i.e. "today")
    // must come from the live API, never from stored frames. Stored frames for
    // an in-progress day are only ever a partial snapshot (e.g. a one-off
    // onboarding backfill), and the stored-first path would "succeed" on them
    // and freeze the Live Dispatching view at the backfill's end — stale SOC,
    // missing recent grid import — while the bird's-eye view (direct live
    // polling) keeps moving. Live-tested on Gifhorn (Aug 21 2026): DB frames
    // ended 07:55 UTC, chart pinned SOC at 50% while the pack was at 53%.
    const stillAccruing = partTo.getTime() > Date.now()
    try {
      if (stillAccruing) throw new Error("window still accruing — use live API")
      // STALE-TAIL GUARD (client report aug 25 2026): stored frames can end
      // days before partTo when the last manual backfill is old (Gifhorn: DB
      // ended Aug 21, "last 7 days" silently rendered only 19–21 Aug). The
      // stored-first path "succeeded" on that partial window. Detect a stored
      // tail gap > 1h and stitch LIVE API frames onto the stored ones so the
      // report always covers the requested range with the same engine.
      const stored = await loadFramesFromDb(stationId, partFrom, partTo)
      if (stored.length === 0) throw new Error("no stored frames — use live API")
      const lastStoredMs = new Date(stored[stored.length - 1].ts).getTime()
      const tailGapMs = partTo.getTime() - lastStoredMs
      let frames = stored
      let source: "stored" | "hybrid" = "stored"
      if (tailGapMs > 60 * 60 * 1000) {
        const liveTail = await loadLiveBacktestFrames({
          stationId,
          fromIso: new Date(lastStoredMs + 1).toISOString(),
          toIso: partTo.toISOString(),
        })
        if (liveTail.length > 0) {
          frames = [...stored, ...liveTail]
          source = "hybrid"
        }
      }
      const result = await runBacktest({ stationId, fromTs: partFrom, toTs: partTo, frames, paramOverride: params })
      return finishChunk(partFrom, partTo, frames, result, source)
    } catch (storedErr) {
      // No stored frames (e.g. a live "today"/recent day). Pull the window
      // straight from the Amperio API and run the SAME v5 MPC on the injected
      // frames so the report reflects the production optimizer everywhere —
      // never a client-side heuristic.
      try {
        const frames = await loadLiveBacktestFrames({
          stationId,
          fromIso: partFrom.toISOString(),
          toIso: partTo.toISOString(),
        })
        if (frames.length === 0) {
          return {
            versionLabel: def[0].label,
            kpis: emptyKpis(),
            series: [],
            sessions: [],
            totals: emptyTotals(),
            empty: true,
            frameSource: "live",
            mpcStatus: "unavailable",
            mpcMessage: "No telemetry available from the API for this range yet.",
            noTelemetry: true,
          }
        }
        const result = await runBacktest({ stationId, fromTs: partFrom, toTs: partTo, frames, paramOverride: params })
        return finishChunk(partFrom, partTo, frames, result, "live")
      } catch (liveErr) {
        return {
          versionLabel: def[0].label,
          kpis: emptyKpis(),
          series: [],
          sessions: [],
          totals: emptyTotals(),
          empty: true,
          frameSource: "live",
          mpcStatus: "unavailable",
          mpcMessage:
            liveErr instanceof Error
              ? liveErr.message
              : storedErr instanceof Error
                ? storedErr.message
                : "MPC could not run for this range.",
        }
      }
    }
  }

  // Merge independently replayed parts (raw chunks and/or a rollup base) into
  // one result: sums for kpis/totals, one sorted series on a shared hour axis,
  // sessions merged across midnight, MPC unavailability surfaced not hidden.
  const mergeParts = (base: RangeBacktestResult, parts: RangeBacktestResult[]): RangeBacktestResult => {
    const merged: RangeBacktestResult = {
      ...base,
      series: [...base.series],
      sessions: [...base.sessions],
      daily: [...(base.daily ?? [])],
      hourly: [...(base.hourly ?? [])],
      kpis: { ...base.kpis },
      totals: { ...base.totals },
      rollupDays: [...(base.rollupDays ?? [])],
    }
    if (base.noTelemetry) {
      // The first chunk (window head) had no frames — start neutral and let
      // the other parts decide; re-applied below if the whole range is empty.
      merged.mpcStatus = undefined
      merged.mpcMessage = undefined
      merged.noTelemetry = undefined
      // No frames ⇒ no battery flow: a neutral 0, not an "unknown" NULL that
      // would veto the battery-net figure of the parts that do have data.
      merged.totals.battNetKwh = 0
    }
    let anyNonEmpty = base.empty !== true && (base.daily?.length ?? 0) > 0
    // A part with NO telemetry at all (pre-commissioning head, outage) is
    // neutral: it neither poisons mpcStatus nor counts as data. Only if the
    // whole range is empty does its message surface.
    let noTelemetryMessage: string | undefined
    for (const rp of parts) {
      if (rp.noTelemetry) {
        noTelemetryMessage ??= rp.mpcMessage
        continue
      }
      merged.series.push(...rp.series)
      merged.sessions.push(...rp.sessions)
      merged.daily!.push(...(rp.daily ?? []))
      merged.hourly!.push(...(rp.hourly ?? []))
      if (rp.rollupDays) merged.rollupDays!.push(...rp.rollupDays)
      if (rp.empty !== true) anyNonEmpty = true
      merged.kpis = {
        ...rp.kpis,
        frames: merged.kpis.frames + rp.kpis.frames,
        durationHours: merged.kpis.durationHours + rp.kpis.durationHours,
        actualCostEur: merged.kpis.actualCostEur + rp.kpis.actualCostEur,
        optimizedCostEur: merged.kpis.optimizedCostEur + rp.kpis.optimizedCostEur,
        savingsEur: merged.kpis.savingsEur + rp.kpis.savingsEur,
        savingsPct: 0,
        batteryThroughputKwh: merged.kpis.batteryThroughputKwh + rp.kpis.batteryThroughputKwh,
        batteryCycles: merged.kpis.batteryCycles + rp.kpis.batteryCycles,
      }
      merged.totals = {
        ...rp.totals,
        actualImportKwh: merged.totals.actualImportKwh + rp.totals.actualImportKwh,
        optimizedImportKwh: merged.totals.optimizedImportKwh + rp.totals.optimizedImportKwh,
        evKwh: merged.totals.evKwh + rp.totals.evKwh,
        mEv1Kwh: (merged.totals.mEv1Kwh ?? 0) + (rp.totals.mEv1Kwh ?? 0),
        mEv2Kwh: (merged.totals.mEv2Kwh ?? 0) + (rp.totals.mEv2Kwh ?? 0),
        auxKwh: (merged.totals.auxKwh ?? 0) + (rp.totals.auxKwh ?? 0),
        // NULL-propagating: the window may claim a battery-net figure (and
        // thereby import = EV + AUX + battNet) only when EVERY segment
        // carries one. A segment on the old method (pre-2026-09-03.3 rollup
        // or a stale memo) poisons the sum to NULL rather than a partial.
        battNetKwh:
          merged.totals.battNetKwh == null || rp.totals.battNetKwh == null
            ? null
            : merged.totals.battNetKwh + rp.totals.battNetKwh,
        // Raw-segment meter legs simply add (rollup parts carry none here).
        battChargeKwh: (merged.totals.battChargeKwh ?? 0) + (rp.totals.battChargeKwh ?? 0),
        battDischargeKwh: (merged.totals.battDischargeKwh ?? 0) + (rp.totals.battDischargeKwh ?? 0),
      }
      if (rp.mpcStatus === "unavailable") {
        merged.mpcStatus = "unavailable"
        merged.mpcMessage = rp.mpcMessage
      } else if (merged.mpcStatus !== "unavailable") {
        merged.mpcStatus = "ok"
      }
      if (rp.frameSource && rp.frameSource !== merged.frameSource) {
        merged.frameSource = merged.frameSource ? "hybrid" : rp.frameSource
      }
    }
    merged.kpis.savingsPct =
      merged.kpis.actualCostEur !== 0 ? (merged.kpis.savingsEur / Math.abs(merged.kpis.actualCostEur)) * 100 : 0
    merged.empty = !anyNonEmpty && merged.kpis.frames === 0
    if (merged.empty && merged.mpcStatus !== "unavailable" && (noTelemetryMessage || base.noTelemetry)) {
      merged.mpcStatus = "unavailable"
      merged.mpcMessage = noTelemetryMessage ?? base.mpcMessage
      merged.noTelemetry = true
    }
    merged.series.sort((a, b) => a.ts.localeCompare(b.ts))
    if (merged.series.length > 0) {
      const originMs = new Date(merged.series[0].ts).getTime()
      for (const p of merged.series) p.hour = (new Date(p.ts).getTime() - originMs) / 3_600_000
    }
    merged.sessions = mergeSessions(merged.sessions)
    merged.daily!.sort((a, b) => a.bucketIso.localeCompare(b.bucketIso))
    merged.hourly!.sort((a, b) => a.bucketIso.localeCompare(b.bucketIso))
    merged.rollupDays!.sort((a, b) => a.day.localeCompare(b.day))
    if (merged.rollupDays!.length === 0) delete merged.rollupDays
    return merged
  }

  // ── DAY = ATOMIC REPLAY UNIT (sep 2 2026) ────────────────────────────────
  // Raw ranges are replayed one UTC day at a time — exactly how the nightly
  // rollup freezes them — and each day's first point is tagged `segStart` so
  // the tariff engine trues-up its baseline per day. Result: a day shows the
  // same numbers whether it is replayed raw today or served frozen tomorrow,
  // and the same on every page that covers it. Partial head/tail days are
  // replayed as their own (shorter) segments.
  //
  // DEGENERATE CHUNKS: a window whose end falls EXACTLY on a UTC midnight
  // (every UTC-zone browser, the Lab's `${day}T00:00:00Z` anchors) used to
  // produce a trailing [midnight, midnight] chunk. It has no stored frames, so
  // it fell through to the live API, which rejects an empty range, and that
  // error was merged as "unavailable" over an otherwise complete result ("No
  // telemetry for this range · Invalid live-frame range"). Anything shorter
  // than a second is dropped — with 1-min frames it can hold no data, and the
  // instant at midnight belongs to the NEXT day anyway. Live-tested Sep 2 2026.
  const MIN_RAW_PART_MS = 1000
  const runRawPart = async (partFrom: Date, partTo: Date): Promise<RangeBacktestResult> => {
    const MS_DAY = 86_400_000
    const chunks: [Date, Date][] = []
    let cur = partFrom.getTime()
    const end = partTo.getTime()
    while (cur <= end) {
      const nextMidnight = (Math.floor(cur / MS_DAY) + 1) * MS_DAY
      const chunkEnd = Math.min(end, nextMidnight - 1)
      if (chunkEnd - cur >= MIN_RAW_PART_MS) chunks.push([new Date(cur), new Date(chunkEnd)])
      cur = chunkEnd + 1
    }
    if (chunks.length === 0) {
      // Whole part is degenerate — neutral "no telemetry" so mergeParts ignores it.
      return {
        versionLabel: def[0].label,
        kpis: emptyKpis(),
        series: [],
        sessions: [],
        totals: emptyTotals(),
        empty: true,
        frameSource: "stored",
        mpcStatus: "unavailable",
        mpcMessage: "Empty window.",
        noTelemetry: true,
      }
    }
    if (chunks.length === 1) {
      const single = await runRawChunk(chunks[0][0], chunks[0][1])
      if (single.series.length > 0) single.series[0].segStart = true
      return single
    }
    const results: RangeBacktestResult[] = []
    for (const [a, b] of chunks) {
      const r = await runRawChunk(a, b)
      if (r.series.length > 0) r.series[0].segStart = true
      results.push(r)
    }
    const [first, ...rest] = results
    return mergeParts(first, rest)
  }

  // Convert a RollupPart into the report result shape (daily-only granularity).
  const rollupToResult = (part: RollupPart, source: "rollup" | "hybrid"): RangeBacktestResult => {
    const kpis = emptyKpis()
    kpis.frames = part.frames
    kpis.durationHours = part.durationHours
    kpis.actualCostEur = part.actualCostEur
    kpis.optimizedCostEur = part.optimizedCostEur
    kpis.savingsEur = part.savingsEur
    kpis.savingsPct = part.actualCostEur !== 0 ? (part.savingsEur / Math.abs(part.actualCostEur)) * 100 : 0
    kpis.batteryThroughputKwh = part.batteryThroughputKwh
    kpis.batteryCycles = part.batteryCycles
    const totals = emptyTotals()
    totals.actualImportKwh = part.importKwh
    totals.optimizedImportKwh = part.importKwh
    totals.evKwh = part.evKwh
    totals.mEv1Kwh = part.mEv1Kwh
    totals.mEv2Kwh = part.mEv2Kwh
    totals.auxKwh = part.auxKwh
    totals.battNetKwh = part.battNetKwh
    return {
      versionLabel: def[0].label,
      kpis,
      series: [],
      sessions: [],
      daily: part.daily,
      totals,
      empty: part.daily.length === 0,
      frameSource: source,
      mpcStatus: "ok",
      rollup: {
        days: part.days,
        missingDays: part.missingDays,
        dynamicCostEur: part.dynamicCostEur,
        importKwh: part.importKwh,
        pricedFraction: part.importKwh > 0 ? part.pricedImportKwh / part.importKwh : null,
      },
      rollupDays: part.tariffDays,
    }
  }

  // ── Rollup-first range split ────────────────────────────────────────────
  // PERFORMANCE (client report sep 1 2026: monthly financial report crawled):
  // the nightly rollup cron freezes EVERY closed day into station_day_report,
  // but this read path only consumed rollups past the 35-day retention
  // boundary — so a recent month replayed ~170k raw frames through the MPC on
  // every report load. Serve rollups for ALL closed days that have a frozen
  // row; raw-replay only the tail (today + any trailing days not yet rolled).
  // The retention boundary remains the fallback when no rollups exist at all.
  //
  // EXACT WINDOW EDGES (Gronau defect report, sep 2 2026): rollups are UTC
  // days, but report windows are Berlin-local (a month starts Jul 31 22:00Z).
  // Only UTC days that lie ENTIRELY inside [fromTs, toTs] may come from
  // rollups; the partial head day (22:00Z→midnight) and the partial tail day
  // are raw-replayed, so rollup-served == raw-replayed for the same window.
  // Previously the head day's rollup was taken WHOLE (22 h overshoot) and the
  // 2 h head itself was skipped — one of the "numbers differ per page" roots.
  const MS_DAY = 86_400_000
  const fromMs = fromTs.getTime()
  const toMs = toTs.getTime()
  const firstFullDayMs = fromMs % MS_DAY === 0 ? fromMs : (Math.floor(fromMs / MS_DAY) + 1) * MS_DAY
  const lastFullDayMs = Math.floor((toMs + 1) / MS_DAY) * MS_DAY - MS_DAY
  const firstFullDay = utcDay(new Date(firstFullDayMs))
  const lastFullDay = utcDay(new Date(lastFullDayMs))

  const boundaryTs = new Date(Date.now() - RAW_RETENTION_DAYS * 24 * 3600 * 1000)
  let boundaryDay = utcDay(boundaryTs) // first day considered "raw" (fallback)

  const todayDay = utcDay(new Date())
  const lastClosedDay =
    lastFullDay < todayDay ? lastFullDay : utcDay(new Date(Date.now() - MS_DAY))
  if (lastFullDayMs >= firstFullDayMs && firstFullDay <= lastClosedDay) {
    try {
      const rolled = await db
        .select({ last: sql<string | null>`max(${stationDayReport.day})` })
        .from(stationDayReport)
        .where(
          and(
            eq(stationDayReport.stationId, stationId),
            gte(stationDayReport.day, firstFullDay),
            lte(stationDayReport.day, lastClosedDay),
          ),
        )
      const lastRolled = rolled[0]?.last ?? null
      if (lastRolled && lastRolled >= boundaryDay) {
        // First raw day = the day AFTER the newest frozen rollup in range.
        boundaryDay = utcDay(new Date(Date.parse(`${lastRolled}T00:00:00Z`) + MS_DAY))
      }
    } catch {
      // Rollup probe failure → keep the retention-boundary behavior.
    }
  }

  const rollupFromDay = firstFullDay
  const rollupToDay = lastFullDay < boundaryDay ? lastFullDay : utcDay(new Date(Date.parse(`${boundaryDay}T00:00:00Z`) - MS_DAY))

  if (lastFullDayMs >= firstFullDayMs && rollupFromDay <= rollupToDay && firstFullDay < boundaryDay) {
    const part = await readRollupPart(stationId, rollupFromDay, rollupToDay, fromMs)

    // Migration grace: while raw frames older than the boundary still exist
    // (rollups not yet backfilled), keep serving them the legacy way rather
    // than degrading to an empty rollup result.
    if (part.days === 0) {
      return runRawPart(fromTs, toTs)
    }

    // Raw HEAD (window start → first full day) and raw TAIL (day after the
    // last rollup → window end). Either may be empty.
    const rollupStartMs = Date.parse(`${rollupFromDay}T00:00:00.000Z`)
    const rollupEndMs = Date.parse(`${rollupToDay}T00:00:00.000Z`) + MS_DAY // exclusive
    // HEAD and TAIL are independent (different days) — replay them concurrently
    // so their frame reads / memo lookups overlap. Order is kept (head, tail).
    //
    // Sub-second head/tail parts are degenerate (see MIN_RAW_PART_MS above): a
    // window ending EXACTLY at UTC midnight used to yield a zero-length TAIL
    // whose live-API error was merged OVER a full day of valid rollup data.
    const rawJobs: Promise<RangeBacktestResult>[] = []
    if (rollupStartMs - fromMs >= MIN_RAW_PART_MS) rawJobs.push(runRawPart(fromTs, new Date(rollupStartMs - 1)))
    if (toMs - rollupEndMs >= MIN_RAW_PART_MS) rawJobs.push(runRawPart(new Date(rollupEndMs), toTs))
    const rawParts = await Promise.all(rawJobs)

    const source: "rollup" | "hybrid" = rawParts.length === 0 ? "rollup" : "hybrid"
    const base = rollupToResult(part, source)
    base.series = [...part.series]
    base.sessions = [...part.sessions]
    base.daily = [...part.daily]
    base.hourly = []
    base.frameSource = source
    const merged = mergeParts(base, rawParts)
    merged.frameSource = source
    if (merged.rollup) {
      merged.rollup.losslessDays = part.losslessDays
      merged.rollup.legacyDays = part.legacyDays
    }
    return merged
  }

  // Entire range inside the raw window → unchanged legacy path.
  return runRawPart(fromTs, toTs)
}

function emptyTotals() {
  return {
    actualImportKwh: 0,
    optimizedImportKwh: 0,
    evKwh: 0,
    mEv1Kwh: 0,
    mEv2Kwh: 0,
    auxKwh: 0,
    battNetKwh: null as number | null,
    evUnservedKwh: 0,
    ev1AcceptableKwh: null,
    ev2AcceptableKwh: null,
    ev1ServedKwh: null,
    ev2ServedKwh: null,
    ev1HeadroomKwh: null,
    ev2HeadroomKwh: null,
  }
}

function emptyKpis(): BacktestKpis {
  return {
    frames: 0,
    durationHours: 0,
    optimizedCostEur: 0,
    actualCostEur: 0,
    savingsEur: 0,
    savingsPct: 0,
    batteryThroughputKwh: 0,
    batteryCycles: 0,
    exportViolations: 0,
    observedExportFrames: 0,
    socMinPct: 0,
    socAvgPct: 0,
    socMaxPct: 0,
    emergencyTicks: 0,
    engine: "v4-mpc",
  }
}

/** Result of a walk-forward engine-sim replay (the Backtesting harness). */
export interface EngineSimResult extends RangeBacktestResult {
  /** Per-slot production-engine command trace (the audit log). */
  commandTrace?: EngineCommandTraceEntry[]
  /** The demand-scale lever that was applied (1 = history as-is). */
  demandScaleProxy: number
}

/**
 * Walk-forward SIMULATION replay for the Backtesting harness. Unlike
 * runBacktestForRange (which replays the inline LP for the Data Analysis card),
 * this drives the PRODUCTION decision core (decideDispatch -> planHorizon) over
 * the window in a closed loop: only exogenous inputs (prices, the editable EV
 * demand proxy, baseload, starting SoC) come from history, and grid import /
 * SoC / served-EV are computed by the shared BMS physics assuming OUR dispatch
 * drives the post. Returns the same series/KPI shape as the Data Analysis card
 * (so the timeline + KPI components are reused) plus the engine command trace.
 * Not persisted -- this is a test surface.
 */
export async function runEngineSimReplay(input: {
  fromIso: string
  toIso: string
  stationId?: string
  /** Editable demand lever; scales the reconstructed historical EV proxy. */
  demandScaleProxy?: number
}): Promise<EngineSimResult> {
  const stationId = input.stationId?.trim() || DEFAULT_STATION_ID
  const demandScaleProxy =
    Number.isFinite(input.demandScaleProxy) && (input.demandScaleProxy as number) >= 0
      ? (input.demandScaleProxy as number)
      : 1

  // The engine sim always runs the production v5 MPC core directly -- it does not
  // depend on a model-version row (decideDispatch uses live defaults), so there
  // is no engine guard here. We still resolve the default label for display.
  let versionLabel = "v5 MPC (production engine)"
  try {
    const def = await db
      .select()
      .from(modelVersion)
      .orderBy(desc(modelVersion.isDefault), modelVersion.id)
      .limit(1)
    if (def.length > 0) versionLabel = `${def[0].label} · engine`
  } catch {
    // Non-fatal: label is cosmetic.
  }

  const fromTs = new Date(input.fromIso)
  const toTs = new Date(input.toIso)

  const emptyShape = (extra: Partial<EngineSimResult> = {}): EngineSimResult => ({
    versionLabel,
    kpis: emptyKpis(),
    series: [],
    sessions: [],
    totals: emptyTotals(),
    empty: true,
    demandScaleProxy,
    ...extra,
  })

  // 1) Prefer Neon-stored frames (fastest, Backtest-Lab parity) — but guard
  //    against a STALE TAIL (stored frames ending days before toTs because the
  //    last manual backfill is old). Same stitch as runBacktestForRange.
  try {
    const stored = await loadFramesFromDb(stationId, fromTs, toTs)
    if (stored.length === 0) throw new Error("no stored frames — use live API")
    const lastStoredMs = new Date(stored[stored.length - 1].ts).getTime()
    let frames = stored
    let source: "stored" | "hybrid" = "stored"
    if (toTs.getTime() - lastStoredMs > 60 * 60 * 1000) {
      const liveTail = await loadLiveBacktestFrames({
        stationId,
        fromIso: new Date(lastStoredMs + 1).toISOString(),
        toIso: toTs.toISOString(),
      })
      if (liveTail.length > 0) {
        frames = [...stored, ...liveTail]
        source = "hybrid"
      }
    }
    const result = await runBacktest({
      stationId,
      fromTs,
      toTs,
      frames,
      decisionSource: "engine",
      demandScaleProxy,
    })
    return {
      versionLabel,
      kpis: result.kpis,
      series: result.series,
      sessions: result.sessions,
      daily: result.daily,
      hourly: result.hourly,
      totals: result.totals,
      commandTrace: result.commandTrace,
      demandScaleProxy,
      frameSource: source,
      mpcStatus: "ok",
    }
  } catch (storedErr) {
    // 2) No stored frames (e.g. a recent/live day): pull from the Amperio API
    //    and run the SAME engine path on the injected frames.
    try {
      const frames = await loadLiveBacktestFrames({
        stationId,
        fromIso: input.fromIso,
        toIso: input.toIso,
      })
      if (frames.length === 0) {
        return emptyShape({
          frameSource: "live",
          mpcStatus: "unavailable",
          mpcMessage: "No telemetry available from the API for this range yet.",
        })
      }
      const result = await runBacktest({
        stationId,
        fromTs,
        toTs,
        frames,
        decisionSource: "engine",
        demandScaleProxy,
      })
      return {
        versionLabel,
        kpis: result.kpis,
        series: result.series,
        sessions: result.sessions,
        daily: result.daily,
        hourly: result.hourly,
        totals: result.totals,
        commandTrace: result.commandTrace,
        demandScaleProxy,
        frameSource: "live",
        mpcStatus: "ok",
      }
    } catch (liveErr) {
      return emptyShape({
        frameSource: "live",
        mpcStatus: "unavailable",
        mpcMessage:
          liveErr instanceof Error
            ? liveErr.message
            : storedErr instanceof Error
              ? storedErr.message
              : "Engine sim could not run for this range.",
      })
    }
  }
}
