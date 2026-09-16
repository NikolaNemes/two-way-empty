"use server"

// Day-ahead price curve fetched DIRECTLY from the upstream backend (absolute
// URL), the same way lib/ingestion fetches telemetry server-side. We can't reuse
// lib/amperio-api's getPrices here because that goes through the relative Next
// proxy (`/api/amperio`), which only resolves in the browser — a relative fetch
// throws server-side, which is why this action previously always returned [].
const BACKEND_BASE = "https://amperio.enexa.me/api/v1"

interface ApiPricePoint {
  ts: string
  price_eur_mwh: number
}
interface ApiPricesResponse {
  prices?: ApiPricePoint[]
}

export interface DayPricePoint {
  /** Slot-start instant, epoch ms. */
  ts: number
  /** Day-ahead (EPEX SPOT DE-LU) price, €/MWh. */
  priceEurMwh: number
}

/**
 * Full-day day-ahead (DAM) price curve at 15-min resolution for [fromIso, toIso).
 *
 * Day-ahead prices are published for the whole operating day (and the next day
 * after the ~13:00 CET auction), so unlike telemetry frames this covers slots
 * that have not happened yet. The Dispatching Timeline uses it to draw the price
 * line and the cheap/expensive colour bands across the ENTIRE day — including the
 * future portion — not just the slots for which telemetry has arrived.
 *
 * Best-effort: any upstream failure resolves to an empty array so the chart
 * simply falls back to the price carried on the telemetry frames.
 */
export async function getDayAheadPrices(input: {
  fromIso: string
  toIso: string
}): Promise<DayPricePoint[]> {
  try {
    const qs = new URLSearchParams({
      source: "DAM",
      from: input.fromIso,
      to: input.toIso,
      resolution: "PT15M",
    })
    const res = await fetch(`${BACKEND_BASE}/prices?${qs}`, {
      headers: { Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
      cache: "no-store",
    })
    if (!res.ok) return []
    const data = (await res.json()) as ApiPricesResponse
    return (data.prices ?? [])
      .map((p) => ({ ts: new Date(p.ts).getTime(), priceEurMwh: p.price_eur_mwh }))
      .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.priceEurMwh))
      .sort((a, b) => a.ts - b.ts)
  } catch {
    return []
  }
}
