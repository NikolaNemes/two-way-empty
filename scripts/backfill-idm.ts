// Backfill REAL German intraday (IDM) continuous-average prices into the Neon
// `idm_price` cache, so the v4 MPC can read near-term intraday prices + detect
// IDM↔DAM divergence during backtests.
//
//   set -a && . /vercel/share/.env.project && set +a && \
//     SWEEP_FROM=2026-05-01 SWEEP_TO=2026-06-01 npx -y tsx scripts/backfill-idm.ts
//
// Sources (priority): SMARD intraday-avg 15-min → SMARD intraday-avg hourly →
// ENTSO-E (if ENTSOE_API_TOKEN set) → existing cache. Every real point fetched
// is upserted into idm_price. Then it prints coverage + IDM-vs-DAM deviation
// stats (DAM read from the station's stored telemetry) so we can see the signal.
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

if (process.env.__IDM_CHILD !== "1") {
  const res = spawnSync("npx", ["-y", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: {
      ...process.env,
      __IDM_CHILD: "1",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=react-server`.trim(),
    },
  })
  process.exit(res.status ?? 1)
}

const STATION = process.env.SWEEP_STATION ?? "chargepost_gronau_001"
const FROM = new Date(process.env.SWEEP_FROM ?? "2026-05-01T00:00:00.000Z")
const TO = new Date(process.env.SWEEP_TO ?? "2026-06-01T00:00:00.000Z")
const ZONE = process.env.IDM_ZONE ?? "DE-LU"

async function main() {
  const { resolvePriceCurve, DEFAULT_ZONE, slotOf } = await import("../lib/price-supply")
  const { defaultIdmSources } = await import("../lib/idm-sources")
  const { createNeonIdmStore } = await import("../lib/price-store")
  const { db } = await import("../lib/db")
  const { telemetryFrame } = await import("../lib/db/schema")
  const { and, asc, eq, gte, lte, sql } = await import("drizzle-orm")

  const zone = ZONE || DEFAULT_ZONE
  const fromMs = FROM.getTime()
  const toMs = TO.getTime()
  const hours = Math.max(1, (toMs - fromMs) / 3_600_000)
  console.log(`[v0] IDM backfill — zone ${zone} — ${FROM.toISOString()} → ${TO.toISOString()} (${hours.toFixed(0)} h)`)

  const sources = defaultIdmSources()
  const store = createNeonIdmStore()

  // One resolve over the whole window: SMARD fetches the overlapping weekly
  // files and the orchestrator upserts every real point into idm_price.
  const curve = await resolvePriceCurve({
    nowMs: fromMs,
    requiredForwardHours: hours,
    sources,
    store,
    zone,
    lookbackHours: 0,
    allowSynthetic: false, // backfill stores ONLY real data
    publishGate: false, // historical load — no publication horizon
  })

  // Provenance breakdown.
  const prov = new Map<string, number>()
  for (const p of curve.provenanceBySlot.values()) prov.set(p, (prov.get(p) ?? 0) + 1)
  const provStr = Array.from(prov.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")
  console.log(`[v0] resolved ${curve.pricedSlots.length} IDM slots — provenance: ${provStr || "none"}`)
  if (curve.missingSlots.length > 0) {
    console.log(`[v0] WARN ${curve.missingSlots.length} required slots still missing after the chain`)
  }

  // Read back what's actually persisted, and compare to the station's DAM
  // (stored telemetry price) on the shared slot grid to show the IDM signal.
  const idmRows = await store.getRange(zone, slotOf(fromMs), slotOf(toMs))
  const idmBySlot = new Map<number, number>(idmRows.map((r) => [r.slot, r.priceEurMwh]))
  console.log(`[v0] idm_price now holds ${idmRows.length} rows in window`)

  const damRows = await db
    .select({ ts: telemetryFrame.ts, price: telemetryFrame.priceEurMwh })
    .from(telemetryFrame)
    .where(
      and(
        eq(telemetryFrame.stationId, STATION),
        gte(telemetryFrame.ts, FROM),
        lte(telemetryFrame.ts, TO),
        sql`${telemetryFrame.priceEurMwh} is not null`,
      ),
    )
    .orderBy(asc(telemetryFrame.ts))

  const damBySlot = new Map<number, number>()
  for (const r of damRows) {
    if (r.price != null) damBySlot.set(slotOf(new Date(r.ts).getTime()), r.price)
  }

  let n = 0
  let sumAbs = 0
  let maxAbs = 0
  let big15 = 0
  let big20pct = 0
  for (const [slot, dam] of damBySlot) {
    const idm = idmBySlot.get(slot)
    if (idm == null) continue
    const d = idm - dam
    const abs = Math.abs(d)
    n++
    sumAbs += abs
    if (abs > maxAbs) maxAbs = abs
    if (abs >= 15) big15++
    if (Math.abs(dam) > 1 && abs / Math.abs(dam) >= 0.2) big20pct++
  }
  if (n > 0) {
    console.log(
      `[v0] IDM vs DAM over ${n} shared slots: mean|Δ|=${(sumAbs / n).toFixed(2)} €/MWh, ` +
        `max|Δ|=${maxAbs.toFixed(2)}, slots≥15€=${big15} (${((big15 / n) * 100).toFixed(1)}%), ` +
        `slots≥20%=${big20pct} (${((big20pct / n) * 100).toFixed(1)}%)`,
    )
    console.log(`[v0] → those divergence slots are exactly what triggers a v4 MPC replan.`)
  } else {
    console.log(`[v0] no overlapping DAM slots to compare (check station/window).`)
  }

  process.exit(0)
}

main().catch((e) => {
  console.error("[v0] IDM backfill error:", e)
  process.exit(1)
})
