// ONE-OFF DIAGNOSTIC — client feedback (Aug 20 2026): the Aug 13–19 tariff
// comparison shows 440 kWh "extra cycling" (−15.41 € wear) on a week with only
// ~1,171 kWh import, flipping the net to −1.97 €. Suspicions:
//   (A) measured battery throughput includes idle jitter/balancing that would
//       exist WITHOUT load shifting too, but the baseline gets ~0 because its
//       overhead model multiplies a near-zero raw round-trip figure;
//   (B) timingValue compares costs of DIFFERENT volumes (baseline fills the
//       pack to 95% at window start — energy that stays in the pack).
// This script reruns the exact report path and prints the decomposition.
//
// Run: NODE_OPTIONS="--conditions=react-server" pnpm exec tsx scripts/diagnose-tariff-week.ts

import { runBacktestForRange } from "../app/actions/backtest"
import { getIdmPricesForRange } from "../app/actions/idm-prices"
import { compute, DEFAULT_FLAT_CT, DEFAULT_ADDER_CT, DEFAULT_CYCLING_CT } from "../lib/tariff-compute"

const STATION = process.argv[2] ?? "chargepost_norderstedt_001"
// The report UI sends LOCAL-midnight boundaries (Europe/Berlin, CEST = UTC+2).
// Optional argv[3]/argv[4] override the window (ISO strings).
const FROM = process.argv[3] ?? "2026-08-12T22:00:00.000Z"
const TO = process.argv[4] ?? "2026-08-19T21:59:59.999Z"

async function main() {
  console.log("[diag] running range backtest…")
  const data = await runBacktestForRange({ stationId: STATION, fromIso: FROM, toIso: TO })
  const idm = await getIdmPricesForRange({ fromIso: FROM, toIso: TO })
  const idmBySlot = new Map<number, number>(idm.prices.map((p) => [p.slot, p.priceEurMwh]))
  const c = compute(data, idmBySlot, DEFAULT_FLAT_CT, DEFAULT_ADDER_CT, DEFAULT_CYCLING_CT, 84)
  if (!c) {
    console.log("[diag] compute returned null")
    return
  }
  const d = c.throughputDiag
  console.log("=== VOLUMES ===")
  console.log(`import (actual):      ${c.totalImportKwh.toFixed(1)} kWh`)
  console.log(`import (baseline):    ${c.noArbImportKwh.toFixed(1)} kWh  (Δ ${(c.noArbImportKwh - c.totalImportKwh).toFixed(1)})`)
  console.log("=== WEAR / THROUGHPUT ===")
  console.log(`throughput as-run:    ${c.throughputWithArbKwh.toFixed(1)} kWh → wear ${c.wearWithArb.toFixed(2)} €`)
  console.log(`throughput baseline:  ${c.throughputNoArbKwh.toFixed(1)} kWh (raw ${c.throughputNoArbRawKwh.toFixed(1)} × ${c.noArbOverheadFactor.toFixed(3)}) → wear ${c.wearNoArb.toFixed(2)} €`)
  console.log(`extra wear charged:   ${c.arbExtraWear.toFixed(2)} €  (${(c.throughputWithArbKwh - c.throughputNoArbKwh).toFixed(1)} kWh)`)
  console.log("=== MEASURED THROUGHPUT DECOMPOSITION (series basis) ===")
  console.log(`bms Σ|P|dt:           ${d.bmsKwh.toFixed(1)} kWh  (charge ${d.chargeKwh.toFixed(1)} / discharge ${d.dischargeKwh.toFixed(1)})`)
  console.log(`deadband (<2 kW):     ${d.deadbandKwh.toFixed(1)} kWh  — idle jitter`)
  console.log(`SOC-implied:          ${d.socImpliedKwh.toFixed(1)} kWh`)
  console.log(`baseline sim:         discharge ${d.noArbDischargeKwh.toFixed(1)} / charge ${d.noArbChargeKwh.toFixed(1)} kWh`)
  console.log("=== ECONOMY ===")
  console.log(`flat:                 ${c.flatCost.toFixed(2)} €   dynamic: ${c.dynamicCost.toFixed(2)} €   diff: ${c.diff.toFixed(2)} €`)
  console.log(`baseline procurement: ${c.procurementNoArbCost.toFixed(2)} € (${c.noArbBlendedCt.toFixed(2)} ct)  timing: ${c.timingValue.toFixed(2)} €`)
  console.log(`stored-energy credit: ${c.socEdgeCreditEur.toFixed(2)} € (${c.storedDiffKwh.toFixed(1)} kWh left in pack by baseline at window end)`)
  console.log(`net saving:           ${c.netSaving.toFixed(2)} €`)
  // Volume-mismatch share of timing value: price the EXTRA baseline kWh at the
  // baseline blended rate — how much of "timing" is just phantom volume?
  const volKwh = c.noArbImportKwh - c.totalImportKwh
  const volEur = volKwh * (c.noArbBlendedCt / 100)
  console.log("=== SUSPICION CHECKS ===")
  console.log(`(B) phantom volume in timing: ${volKwh.toFixed(1)} kWh ≈ ${volEur.toFixed(2)} € of the ${c.timingValue.toFixed(2)} € timing value`)
  console.log(`(A) idle jitter (excluded from both wear bases since aug 21): deadband ${d.deadbandKwh.toFixed(1)} kWh ≈ ${(d.deadbandKwh * DEFAULT_CYCLING_CT / 100).toFixed(2)} € — should NOT appear in the ${c.arbExtraWear.toFixed(2)} € extra wear`)
}

main().catch((e) => {
  console.error("[diag] error:", e instanceof Error ? e.message : e)
  process.exit(1)
})
