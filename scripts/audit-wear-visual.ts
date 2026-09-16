/**
 * One-off audit: does the measured BMS data really contain ~2× the cycling of
 * the no-arb floor, and why doesn't the (downsampled) SOC chart show it?
 *
 * For today's window it reconciles, at FULL 1-minute resolution:
 *   1. Σ|battPowerW|·dt        → the engine's throughputWithArb (report: 106 kWh)
 *   2. Σ|ΔSOC|×capacity        → movement actually visible in SOC (total variation)
 *   3. Σ max(0, ev − headroom) → the no-arb forced-discharge floor (report: 25 kWh)
 *   4. where the throughput happened: inside the big dip vs micro-swings, and
 *      how much survives the chart's downsampling.
 *
 * Run: npx tsx scripts/audit-wear-visual.ts
 */
import { loadLiveBacktestFrames } from "../lib/ingestion"
import { DEFAULT_STATION_ID } from "../lib/amperio-api"

const CAP_KWH = 189 // usable system capacity (matches report footnote)
const GRID_CAP_KW = 87

async function main() {
  const now = new Date()
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)

  // Same live-frame path the financial report uses for non-persisted days.
  const rows = await loadLiveBacktestFrames({
    stationId: DEFAULT_STATION_ID,
    fromIso: from.toISOString(),
    toIso: now.toISOString(),
  })
  const frames = rows.map((r) => ({
    ts: r.ts,
    battW: r.battPowerW,
    socAvg: r.socAvg,
    evW: r.evLoadW,
    gridW: r.gridPowerW,
    capW: r.gridImportLimitW,
  }))

  console.log(`[v0] frames: ${frames.length}  window: ${from.toISOString()} → ${now.toISOString()}`)
  if (frames.length < 2) return

  let throughputKwh = 0 // 1. Σ|battKw|·dt
  let socTvKwh = 0 // 2. Σ|ΔSOC| × capacity
  let noArbForcedKwh = 0 // 3. forced surplus above headroom
  let microSwingKwh = 0 // throughput in frames where |ΔSOC| < 0.05 %/min
  let signChanges = 0
  let prevSoc: number | null = null
  let prevSign = 0

  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]
    const dtH = (new Date(f.ts).getTime() - new Date(frames[i - 1].ts).getTime()) / 3_600_000
    if (dtH <= 0 || dtH > 0.5) continue
    const battKw = (f.battW ?? 0) / 1000
    const tpFrame = Math.abs(battKw) * dtH
    throughputKwh += tpFrame

    const soc = f.socAvg
    if (soc != null && prevSoc != null) {
      const dSocKwh = (Math.abs(soc - prevSoc) / 100) * CAP_KWH
      socTvKwh += dSocKwh
      if (Math.abs(soc - prevSoc) < 0.05) microSwingKwh += tpFrame
    }
    if (soc != null) prevSoc = soc

    const sign = battKw > 0.5 ? 1 : battKw < -0.5 ? -1 : 0
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) signChanges++
    if (sign !== 0) prevSign = sign

    const capKw = f.capW != null && f.capW > 0 ? f.capW / 1000 : GRID_CAP_KW
    const evKw = Math.max(0, (f.evW ?? 0) / 1000)
    const baseKw = Math.max(0, (f.gridW ?? 0) / 1000 - evKw - Math.max(0, battKw)) // rough baseload
    const headroom = Math.max(0, capKw - baseKw)
    noArbForcedKwh += Math.max(0, evKw - headroom) * dtH
  }

  console.log(`[v0] 1. throughput Σ|battKw|dt   = ${throughputKwh.toFixed(1)} kWh (report "with arbitrage")`)
  console.log(`[v0] 2. SOC total variation      = ${socTvKwh.toFixed(1)} kWh (movement visible in SOC at 1-min)`)
  console.log(`[v0] 3. no-arb forced (×2 = floor) = ${noArbForcedKwh.toFixed(1)} kWh → floor ${(2 * noArbForcedKwh).toFixed(1)} kWh`)
  console.log(`[v0] 4. micro-swing throughput   = ${microSwingKwh.toFixed(1)} kWh (frames with |ΔSOC| < 0.05%/min — invisible on chart)`)
  console.log(`[v0]    charge/discharge sign changes: ${signChanges}`)

  // What the downsampled chart shows: same TV on ~300-point downsample.
  const stride = Math.max(1, Math.floor(frames.length / 300))
  let dsTvKwh = 0
  let prev: number | null = null
  for (let i = 0; i < frames.length; i += stride) {
    const soc = frames[i].socAvg
    if (soc != null && prev != null) dsTvKwh += (Math.abs(soc - prev) / 100) * CAP_KWH
    if (soc != null) prev = soc
  }
  console.log(`[v0] 5. SOC TV after ~300-pt downsample = ${dsTvKwh.toFixed(1)} kWh (what the CHART can show)`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
