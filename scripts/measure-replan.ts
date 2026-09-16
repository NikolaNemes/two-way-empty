// Measure event-driven replanning + intraday (IDM) pricing for the v4 MPC.
//
//   set -a && . /vercel/share/.env.project && set +a && \
//     SWEEP_FROM=2026-05-12 SWEEP_TO=2026-05-19 npx -y tsx scripts/measure-replan.ts
//
// Runs the v4 backtest over the same window in three configs and prints a table:
//   A) every-slot   — classic MPC, re-solve every control slot, DAM pricing.
//   B) event-driven  — new default: replan on events + safety interval, DAM.
//   C) event+IDM     — event-driven plus live intraday near-term pricing.
// We care about: cost parity/improvement, LP solves (compute), unserved EV
// (must stay 0), and the replan trigger breakdown.
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
const FROM = new Date(process.env.SWEEP_FROM ?? "2026-05-12T00:00:00.000Z")
const TO = new Date(process.env.SWEEP_TO ?? "2026-05-19T00:00:00.000Z")

async function main() {
  const { runBacktest } = await import("../lib/backtest")
  const { getV4Params } = await import("../lib/model-registry")

  const base = getV4Params()
  const mpc = base.mpc!

  const configs: { name: string; mpc: typeof mpc }[] = [
    { name: "A every-slot (classic, DAM)", mpc: { ...mpc, replanMode: "every-slot", useIdmNearTerm: false } },
    { name: "B event-driven (DAM)", mpc: { ...mpc, replanMode: "event-driven", useIdmNearTerm: false } },
    { name: "C event-driven + IDM", mpc: { ...mpc, replanMode: "event-driven", useIdmNearTerm: true } },
  ]

  console.log(
    `[v0] measure-replan — ${STATION} — ${FROM.toISOString()} → ${TO.toISOString()}\n`,
  )

  const rows: string[] = []
  for (const c of configs) {
    const r = await runBacktest({
      stationId: STATION,
      fromTs: FROM,
      toTs: TO,
      paramOverride: { engine: "v4-mpc", mpc: c.mpc },
      evSource: "metered",
      simulateDamPublishGate: true,
    })
    const k = r.kpis
    const t = k.mpcReplanTriggers
    rows.push(
      [
        c.name.padEnd(28),
        `cost=€${k.optimizedCostEur.toFixed(2)}`.padEnd(16),
        `save=€${k.savingsEur.toFixed(2)}(${k.savingsPct.toFixed(1)}%)`.padEnd(22),
        `replans=${k.mpcReplans}`.padEnd(14),
        `saved=${k.mpcReplansSaved}`.padEnd(12),
        `idmSlots=${k.mpcIdmPricedSlots}`.padEnd(14),
        `unservedKwh=${r.totals.evUnservedKwh.toFixed(2)}`.padEnd(18),
        t ? `[init=${t.init} conn=${t.connect} disc=${t.disconnect} idm=${t.idm} safety=${t.safety}]` : "",
      ].join(" "),
    )
  }

  console.log(rows.join("\n"))
  console.log(
    `\n[v0] Parity check: B/C unserved EV must equal A (≈0). Compute: B/C replans ≪ A.\n` +
      `[v0] Economic: C cost should differ from B only where live IDM ≠ DAM on the committed slot.`,
  )
  process.exit(0)
}

main().catch((e) => {
  console.error("[v0] measure-replan error:", e)
  process.exit(1)
})
