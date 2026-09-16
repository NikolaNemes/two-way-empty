// Headless A/B harness: replay the PRODUCTION v5 MPC over the stored window at
// several receding-horizon lengths, under the REALISTIC DAM publish gate, to
// test whether seeing further into the next day (once tomorrow's DAM is
// published ~13:00 Berlin) lets the optimizer DEFER charging to a cheaper — or
// negative-priced — trough instead of greedily filling to 95% in today's cheap
// hours.
//
// WHY this is the right experiment (see v0_memories dispatch-optimizer.md):
//   • Horizon is capped at mpc.horizonSteps (default 96 = 24h) AND truncated at
//     the first unpublished price slot (visibleHorizonMs).
//   • After 13:00 local, tomorrow's DAM IS published (~35h ahead) but the 24h
//     cap throws it away — so today's trough and tomorrow's (possibly NEGATIVE)
//     trough never compete to fill the same terminal energy.
//   • Extending the horizon to ~140 steps (35h) keeps tomorrow's curve in view,
//     so cost-minimization defers charging on its own ONLY when it pays — no
//     blunt idle-SoC cap needed.
//
// The DAM publish GATE stays ON for every variant, so the longer horizon never
// sees beyond what was actually published — this measures real opportunity, not
// look-ahead leakage.
//
// Run (sources the platform DATABASE_URL):
//   set -a && . /vercel/share/.env.project && set +a && npx -y tsx scripts/horizon-ab-test.ts
//
// lib/backtest.ts imports "server-only", which THROWS under plain tsx. We
// re-exec ourselves ONCE with --conditions=react-server (server-only → empty
// module) and dynamic-import the project code in the child.
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

if (process.env.__HORIZON_CHILD !== "1") {
  const res = spawnSync("npx", ["-y", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: {
      ...process.env,
      __HORIZON_CHILD: "1",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=react-server`.trim(),
    },
  })
  process.exit(res.status ?? 1)
}

import type { KernelParams } from "../lib/model-registry"

const STATION = "chargepost_gronau_001"
const FROM = new Date("2026-05-01T00:00:00.000Z")
const TO = new Date("2026-06-01T00:00:00.000Z")

type Variant = { name: string; horizonSteps: number }

// All variants are the PRODUCTION v5 engine + realistic publish gate; ONLY the
// receding-horizon length changes. 96 = current 24h baseline; 120 ≈ 30h; 140 ≈
// 35h (full next-day visibility once tomorrow's DAM is published).
const variants: Variant[] = [
  { name: "H=96  (24h, current)", horizonSteps: 96 },
  { name: "H=120 (30h)", horizonSteps: 120 },
  { name: "H=140 (35h) ★", horizonSteps: 140 },
]

function pad(s: string, n: number) {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}
function padL(s: string, n: number) {
  return s.length >= n ? s : " ".repeat(n - s.length) + s
}

async function main() {
  // Deferred import: only AFTER the re-exec guard, so the server-only static
  // import in lib/backtest is evaluated under --conditions=react-server.
  const { runBacktest } = await import("../lib/backtest")
  const { getV5Params } = await import("../lib/model-registry")

  console.log(`[v0] Horizon A/B · ${FROM.toISOString()} → ${TO.toISOString()} · v5 engine · DAM gate ON · metered EV`)

  const rows: string[][] = []
  let baselineSavings = 0
  let baselineNegCapture = 0

  for (const v of variants) {
    // Build the FULL v5 param set, then override ONLY mpc.horizonSteps. (resolveParams
    // merges shallowly, so we must spread the whole mpc block — not pass a partial.)
    const base = getV5Params()
    const override: Partial<KernelParams> = {
      ...base,
      mpc: { ...base.mpc!, horizonSteps: v.horizonSteps },
    }

    const res = await runBacktest({
      stationId: STATION,
      fromTs: FROM,
      toTs: TO,
      evSource: "metered",
      paramOverride: override,
      simulateDamPublishGate: true, // realistic — never see beyond published DAM
    })

    const k = res.kpis
    // Derived: energy imported while the DA price was negative (kWh) — the
    // "paid to charge" opportunity the longer horizon is meant to capture.
    // Approximated from the (downsampled) series: Σ gridKw·Δt over neg-price points.
    let negImportKwh = 0
    const s = res.series
    for (let i = 1; i < s.length; i++) {
      const p = s[i].priceEurMwh
      if (p != null && p < 0 && s[i].gridKw > 0) {
        const dtH = s[i].hour - s[i - 1].hour
        if (dtH > 0) negImportKwh += s[i].gridKw * dtH
      }
    }

    if (v.horizonSteps === 96) {
      baselineSavings = k.savingsEur
      baselineNegCapture = negImportKwh
    }
    const dSav = k.savingsEur - baselineSavings
    const dNeg = negImportKwh - baselineNegCapture

    rows.push([
      v.name,
      `EUR ${k.savingsEur.toFixed(2)}`,
      `${k.savingsPct.toFixed(1)}%`,
      v.horizonSteps === 96 ? "-" : `${dSav >= 0 ? "+" : ""}EUR ${dSav.toFixed(2)}`,
      `${negImportKwh.toFixed(1)}`,
      v.horizonSteps === 96 ? "-" : `${dNeg >= 0 ? "+" : ""}${dNeg.toFixed(1)}`,
      k.batteryCycles.toFixed(2),
      `${k.socMinPct.toFixed(0)}-${k.socMaxPct.toFixed(0)}%`,
      `${res.totals.evUnservedKwh?.toFixed(1) ?? "?"}`,
      `${k.mpcReplans ?? "?"}`,
    ])
  }

  const head = [
    "variant",
    "savings",
    "savings%",
    "vs H=96",
    "neg-price kWh",
    "vs H=96",
    "cycles",
    "soc band",
    "unserved",
    "replans",
  ]
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  console.log("")
  console.log(head.map((h, i) => pad(h, widths[i])).join("  "))
  console.log(widths.map((w) => "-".repeat(w)).join("  "))
  for (const r of rows) {
    console.log(r.map((c, i) => (i === 0 ? pad(c, widths[i]) : padL(c, widths[i]))).join("  "))
  }
  console.log("")
  console.log("[v0] Higher savings + more neg-price kWh at longer H ⇒ the horizon cap was leaving")
  console.log("[v0] cheaper/negative next-day troughs on the table. Watch unserved≈0 & soc band for safety.")
  process.exit(0)
}

main().catch((e) => {
  console.error("[v0] harness error:", e)
  process.exit(1)
})
