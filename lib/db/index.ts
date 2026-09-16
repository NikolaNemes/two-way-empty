// Drizzle client over a shared pg Pool (Neon). Server-side only.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

// Reuse a single Pool + Drizzle instance across hot-reloads in dev to avoid
// exhausting connections. We memoize LAZILY (on first DB use) rather than at
// import time so the pool can never capture an undefined connection string
// during the initial env sync — which previously made pg silently fall back to
// 127.0.0.1:5432 and cached that broken pool until a full server restart.
const globalForDb = globalThis as unknown as {
  __pgPool?: Pool
  __db?: NodePgDatabase<typeof schema>
}

/**
 * Resolve the Postgres connection string from the standard Neon/Vercel env var
 * names. Throws a descriptive error if none is set so we fail loudly instead of
 * silently connecting to a non-existent local Postgres.
 */
function resolveConnectionString(): string {
  const conn =
    process.env.DATABASE_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING
  if (!conn) {
    throw new Error(
      "No Postgres connection string found. Set DATABASE_URL (or POSTGRES_URL) " +
        "from the Neon integration before querying the database.",
    )
  }
  return normalizeSslMode(conn)
}

/**
 * pg v8.16+ warns that sslmode 'prefer' / 'require' / 'verify-ca' are today
 * treated as aliases for 'verify-full' and will switch to weaker libpq
 * semantics in pg v9. Neon URLs ship with sslmode=require, which triggers the
 * warning on every process start. Pinning verify-full keeps EXACTLY the
 * current (strict) behavior — Neon endpoints present valid public-CA certs,
 * so full verification passes — and silences the warning now and across the
 * v9 upgrade.
 */
function normalizeSslMode(conn: string): string {
  return conn.replace(/([?&])sslmode=(prefer|require|verify-ca)(?=&|$)/, "$1sslmode=verify-full")
}

function getPool(): Pool {
  if (globalForDb.__pgPool) return globalForDb.__pgPool
  const pool = new Pool({ connectionString: resolveConnectionString(), max: 5 })
  globalForDb.__pgPool = pool
  return pool
}

/**
 * Lazy Drizzle proxy: the underlying pool/connection is only created the first
 * time a query method is accessed, by which point Next.js has loaded the env.
 */
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    if (!globalForDb.__db) {
      globalForDb.__db = drizzle(getPool(), { schema })
    }
    return Reflect.get(globalForDb.__db, prop, receiver)
  },
})

/** Access the underlying pg Pool (creates it lazily if needed). */
export function getDbPool(): Pool {
  return getPool()
}
