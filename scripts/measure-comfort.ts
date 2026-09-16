// Quantify the SOFT COMFORT BAND (anti-"lazy refill") on top of v5.
//
//   set -a && . /vercel/share/.env.project && set +a && \
//     SWEEP_FROM=2026-05-01 SWEEP_TO=2026-05-15 npx -y tsx scripts/measure-comfort.ts
//
// The hard reserve floor (v5: 0.20 base + adaptive cushion) guarantees the plan
// never DISCHARGES below it for arbitrage. But between floor and ceiling the LP
// only rebuilds when price beats the λ gate, so SOC can COAST DOWN toward the
// floor instead of proactively refilling in cheap slots — the "lazy" drift.
//
// The comfort band adds a SOFT target above the hard floor with a penalised
// slack, so the optimiser tops the buffer back up early in the CHEAPEST
// reachable slots. This sweep checks that turning it on:
//   • raises avg/min SOC and cuts time spent drifting toward the floor,
//   • does NOT relax the hard floor (no extra unserved / emergency ticks),
//   • costs little (penalty is small vs price spread; refills land in cheap slots).
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

if (process.env.__MC_CHILD !== "1") {
  const res = spawnSync("npx", ["-y", "tsx", fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: {
      ...process.env,
      __MC_CHILD: "1",
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

  // Baseline = v5 with comfort OFF; then sweep (target, penalty) settings.
  const configs: { name: string; comfort: boolean; target?: number; penalty?: number }[] = [
    { name: "v5 baseline (comfort OFF)", comfort: false },
    { name: "comfort 25% / €0.01", comfort: true, target: 0.25, penalty: 0.01 },
    { name: "comfort 25% / €0.02", comfort: true, target: 0.25, penalty: 0.02 },
    { name: "comfort 25% / €0.04", comfort: true, target: 0.25, penalty: 0.04 },
    { name: "comfort 30% / €0.02", comfort: true, target: 0.3, penalty: 0.02 },
  ]

  console.log(`[v0] comfort-band sweep — ${STATION} — ${FROM.toISOString()} → ${TO.toISOString()}\n`)

  const rows: string[] = []
  for (const c of configs) {
    const r = await runBacktest({
      stationId: STATION,
      fromTs: FROM,
      toTs: TO,
      paramOverride: {
        ...v5,
        mpc: {
          ...mpc,
          comfortBandEnabled: c.comfort,
          comfortTargetFrac: c.target ?? mpc.comfortTargetFrac,
          comfortPenaltyEurPerKwh: c.penalty ?? mpc.comfortPenaltyEurPerKwh,
        },
      },
      evSource: "metered",
      simulateDamPublishGate: true,
    })
    const k = r.kpis
    const n = r.series.length || 1
    const below20 = r.series.filter((s) => (s.socPct ?? 100) < 20).length
    const below25 = r.series.filter((s) => (s.socPct ?? 100) < 25).length
    rows.push(
      [
        c.name.padEnd(26),
        `minSoC=${k.socMinPct.toFixed(1)}%`.padEnd(14),
        `avgSoC=${k.socAvgPct.toFixed(1)}%`.padEnd(14),
        `<20%=${((100 * below20) / n).toFixed(1)}%`.padEnd(12),
        `<25%=${((100 * below25) / n).toFixed(1)}%`.padEnd(12),
        `unservedKwh=${r.totals.evUnservedKwh.toFixed(2)}`.padEnd(18),
        `emerg=${k.emergencyTicks}`.padEnd(11),
        `cost=€${k.optimizedCostEur.toFixed(2)}`.padEnd(15),
        `save=${k.savingsPct.toFixed(1)}%`,
      ].join(" "),
    )
  }

  console.log(rows.join("\n"))
  console.log(
    `\n[v0] Read: a good comfort setting RAISES avgSoC and CUTS <25% time vs the` +
      ` baseline, with unserved/emerg UNCHANGED (hard floor intact) and only a` +
      ` tiny cost give-back. Pick the smallest penalty that flattens the <25% drift.`,
  )
  process.exit(0)
}

main().catch((e) => {
  console.error("[v0] measure-comfort error:", e)
  process.exit(1)
})
