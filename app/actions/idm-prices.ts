"use server"

import { SLOT_MS } from "@/lib/dispatch-kernel"
import { DEFAULT_ZONE, slotOf, slotStartMs, type PricePoint } from "@/lib/price-supply"
import { defaultIdmSources } from "@/lib/idm-sources"
import { createNeonIdmStore } from "@/lib/price-store"

/**
 * IDM (intraday) indexed-price loader for the Financial Breakdown report.
 *
 * The telemetry series only carries the DAY-AHEAD (DAM) price. A dynamic
 * "IDM-indexed" tariff (à la Tibber / aWATTar billed on the continuous
 * intraday average) needs the INTRADAY curve, so this action resolves it
 * independently for an arbitrary historical window:
 *
 *   1. Read the durable Neon `idm_price` cache for the window's slot range.
 *   2. If any slots are still missing, fetch them straight from the internet
 *      (SMARD intraday continuous average, hourly fallback) over the same
 *      window, fill the gaps, and warm the cache for next time.
 *
 * Returns one price point per covered 15-min slot (€/MWh) plus coverage stats
 * so the report can show how much of the window had a real intraday price.
 */

export interface IdmSlotPrice {
  slot: number
  ts: number // epoch ms at slot start
  priceEurMwh: number
}

export interface IdmRangeResult {
  prices: IdmSlotPrice[]
  /** Provenance names that contributed real data (e.g. ["cache","smard"]). */
  sources: string[]
  totalSlots: number
  cachedSlots: number
  fetchedSlots: number
  /** True when no intraday data could be resolved at all for the window. */
  empty: boolean
  message?: string
}

export async function getIdmPricesForRange(input: {
  fromIso: string
  toIso: string
}): Promise<IdmRangeResult> {
  const fromMs = new Date(input.fromIso).getTime()
  const toMs = new Date(input.toIso).getTime()
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return { prices: [], sources: [], totalSlots: 0, cachedSlots: 0, fetchedSlots: 0, empty: true, message: "Invalid range." }
  }

  const fromSlot = slotOf(fromMs)
  const toSlot = slotOf(toMs)
  const totalSlots = toSlot - fromSlot + 1

  const bySlot = new Map<number, number>()
  const sources = new Set<string>()

  // 1) Durable cache first (fast, no network).
  const store = createNeonIdmStore()
  let cachedSlots = 0
  try {
    const cached = await store.getRange(DEFAULT_ZONE, fromSlot, toSlot)
    for (const row of cached) {
      if (!Number.isFinite(row.priceEurMwh)) continue
      bySlot.set(row.slot, row.priceEurMwh)
      cachedSlots++
    }
    if (cachedSlots > 0) sources.add("cache")
  } catch (err) {
    console.log(`[v0] idm-prices: cache read failed: ${(err as Error)?.message ?? err}`)
  }

  // 2) Fetch the missing slots from the internet (SMARD intraday), in priority
  //    order. Only the first source to cover a slot wins. We only fetch when the
  //    cache did not already fully cover the window.
  const freshRows: { slot: number; ts: number; priceEurMwh: number; source: string; resampled: boolean }[] = []
  if (cachedSlots < totalSlots) {
    for (const src of defaultIdmSources()) {
      // Stop early once every slot in the window is covered.
      if (bySlot.size >= totalSlots) break
      let points: PricePoint[]
      try {
        points = await src.fetch(fromMs, toMs)
      } catch (err) {
        console.log(`[v0] idm-prices: source "${src.name}" failed: ${(err as Error)?.message ?? err}`)
        continue
      }
      let added = 0
      for (const pt of points) {
        if (!Number.isFinite(pt.priceEurMwh)) continue
        const slot = slotOf(pt.ts)
        if (slot < fromSlot || slot > toSlot) continue
        if (bySlot.has(slot)) continue // higher-priority source / cache already set it
        bySlot.set(slot, pt.priceEurMwh)
        added++
        freshRows.push({
          slot,
          ts: slotStartMs(slot),
          priceEurMwh: pt.priceEurMwh,
          source: src.name,
          resampled: !!pt.resampled,
        })
      }
      if (added > 0) sources.add(src.name)
    }
  }

  // 3) Warm the durable cache with everything fresh we pulled off the internet.
  if (freshRows.length > 0) {
    try {
      await store.upsert(DEFAULT_ZONE, freshRows)
    } catch (err) {
      console.log(`[v0] idm-prices: cache upsert failed: ${(err as Error)?.message ?? err}`)
    }
  }

  const prices: IdmSlotPrice[] = Array.from(bySlot.entries())
    .map(([slot, priceEurMwh]) => ({ slot, ts: slot * SLOT_MS, priceEurMwh }))
    .sort((a, b) => a.slot - b.slot)

  return {
    prices,
    sources: Array.from(sources),
    totalSlots,
    cachedSlots,
    fetchedSlots: freshRows.length,
    empty: prices.length === 0,
    message:
      prices.length === 0
        ? "No intraday (IDM) price data could be resolved for this range from the cache or SMARD."
        : undefined,
  }
}
