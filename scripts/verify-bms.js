// Quick verification: Can the Reactive BMS actually serve all sessions?
// Manual trace through key sessions with actual parameters

const GRID_LIMIT = 80     // kW
const BATTERY_CAP = 143   // kWh
const SOC_FLOOR = 0.20    // 20%
const SOC_CEIL = 0.90     // 90%
const START_SOC = 0.90    // 90%
const MAX_DISCHARGE = 150 // kW
const MAX_CHARGE = 80     // kW
const IDLE_RECHARGE = 50  // kW
const IDLE_TARGET = 0.80  // 80%
const DERATING_START = 0.30 // 30%
const MAX_DAILY_DISCHARGE = 300 // kWh
const MAX_HW_OUTPUT = 230 // kW

// Sessions: [id, start_min, dur_min, vehicle, batt_kwh, arr%, tgt%, maxkW, energy_needed]
const sessions = [
  [1, 430, 25, "VW ID.3", 58, 45, 80, 120, 20.3],
  [2, 460, 20, "Renault Megane", 60, 30, 65, 130, 21.0],
  [3, 485, 30, "Tesla Y LR", 75, 25, 70, 250, 33.8],
  [4, 520, 25, "Hyundai Ioniq5", 77, 40, 75, 220, 26.9],
  [5, 550, 35, "eVito", 60, 20, 80, 110, 36.0],
  [6, 590, 20, "Fiat 500e", 42, 35, 70, 85, 14.7],
  [7, 615, 25, "BMW iX3", 74, 30, 65, 150, 25.9],
  [8, 645, 20, "Peugeot e-308", 54, 50, 80, 100, 16.2],
  [9, 670, 30, "Enyaq", 77, 20, 60, 135, 30.8],
  [10, 705, 25, "Tesla 3 SR", 60, 35, 70, 170, 21.0],
  [11, 735, 30, "Mercedes EQC", 80, 25, 65, 110, 32.0],
  [12, 770, 25, "VW ID.4 GTX", 77, 40, 80, 135, 30.8],
  [13, 800, 20, "Opel Corsa-e", 50, 30, 60, 100, 15.0],
  [14, 825, 30, "Audi Q4", 82, 20, 60, 135, 32.8],
  [15, 860, 25, "Cupra Born", 58, 45, 80, 120, 20.3],
  [16, 890, 35, "eSprinter", 113, 25, 70, 115, 50.9],
  [17, 930, 25, "Hyundai Kona", 64, 35, 70, 100, 22.4],
  [18, 960, 25, "Tesla Y SR", 60, 30, 65, 250, 21.0],
  [19, 990, 30, "Kia EV6", 77, 20, 55, 240, 27.0],
  [20, 1025, 20, "MG4", 51, 40, 70, 87, 15.3],
  [21, 1050, 25, "BMW i4", 84, 25, 60, 200, 29.4],
  [22, 1085, 25, "VW ID.3 Pro S", 77, 35, 65, 170, 23.1],
  [23, 1120, 30, "Volvo EX30", 69, 30, 70, 153, 27.6],
  [24, 1160, 25, "Renault Zoe", 52, 25, 60, 46, 18.2],
  [25, 1195, 20, "Polestar 2 LR", 78, 45, 75, 205, 23.4],
]

const totalEnergy = sessions.reduce((s, sess) => s + sess[8], 0)
console.log(`\n=== SESSION DEMAND ANALYSIS ===`)
console.log(`Total sessions: ${sessions.length}`)
console.log(`Total energy demanded: ${totalEnergy.toFixed(1)} kWh`)

// For each session: what's the max energy deliverable in the time window?
let battSocKwh = START_SOC * BATTERY_CAP
let cumulativeDischarged = 0
let sessionsFullyServed = 0
let sessionsPartiallyServed = 0

console.log(`\nStarting battery SOC: ${(battSocKwh/BATTERY_CAP*100).toFixed(1)}% (${battSocKwh.toFixed(1)} kWh)`)
console.log(`Min SOC (floor): ${SOC_FLOOR*100}% (${(SOC_FLOOR*BATTERY_CAP).toFixed(1)} kWh)`)
console.log(`Usable at start: ${(battSocKwh - SOC_FLOOR*BATTERY_CAP).toFixed(1)} kWh`)
console.log()

let lastEndMin = 0

for (const [id, startMin, dur, vehicle, _batt, _arr, _tgt, maxAccept, needed] of sessions) {
  // Idle recharge between sessions (simplified: grid only, ignoring PV for pessimistic estimate)
  const idleMinutes = Math.max(startMin - lastEndMin, 0)
  const idleChargeKwh = Math.min(
    IDLE_RECHARGE / 60 * idleMinutes,
    (IDLE_TARGET * BATTERY_CAP) - battSocKwh
  )
  const chargeApplied = Math.max(Math.min(idleChargeKwh, (SOC_CEIL * BATTERY_CAP - battSocKwh)), 0)
  battSocKwh += chargeApplied

  // During session: max power = min(maxAccept, maxHW, grid + battery_discharge)
  // Battery discharge derated based on SOC
  const socPct = battSocKwh / BATTERY_CAP
  let derating = 1.0
  if (socPct <= SOC_FLOOR) derating = 0.0
  else if (socPct < DERATING_START) derating = (socPct - SOC_FLOOR) / (DERATING_START - SOC_FLOOR)
  
  const effDischarge = MAX_DISCHARGE * derating
  const maxPowerToEv = Math.min(maxAccept, MAX_HW_OUTPUT, GRID_LIMIT + effDischarge)
  
  // Max deliverable = maxPower * duration (in hours)
  const maxDeliverable = maxPowerToEv * (dur / 60)
  
  // Actual = min(needed, maxDeliverable, battery available + grid)
  const battAvailable = Math.max(battSocKwh - SOC_FLOOR * BATTERY_CAP, 0)
  const budgetLeft = Math.max(MAX_DAILY_DISCHARGE - cumulativeDischarged, 0)
  const battCanGiveKwh = Math.min(battAvailable, budgetLeft)
  const gridCanGiveKwh = GRID_LIMIT * (dur / 60)
  const totalAvailableKwh = gridCanGiveKwh + battCanGiveKwh // PV not counted (pessimistic)
  
  const actualDelivered = Math.min(needed, totalAvailableKwh, maxDeliverable)
  const fulfilled = actualDelivered / needed * 100
  
  // How much came from battery vs grid?
  const fromGrid = Math.min(gridCanGiveKwh, actualDelivered)
  const fromBatt = Math.max(actualDelivered - fromGrid, 0)
  
  battSocKwh -= fromBatt
  cumulativeDischarged += fromBatt

  const status = fulfilled >= 99.5 ? "OK" : `SHORT (${(needed - actualDelivered).toFixed(1)} kWh gap)`
  if (fulfilled >= 99.5) sessionsFullyServed++
  else sessionsPartiallyServed++
  
  const tag = fulfilled >= 99.5 ? "" : " <<<<<<<<"
  console.log(
    `#${String(id).padStart(2)} ${vehicle.padEnd(20)} need=${needed.toFixed(1).padStart(5)}kWh ` +
    `avail=${totalAvailableKwh.toFixed(1).padStart(6)}kWh ` +
    `maxPwr=${maxPowerToEv.toFixed(0).padStart(3)}kW ` +
    `maxDel=${maxDeliverable.toFixed(1).padStart(6)}kWh ` +
    `actual=${actualDelivered.toFixed(1).padStart(5)}kWh ` +
    `${fulfilled.toFixed(0).padStart(3)}% ` +
    `battSOC=${(battSocKwh/BATTERY_CAP*100).toFixed(1).padStart(5)}% ` +
    `idle+${chargeApplied.toFixed(1)}kWh ` +
    `${status}${tag}`
  )
  
  lastEndMin = startMin + dur
}

console.log(`\n=== SUMMARY ===`)
console.log(`Fully served: ${sessionsFullyServed}/${sessions.length}`)
console.log(`Partially served: ${sessionsPartiallyServed}/${sessions.length}`)
console.log(`Total battery discharged: ${cumulativeDischarged.toFixed(1)} kWh (budget: ${MAX_DAILY_DISCHARGE} kWh)`)
console.log(`Final battery SOC: ${(battSocKwh/BATTERY_CAP*100).toFixed(1)}%`)
console.log()

// Check the big sessions that worry us:
console.log(`=== SANITY CHECKS ===`)
console.log(`Session #16 (eSprinter): needs 50.9 kWh in 35 min`)
console.log(`  Max power = min(115 kW accept, 230 HW, 80 grid + 150 batt) = 115 kW`)
console.log(`  Max deliverable at 115 kW for 35 min = ${(115 * 35/60).toFixed(1)} kWh -- ${115*35/60 >= 50.9 ? "CAN" : "CANNOT"} deliver 50.9`)
console.log()
console.log(`Session #3 (Tesla Y LR): needs 33.8 kWh in 30 min`)
console.log(`  Max power = min(250 kW accept, 230 HW, 80 grid + 150 batt) = 230 kW`)
console.log(`  Max deliverable at 230 kW for 30 min = ${(230 * 30/60).toFixed(1)} kWh -- ${230*30/60 >= 33.8 ? "CAN" : "CANNOT"} deliver 33.8`)
console.log()
console.log(`Session #24 (Renault Zoe): needs 18.2 kWh in 25 min`)
console.log(`  Max power = min(46 kW accept, 230 HW, 80 grid + batt) = 46 kW (Zoe limited!)`)
console.log(`  Max deliverable at 46 kW for 25 min = ${(46 * 25/60).toFixed(1)} kWh -- ${46*25/60 >= 18.2 ? "CAN" : "CANNOT"} deliver 18.2`)
