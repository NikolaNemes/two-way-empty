/**
 * Shared formatting for the Portfolio History pages — German/EU conventions
 * (de-DE locale: dot thousands separators, months written in letters).
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]

/** "2022-12-07" → "7. Dez 2022" */
export function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  if (!y || !m || !d) return iso
  return `${d}. ${MONTHS_SHORT[m - 1]} ${y}`
}

/** "2022-12-07" → "7. Dez" (chart tooltips / dense contexts) */
export function fmtDayShort(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number)
  if (!m || !d) return iso
  return `${d}. ${MONTHS_SHORT[m - 1]}`
}

/** "2022-12-07" → "Dez 22" (multi-year axis ticks) */
export function fmtMonthTick(iso: string): string {
  const [y, m] = iso.slice(0, 10).split("-").map(Number)
  if (!y || !m) return iso
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`
}

/** "2022-12" → "Dez 2022" (month-granularity labels) */
export function fmtMonth(ym: string): string {
  const [y, m] = ym.slice(0, 7).split("-").map(Number)
  if (!y || !m) return ym
  return `${MONTHS_SHORT[m - 1]} ${y}`
}

export const fmtInt = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 0 })

export const fmtEur = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`

export const fmtMwh = (kwh: number) =>
  kwh >= 1_000_000
    ? `${(kwh / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} GWh`
    : `${(kwh / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MWh`
