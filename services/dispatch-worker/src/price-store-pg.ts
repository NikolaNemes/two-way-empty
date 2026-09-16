/**
 * Thin pg-backed PriceStore for the worker's durable DAM price cache.
 *
 * The worker deliberately talks to Neon DIRECTLY (its own small Pool) rather
 * than hopping through the Next app — so the price supply does not depend on
 * the app being up, which would add a failure mode to the very thing we are
 * hardening. Implements the shared PriceStore interface from lib/price-supply.
 *
 * No-op safe: if DATABASE_URL is unset, getRange returns [] and upsert is a
 * no-op, so the worker still runs (it just loses the durable cache layer and
 * falls back to live sources + synthetic).
 */

import { Pool } from "pg"
import type { PriceStore, StoredPrice } from "../../../lib/price-supply.ts"

export function createWorkerPriceStore(databaseUrl: string | null): PriceStore {
  if (!databaseUrl) {
    return {
      getRange: async () => [],
      upsert: async () => {},
    }
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2 })

  return {
    getRange: async (zone, fromSlot, toSlot): Promise<StoredPrice[]> => {
      const { rows } = await pool.query(
        `SELECT slot, ts, price_eur_mwh, source, resampled
           FROM dam_price
          WHERE zone = $1 AND slot >= $2 AND slot <= $3`,
        [zone, fromSlot, toSlot],
      )
      return rows.map((r) => ({
        slot: Number(r.slot),
        ts: new Date(r.ts).getTime(),
        priceEurMwh: Number(r.price_eur_mwh),
        source: String(r.source),
        resampled: Boolean(r.resampled),
      }))
    },

    upsert: async (zone, priceRows): Promise<void> => {
      if (priceRows.length === 0) return
      // Build a single multi-row parameterized INSERT … ON CONFLICT upsert.
      const values: unknown[] = []
      const tuples = priceRows.map((r, i) => {
        const b = i * 6
        values.push(zone, r.slot, new Date(r.ts), r.priceEurMwh, r.source, r.resampled)
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, now())`
      })
      await pool.query(
        `INSERT INTO dam_price (zone, slot, ts, price_eur_mwh, source, resampled, fetched_at)
         VALUES ${tuples.join(", ")}
         ON CONFLICT (zone, slot) DO UPDATE SET
           ts = excluded.ts,
           price_eur_mwh = excluded.price_eur_mwh,
           source = excluded.source,
           resampled = excluded.resampled,
           fetched_at = now()`,
        values,
      )
    },
  }
}
