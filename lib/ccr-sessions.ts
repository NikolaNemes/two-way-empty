/**
 * Charging sessions from the operator's CCR archive export (History Analysis).
 *
 * The pre-system archive (one CSV per station, 1-minute cadence) carries NO
 * session records, plug state or energy counters — but it does carry a real
 * per-connector power meter: `loading_point_1_power_w` / `loading_point_2_power_w`
 * (Gronau AX10095481: ~17 000 distinct non-zero values, not a state flag).
 * A session is therefore a contiguous island of connector power, exactly as the
 * live path derives one from a contiguous run of counter advances
 * (lib/backtest.ts `deriveSessionsFromRows`). The two share every filter:
 *
 *   - idle gaps ≤ 8 min inside a session are bridged (one pause ≠ two sessions)
 *   - a session needs ≥ 2 frames AND > 0.1 kWh
 *   - energy is the rectangle integral of power over the frame interval,
 *     capped at 5 min so a telemetry gap never inflates a session
 *
 * Verified on the Gronau export against the live counter method (sep 4 2026):
 * Jul 2026 archive 146 sessions / 31.6 kWh / 26 min vs Aug 2026 live 155 /
 * 33.3 / 25; result is threshold-insensitive (300, 500 and 1 000 W all give
 * 1 035 sessions) and captures 100.0 % of connector energy. The one-time
 * import's "5 kW rising edge on COMBINED power" (974) is NOT this: it misses a
 * second car plugging in during a charge and double-counts a taper below 5 kW.
 *
 * Pure module — no DB, no server-only — so the importer, tests and any future
 * upload route derive sessions identically. Timestamps in the export are UTC
 * (the fleet import localises them as UTC; the 05:00 opening rush = 07:00
 * Berlin confirms it).
 */

/** Method stamp persisted with every derived session / on the report row. */
export const CCR_SESSION_METHOD = "lp-power-islands-v1"

/** Live rows: sessions are charge events from the per-connector energy counters. */
export const COUNTER_SESSION_METHOD = "counters"

export const CCR_SESSION_PARAMS = {
  /** Connector power above which a frame counts as "charging" (W). */
  thresholdW: 500,
  /** Idle gap bridged inside one session (ms) — mirror of the live GAP_MS. */
  gapMs: 8 * 60_000,
  /** Longest interval one frame may account for (ms) — a gap is not charging. */
  maxFrameMs: 5 * 60_000,
  /** Session filters — mirror of the live path (≥2 frames AND >0.1 kWh). */
  minFrames: 2,
  minKwh: 0.1,
} as const

/** One archive frame, already parsed. Power in W; `ts` epoch ms (UTC). */
export type CcrFrame = {
  tsMs: number
  lp1W: number | null
  lp2W: number | null
}

export type CcrSession = {
  connector: 1 | 2
  startMs: number
  endMs: number
  energyKwh: number
  peakKw: number
  avgKw: number
  frames: number
}

/**
 * Header → column index for the CCR export. Tolerant of column order; throws
 * if a required column is missing so a wrong file fails loudly.
 */
export function ccrColumnMap(header: string[]): { ts: number; lp1: number; lp2: number } {
  const idx = (name: string) => {
    const i = header.findIndex((h) => h.trim().toLowerCase() === name)
    if (i < 0) throw new Error(`CCR export is missing column "${name}" (header: ${header.join(",")})`)
    return i
  }
  return { ts: idx("timestamp"), lp1: idx("loading_point_1_power_w"), lp2: idx("loading_point_2_power_w") }
}

/** "2026-07-31 06:25:00" (UTC, no zone) → epoch ms; NaN if unparseable. */
export function parseCcrTimestamp(raw: string): number {
  const s = raw.trim()
  if (!s) return NaN
  // Already ISO with zone → trust it; else treat as UTC wall time.
  if (/[zZ]$|[+-]\d\d:\d\d$/.test(s)) return Date.parse(s)
  return Date.parse(s.replace(" ", "T") + "Z")
}

function parseW(raw: string | undefined): number | null {
  if (raw == null) return null
  const t = raw.trim()
  if (!t) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

/** Parse one CSV data line with the column map. Returns null for blank/bad lines. */
export function parseCcrLine(line: string, cols: { ts: number; lp1: number; lp2: number }): CcrFrame | null {
  if (!line || !line.trim()) return null
  const parts = line.split(",")
  const tsMs = parseCcrTimestamp(parts[cols.ts] ?? "")
  if (!Number.isFinite(tsMs)) return null
  return { tsMs, lp1W: parseW(parts[cols.lp1]), lp2W: parseW(parts[cols.lp2]) }
}

/**
 * Derive per-connector sessions from time-ordered frames. Frames MUST be
 * sorted ascending by tsMs (the importer sorts once after parsing; the export
 * is already ordered but we never rely on it).
 */
export function deriveCcrSessions(frames: CcrFrame[], params = CCR_SESSION_PARAMS): CcrSession[] {
  const out: CcrSession[] = []

  for (const connector of [1, 2] as const) {
    const pick = (f: CcrFrame) => (connector === 1 ? f.lp1W : f.lp2W)
    // `lastMs` = timestamp of the last charging FRAME (the gap test, exactly as
    // the live path compares frame timestamps); `endMs` = that frame's end,
    // which is what the session's duration/avg kW are measured to.
    let cur: { startMs: number; lastMs: number; endMs: number; energyKwh: number; peakW: number; frames: number } | null =
      null

    const flush = () => {
      if (cur && cur.energyKwh > params.minKwh && cur.frames >= params.minFrames) {
        const hours = Math.max((cur.endMs - cur.startMs) / 3_600_000, 1 / 240)
        out.push({
          connector,
          startMs: cur.startMs,
          endMs: cur.endMs,
          energyKwh: Math.round(cur.energyKwh * 100) / 100,
          peakKw: Math.round(cur.peakW / 100) / 10,
          avgKw: Math.round((cur.energyKwh / hours) * 10) / 10,
          frames: cur.frames,
        })
      }
      cur = null
    }

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      const p = pick(f)
      if (p == null || p <= params.thresholdW) continue
      // Interval this frame accounts for: to the next frame, capped.
      const nextMs = i + 1 < frames.length ? frames[i + 1].tsMs : f.tsMs + 60_000
      const dtMs = Math.min(Math.max(nextMs - f.tsMs, 0), params.maxFrameMs)
      if (cur && f.tsMs - cur.lastMs > params.gapMs) flush()
      if (!cur) cur = { startMs: f.tsMs, lastMs: f.tsMs, endMs: f.tsMs, energyKwh: 0, peakW: 0, frames: 0 }
      cur.lastMs = f.tsMs
      cur.endMs = f.tsMs + dtMs
      cur.energyKwh += (p * dtMs) / 3_600_000 / 1000
      cur.peakW = Math.max(cur.peakW, p)
      cur.frames += 1
    }
    flush()
  }

  out.sort((a, b) => a.startMs - b.startMs || a.connector - b.connector)
  return out
}

/** Σ max(0, power) × dt over all frames, both connectors — the closure check. */
export function ccrConnectorEnergyKwh(frames: CcrFrame[], maxFrameMs = CCR_SESSION_PARAMS.maxFrameMs): number {
  let kwh = 0
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const nextMs = i + 1 < frames.length ? frames[i + 1].tsMs : f.tsMs + 60_000
    const dtMs = Math.min(Math.max(nextMs - f.tsMs, 0), maxFrameMs)
    kwh += ((Math.max(0, f.lp1W ?? 0) + Math.max(0, f.lp2W ?? 0)) * dtMs) / 3_600_000 / 1000
  }
  return kwh
}

/** Station id convention of the archive: `hist_<asset>` where the asset is in the file name (…_CCR_AX10095481.csv). */
export function stationIdFromCcrFileName(fileName: string): string | null {
  const m = /CCR_(AX\d+)/i.exec(fileName)
  return m ? `hist_${m[1].toUpperCase()}` : null
}
