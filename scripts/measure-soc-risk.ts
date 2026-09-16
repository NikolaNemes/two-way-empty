// Quantify the SoC-cushion vs cost vs curtailment trade-off for the v4 MPC.
//
//   set -a && . /vercel/share/.env.project && set +a && \
//     SWEEP_FROM=2026-05-01 SWEEP_TO=2026-06-01 npx -y tsx scripts/measure-soc-risk.ts
//
// Sweeps the two reserve floors:
//   • socFloorFrac      — the LP PLANNING floor (how full it keeps the pack).
//   • emergencyFloorFrac — the physical HARD floor the real-time controller may
//                          dip to when a car spike exceeds grid + planned discharge.
// Reports: min SoC reached, how often SoC sat in risky bands, EV energy left
// unserved (curtailment), and cost — so the cushion/cost/curtailment trade-off
// is explicit before we change the default.
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

if (process.env.__MR_CHILD !== "1") {
  const res = spawnSync("npx", ["-y", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: {
      ...process.env,
      __MR_CHILD: "1",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=react-server`.trim(),
    },
  })
  process.exit(res.status ?? 1)
}

const STATION = process.env.SWEEP_STATION ?? "chargepost_gronau_001"
const FROM = new Date(process.env.SWEEP_FROM ?? "2026-05-01T00:00:00.000Z")
const TO = new Date(process.env.SWEEP_TO ?? "2026-06-01T00:00:00.000Z")

async function main() {
  const { runBacktest } = await import("../lib/backtest")
  const { getV4Params } = await import("../lib/model-registry")

  const base = getV4Params()
  const mpc = base.mpc!

  // (planning floor, emergency floor) pairs to compare.
  const configs: { name: string; plan: number; emerg: number }[] = [
    { name: "current  (plan .35 / emerg .10)", plan: 0.35, emerg: 0.1 },
    { name: "safer-A  (plan .35 / emerg .20)", plan: 0.35, emerg: 0.2 },
    { name: "safer-B  (plan .45 / emerg .15)", plan: 0.45, emerg: 0.15 },
    { name: "safer-C  (plan .50 / emerg .20)", plan: 0.5, emerg: 0.2 },
    { name: "safest   (plan .55 / emerg .25)", plan: 0.55, emerg: 0.25 },
  ]

  console.log(`[v0] soc-risk sweep — ${STATION} — ${FROM.toISOString()} → ${TO.toISOString()}\n`)

  for (const c of configs) {
    const r = await runBacktest({
      stationId: STATION,
      fromTs: FROM,
      toTs: TO,
      paramOverride: {
        engine: "v4-mpc",
        mpc: { ...mpc, socFloorFrac: c.plan, emergencyFloorFrac: c.emerg },
      },
      evSource: "metered",
      simulateDamPublishGate: true,
    })
    const k = r.kpis
    // Share of frames that sat in risky SoC bands.
    const below20 = r.series.filter((s) => (s.b1SocPct ?? 100) < 20).length
    const below25 = r.series.filter((s) => (s.b1SocPct ?? 100) < 25).length
    const n = r.series.length || 1
    console.log(
      [
        c.name.padEnd(34),
        `minSoC=${k.socMinPct.toFixed(1)}%`.padEnd(14),
        `<20%=${((100 * below20) / n).toFixed(1)}%`.padEnd(12),
        `<25%=${((100 * below25) / n).toFixed(1)}%`.padEnd(12),
        `unservedKwh=${r.totals.evUnservedKwh.toFixed(2)}`.padEnd(20),
        `emergTicks=${k.emergencyTicks}`.padEnd(16),
        `cost=€${k.optimizedCostEur.toFixed(2)}`.padEnd(15),
        `save=${k.savingsPct.toFixed(1)}%`,
      ].join(" "),
    )
  }
  console.log(
    `\n[v0] Read: higher floors raise minSoC (more cushion) but cost more and CAN raise unservedKwh\n` +
      `[v0] (less battery free to absorb the biggest spikes). Pick the safest row with unservedKwh≈current.`,
  )
  process.exit(0)
}

main().catch((e) => {
  console.error("[v0] measure-soc-risk error:", e)
  process.exit(1)
})
