/**
 * REPORT WINDOW — the ONE definition of "which instants does a report cover".
 *
 * Every report that prices a station (site Financial Report, Dispatching
 * History, Fleet Monthly, Fleet Yearly, the nightly fleet cron, the prewarm)
 * builds its window here. Nothing else may turn a day or a month into ISO
 * bounds. That is what makes "Financial Report for Aug 1–31" and "Fleet
 * Monthly · Aug" price the SAME instants — and therefore print the same euros.
 *
 * Rules (Annex A8.1):
 *  - Report days are Europe/Berlin calendar days, whatever the browser's or the
 *    server's timezone. A day runs from local 00:00:00.000 to 23:59:59.999.
 *  - A month is its first day → last day. A RUNNING month is clipped at the end
 *    of YESTERDAY (Berlin) — today is never priced (partial, still changing).
 *  - DST-safe: offsets are resolved per instant with Intl, not by month.
 *
 * Isomorphic on purpose (no `server-only`): the client uses it to build the
 * bounds it sends and to label days; the server uses the same code.
 */

export const REPORT_TZ = "Europe/Berlin"

// Hoisted: compute() calls berlinDayOf per frame (~100k per month), and an
// Intl.DateTimeFormat instance is expensive to construct.
const DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** Local-time offset of Europe/Berlin at instant `at`, in ms (UTC+2 → +7,200,000). */
function tzOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** UTC instant of 00:00 local (Europe/Berlin) on `day` (yyyy-mm-dd). DST-safe. */
export function berlinMidnightUtc(day: string): Date {
  const [y, m, d] = day.split("-").map(Number)
  const guess = Date.UTC(y, m - 1, d)
  const off1 = tzOffsetMs(new Date(guess))
  let utc = guess - off1
  // Around a DST switch the offset at the guess and at the answer can differ.
  const off2 = tzOffsetMs(new Date(utc))
  if (off2 !== off1) utc = guess - off2
  return new Date(utc)
}

const dayByHour = new Map<number, string>()

/** yyyy-mm-dd of `at` in Europe/Berlin. */
export function berlinDayOf(at: Date | number | string): string {
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at)
  // All instants in one UTC hour share a Berlin day (offsets are whole hours).
  const hourKey = Math.floor(ms / 3_600_000)
  const hit = dayByHour.get(hourKey)
  if (hit) return hit
  const parts = DAY_FMT.formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value
  const day = `${get("year")}-${get("month")}-${get("day")}`
  if (dayByHour.size > 50_000) dayByHour.clear()
  dayByHour.set(hourKey, day)
  return day
}

/** Today's Berlin calendar day. */
export function berlinToday(now = new Date()): string {
  return berlinDayOf(now)
}

/** Yesterday's Berlin calendar day (the last CLOSED operating day). */
export function berlinYesterday(now = new Date()): string {
  const todayStart = berlinMidnightUtc(berlinDayOf(now))
  return berlinDayOf(new Date(todayStart.getTime() - 12 * 3_600_000))
}

/** Add `n` calendar days to a yyyy-mm-dd string (calendar arithmetic, tz-free). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number)
  const t = Date.UTC(y, m - 1, d + n)
  return new Date(t).toISOString().slice(0, 10)
}

/** Inclusive Berlin calendar-day count of [fromDay, toDay]. */
export function berlinDayCount(fromDay: string, toDay: string): number {
  const [fy, fm, fd] = fromDay.split("-").map(Number)
  const [ty, tm, td] = toDay.split("-").map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1
}

export interface ReportWindow {
  /** First Berlin day (yyyy-mm-dd). */
  fromDay: string
  /** Last Berlin day (yyyy-mm-dd), inclusive. */
  toDay: string
  /** UTC instant of fromDay 00:00:00.000 Berlin. */
  fromIso: string
  /** UTC instant of toDay 23:59:59.999 Berlin. */
  toIso: string
  days: number
}

/**
 * The window for an inclusive Berlin day range. This is what the site reports
 * send after the user presses Run, and what the fleet builder derives a month
 * window from — so both produce byte-identical `fromIso`/`toIso`.
 */
export function berlinDayWindow(fromDay: string, toDay: string): ReportWindow {
  const from = berlinMidnightUtc(fromDay)
  const to = new Date(berlinMidnightUtc(addDays(toDay, 1)).getTime() - 1)
  return { fromDay, toDay, fromIso: from.toISOString(), toIso: to.toISOString(), days: berlinDayCount(fromDay, toDay) }
}

/** First / last Berlin calendar day of a yyyy-mm month. */
export function monthDays(month: string): { first: string; last: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  const first = `${m[1]}-${m[2]}-01`
  const lastD = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return { first, last: `${m[1]}-${m[2]}-${String(lastD).padStart(2, "0")}` }
}

/**
 * The window a FLEET month row prices: the whole month, or — for the running
 * month — the month through yesterday. `null` when the month has not produced
 * a closed day yet (or is in the future).
 */
export function berlinMonthWindow(month: string, now = new Date()): ReportWindow | null {
  const md = monthDays(month)
  if (!md) return null
  const yesterday = berlinYesterday(now)
  const toDay = md.last < yesterday ? md.last : yesterday
  if (toDay < md.first) return null
  return berlinDayWindow(md.first, toDay)
}

/**
 * Inverse of `berlinMonthWindow`: the fleet month whose row prices EXACTLY the
 * window [fromDay, toDay], or `null`. Used by the Financial Report to find the
 * Fleet Monthly row it must reconcile against.
 */
export function fleetMonthForWindow(fromDay: string, toDay: string, now = new Date()): string | null {
  if (!fromDay.endsWith("-01")) return null
  const month = fromDay.slice(0, 7)
  const w = berlinMonthWindow(month, now)
  if (!w) return null
  return w.fromDay === fromDay && w.toDay === toDay ? month : null
}

/** "Aug 2026" for a yyyy-mm month. */
export function monthLabel(month: string): string {
  const md = monthDays(month)
  if (!md) return month
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${md.first}T12:00:00Z`),
  )
}
