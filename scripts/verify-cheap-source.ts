/**
 * VERIFY-CHEAP-SOURCE — telemetry proof of WHO serves the EV in cheap slots.
 * ════════════════════════════════════════════════════════════════════════
 *
 * The user's evidence dashboard shows a second charging session landing in the
 * day's CHEAPEST 15-min slots, yet measured grid import stayed low/negative and
 * battery SOC dropped — i.e. the battery served the car through the cheap window
 * (economically backwards: you then refill later at a higher price).
 *
 * Hypothesis (from code read): the live wire only commands P_grid_request_w when
 * the plan charges the battery (g > demand). In a cheap slot where the optimal
 * move is g ≈ demand (serve EV from grid, don't charge), commandedGridImportKw
 * collapses the request to ~0 — and with request≈0 the station serves the car
 * from the BATTERY instead of the grid.
 *
 * This script does NOT change anything. It pulls the real frames for the chosen
 * day and, for each frame, lays out side-by-side:
 *   • price (and whether it's in the cheapest tercile for the day)
 *   • commanded P_grid_request_w (from raw jsonb, if present)
 *   • measured grid import kW  (−gridPowerW/1000)
 *   • measured battery kW      (+discharge / −charge)
 *   • measured EV load kW      (deriveEvLoadW)
 * and classifies the serving source. It then summarises, over the cheap slots
 * WITH a car charging, how much EV energy came from grid vs battery.
 *
 * Run:
 *   set -a && . /vercel/share/.env.project && set +a && \
 *   DAY=2026-06-16 STATION=<id> npx -y tsx scripts/verify-cheap-source.ts
 */

import { and, asc, eq, gte, lte } from "drizzle-orm"
import { db } from "../lib/db"
import { telemetryFrame } from "../lib/db/schema"
import { deriveEvLoadW } from "../lib/telemetry-normalize"

const DAY = process.env.DAY ?? new Date().toISOString().slice(0, 10)
const STATION = process.env.STATION ?? process.env.STATION_ID ?? ""
const fromIso = `${DAY}T00:00:00Z`
const toIso = new Date(Date.UTC(...(DAY.split("-").map(Number) as [number, number, number]), 24)).toISOString()

// Pull the commanded grid request out of the stored raw frame, trying the
// known field names. Returns kW (positive = import) or null if absent.
function commandedRequestKw(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const station = (r.station ?? r) as Record<string, unknown>
  const candidates = [station.P_grid_request_w, r.P_grid_request_w, station.p_grid_request_w]
  for (const c of candidates) {
    if (typeof c === "number") return -c / 1000 // wire is negative=import
  }
  return null
}

async function main() {
  if (!STATION) {
    console.error("[v0] Set STATION=<stationId> (and DAY=YYYY-MM-DD).")
    process.exit(1)
  }
  const rows = await db
    .select({
      ts: telemetryFrame.ts,
      gridPowerW: telemetryFrame.gridPowerW,
      battPowerW: telemetryFrame.battPowerW,
      evLoadW: telemetryFrame.evLoadW,
      socAvg: telemetryFrame.socAvg,
      priceEurMwh: telemetryFrame.priceEurMwh,
      raw: telemetryFrame.raw,
    })
    .from(telemetryFrame)
    .where(
      and(
        eq(telemetryFrame.stationId, STATION),
        gte(telemetryFrame.ts, new Date(fromIso)),
        lte(telemetryFrame.ts, new Date(toIso)),
      ),
    )
    .orderBy(asc(telemetryFrame.ts))

  if (rows.length === 0) {
    console.error(`[v0] No frames for station=${STATION} on ${DAY}.`)
    process.exit(1)
  }

  // Cheapest tercile threshold for the day (the green "cheapest" shading proxy).
  const prices = rows.map((r) => r.priceEurMwh).filter((p): p is number => p != null).sort((a, b) => a - b)
  const cheapThresh = prices[Math.floor(prices.length / 3)] ?? Number.POSITIVE_INFINITY

  console.log(`\n[v0] Station ${STATION} · ${DAY} · ${rows.length} frames · cheap≤${cheapThresh.toFixed(1)} €/MWh\n`)
  console.log("time     price  cheap  req_kW  grid_kW  batt_kW  ev_kW   served-by")

  let cheapEvGridKwh = 0
  let cheapEvBattKwh = 0
  let cheapCarFrames = 0
  let cheapReqZeroWithCar = 0

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const ms = new Date(r.ts).getTime()
    const nextMs = i + 1 < rows.length ? new Date(rows[i + 1].ts).getTime() : ms + 15_000
    const dtH = Math.min(Math.max((nextMs - ms) / 3_600_000, 0), 1) || 15 / 3600

    const price = r.priceEurMwh ?? Number.NaN
    const cheap = price <= cheapThresh
    const reqKw = commandedRequestKw(r.raw)
    const gridKw = r.gridPowerW != null ? -r.gridPowerW / 1000 : 0 // + import
    const battKw = r.battPowerW != null ? r.battPowerW / 1000 : 0 // + discharge / − charge
    const evW = deriveEvLoadW(r.gridPowerW, r.battPowerW, r.evLoadW)
    const evKw = evW != null ? evW / 1000 : 0
    const carCharging = evKw > 1

    // Attribute the EV load to grid vs battery for this frame (battery only when
    // discharging; grid import covers the rest, AUX-adjusted by deriveEvLoad).
    const battToEvKw = Math.max(0, Math.min(battKw, evKw))
    const gridToEvKw = Math.max(0, evKw - battToEvKw)
    const servedBy =
      !carCharging ? "—" : battToEvKw > gridToEvKw + 0.5 ? "BATTERY" : gridToEvKw > battToEvKw + 0.5 ? "grid" : "mixed"

    if (cheap && carCharging) {
      cheapCarFrames++
      cheapEvGridKwh += gridToEvKw * dtH
      cheapEvBattKwh += battToEvKw * dtH
      if (reqKw != null && Math.abs(reqKw) < 1) cheapReqZeroWithCar++
    }

    // Only print cheap-slot car-charging frames (the window under suspicion) to
    // keep the output legible; this is where the backwards behaviour shows.
    if (cheap && carCharging) {
      const hhmm = r.ts.toISOString().slice(11, 16)
      console.log(
        `${hhmm}  ${price.toFixed(0).padStart(5)}   ${cheap ? "✓" : " "}   ` +
          `${(reqKw ?? Number.NaN).toFixed(1).padStart(6)}  ${gridKw.toFixed(1).padStart(7)}  ` +
          `${battKw.toFixed(1).padStart(7)}  ${evKw.toFixed(1).padStart(6)}   ${servedBy}`,
      )
    }
  }

  const totalCheapEv = cheapEvGridKwh + cheapEvBattKwh
  console.log("\n──────── CHEAP-SLOT EV SOURCING (the window under suspicion) ────────")
  console.log(`cheap+car frames        : ${cheapCarFrames}`)
  console.log(`  with commanded req≈0  : ${cheapReqZeroWithCar}  (← request was 0 while a car charged in cheap slots)`)
  console.log(`EV energy from GRID     : ${cheapEvGridKwh.toFixed(1)} kWh`)
  console.log(`EV energy from BATTERY  : ${cheapEvBattKwh.toFixed(1)} kWh`)
  if (totalCheapEv > 0) {
    const battPct = (100 * cheapEvBattKwh) / totalCheapEv
    console.log(`→ ${battPct.toFixed(0)}% of cheap-slot EV demand was served from the BATTERY`)
    console.log(
      battPct > 40
        ? "→ CONFIRMS the bug: the battery is being cycled to serve the car in the day's cheapest slots."
        : "→ Does NOT confirm: grid already serves most cheap-slot EV demand.",
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[v0] ERROR:", e)
    process.exit(1)
  })
