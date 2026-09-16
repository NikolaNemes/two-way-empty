// ════════════════════════════════════════════════════════════════════════
// v5.1 — RISK-AWARE CHEAP-SLOT ANALYSIS (pure, client-safe).
// ════════════════════════════════════════════════════════════════════════
//
// Two jobs, both grounded in the visible (already horizon-bounded) price curve:
//
//  1. analyzeDayPrices: classify "cheap" RELATIVE TO THE DAY SPREAD, not an
//     absolute €/MWh threshold (which fails on expensive days) and not the
//     median (which calls half of every day "cheap"). cheapCutoff anchors to the
//     trough: min + frac·(max−min).
//
//  2. decideBuyNow: the operator's core complaint — the planner waits many slots
//     for a marginally-cheaper price and holds SOC low in the meantime. This
//     quantifies whether waiting is WORTH IT:
//       savings = price[now] − min(price ahead)              (€/kWh)
//     If the best slot ahead saves less than `worthWaitingEurPerKwh`, the wait is
//     marginal → BUY NOW. The lower the SOC, the larger the required saving
//     (waiting is riskier when the pack is low), via worthWaitingLowSocMult. So a
//     plateau of ten near-equal cheap slots no longer makes us hold out for the
//     last one a few euros cheaper.
// ════════════════════════════════════════════════════════════════════════

import type { OptimizerParams } from "./params"

export interface DayPriceStats {
  minP: number
  maxP: number
  medianP: number
  /** min + cheapSpreadFrac·(max−min): the "cheap relative to today" line. */
  cheapCutoff: number
}

/** Summarise a price curve (€/MWh) and derive the day-spread cheap cutoff. */
export function analyzeDayPrices(pricesEurMwh: number[], mpc: OptimizerParams): DayPriceStats {
  const valid = pricesEurMwh.filter((p) => Number.isFinite(p))
  if (valid.length === 0) {
    return { minP: 0, maxP: 0, medianP: 0, cheapCutoff: 0 }
  }
  const sorted = [...valid].sort((a, b) => a - b)
  const minP = sorted[0]
  const maxP = sorted[sorted.length - 1]
  const mid = Math.floor(sorted.length / 2)
  const medianP = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const frac = mpc.cheapSpreadFrac ?? 0.3
  const cheapCutoff = minP + frac * (maxP - minP)
  return { minP, maxP, medianP, cheapCutoff }
}

export interface ArbitrageCheck {
  /** Best discharge−charge price spread on the visible horizon (€/kWh, ≥ 0). */
  spreadEurPerKwh: number
  /** Round-trip cycling cost the spread must beat (€/kWh) = 2·degradation. */
  cycleCostEurPerKwh: number
  /** True when the horizon spread genuinely beats the round-trip cycling cost. */
  worthIt: boolean
}

/**
 * Is there an arbitrage opportunity on the horizon worth CYCLING the battery for?
 *
 * Real pack wear is ~7 ct/kWh per FULL cycle: charging at the cheap slot AND
 * discharging at the expensive slot each cost `degPerKwh`, so a round trip costs
 * `2·degPerKwh`. Capturing a price spread only makes money when
 *     (maxPrice − minPrice) on the horizon  >  2·degPerKwh
 * (a deliberately conservative gate — it ignores efficiency losses, which only
 * make cycling LESS attractive, so we never cycle when this says not to).
 *
 * When this returns worthIt=false, there is no economically beneficial slot pair
 * ahead, so the right move is to serve load (and a connected car) straight from
 * the GRID — including grid-charging the pack in cheap slots — rather than burn a
 * cycle for a spread the degradation cost would wipe out.
 */
export function arbitrageWorthIt(pricesEurMwh: number[], mpc: OptimizerParams): ArbitrageCheck {
  const stats = analyzeDayPrices(pricesEurMwh, mpc)
  const spreadEurPerKwh = Math.max(0, (stats.maxP - stats.minP) / 1000)
  // Gate at the PLANNING wear price (true degradation + profit hurdle), same as
  // the LP objective: a spread that only just covers wear earns ≈ €0 after
  // efficiency losses, so it must clear the hurdle too before we cycle.
  const cycleCostEurPerKwh =
    (2 * ((mpc.degCostEurPerMwh ?? 0) + (mpc.arbMarginEurPerMwh ?? 0))) / 1000
  return {
    spreadEurPerKwh,
    cycleCostEurPerKwh,
    worthIt: spreadEurPerKwh > cycleCostEurPerKwh,
  }
}

export interface BuyNowDecision {
  /** Should we act (import/refill) on the current slot rather than wait? */
  buyNow: boolean
  /** Is the current slot itself "cheap" by the day-spread cutoff? */
  cheapNow: boolean
  /** Index (into the passed curve) of the cheapest slot strictly ahead of now, or -1. */
  nextCheaperIdx: number
  /** €/kWh the best slot ahead would save vs now (≥ 0; 0 if nothing cheaper ahead). */
  savingsEurPerKwh: number
  /** Effective worth-waiting threshold (€/kWh) used, after the SOC-dependent scale. */
  thresholdEurPerKwh: number
  /**
   * Is a MATERIALLY-cheaper slot still ahead (savings ≥ threshold)? Independent of
   * whether NOW is itself "cheap". Used by the high-SOC defer rule to skip topping
   * the pack up now when a better slot is coming and the buffer can afford to wait.
   */
  materialCheaperAhead: boolean
  /** Short machine reason code for telemetry. */
  reason: "buy_now_cheapest" | "buy_now_marginal" | "wait_cheaper_ahead" | "not_cheap"
}

/**
 * Decide whether to buy NOW given the visible price curve and current SOC.
 *
 * `pricesEurMwh[0]` is the current (committed) slot; the rest are the lookahead
 * (already bounded by the dynamic horizon upstream). `socFrac` scales how eager
 * we are: near the floor, only a much-cheaper future slot justifies waiting.
 */
export function decideBuyNow(
  pricesEurMwh: number[],
  socFrac: number,
  mpc: OptimizerParams,
): BuyNowDecision {
  const stats = analyzeDayPrices(pricesEurMwh, mpc)
  const now = pricesEurMwh[0]
  // SIGNIFICANCE GUARD (audit finding): "cheap relative to the visible spread"
  // is only meaningful when the window is wide enough to represent the day.
  // At day-end the price curve can shrink to a couple of slots — the window min
  // is then ALWAYS "cheap" by construction even at 95+ €/MWh, which used to
  // fire the firm refill at objectively expensive prices. Require a minimum
  // number of visible slots AND a minimum absolute spread before trusting the
  // relative rule; a non-positive price is unconditionally cheap (charging is
  // free or better regardless of window size).
  const validCount = pricesEurMwh.filter((p) => Number.isFinite(p)).length
  const minSlots = mpc.cheapMinVisibleSlots ?? 8
  const minSpreadEurMwh = mpc.cheapMinSpreadEurMwh ?? 20
  const spreadSignificant =
    validCount >= minSlots && stats.maxP - stats.minP >= minSpreadEurMwh
  const cheapNow =
    Number.isFinite(now) && (now <= 0 || (spreadSignificant && now <= stats.cheapCutoff))

  // Find the cheapest slot strictly ahead of now within the visible curve.
  let nextCheaperIdx = -1
  let minAhead = now
  for (let i = 1; i < pricesEurMwh.length; i++) {
    const p = pricesEurMwh[i]
    if (Number.isFinite(p) && p < minAhead) {
      minAhead = p
      nextCheaperIdx = i
    }
  }
  // Savings (€/kWh) the best future slot would give vs buying now.
  const savingsEurPerKwh = Math.max(0, (now - minAhead) / 1000)

  // Worth-waiting threshold as a SMOOTH, MONOTONIC function of SOC: eagerness and
  // SOC are coupled. The high band (hiBand) is the neutral pivot (mult = 1×):
  //   • BELOW hiBand → ramp UP to lowMult at the emergency floor (eager when low:
  //     only a much-cheaper slot justifies waiting while the pack is thin).
  //   • ABOVE hiBand → ramp DOWN to highMult at a full pack (patient when high:
  //     a big buffer can hold out for even a small extra saving instead of topping
  //     up in a marginally-cheaper slot).
  const baseThresh = mpc.worthWaitingEurPerKwh ?? 0.015
  const lowMult = mpc.worthWaitingLowSocMult ?? 2.0
  const highMult = mpc.worthWaitingHighSocMult ?? 0.4
  const hiBand = mpc.horizonSocHighFrac ?? 0.7
  const loBand = mpc.emergencyFloorFrac ?? 0.15
  let mult = 1
  if (socFrac >= hiBand) {
    // 1× at hiBand → highMult at full SOC (1.0). More patient as SOC rises.
    const t = hiBand < 1 ? Math.min(1, Math.max(0, (socFrac - hiBand) / (1 - hiBand))) : 0
    mult = 1 + t * (highMult - 1)
  } else if (hiBand > loBand) {
    // 1× at hiBand → lowMult at the emergency floor. More eager as SOC falls.
    const socScale = Math.min(1, Math.max(0, (hiBand - socFrac) / (hiBand - loBand)))
    mult = 1 + socScale * (lowMult - 1)
  }
  const thresholdEurPerKwh = baseThresh * mult
  const materialCheaperAhead = nextCheaperIdx !== -1 && savingsEurPerKwh >= thresholdEurPerKwh

  if (!cheapNow) {
    return {
      buyNow: false,
      cheapNow: false,
      nextCheaperIdx,
      savingsEurPerKwh,
      thresholdEurPerKwh,
      materialCheaperAhead,
      reason: "not_cheap",
    }
  }

  // Cheap now AND nothing meaningfully cheaper ahead ⇒ buy now.
  if (nextCheaperIdx === -1) {
    return {
      buyNow: true,
      cheapNow: true,
      nextCheaperIdx,
      savingsEurPerKwh,
      thresholdEurPerKwh,
      materialCheaperAhead,
      reason: "buy_now_cheapest",
    }
  }
  if (savingsEurPerKwh < thresholdEurPerKwh) {
    return {
      buyNow: true,
      cheapNow: true,
      nextCheaperIdx,
      savingsEurPerKwh,
      thresholdEurPerKwh,
      materialCheaperAhead,
      reason: "buy_now_marginal",
    }
  }
  // A materially-cheaper slot is ahead and SOC affords the wait ⇒ hold.
  return {
    buyNow: false,
    cheapNow: true,
    nextCheaperIdx,
    savingsEurPerKwh,
    thresholdEurPerKwh,
    materialCheaperAhead,
    reason: "wait_cheaper_ahead",
  }
}
