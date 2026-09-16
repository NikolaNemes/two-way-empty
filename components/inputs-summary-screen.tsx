"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { PageHeader } from "@/components/page-header"
import { MapPin, Euro, Sun, Car, Battery, Zap, Info, Clock, Gauge } from "lucide-react"
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip as RechartsTooltip } from "recharts"

// ============== HARDCODED SITE SETUP (matches simulation-store.tsx defaults) ==============
const SITE = {
  location: "Stuttgart, Germany",
  chargerModel: "ADS-TEC CP320",
  chargerMaxOutput: 230, // kW - matches store default
  connectors: 1,
  gridConnectionLimit: 80, // kW
  batteryCapacity: 143, // kWh
  batteryUsable: 100, // kWh (70% DoD)
  batterySocFloor: 20, // %
  batterySocCeiling: 90, // %
  batteryMaxDischarge: 150, // kW ~1.05C discharge
  batteryMaxCharge: 80, // kW ~0.56C charge
  batteryRTE: 0.90, // 90% round-trip efficiency
  cycleLife: 5000,
  cyclesPerDay: 3,
  wearCostPerKwh: 0.0715, // EUR/kWh - matches store (35750 / (5000 * 100))
}

// ============== GRID PRICING (matches simulation-store.tsx defaults) ==============
const GRID = {
  feesAndTaxes: 0.08, // EUR/kWh - 8 ct/kWh (Netzentgelt + Stromsteuer + fees)
  retailPrice: 0.59, // EUR/kWh - 59 ct/kWh flat rate to EV driver
  demandChargeAnnual: 30, // EUR/kW/yr - NS Leistungspreis
}

// EPEX SPOT prices at 15-min resolution (matches simulation-store.tsx)
// Summer Saturday pattern: low midday (solar surplus), evening peak
const EPEX_15MIN = [
  // 00:00-03:45 (overnight)
  { time: "00:00", price: 4.6 }, { time: "00:15", price: 4.5 }, { time: "00:30", price: 4.4 }, { time: "00:45", price: 4.3 },
  { time: "01:00", price: 4.2 }, { time: "01:15", price: 4.1 }, { time: "01:30", price: 4.0 }, { time: "01:45", price: 3.9 },
  { time: "02:00", price: 3.8 }, { time: "02:15", price: 3.7 }, { time: "02:30", price: 3.6 }, { time: "02:45", price: 3.5 },
  { time: "03:00", price: 3.4 }, { time: "03:15", price: 3.3 }, { time: "03:30", price: 3.2 }, { time: "03:45", price: 3.1 },
  // 04:00-07:45 (morning ramp)
  { time: "04:00", price: 3.0 }, { time: "04:15", price: 3.0 }, { time: "04:30", price: 3.1 }, { time: "04:45", price: 3.3 },
  { time: "05:00", price: 3.5 }, { time: "05:15", price: 3.8 }, { time: "05:30", price: 4.2 }, { time: "05:45", price: 4.7 },
  { time: "06:00", price: 5.2 }, { time: "06:15", price: 5.5 }, { time: "06:30", price: 6.0 }, { time: "06:45", price: 6.5 },
  { time: "07:00", price: 6.8 }, { time: "07:15", price: 7.0 }, { time: "07:30", price: 6.8 }, { time: "07:45", price: 6.5 },
  // 08:00-11:45 (solar coming online, prices dropping)
  { time: "08:00", price: 6.2 }, { time: "08:15", price: 5.8 }, { time: "08:30", price: 5.5 }, { time: "08:45", price: 5.0 },
  { time: "09:00", price: 4.6 }, { time: "09:15", price: 4.2 }, { time: "09:30", price: 3.8 }, { time: "09:45", price: 3.5 },
  { time: "10:00", price: 3.2 }, { time: "10:15", price: 2.8 }, { time: "10:30", price: 2.5 }, { time: "10:45", price: 2.2 },
  { time: "11:00", price: 2.0 }, { time: "11:15", price: 1.8 }, { time: "11:30", price: 1.6 }, { time: "11:45", price: 1.4 },
  // 12:00-15:45 (solar peak, lowest prices)
  { time: "12:00", price: 1.3 }, { time: "12:15", price: 1.2 }, { time: "12:30", price: 1.1 }, { time: "12:45", price: 1.0 },
  { time: "13:00", price: 1.0 }, { time: "13:15", price: 1.0 }, { time: "13:30", price: 1.1 }, { time: "13:45", price: 1.2 },
  { time: "14:00", price: 1.4 }, { time: "14:15", price: 1.5 }, { time: "14:30", price: 1.7 }, { time: "14:45", price: 1.9 },
  { time: "15:00", price: 2.2 }, { time: "15:15", price: 2.5 }, { time: "15:30", price: 3.0 }, { time: "15:45", price: 3.5 },
  // 16:00-19:45 (evening peak)
  { time: "16:00", price: 4.2 }, { time: "16:15", price: 4.8 }, { time: "16:30", price: 5.5 }, { time: "16:45", price: 6.5 },
  { time: "17:00", price: 7.5 }, { time: "17:15", price: 8.5 }, { time: "17:30", price: 9.5 }, { time: "17:45", price: 10.8 },
  { time: "18:00", price: 11.8 }, { time: "18:15", price: 12.5 }, { time: "18:30", price: 13.2 }, { time: "18:45", price: 13.8 },
  { time: "19:00", price: 14.2 }, { time: "19:15", price: 14.5 }, { time: "19:30", price: 14.4 }, { time: "19:45", price: 14.0 },
  // 20:00-23:45 (post-peak decline)
  { time: "20:00", price: 13.5 }, { time: "20:15", price: 12.8 }, { time: "20:30", price: 12.0 }, { time: "20:45", price: 11.2 },
  { time: "21:00", price: 9.8 }, { time: "21:15", price: 8.8 }, { time: "21:30", price: 8.0 }, { time: "21:45", price: 7.5 },
  { time: "22:00", price: 6.8 }, { time: "22:15", price: 6.2 }, { time: "22:30", price: 5.8 }, { time: "22:45", price: 5.5 },
  { time: "23:00", price: 5.2 }, { time: "23:15", price: 5.0 }, { time: "23:30", price: 4.8 }, { time: "23:45", price: 4.7 },
]

// ============== PV DATA (matches simulation-store.tsx defaults) ==============
const PV = {
  installedKwp: 150, // kWp - matches store
  chargerShare: 40, // % allocated to charger
  systemLoss: 14, // % system losses
  azimuth: "South",
  tilt: "30°",
}

// PVGIS hourly capacity factors for July in southern Germany (matches store)
const HOURLY_CF = [
  0.000, 0.000, 0.000, 0.000, 0.000, 0.020, // 00-05
  0.080, 0.180, 0.350, 0.520, 0.680, 0.780, // 06-11
  0.830, 0.850, 0.810, 0.730, 0.600, 0.440, // 12-17
  0.270, 0.120, 0.030, 0.000, 0.000, 0.000, // 18-23
]

// Generate smooth 15-min PV data by interpolating between hourly values
const PV_15MIN = Array.from({ length: 96 }, (_, i) => {
  const hour = Math.floor(i / 4)
  const quarter = i % 4
  const nextHour = (hour + 1) % 24
  // Linear interpolation between current and next hour
  const t = quarter / 4
  const cf = HOURLY_CF[hour] * (1 - t) + HOURLY_CF[nextHour] * t
  return {
    time: `${hour.toString().padStart(2, "0")}:${(quarter * 15).toString().padStart(2, "0")}`,
    kw: cf * PV.installedKwp * (PV.chargerShare / 100) * (1 - PV.systemLoss / 100),
  }
})

// ============== CHARGING SESSIONS (matches simulation-store.tsx defaults) ==============
// Sequential queue - single connector, no overlaps
// Energy = batteryKwh * (targetSoc - arrivalSoc) / 100
const SESSIONS = [
  // Early morning (store opens 07:00)
  { id: 1, vehicle: "VW ID.3 (58 kWh)", time: "07:10", dur: 25, arr: 45, tgt: 80, kwh: 20.3, maxKw: 120 },
  { id: 2, vehicle: "Renault Megane E-Tech", time: "07:40", dur: 20, arr: 30, tgt: 65, kwh: 21.0, maxKw: 130 },
  // Morning shoppers
  { id: 3, vehicle: "Tesla Model Y LR", time: "08:05", dur: 30, arr: 25, tgt: 70, kwh: 33.8, maxKw: 250 },
  { id: 4, vehicle: "Hyundai Ioniq 5", time: "08:40", dur: 25, arr: 40, tgt: 75, kwh: 27.0, maxKw: 220 },
  { id: 5, vehicle: "Delivery Van (eVito)", time: "09:10", dur: 35, arr: 20, tgt: 80, kwh: 36.0, maxKw: 110 },
  { id: 6, vehicle: "Fiat 500e (42 kWh)", time: "09:50", dur: 20, arr: 35, tgt: 70, kwh: 14.7, maxKw: 85 },
  // Mid-morning
  { id: 7, vehicle: "BMW iX3", time: "10:15", dur: 25, arr: 30, tgt: 65, kwh: 25.9, maxKw: 150 },
  { id: 8, vehicle: "Peugeot e-308", time: "10:45", dur: 20, arr: 50, tgt: 80, kwh: 16.2, maxKw: 100 },
  { id: 9, vehicle: "Skoda Enyaq iV 80", time: "11:10", dur: 30, arr: 20, tgt: 60, kwh: 30.8, maxKw: 135 },
  // Lunch rush
  { id: 10, vehicle: "Tesla Model 3 SR", time: "11:45", dur: 25, arr: 35, tgt: 70, kwh: 21.0, maxKw: 170 },
  { id: 11, vehicle: "Mercedes EQC", time: "12:15", dur: 30, arr: 25, tgt: 65, kwh: 32.0, maxKw: 110 },
  { id: 12, vehicle: "VW ID.4 GTX", time: "12:50", dur: 25, arr: 40, tgt: 80, kwh: 30.8, maxKw: 135 },
  { id: 13, vehicle: "Opel Corsa-e", time: "13:20", dur: 20, arr: 30, tgt: 60, kwh: 15.0, maxKw: 100 },
  { id: 14, vehicle: "Audi Q4 e-tron", time: "13:45", dur: 30, arr: 20, tgt: 60, kwh: 32.8, maxKw: 135 },
  // Early afternoon
  { id: 15, vehicle: "Cupra Born (58 kWh)", time: "14:20", dur: 25, arr: 45, tgt: 80, kwh: 20.3, maxKw: 120 },
  { id: 16, vehicle: "Delivery Van (eSprinter)", time: "14:50", dur: 35, arr: 25, tgt: 70, kwh: 50.9, maxKw: 115 },
  { id: 17, vehicle: "Hyundai Kona Electric", time: "15:30", dur: 25, arr: 35, tgt: 70, kwh: 22.4, maxKw: 100 },
  // Late afternoon
  { id: 18, vehicle: "Tesla Model Y SR", time: "16:00", dur: 25, arr: 30, tgt: 65, kwh: 21.0, maxKw: 250 },
  { id: 19, vehicle: "Kia EV6 GT-Line", time: "16:30", dur: 30, arr: 20, tgt: 55, kwh: 27.0, maxKw: 240 },
  { id: 20, vehicle: "MG4 Standard", time: "17:05", dur: 20, arr: 40, tgt: 70, kwh: 15.3, maxKw: 87 },
  { id: 21, vehicle: "BMW i4 eDrive40", time: "17:30", dur: 25, arr: 25, tgt: 60, kwh: 29.4, maxKw: 200 },
  // Evening wind-down
  { id: 22, vehicle: "VW ID.3 Pro S", time: "18:05", dur: 25, arr: 35, tgt: 65, kwh: 23.1, maxKw: 170 },
  { id: 23, vehicle: "Volvo EX30", time: "18:40", dur: 30, arr: 30, tgt: 70, kwh: 27.6, maxKw: 153 },
  { id: 24, vehicle: "Renault Zoe (52 kWh)", time: "19:20", dur: 25, arr: 25, tgt: 60, kwh: 18.2, maxKw: 46 },
  { id: 25, vehicle: "Polestar 2 LR", time: "19:55", dur: 20, arr: 45, tgt: 75, kwh: 23.4, maxKw: 205 },
]

// Helper functions
const timeToMinutes = (time: string) => {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + m
}

const getCarColor = (vehicle: string) => {
  if (vehicle.includes("Tesla")) return "#e82127"
  if (vehicle.includes("BMW")) return "#0066b1"
  if (vehicle.includes("Mercedes")) return "#00adef"
  if (vehicle.includes("VW") || vehicle.includes("Skoda")) return "#001e50"
  if (vehicle.includes("Audi")) return "#bb0a30"
  if (vehicle.includes("Porsche")) return "#c41c3f"
  if (vehicle.includes("Hyundai") || vehicle.includes("Kia")) return "#002c5f"
  if (vehicle.includes("Van") || vehicle.includes("Sprinter") || vehicle.includes("Vito")) return "#ff6b00"
  if (vehicle.includes("Renault") || vehicle.includes("Peugeot") || vehicle.includes("Opel")) return "#ffcc00"
  if (vehicle.includes("Fiat") || vehicle.includes("Mini")) return "#8b0000"
  if (vehicle.includes("Ford")) return "#003478"
  if (vehicle.includes("Volvo")) return "#003057"
  if (vehicle.includes("MG")) return "#c1272d"
  if (vehicle.includes("Nissan")) return "#c3002f"
  if (vehicle.includes("Cupra")) return "#95714f"
  return "#6b7280"
}

// Info tooltip component with optional link and description
function InfoTip({ source, assumption, link, linkLabel, description }: { 
  source: string; 
  assumption: string; 
  link?: string; 
  linkLabel?: string;
  description?: string;
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-center size-4 rounded-full bg-muted hover:bg-muted/80 cursor-help ml-1.5 transition-colors">
          <Info className="size-2.5 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-md p-3 bg-card border border-border shadow-lg rounded-lg">
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <div className="size-5 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-blue-600 dark:text-blue-400 text-[10px] font-bold">S</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Source</p>
              <p className="text-xs text-foreground">{source}</p>
            </div>
          </div>
          {description && (
            <div className="flex items-start gap-2">
              <div className="size-5 rounded bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-purple-600 dark:text-purple-400 text-[10px] font-bold">D</span>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">About This Source</p>
                <p className="text-xs text-foreground/80 leading-relaxed">{description}</p>
              </div>
            </div>
          )}
          <div className="flex items-start gap-2">
            <div className="size-5 rounded bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-amber-600 dark:text-amber-400 text-[10px] font-bold">A</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Assumption</p>
              <p className="text-xs text-foreground">{assumption}</p>
            </div>
          </div>
          {link && (
            <div className="flex items-start gap-2 pt-1 border-t border-border/50">
              <div className="size-5 rounded bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">L</span>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Reference</p>
                <a 
                  href={link} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  {linkLabel || "View source"}
                  <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
                  </svg>
                </a>
              </div>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function InputsSummaryScreen() {
  const [selectedSession, setSelectedSession] = useState<number | null>(null)

const totalEnergy = SESSIONS.reduce((sum, s) => sum + s.kwh, 0)
const totalDuration = SESSIONS.reduce((sum, s) => sum + s.dur, 0)

// Calculate idle time (gaps between sessions)
const calculateIdleTime = () => {
  let idleMinutes = 0
  for (let i = 0; i < SESSIONS.length - 1; i++) {
    const currentEnd = timeToMinutes(SESSIONS[i].time) + SESSIONS[i].dur
    const nextStart = timeToMinutes(SESSIONS[i + 1].time)
    idleMinutes += Math.max(0, nextStart - currentEnd)
  }
  // Add idle time before first session (from 07:00)
  const firstStart = timeToMinutes(SESSIONS[0].time)
  idleMinutes += firstStart - 7 * 60
  // Add idle time after last session (until 20:00)
  const lastEnd = timeToMinutes(SESSIONS[SESSIONS.length - 1].time) + SESSIONS[SESSIONS.length - 1].dur
  idleMinutes += 20 * 60 - lastEnd
  return idleMinutes
}
const totalIdleTime = calculateIdleTime()

  return (
    <TooltipProvider>
      <>
        <PageHeader title="Input Summary" description="Overview of all simulation configuration parameters" />

        <div className="p-4 md:p-6 space-y-6 w-full">
          {/* Site & Hardware + Battery */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Site & Hardware Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <MapPin className="size-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  Site & Hardware
                  <span className="text-xs font-normal text-muted-foreground ml-auto">{SITE.location}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {/* Charger Hero */}
                <div className="flex items-center gap-4 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg mb-4">
                  <div className="p-3 bg-blue-100 dark:bg-blue-900/50 rounded-xl">
                    <Zap className="size-8 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Charger Model</div>
                    <div className="font-semibold text-lg">{SITE.chargerModel}</div>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-sm"><span className="font-bold text-blue-600">{SITE.chargerMaxOutput}</span> kW max</span>
                      <span className="text-sm"><span className="font-bold">{SITE.connectors}</span> connector</span>
                    </div>
                  </div>
                  <InfoTip source="ADS-TEC datasheet" assumption="Battery-buffered DC fast charger with 143kWh integrated LFP battery" link="https://www.ads-tec-energy.com/en/chargepost" linkLabel="ADS-TEC ChargePost" description="ADS-TEC Energy is a German manufacturer specializing in battery storage and EV charging solutions. Their ChargePost series combines DC fast charging with integrated battery storage, enabling high-power charging at sites with limited grid capacity." />
                </div>
                
                {/* Grid Stat */}
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                      <svg className="size-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/>
                        <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Grid Connection Limit</div>
                      <div className="font-semibold">{SITE.gridConnectionLimit} kW</div>
                    </div>
                  </div>
                  <InfoTip source="German grid connection standards" assumption="80kW typical for commercial EV charging sites, avoids costly grid upgrades" link="https://www.bdew.de/energie/elektromobilitaet/" linkLabel="BDEW E-Mobility" description="BDEW (Bundesverband der Energie- und Wasserwirtschaft) is Germany's leading energy industry association representing over 1,900 companies. They publish technical guidelines and standards for EV charging infrastructure and grid connections." />
                </div>
              </CardContent>
            </Card>

            {/* Battery Storage Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                    <Battery className="size-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  Battery Storage
                  <span className="text-xs font-normal text-muted-foreground ml-auto">Integrated LFP System</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {/* Capacity Stats */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                    <div className="text-xs text-muted-foreground flex items-center">Total Capacity <InfoTip source="ADS-TEC CP320 specifications" assumption="143kWh LFP battery integrated in ChargePost" link="https://www.ads-tec-energy.com/en/chargepost" linkLabel="Product specs" description="The ChargePost CP320 features an integrated 143kWh lithium iron phosphate (LFP) battery that buffers power between the grid and charger, enabling 320kW charging output from an 80kW grid connection." /></div>
                    <div className="font-bold text-2xl text-emerald-700 dark:text-emerald-400">{SITE.batteryCapacity}<span className="text-sm font-normal ml-1">kWh</span></div>
                  </div>
                  <div className="p-3 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800">
                    <div className="text-xs text-muted-foreground flex items-center">Usable <InfoTip source="Industry best practice" assumption="70% Depth of Discharge extends LFP cycle life significantly" link="https://batteryuniversity.com/article/bu-808-how-to-prolong-lithium-based-batteries" linkLabel="Battery University" description="Battery University is an educational resource by Cadex Electronics, providing in-depth technical information on battery technologies. Their articles on lithium battery longevity are widely referenced in energy storage industry." /></div>
                    <div className="font-bold text-2xl text-teal-700 dark:text-teal-400">{SITE.batteryUsable}<span className="text-sm font-normal ml-1">kWh</span></div>
                  </div>
                </div>

                {/* SOC Range Visual */}
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground flex items-center">SOC Operating Range <InfoTip source="LFP battery management guidelines" assumption="20-90% SOC range maximizes cycle life while maintaining usable capacity" link="https://batteryuniversity.com/article/bu-409-charging-lithium-ion" linkLabel="Charging best practices" description="Research shows that limiting depth of discharge and avoiding extreme SOC levels (below 20% or above 90%) can double or triple lithium battery cycle life compared to full 0-100% cycling." /></span>
                    <span className="text-xs font-medium">{SITE.batterySocCeiling - SITE.batterySocFloor}% usable</span>
                  </div>
                  <div className="relative h-6 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="absolute h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full flex items-center justify-end pr-2"
                      style={{ left: `${SITE.batterySocFloor}%`, width: `${SITE.batterySocCeiling - SITE.batterySocFloor}%` }}
                    >
                      <span className="text-[11px] font-bold text-white drop-shadow-md">{SITE.batterySocCeiling}%</span>
                    </div>
                    <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-600 dark:text-slate-400">
                      {SITE.batterySocFloor}%
                    </div>
                  </div>
                </div>

                {/* Operational Metrics */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2 p-2 border rounded-lg">
                    <div className="p-1.5 bg-orange-100 dark:bg-orange-900/30 rounded">
                      <svg className="size-4 text-orange-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Cycles/Day</div>
                      <div className="font-bold text-orange-600">{SITE.cyclesPerDay}</div>
                    </div>
                    <InfoTip source="Operational constraint" assumption="3 cycles/day balances use vs life" description="Daily cycling limits protect battery longevity. At 3 cycles/day with 70% DoD, a 6000-cycle LFP battery would last ~5.5 years. Higher cycling increases revenue but accelerates degradation." />
                  </div>
                  <div className="flex items-center gap-2 p-2 border rounded-lg">
                    <div className="p-1.5 bg-purple-100 dark:bg-purple-900/30 rounded">
                      <Euro className="size-4 text-purple-600" />
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Wear Cost</div>
                      <div className="font-bold text-purple-600">{(SITE.wearCostPerKwh * 100).toFixed(2)} ct/kWh</div>
                    </div>
                    <InfoTip source="Calculated" assumption="Replacement / (cycles x capacity)" description="Wear cost represents the marginal cost of each kWh discharged. It accounts for battery degradation in economic decisions, ensuring arbitrage opportunities exceed the cost of the cycling required." />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Financial Parameters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Euro className="size-4 text-primary" />
                Financial Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <div>
                  <span className="text-muted-foreground flex items-center text-xs">Grid Fees<InfoTip source="German electricity tariff structure" assumption="Includes Netzentgelt, EEG-Umlage, Stromsteuer, Konzessionsabgabe" link="https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Monitoringberichte/start.html" linkLabel="BNetzA Report" description="Bundesnetzagentur (BNetzA) is Germany's federal network agency regulating electricity, gas, and telecommunications. Their annual monitoring reports detail all electricity price components and grid tariffs." /></span>
                  <span className="font-medium text-lg">{(GRID.feesAndTaxes * 100).toFixed(1)} ct/kWh</span>
                </div>
                <div>
                  <span className="text-muted-foreground flex items-center text-xs">Retail Price<InfoTip source="German DC charging market" assumption="59ct/kWh typical public DC fast charging rate in 2024" link="https://www.adac.de/rund-ums-fahrzeug/elektromobilitaet/laden/ladestationen-preise/" linkLabel="ADAC Charging Prices" description="ADAC (Allgemeiner Deutscher Automobil-Club) is Europe's largest automobile club with 21 million members. They regularly survey and publish EV charging prices across German networks." /></span>
                  <span className="font-medium text-lg">{(GRID.retailPrice * 100).toFixed(0)} ct/kWh</span>
                </div>
                <div>
                  <span className="text-muted-foreground flex items-center text-xs">Demand Charge<InfoTip source="German grid tariff (Leistungspreis)" assumption="Based on highest 15-min average power draw, charged annually per kW" link="https://www.bundesnetzagentur.de/DE/Beschlusskammern/BK08/BK8_71_NNE_Strom_neu/BK8_71_NNE_Strom_node.html" linkLabel="BNetzA Tariffs" description="Demand charges (Leistungspreis) are a key cost component for commercial electricity users in Germany. They incentivize load management and are why battery-buffered chargers are economically attractive." /></span>
                  <span className="font-medium text-lg">{GRID.demandChargeAnnual} EUR/kW/yr</span>
                </div>
              </div>

              <Separator className="my-4" />

              <div className="flex items-center gap-2 mb-2">
                <Zap className="size-4 text-primary" />
                <span className="font-medium text-xs">EPEX Spot Prices (15-min)</span>
                <InfoTip source="EPEX SPOT Day-Ahead Market" assumption="German bidding zone, typical summer Saturday with solar surplus midday and evening peak" link="https://www.epexspot.com/en/market-data" linkLabel="EPEX Market Data" description="EPEX SPOT operates the power exchange for Germany, France, UK, and other European markets. Day-ahead auction prices are published at 12:00 CET daily and determine wholesale electricity costs for the next day." />
              </div>
              <div className="w-full" style={{ height: 128, minHeight: 128 }}>
                <ResponsiveContainer width="99%" height={128}>
                  <AreaChart data={EPEX_15MIN} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                    <defs>
                      <linearGradient id="epexGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="time" 
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} 
                      tickLine={false} 
                      axisLine={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
                      interval={15}
                      tickMargin={8}
                    />
                    <YAxis 
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} 
                      tickLine={false} 
                      axisLine={false} 
                      width={35} 
                      tickFormatter={(v) => `${v}`}
                      unit=" ct"
                    />
                    <RechartsTooltip 
                      contentStyle={{ 
                        fontSize: 12, 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                      }} 
                      formatter={(value: number) => [`${value.toFixed(1)} ct/kWh`, "Price"]} 
                    />
                    <Area type="basis" dataKey="price" stroke="hsl(var(--primary))" fill="url(#epexGradient)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Solar Production */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sun className="size-4 text-yellow-500" />
                Solar Production (PV)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4 text-sm">
                <div>
                  <span className="text-muted-foreground flex items-center text-xs">Installed<InfoTip source="Commercial rooftop PV" assumption="150kWp typical for medium commercial site with ~1000m² roof" link="https://www.solarwirtschaft.de" linkLabel="BSW Solar" description="BSW Solar (Bundesverband Solarwirtschaft) is Germany's solar industry association representing 800+ solar companies. They publish market statistics showing commercial PV installations typically range 30-300 kWp." /></span>
                  <span className="font-medium text-lg">{PV.installedKwp} kWp</span>
                </div>
                <div>
                  <span className="text-muted-foreground flex items-center text-xs">Charger Share<InfoTip source="Sub-metering allocation" assumption="40% of PV output dedicated to EV charging, rest serves building load" description="In shared commercial installations, PV output is allocated between building loads and EV charging. The 40% share reflects a typical highway rest stop or retail location where the main building also has significant electricity demand." /></span>
                  <span className="font-medium text-lg">{PV.chargerShare}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground flex items-center text-xs">System Loss<InfoTip source="PVGIS simulation tool" assumption="14% total: inverter 4%, cables 2%, soiling 3%, mismatch 2%, other 3%" link="https://re.jrc.ec.europa.eu/pvg_tools/en/" linkLabel="PVGIS Tool" description="PVGIS (Photovoltaic Geographical Information System) is a free EU tool for estimating solar electricity production. It uses satellite data and validated models to calculate PV output for any European location." /></span>
                  <span className="font-medium text-lg">{PV.systemLoss}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground flex items-center text-xs">Effective<InfoTip source="Calculated" assumption="Peak output available to charger = Installed kWp x Charger Share x (1 - System Loss)" description="The effective PV capacity represents the maximum power that can actually reach the EV charger under ideal conditions, accounting for allocation splits and system losses." /></span>
                  <span className="font-medium text-lg">{(PV.installedKwp * PV.chargerShare / 100 * (1 - PV.systemLoss / 100)).toFixed(0)} kW</span>
                </div>
                <div>
                  <span className="text-muted-foreground flex items-center text-xs">Orientation<InfoTip source="PVGIS optimal angle" assumption="South-facing at 30° tilt is optimal for Stuttgart latitude (48.8°N)" link="https://re.jrc.ec.europa.eu/pvg_tools/en/" linkLabel="PVGIS Calculator" description="PVGIS calculates optimal panel orientation based on location. For central Germany (48-52°N), south-facing panels at 30-35° tilt maximize annual energy yield." /></span>
                  <span className="font-medium text-lg">{PV.azimuth}, {PV.tilt}</span>
                </div>
              </div>
              <div className="w-full" style={{ height: 128, minHeight: 128 }}>
                <ResponsiveContainer width="99%" height={128}>
                  <AreaChart data={PV_15MIN} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                    <defs>
                      <linearGradient id="pvGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.5} />
                        <stop offset="50%" stopColor="#facc15" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#fef08a" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="time" 
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} 
                      tickLine={false} 
                      axisLine={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
                      interval={15}
                      tickMargin={8}
                    />
                    <YAxis 
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} 
                      tickLine={false} 
                      axisLine={false} 
                      width={35} 
                      tickFormatter={(v) => `${v}`}
                      unit=" kW"
                    />
                    <RechartsTooltip 
                      contentStyle={{ 
                        fontSize: 12, 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                      }} 
                      formatter={(value: number) => [`${value.toFixed(1)} kW`, "PV Output"]} 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="kw" 
                      stroke="#f59e0b" 
                      fill="url(#pvGradient)" 
                      strokeWidth={2} 
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Charging Sessions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Car className="size-4 text-primary" />
                Charging Sessions ({SESSIONS.length} vehicles)
                <InfoTip 
                  source="Synthetic schedule based on industry data" 
                  assumption="Simulates typical highway rest stop / retail charging pattern with 25 EVs over 13 operating hours" 
                  link="https://www.bdew.de/energie/elektromobilitaet/"
                  linkLabel="BDEW E-Mobility"
                  description="The session schedule is synthetically generated to match real-world charging patterns observed at German highway rest stops and retail locations, with peak demand during lunch hours and late afternoon."
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Summary stats */}
              <div className="flex flex-wrap gap-6 mb-4 text-sm">
                <div>
                  <span className="text-muted-foreground flex items-center gap-1">Total Energy<InfoTip source="Octopus Electroverse Report" assumption="Avg DC session ~27 kWh in Europe (Dec 2025)" link="https://octopus.energy/electroverse/" linkLabel="Electroverse Data" description="Octopus Electroverse operates a pan-European EV charging roaming network with 800,000+ charge points. Their data insights show average DC charging sessions deliver 25-30 kWh across European markets." /></span>
                  <span className="font-bold text-primary ml-2">{totalEnergy} kWh</span>
                </div>
                <div>
                  <span className="text-muted-foreground flex items-center gap-1">Total Duration<InfoTip source="Industry average" assumption="Avg DC fast charge session ~27 min, varies by battery size and SoC" link="https://www.iea.org/reports/global-ev-outlook-2024" linkLabel="IEA Global EV Outlook" description="The International Energy Agency's Global EV Outlook is the authoritative annual report on electric vehicle markets, charging infrastructure, and energy implications, used by policymakers worldwide." /></span>
                  <span className="font-bold ml-2">{Math.floor(totalDuration / 60)}h {totalDuration % 60}m</span>
                </div>
                <div>
                  <span className="text-muted-foreground flex items-center gap-1">Operating Hours<InfoTip source="Site configuration" assumption="Typical commercial operating hours for highway/retail locations" description="Operating hours define when the charging station accepts new sessions. Outside these hours, the battery can be pre-charged or participate in grid services." /></span>
                  <span className="font-medium ml-2">07:00 - 20:00</span>
                </div>
                <div>
                  <span className="text-muted-foreground flex items-center gap-1">Total Idle Time<InfoTip source="Calculated" assumption="Time between sessions where charger is available but unused" description="Idle time represents opportunities for battery precharging or grid services. SmartEMS uses these gaps to charge during cheap price periods in preparation for upcoming demand." /></span>
                  <span className="font-bold text-orange-500 ml-2">{Math.floor(totalIdleTime / 60)}h {totalIdleTime % 60}m</span>
                </div>
              </div>

              {/* Single Connector Timeline */}
              <div className="space-y-4">
                {/* Time axis header */}
                <div className="relative h-6 border-b">
                  {[7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((hour) => {
                    const left = ((hour - 7) / 13) * 100
                    return (
                      <div key={hour} className="absolute text-[10px] text-muted-foreground font-medium" style={{ left: `${left}%`, transform: "translateX(-50%)" }}>
                        {hour}:00
                      </div>
                    )
                  })}
                </div>

                {/* Timeline bar with all sessions */}
                <div className="relative h-14 bg-muted/30 rounded-lg border">
                  {/* Hour grid lines */}
                  {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((hour) => (
                    <div key={hour} className="absolute top-0 bottom-0 w-px bg-border/30" style={{ left: `${((hour - 7) / 13) * 100}%` }} />
                  ))}

                  {/* Session bars */}
                  {SESSIONS.map((session, index) => {
                    const startMins = timeToMinutes(session.time)
                    const endMins = startMins + session.dur
                    const dayStart = 7 * 60
                    const dayEnd = 20 * 60
                    const daySpan = dayEnd - dayStart
                    const leftPercent = ((startMins - dayStart) / daySpan) * 100
                    const widthPercent = (session.dur / daySpan) * 100
                    const color = getCarColor(session.vehicle)
                    const endTime = `${Math.floor(endMins / 60).toString().padStart(2, "0")}:${(endMins % 60).toString().padStart(2, "0")}`
                    const isSelected = selectedSession === session.id

                    return (
                      <Tooltip key={session.id} delayDuration={100}>
                        <TooltipTrigger asChild>
                          <div
                            className={`absolute top-1.5 bottom-1.5 rounded cursor-pointer transition-all ${isSelected ? "ring-2 ring-foreground ring-offset-1 z-20 brightness-110" : "hover:brightness-110 hover:z-10"}`}
                            style={{
                              left: `${leftPercent}%`,
                              width: `${Math.max(widthPercent, 1.5)}%`,
                              backgroundColor: color,
                            }}
                            onMouseEnter={() => setSelectedSession(session.id)}
                            onMouseLeave={() => setSelectedSession(null)}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="p-0 overflow-hidden bg-card border-2 shadow-xl rounded-xl min-w-[220px]" style={{ borderColor: color }}>
                          {/* Header */}
                          <div className="px-3 py-2 text-white font-semibold text-sm" style={{ backgroundColor: color }}>
                            {session.vehicle}
                          </div>
                          {/* Content */}
                          <div className="p-3 space-y-3">
                            {/* Time row */}
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-1.5">
                                <div className="size-2 rounded-full bg-green-500" />
                                <span className="text-muted-foreground">Arrival</span>
                                <span className="font-semibold">{session.time}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="size-2 rounded-full bg-red-500" />
                                <span className="text-muted-foreground">Departure</span>
                                <span className="font-semibold">{endTime}</span>
                              </div>
                            </div>
                            
                            <Separator />
                            
                            {/* Stats grid */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                <Clock className="size-4 text-blue-600" />
                                <div>
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">Duration</div>
                                  <div className="font-bold text-sm text-slate-900 dark:text-slate-100">{session.dur} min</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 p-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                                <Zap className="size-4 text-yellow-600" />
                                <div>
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">Energy</div>
                                  <div className="font-bold text-sm text-yellow-700 dark:text-yellow-400">{session.kwh} kWh</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 p-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                                <Gauge className="size-4 text-orange-600" />
                                <div>
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">Max Power</div>
                                  <div className="font-bold text-sm text-orange-700 dark:text-orange-400">{session.maxKw} kW</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                                <Battery className="size-4 text-green-600" />
                                <div>
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">SOC</div>
                                  <div className="font-bold text-sm text-green-700 dark:text-green-400">{session.arr}% → {session.tgt}%</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>

                {/* Session cards grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2 text-[10px]">
                  {SESSIONS.map((session) => {
                    const startMins = timeToMinutes(session.time)
                    const endMins = startMins + session.dur
                    const endTime = `${Math.floor(endMins / 60).toString().padStart(2, "0")}:${(endMins % 60).toString().padStart(2, "0")}`
                    const color = getCarColor(session.vehicle)
                    const isVan = session.vehicle.includes("Van") || session.vehicle.includes("Sprinter") || session.vehicle.includes("Vito")
                    const isSelected = selectedSession === session.id

                    return (
                      <div
                        key={session.id}
                        className={`flex items-center gap-2 p-1.5 rounded border bg-card transition-all ${isSelected ? "ring-2 ring-primary shadow-lg scale-105 z-10" : "hover:shadow-md"}`}
                        style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                        onMouseEnter={() => setSelectedSession(session.id)}
                        onMouseLeave={() => setSelectedSession(null)}
                      >
                        <svg viewBox="0 0 24 24" className={`${isVan ? "w-4 h-3" : "w-3.5 h-2.5"} shrink-0`} style={{ fill: color }}>
                          {isVan ? (
                            <path d="M3 13h1V9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4h1a2 2 0 0 1 2 2v2h-1.5a2.5 2.5 0 0 1-5 0h-5a2.5 2.5 0 0 1-5 0H3v-2a2 2 0 0 1 2-2zm3-4v4h10V9a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" />
                          ) : (
                            <path d="M5 11l1.5-4.5h11L19 11M4 11h16v5h-2v1h-2v-1H8v1H6v-1H4v-5z" />
                          )}
                        </svg>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate" style={{ color }}>{session.vehicle}</div>
                          <div className="text-muted-foreground">
                            {session.time}→{endTime} | {session.kwh}kWh | <span className="text-yellow-600">{session.maxKw}kW</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center gap-4 pt-2 text-[10px] text-muted-foreground border-t">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-3 bg-primary rounded" />
                    <span>Session (hover for details)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Zap className="size-3 text-yellow-500" />
                    <span>Max power</span>
                  </div>
                  <div className="text-muted-foreground/60 ml-auto">Single connector - sessions are sequential</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    </TooltipProvider>
  )
}
