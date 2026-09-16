// Compare v5 (adaptive uncertainty-sized reserve) against v4 (flat planning floor).
//
//   set -a && . /vercel/share/.env.project && set +a && \
//     SWEEP_FROM=2026-05-01 SWEEP_TO=2026-05-15 npx -y tsx scripts/measure-v5.ts
//
// Both engines share the same LP solver, event-driven replanning and IDM pricing.
// The ONLY difference is the planning floor:
//   v4: flat socFloorFrac (0.45 of E_max, every step).
//   v5: low base floor (0.20) + a cushion sized from the per-hour demand-forecast
//       uncertainty (P90 − mean) over a short lookahead, clamped to reserveMaxFrac.
// Goal: v5 should hold SoC risk (min-SoC, time-in-risky-band, unserved EV) at or
// below v4 while giving back LESS arbitrage than the blunt flat 0.45 floor.
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

if (process.env.__MV5_CHILD !== "1") {
  const res = spawnSync("npx", ["-y", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: {
      ...process.env,
      __MV5_CHILD: "1",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=react-server`.trim(),
    },
  })
  process.exit(res.status ?? 1)
}

const STATION = process.env.SWEEP_STATION ?? "chargepost_gronau_001"
const FROM = new Date(process.env.SWEEP_FROM ?? "2026-05-01T00:00:00.000Z")
const TO = new Date(process.env.SWEEP_TO ?? "2026-05-15T00:00:00.000Z")

async function main() {
  const { runBacktest } = await import("../lib/backtest")
  const { getV4Params, getV5Params } = await import("../lib/model-registry")

  const v4 = getV4Params()
  const v5 = getV5Params()

  // Hold everything else identical (event-driven + IDM on both) so the only
  // variable is the reserve policy. Sweep v5's coverage fraction (how much of
  // the P90−mean uncertainty energy to bank) to trace the safety/cost frontier.
  const coverages = (process.env.COVERAGES ?? "0.4,0.6,0.8,1.0")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
  const configs: { name: string; params: ReturnType<typeof getV4Params> }[] = [
    { name: "v4 flat floor (0.45)", params: v4 },
    ...coverages.map((cov) => ({
      name: `v5 adaptive cov=${cov}`,
      params: { ...v5, mpc: { ...v5.mpc!, reserveCoverageFrac: cov } },
    })),
  ]

  console.log(
    `[v0] measure-v5 — ${STATION} — ${FROM.toISOString()} → ${TO.toISOString()}\n`,
  )

  const rows: string[] = []
  for (const c of configs) {
    const r = await runBacktest({
      stationId: STATION,
      fromTs: FROM,
      toTs: TO,
      paramOverride: c.params,
      evSource: "metered",
      simulateDamPublishGate: true,
    })
    const k = r.kpis
    // Fraction of frames spent in the risky band (< 20% SoC).
    const riskyPct =
      r.series && r.series.length
        ? (100 * r.series.filter((p) => (p.socPct ?? 100) < 20).length) / r.series.length
        : Number.NaN
    rows.push(
      [
        c.name.padEnd(22),
        `cost=€${k.optimizedCostEur.toFixed(2)}`.padEnd(15),
        `save=${k.savingsPct.toFixed(1)}%`.padEnd(12),
        `minSoC=${k.socMinPct.toFixed(1)}%`.padEnd(14),
        `avgSoC=${k.socAvgPct.toFixed(1)}%`.padEnd(14),
        Number.isFinite(riskyPct) ? `<20%=${riskyPct.toFixed(1)}%`.padEnd(12) : "<20%=n/a".padEnd(12),
        `unservedKwh=${r.totals.evUnservedKwh.toFixed(2)}`.padEnd(18),
        `emerg=${k.emergencyTicks}`.padEnd(12),
        k.mpcReserveFloorAvgPct != null
          ? `floor: avg=${k.mpcReserveFloorAvgPct}% peak=${k.mpcReserveFloorMaxPct}%`
          : "floor: flat",
      ].join(" "),
    )
  }

  console.log(rows.join("\n"))
  console.log(
    `\n[v0] Goal: v5 minSoC ≥ v4 and v5 unserved ≤ v4, while v5 cost ≤ v4 (less` +
      ` arbitrage give-back than the blunt flat floor). The 'floor breathing'` +
      ` line shows the adaptive reserve's mean/peak planning floor.`,
  )
  process.exit(0)
}

main().catch((e) => {
  console.error("[v0] measure-v5 error:", e)
  process.exit(1)
})
