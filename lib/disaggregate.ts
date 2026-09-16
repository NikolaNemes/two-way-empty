import type { ChargingSession, SiteSetup, GridPricing, BmsSimulationMinute, ReactiveBmsConfig } from "./simulation-store"

const MINUTES_PER_DAY = 1440

/**
 * Linearly interpolate 24 hourly values into 1440 1-minute values.
 * Each hourly value is treated as the value at the midpoint of that hour (minute 30).
 * Values between midpoints are linearly interpolated.
 */
export function disaggregateHourlyTo1Min(hourly: number[]): number[] {
  const result = new Array<number>(MINUTES_PER_DAY)

  for (let m = 0; m < MINUTES_PER_DAY; m++) {
    // Which hour's midpoint are we between?
    const hourFrac = m / 60 // fractional hour (0..24)
    // midpoint of hour h is at h + 0.5
    // so for minute m, the fractional hour is m/60
    // we interpolate between the midpoints of the two nearest hours
    const midpoint = hourFrac - 0.5
    const h0 = Math.floor(midpoint)
    const h1 = h0 + 1
    const t = midpoint - h0 // interpolation fraction [0,1)

    const v0 = hourly[((h0 % 24) + 24) % 24]
    const v1 = hourly[((h1 % 24) + 24) % 24]

    result[m] = v0 + (v1 - v0) * t
  }

  return result
}

/**
 * Build 1-min PV output profile for the charger's share.
 * Takes hourly capacity factors and PV config, returns 1440 kW values.
 * Adds realistic intra-hour variability (cloud transients on a mostly sunny summer day).
 */
export function buildPvProfile1Min(pv: SiteSetup["pv"]): number[] {
  const {
    installedCapacityKwp,
    chargerSharePercent,
    systemLossPercent,
    hourlyCapacityFactors,
  } = pv

  // Effective capacity for charger after losses and share split
  const effectiveKwp =
    installedCapacityKwp *
    (chargerSharePercent / 100) *
    (1 - systemLossPercent / 100)

  // Interpolate hourly capacity factors to 1-min
  const smooth = disaggregateHourlyTo1Min(hourlyCapacityFactors)

  // Apply effective capacity and add realistic variability
  // Seed a deterministic "cloud pattern" -- a repeatable pseudo-random function
  // On a summer day in Germany: mostly clear with occasional passing clouds
  // This gives ~3-8% variability with brief ~5-15 min dips
  const result = new Array<number>(MINUTES_PER_DAY)
  for (let m = 0; m < MINUTES_PER_DAY; m++) {
    const base = smooth[m] * effectiveKwp
    if (base < 0.1) {
      result[m] = Math.max(base, 0)
    } else {
      // Deterministic variability: sine mix for cloud-like transients
      const v1 = Math.sin(m * 0.047) * 0.03
      const v2 = Math.sin(m * 0.013 + 2.1) * 0.04
      const v3 = Math.sin(m * 0.0031 + 0.7) * 0.05
      // Two brief cloud dips (~ minute 540=09:00 and minute 840=14:00)
      const dip1 = Math.exp(-((m - 540) ** 2) / (2 * 8 ** 2)) * 0.25
      const dip2 = Math.exp(-((m - 840) ** 2) / (2 * 12 ** 2)) * 0.18
      const factor = 1 + v1 + v2 + v3 - dip1 - dip2
      result[m] = Math.max(base * Math.max(factor, 0.1), 0)
    }
  }
  return result
}

/**
 * Build a 1440-element kW demand profile from charging sessions.
 * Supports multi-connector setups: groups sessions by connectorId,
 * applies FCFS sequential queue per connector, then sums across connectors.
 * Each minute gets the sum of maxAcceptRateKw across all active sessions.
 * This represents "maximum possible demand" -- actual delivery is decided by BMS/EMS.
 */
export function buildSessionDemandProfile(sessions: ChargingSession[]): number[] {
  const profile = new Array<number>(MINUTES_PER_DAY).fill(0)

  // Group sessions by connectorId (default to 1 for backward compat)
  const byConnector = new Map<number, ChargingSession[]>()
  for (const s of sessions) {
    const cid = s.connectorId ?? 1
    if (!byConnector.has(cid)) byConnector.set(cid, [])
    byConnector.get(cid)!.push(s)
  }

  // Process each connector independently: FCFS sequential queue per connector
  for (const [, connSessions] of byConnector) {
    const sorted = [...connSessions].sort((a, b) => {
      const aMin = parseInt(a.startTime.split(":")[0]) * 60 + parseInt(a.startTime.split(":")[1])
      const bMin = parseInt(b.startTime.split(":")[0]) * 60 + parseInt(b.startTime.split(":")[1])
      return aMin - bMin
    })

    let connectorFreeAt = 0
    for (const session of sorted) {
      const [hh, mm] = session.startTime.split(":").map(Number)
      const startMin = Math.max(hh * 60 + mm, connectorFreeAt)
      const endMin = Math.min(startMin + session.durationMinutes, MINUTES_PER_DAY)

      for (let m = startMin; m < endMin; m++) {
        profile[m] += session.maxAcceptRateKw // sum across connectors
      }

      connectorFreeAt = endMin
    }
  }

  return profile
}

/**
 * Simulate battery SOC trajectory over the day at 1-min resolution.
 * Returns { socProfile, batteryPowerProfile, cumulativeDischarge }
 *
 * Logic per minute:
 * - If EV demand > gridLimit, battery must discharge the gap (capped at maxDischargeRate and available energy)
 * - If EV demand < gridLimit and SOC < socCeiling, battery charges from spare grid capacity
 * - SOC cannot go below socFloor or above socCeiling
 */
export function simulateBatteryTrajectory(
  demandProfile: number[],
  site: SiteSetup
) {
  const {
    grid: { gridConnectionLimit },
    battery: { totalCapacity, socFloor, socCeiling, maxDischargeRate, startSoc },
    charger: { maxHardwareOutput },
    wear: { maxDailyDischarge },
  } = site

  const socProfile = new Array<number>(MINUTES_PER_DAY)
  const batteryPowerProfile = new Array<number>(MINUTES_PER_DAY) // positive = discharge, negative = charge
  const cumulativeDischarge = new Array<number>(MINUTES_PER_DAY)

  let currentSocKwh = (startSoc / 100) * totalCapacity
  const minSocKwh = (socFloor / 100) * totalCapacity
  const maxSocKwh = (socCeiling / 100) * totalCapacity
  let totalDischarged = 0

  // Max charge rate (assume same as discharge rate for simplicity)
  const maxChargeRate = maxDischargeRate

  for (let m = 0; m < MINUTES_PER_DAY; m++) {
    const demand = demandProfile[m]
    let batteryKw = 0

    if (demand > gridConnectionLimit) {
      // Need battery assist
      let needed = demand - gridConnectionLimit
      // Cap by hardware max
      needed = Math.min(needed, maxHardwareOutput - gridConnectionLimit)
      // Cap by discharge rate
      needed = Math.min(needed, maxDischargeRate)
      // Cap by available energy (1 minute = 1/60 hour)
      const availableKwh = currentSocKwh - minSocKwh
      needed = Math.min(needed, availableKwh * 60)
      // Cap by remaining cycle budget
      const budgetRemaining = maxDailyDischarge - totalDischarged
      needed = Math.min(needed, budgetRemaining * 60)

      needed = Math.max(needed, 0)
      batteryKw = needed
      currentSocKwh -= needed / 60
      totalDischarged += needed / 60
    } else if (demand < gridConnectionLimit && currentSocKwh < maxSocKwh) {
      // Spare grid capacity -- charge battery
      let spare = gridConnectionLimit - demand
      spare = Math.min(spare, maxChargeRate)
      const roomKwh = maxSocKwh - currentSocKwh
      spare = Math.min(spare, roomKwh * 60)
      spare = Math.max(spare, 0)

      batteryKw = -spare
      currentSocKwh += spare / 60
    }

    socProfile[m] = (currentSocKwh / totalCapacity) * 100
    batteryPowerProfile[m] = batteryKw
    cumulativeDischarge[m] = totalDischarged
  }

  return { socProfile, batteryPowerProfile, cumulativeDischarge }
}

/**
 * Build per-session QoS analysis.
 * For each session, compute available power and shortfall.
 */
export function analyzeSessionQos(
  sessions: ChargingSession[],
  socProfile: number[],
  site: SiteSetup
) {
  const {
    grid: { gridConnectionLimit },
    battery: { totalCapacity, socFloor, maxDischargeRate },
    charger: { maxHardwareOutput },
  } = site

  return sessions.map((session) => {
    const [hh, mm] = session.startTime.split(":").map(Number)
    const startMin = hh * 60 + mm
    const endMin = Math.min(startMin + session.durationMinutes, MINUTES_PER_DAY)

    // Take the minimum available power across the session duration (worst-case)
    let minAvailable = maxHardwareOutput
    for (let m = startMin; m < endMin; m++) {
      const soc = socProfile[m] ?? socProfile[socProfile.length - 1]
      const socKwh = (soc / 100) * totalCapacity
      const minSocKwh = (socFloor / 100) * totalCapacity
      const availableBattery = Math.min(
        (socKwh - minSocKwh) * 60, // energy available this minute
        maxDischargeRate
      )
      const available = gridConnectionLimit + Math.max(availableBattery, 0)
      minAvailable = Math.min(minAvailable, available, maxHardwareOutput)
    }

    const shortfall = Math.max(session.maxAcceptRateKw - minAvailable, 0)
    const qosPercent = session.maxAcceptRateKw > 0
      ? Math.min((minAvailable / session.maxAcceptRateKw) * 100, 100)
      : 100

    return {
      ...session,
      availableKw: Math.round(minAvailable * 10) / 10,
      shortfallKw: Math.round(shortfall * 10) / 10,
      qosPercent: Math.round(qosPercent * 10) / 10,
    }
  })
}

/**
 * Aggregate a 1440-element 1-min profile into 96 x 15-min intervals.
 * Returns array of { minute, time, avg, min, max, sum } for each 15-min block.
 */
export function aggregate15Min(profile: number[]): {
  minute: number
  time: string
  avg: number
  min: number
  max: number
  sum: number
}[] {
  const INTERVAL = 15
  const result: { minute: number; time: string; avg: number; min: number; max: number; sum: number }[] = []
  for (let start = 0; start < MINUTES_PER_DAY; start += INTERVAL) {
    let sum = 0
    let min = Infinity
    let max = -Infinity
    const end = Math.min(start + INTERVAL, MINUTES_PER_DAY)
    const count = end - start
    for (let m = start; m < end; m++) {
      const v = profile[m] ?? 0
      sum += v
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    result.push({
      minute: start,
      time: minuteToTimeStr(start),
      avg: sum / count,
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
      sum,
    })
  }
  return result
}

/**
 * Format minute index to "HH:MM" string.
 */
export function minuteToTimeStr(minute: number): string {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
}

/**
 * Rotate a 96-slot chart array so it starts at the given slot (default 24 = 06:00).
 * The time labels embedded in each slot stay correct; only the order changes.
 * This makes all charts show 06:00 → 05:45 instead of 00:00 → 23:45.
 */
export function rotateChartData<T>(slots: T[], referenceSlot = 24): T[] {
  return [...slots.slice(referenceSlot), ...slots.slice(0, referenceSlot)]
}

// ═══════════════════════════════════════════════════════════════
// REACTIVE BMS SIMULATION ENGINE (1-minute resolution)
// ═══════════════════════════════════════════════════════════════
//
// Rules (purely reactive, no forward knowledge):
//
// IDLE (no EV connected):
//   1. If battery SOC < idleTargetSoc → recharge battery
//      - PV first (if pvPriorityCharging)
//      - Grid up to idleRechargeRateKw
//      - Total charge capped at maxChargeRate
//   2. If battery SOC >= idleTargetSoc and PV surplus → export to grid
//
// EV CONNECTED:
//   1. EV declares maxAcceptRateKw (capped by remaining energy need)
//   2. Power sources in priority order:
//      a. PV → EV (free energy)
//      b. Grid → EV (up to gridLimit minus any grid-to-battery trickle)
//      c. Battery → EV (discharge to fill the gap)
//   3. Battery discharge subject to:
//      - maxDischargeRate
//      - SOC derating: full power above deratingStartSoc,
//        linear ramp to 0 at socFloor
//      - Daily cycle budget (maxDailyDischarge)
//   4. Trickle recharge (if enabled): if gridToEV < gridLimit,
//      spare grid capacity recharges battery (capped at maxChargeRate)
//   5. PV surplus (after EV + battery) → grid export
//
// Per-minute costs:
//   - Grid import: (EPEX[slot] + fees) * kWh
//   - EV revenue: retailPrice * kWh delivered to EV
//   - Battery wear: wearCostPerKwh * kWh discharged

export interface BmsSimulationResult {
  minutes: BmsSimulationMinute[]
  summary: {
    totalEvEnergyKwh: number
    totalGridImportKwh: number
    totalPvUsedKwh: number
    totalPvExportedKwh: number
    totalBatteryDischargeKwh: number
    totalBatteryChargeKwh: number
    peakGridDrawKw: number
    minBatterySocPct: number
    maxBatterySocPct: number
    totalGridCostEur: number
    totalEvRevenueEur: number
    totalBatteryWearEur: number
    netProfitEur: number
    sessionsFullyServed: number
    sessionsPartiallyServed: number
    totalSessionCount: number
    avgEvPowerKw: number
  }
}

export function runReactiveBmsSimulation(
  site: SiteSetup,
  gridPricing: GridPricing,
  sessions: ChargingSession[],
  bmsConfig: ReactiveBmsConfig,
  pvProfile1Min: number[], // 1440 values, kW
): BmsSimulationResult {

  const {
    grid: { gridConnectionLimit },
    battery: { totalCapacity, socFloor, socCeiling, maxDischargeRate, maxChargeRate, startSoc, roundTripEfficiency },
    charger: { maxHardwareOutput },
    wear: { maxDailyDischarge, wearCostPerKwh },
  } = site
  const { epexSpotPrices, gridFeesAndTaxes, retailPricePerKwh } = gridPricing
  const {
    idleTargetSoc,
    idleRechargeRateKw,
    deratingStartSoc,
    trickleRechargeEnabled,
    pvPriorityCharging,
  } = bmsConfig

  // Precompute session schedule: for each minute, which session(s) are active?
  // Multi-connector aware: groups by connectorId, FCFS queue per connector.
  const sorted = [...sessions].sort((a, b) => {
    const aMin = parseInt(a.startTime.split(":")[0]) * 60 + parseInt(a.startTime.split(":")[1])
    const bMin = parseInt(b.startTime.split(":")[0]) * 60 + parseInt(b.startTime.split(":")[1])
    return aMin - bMin
  })

  // Group by connector, build intervals per connector
  const byConnector = new Map<number, typeof sorted>()
  for (const s of sorted) {
    const cid = s.connectorId ?? 1
    if (!byConnector.has(cid)) byConnector.set(cid, [])
    byConnector.get(cid)!.push(s)
  }

  const sessionIntervals: { session: ChargingSession; idx: number; startMin: number; endMin: number; energyNeededKwh: number }[] = []
  for (const [, connSessions] of byConnector) {
    let connectorFreeAt = 0
    for (const s of connSessions) {
      const globalIdx = sorted.indexOf(s)
      const [hh, mm] = s.startTime.split(":").map(Number)
      const arrivalMin = hh * 60 + mm
      const startMin = Math.max(arrivalMin, connectorFreeAt)
      const endMin = Math.min(startMin + s.durationMinutes, MINUTES_PER_DAY)
      sessionIntervals.push({
        session: s,
        idx: globalIdx,
        startMin,
        endMin,
        energyNeededKwh: s.energyRequestedKwh,
      })
      connectorFreeAt = endMin
    }
  }
  // Re-sort intervals by startMin for chronological processing
  sessionIntervals.sort((a, b) => a.startMin - b.startMin)

  // State -- Reactive BMS starts at its idle target SOC (e.g. 80%), not the site's
  // startSoc (90%). This is the reactive BMS's natural steady state: it always
  // recharges back to idleTargetSoc, so that's where it begins each day.
  let batterySocKwh = (idleTargetSoc / 100) * totalCapacity
  const minSocKwh = (socFloor / 100) * totalCapacity
  const maxSocKwh = (socCeiling / 100) * totalCapacity
  const idleTargetKwh = (idleTargetSoc / 100) * totalCapacity
  const deratingStartKwh = (deratingStartSoc / 100) * totalCapacity
  // Round-trip efficiency split: sqrt(η) on each leg (charge and discharge).
  // Charging stores chargeKwh * sqrtEta; discharging costs dischargeKwh / sqrtEta.
  // Fallback to 0.90 if roundTripEfficiency is undefined (old snapshots).
  const rte = roundTripEfficiency ?? 0.90
  const sqrtEta = Math.sqrt(rte)
  let totalDischarged = 0

  // Per-session energy tracking
  const sessionEnergyDelivered = new Array<number>(sorted.length).fill(0)

  // Output
  const minutes: BmsSimulationMinute[] = new Array(MINUTES_PER_DAY)

  // Simulation runs from 06:00 to 06:00 (next day) matching chart display order.
  // Overnight hours (00:00-05:59) reflect battery state AFTER the day's EV sessions.
  const START_MINUTE = 360
  for (let i = 0; i < MINUTES_PER_DAY; i++) {
    const m = (START_MINUTE + i) % MINUTES_PER_DAY
    // PV output this minute
    const pvKw = pvProfile1Min[m] ?? 0

    // EPEX price for this 15-min slot
    const slotIdx = Math.floor(m / 15)
    const epexPrice = epexSpotPrices[slotIdx] ?? 0
    const procurementCostPerKwh = epexPrice + gridFeesAndTaxes

    // Find ALL active sessions this minute (multi-connector: multiple sessions possible)
    const activeIntervals: typeof sessionIntervals = []
    for (const si of sessionIntervals) {
      if (m >= si.startMin && m < si.endMin) {
        activeIntervals.push(si)
      }
    }

    const evConnected = activeIntervals.length > 0

    // ── Compute battery derating factor ──
    let deratingFactor = 1.0
    if (batterySocKwh <= minSocKwh) {
      deratingFactor = 0.0
    } else if (batterySocKwh < deratingStartKwh) {
      deratingFactor = (batterySocKwh - minSocKwh) / (deratingStartKwh - minSocKwh)
    }
    const effectiveDischargeRate = maxDischargeRate * deratingFactor

    const budgetRemainingKwh = Math.max(maxDailyDischarge - totalDischarged, 0)

    // Initialize power flows
    let pvToEvKw = 0
    let pvToBatteryKw = 0
    let pvToGridKw = 0
    let gridToEvKw = 0
    let gridToBatteryKw = 0
    let batteryToEvKw = 0
    let totalToEvKw = 0
    let evMaxAcceptKw = 0
    let evEnergyDeliveredKwh = 0
    let evEnergyRemainingKwh = 0

    if (evConnected) {
      // Sum demand across all active sessions
      let combinedDemandKw = 0
      const sessionDemands: { si: typeof sessionIntervals[0]; demandKw: number; remaining: number }[] = []
      for (const si of activeIntervals) {
        const delivered = sessionEnergyDelivered[si.idx]
        const remaining = Math.max(si.energyNeededKwh - delivered, 0)
        if (remaining <= 0.001) continue
        // EV accepts at full rate until session is fully charged.
        // Do NOT cap by remaining*60 -- that artificially throttles the last minutes.
        // Over-delivery is prevented below: we clamp delivered energy to remaining.
        const demandKw = Math.min(si.session.maxAcceptRateKw, maxHardwareOutput)
        combinedDemandKw += demandKw
        sessionDemands.push({ si, demandKw, remaining })
      }

      evMaxAcceptKw = combinedDemandKw
      evEnergyRemainingKwh = sessionDemands.reduce((s, d) => s + d.remaining, 0)
      evEnergyDeliveredKwh = activeIntervals.reduce((s, si) => s + sessionEnergyDelivered[si.idx], 0)

      if (combinedDemandKw > 0.001) {
        let evStillNeeds = combinedDemandKw

        // ── RULE: Grid ALWAYS provides full 80 kW to EV when there is demand ──
        // Grid is the guaranteed baseline. PV and battery supplement on top.
        // Grid draw = min(gridConnectionLimit, totalDemand) -- never reduced by PV/battery.
        gridToEvKw = Math.min(gridConnectionLimit, evStillNeeds)
        evStillNeeds -= gridToEvKw

        // ── PV → EV (supplement: reduce remaining unmet demand) ──
        if (pvKw > 0 && evStillNeeds > 0) {
          pvToEvKw = Math.min(pvKw, evStillNeeds)
          evStillNeeds -= pvToEvKw
        }

        // ── Battery → EV (supplement: cover anything grid+PV can't) ──
        if (evStillNeeds > 0 && effectiveDischargeRate > 0 && budgetRemainingKwh > 0) {
          let battDischarge = Math.min(evStillNeeds, effectiveDischargeRate)
          const availableKwh = batterySocKwh - minSocKwh
          // Account for efficiency: delivering X kWh requires X/sqrtEta from battery
          // So max deliverable = availableKwh * sqrtEta
          battDischarge = Math.min(battDischarge, availableKwh * sqrtEta * 60)
          battDischarge = Math.min(battDischarge, budgetRemainingKwh * 60)
          battDischarge = Math.max(battDischarge, 0)
          batteryToEvKw = battDischarge
          evStillNeeds -= batteryToEvKw
        }

        totalToEvKw = pvToEvKw + gridToEvKw + batteryToEvKw

        // Distribute delivered energy proportionally across sessions, clamped to remaining need
        const deliveredThisMinKwh = totalToEvKw / 60
        for (const sd of sessionDemands) {
          const share = combinedDemandKw > 0 ? sd.demandKw / combinedDemandKw : 0
          const thisSessionKwh = Math.min(deliveredThisMinKwh * share, sd.remaining)
          sessionEnergyDelivered[sd.si.idx] += thisSessionKwh
        }
        evEnergyDeliveredKwh = activeIntervals.reduce((s, si) => s + sessionEnergyDelivered[si.idx], 0)
        evEnergyRemainingKwh = sessionDemands.reduce((s, d) => Math.max(d.si.energyNeededKwh - sessionEnergyDelivered[d.si.idx], 0) + s, 0)

        // ── Step 4: Trickle recharge during session ──
        if (trickleRechargeEnabled && batterySocKwh < maxSocKwh) {
          const gridUsed = gridToEvKw
          const gridSpare = Math.max(gridConnectionLimit - gridUsed, 0)
          const pvRemaining = Math.max(pvKw - pvToEvKw, 0)
          let trickle = gridSpare + (pvPriorityCharging ? pvRemaining : 0)
          trickle = Math.min(trickle, maxChargeRate)
          const roomKwh = maxSocKwh - batterySocKwh
          trickle = Math.min(trickle, roomKwh * 60)
          trickle = Math.max(trickle, 0)

          if (pvPriorityCharging && pvRemaining > 0) {
            pvToBatteryKw = Math.min(pvRemaining, trickle)
            gridToBatteryKw = Math.min(gridSpare, trickle - pvToBatteryKw)
          } else {
            gridToBatteryKw = Math.min(gridSpare, trickle)
            pvToBatteryKw = Math.min(pvRemaining, trickle - gridToBatteryKw)
          }
        }

        // ── Step 5: PV surplus → grid export ──
        const pvUsed = pvToEvKw + pvToBatteryKw
        pvToGridKw = Math.max(pvKw - pvUsed, 0)
      }

    } else {
      // ── IDLE: no EV connected ──

      if (batterySocKwh < idleTargetKwh) {
        // Recharge battery
        let chargeNeeded = idleTargetKwh - batterySocKwh
        let chargeRateKw = Math.min(chargeNeeded * 60, maxChargeRate) // cap by charge rate

        if (pvPriorityCharging && pvKw > 0) {
          // PV first
          pvToBatteryKw = Math.min(pvKw, chargeRateKw)
          chargeRateKw -= pvToBatteryKw
        }

        // Grid fills the rest, capped at idle recharge rate
        if (chargeRateKw > 0) {
          gridToBatteryKw = Math.min(chargeRateKw, idleRechargeRateKw)
          // Also cap total (PV + grid) by maxChargeRate
          const totalCharge = pvToBatteryKw + gridToBatteryKw
          if (totalCharge > maxChargeRate) {
            gridToBatteryKw = Math.max(maxChargeRate - pvToBatteryKw, 0)
          }
        }

        // PV surplus after battery charging
        const pvUsed = pvToBatteryKw
        pvToGridKw = Math.max(pvKw - pvUsed, 0)

      } else {
        // Battery at or above target -- all PV surplus to grid
        pvToGridKw = pvKw
      }
    }

    // ── Apply battery state changes (with round-trip efficiency) ──
    const chargeKwh = (pvToBatteryKw + gridToBatteryKw) / 60 // metered input
    const dischargeKwh = batteryToEvKw / 60 // metered output
    // Efficiency losses: only chargeKwh * sqrtEta is stored; dischargeKwh costs dischargeKwh / sqrtEta from SOC
    batterySocKwh = Math.max(minSocKwh, Math.min(maxSocKwh,
      batterySocKwh + chargeKwh * sqrtEta - dischargeKwh / sqrtEta
    ))
    totalDischarged += dischargeKwh

    // ── Costs ──
    const totalGridDrawKw = gridToEvKw + gridToBatteryKw
    const gridKwh = totalGridDrawKw / 60
    const gridCostEur = gridKwh * procurementCostPerKwh
    const evKwhDelivered = totalToEvKw / 60
    const evRevenueEur = evKwhDelivered * retailPricePerKwh
    // Wear accounts for full cycling: both charge and discharge cause degradation.
    // Each kWh of throughput (in or out) represents a half-cycle.
    // Using total throughput gives a fair wear comparison between strategies
    // that cycle differently (e.g., reactive recharges to 90% after every session).
    const batteryWearEur = (dischargeKwh + chargeKwh) * wearCostPerKwh * 0.5

    minutes[m] = {
      minute: m,
      batterySocPct: (batterySocKwh / totalCapacity) * 100,
      batterySocKwh,
      evConnected,
      sessionIdx: activeIntervals.length > 0 ? activeIntervals[0].idx : -1,
      activeSessionIdxs: activeIntervals.map(si => si.idx),
      pvOutputKw: pvKw,
      pvToEvKw,
      pvToBatteryKw,
      pvToGridKw,
      gridToEvKw,
      gridToBatteryKw,
      batteryToEvKw,
      totalToEvKw,
      evMaxAcceptKw,
      evEnergyDeliveredKwh,
      evEnergyRemainingKwh,
      totalGridDrawKw,
      gridLimitKw: gridConnectionLimit,
      gridCostEur,
      evRevenueEur,
      batteryWearEur,
    }
  }

  // ── Summary ──
  let totalEvEnergyKwh = 0
  let totalGridImportKwh = 0
  let totalPvUsedKwh = 0
  let totalPvExportedKwh = 0
  let totalBatteryDischargeKwh = 0
  let totalBatteryChargeKwh = 0
  let peakGridDrawKw = 0
  let minBatterySocPct = 100
  let maxBatterySocPct = 0
  let totalGridCostEur = 0
  let totalEvRevenueEur = 0
  let totalBatteryWearEur = 0
  let evMinutesActive = 0

  for (const min of minutes) {
    totalEvEnergyKwh += min.totalToEvKw / 60
    totalGridImportKwh += min.totalGridDrawKw / 60
    totalPvUsedKwh += (min.pvToEvKw + min.pvToBatteryKw) / 60
    totalPvExportedKwh += min.pvToGridKw / 60
    totalBatteryDischargeKwh += min.batteryToEvKw / 60
    totalBatteryChargeKwh += (min.pvToBatteryKw + min.gridToBatteryKw) / 60
    peakGridDrawKw = Math.max(peakGridDrawKw, min.totalGridDrawKw)
    minBatterySocPct = Math.min(minBatterySocPct, min.batterySocPct)
    maxBatterySocPct = Math.max(maxBatterySocPct, min.batterySocPct)
    totalGridCostEur += min.gridCostEur
    totalEvRevenueEur += min.evRevenueEur
    totalBatteryWearEur += min.batteryWearEur
    if (min.totalToEvKw > 0) evMinutesActive++
  }

  // Per-session QoS
  let sessionsFullyServed = 0
  let sessionsPartiallyServed = 0
  for (let i = 0; i < sorted.length; i++) {
    const needed = sorted[i].energyRequestedKwh
    const delivered = sessionEnergyDelivered[i]
    if (delivered >= needed - 0.1) {
      sessionsFullyServed++
    } else {
      sessionsPartiallyServed++
    }
  }

  const r = (v: number) => Math.round(v * 100) / 100

  return {
    minutes,
    summary: {
      totalEvEnergyKwh: r(totalEvEnergyKwh),
      totalGridImportKwh: r(totalGridImportKwh),
      totalPvUsedKwh: r(totalPvUsedKwh),
      totalPvExportedKwh: r(totalPvExportedKwh),
      totalBatteryDischargeKwh: r(totalBatteryDischargeKwh),
      totalBatteryChargeKwh: r(totalBatteryChargeKwh),
      peakGridDrawKw: r(peakGridDrawKw),
      minBatterySocPct: r(minBatterySocPct),
      maxBatterySocPct: r(maxBatterySocPct),
      totalGridCostEur: r(totalGridCostEur),
      totalEvRevenueEur: r(totalEvRevenueEur),
      totalBatteryWearEur: r(totalBatteryWearEur),
      netProfitEur: r(totalEvRevenueEur - totalGridCostEur - totalBatteryWearEur),
      sessionsFullyServed,
      sessionsPartiallyServed,
      totalSessionCount: sorted.length,
      avgEvPowerKw: evMinutesActive > 0 ? r((totalEvEnergyKwh / evMinutesActive) * 60) : 0,
    },
  }
}
