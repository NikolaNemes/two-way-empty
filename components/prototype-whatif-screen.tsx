"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Calculator,
  GitCompareArrows,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Battery,
  Zap,
  Euro,
  RefreshCw,
  Settings2,
  Play,
  PauseCircle,
  HelpCircle,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
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

// Scenario parameters
interface ScenarioParams {
  priceVolatility: number // 0-100, affects price swings
  avgPrice: number // EUR/MWh
  evDemand: number // kWh/day
  batteryCapacity: number // kWh
  optimizationEnabled: boolean
}

// Generate price curve based on volatility
function generatePriceCurve(params: ScenarioParams) {
  const data = []
  for (let h = 0; h < 24; h++) {
    const basePrice = params.avgPrice
    const volatilityFactor = params.priceVolatility / 100
    
    // Peak hours 8-20, off-peak 0-6
    const hourFactor = h >= 8 && h <= 20 
      ? 1 + Math.sin((h - 14) * 0.5) * 0.4 * volatilityFactor
      : 0.6 - volatilityFactor * 0.2
    
    const price = basePrice * hourFactor + (Math.random() - 0.5) * 20 * volatilityFactor
    
    data.push({
      hour: `${h.toString().padStart(2, "0")}:00`,
      price: Math.max(0, Math.round(price * 10) / 10),
    })
  }
  return data
}

// Calculate scenario results
function calculateScenarioResults(params: ScenarioParams, priceCurve: { hour: string; price: number }[]) {
  const avgPrice = priceCurve.reduce((sum, p) => sum + p.price, 0) / 24
  const maxPrice = Math.max(...priceCurve.map(p => p.price))
  const minPrice = Math.min(...priceCurve.map(p => p.price))
  const priceSpread = maxPrice - minPrice
  
  // Baseline: charge during any hour, weighted by demand
  const baselineCost = params.evDemand * avgPrice / 1000
  
  // Optimized: charge during cheap hours, use battery during expensive
  const cheapHours = priceCurve.filter(p => p.price < avgPrice * 0.8)
  const cheapAvg = cheapHours.length > 0 
    ? cheapHours.reduce((sum, p) => sum + p.price, 0) / cheapHours.length 
    : avgPrice
  
  // Battery arbitrage value
  const arbitrageValue = params.optimizationEnabled 
    ? (priceSpread * params.batteryCapacity * 0.8) / 1000 * 0.5 // 50% efficiency
    : 0
  
  // Load shifting value
  const loadShiftValue = params.optimizationEnabled
    ? (avgPrice - cheapAvg) * params.evDemand / 1000 * 0.6 // 60% of demand can be shifted
    : 0
  
  const optimizedCost = baselineCost - arbitrageValue - loadShiftValue
  const savings = baselineCost - optimizedCost
  const savingsPct = (savings / baselineCost) * 100
  
  return {
    baselineCost: Math.round(baselineCost * 100) / 100,
    optimizedCost: Math.round(Math.max(0, optimizedCost) * 100) / 100,
    savings: Math.round(Math.max(0, savings) * 100) / 100,
    savingsPct: Math.round(Math.max(0, savingsPct)),
    arbitrageValue: Math.round(arbitrageValue * 100) / 100,
    loadShiftValue: Math.round(loadShiftValue * 100) / 100,
    avgPrice: Math.round(avgPrice * 10) / 10,
    priceSpread: Math.round(priceSpread * 10) / 10,
  }
}

// Generate SOC comparison
function generateSocComparison(params: ScenarioParams, priceCurve: { hour: string; price: number }[]) {
  const data = []
  let baselineSoc = 50
  let optimizedSoc = 50
  const avgPrice = priceCurve.reduce((sum, p) => sum + p.price, 0) / 24
  
  for (let h = 0; h < 24; h++) {
    const price = priceCurve[h].price
    const evDemandHour = params.evDemand / 24 * (h >= 8 && h <= 20 ? 1.5 : 0.5)
    
    // Baseline: constant charge/discharge
    baselineSoc = Math.max(20, Math.min(90, baselineSoc - evDemandHour / params.batteryCapacity * 100 + 2))
    
    // Optimized: charge during cheap, discharge during expensive
    if (params.optimizationEnabled) {
      if (price < avgPrice * 0.7) {
        // Cheap hour - charge
        optimizedSoc = Math.min(95, optimizedSoc + 5)
      } else if (price > avgPrice * 1.2) {
        // Expensive hour - discharge for EV
        optimizedSoc = Math.max(20, optimizedSoc - evDemandHour / params.batteryCapacity * 100 - 3)
      } else {
        optimizedSoc = Math.max(30, Math.min(85, optimizedSoc - evDemandHour / params.batteryCapacity * 100 + 1))
      }
    } else {
      optimizedSoc = baselineSoc
    }
    
    data.push({
      hour: `${h.toString().padStart(2, "0")}:00`,
      price: price,
      baselineSoc: Math.round(baselineSoc),
      optimizedSoc: Math.round(optimizedSoc),
      targetSoc: params.optimizationEnabled ? (price < avgPrice ? 85 : 40) : 50,
    })
  }
  return data
}

export function PrototypeWhatIfScreen() {
  const [params, setParams] = useState<ScenarioParams>({
    priceVolatility: 60,
    avgPrice: 85,
    evDemand: 400,
    batteryCapacity: 232,
    optimizationEnabled: true,
  })

  const [comparisonParams, setComparisonParams] = useState<ScenarioParams>({
    priceVolatility: 60,
    avgPrice: 85,
    evDemand: 400,
    batteryCapacity: 232,
    optimizationEnabled: false,
  })

  const priceCurve = useMemo(() => generatePriceCurve(params), [params])
  const results = useMemo(() => calculateScenarioResults(params, priceCurve), [params, priceCurve])
  const comparisonResults = useMemo(() => calculateScenarioResults(comparisonParams, priceCurve), [comparisonParams, priceCurve])
  const socData = useMemo(() => generateSocComparison(params, priceCurve), [params, priceCurve])

  const updateParam = <K extends keyof ScenarioParams>(key: K, value: ScenarioParams[K]) => {
    setParams(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="w-full py-8 px-6 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <Sparkles className="size-7 text-blue-500" />
          What-If Scenario Analysis
        </h1>
        <p className="text-muted-foreground">
          Explore optimization value under different market conditions and configurations
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Scenario Parameters */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Settings2 className="size-4" />
              Scenario Parameters
            </CardTitle>
            <CardDescription>Adjust inputs to see impact on savings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Optimization Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-primary/5">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <Label htmlFor="optimization" className="font-medium">SmartEMS Optimization</Label>
              </div>
              <Switch 
                id="optimization"
                checked={params.optimizationEnabled}
                onCheckedChange={(v) => updateParam("optimizationEnabled", v)}
              />
            </div>

            <Separator />

            {/* Price Volatility */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Price Volatility</Label>
                <span className="text-sm font-mono text-muted-foreground">{params.priceVolatility}%</span>
              </div>
              <Slider
                value={[params.priceVolatility]}
                onValueChange={([v]) => updateParam("priceVolatility", v)}
                min={10}
                max={100}
                step={5}
              />
              <p className="text-xs text-muted-foreground">
                Higher volatility = bigger price swings = more arbitrage opportunity
              </p>
            </div>

            {/* Average Price */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Average Price (EUR/MWh)</Label>
                <span className="text-sm font-mono text-muted-foreground">{params.avgPrice}</span>
              </div>
              <Slider
                value={[params.avgPrice]}
                onValueChange={([v]) => updateParam("avgPrice", v)}
                min={30}
                max={200}
                step={5}
              />
            </div>

            {/* EV Demand */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Daily EV Demand (kWh)</Label>
                <span className="text-sm font-mono text-muted-foreground">{params.evDemand}</span>
              </div>
              <Slider
                value={[params.evDemand]}
                onValueChange={([v]) => updateParam("evDemand", v)}
                min={100}
                max={1000}
                step={50}
              />
            </div>

            {/* Battery Capacity */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Battery Capacity (kWh)</Label>
                <span className="text-sm font-mono text-muted-foreground">{params.batteryCapacity}</span>
              </div>
              <Slider
                value={[params.batteryCapacity]}
                onValueChange={([v]) => updateParam("batteryCapacity", v)}
                min={100}
                max={500}
                step={20}
              />
              <p className="text-xs text-muted-foreground">
                ChargePost: 232 kWh (2x 116 kWh)
              </p>
            </div>

            <Separator />

            {/* Quick Presets */}
            <div className="space-y-2">
              <Label className="text-sm">Quick Presets</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-xs"
                  onClick={() => setParams({ priceVolatility: 30, avgPrice: 60, evDemand: 300, batteryCapacity: 232, optimizationEnabled: true })}
                >
                  Low Volatility
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-xs"
                  onClick={() => setParams({ priceVolatility: 90, avgPrice: 120, evDemand: 500, batteryCapacity: 232, optimizationEnabled: true })}
                >
                  High Volatility
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-xs"
                  onClick={() => setParams({ priceVolatility: 60, avgPrice: 200, evDemand: 400, batteryCapacity: 232, optimizationEnabled: true })}
                >
                  Energy Crisis
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-xs"
                  onClick={() => setParams({ priceVolatility: 60, avgPrice: 40, evDemand: 600, batteryCapacity: 232, optimizationEnabled: true })}
                >
                  Cheap Energy
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="lg:col-span-2 space-y-6">
          {/* Key Metrics Comparison */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className={params.optimizationEnabled ? "border-green-500/30 bg-green-500/5" : ""}>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Daily Savings</p>
                <p className={`text-2xl font-bold ${params.optimizationEnabled ? "text-green-500" : "text-muted-foreground"}`}>
                  {results.savings.toFixed(0)} EUR
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {params.optimizationEnabled ? `${results.savingsPct}% vs baseline` : "Optimization off"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Baseline Cost</p>
                <p className="text-2xl font-bold text-muted-foreground">{results.baselineCost.toFixed(0)} EUR</p>
                <p className="text-xs text-muted-foreground mt-1">Without optimization</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Optimized Cost</p>
                <p className="text-2xl font-bold text-primary">{results.optimizedCost.toFixed(0)} EUR</p>
                <p className="text-xs text-muted-foreground mt-1">With SmartEMS</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Price Spread</p>
                <p className="text-2xl font-bold">{results.priceSpread.toFixed(0)} EUR</p>
                <p className="text-xs text-muted-foreground mt-1">Peak vs off-peak</p>
              </CardContent>
            </Card>
          </div>

          {/* Price Curve Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Simulated Price Curve</CardTitle>
              <CardDescription>24-hour EPEX price profile based on volatility settings</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={priceCurve}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}€`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                      formatter={(value: number) => [`${value.toFixed(1)} EUR/MWh`, "Price"]}
                    />
                    <defs>
                      <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="price" stroke="#f59e0b" fill="url(#priceGradient)" strokeWidth={2} />
                    <ReferenceLine y={results.avgPrice} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" label={{ value: `Avg: ${results.avgPrice}€`, fontSize: 10 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* SOC Comparison */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Battery SOC Strategy Comparison</CardTitle>
              <CardDescription>How SmartEMS manages battery state vs baseline approach</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={socData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="soc" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                    <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}€`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    />
                    <Legend />
                    <Area yAxisId="price" type="monotone" dataKey="price" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} name="Price (EUR/MWh)" />
                    <Line yAxisId="soc" type="monotone" dataKey="baselineSoc" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeDasharray="5 5" name="Baseline SOC" dot={false} />
                    <Line yAxisId="soc" type="monotone" dataKey="optimizedSoc" stroke="#22c55e" strokeWidth={2} name="Optimized SOC" dot={false} />
                    {params.optimizationEnabled && (
                      <Line yAxisId="soc" type="stepAfter" dataKey="targetSoc" stroke="#3b82f6" strokeWidth={1} strokeDasharray="3 3" name="Target SOC" dot={false} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {params.optimizationEnabled && (
                <div className="mt-4 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg text-sm">
                  <div className="flex items-start gap-2">
                    <Sparkles className="size-4 text-blue-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-blue-700">SmartEMS Strategy</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        Charges battery during low-price hours (00:00-06:00) to build reserves, then uses stored energy 
                        to serve EV demand during high-price hours (08:00-18:00), avoiding expensive grid purchases.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Savings Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Savings Breakdown</CardTitle>
              <CardDescription>Where the optimization value comes from</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Price Arbitrage</span>
                    <Badge variant="outline">{results.arbitrageValue.toFixed(2)} EUR</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Buy low, sell high - storing cheap energy and using it during expensive hours
                  </p>
                  <div className="mt-2 w-full bg-muted rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full transition-all" 
                      style={{ width: `${Math.min(100, (results.arbitrageValue / results.savings) * 100)}%` }} 
                    />
                  </div>
                </div>
                <div className="p-4 rounded-lg border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Load Shifting</span>
                    <Badge variant="outline">{results.loadShiftValue.toFixed(2)} EUR</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Moving EV charging to cheaper hours when possible
                  </p>
                  <div className="mt-2 w-full bg-muted rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full transition-all" 
                      style={{ width: `${Math.min(100, (results.loadShiftValue / results.savings) * 100)}%` }} 
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Value Proposition Summary */}
      <Card className="border-primary/30">
        <CardContent className="py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10">
                <Calculator className="size-6 text-primary" />
              </div>
              <div>
                <p className="font-medium">Projected Annual Savings</p>
                <p className="text-3xl font-bold text-primary">{(results.savings * 365).toLocaleString("de-DE")} EUR</p>
              </div>
            </div>
            <Separator orientation="vertical" className="h-16 hidden md:block" />
            <div className="text-center md:text-left">
              <p className="text-sm text-muted-foreground">Based on current scenario parameters</p>
              <p className="text-sm">
                <span className="font-medium">{params.evDemand} kWh/day</span> demand, 
                <span className="font-medium"> {params.batteryCapacity} kWh</span> battery,
                <span className="font-medium"> {params.priceVolatility}%</span> volatility
              </p>
            </div>
            <Button className="gap-2">
              <Play className="size-4" />
              Run Full Simulation
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
