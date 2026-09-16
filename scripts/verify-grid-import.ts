/**
 * VERIFY-GRID-IMPORT — deterministic proof that the v5 kernel WILL command a
 * non-zero grid-import clearance under the conditions that warrant it, and a
 * ZERO clearance under the conditions that don't.
 * ════════════════════════════════════════════════════════════════════════
 *
 * WHY: on-site live tests keep landing in states where g[0] = 0 is the CORRECT
 * answer (expensive hour + full battery + no car). That's not a bug — clearance
 * is a CEILING and the energy balance g[t] = demand[t] + charge[t] − discharge[t]
 * makes it zero exactly then. This harness removes the guesswork: it runs the
 * REAL LP (solveHorizon) + the REAL wire mapping (toDispatchPayload) against
 * controlled inputs, so we can prove — independent of what the site happens to
 * be doing — that the kernel emits non-zero import when it should.
 *
 * Each scenario asserts BOTH legs the user cares about:
 *   • PLAN  — the solved trajectory gridScheduleKw has the expected import.
 *   • TICK  — the committed g[0] mapped to the wire (P_grid_clearance_w) matches.
 *
 * Run:  NODE_OPTIONS="--conditions=react-server" npx -y tsx scripts/verify-grid-import.ts
 */

import { solveHorizon, getGlpk } from "../lib/optimizer/solver"
import { toDispatchPayload, commandedGridImportKw, type DecideTickResult } from "../lib/dispatch-kernel"
import { OPTIMIZER_DEFAULTS, GRID_MAX_KW, type OptimizerParams } from "../lib/optimizer/params"
import { compressPlanToCommands } from "../lib/plan-commands"
import type { PlanSnapshot, PlanStep } from "../lib/dispatcher-status"

const mpc: OptimizerParams = OPTIMIZER_DEFAULTS
const CAP = mpc.usableEnergyKwh // 190 kWh usable
const socToKwh = (pct: number) => (pct / 100) * CAP

interface Scenario {
  name: string
  why: string
  socPct: number
  /** Per-step DA prices (€/MWh). Length = horizon. */
  prices: number[]
  /** Per-step forecast demand (kW). */
  demandKw: number[]
  /** Live grid-import ceiling (kW). */
  headroomKw: number
  /** Daily self-consumption discharge cap (kWh). */
  dailyCapKwh: number
  /** What we expect g[0] (committed clearance) to be. */
  expect: "nonzero" | "zero" | "maxed"
}

// Short 4h horizon (16 × 15-min) keeps the proof fast and legible.
const H = 16
const flat = (v: number) => Array.from({ length: H }, () => v)
// Cheapest at step 0, gentle ramp, then an expensive peak in the back half.
// Step 0 being the global cheapest makes the LP charge NOW (committed g[0] > 0)
// rather than deferring among equal-priced slots.
const troughThenPeak = [
  ...Array.from({ length: 8 }, (_, i) => 30 + i * 2), // 30,32,…,44 €/MWh
  ...flat(220).slice(0, 8), // expensive peak
]

const scenarios: Scenario[] = [
  {
    name: "A · CHARGE-TO-PEAK-SHAVE (cheap now, a car charges at the peak)",
    why: "Cheap trough + forecast car demand during the peak ⇒ LP banks energy NOW to serve that car from the battery later. g[0] = charge power.",
    socPct: 30,
    prices: troughThenPeak,
    demandKw: [...flat(0).slice(0, 8), ...flat(60).slice(0, 8)], // car arrives for the peak
    headroomKw: GRID_MAX_KW,
    dailyCapKwh: mpc.dailyDemandCapKwh,
    expect: "nonzero",
  },
  {
    name: "A2 · PURE λ-BANKING (deeply cheap, no car at all)",
    why: "Prices far below the AUTO λ-gate (≈90% of the median) ⇒ worth importing to bank against terminal value even with zero demand.",
    socPct: 50,
    // Strictly cheapest at step 0 (rising 5,7,…) so banking is unambiguously
    // best NOW — all far below the AUTO λ-gate, so g[0] charges at the cap.
    prices: Array.from({ length: H }, (_, i) => 5 + i * 2),
    demandKw: flat(0),
    headroomKw: GRID_MAX_KW,
    dailyCapKwh: mpc.dailyDemandCapKwh,
    expect: "nonzero",
  },
  {
    name: "E · AUTO-λ CHEAP-HOUR RECHARGE (elevated regime, no car)",
    why: "Median ≈€95/MWh ⇒ AUTO λ-gate floats up to ≈€70/MWh, so the €50 trough at step 0 clears it ⇒ plan RECHARGES the buffer now. Under the OLD fixed λ=0.05 (€39 gate) this stayed ZERO — that's the drift the user reported.",
    socPct: 50,
    // Cheapest slot well above the old €39 gate but below the AUTO gate: proves
    // the recharge is specifically an AUTO-λ behaviour, not pure deep-trough banking.
    prices: [50, ...flat(95).slice(0, H - 1)],
    demandKw: flat(0), // no car ⇒ any import is recharge (charging the buffer)
    headroomKw: GRID_MAX_KW,
    dailyCapKwh: mpc.dailyDemandCapKwh,
    expect: "nonzero",
  },
  {
    name: "B · DEMAND-IMPORT (car at the reserve floor)",
    why: "SOC at the planning floor ⇒ battery can't discharge ⇒ a 60 kW car is served straight from the grid.",
    socPct: 20, // = V5 base floor (0.2 × E_max)
    prices: flat(220), // expensive: with SOC available it WOULD discharge — but it can't
    demandKw: flat(60), // below the grid cap ⇒ clearance should land at ~60, NOT maxed
    headroomKw: GRID_MAX_KW,
    dailyCapKwh: mpc.dailyDemandCapKwh,
    expect: "nonzero",
  },
  {
    name: "C · OVERLOAD (two cars above the grid cap)",
    why: "Demand 150 kW > grid cap ⇒ import pins at the cap, battery covers the gap. Clearance = headroom.",
    socPct: 60,
    prices: flat(120),
    demandKw: flat(150),
    headroomKw: GRID_MAX_KW,
    dailyCapKwh: 9999, // let the battery assist freely
    expect: "maxed",
  },
  {
    name: "D · CONTROL (expensive + full battery + no car)",
    why: "Nothing to charge, nothing to serve, too expensive to bank ⇒ g[0] = 0 is CORRECT (what live tests keep hitting).",
    socPct: 95,
    prices: flat(220),
    demandKw: flat(0),
    headroomKw: GRID_MAX_KW,
    dailyCapKwh: mpc.dailyDemandCapKwh,
    expect: "zero",
  },
]

function classify(clearanceKw: number, headroomKw: number): "nonzero" | "zero" | "maxed" {
  if (clearanceKw <= 0.05) return "zero"
  if (clearanceKw >= headroomKw - 0.5) return "maxed"
  return "nonzero"
}

/**
 * REGRESSION GUARD for compressPlanToCommands (lib/plan-commands.ts).
 *
 * The bug this catches: the run-length encoder once keyed runs on
 * `P_grid_clearance_w`, which became the CONSTANT import envelope after the
 * clearance/request split. Per-slot SETPOINT dips (the real `gridKw`, now on
 * `P_grid_request_w`) were therefore invisible — the external /replan collapsed
 * a plan like 79.5→5.5→51.4 into ONE command holding 79.5 for hours, masking
 * the dip the in-app view showed. Here we feed a synthetic plan with exactly
 * that shape (constant reserve + ceiling, so ONLY the setpoint varies) and prove
 * the dip survives as distinct commands with the correct signed setpoints.
 */
function makeStep(i: number, gridKw: number, reserveFloorPct: number): PlanStep {
  const SLOT_MS = 15 * 60 * 1000
  const baseMs = Date.UTC(2026, 5, 16, 12, 0, 0) // arbitrary fixed anchor
  return {
    slot: 1_000_000 + i,
    ts: new Date(baseMs + i * SLOT_MS).toISOString(),
    priceEurMwh: 50 + i, // strictly varying price must NOT affect coalescing
    gridKw,
    demandKw: 0,
    socPct: 50,
    reserveFloorPct,
  }
}

function makeSnapshot(steps: PlanStep[], gridImportLimitKw: number): PlanSnapshot {
  return {
    solvedAt: Date.now(),
    baseSlot: steps[0]?.slot ?? 0,
    stepHours: 0.25,
    capacityKwh: CAP,
    horizonSteps: steps.length,
    status: "optimal",
    objectiveEur: 0,
    clearanceKw: steps[0]?.gridKw ?? 0,
    plannedGridKw: steps[0]?.gridKw ?? 0,
    gridImportLimitKw,
    reserveFloorStep1Pct: steps[0]?.reserveFloorPct ?? 20,
    socCeilingPct: 90,
    socFloorPct: 10,
    adaptiveReserve: false,
    steps,
  }
}

function check(label: string, cond: boolean, detail: string): boolean {
  console.log(`        ${cond ? "·" : "✗"} ${label}: ${detail}`)
  return cond
}

function verifyCommandCompression(): boolean {
  console.log("🧩 COMMAND COMPRESSION · per-slot setpoint dips must survive run-length encoding")
  const ENVELOPE_KW = GRID_MAX_KW

  // Plan with a dip: 79.5 (×2) → 5.5 (×2) → 51.4 (×2). Reserve + ceiling are
  // CONSTANT, so the ONLY thing changing is the grid setpoint — the precise case
  // the old envelope-keyed coalescer collapsed into a single command.
  const RESERVE = 23
  const pattern = [79.5, 79.5, 5.5, 5.5, 51.4, 51.4]
  const steps = pattern.map((kw, i) => makeStep(i, kw, RESERVE))
  const snap = makeSnapshot(steps, ENVELOPE_KW)
  const cmds = compressPlanToCommands(snap, { siteId: "verify", assetId: "verify" })

  const gridKws = cmds.map((c) => c.gridKw)
  const setpointWs = cmds.map((c) => c.setpointW)
  const clearances = cmds.map((c) => c.payload.station.P_grid_clearance_w)
  const expectedEnvelopeW = Math.round(ENVELOPE_KW * 1000)

  let ok = true
  // 1. Exactly 3 runs — the dip is NOT masked into one long command.
  ok = check("run count", cmds.length === 3, `${cmds.length} commands (expected 3)`) && ok
  // 2. The run setpoints reproduce the dip in order.
  ok =
    check(
      "setpoint sequence",
      JSON.stringify(gridKws) === JSON.stringify([79.5, 5.5, 51.4]),
      `gridKw=${JSON.stringify(gridKws)} (expected [79.5,5.5,51.4])`,
    ) && ok
  // 3. The low dip (5.5 kW) is actually present as its own command.
  ok = check("dip present", gridKws.includes(5.5), `5.5 kW command ${gridKws.includes(5.5) ? "found" : "MISSING"}`) && ok
  // 4. setpointW carries the signed (neg=import) per-run setpoint, NOT the envelope.
  ok =
    check(
      "signed setpointW",
      JSON.stringify(setpointWs) === JSON.stringify([-79500, -5500, -51400]),
      `setpointW=${JSON.stringify(setpointWs)} (expected [-79500,-5500,-51400])`,
    ) && ok
  // 5. The clearance envelope is constant across every command == the limit.
  ok =
    check(
      "constant envelope",
      clearances.every((w) => w === expectedEnvelopeW),
      `P_grid_clearance_w=${JSON.stringify(clearances)} (expected all ${expectedEnvelopeW})`,
    ) && ok
  // 6. Each run spans its 2 slots (run-length encoding still collapses identical neighbours).
  ok =
    check(
      "run spans",
      JSON.stringify(cmds.map((c) => c.slotSpan)) === JSON.stringify([2, 2, 2]),
      `slotSpan=${JSON.stringify(cmds.map((c) => c.slotSpan))}`,
    ) && ok

  // 7. NEGATIVE CONTROL: a flat plan (identical setpoint + reserve) collapses to ONE command.
  const flatSteps = [80, 80, 80, 80].map((kw, i) => makeStep(i, kw, RESERVE))
  const flatCmds = compressPlanToCommands(makeSnapshot(flatSteps, ENVELOPE_KW), { siteId: "verify", assetId: "verify" })
  ok = check("flat plan collapses", flatCmds.length === 1, `${flatCmds.length} command (expected 1)`) && ok

  // 8. RESERVE-ONLY change still splits (reserve floor is part of the key).
  const reserveSteps = [80, 80, 80, 80].map((kw, i) => makeStep(i, kw, i < 2 ? 23 : 20))
  const reserveCmds = compressPlanToCommands(makeSnapshot(reserveSteps, ENVELOPE_KW), {
    siteId: "verify",
    assetId: "verify",
  })
  ok = check("reserve-only split", reserveCmds.length === 2, `${reserveCmds.length} commands (expected 2)`) && ok

  console.log(`        → ${ok ? "✅ PASS" : "❌ FAIL"}\n`)
  return ok
}

/**
 * REGRESSION GUARD for commandedGridImportKw (lib/dispatch-kernel.ts).
 *
 * We command the FULL planned grid draw g[t] whenever the plan imports
 * (g > eps), and 0 only when the LP intentionally plans g ≈ 0 (battery-serve /
 * idle slots). This REVERSES the old "only command the g>demand charging
 * surplus" rule: live BMS-baseline evidence (chargepost_gronau_001) showed that
 * with P_grid_request ≈ 0 the station serves load from the BATTERY — so zeroing
 * the request in cheap g≈demand slots cycled the battery at exactly the moments
 * the plan wanted to buy cheap grid. Demand no longer participates in the
 * decision. This pins the new contract so it can't silently regress.
 */
function verifyCommandedImport(): boolean {
  console.log("🔌 COMMANDED IMPORT · command the FULL planned g[t] whenever the plan imports (g > eps)")
  const cases: Array<{ name: string; g: number; demand: number; expect: number }> = [
    { name: "charging hard (g≫demand)", g: 79.5, demand: 5.5, expect: 79.5 },
    { name: "charging at full cap", g: 87, demand: 5.5, expect: 87 },
    { name: "cheap slot, grid serves demand (g==demand)", g: 5.5, demand: 5.5, expect: 5.5 },
    { name: "demand just above g (still command g)", g: 5.55, demand: 5.5, expect: 5.55 },
    { name: "clamped below demand (overloaded car)", g: 79, demand: 150, expect: 79 },
    { name: "battery discharging (g==0)", g: 0, demand: 40, expect: 0 },
    { name: "idle (g==0)", g: 0, demand: 0, expect: 0 },
    { name: "sub-eps noise stays zero", g: 0.05, demand: 0, expect: 0 },
    { name: "mild import above eps", g: 6.0, demand: 5.5, expect: 6.0 },
  ]
  let ok = true
  for (const c of cases) {
    const got = commandedGridImportKw(c.g, c.demand)
    ok = check(c.name, Math.abs(got - c.expect) < 1e-9, `cmd(g=${c.g}, d=${c.demand})=${got} (expected ${c.expect})`) && ok
  }
  console.log(`        → ${ok ? "✅ PASS" : "❌ FAIL"}\n`)
  return ok
}

async function main() {
  const glpk = await getGlpk()
  console.log(`\n[v0] Verifying v5 kernel grid-import command (E_max=${CAP} kWh, η_c=${mpc.chargeEff})`)
  console.log("[v0] clearance is a CEILING; g[0] = demand + charge − discharge\n")

  let pass = 0
  for (const s of scenarios) {
    const res = await solveHorizon({
      glpk,
      energyKwh: socToKwh(s.socPct),
      capacityKwh: CAP,
      pricesEurMwh: s.prices,
      demandKw: s.demandKw,
      headroomKw: s.headroomKw,
      dailyCapKwh: s.dailyCapKwh,
      mpc,
    })

    // PLAN leg: the full solved import trajectory.
    const plan = res.gridScheduleKw
    const planMax = plan.length ? Math.max(...plan) : res.clearanceKw
    const planNonZeroSteps = plan.filter((g) => g > 0.05).length

    // TICK leg: committed g[0] → the actual wire command, via the real mapping.
    const decision: DecideTickResult = {
      clearanceKw: res.clearanceKw,
      reserveSocPct: mpc.socFloorFrac * 100,
      targetSocPct: mpc.socMaxFrac * 100,
      eagerness: 0,
      anticipatedEvKwh: 0,
      expensiveThresholdEurMwh: 0,
    }
    // The grid import ENVELOPE (ceiling) for this scenario is its headroom; the
    // committed g[0] is the active setpoint that must sit inside it.
    const payload = toDispatchPayload(decision, {
      siteId: "verify",
      assetId: "verify",
      gridImportLimitKw: s.headroomKw,
    })
    const requestW = payload.station.P_grid_request_w // active setpoint (neg=import)
    const clearanceW = payload.station.P_grid_clearance_w // envelope (positive ceiling)

    const got = classify(res.clearanceKw, s.headroomKw)
    // "nonzero" is satisfied by any positive import (incl. when it pins at the
    // cap); "maxed" and "zero" are exact.
    const expectMet = s.expect === "nonzero" ? got !== "zero" : got === s.expect

    // WIRE CONTRACT (new): the SETPOINT goes to P_grid_request_w, NEGATIVE for
    // import (g[0] kW → -|kW·1000|; zero ⇒ 0). P_grid_clearance_w is the
    // unsigned envelope = round(headroom·1000), independent of the setpoint.
    const expectedRequestW = res.clearanceKw > 0.0005 ? -Math.round(res.clearanceKw * 1000) : 0
    const expectedClearanceW = Math.round(s.headroomKw * 1000)
    const setpointOk = requestW === expectedRequestW && requestW <= 0
    const envelopeOk = clearanceW === expectedClearanceW && clearanceW >= 0

    const ok =
      expectMet &&
      // cross-check the active setpoint agrees with committed kW AND is neg-import
      setpointOk &&
      // clearance must be the positive envelope, NOT the setpoint
      envelopeOk &&
      // for a non-zero/maxed expectation the PLAN must also show import
      (s.expect === "zero" ? true : planMax > 0.05)
    if (ok) pass++

    console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${s.name}`)
    console.log(`        ${s.why}`)
    console.log(
      `        solve=${res.status}  committed g[0]=${res.clearanceKw.toFixed(1)} kW  → P_grid_request_w=${requestW} W (neg=import)  ·  P_grid_clearance_w=${clearanceW} W (envelope)`,
    )
    console.log(
      `        plan: maxImport=${planMax.toFixed(1)} kW across ${planNonZeroSteps}/${plan.length} steps  ·  expected=${s.expect}, got=${got}\n`,
    )
  }

  // Pure regression guards (no LP) — run alongside the LP scenarios.
  const compressionOk = verifyCommandCompression()
  const commandedOk = verifyCommandedImport()

  const scenariosOk = pass === scenarios.length
  console.log(
    `[v0] ${pass}/${scenarios.length} LP scenarios passed · compression ${compressionOk ? "PASS" : "FAIL"} · commanded-import ${commandedOk ? "PASS" : "FAIL"}`,
  )
  if (!scenariosOk || !compressionOk || !commandedOk) process.exit(1)
}

main().catch((e) => {
  console.error("[v0] ERROR:", e)
  process.exit(1)
})
