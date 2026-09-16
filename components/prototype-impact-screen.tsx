"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  TrendingUp,
  TrendingDown,
  Euro,
  Zap,
  Battery,
  Car,
  Sun,
  Leaf,
  Calculator,
  Calendar,
  ArrowRight,
  CheckCircle2,
  Target,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  Legend,
} from "recharts"

// Generate mock daily data for the month
function generateMockDailyData() {
  const data = []
  const now = new Date()
  for (let i = 30; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    
    const baselineCost = 150 + Math.random() * 100
    const optimizedCost = baselineCost * (0.6 + Math.random() * 0.2)
    const savings = baselineCost - optimizedCost
    
    data.push({
      date: date.toLocaleDateString("de-DE", { day: "2-digit", month: "short" }),
      fullDate: date.toISOString(),
      baselineCost: Math.round(baselineCost * 100) / 100,
      optimizedCost: Math.round(optimizedCost * 100) / 100,
      savings: Math.round(savings * 100) / 100,
      savingsPct: Math.round((savings / baselineCost) * 100),
      gridImport: Math.round(400 + Math.random() * 200),
      gridExport: Math.round(50 + Math.random() * 100),
      evEnergy: Math.round(300 + Math.random() * 200),
      batteryThroughput: Math.round(200 + Math.random() * 150),
      avgPrice: Math.round((70 + Math.random() * 40) * 10) / 10,
      co2Saved: Math.round((savings / 100) * 400), // kg CO2
    })
  }
  return data
}

// Generate hourly profile for selected day
function generateHourlyProfile() {
  const data = []
  for (let h = 0; h < 24; h++) {
    const price = h >= 6 && h <= 20 
      ? 80 + Math.sin((h - 13) * 0.5) * 40 + Math.random() * 20 
      : 40 + Math.random() * 20
    const baselineUsage = h >= 8 && h <= 18 ? 30 + Math.random() * 20 : 10 + Math.random() * 10
    const optimizedUsage = price > 80 
      ? baselineUsage * 0.3 
      : price < 50 
        ? baselineUsage * 1.5 
        : baselineUsage * 0.8
    
    data.push({
      hour: `${h.toString().padStart(2, "0")}:00`,
      price: Math.round(price * 10) / 10,
      baselineUsage: Math.round(baselineUsage * 10) / 10,
      optimizedUsage: Math.round(optimizedUsage * 10) / 10,
      soc: Math.round(50 + Math.sin((h / 24) * Math.PI * 2) * 30 + Math.random() * 10),
    })
  }
  return data
}

// Generate session-level data
function generateSessionData() {
  const sessions = []
  for (let i = 0; i < 15; i++) {
    const energyKwh = 30 + Math.random() * 50
    const avgPrice = 60 + Math.random() * 50
    const baselineCost = energyKwh * avgPrice / 1000
    const optimizedCost = baselineCost * (0.65 + Math.random() * 0.2)
    
    sessions.push({
      id: `session-${i.toString().padStart(3, "0")}`,
      startTime: new Date(Date.now() - i * 3600000 * 4).toISOString(),
      duration: Math.round(20 + Math.random() * 40),
      energyKwh: Math.round(energyKwh * 10) / 10,
      avgPrice: Math.round(avgPrice * 10) / 10,
      baselineCost: Math.round(baselineCost * 100) / 100,
      optimizedCost: Math.round(optimizedCost * 100) / 100,
      savings: Math.round((baselineCost - optimizedCost) * 100) / 100,
      batteryContribution: Math.round(30 + Math.random() * 40),
    })
  }
  return sessions
}

export function PrototypeImpactScreen() {
  const [dailyData] = useState(generateMockDailyData)
  const [hourlyData] = useState(generateHourlyProfile)
  const [sessionData] = useState(generateSessionData)
  const [timeRange, setTimeRange] = useState("30d")

  const summary = useMemo(() => {
    const totalBaseline = dailyData.reduce((sum, d) => sum + d.baselineCost, 0)
    const totalOptimized = dailyData.reduce((sum, d) => sum + d.optimizedCost, 0)
    const totalSavings = totalBaseline - totalOptimized
    const totalEv = dailyData.reduce((sum, d) => sum + d.evEnergy, 0)
    const totalCo2 = dailyData.reduce((sum, d) => sum + d.co2Saved, 0)
    return {
      totalBaseline: Math.round(totalBaseline),
      totalOptimized: Math.round(totalOptimized),
      totalSavings: Math.round(totalSavings),
      savingsPct: Math.round((totalSavings / totalBaseline) * 100),
      totalEv,
      totalCo2,
      avgDailySavings: Math.round(totalSavings / dailyData.length),
    }
  }, [dailyData])

  return (
    <div className="w-full py-8 px-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Calculator className="size-7 text-purple-500" />
            Impact & Savings Dashboard
          </h1>
          <p className="text-muted-foreground">
            Cost optimization results and value demonstration
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[150px]">
              <Calendar className="size-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="90d">Last 90 Days</SelectItem>
              <SelectItem value="ytd">Year to Date</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm">Export Report</Button>
        </div>
      </div>

      {/* Key Savings Banner */}
      <Card className="border-green-500/30 bg-gradient-to-r from-green-500/5 to-green-500/10">
        <CardContent className="py-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="size-5 text-green-500" />
                <span className="text-sm font-medium text-green-600">SmartEMS Optimization Active</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold text-green-500">{summary.totalSavings.toLocaleString("de-DE")}</span>
                <span className="text-2xl text-green-600">EUR</span>
              </div>
              <p className="text-muted-foreground mt-1">Total savings this period</p>
            </div>
            <div className="flex items-center gap-4">
              <Separator orientation="vertical" className="h-16 hidden md:block" />
              <div>
                <p className="text-xs text-muted-foreground">Baseline Cost</p>
                <p className="text-xl font-bold text-muted-foreground line-through">{summary.totalBaseline.toLocaleString("de-DE")} EUR</p>
              </div>
              <ArrowRight className="size-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Optimized Cost</p>
                <p className="text-xl font-bold text-primary">{summary.totalOptimized.toLocaleString("de-DE")} EUR</p>
              </div>
            </div>
            <div className="text-center md:text-right">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/20 text-green-600 font-bold text-lg">
                <TrendingDown className="size-5" />
                {summary.savingsPct}% saved
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Avg Daily Savings</p>
                <p className="text-2xl font-bold text-green-500">{summary.avgDailySavings} EUR</p>
              </div>
              <Euro className="size-8 text-green-500/30" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">EV Energy Delivered</p>
                <p className="text-2xl font-bold">{(summary.totalEv / 1000).toFixed(1)} MWh</p>
              </div>
              <Car className="size-8 text-cyan-500/30" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">CO2 Avoided</p>
                <p className="text-2xl font-bold text-green-600">{(summary.totalCo2 / 1000).toFixed(1)} t</p>
              </div>
              <Leaf className="size-8 text-green-600/30" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Charging Sessions</p>
                <p className="text-2xl font-bold">{sessionData.length}</p>
              </div>
              <Zap className="size-8 text-primary/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="costs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="costs">Cost Comparison</TabsTrigger>
          <TabsTrigger value="hourly">Hourly Profile</TabsTrigger>
          <TabsTrigger value="sessions">Session Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="costs" className="space-y-6">
          {/* Daily Savings Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Daily Cost Comparison</CardTitle>
              <CardDescription>Baseline (without optimization) vs Actual (with SmartEMS)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}€`} className="text-muted-foreground" />
                    <Tooltip 
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                      formatter={(value: number, name: string) => {
                        const label = name === "baselineCost" ? "Baseline" : name === "optimizedCost" ? "Optimized" : "Savings"
                        return [`${value.toFixed(2)} EUR`, label]
                      }}
                    />
                    <Legend />
                    <Bar dataKey="baselineCost" fill="hsl(var(--muted-foreground))" fillOpacity={0.3} name="Baseline Cost" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="optimizedCost" fill="hsl(var(--primary))" name="Optimized Cost" radius={[2, 2, 0, 0]} />
                    <Line type="monotone" dataKey="savings" stroke="#22c55e" strokeWidth={2} name="Savings" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Savings Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Savings Sources</CardTitle>
                <CardDescription>Where the optimization value comes from</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="size-3 rounded-full bg-blue-500" />
                      <span className="text-sm">Price Arbitrage</span>
                    </div>
                    <span className="font-bold">45%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: "45%" }} />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="size-3 rounded-full bg-green-500" />
                      <span className="text-sm">Battery Boost (avoid peak prices)</span>
                    </div>
                    <span className="font-bold">35%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full" style={{ width: "35%" }} />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="size-3 rounded-full bg-cyan-500" />
                      <span className="text-sm">Load Shifting</span>
                    </div>
                    <span className="font-bold">20%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="bg-cyan-500 h-2 rounded-full" style={{ width: "20%" }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Monthly Trend</CardTitle>
                <CardDescription>Savings rate over time</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyData.slice(-7)}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 50]} />
                      <Tooltip formatter={(value: number) => [`${value}%`, "Savings Rate"]} />
                      <Area type="monotone" dataKey="savingsPct" stroke="#22c55e" fill="#22c55e" fillOpacity={0.2} />
                      <ReferenceLine y={summary.savingsPct} stroke="#22c55e" strokeDasharray="5 5" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="hourly" className="space-y-6">
          {/* Hourly Price vs Usage */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Hourly Optimization Profile</CardTitle>
              <CardDescription>How SmartEMS shifts load based on electricity prices</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="usage" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}kW`} />
                    <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}€`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    />
                    <Legend />
                    <Bar yAxisId="usage" dataKey="baselineUsage" fill="hsl(var(--muted-foreground))" fillOpacity={0.3} name="Baseline Usage" />
                    <Bar yAxisId="usage" dataKey="optimizedUsage" fill="hsl(var(--primary))" name="Optimized Usage" />
                    <Line yAxisId="price" type="monotone" dataKey="price" stroke="#f59e0b" strokeWidth={2} name="EPEX Price" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
                <strong>Key Insight:</strong> SmartEMS reduces grid usage during high-price hours (10:00-18:00) by using battery storage, 
                and increases charging during low-price periods (00:00-06:00) to build up reserves.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions" className="space-y-6">
          {/* Session Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Charging Session Analysis</CardTitle>
              <CardDescription>Per-session cost comparison showing optimization impact</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-3 text-left font-medium">Session</th>
                      <th className="p-3 text-left font-medium">Start Time</th>
                      <th className="p-3 text-right font-medium">Energy</th>
                      <th className="p-3 text-right font-medium">Avg Price</th>
                      <th className="p-3 text-right font-medium">Baseline</th>
                      <th className="p-3 text-right font-medium">Actual</th>
                      <th className="p-3 text-right font-medium">Saved</th>
                      <th className="p-3 text-right font-medium">Battery %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionData.slice(0, 10).map((session) => (
                      <tr key={session.id} className="border-b hover:bg-muted/30">
                        <td className="p-3 font-mono text-xs">{session.id}</td>
                        <td className="p-3 text-xs">
                          {new Date(session.startTime).toLocaleString("de-DE", {
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="p-3 text-right font-mono">{session.energyKwh} kWh</td>
                        <td className="p-3 text-right font-mono">{session.avgPrice} EUR</td>
                        <td className="p-3 text-right font-mono text-muted-foreground">{session.baselineCost.toFixed(2)} EUR</td>
                        <td className="p-3 text-right font-mono text-primary">{session.optimizedCost.toFixed(2)} EUR</td>
                        <td className="p-3 text-right font-mono text-green-500">+{session.savings.toFixed(2)} EUR</td>
                        <td className="p-3 text-right">
                          <Badge variant="outline" className="text-xs">{session.batteryContribution}%</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between items-center mt-4">
                <p className="text-xs text-muted-foreground">Showing 10 of {sessionData.length} sessions</p>
                <Button variant="outline" size="sm">View All Sessions</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
