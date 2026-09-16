// Verification harness for the price-supply robustness layer.
//   npx -y tsx scripts/price-supply-test.ts
//
// Pure-logic tests (no DB, no network): the DAM publication gate (incl. DST),
// the fallback-chain ordering, coverage/spread accounting, and synthetic
// day-before reconstruction. Sources and the cache store are injected fakes.
import {
  visibleHorizonMs,
  maskToPublished,
  computeCoverageAndSpread,
  resolvePriceCurve,
  slotOf,
  SLOTS_PER_DAY,
  type NamedSource,
  type PriceStore,
  type PricePoint,
  type Provenance,
  type StoredPrice,
} from "../lib/price-supply"
import { SLOT_MS } from "../lib/dispatch-kernel"

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}  ${detail}`)
  }
}

console.log("\n[1] Publication-horizon gate (Europe/Berlin, DST aware)")
{
  // Summer (CEST, UTC+2). Before 13:00 local → horizon = end of TODAY.
  const morning = Date.parse("2026-05-15T10:00:00+02:00")
  const hMorning = visibleHorizonMs(morning)
  check(
    "summer 10:00 -> end-of-today (22:00Z)",
    hMorning === Date.parse("2026-05-15T22:00:00Z"),
    `got ${new Date(hMorning).toISOString()}`,
  )

  // After 13:00 local → horizon = end of TOMORROW.
  const afternoon = Date.parse("2026-05-15T14:00:00+02:00")
  const hAfternoon = visibleHorizonMs(afternoon)
  check(
    "summer 14:00 -> end-of-tomorrow (next 22:00Z)",
    hAfternoon === Date.parse("2026-05-16T22:00:00Z"),
    `got ${new Date(hAfternoon).toISOString()}`,
  )

  // Winter (CET, UTC+1). Before 13:00 local → end of today = next 23:00Z.
  const winterMorning = Date.parse("2026-01-15T09:00:00+01:00")
  const hWinter = visibleHorizonMs(winterMorning)
  check(
    "winter 09:00 -> end-of-today (23:00Z, DST aware)",
    hWinter === Date.parse("2026-01-15T23:00:00Z"),
    `got ${new Date(hWinter).toISOString()}`,
  )

  // Monotonic across spring-forward (29 Mar 2026): horizon never goes backwards.
  let prev = 0
  let mono = true
  for (let h = 0; h < 72; h++) {
    const t = Date.parse("2026-03-28T00:00:00+01:00") + h * 3600_000
    const hz = visibleHorizonMs(t)
    if (hz < prev) mono = false
    prev = hz
  }
  check("horizon monotonic across spring-forward DST", mono)

  // maskToPublished trims beyond-horizon points but keeps the rest.
  const pts: PricePoint[] = Array.from({ length: 200 }, (_, i) => ({
    ts: morning + i * 3600_000,
    priceEurMwh: i,
  }))
  const masked = maskToPublished(pts, morning)
  check("maskToPublished trims future", masked.length < pts.length && masked.length > 0, `kept ${masked.length}/200`)
  check("maskToPublished keeps only < horizon", masked.every((p) => p.ts < hMorning))
}

console.log("\n[2] Coverage + spread accounting")
{
  const cur = slotOf(Date.parse("2026-05-15T00:00:00+02:00"))
  const priceBySlot = new Map<number, number>()
  const prov = new Map<number, Provenance>()
  for (let i = 0; i < 64; i++) {
    priceBySlot.set(cur + i, 20 + (i % 8) * 12.5) // oscillates 20..107.5
    prov.set(cur + i, "amperio")
  }
  const cov = computeCoverageAndSpread(cur, 64, priceBySlot, prov)
  check("coverage = 16h when 64 real slots present", Math.abs(cov.coverageHours - 16) < 0.01, `got ${cov.coverageHours}`)
  check("spread = max-min over window (87.5)", Math.abs(cov.spreadEurMwh - 87.5) < 0.01, `got ${cov.spreadEurMwh}`)

  // Synthetic slot must break contiguous REAL coverage.
  prov.set(cur + 40, "synthetic")
  const cov2 = computeCoverageAndSpread(cur, 64, priceBySlot, prov)
  check("synthetic breaks contiguous real coverage", cov2.coverageHours < 16, `got ${cov2.coverageHours}`)
  check("synthetic slot reported", cov2.syntheticSlots.includes(cur + 40))

  // A hole (missing slot) is reported.
  priceBySlot.delete(cur + 10)
  const cov3 = computeCoverageAndSpread(cur, 64, priceBySlot, prov)
  check("missing slot reported", cov3.missingSlots.includes(cur + 10))
}

// ── Fake source + store factories ──────────────────────────────────────────
function flatSource(name: Provenance, ok: boolean, price = 50): NamedSource {
  return {
    name,
    fetch: async (fromMs, toMs): Promise<PricePoint[]> => {
      if (!ok) throw new Error(`${name} down`)
      const out: PricePoint[] = []
      // Snap to slot grid like a real DAM source.
      for (let s = slotOf(fromMs); s <= slotOf(toMs); s++) out.push({ ts: s * SLOT_MS, priceEurMwh: price })
      return out
    },
  }
}
function memStore(seed: StoredPrice[] = []): PriceStore & { writes: number } {
  const rows = new Map<number, StoredPrice>(seed.map((r) => [r.slot, r]))
  return {
    writes: 0,
    async getRange(_zone, fromSlot, toSlot) {
      return Array.from(rows.values()).filter((r) => r.slot >= fromSlot && r.slot <= toSlot)
    },
    async upsert(_zone, incoming) {
      this.writes += incoming.length
      for (const r of incoming) rows.set(r.slot, { ...r })
    },
  }
}

async function asyncTests() {
  console.log("\n[3] Fallback chain ordering")
  const now = Date.parse("2026-05-15T00:00:00+02:00")

  // Primary healthy → used, not degraded, cache warmed.
  const store1 = memStore()
  const r1 = await resolvePriceCurve({
    nowMs: now,
    requiredForwardHours: 16,
    sources: [flatSource("amperio", true, 50), flatSource("awattar", true, 99)],
    store: store1,
    allowSynthetic: true,
    publishGate: false,
  })
  check("healthy primary -> not degraded", !r1.degraded)
  check("healthy primary -> >=16h coverage", r1.coverageHours >= 16, `got ${r1.coverageHours}`)
  check("healthy primary -> cache warmed", store1.writes > 0, `writes ${store1.writes}`)
  check(
    "primary wins per slot (all amperio, no awattar)",
    Array.from(r1.provenanceBySlot.values()).every((p) => p === "amperio"),
  )

  // Primary down → secondary fills.
  const r2 = await resolvePriceCurve({
    nowMs: now,
    requiredForwardHours: 16,
    sources: [flatSource("amperio", false), flatSource("awattar", true, 70)],
    store: memStore(),
    allowSynthetic: true,
    publishGate: false,
  })
  check("primary down -> secondary fills 16h", r2.coverageHours >= 16 && !r2.degraded, `cov ${r2.coverageHours}`)
  check(
    "provenance is awattar after primary fails",
    Array.from(r2.provenanceBySlot.values()).every((p) => p === "awattar"),
  )

  // All sources down, but cache holds the forward window → cache fills it.
  const cur = slotOf(now)
  const cacheRows: StoredPrice[] = []
  for (let i = 0; i <= 64; i++) {
    cacheRows.push({ slot: cur + i, ts: (cur + i) * SLOT_MS, priceEurMwh: 42, source: "amperio", resampled: false })
  }
  const r3 = await resolvePriceCurve({
    nowMs: now,
    requiredForwardHours: 16,
    sources: [flatSource("amperio", false), flatSource("awattar", false)],
    store: memStore(cacheRows),
    allowSynthetic: true,
    publishGate: false,
  })
  check("all sources down -> cache fills, not degraded", r3.coverageHours >= 16 && !r3.degraded, `cov ${r3.coverageHours}`)
  check("provenance is cache", Array.from(r3.provenanceBySlot.values()).every((p) => p === "cache"))

  // All down, cache only has YESTERDAY (donor) → synthetic day-before fills, flagged degraded.
  const donorRows: StoredPrice[] = []
  for (let i = 0; i < SLOTS_PER_DAY + 64; i++) {
    const slot = cur - SLOTS_PER_DAY + i // covers donor range up to forward window
    donorRows.push({ slot, ts: slot * SLOT_MS, priceEurMwh: 30 + (i % 12) * 5, source: "amperio", resampled: false })
  }
  // Only keep donor history strictly before "now" so the forward window itself is empty.
  const donorOnly = donorRows.filter((r) => r.slot < cur)
  const r4 = await resolvePriceCurve({
    nowMs: now,
    requiredForwardHours: 16,
    sources: [flatSource("amperio", false), flatSource("awattar", false)],
    store: memStore(donorOnly),
    allowSynthetic: true,
    publishGate: false,
  })
  check("all down + only yesterday -> synthetic keeps planner fed", r4.pricedSlots.length > 0, `slots ${r4.pricedSlots.length}`)
  check("synthetic -> flagged degraded", r4.degraded)
  check("synthetic provenance present", Array.from(r4.provenanceBySlot.values()).includes("synthetic"))

  // Total blackout: all down, empty cache, synthetic disabled → empty (caller keeps last good).
  const r5 = await resolvePriceCurve({
    nowMs: now,
    requiredForwardHours: 16,
    sources: [flatSource("amperio", false)],
    store: memStore(),
    allowSynthetic: false,
    publishGate: false,
  })
  check("total blackout -> empty curve, degraded", r5.pricedSlots.length === 0 && r5.degraded)

  console.log("\n[4] Publish gate inside resolve (no future leakage)")
  // A source that returns a FULL week of prices; with the gate on at 10:00
  // summer, nothing at/after end-of-today (22:00Z) may appear.
  const weekSource: NamedSource = {
    name: "amperio",
    fetch: async (): Promise<PricePoint[]> => {
      const out: PricePoint[] = []
      const start = slotOf(now)
      for (let i = 0; i < 7 * SLOTS_PER_DAY; i++) out.push({ ts: (start + i) * SLOT_MS, priceEurMwh: 50 })
      return out
    },
  }
  const gated = await resolvePriceCurve({
    nowMs: Date.parse("2026-05-15T10:00:00+02:00"),
    requiredForwardHours: 16,
    sources: [weekSource],
    store: memStore(),
    allowSynthetic: false,
    publishGate: true,
  })
  const horizon = visibleHorizonMs(Date.parse("2026-05-15T10:00:00+02:00"))
  check(
    "gate: no slot at/after publication horizon",
    gated.pricedSlots.every((s) => s.slot * SLOT_MS < horizon),
    `max ${new Date(Math.max(...gated.pricedSlots.map((s) => s.slot * SLOT_MS))).toISOString()} vs horizon ${new Date(horizon).toISOString()}`,
  )

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

void asyncTests()
