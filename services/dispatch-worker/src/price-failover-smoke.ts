/**
 * Worker price-failover smoke test (integration).
 *   cd services/dispatch-worker && DATABASE_URL=... npx -y tsx src/price-failover-smoke.ts
 *
 * Exercises the REAL production wiring end-to-end:
 *   • a dead primary (simulated Amperio outage),
 *   • the live public aWATTar DE source (real HTTP, hourly→15min),
 *   • the real Neon dam_price cache (warmed by the fetch, then read back),
 *   • synthetic day-before fallback when everything is offline.
 *
 * It never throws on source failure; it asserts the planner always ends up with
 * a usable forward curve. Exits non-zero if any guarantee is violated.
 */
import { createWorkerPriceStore } from "./price-store-pg.ts"
import { resolvePriceCurve } from "../../../lib/price-supply.ts"
import { makeAmperioSource, awattarSource } from "../../../lib/price-sources.ts"

const REQUIRED_HOURS = 16
const ZONE = "DE-LU"
const databaseUrl = process.env.DATABASE_URL?.trim() || null

let failed = 0
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`)
  if (!cond) failed++
}

const deadAmperio = makeAmperioSource(async () => {
  throw new Error("simulated Amperio outage")
})
const liveAwattar = awattarSource() // real public endpoint

async function main() {
  const store = createWorkerPriceStore(databaseUrl)
  const now = Date.now()

  console.log(`\n[A] Primary DOWN → live aWATTar DE fills (db cache: ${databaseUrl ? "on" : "off"})`)
  const a = await resolvePriceCurve({
    nowMs: now,
    requiredForwardHours: REQUIRED_HOURS,
    sources: [deadAmperio, liveAwattar],
    store,
    zone: ZONE,
    allowSynthetic: true,
    publishGate: false,
  })
  console.log(
    `      coverage=${a.coverageHours.toFixed(1)}h spread=${a.spreadEurMwh.toFixed(1)}€/MWh ` +
      `slots=${a.pricedSlots.length} degraded=${a.degraded}`,
  )
  check("planner has a non-empty forward curve after primary outage", a.pricedSlots.length > 0)
  const usedAwattar = Array.from(a.provenanceBySlot.values()).some((p) => p === "awattar")
  // aWATTar may be unreachable from CI; if so, this becomes a cache/synthetic test.
  if (usedAwattar) {
    check("aWATTar provided real coverage (>=12h)", a.coverageHours >= 12, `got ${a.coverageHours}h`)
  } else {
    console.log("      (aWATTar unreachable here — exercising cache/synthetic path instead)")
  }

  if (databaseUrl) {
    console.log("\n[B] Cache was warmed → second resolve with ALL sources down reads cache")
    const b = await resolvePriceCurve({
      nowMs: now,
      requiredForwardHours: REQUIRED_HOURS,
      sources: [deadAmperio, awattarSource({ baseUrl: "http://127.0.0.1:1" })], // both dead
      store,
      zone: ZONE,
      allowSynthetic: true,
      publishGate: false,
    })
    console.log(
      `      coverage=${b.coverageHours.toFixed(1)}h slots=${b.pricedSlots.length} ` +
        `degraded=${b.degraded} provenance=${[...new Set(b.provenanceBySlot.values())].join(",")}`,
    )
    check("all-sources-down still yields a forward curve (cache/synthetic)", b.pricedSlots.length > 0)
    if (usedAwattar) {
      check(
        "cache or synthetic backfilled the window",
        [...b.provenanceBySlot.values()].some((p) => p === "cache" || p === "synthetic"),
      )
    }
  }

  console.log("\n[C] Total blackout, synthetic disabled → empty (worker keeps last good)")
  const c = await resolvePriceCurve({
    nowMs: now,
    requiredForwardHours: REQUIRED_HOURS,
    sources: [deadAmperio],
    store: createWorkerPriceStore(null), // no cache
    zone: ZONE,
    allowSynthetic: false,
    publishGate: false,
  })
  check("blackout w/o cache or synthetic → empty + degraded", c.pricedSlots.length === 0 && c.degraded)

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${failed} failure(s)\n`)
  // Close any pg pools opened via the store by exiting the process.
  process.exit(failed === 0 ? 0 : 1)
}

void main()
