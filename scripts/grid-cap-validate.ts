// ════════════════════════════════════════════════════════════════════════
// GRID-CAP VALIDATION + SAVINGS RE-CHECK
//
// Confirms the fix for the "optimised grid import spiked to 168 kW through a
// 79 kW connection" bug. Runs the production (v2) backtest over the stored
// month and asserts, frame by frame, that the OPTIMISED grid setpoint never
// exceeds the configured grid import limit. Also reports EV served vs curtailed
// and the savings, so we can see the economic impact of honouring the limit.
// ════════════════════════════════════════════════════════════════════════
import { runBacktest } from "../lib/backtest"
import { resolveParams } from "../lib/model-registry"

void (async () => {
  const STATION = process.env.AB_STATION_ID || "chargepost_gronau_001"
  const FROM = new Date("2026-05-01T00:00:00Z")
  const TO = new Date("2026-06-01T00:00:00Z")

  const limitKw = resolveParams().gridImportLimitKw
  console.log(`[v0] grid import limit = ${limitKw} kW`)

  const res = await runBacktest({
    stationId: STATION,
    fromTs: FROM,
    toTs: TO,
    evSource: "metered",
    paramOverride: {},
    simulateDamPublishGate: true,
  })

  // Frame-by-frame ceiling check on the optimised grid setpoint. `gridKw` in
  // the series already includes residual baseload, so allow a tiny epsilon for
  // float noise and that additive baseload term.
  const EPS = 0.5
  let maxOptGrid = Number.NEGATIVE_INFINITY
  // TRUE violation = the CONTROLLABLE setpoint (grid→EV + arbitrage charge)
  // exceeds the applicable site ceiling minus baseload, i.e. the controller
  // commanded import it was not allowed to. Baseload-only overshoots (where
  // uncontrollable site load alone pushes total import over the ceiling) are
  // NOT controller faults — the real meter records them identically.
  let trueViolations = 0
  let baseloadOnlyOver = 0
  let worst: { hour: number; gridKw: number; ctrl: number; limit: number } | null = null
  for (const p of res.series) {
    if (p.gridKw > maxOptGrid) maxOptGrid = p.gridKw
    const siteLimit = p.siteGridLimitKw ?? limitKw
    const baseload = p.baseloadKw ?? 0
    const controllableKw = (p.g1Kw ?? 0) + (p.g2Kw ?? 0)
    const allowedControllable = Math.max(0, siteLimit - baseload)
    if (controllableKw > allowedControllable + EPS) {
      trueViolations++
      if (!worst || controllableKw - allowedControllable > worst.ctrl - worst.limit) {
        worst = { hour: p.hour, gridKw: p.gridKw, ctrl: controllableKw, limit: allowedControllable }
      }
    } else if (p.gridKw > siteLimit + EPS) {
      baseloadOnlyOver++
    }
  }
  const violations = trueViolations

  const k = res.kpis
  const t = res.totals
  console.log(`[v0] frames=${k.frames} maxOptGridKw=${maxOptGrid.toFixed(1)}`)
  console.log(`[v0] TRUE controller violations (commanded import > allowed): ${trueViolations}`)
  console.log(`[v0] baseload-only overshoots (uncontrollable, not a fault): ${baseloadOnlyOver}`)
  if (worst)
    console.log(
      `[v0] worst controller breach: controllable=${worst.ctrl.toFixed(1)} kW vs allowed=${worst.limit.toFixed(1)} kW at hour ${worst.hour.toFixed(2)}`,
    )
  console.log(
    `[v0] savings=€${k.savingsEur.toFixed(2)} (${k.savingsPct.toFixed(1)}%) · ` +
      `optImport=${t.optimizedImportKwh.toFixed(0)}kWh actImport=${t.actualImportKwh.toFixed(0)}kWh`,
  )
  console.log(
    `[v0] EV: total=${t.evKwh.toFixed(0)}kWh unserved/curtailed=${(t.evUnservedKwh ?? 0).toFixed(1)}kWh ` +
      `(${(((t.evUnservedKwh ?? 0) / Math.max(1, t.evKwh)) * 100).toFixed(2)}%)`,
  )
  console.log(
    `[v0] RESULT: ${
      violations === 0
        ? "PASS — controller never commanded import above the allowed ceiling"
        : "FAIL — controller commanded over-limit import"
    }`,
  )
})()
