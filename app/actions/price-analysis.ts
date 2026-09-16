"use server"

/**
 * Price analysis server action — thin wrapper over lib/price-analysis.
 * ADMIN-ONLY (client request aug 25 2026): Amperio users get the "user" role
 * and must not see tariff/price internals. requireAdmin() throws for anyone
 * else — the proxy's Clerk gate alone is not enough here.
 */

import { requireAdmin } from "@/lib/auth"
import {
  getPriceAnalysis as compute,
  PRICE_ANALYSIS_FIRST_DAY,
  type PriceAnalysis,
} from "@/lib/price-analysis"

function isDay(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function getPriceAnalysisAction(opts?: {
  fromDay?: string
  toDay?: string
}): Promise<PriceAnalysis> {
  await requireAdmin()
  const today = new Date().toISOString().slice(0, 10)
  let fromDay = opts?.fromDay && isDay(opts.fromDay) ? opts.fromDay : PRICE_ANALYSIS_FIRST_DAY
  let toDay = opts?.toDay && isDay(opts.toDay) ? opts.toDay : today
  // clamp to sane bounds
  if (fromDay < PRICE_ANALYSIS_FIRST_DAY) fromDay = PRICE_ANALYSIS_FIRST_DAY
  if (toDay > today) toDay = today
  if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay]
  return compute(fromDay, toDay)
}
