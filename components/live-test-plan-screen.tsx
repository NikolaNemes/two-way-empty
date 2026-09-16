"use client"

import { useMemo, useState } from "react"
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  BatteryWarning,
  Car,
  CheckCircle2,
  Clock,
  Gauge,
  Plug,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

// ════════════════════════════════════════════════════════════════════════
// LIVE TEST PLANNER — today's deliberate-scenario run sheet.
// Prices are the REAL DE-LU EPEX day-ahead curve for 2026-06-16 (Europe/Berlin),
// fetched from the same aWATTar source the dispatcher uses. The hardware
// envelope mirrors lib/dispatch-kernel.ts (GRID_IMPORT_LIMIT_KW, BATT_*).
// ════════════════════════════════════════════════════════════════════════

const TEST_DATE = "Tuesday, 16 June 2026"
const ZONE = "DE-LU (EPEX day-ahead)"

/** Hourly DE-LU day-ahead price (€/MWh), Europe/Berlin, for the test date. */
const DAM_PRICES: { hour: number; eur: number }[] = [
  { hour: 0, eur: 122.83 }, { hour: 1, eur: 117.32 }, { hour: 2, eur: 113.78 }, { hour: 3, eur: 110.99 },
  { hour: 4, eur: 111.24 }, { hour: 5, eur: 115.12 }, { hour: 6, eur: 127.99 }, { hour: 7, eur: 131.70 },
  { hour: 8, eur: 126.32 }, { hour: 9, eur: 109.50 }, { hour: 10, eur: 85.98 }, { hour: 11, eur: 80.54 },
  { hour: 12, eur: 66.50 }, { hour: 13, eur: 54.26 }, { hour: 14, eur: 50.73 }, { hour: 15, eur: 60.22 },
  { hour: 16, eur: 81.46 }, { hour: 17, eur: 109.72 }, { hour: 18, eur: 127.11 }, { hour: 19, eur: 148.12 },
  { hour: 20, eur: 174.10 }, { hour: 21, eur: 181.42 }, { hour: 22, eur: 163.86 }, { hour: 23, eur: 143.11 },
]

type Tier = "cheap" | "mid" | "peak"

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base]
}

const TIER_STYLE: Record<Tier, { bar: string; text: string; chip: string; label: string }> = {
  cheap: {
    bar: "bg-emerald-500",
    text: "text-emerald-600",
    chip: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    label: "Cheap — charge",
  },
  mid: {
    bar: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    chip: "bg-muted text-muted-foreground border-border",
    label: "Mid — neutral",
  },
  peak: {
    bar: "bg-red-500",
    text: "text-red-600",
    chip: "bg-red-500/10 text-red-600 border-red-500/30",
    label: "Peak — discharge",
  },
}

// ── Hardware envelope (from lib/dispatch-kernel.ts) ──────────────────────────
const ENVELOPE = [
  { icon: Gauge, label: "Grid import limit", value: "87 kW", note: "site envelope — hard cap, never exceeded" },
  { icon: BatteryCharging, label: "Battery energy", value: "560 kWh", note: "2 packs × 280 kWh usable" },
  { icon: Zap, label: "Battery power", value: "240 kW", note: "120 kW per pack, combined" },
  { icon: Plug, label: "Connector power", value: "150 kW", note: "per unit; 300 kW dual/boost" },
  { icon: Car, label: "Cars available", value: "2", note: "one per power unit / connector" },
  { icon: ShieldAlert, label: "SOC bands", value: "10 / 40 / 95%", note: "hard floor / reserve / charge ceiling" },
]

type Category = "arbitrage" | "ev" | "stress"

interface TestCase {
  code: string
  title: string
  category: Category
  window: string
  priceContext: string
  cars: string
  setup: string[]
  expected: string[]
  watch: string[]
  success: string
  danger?: boolean
}

const CATEGORY_META: Record<Category, { label: string; icon: typeof Zap; chip: string }> = {
  arbitrage: { label: "Arbitrage", icon: TrendingUp, chip: "bg-orange-500/10 text-orange-600 border-orange-500/30" },
  ev: { label: "EV-coupled", icon: Car, chip: "bg-sky-500/10 text-sky-600 border-sky-500/30" },
  stress: { label: "Stress", icon: AlertTriangle, chip: "bg-red-500/10 text-red-600 border-red-500/30" },
}

// Chronological run sheet. Each test feeds the next (battery SOC choreography).
const TESTS: TestCase[] = [
  {
    code: "T0",
    title: "Morning-peak discharge (optional)",
    category: "arbitrage",
    window: "06:30 – 07:30",
    priceContext: "AM peak €128–132/MWh",
    cars: "0 cars",
    setup: [
      "Only run if the battery carried meaningful charge overnight (SOC ≳ 60%).",
      "Both connectors idle.",
    ],
    expected: [
      "The optimizer discharges modestly to offset site/aux load during the local morning peak.",
      "Grid import suppressed toward zero while the peak holds.",
    ],
    watch: ["Battery power (negative = discharge)", "Grid import kW", "Dispatch plan: sell flag on the AM peak"],
    success: "Some discharge during 06:30–07:30; SOC stays above the reserve floor.",
  },
  {
    code: "T1",
    title: "Midday trough charge (BUY)",
    category: "arbitrage",
    window: "13:00 – 15:00",
    priceContext: "Day minimum €50.73/MWh @ 14:00",
    cars: "0 cars",
    setup: [
      "Start with the battery mid-range (~40–60%) so there is room to fill.",
      "Keep both connectors idle for a clean read.",
    ],
    expected: [
      "The optimizer ramps grid import up (toward the 87 kW cap) to charge the battery.",
      "Battery fills toward the 95% ceiling ahead of the evening peak.",
      "No discharge — it is the cheapest energy of the day.",
    ],
    watch: ["Grid import climbing (≤ 87 kW)", "SOC rising", "Commanded clearance", "Dispatch plan: charge in trough"],
    success: "SOC ≥ 90% by 15:00; grid import never exceeds 87 kW.",
  },
  {
    code: "T2",
    title: "Single car, cheap window (self-consumption)",
    category: "ev",
    window: "12:30 – 13:30",
    priceContext: "Cheap €54–66/MWh (overlaps T1)",
    cars: "1 car @ ~50 kW",
    setup: [
      "Plug car A while prices are low (this deliberately competes with T1 for the 87 kW).",
    ],
    expected: [
      "The optimizer serves the car straight from the (cheap) grid.",
      "It does NOT discharge the battery — no value in spending stored energy when grid is cheap.",
      "Any spare headroom (87 − EV) may still trickle-charge the battery.",
    ],
    watch: ["Battery power ≥ 0 (not discharging)", "Grid ≈ EV load + charge", "Per-connector accounting"],
    success: "Battery never discharges to serve the car during the cheap window.",
  },
  {
    code: "T5",
    title: "Two cars under the grid limit",
    category: "ev",
    window: "15:30 – 16:00",
    priceContext: "Afternoon plateau €60–81/MWh",
    cars: "2 cars @ ~30 kW each (≈ 60 kW)",
    setup: ["Plug both cars at a modest rate so combined demand stays below 87 kW."],
    expected: [
      "Grid serves both cars directly; total stays under the cap.",
      "Battery idle or trickle-charging on the remaining headroom.",
    ],
    watch: ["Grid import = total EV + any charge (≤ 87 kW)", "Both connectors served", "No unintended discharge"],
    success: "Both cars served, grid ≤ 87 kW, battery not forced to discharge.",
  },
  {
    code: "T6",
    title: "Two cars OVER the grid limit (battery assist)",
    category: "stress",
    window: "16:00 – 16:45",
    priceContext: "€81/MWh",
    cars: "2 cars @ ~80–120 kW each (160–240 kW)",
    setup: ["Ramp both cars high simultaneously so combined demand far exceeds 87 kW."],
    expected: [
      "Grid import pins at the 87 kW cap — never above.",
      "Battery discharges the gap (demand − 87 kW), up to its 240 kW ceiling.",
      "Both cars remain fully served (battery-assisted charging).",
    ],
    watch: ["Grid import == 87 kW (not breached)", "Battery discharge = the gap", "SOC drop rate", "Clearance held low"],
    success: "EV demand met in full; grid never > 87 kW; battery carries the difference.",
  },
  {
    code: "T7",
    title: "OVERLOAD — sustained maximum demand (run ONCE)",
    category: "stress",
    danger: true,
    window: "~17:00 (single controlled run)",
    priceContext: "€110/MWh — cheap enough to refill straight after",
    cars: "2 cars @ absolute max (≈ 150 kW each, ~300 kW combined), sustained",
    setup: [
      "Pre-charge the battery to ~80–95% first (T1 leaves it full).",
      "Brief the site and have an ABORT (unplug) ready before starting.",
      "Run only once, and keep it short — this is a protection test, not an arbitrage play.",
    ],
    expected: [
      "Phase 1: grid holds at 87 kW, battery discharges ~220 kW to cover ~300 kW demand.",
      "Phase 2: as SOC falls toward the reserve floor, the optimizer CURTAILS the EVs (drops P_ev_limit / charging_mode) so total load never forces grid above 87 kW.",
      "The grid import cap is respected the entire time — no breaker trip.",
    ],
    watch: [
      "Grid import — MUST stay ≤ 87 kW the whole time",
      "Battery power & SOC falling toward reserve",
      "The instant curtailment engages (EV power limit drops)",
      "Clean recovery once a car unplugs",
    ],
    success: "Grid never exceeds 87 kW; EVs curtail smoothly at the reserve floor; system recovers afterward.",
  },
  {
    code: "T8",
    title: "Recovery / refill after overload",
    category: "arbitrage",
    window: "17:15 – 18:00",
    priceContext: "€110–127/MWh (still below the peak)",
    cars: "0 cars",
    setup: ["Leave connectors idle and let the optimizer recover the depleted pack."],
    expected: [
      "The optimizer refills the battery from the grid — still far cheaper than the €174–181 evening peak.",
      "Charge respects the 87 kW cap.",
    ],
    watch: ["SOC recovering", "Grid import for charge (≤ 87 kW)", "Dispatch plan: refill ahead of peak"],
    success: "SOC back to ~80%+ before the evening-peak window (T3).",
  },
  {
    code: "T3",
    title: "Evening-peak discharge (SELL)",
    category: "arbitrage",
    window: "20:00 – 21:30",
    priceContext: "Day maximum €181.42/MWh @ 21:00",
    cars: "0 cars",
    setup: ["Battery full (~95%) from T1/T8.", "Connectors idle so the discharge is unambiguous."],
    expected: [
      "The optimizer discharges the battery hard to drive grid import toward zero at the most expensive hour.",
      "This is the day's primary arbitrage return.",
    ],
    watch: ["Battery discharging", "Grid import near 0", "SOC falling", "Dispatch plan: peak sell flagged"],
    success: "Strong discharge across 20:00–21:30; SOC drawn down but held above the reserve floor.",
  },
  {
    code: "T4",
    title: "Single car at peak (battery-assisted, avoid expensive import)",
    category: "ev",
    window: "20:00 – 21:00",
    priceContext: "Peak €174–181/MWh (overlaps T3)",
    cars: "1 car @ ~50–100 kW",
    setup: ["Plug car B during the peak while the battery still has charge."],
    expected: [
      "The optimizer serves the car primarily from battery discharge rather than €181/MWh grid energy.",
      "Grid clearance held low; battery covers the EV up to its power limit.",
    ],
    watch: ["Battery discharge ≈ EV load", "Grid import suppressed well below EV demand", "Clearance cap"],
    success: "Grid import stays far below EV demand — the battery is carrying the car at the peak.",
  },
]

function PriceBars() {
  const stats = useMemo(() => {
    const vals = DAM_PRICES.map((p) => p.eur)
    const sorted = [...vals].sort((a, b) => a - b)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const q25 = quantile(sorted, 0.25)
    const q75 = quantile(sorted, 0.75)
    const minHour = DAM_PRICES.find((p) => p.eur === min)!.hour
    const maxHour = DAM_PRICES.find((p) => p.eur === max)!.hour
    return { min, max, mean, q25, q75, minHour, maxHour }
  }, [])

  const tierOf = (eur: number): Tier => (eur <= stats.q25 ? "cheap" : eur >= stats.q75 ? "peak" : "mid")

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Today&apos;s day-ahead price shape</CardTitle>
            <CardDescription>
              {ZONE} · {TEST_DATE}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className={TIER_STYLE.cheap.chip}>
              <TrendingDown className="mr-1 size-3" />
              Min €{stats.min.toFixed(2)} @ {String(stats.minHour).padStart(2, "0")}:00
            </Badge>
            <Badge variant="outline" className={TIER_STYLE.peak.chip}>
              <TrendingUp className="mr-1 size-3" />
              Max €{stats.max.toFixed(2)} @ {String(stats.maxHour).padStart(2, "0")}:00
            </Badge>
            <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
              Spread €{(stats.max - stats.min).toFixed(2)} ({(stats.max / stats.min).toFixed(1)}×)
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-1" style={{ height: 140 }}>
          {DAM_PRICES.map((p) => {
            const tier = tierOf(p.eur)
            const h = 16 + (p.eur / stats.max) * 108
            return (
              <div key={p.hour} className="group relative flex flex-1 flex-col items-center justify-end gap-1">
                <span className={cn("text-[9px] font-medium tabular-nums opacity-0 group-hover:opacity-100", TIER_STYLE[tier].text)}>
                  {Math.round(p.eur)}
                </span>
                <div
                  className={cn("w-full rounded-t-sm transition-all", TIER_STYLE[tier].bar)}
                  style={{ height: h }}
                  title={`${String(p.hour).padStart(2, "0")}:00 — €${p.eur.toFixed(2)}/MWh`}
                />
                {p.hour % 3 === 0 ? (
                  <span className="text-[9px] tabular-nums text-muted-foreground">{String(p.hour).padStart(2, "0")}</span>
                ) : (
                  <span className="text-[9px] text-transparent">·</span>
                )}
              </div>
            )
          })}
        </div>
        <Separator className="my-4" />
        <div className="flex flex-wrap items-center gap-4 text-xs">
          {(Object.keys(TIER_STYLE) as Tier[]).map((t) => (
            <div key={t} className="flex items-center gap-1.5">
              <span className={cn("inline-block size-2.5 rounded-sm", TIER_STYLE[t].bar)} />
              <span className="text-muted-foreground">{TIER_STYLE[t].label}</span>
            </div>
          ))}
          <span className="ml-auto text-muted-foreground">
            Tiers split at the 25th / 75th percentile · mean €{stats.mean.toFixed(0)}/MWh
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

export function LiveTestPlanScreen() {
  const [done, setDone] = useState<Set<string>>(new Set())
  const toggle = (code: string) =>
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })

  const planned = TESTS.length
  const completed = done.size

  return (
    <div className="w-full py-8 px-6 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-balance">
          <Activity className="size-7 text-orange-500" />
          Live Test Plan — Deliberate Scenarios
        </h1>
        <p className="max-w-3xl text-pretty text-muted-foreground">
          Today&apos;s run sheet for on-site testing with two cars. Scenarios are sequenced against the real DE-LU
          day-ahead price curve so each test lands in the right price window, and the battery is in the right state
          for the next one. One test is a deliberate grid overload — run it once, carefully.
        </p>
      </div>

      {/* Progress */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="text-sm">
          <CheckCircle2 className="mr-1.5 size-3.5 text-emerald-600" />
          {completed} / {planned} tests done
        </Badge>
        <div className="h-2 flex-1 min-w-40 max-w-xs overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-orange-500 transition-all"
            style={{ width: `${planned ? (completed / planned) * 100 : 0}%` }}
          />
        </div>
      </div>

      <PriceBars />

      {/* Hardware envelope */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">System envelope</CardTitle>
          <CardDescription>The physical limits every scenario is checked against (from the dispatch kernel).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {ENVELOPE.map((e) => (
              <div key={e.label} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
                <e.icon className="size-4 text-orange-500" />
                <span className="text-lg font-semibold tabular-nums leading-none">{e.value}</span>
                <span className="text-xs font-medium">{e.label}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">{e.note}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Dispatch model — what we actually command in Automatic mode */}
      <Card className="border-orange-500/30 bg-orange-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dispatch model — Automatic mode</CardTitle>
          <CardDescription>
            What to watch on the wire today. The station runs in Automatic mode, so we drive only two registers —
            everything else is the station&apos;s own real-time control.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
            <Gauge className="size-4 text-orange-500" />
            <span className="text-sm font-semibold">
              <code className="rounded bg-muted px-1 py-0.5 text-xs">P_grid_clearance</code>
            </span>
            <span className="text-[11px] leading-tight text-muted-foreground">
              The grid-import <span className="font-medium text-foreground">ceiling</span> (max kW the site may pull).
              This is the arbitrage lever: high in cheap slots (grid serves load + charges the buffer), low at the
              peak (battery supplements instead of the grid). The station serves any EV demand above the ceiling
              from the battery.
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
            <BatteryCharging className="size-4 text-orange-500" />
            <span className="text-sm font-semibold">
              <code className="rounded bg-muted px-1 py-0.5 text-xs">soc_cp_max</code>
            </span>
            <span className="text-[11px] leading-tight text-muted-foreground">
              The per-connector charge target (%). Used to pace or hold EV charging during stress and curtailment.
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-red-500/30 bg-card p-3">
            <ShieldAlert className="size-4 text-red-500" />
            <span className="text-sm font-semibold">
              <code className="rounded bg-muted px-1 py-0.5 text-xs">P_grid</code> — not used
            </span>
            <span className="text-[11px] leading-tight text-muted-foreground">
              The signed <span className="font-medium text-foreground">P_grid</span> setpoint (negative = import)
              applies only in Manual mode. In Automatic mode we do <span className="font-medium text-foreground">not</span>{" "}
              send it — do not expect a P_grid command on the wire. Measured grid power telemetry stays
              producer-counted (import shows negative) independently of dispatch.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Recommended schedule */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recommended schedule</CardTitle>
          <CardDescription>Chronological — each window is chosen to exploit today&apos;s price shape.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1">
            {TESTS.map((t) => {
              const cat = CATEGORY_META[t.category]
              return (
                <li
                  key={t.code}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-2 py-2 text-sm",
                    t.danger ? "bg-red-500/5" : "hover:bg-muted/50",
                    done.has(t.code) && "opacity-50",
                  )}
                >
                  <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="w-32 shrink-0 font-medium tabular-nums">{t.window}</span>
                  <Badge variant="outline" className={cn("shrink-0", cat.chip)}>
                    {t.code}
                  </Badge>
                  <span className={cn("truncate", done.has(t.code) && "line-through")}>{t.title}</span>
                  {t.danger ? <AlertTriangle className="ml-auto size-4 shrink-0 text-red-600" /> : null}
                </li>
              )
            })}
          </ol>
        </CardContent>
      </Card>

      {/* Scenario detail cards */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Test scenarios</h2>
        <p className="text-sm text-muted-foreground">Tick each off as you run it on site.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {TESTS.map((t) => {
          const cat = CATEGORY_META[t.category]
          const isDone = done.has(t.code)
          return (
            <Card
              key={t.code}
              className={cn(
                "flex flex-col",
                t.danger && "border-red-500/40 bg-red-500/5",
                isDone && "opacity-60",
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={isDone}
                    onCheckedChange={() => toggle(t.code)}
                    className="mt-1"
                    aria-label={`Mark ${t.code} done`}
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cat.chip}>
                        <cat.icon className="mr-1 size-3" />
                        {t.code} · {cat.label}
                      </Badge>
                      {t.danger ? (
                        <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">
                          <ShieldAlert className="mr-1 size-3" />
                          Run once
                        </Badge>
                      ) : null}
                    </div>
                    <CardTitle className={cn("text-base text-balance", isDone && "line-through")}>{t.title}</CardTitle>
                    <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="inline-flex items-center gap-1 font-medium text-foreground">
                        <Clock className="size-3.5" />
                        {t.window}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <TrendingUp className="size-3.5" />
                        {t.priceContext}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Car className="size-3.5" />
                        {t.cars}
                      </span>
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-4 text-sm">
                <DetailBlock icon={Plug} title="Setup" items={t.setup} />
                <DetailBlock icon={Zap} title="Expected dispatch" items={t.expected} tone="orange" />
                <DetailBlock icon={Activity} title="Watch" items={t.watch} tone="sky" />
                <div
                  className={cn(
                    "flex items-start gap-2 rounded-md border p-2.5",
                    t.danger
                      ? "border-red-500/30 bg-red-500/10 text-red-700"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
                  )}
                >
                  {t.danger ? (
                    <BatteryWarning className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  )}
                  <span>
                    <span className="font-semibold">Success: </span>
                    {t.success}
                  </span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Overload safety note */}
      <Card className="border-red-500/40 bg-red-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-red-700">
            <AlertTriangle className="size-5" />
            Overload test (T7) — safety brief
          </CardTitle>
          <CardDescription>Run exactly once, with an operator watching the grid meter live.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-pretty">
            The aim is to confirm the protections, not to break anything. The grid import must stay at or below
            <span className="font-semibold"> 87 kW</span> the entire time; the battery (up to 240 kW) fills the gap to
            the cars; and as the pack approaches its reserve floor the optimizer must curtail the EVs gracefully rather
            than letting demand push the grid over its cap.
          </p>
          <DetailBlock
            icon={ShieldAlert}
            title="Abort immediately if"
            tone="red"
            items={[
              "Grid import reads above 87 kW at any point.",
              "Any breaker, thermal, or BMS protection alarm fires.",
              "A car keeps drawing full power after the battery hits the reserve floor (curtailment failed).",
            ]}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function DetailBlock({
  icon: Icon,
  title,
  items,
  tone = "muted",
}: {
  icon: typeof Zap
  title: string
  items: string[]
  tone?: "muted" | "orange" | "sky" | "red"
}) {
  const toneText =
    tone === "orange"
      ? "text-orange-600"
      : tone === "sky"
        ? "text-sky-600"
        : tone === "red"
          ? "text-red-600"
          : "text-muted-foreground"
  return (
    <div className="space-y-1.5">
      <div className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", toneText)}>
        <Icon className="size-3.5" />
        {title}
      </div>
      <ul className="space-y-1 pl-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 leading-relaxed">
            <span className={cn("mt-2 inline-block size-1 shrink-0 rounded-full", toneText.replace("text-", "bg-"))} />
            <span className="text-foreground/90">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
