// ════════════════════════════════════════════════════════════════════════
// DEMAND FORECAST — per-hour EV demand profile from the session log (v4 MPC).
// ════════════════════════════════════════════════════════════════════════
//
// The v4 MPC needs two forecast inputs (spec Sec 2.D / 5):
//   • d[t]   — expected EV demand per horizon step, for the energy balance and
//              EV-protection headroom.
//   • D_day  — forecast total daily car demand, for the self-consumption
//              throughput cap (Sec 0b — THE key constraint).
//
// Both are built deterministically from the metered charger sessions, kept
// intentionally simple per the spec's thin-data guidance (1 site, 1 month —
// do NOT over-fit). Method: bucket each session's delivered energy into its
// start hour-of-day (Europe/Berlin), average over the number of days observed,
// and treat the per-hour average kWh as an average kW during that clock hour.
// ════════════════════════════════════════════════════════════════════════

import type { ChargerSession } from "./charger-sessions"

export interface HourlyDemandProfile {
  /** Average (expected) EV power for each hour-of-day 0–23 (kW). */
  hourlyKw: number[]
  /**
   * HIGH-QUANTILE (≈P90) EV power for each hour-of-day 0–23 (kW). Captures the
   * across-day VARIABILITY of demand in that clock hour: hours where a car
   * sometimes shows up and sometimes does not get a high upper estimate; hours
   * that are consistently busy or consistently empty get one close to the mean.
   * v5's adaptive reserve sizes its cushion from the gap (hourlyKwHi − hourlyKw),
   * so the battery is kept fuller exactly when arrival uncertainty is high. v4
   * ignores this field, so its behaviour is unchanged.
   */
  hourlyKwHi: number[]
  /** Forecast total daily demand D_day (kWh) — Σ hourlyKw (each hour = 1 h). */
  dailyKwh: number
  /** Number of distinct local days the profile was averaged over. */
  observedDays: number
  /** Number of sessions used. */
  sessionCount: number
}

/** P90 z-score under a normal approximation (mean + 1.2816·std ≈ P90). */
const P90_Z = 1.2816

const BERLIN_TZ = "Europe/Berlin"

/** Berlin wall-clock hour [0–23] for an epoch-ms instant. */
function berlinHour(ms: number): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: BERLIN_TZ,
    hour12: false,
    hour: "2-digit",
  }).format(new Date(ms))
  const n = Number(h)
  return n === 24 ? 0 : n
}

/** Berlin calendar-day key (YYYY-MM-DD) for an epoch-ms instant. */
function berlinDayKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BERLIN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms))
}

/**
 * Build a smooth per-hour demand profile from charger sessions over a window.
 * Falls back to a flat profile keyed off `fallbackDailyKwh` when no sessions
 * exist, so the MPC always has a usable (if conservative) forecast.
 */
export function buildHourlyDemandProfile(
  sessions: ChargerSession[],
  fromMs: number,
  toMs: number,
  fallbackDailyKwh = 0,
): HourlyDemandProfile {
  const windowDays = Math.max(1, (toMs - fromMs) / 86_400_000)

  if (sessions.length === 0) {
    // No history → flat profile spreading the fallback daily demand evenly.
    // With no data to estimate spread, the high estimate is a modest uplift.
    const perHourKw = fallbackDailyKwh / 24
    return {
      hourlyKw: Array.from({ length: 24 }, () => perHourKw),
      hourlyKwHi: Array.from({ length: 24 }, () => perHourKw * 1.5),
      dailyKwh: fallbackDailyKwh,
      observedDays: 0,
      sessionCount: 0,
    }
  }

  // Accumulate delivered energy into the session's START hour-of-day, BUT keep
  // it split per local day so we can measure across-day variability per hour
  // (not just the mean). dayKey → 24-vector of kWh delivered that hour.
  const byDay = new Map<string, number[]>()
  for (const s of sessions) {
    const dayKey = berlinDayKey(s.startMs)
    const h = berlinHour(s.startMs)
    let vec = byDay.get(dayKey)
    if (!vec) {
      vec = new Array<number>(24).fill(0)
      byDay.set(dayKey, vec)
    }
    vec[h] += s.energyKwh
  }
  // Use the count of distinct observed days as the denominator (more robust than
  // the raw span when the window has gaps), and as the sample size for spread.
  const observedDays = Math.max(byDay.size, Math.round(windowDays * 0.5), 1)
  const dayVecs = [...byDay.values()]

  const hourlyKw = new Array<number>(24).fill(0)
  const hourlyKwHi = new Array<number>(24).fill(0)
  for (let h = 0; h < 24; h++) {
    // Per-day kWh in this hour. Days with no session in the hour contribute 0,
    // which is what makes "sometimes a car, sometimes none" read as HIGH spread.
    const perDay = dayVecs.map((v) => v[h])
    // Sum / observedDays = mean kWh that hour (matches the prior definition,
    // averaging over ALL observed days, not just the days that had a session).
    const sum = perDay.reduce((a, b) => a + b, 0)
    const mean = sum / observedDays
    hourlyKw[h] = mean // kWh/day in this 1-h bucket ⇒ average kW that hour

    // Population std over observed days (treat unobserved days as 0 demand).
    let sse = 0
    for (const v of perDay) sse += (v - mean) ** 2
    sse += (observedDays - perDay.length) * mean ** 2 // the implicit zero-days
    const std = Math.sqrt(sse / observedDays)
    // P90 estimate, floored at the mean (the cushion is never negative).
    hourlyKwHi[h] = mean + P90_Z * std
  }
  const dailyKwh = hourlyKw.reduce((a, b) => a + b, 0)

  return { hourlyKw, hourlyKwHi, dailyKwh, observedDays, sessionCount: sessions.length }
}

/** Forecast (expected) EV demand (kW) at a given instant, from the profile. */
export function demandKwAt(profile: HourlyDemandProfile, ms: number): number {
  return profile.hourlyKw[berlinHour(ms)] ?? 0
}

/** High-quantile (≈P90) EV demand (kW) at a given instant — the upper estimate
 *  v5 uses to size its uncertainty reserve. Falls back to the mean for stored
 *  profiles built before this field existed. */
export function demandHiKwAt(profile: HourlyDemandProfile, ms: number): number {
  const h = berlinHour(ms)
  return profile.hourlyKwHi?.[h] ?? profile.hourlyKw[h] ?? 0
}
