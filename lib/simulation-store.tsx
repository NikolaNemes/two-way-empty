"use client"

import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from "react"
import { GRID_MAX_KW } from "@/lib/optimizer/params"

// ── Site Setup Types ──
export interface ChargerHardware {
  model: string
  maxHardwareOutput: number // kW
  connectorCount: number // 1 or 2 charging posts
}

export interface GridConnection {
  gridConnectionLimit: number // kW
}

export interface BatteryPack {
  totalCapacity: number // kWh
  socFloor: number // %
  socCeiling: number // %
  usableCapacity: number // kWh (derived but editable)
  maxDischargeRate: number // kW -- max power OUT of battery (to EV/grid)
  maxChargeRate: number // kW -- max power INTO battery (from grid/PV)
  startSoc: number // %
  roundTripEfficiency: number // 0-1, e.g. 0.90 = 90% RTE. Split as sqrt(η) on each leg.
}

export interface BatteryWear {
  cycleLife: number
  batteryReplacementCost: number // EUR
  maxDailyCycles: number
  maxDailyDischarge: number // kWh (derived but editable)
  costPerCycle: number // EUR (derived but editable)
  wearCostPerKwh: number // EUR/kWh (derived but editable)
}

export interface PvSolarPlant {
  installedCapacityKwp: number // kWp
  chargerSharePercent: number // % of PV output allocated to charger
  systemLossPercent: number // % system losses (cables, inverter, etc.)
  azimuthDeg: number // 0 = south in Germany, typical for supermarket roof
  tiltDeg: number // typical ~30° for German latitude
  // Hourly capacity factors (kW per kWp) for a typical July day in Germany
  // Source: PVGIS / Fraunhofer ISE typical profiles
  hourlyCapacityFactors: number[] // 24 values, kW per kWp
}

export interface SimulationSettings {
  timeResolution: number // minutes
}

export interface SiteSetup {
  charger: ChargerHardware
  grid: GridConnection
  battery: BatteryPack
  wear: BatteryWear
  pv: PvSolarPlant
  simulation: SimulationSettings
}

// ── Grid Export Types ──
export interface GridExportConfig {
  exportEnabled: boolean
  // Feed-in mechanism
  mechanism: "eeg-surplus" | "direktvermarktung" | "spot-indexed"
  // EEG surplus feed-in (Überschusseinspeisung) -- for PV < 750 kWp
  eegFeedInTariff: number // EUR/kWh, current EEG rate for 100-750 kWp partial
  // Direktvermarktung -- sold on EPEX SPOT via aggregator
  aggregatorFee: number // EUR/kWh, management fee charged by Direktvermarkter
  // Spot-indexed export -- battery-to-grid at EPEX price minus fees
  gridExportFee: number // EUR/kWh, network usage + metering for battery export
  // Common
  maxExportCapacity: number // kW, limited by grid connection / transformer
  exportFloorPrice: number // EUR/kWh, don't export below this price
}

// ── Grid Pricing Types ──
export interface GridPricing {
  // CPO imports at dynamic tariff: EPEX Spot(h) + fixed grid fees/taxes
  gridFeesAndTaxes: number // EUR/kWh -- Netzentgelt, Stromsteuer, Konzessionsabgabe
  epexSpotPrices: number[] // 96 values (15-min resolution) EUR/kWh (EPEX SPOT Intraday / DAM interpolated)
  annualDemandCharge: number // EUR/kW/yr -- Leistungspreis on peak 15-min grid draw
  dailyDemandCharge: number // EUR/kW/day (derived but editable)
  // EV driver pays a flat retail price (Ladesaulenverordnung ad-hoc)
  retailPricePerKwh: number // EUR/kWh -- flat rate charged to EV driver
}

// ── Charging Sessions Types ──
export interface ChargingSession {
  id: number
  connectorId: number // 1 or 2 -- which charging post (default 1)
  startTime: string // "HH:MM"
  durationMinutes: number
  vehicleType: string // e.g. "Compact EV", "SUV EV", "Van"
  batteryCapacityKwh: number // EV onboard battery size
  arrivalSoc: number // % SOC on arrival
  targetSoc: number // % desired SOC at departure
  maxAcceptRateKw: number // max DC charging rate the EV can accept
  energyRequestedKwh: number // derived: capacity * (target - arrival) / 100
}

// ── Reactive BMS Configuration Types ──
export interface ReactiveBmsConfig {
  // Idle recharge behavior
  idleTargetSoc: number // % -- target SOC when no EV is connected (default 80% for better EV readiness)
  idleRechargeRateKw: number // kW -- max grid power used to recharge battery when idle (default 50)
  // SOC derating bands (discharge power limit based on battery SOC)
  // Full power above deratingStartSoc, linear ramp to 0 at socFloor
  deratingStartSoc: number // % -- SOC below which battery discharge begins derating (default 30)
  // Trickle recharge during EV sessions
  trickleRechargeEnabled: boolean // If true, spare grid capacity recharges battery during EV session
  // PV priority
  pvPriorityCharging: boolean // If true, PV power is used before grid for all operations
}

// ── Planner Output Types (Layer 1 output fed to Layer 2) ──
export interface PlannerSchedule {
  socTargetCurve: number[] // 1440 values: minute-by-minute SOC target (%)
  gridImportGate: { allowed: boolean; maxRate: number }[] // 96 values: per 15-min slot
  pvRoutingHint: ("store" | "export")[] // 1440 values: per minute
  priceZones: ("cheap" | "moderate" | "expensive" | "peak")[] // 96 values: per 15-min slot
  readinessScore: number[] // 1440 values: normalized 0-1 readiness
  demandStartMin: number // first minute where readiness >= 0.3
  demandEndMin: number // last minute where readiness >= 0.1
  referenceSoc: number // SOC target at 06:00 -- the daily anchor for day continuity
}

// ── BMS Simulation Output Types ──
export interface BmsSimulationMinute {
  minute: number // 0-1439
  // State
  batterySocPct: number // % at END of this minute
  batterySocKwh: number // kWh at END of this minute
  evConnected: boolean // is an EV plugged in?
  sessionIdx: number // index into chargingSessions (-1 if idle), first active session only
  activeSessionIdxs: number[] // ALL active session indices this minute (multi-connector)
  // Power flows (kW, positive = flow in that direction)
  pvOutputKw: number // total PV output this minute (charger share)
  pvToEvKw: number // PV power going to EV
  pvToBatteryKw: number // PV power going to battery
  pvToGridKw: number // PV power exported to grid (surplus)
  gridToEvKw: number // grid power going to EV
  gridToBatteryKw: number // grid power going to battery (idle recharge + trickle)
  batteryToEvKw: number // battery power going to EV (discharge)
  totalToEvKw: number // total power delivered to EV (sum of PV+grid+battery)
  evMaxAcceptKw: number // what the EV wants (max accept rate or 0 if no EV)
  // EV session tracking
  evEnergyDeliveredKwh: number // cumulative kWh delivered to current EV (resets per session)
  evEnergyRemainingKwh: number // kWh still needed by current EV
  // Grid
  totalGridDrawKw: number // total grid import (to EV + to battery)
  gridLimitKw: number // grid connection limit (constant)
  // Costs/revenue this minute (EUR)
  gridCostEur: number // EPEX + fees for grid kWh consumed
  evRevenueEur: number // retail price for kWh delivered to EV
  batteryWearEur: number // wear cost for kWh discharged from battery
}

// ── Default Values ──
const defaultSiteSetup: SiteSetup = {
  charger: {
  model: "ADS-TEC CP320",
  maxHardwareOutput: 230,
  connectorCount: 1,
  },
  grid: {
    // Single source of truth: the site's 87 kW connection (GRID_MAX_KW /
    // GRID_IMPORT_LIMIT_KW). Was 80, drifting from the dispatch algorithm.
    gridConnectionLimit: GRID_MAX_KW,
  },
  battery: {
    totalCapacity: 143,
    socFloor: 20,
    socCeiling: 90,
    usableCapacity: 100,
    maxDischargeRate: 150, // ~1.05C discharge (high-power LFP, ADS-TEC spec)
    maxChargeRate: 80, // ~0.56C charge (slower than discharge, typical LFP longevity)
    startSoc: 80, // % -- matches idleTargetSoc for consistent start/end
    roundTripEfficiency: 0.90, // 90% RTE -- typical LFP. NMC ~88-92%.
  },
  wear: {
    cycleLife: 5000,
    batteryReplacementCost: 35750,
    maxDailyCycles: 3.0,
    maxDailyDischarge: 300,
    costPerCycle: 7.15,
    wearCostPerKwh: 0.0715,
  },
  pv: {
    installedCapacityKwp: 150,
    chargerSharePercent: 40,
    systemLossPercent: 14,
    azimuthDeg: 0, // south-facing
    tiltDeg: 30,
    // Typical July day in southern Germany (PVGIS data, crystalline Si, ~48°N)
    // Values are kW output per kWp installed, hourly averages
    hourlyCapacityFactors: [
      0.000, 0.000, 0.000, 0.000, 0.000, 0.020, // 00-05
      0.080, 0.180, 0.350, 0.520, 0.680, 0.780, // 06-11
      0.830, 0.850, 0.810, 0.730, 0.600, 0.440, // 12-17
      0.270, 0.120, 0.030, 0.000, 0.000, 0.000, // 18-23
    ],
  },
  simulation: {
    timeResolution: 1,
  },
}

const defaultBmsConfig: ReactiveBmsConfig = {
  idleTargetSoc: 80, // % -- higher target for better EV readiness (user preference)
  idleRechargeRateKw: 50, // kW -- ~63% of 80kW grid, leaves headroom for surprise arrivals
  deratingStartSoc: 30, // % -- full power above 30%, linear ramp to 0 at socFloor (20%)
  trickleRechargeEnabled: true, // spare grid capacity recharges battery during EV sessions
  pvPriorityCharging: true, // always use PV before grid
}

const defaultGridExport: GridExportConfig = {
  exportEnabled: true,
  mechanism: "direktvermarktung",
  // EEG 2024/2025: ~5.68 ct/kWh for 100-750 kWp partial surplus (degression applies)
  eegFeedInTariff: 0.0568,
  // Typical aggregator fee: 0.3-0.5 ct/kWh
  aggregatorFee: 0.004,
  // Grid usage fee for battery export ~2-3 ct/kWh
  gridExportFee: 0.025,
  // Grid connection is bidirectional but limited
  maxExportCapacity: 60, // kW, often lower than import due to transformer limits
  // Don't export when EPEX is below this (avoid selling at loss)
  exportFloorPrice: 0.02,
}

const defaultGridPricing: GridPricing = {
  // Dynamic grid import: CPO pays EPEX Spot(h) + fixed grid fees/taxes
  // Breakdown for Niederspannung (low voltage) commercial connection:
  //   Netzentgelt Arbeitspreis: ~5.0 ct/kWh (DSO-dependent, avg for NS)
  //   Stromsteuer:              2.05 ct/kWh (fixed by law, §3 StromStG)
  //   Konzessionsabgabe:        0.11 ct/kWh (Sondervertragskunde, §2 KAV)
  //   Offshore-Netzumlage:      0.66 ct/kWh (2025, §17f EnWG)
  //   KWKG-Umlage:              0.00 ct/kWh (abolished 2023)
  //   §19 StromNEV-Umlage:      0.00 ct/kWh (abolished 2023)
  //   Messstellenbetrieb:        ~0.18 ct/kWh (smart meter, allocated per kWh)
  //   ─────────────────────────────────
  //   Total:                    ~8.0 ct/kWh
  gridFeesAndTaxes: 0.08,
  // Realistic EPEX SPOT prices at 15-min resolution for a summer Saturday in Germany
  // Based on July 2024 EPEX SPOT Intraday auction pattern (96 quarter-hours)
  // Prices show intra-hour variation: ramps between hours, not flat blocks
  // Low midday (solar surplus), evening peak, overnight moderate
  epexSpotPrices: [
    // 00:00-00:45 (overnight, flat)
    0.046, 0.045, 0.044, 0.043,
    // 01:00-01:45
    0.042, 0.041, 0.040, 0.039,
    // 02:00-02:45
    0.038, 0.037, 0.036, 0.035,
    // 03:00-03:45
    0.034, 0.033, 0.032, 0.031,
    // 04:00-04:45 (overnight low)
    0.030, 0.030, 0.031, 0.033,
    // 05:00-05:45 (pre-dawn ramp starts)
    0.035, 0.038, 0.042, 0.047,
    // 06:00-06:45 (morning ramp)
    0.052, 0.055, 0.060, 0.065,
    // 07:00-07:45 (morning peak)
    0.068, 0.070, 0.068, 0.065,
    // 08:00-08:45 (dropping, solar coming online)
    0.062, 0.058, 0.055, 0.050,
    // 09:00-09:45
    0.046, 0.042, 0.038, 0.035,
    // 10:00-10:45 (solar ramping)
    0.032, 0.028, 0.025, 0.022,
    // 11:00-11:45 (solar surplus building)
    0.020, 0.018, 0.016, 0.014,
    // 12:00-12:45 (solar peak, lowest prices)
    0.013, 0.012, 0.011, 0.010,
    // 13:00-13:45 (still low)
    0.010, 0.010, 0.011, 0.012,
    // 14:00-14:45 (slowly rising)
    0.014, 0.015, 0.017, 0.019,
    // 15:00-15:45 (afternoon ramp begins)
    0.022, 0.025, 0.030, 0.035,
    // 16:00-16:45 (solar fading, demand up)
    0.042, 0.048, 0.055, 0.065,
    // 17:00-17:45 (steep evening ramp)
    0.075, 0.085, 0.095, 0.108,
    // 18:00-18:45 (evening peak starts)
    0.118, 0.125, 0.132, 0.138,
    // 19:00-19:45 (peak hour)
    0.142, 0.145, 0.144, 0.140,
    // 20:00-20:45 (post-peak decline)
    0.135, 0.128, 0.120, 0.112,
    // 21:00-21:45
    0.098, 0.088, 0.080, 0.075,
    // 22:00-22:45
    0.068, 0.062, 0.058, 0.055,
    // 23:00-23:45
    0.052, 0.050, 0.048, 0.047,
  ],
  // Leistungspreis (demand charge) -- Niederspannung typical range: 25-40 EUR/kW/yr
  // Based on DSO published Netzentgelt tables (Preisblatt Netzentgelte):
  //   NS ohne Messung: ~30 EUR/kW/yr (avg across major DSOs: Westnetz, Bayernwerk, E.DIS)
  //   Measured on highest 15-min average power draw in the billing year
  annualDemandCharge: 30, // EUR/kW/yr -- realistic NS Leistungspreis
  dailyDemandCharge: 0.082, // EUR/kW/day (30 / 365)
  // Flat retail price: 59 ct/kWh (competitive HPC rate, Ladesaulenverordnung ad-hoc)
  retailPricePerKwh: 0.59,
}

// Helper to compute energy requested
function sessDef(
  id: number, startTime: string, durationMinutes: number,
  vehicleType: string, batteryCapacityKwh: number,
  arrivalSoc: number, targetSoc: number, maxAcceptRateKw: number,
  connectorId: number = 1,
  ): ChargingSession {
  return {
  id, connectorId, startTime, durationMinutes, vehicleType,
  batteryCapacityKwh, arrivalSoc, targetSoc, maxAcceptRateKw,
  energyRequestedKwh: Math.round(batteryCapacityKwh * (targetSoc - arrivalSoc) / 100 * 10) / 10,
  }
  }

// Realistic summer Saturday at a supermarket with SINGLE HPC unit (ADS-TEC CP320)
// Sequential queue -- one EV at a time, gaps represent connector idle time
// Sources: BDEW load profiles, Allego/EnBW station utilization reports
// Mix: ~60% compact/sedan, ~25% SUV, ~10% van/delivery, ~5% large battery
// Dwell = charging time only (single connector, no idle dwelling)
// Typical utilization for a busy supermarket HPC: ~65-75% during opening hours
//
// ── SOC Assumptions (arrivalSoc / targetSoc) ──
// These are MANUALLY ASSUMED based on observed HPC user behavior:
//
// arrivalSoc (20-50%):
//   - HPC users arrive with low SOC -- that's WHY they use fast charging
//   - Average HPC arrival SOC is ~25-35% (Fastned 2023 transparency report, Ionity usage data)
//   - Some arrive higher (40-50%) for short top-ups during errands
//   - Delivery vans (eVito, eSprinter) arrive lower (20-25%) due to route depletion
//
// targetSoc (55-80%):
//   - HPC users almost NEVER charge to 100% -- DC charging slows dramatically above 80%
//     (BMS taper: 150kW @ 60% -> 50kW @ 80% -> 20kW @ 90% is typical)
//   - Supermarket dwell time is 20-40 min, so target is "enough to get home", not "full"
//   - Average HPC departure SOC is ~65-75% (Fastned, EnBW public data)
//   - Lower targets (55-65%) = quick top-up shoppers, in/out fast
//   - Higher targets (75-80%) = longer trip ahead, willing to wait
//
// These values are NOT randomized. Each session is a plausible scenario.
// In production, replace with real OCPP session logs from the CPO backend.
//
const defaultChargingSessions: ChargingSession[] = [
  // Early morning -- store opens 07:00                   plug-in  dur  vehicle                        batt  arr%  tgt%  maxkW
  sessDef(1,  "07:10", 25, "VW ID.3 (58 kWh)",            58,  45, 80, 120),    // out 07:35
  sessDef(2,  "07:40", 20, "Renault Megane E-Tech",        60,  30, 65, 130),    // out 08:00

  // Morning shoppers
  sessDef(3,  "08:05", 30, "Tesla Model Y LR",             75,  25, 70, 250),    // out 08:35
  sessDef(4,  "08:40", 25, "Hyundai Ioniq 5",              77,  40, 75, 220),    // out 09:05
  sessDef(5,  "09:10", 35, "Delivery Van (eVito)",          60,  20, 80, 110),    // out 09:45
  sessDef(6,  "09:50", 20, "Fiat 500e (42 kWh)",            42,  35, 70,  85),    // out 10:10

  // Mid-morning
  sessDef(7,  "10:15", 25, "BMW iX3",                       74,  30, 65, 150),    // out 10:40
  sessDef(8,  "10:45", 20, "Peugeot e-308",                 54,  50, 80, 100),    // out 11:05
  sessDef(9,  "11:10", 30, "Skoda Enyaq iV 80",             77,  20, 60, 135),    // out 11:40

  // Lunch rush -- shorter gaps, higher demand
  sessDef(10, "11:45", 25, "Tesla Model 3 SR",              60,  35, 70, 170),    // out 12:10
  sessDef(11, "12:15", 30, "Mercedes EQC",                   80,  25, 65, 110),    // out 12:45
  sessDef(12, "12:50", 25, "VW ID.4 GTX",                   77,  40, 80, 135),    // out 13:15
  sessDef(13, "13:20", 20, "Opel Corsa-e",                   50,  30, 60, 100),    // out 13:40
  sessDef(14, "13:45", 30, "Audi Q4 e-tron",                82,  20, 60, 135),    // out 14:15

  // Early afternoon
  sessDef(15, "14:20", 25, "Cupra Born (58 kWh)",           58,  45, 80, 120),    // out 14:45
  sessDef(16, "14:50", 35, "Delivery Van (eSprinter)",     113,  25, 70, 115),    // out 15:25
  sessDef(17, "15:30", 25, "Hyundai Kona Electric",         64,  35, 70, 100),    // out 15:55

  // Late afternoon
  sessDef(18, "16:00", 25, "Tesla Model Y SR",              60,  30, 65, 250),    // out 16:25
  sessDef(19, "16:30", 30, "Kia EV6 GT-Line",               77,  20, 55, 240),    // out 17:00
  sessDef(20, "17:05", 20, "MG4 Standard",                   51,  40, 70,  87),    // out 17:25
  sessDef(21, "17:30", 25, "BMW i4 eDrive40",               84,  25, 60, 200),    // out 17:55

  // Evening wind-down -- longer gaps
  sessDef(22, "18:05", 25, "VW ID.3 Pro S",                 77,  35, 65, 170),    // out 18:30
  sessDef(23, "18:40", 30, "Volvo EX30",                     69,  30, 70, 153),    // out 19:10
  sessDef(24, "19:20", 25, "Renault Zoe (52 kWh)",          52,  25, 60,  46),    // out 19:45
  sessDef(25, "19:55", 20, "Polestar 2 LR",                 78,  45, 75, 205),    // out 20:15
]

// 2-connector default sessions: same vehicles, distributed across 2 posts (more overlap, higher throughput)
const defaultChargingSessions2Post: ChargingSession[] = [
  // Post 1 -- odd-numbered sessions
  sessDef(1,  "07:10", 25, "VW ID.3 (58 kWh)",            58,  45, 80, 120, 1),
  sessDef(3,  "07:40", 30, "Tesla Model Y LR",             75,  25, 70, 250, 1),
  sessDef(5,  "08:15", 35, "Delivery Van (eVito)",          60,  20, 80, 110, 1),
  sessDef(7,  "08:55", 25, "BMW iX3",                       74,  30, 65, 150, 1),
  sessDef(9,  "09:25", 30, "Skoda Enyaq iV 80",             77,  20, 60, 135, 1),
  sessDef(11, "10:00", 30, "Mercedes EQC",                   80,  25, 65, 110, 1),
  sessDef(13, "10:35", 20, "Opel Corsa-e",                   50,  30, 60, 100, 1),
  sessDef(15, "11:00", 25, "Cupra Born (58 kWh)",           58,  45, 80, 120, 1),
  sessDef(17, "11:30", 25, "Hyundai Kona Electric",         64,  35, 70, 100, 1),
  sessDef(19, "12:00", 30, "Kia EV6 GT-Line",               77,  20, 55, 240, 1),
  sessDef(21, "12:35", 25, "BMW i4 eDrive40",               84,  25, 60, 200, 1),
  sessDef(23, "13:05", 30, "Volvo EX30",                     69,  30, 70, 153, 1),
  sessDef(25, "13:40", 20, "Polestar 2 LR",                 78,  45, 75, 205, 1),
  // Post 2 -- even-numbered sessions
  sessDef(2,  "07:10", 20, "Renault Megane E-Tech",          60,  30, 65, 130, 2),
  sessDef(4,  "07:35", 25, "Hyundai Ioniq 5",                77,  40, 75, 220, 2),
  sessDef(6,  "08:05", 20, "Fiat 500e (42 kWh)",             42,  35, 70,  85, 2),
  sessDef(8,  "08:30", 20, "Peugeot e-308",                  54,  50, 80, 100, 2),
  sessDef(10, "08:55", 25, "Tesla Model 3 SR",               60,  35, 70, 170, 2),
  sessDef(12, "09:25", 25, "VW ID.4 GTX",                    77,  40, 80, 135, 2),
  sessDef(14, "09:55", 30, "Audi Q4 e-tron",                 82,  20, 60, 135, 2),
  sessDef(16, "10:30", 35, "Delivery Van (eSprinter)",      113,  25, 70, 115, 2),
  sessDef(18, "11:10", 25, "Tesla Model Y SR",               60,  30, 65, 250, 2),
  sessDef(20, "11:40", 20, "MG4 Standard",                    51,  40, 70,  87, 2),
  sessDef(22, "12:05", 25, "VW ID.3 Pro S",                  77,  35, 65, 170, 2),
  sessDef(24, "12:35", 25, "Renault Zoe (52 kWh)",           52,  25, 60,  46, 2),
]

// ── Simulation snapshot: frozen config at time of "Run Simulation" ──
export interface SimulationSnapshot {
  siteSetup: SiteSetup
  gridPricing: GridPricing
  gridExport: GridExportConfig
  chargingSessions: ChargingSession[]
  bmsConfig: ReactiveBmsConfig
  version: number
}

// ── Context ──
interface SimulationStore {
  siteSetup: SiteSetup
  gridPricing: GridPricing
  gridExport: GridExportConfig
  chargingSessions: ChargingSession[]
  bmsConfig: ReactiveBmsConfig
  updateSiteSetup: (updates: Partial<SiteSetup>) => void
  updateCharger: (updates: Partial<ChargerHardware>) => void
  updateGrid: (updates: Partial<GridConnection>) => void
  updateBattery: (updates: Partial<BatteryPack>) => void
  updateWear: (updates: Partial<BatteryWear>) => void
  updatePv: (updates: Partial<PvSolarPlant>) => void
  updateSimulation: (updates: Partial<SimulationSettings>) => void
  updateGridPricing: (updates: Partial<GridPricing>) => void
  updateGridExport: (updates: Partial<GridExportConfig>) => void
  updateBmsConfig: (updates: Partial<ReactiveBmsConfig>) => void
  setChargingSessions: (sessions: ChargingSession[]) => void
  switchConnectorCount: (count: 1 | 2) => void
  resetToDefaults: () => void
  // Simulation run control
  snapshot: SimulationSnapshot // frozen config from last "Run Simulation" click
  isStale: boolean // true when params changed since last run
  runSimulation: () => void // takes a snapshot and increments version
}

const SimulationContext = createContext<SimulationStore | null>(null)

export function useSimulation() {
  const ctx = useContext(SimulationContext)
  if (!ctx) throw new Error("useSimulation must be used within SimulationProvider")
  return ctx
}

// ── Session storage persistence helpers ──
// v3: Changed idleTargetSoc default from 50% to 80%, startSoc from 90% to 80%
// v4: Changed riskFactor default from 50 to 75 (more aggressive cost optimization)
// v5: Changed riskFactor default to 100, made risk scale more aggressive (block moderate/expensive at 100)
const STORAGE_KEY = "enexa-ems-state-v5"

interface PersistedState {
  siteSetup: SiteSetup
  gridPricing: GridPricing
  gridExport: GridExportConfig
  chargingSessions: ChargingSession[]
  bmsConfig: ReactiveBmsConfig
}

function loadPersistedState(): PersistedState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PersistedState
  } catch { return null }
}

function persistState(state: PersistedState) {
  if (typeof window === "undefined") return
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* quota exceeded, ignore */ }
}

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  // Restore from sessionStorage on mount (survives error boundary remounts & HMR)
  const restored = useRef(loadPersistedState()).current

  const [siteSetup, setSiteSetup] = useState<SiteSetup>(() => {
    const s = restored?.siteSetup ?? defaultSiteSetup
    return { ...s, battery: { ...defaultSiteSetup.battery, ...s.battery, roundTripEfficiency: s.battery?.roundTripEfficiency ?? defaultSiteSetup.battery.roundTripEfficiency } }
  })
  const [gridPricing, setGridPricing] = useState<GridPricing>(restored?.gridPricing ?? defaultGridPricing)
  const [gridExport, setGridExport] = useState<GridExportConfig>(restored?.gridExport ?? defaultGridExport)
  const [chargingSessions, setChargingSessions] = useState<ChargingSession[]>(restored?.chargingSessions ?? defaultChargingSessions)
  const [bmsConfig, setBmsConfig] = useState<ReactiveBmsConfig>(restored?.bmsConfig ?? defaultBmsConfig)
  const [isDirty, setIsDirty] = useState(false)

  // Persist to sessionStorage on every state change
  useEffect(() => {
    persistState({ siteSetup, gridPricing, gridExport, chargingSessions, bmsConfig })
  }, [siteSetup, gridPricing, gridExport, chargingSessions, bmsConfig])

  // Refs that always hold the latest state (avoids stale closures in runSimulation)
  const latestRef = useRef({ siteSetup, gridPricing, gridExport, chargingSessions, bmsConfig })
  latestRef.current = { siteSetup, gridPricing, gridExport, chargingSessions, bmsConfig }

  // Initial snapshot uses restored or defaults (with migration guards for new fields)
  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(() => {
    const restoredSite = restored?.siteSetup ?? defaultSiteSetup
    // Ensure new fields added after initial release have proper defaults
    const battery = {
      ...defaultSiteSetup.battery,
      ...restoredSite.battery,
      roundTripEfficiency: restoredSite.battery?.roundTripEfficiency ?? defaultSiteSetup.battery.roundTripEfficiency,
    }
    const bms = {
      ...defaultBmsConfig,
      ...(restored?.bmsConfig ?? defaultBmsConfig),
    }
    const charger = {
      ...defaultSiteSetup.charger,
      ...restoredSite.charger,
      connectorCount: restoredSite.charger?.connectorCount ?? 1,
    }
    // Ensure existing sessions have connectorId (default to 1)
    const sessions = (restored?.chargingSessions ?? defaultChargingSessions).map(s => ({
      ...s,
      connectorId: s.connectorId ?? 1,
    }))
    return {
      siteSetup: { ...restoredSite, battery, charger },
      gridPricing: restored?.gridPricing ?? defaultGridPricing,
      gridExport: restored?.gridExport ?? defaultGridExport,
      chargingSessions: sessions,
      bmsConfig: bms,
      version: 1,
    }
  })

  const bumpConfig = useCallback(() => {
    setIsDirty(true)
  }, [])

  const updateSiteSetup = useCallback((updates: Partial<SiteSetup>) => {
    setSiteSetup(prev => ({ ...prev, ...updates })); bumpConfig()
  }, [bumpConfig])

  const updateCharger = useCallback((updates: Partial<ChargerHardware>) => {
  setSiteSetup(prev => ({ ...prev, charger: { ...prev.charger, ...updates } })); bumpConfig()
  }, [bumpConfig])

  const switchConnectorCount = useCallback((count: 1 | 2) => {
    setSiteSetup(prev => ({ ...prev, charger: { ...prev.charger, connectorCount: count } }))
    setChargingSessions(count === 2 ? defaultChargingSessions2Post : defaultChargingSessions)
    bumpConfig()
  }, [bumpConfig])

  const updateGrid = useCallback((updates: Partial<GridConnection>) => {
    setSiteSetup(prev => ({ ...prev, grid: { ...prev.grid, ...updates } })); bumpConfig()
  }, [bumpConfig])

  const updateBattery = useCallback((updates: Partial<BatteryPack>) => {
    setSiteSetup(prev => ({ ...prev, battery: { ...prev.battery, ...updates } })); bumpConfig()
  }, [bumpConfig])

  const updateWear = useCallback((updates: Partial<BatteryWear>) => {
    setSiteSetup(prev => ({ ...prev, wear: { ...prev.wear, ...updates } })); bumpConfig()
  }, [bumpConfig])

  const updatePv = useCallback((updates: Partial<PvSolarPlant>) => {
    setSiteSetup(prev => ({ ...prev, pv: { ...prev.pv, ...updates } })); bumpConfig()
  }, [bumpConfig])

  const updateSimulation = useCallback((updates: Partial<SimulationSettings>) => {
    setSiteSetup(prev => ({ ...prev, simulation: { ...prev.simulation, ...updates } })); bumpConfig()
  }, [bumpConfig])

  const updateGridPricing = useCallback((updates: Partial<GridPricing>) => {
    setGridPricing(prev => ({ ...prev, ...updates })); bumpConfig()
  }, [bumpConfig])

  const updateGridExport = useCallback((updates: Partial<GridExportConfig>) => {
    setGridExport(prev => ({ ...prev, ...updates })); bumpConfig()
  }, [bumpConfig])

  const updateBmsConfig = useCallback((updates: Partial<ReactiveBmsConfig>) => {
    setBmsConfig(prev => ({ ...prev, ...updates })); bumpConfig()
  }, [bumpConfig])

  const runSimulation = useCallback(() => {
    const cur = latestRef.current
    setSnapshot(prev => ({
      siteSetup: cur.siteSetup,
      gridPricing: cur.gridPricing,
      gridExport: cur.gridExport,
      chargingSessions: cur.chargingSessions,
      bmsConfig: cur.bmsConfig,
      version: prev.version + 1,
    }))
    setIsDirty(false)
  }, [])

  const resetToDefaults = useCallback(() => {
    setSiteSetup(defaultSiteSetup)
    setGridPricing(defaultGridPricing)
    setGridExport(defaultGridExport)
    setChargingSessions(defaultChargingSessions)
    setBmsConfig(defaultBmsConfig)
    setSnapshot(prev => ({
      siteSetup: defaultSiteSetup,
      gridPricing: defaultGridPricing,
      gridExport: defaultGridExport,
      chargingSessions: defaultChargingSessions,
      bmsConfig: defaultBmsConfig,
      version: prev.version + 1,
    }))
    setIsDirty(false)
    try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }, [])

  const ctxValue = useMemo(() => ({
    siteSetup,
    gridPricing,
    gridExport,
    chargingSessions,
    bmsConfig,
    updateSiteSetup,
    updateCharger,
    updateGrid,
    updateBattery,
    updateWear,
    updatePv,
    updateSimulation,
    updateGridPricing,
    updateGridExport,
    updateBmsConfig,
    setChargingSessions,
    switchConnectorCount,
    resetToDefaults,
    snapshot,
    isStale: isDirty,
    runSimulation,
  }), [siteSetup, gridPricing, gridExport, chargingSessions, bmsConfig, snapshot, isDirty,
  updateSiteSetup, updateCharger, updateGrid, updateBattery, updateWear, updatePv, updateSimulation,
  updateGridPricing, updateGridExport, updateBmsConfig, setChargingSessions,
  switchConnectorCount, resetToDefaults, runSimulation])

  return (
    <SimulationContext.Provider value={ctxValue}>
      {children}
    </SimulationContext.Provider>
  )
}
