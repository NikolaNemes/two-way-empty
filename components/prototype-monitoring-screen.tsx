"use client"

import { useState, useEffect } from "react"
import { GRID_IMPORT_LIMIT_KW } from "@/lib/dispatch-kernel"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { 
  Activity,
  Battery,
  BatteryCharging,
  Car,
  Zap,
  Thermometer,
  Gauge,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Sun,
  Plug,
  Cable,
} from "lucide-react"
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"

// Simulated real-time data
function generateMockTelemetry() {
  const baseSOC = 65 + Math.random() * 10 - 5
  const basePower = -25000 + Math.random() * 10000
  return {
    timestamp: new Date().toISOString(),
    batteries: [
      {
        unit_id: 1,
        soc_pct: Math.round(baseSOC + Math.random() * 3),
        power_w: Math.round(basePower + Math.random() * 5000),
        temp_min_c: 28 + Math.random() * 2,
        temp_max_c: 32 + Math.random() * 3,
        max_charge_w: 110000,
        max_discharge_w: 110000,
        contactor_state: "closed",
      },
      {
        unit_id: 2,
        soc_pct: Math.round(baseSOC - 2 + Math.random() * 3),
        power_w: Math.round(basePower - 3000 + Math.random() * 5000),
        temp_min_c: 27 + Math.random() * 2,
        temp_max_c: 31 + Math.random() * 3,
        max_charge_w: 110000,
        max_discharge_w: 110000,
        contactor_state: "closed",
      },
    ],
    grid: {
      P_grid_w: Math.round(35000 + Math.random() * 20000 - 10000),
      E_grid_imp_kwh: 245.6 + Math.random() * 0.5,
      E_grid_exp_kwh: 12.3 + Math.random() * 0.1,
      P_aux_w: Math.round(3200 + Math.random() * 500),
      f_grid_hz: 50 + (Math.random() * 0.04 - 0.02),
      cos_phi: 0.97 + Math.random() * 0.02,
    },
    chargers: [
      {
        unit_id: 1,
        charging_state: "InProgress",
        charging_process_state: "Charging",
        plug_state: "Plugged",
        P_EV_w: Math.round(125000 + Math.random() * 25000),
        P_EV_max_w: 150000,
        P_cp_max_w: 150000,
        soc_EV_pct: 45 + Math.round(Math.random() * 5),
        E_EV_chg_kwh: 23.5 + Math.random() * 2,
        boost_contactor: "closed",
      },
    ],
    station: {
      operation_state: "Ready",
      P_grid_consumption_limit_w: GRID_IMPORT_LIMIT_KW * 1000,
      P_grid_generation_limit_w: GRID_IMPORT_LIMIT_KW * 1000,
      warnings: [],
      errors: [],
    },
    epex_price_eur_mwh: 85 + Math.random() * 30 - 15,
  }
}

// Generate historical chart data
function generateChartHistory() {
  const data = []
  const now = Date.now()
  for (let i = 60; i >= 0; i--) {
    const time = new Date(now - i * 60000)
    data.push({
      time: time.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
      gridPower: Math.round(30000 + Math.sin(i / 10) * 20000 + Math.random() * 5000),
      batterySoc: Math.round(60 + Math.sin(i / 15) * 15 + Math.random() * 3),
      evPower: i > 30 ? Math.round(100000 + Math.random() * 50000) : 0,
      price: Math.round((70 + Math.sin(i / 8) * 30 + Math.random() * 10) * 10) / 10,
    })
  }
  return data
}

export function PrototypeMonitoringScreen() {
  const [telemetry, setTelemetry] = useState(generateMockTelemetry)
  const [chartData, setChartData] = useState(generateChartHistory)
  const [selectedSite, setSelectedSite] = useState("site-001")
  const [lastUpdate, setLastUpdate] = useState(new Date())

  // Simulate real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetry(generateMockTelemetry())
      setChartData(prev => {
        const newData = [...prev.slice(1)]
        const now = new Date()
        newData.push({
          time: now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
          gridPower: Math.round(30000 + Math.random() * 20000),
          batterySoc: telemetry.batteries[0].soc_pct,
          evPower: telemetry.chargers[0]?.P_EV_w || 0,
          price: telemetry.epex_price_eur_mwh,
        })
        return newData
      })
      setLastUpdate(new Date())
    }, 5000)
    return () => clearInterval(interval)
  }, [telemetry])

  const totalBatteryPower = telemetry.batteries.reduce((sum, b) => sum + b.power_w, 0)
  const avgSoc = telemetry.batteries.reduce((sum, b) => sum + b.soc_pct, 0) / telemetry.batteries.length
  const isDischarging = totalBatteryPower < 0
  const isCharging = totalBatteryPower > 0
  const isExporting = telemetry.grid.P_grid_w < 0

  return (
    <div className="w-full py-8 px-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Activity className="size-7 text-green-500" />
            Real-Time Monitoring
          </h1>
          <p className="text-muted-foreground">
            Live operational status and telemetry dashboard
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedSite} onValueChange={setSelectedSite}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select site" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="site-001">Hamburg Altona</SelectItem>
              <SelectItem value="site-002">Berlin Mitte</SelectItem>
              <SelectItem value="site-003">Munich Central</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-2">
            <RefreshCw className="size-4" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Updated: {lastUpdate.toLocaleTimeString("de-DE")}
          </Badge>
        </div>
      </div>

      {/* Station Status Banner */}
      <Card className={`border-l-4 ${
        telemetry.station.errors.length > 0 ? "border-l-red-500 bg-red-500/5" :
        telemetry.station.warnings.length > 0 ? "border-l-yellow-500 bg-yellow-500/5" :
        "border-l-green-500 bg-green-500/5"
      }`}>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {telemetry.station.errors.length > 0 ? (
                <XCircle className="size-5 text-red-500" />
              ) : telemetry.station.warnings.length > 0 ? (
                <AlertTriangle className="size-5 text-yellow-500" />
              ) : (
                <CheckCircle2 className="size-5 text-green-500" />
              )}
              <div>
                <p className="font-medium">Station Status: {telemetry.station.operation_state}</p>
                <p className="text-xs text-muted-foreground">
                  Grid Limit: {(telemetry.station.P_grid_consumption_limit_w / 1000).toFixed(0)} kW import / {(telemetry.station.P_grid_generation_limit_w / 1000).toFixed(0)} kW export
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="text-right">
                <p className="text-muted-foreground text-xs">EPEX Price</p>
                <p className={`font-mono font-bold ${telemetry.epex_price_eur_mwh > 100 ? "text-red-500" : telemetry.epex_price_eur_mwh < 50 ? "text-green-500" : "text-yellow-500"}`}>
                  {telemetry.epex_price_eur_mwh.toFixed(1)} EUR/MWh
                </p>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div className="text-right">
                <p className="text-muted-foreground text-xs">Grid Frequency</p>
                <p className="font-mono">{telemetry.grid.f_grid_hz.toFixed(2)} Hz</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Battery SOC */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Battery className="size-4 text-primary" />
              Battery SOC
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{avgSoc.toFixed(0)}%</div>
            <Progress value={avgSoc} className="mt-2 h-2" />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Unit 1: {telemetry.batteries[0].soc_pct}%</span>
              <span>Unit 2: {telemetry.batteries[1].soc_pct}%</span>
            </div>
          </CardContent>
        </Card>

        {/* Battery Power */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              {isDischarging ? (
                <ArrowUpFromLine className="size-4 text-orange-500" />
              ) : isCharging ? (
                <ArrowDownToLine className="size-4 text-green-500" />
              ) : (
                <BatteryCharging className="size-4 text-muted-foreground" />
              )}
              Battery Power
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${isDischarging ? "text-orange-500" : isCharging ? "text-green-500" : ""}`}>
              {(Math.abs(totalBatteryPower) / 1000).toFixed(0)} kW
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {isDischarging ? "Discharging to EV/Grid" : isCharging ? "Charging from Grid" : "Idle"}
            </p>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Max Chg: {(telemetry.batteries[0].max_charge_w / 1000).toFixed(0)} kW</span>
              <span>Max Dis: {(telemetry.batteries[0].max_discharge_w / 1000).toFixed(0)} kW</span>
            </div>
          </CardContent>
        </Card>

        {/* Grid Power */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className={`size-4 ${isExporting ? "text-green-500" : "text-blue-500"}`} />
              Grid Power
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${isExporting ? "text-green-500" : "text-blue-500"}`}>
              {(Math.abs(telemetry.grid.P_grid_w) / 1000).toFixed(0)} kW
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {isExporting ? "Exporting to Grid" : "Importing from Grid"}
            </p>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Imp: {telemetry.grid.E_grid_imp_kwh.toFixed(1)} kWh</span>
              <span>Exp: {telemetry.grid.E_grid_exp_kwh.toFixed(1)} kWh</span>
            </div>
          </CardContent>
        </Card>

        {/* EV Charging */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Car className="size-4 text-cyan-500" />
              EV Charging
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-cyan-500">
              {(telemetry.chargers[0].P_EV_w / 1000).toFixed(0)} kW
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {telemetry.chargers[0].charging_state === "InProgress" ? "Active Session" : "No Session"}
            </p>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>EV SOC: {telemetry.chargers[0].soc_EV_pct}%</span>
              <span>Delivered: {telemetry.chargers[0].E_EV_chg_kwh.toFixed(1)} kWh</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Power Flow Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Power Flow (Last Hour)</CardTitle>
            <CardDescription>Grid import/export and EV charging power</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}kW`} className="text-muted-foreground" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    formatter={(value: number) => [`${(value/1000).toFixed(1)} kW`, ""]}
                  />
                  <Area type="monotone" dataKey="gridPower" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} name="Grid" />
                  <Area type="monotone" dataKey="evPower" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.2} name="EV" />
                  <ReferenceLine y={GRID_IMPORT_LIMIT_KW * 1000} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: "Grid Limit", fontSize: 10 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* SOC & Price Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Battery SOC & EPEX Price</CardTitle>
            <CardDescription>SOC trajectory vs electricity price</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis yAxisId="soc" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} className="text-muted-foreground" />
                  <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}EUR`} className="text-muted-foreground" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  />
                  <Area yAxisId="soc" type="monotone" dataKey="batterySoc" stroke="#22c55e" fill="#22c55e" fillOpacity={0.2} name="SOC %" />
                  <Area yAxisId="price" type="monotone" dataKey="price" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} name="EUR/MWh" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Unit Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {telemetry.batteries.map((battery) => (
          <Card key={battery.unit_id}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Battery className="size-4" />
                  Power Unit {battery.unit_id}
                </span>
                <Badge variant={battery.contactor_state === "closed" ? "default" : "secondary"}>
                  Contactor {battery.contactor_state}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">SOC</p>
                  <p className="text-lg font-bold">{battery.soc_pct}%</p>
                  <Progress value={battery.soc_pct} className="mt-1 h-1" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Power</p>
                  <p className={`text-lg font-bold ${battery.power_w < 0 ? "text-orange-500" : "text-green-500"}`}>
                    {(battery.power_w / 1000).toFixed(1)} kW
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Thermometer className="size-3" /> Temp
                  </p>
                  <p className="text-lg font-bold">
                    {battery.temp_min_c.toFixed(0)}-{battery.temp_max_c.toFixed(0)}°C
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* EV Charger Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Car className="size-4 text-cyan-500" />
            EV Charging Session
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">State</p>
              <Badge className="mt-1" variant={telemetry.chargers[0].charging_state === "InProgress" ? "default" : "secondary"}>
                {telemetry.chargers[0].charging_process_state}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Plug</p>
              <div className="flex items-center gap-1 mt-1">
                <Plug className={`size-4 ${telemetry.chargers[0].plug_state === "Plugged" ? "text-green-500" : "text-muted-foreground"}`} />
                <span className="text-sm font-medium">{telemetry.chargers[0].plug_state}</span>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Current Power</p>
              <p className="text-lg font-bold">{(telemetry.chargers[0].P_EV_w / 1000).toFixed(0)} kW</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Max EV Accepts</p>
              <p className="text-lg font-bold">{(telemetry.chargers[0].P_EV_max_w / 1000).toFixed(0)} kW</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">EV SOC</p>
              <p className="text-lg font-bold">{telemetry.chargers[0].soc_EV_pct}%</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Energy Delivered</p>
              <p className="text-lg font-bold">{telemetry.chargers[0].E_EV_chg_kwh.toFixed(1)} kWh</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
