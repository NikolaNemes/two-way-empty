// Measure the v5 ARBITRAGE STAND-DOWN guardrail against the v5 baseline.
//
//   set -a && . /vercel/share/.env.project && set +a && \
//     SWEEP_FROM=2026-05-01 SWEEP_TO=2026-05-15 npx -y tsx scripts/measure-standdown.ts
//
// Everything is held at the v5 config (adaptive reserve cov=0.7). The ONLY
// variable is stand-down: when a low/very-risky scenario is detected (SOC near
// the planning floor OR a forecast P90 demand spike within the lookahead rivals
// grid headroom), that solve suspends planned arbitrage discharge (dailyCap→0):
// cover demand from the grid, hold/refill the pack, leave it for the emergency tap.
// Goal: stand-down should cut unserved EV / emergency ticks / time-in-risky-band
// for an acceptable arbitrage give-back, and we can read how often it fired.
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

if (process.env.__MSD_CHILD !== "1") {
  const res = spawnSync("npx", ["-y", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: {
      ...process.env,
      __MSD_CHILD: "1",
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
  const { getV5Params } = await import("../lib/model-registry")

  const v5 = getV5Params()
  const mpc = v5.mpc!

  // Variants: baseline (off) + stand-down on at a few demand-risk thresholds.
  // headroomFrac=1.0 ⇒ only when P90 meets/exceeds the grid cap (rarest);
  // lower fracs (0.8) make the demand-risk trigger fire a bit earlier.
  const configs: { name: string; params: ReturnType<typeof getV5Params> }[] = [
    { name: "v5 baseline (off)", params: v5 },
    {
      name: "v5 +standdown h=1.0",
      params: { ...v5, mpc: { ...mpc, standDownEnabled: true, standDownHeadroomFrac: 1.0, standDownSocMarginFrac: 0.05 } },
    },
    {
      name: "v5 +standdown h=0.8",
      params: { ...v5, mpc: { ...mpc, standDownEnabled: true, standDownHeadroomFrac: 0.8, standDownSocMarginFrac: 0.05 } },
    },
    {
      name: "v5 +standdown h=0.8 m=0.10",
      params: { ...v5, mpc: { ...mpc, standDownEnabled: true, standDownHeadroomFrac: 0.8, standDownSocMarginFrac: 0.1 } },
    },
  ]

  console.log(`[v0] measure-standdown — ${STATION} — ${FROM.toISOString()} → ${TO.toISOString()}\n`)

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
    const riskyPct =
      r.series && r.series.length
        ? (100 * r.series.filter((p) => (p.socPct ?? 100) < 20).length) / r.series.length
        : Number.NaN
    rows.push(
      [
        c.name.padEnd(26),
        `cost=€${k.optimizedCostEur.toFixed(2)}`.padEnd(15),
        `save=${k.savingsPct.toFixed(1)}%`.padEnd(12),
        `minSoC=${k.socMinPct.toFixed(1)}%`.padEnd(14),
        `avgSoC=${k.socAvgPct.toFixed(1)}%`.padEnd(14),
        Number.isFinite(riskyPct) ? `<20%=${riskyPct.toFixed(1)}%`.padEnd(12) : "<20%=n/a".padEnd(12),
        `unservedKwh=${r.totals.evUnservedKwh.toFixed(2)}`.padEnd(18),
        `emerg=${k.emergencyTicks}`.padEnd(12),
        k.mpcStandDownSolves != null ? `standDowns=${k.mpcStandDownSolves}` : "standDowns=off",
      ].join(" "),
    )
  }

  console.log(rows.join("\n"))
  console.log(
    `\n[v0] Goal: stand-down rows should show lower unservedKwh / emerg / <20% vs` +
      ` baseline, with a modest cost give-back. 'standDowns' counts solves where` +
      ` planned arbitrage was suspended — expect it small (rare high-risk only).`,
  )
  process.exit(0)
}

main().catch((e) => {
  console.error("[v0] measure-standdown error:", e)
  process.exit(1)
})
