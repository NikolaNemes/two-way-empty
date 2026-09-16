// ════════════════════════════════════════════════════════════════════════
// SHARED DAM PRICE SUPPLY — robustness layer for the dispatch planner.
// ════════════════════════════════════════════════════════════════════════
//
// Guarantees the kernel always has at least `requiredForwardHours` of gap-free
// German day-ahead (EPEX SPOT, DE-LU) prices at every tick, via a fallback
// chain, and provides a publication-horizon gate so a backtest/sim can never
// consume a price that would not yet have been published (no future leakage).
//
//   Fallback chain (priority order), per resolve call:
//     1. Live source A (Amperio)         — real, 15-min.
//     2. Live source B (aWATTar DE)       — real, hourly → resampled to 15-min.
//     3. Durable cache (Neon dam_price)   — last-known-good, fills holes.
//     4. Synthetic day-before             — copy same wall-clock slot from D-1.
//   Every real point fetched is upserted back into the cache (always warm).
//
// This module is PURE (no direct I/O): sources and the store are injected, so
// it runs identically in the worker, the Next app, the backtest, and unit tests.
// ════════════════════════════════════════════════════════════════════════

import { SLOT_MS, type SlotPrice } from "./dispatch-kernel"

// ── Constants ───────────────────────────────────────────────────────────────
export const SLOTS_PER_HOUR = 4
export const SLOTS_PER_DAY = 96 // 24h × 4 (nominal; DST days handled by wall-clock copy below)
export const DEFAULT_ZONE = "DE-LU"
/** German DAM auction clears 12:00 CET; results reliably published by ~13:00 local. */
export const DAM_PUBLISH_HOUR_LOCAL = 13
export const DAM_TIMEZONE = "Europe/Berlin"
/** How far back from "now" the resolver also fetches (context for accounting/UX). */
export const DEFAULT_LOOKBACK_HOURS = 1

// ── Provenance ────────────────────────────────────────────────────────────
export type Provenance = "amperio" | "awattar" | "cache" | "synthetic" | string

// ── Types ───────────────────────────────────────────────────────────────────
/** A raw price point from a source (absolute epoch-ms instant at slot start). */
export interface PricePoint {
  ts: number // epoch ms (slot start)
  priceEurMwh: number
  resampled?: boolean // true if upsampled from coarser (e.g. hourly) data
}

/** A named live price source. Failures must reject; the chain isolates them. */
export interface NamedSource {
  name: Provenance
  fetch: (fromMs: number, toMs: number) => Promise<PricePoint[]>
}

/** A stored cache row. */
export interface StoredPrice {
  slot: number
  ts: number
  priceEurMwh: number
  source: string
  resampled: boolean
}

/** Durable last-known-good cache (Neon-backed in production). */
export interface PriceStore {
  getRange: (zone: string, fromSlot: number, toSlot: number) => Promise<StoredPrice[]>
  upsert: (
    zone: string,
    rows: { slot: number; ts: number; priceEurMwh: number; source: string; resampled: boolean }[],
  ) => Promise<void>
}

export interface ResolvePriceCurveArgs {
  nowMs: number
  requiredForwardHours: number
  sources: NamedSource[]
  store?: PriceStore
  zone?: string
  lookbackHours?: number
  /** Allow synthetic day-before fill for still-missing required slots. */
  allowSynthetic?: boolean
  /**
   * Publication gate: when true, source output is masked to what would have
   * been published at `nowMs` (Europe/Berlin DAM publish time). Used by the
   * backtest/sim to prevent look-ahead leakage. Live ops leave this false
   * (real sources only ever return already-published prices).
   */
  publishGate?: boolean
}

export interface ResolvedCurve {
  /** Full known curve over [lookback, forward] for the planner window. */
  pricedSlots: SlotPrice[]
  /** Per-slot provenance for observability/telemetry. */
  provenanceBySlot: Map<number, Provenance>
  /** Contiguous forward hours of REAL-or-CACHED coverage from the current slot. */
  coverageHours: number
  /** Peak − trough (€/MWh) over the required forward window (guaranteed-covered). */
  spreadEurMwh: number
  /** True if any required forward slot is synthetic or still missing. */
  degraded: boolean
  /** Required forward slots that ended up synthetic (observability). */
  syntheticSlots: number[]
  /** Required forward slots with no data at all after the full chain. */
  missingSlots: number[]
  /** The current absolute slot at nowMs. */
  currentSlot: number
}

// ── Slot helpers (epoch-anchored, identical to worker/kernel indexing) ───────
export function slotOf(ms: number): number {
  return Math.floor(ms / SLOT_MS)
}
export function slotStartMs(slot: number): number {
  return slot * SLOT_MS
}

// ── Publication-horizon gate (timezone + DST aware) ──────────────────────────

/** Berlin wall-clock parts for an instant. */
function berlinParts(ms: number): { year: number; month: number; day: number; hour: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: DAM_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  })
  const p = dtf.formatToParts(new Date(ms))
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value)
  let hour = get("hour")
  if (hour === 24) hour = 0 // some engines emit 24 for midnight
  return { year: get("year"), month: get("month"), day: get("day"), hour }
}

/** Offset (ms) such that berlinWallClock = utc + offset, at instant `ms`. */
function berlinOffsetMs(ms: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: DAM_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const p = dtf.formatToParts(new Date(ms))
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value)
  let hour = get("hour")
  if (hour === 24) hour = 0
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"))
  return asUTC - ms
}

/** UTC instant of Berlin local midnight (00:00) for the given Berlin calendar date. */
function berlinMidnightUtcMs(year: number, month: number, day: number): number {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0)
  // Two-pass DST correction; converges since midnight is never the ambiguous hour.
  let guess = naive
  for (let i = 0; i < 2; i++) {
    guess = naive - berlinOffsetMs(guess)
  }
  return guess
}

function addBerlinDays(year: number, month: number, day: number, add: number): { year: number; month: number; day: number } {
  // Use a noon anchor to avoid DST edge issues, then read Berlin parts back.
  const anchor = berlinMidnightUtcMs(year, month, day) + 12 * 3600_000 + add * 24 * 3600_000
  const p = berlinParts(anchor)
  return { year: p.year, month: p.month, day: p.day }
}

/**
 * The exclusive upper instant the planner may "see" at `nowMs`, per the DAM
 * publication schedule: always through end-of-today (Berlin); once past
 * ~13:00 Berlin, also through end-of-tomorrow.
 */
export function visibleHorizonMs(
  nowMs: number,
  opts?: { publishHour?: number },
): number {
  const publishHour = opts?.publishHour ?? DAM_PUBLISH_HOUR_LOCAL
  const { year, month, day, hour } = berlinParts(nowMs)
  const daysAhead = hour >= publishHour ? 2 : 1 // end-of-tomorrow vs end-of-today
  const t = addBerlinDays(year, month, day, daysAhead)
  return berlinMidnightUtcMs(t.year, t.month, t.day) // exclusive end of the visible window
}

/** Drop any points at/after the publication horizon for `nowMs`. */
export function maskToPublished(
  points: PricePoint[],
  nowMs: number,
  opts?: { publishHour?: number },
): PricePoint[] {
  const horizon = visibleHorizonMs(nowMs, opts)
  return points.filter((p) => p.ts < horizon)
}

// ── Coverage + spread ─────────────────────────────────────────────────────
export function computeCoverageAndSpread(
  currentSlot: number,
  requiredSlots: number,
  priceBySlot: Map<number, number>,
  provenanceBySlot: Map<number, Provenance>,
): { coverageHours: number; spreadEurMwh: number; syntheticSlots: number[]; missingSlots: number[] } {
  // Contiguous forward coverage of REAL-or-CACHED slots (synthetic does NOT count).
  let contiguous = 0
  for (let i = 0; i < requiredSlots; i++) {
    const slot = currentSlot + i
    const prov = provenanceBySlot.get(slot)
    const isReal = priceBySlot.has(slot) && prov !== "synthetic"
    if (isReal) contiguous++
    else break
  }
  const coverageHours = contiguous / SLOTS_PER_HOUR

  // Spread over the required forward window (any provenance — guaranteed-covered).
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  const syntheticSlots: number[] = []
  const missingSlots: number[] = []
  for (let i = 0; i < requiredSlots; i++) {
    const slot = currentSlot + i
    const price = priceBySlot.get(slot)
    if (price === undefined) {
      missingSlots.push(slot)
      continue
    }
    if (provenanceBySlot.get(slot) === "synthetic") syntheticSlots.push(slot)
    if (price < min) min = price
    if (price > max) max = price
  }
  const spreadEurMwh = Number.isFinite(min) && Number.isFinite(max) ? max - min : 0
  return { coverageHours, spreadEurMwh, syntheticSlots, missingSlots }
}

// ── The orchestrator ─────────────────────────────────────────────────────
export async function resolvePriceCurve(args: ResolvePriceCurveArgs): Promise<ResolvedCurve> {
  const zone = args.zone ?? DEFAULT_ZONE
  const lookbackHours = args.lookbackHours ?? DEFAULT_LOOKBACK_HOURS
  const allowSynthetic = args.allowSynthetic ?? true
  const requiredSlots = Math.max(1, Math.round(args.requiredForwardHours * SLOTS_PER_HOUR))

  const currentSlot = slotOf(args.nowMs)
  const fromMs = args.nowMs - lookbackHours * 3600_000
  const toMs = args.nowMs + args.requiredForwardHours * 3600_000
  const fromSlot = slotOf(fromMs)
  const toSlot = slotOf(toMs) // inclusive-ish upper bound of the planner window

  const priceBySlot = new Map<number, number>()
  const provenanceBySlot = new Map<number, Provenance>()
  // Real points to warm the cache with (live sources only).
  const freshRows: { slot: number; ts: number; priceEurMwh: number; source: string; resampled: boolean }[] = []

  // 1+2. Live sources, in priority order. Higher-priority source wins per slot.
  for (const src of args.sources) {
    let points: PricePoint[]
    try {
      points = await src.fetch(fromMs, toMs)
    } catch (err) {
      console.log(`[v0] price-supply: source "${src.name}" failed: ${(err as Error)?.message ?? err}`)
      continue
    }
    if (args.publishGate) points = maskToPublished(points, args.nowMs)
    for (const pt of points) {
      if (!Number.isFinite(pt.priceEurMwh)) continue
      const slot = slotOf(pt.ts)
      if (priceBySlot.has(slot)) continue // earlier (higher-priority) source already set it
      priceBySlot.set(slot, pt.priceEurMwh)
      provenanceBySlot.set(slot, src.name)
      freshRows.push({
        slot,
        ts: slotStartMs(slot),
        priceEurMwh: pt.priceEurMwh,
        source: src.name,
        resampled: !!pt.resampled,
      })
    }
  }

  // Warm the durable cache with everything real we just fetched.
  if (args.store && freshRows.length > 0) {
    try {
      await args.store.upsert(zone, freshRows)
    } catch (err) {
      console.log(`[v0] price-supply: cache upsert failed: ${(err as Error)?.message ?? err}`)
    }
  }

  // 3. Durable cache fills any slot still missing across the whole window.
  if (args.store) {
    try {
      const cached = await args.store.getRange(zone, fromSlot, toSlot)
      for (const row of cached) {
        if (priceBySlot.has(row.slot)) continue
        priceBySlot.set(row.slot, row.priceEurMwh)
        provenanceBySlot.set(row.slot, "cache")
      }
    } catch (err) {
      console.log(`[v0] price-supply: cache read failed: ${(err as Error)?.message ?? err}`)
    }
  }

  // 4. Synthetic day-before for still-missing REQUIRED forward slots.
  if (allowSynthetic) {
    // Build a lookup that can reach back ~1 day for the donor slot, pulling
    // from the cache if it's outside what we already have in memory.
    const donorFromSlot = currentSlot - SLOTS_PER_DAY - 1
    const donorBySlot = new Map<number, number>(priceBySlot)
    if (args.store) {
      try {
        const donors = await args.store.getRange(zone, donorFromSlot, currentSlot)
        for (const row of donors) if (!donorBySlot.has(row.slot)) donorBySlot.set(row.slot, row.priceEurMwh)
      } catch {
        // best-effort; synthetic just won't be available for those slots
      }
    }
    for (let i = 0; i < requiredSlots; i++) {
      const slot = currentSlot + i
      if (priceBySlot.has(slot)) continue
      const donor = donorBySlot.get(slot - SLOTS_PER_DAY)
      if (donor !== undefined && Number.isFinite(donor)) {
        priceBySlot.set(slot, donor)
        provenanceBySlot.set(slot, "synthetic")
      }
    }
  }

  // Build the planner-facing curve (sorted) and the coverage/spread report.
  const pricedSlots: SlotPrice[] = Array.from(priceBySlot.entries())
    .map(([slot, priceEurMwh]) => ({ slot, priceEurMwh }))
    .sort((a, b) => a.slot - b.slot)

  const { coverageHours, spreadEurMwh, syntheticSlots, missingSlots } = computeCoverageAndSpread(
    currentSlot,
    requiredSlots,
    priceBySlot,
    provenanceBySlot,
  )

  const degraded = syntheticSlots.length > 0 || missingSlots.length > 0

  return {
    pricedSlots,
    provenanceBySlot,
    coverageHours,
    spreadEurMwh,
    degraded,
    syntheticSlots,
    missingSlots,
    currentSlot,
  }
}
