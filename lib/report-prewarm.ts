import "server-only"
import { runBacktestForRange } from "@/app/actions/backtest"
import { addDays, berlinDayWindow, berlinMidnightUtc, berlinYesterday } from "@/lib/report-window"

/**
 * REPORT PRE-WARM — runs at the end of the nightly rollup cron.
 *
 * Both site reports default to "Yesterday" in the operator's local calendar
 * (Europe/Berlin). That window straddles two UTC days, so it can never be
 * served from the per-UTC-day rollups: it is always a raw replay, and the
 * first person to open it each morning paid 2.5–5 s of LP (measured Sep 2
 * 2026: Norderstedt 2.7 s, Gifhorn 5.1 s cold → ~0.1 s warm).
 *
 * The replay memo (lib/replay-memo) caches CLOSED raw chunks, so replaying
 * yesterday's two window shapes here — right after the day closes — means the
 * first human load of the day is already warm. Best-effort and time-boxed:
 * a failure here never fails the cron.
 */

// Window helpers live in lib/report-window (the ONE definition every report
// uses); re-exported here for existing callers.
export { berlinMidnightUtc, berlinDayOf } from "@/lib/report-window"

/**
 * The two "Yesterday" windows the report pages actually send, for local day D:
 *  - Dispatching History: [D 00:00 local, D+1 00:00 local]  (next local midnight)
 *  - Financial Report:    [D 00:00 local, D 23:59:59.999 local] (berlinDayWindow)
 * They share the pre-UTC-midnight head chunk; the tail chunk differs by 1 ms.
 */
export function yesterdayReportWindows(now = new Date()): { label: string; fromIso: string; toIso: string; day: string }[] {
  const yDay = berlinYesterday(now)
  const w = berlinDayWindow(yDay, yDay)
  const nextMidnight = berlinMidnightUtc(addDays(yDay, 1))
  return [
    { label: "dispatching-history", day: yDay, fromIso: w.fromIso, toIso: nextMidnight.toISOString() },
    { label: "financial", day: yDay, fromIso: w.fromIso, toIso: w.toIso },
  ]
}

export interface PrewarmResult {
  day: string
  warmed: { s: string; w: string; ms: number }[]
  failed: { s: string; w: string; error: string }[]
  skipped: number
  timeBoxed: boolean
  tookMs: number
}

export async function prewarmYesterdayReports(
  stationIds: string[],
  opts: { budgetMs: number; now?: Date },
): Promise<PrewarmResult> {
  const started = Date.now()
  const windows = yesterdayReportWindows(opts.now)
  const out: PrewarmResult = { day: windows[0].day, warmed: [], failed: [], skipped: 0, timeBoxed: false, tookMs: 0 }
  outer: for (const stationId of stationIds) {
    for (const w of windows) {
      if (Date.now() - started > opts.budgetMs) {
        out.timeBoxed = true
        out.skipped++
        continue
      }
      const t0 = Date.now()
      try {
        // Not chartOnly on purpose: the memo is keyed per raw CHUNK, so this
        // warms both pages; chartOnly only post-processes the merged result.
        await runBacktestForRange({ stationId, fromIso: w.fromIso, toIso: w.toIso })
        out.warmed.push({ s: stationId, w: w.label, ms: Date.now() - t0 })
      } catch (err) {
        out.failed.push({ s: stationId, w: w.label, error: err instanceof Error ? err.message : String(err) })
        // One broken station must not eat the budget of the others.
        if (out.failed.length >= stationIds.length * windows.length) break outer
      }
    }
  }
  out.tookMs = Date.now() - started
  return out
}
