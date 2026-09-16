/**
 * Absolute 15-minute slot indexing.
 *
 * The in-app simulator anchors "slot 0" at the first frame of its data set.
 * A live service has no such start frame, so we anchor on the Unix epoch
 * instead: epoch (1970-01-01T00:00:00Z) sits exactly on a 15-min boundary,
 * so `floor(ms / SLOT_MS)` yields a stable, globally-consistent slot index
 * that increments by one every quarter hour and aligns with the German DAM
 * 15-minute clear. The kernel only cares that prices, the plan, and the
 * current-slot lookup all use the SAME indexing — which they do here.
 */

import { SLOT_MS } from "../../../lib/dispatch-kernel.ts"

/** Absolute slot index for a given epoch-ms instant. */
export function slotOf(ms: number): number {
  return Math.floor(ms / SLOT_MS)
}

/** Absolute slot index for an ISO timestamp. */
export function slotOfIso(iso: string): number {
  return slotOf(new Date(iso).getTime())
}

/** Start instant (epoch ms) of a given absolute slot. */
export function slotStartMs(slot: number): number {
  return slot * SLOT_MS
}

/** Fraction (0..1] of the current slot still remaining at instant `ms`. */
export function slotRemainingFraction(ms: number): number {
  const intoSlot = ms - slotStartMs(slotOf(ms))
  return Math.max(0, Math.min(1, (SLOT_MS - intoSlot) / SLOT_MS))
}
