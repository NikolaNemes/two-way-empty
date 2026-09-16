// ════════════════════════════════════════════════════════════════════════
// NEON-BACKED PRICE STORE — durable last-known-good cache for price-supply.
// ════════════════════════════════════════════════════════════════════════
// Implements the PriceStore interface against the `dam_price` table using the
// shared Drizzle client. Used by the Next app, the backtest, and the in-app
// sim. The worker uses its own thin pg-backed store (no app dependency).

import "server-only"
import { and, eq, gte, lte, sql } from "drizzle-orm"
import { db } from "./db"
import { damPrice, idmPrice } from "./db/schema"
import type { PriceStore, StoredPrice } from "./price-supply"

// Both price tables share an identical shape; the store is generic over which
// one it targets so DAM and IDM reuse the same caching/fallback machinery.
type PriceTable = typeof damPrice | typeof idmPrice

function createTablePriceStore(table: PriceTable): PriceStore {
  return {
    getRange: async (zone, fromSlot, toSlot): Promise<StoredPrice[]> => {
      const rows = await db
        .select()
        .from(table)
        .where(and(eq(table.zone, zone), gte(table.slot, fromSlot), lte(table.slot, toSlot)))
      return rows.map((r) => ({
        slot: r.slot,
        ts: new Date(r.ts).getTime(),
        priceEurMwh: r.priceEurMwh,
        source: r.source,
        resampled: r.resampled,
      }))
    },
    upsert: async (zone, rows): Promise<void> => {
      if (rows.length === 0) return
      await db
        .insert(table)
        .values(
          rows.map((r) => ({
            zone,
            slot: r.slot,
            ts: new Date(r.ts),
            priceEurMwh: r.priceEurMwh,
            source: r.source,
            resampled: r.resampled,
          })),
        )
        .onConflictDoUpdate({
          target: [table.zone, table.slot],
          set: {
            ts: sqlExcluded("ts"),
            priceEurMwh: sqlExcluded("price_eur_mwh"),
            source: sqlExcluded("source"),
            resampled: sqlExcluded("resampled"),
            fetchedAt: new Date(),
          },
        })
    },
  }
}

/** Durable last-known-good store for the day-ahead (DAM) curve. */
export function createNeonPriceStore(): PriceStore {
  return createTablePriceStore(damPrice)
}

/** Durable last-known-good store for the intraday (IDM) curve. */
export function createNeonIdmStore(): PriceStore {
  return createTablePriceStore(idmPrice)
}

// References the conflicting INSERT row's column in an ON CONFLICT DO UPDATE.
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`)
}
