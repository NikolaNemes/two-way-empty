"use client"

import { useState, useTransition } from "react"
import {
  BarChart3,
  Loader2,
  Search,
  AlertTriangle,
  CheckCircle2,
  ArrowUpFromLine,
  TrendingUp,
  Clock,
  Zap,
  DollarSign,
  Battery,
  Target,
  Gauge,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { fetchDatasetSeries } from "@/app/actions/dataset"
import { useStation } from "@/components/station-context"
import type { DatasetResult, ArbitrageKpis } from "@/lib/dataset"
import { cn } from "@/lib/utils"
import { LabPageHeader, LabPageShell } from "./lab-page-header"
import { LabRangePicker } from "./lab-range-picker"
import { DispatchingOverview, type DispatchPoint } from "./dispatching-overview"

export function DatasetExplorerScreen() {
  const now = new Date()
  const defaultYear = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
  const [fromDate, setFromDate] = useState(`${defaultYear}-05-01`)
  const [toDate, setToDate] = useState(`${defaultYear}-05-02`)
  const [result, setResult] = useState<DatasetResult | null>(null)
  const [isPending, startTransition] = useTransition()
  // MULTI-LOCATION: query the sidebar-selected station's telemetry.
  const { stationId } = useStation()

  function handleQuery() {
    startTransition(async () => {
      const toExclusive = new Date(`${toDate}T00:00:00Z`)
      toExclusive.setUTCDate(toExclusive.getUTCDate() + 1)
      const res = await fetchDatasetSeries({
        stationId,
        fromIso: new Date(`${fromDate}T00:00:00Z`).toISOString(),
        toIso: toExclusive.toISOString(),
      })
      setResult(res)
    })
  }

  const dispatchPoints: DispatchPoint[] =
    result?.points.map((p) => ({
      ts: p.ts,
      hour: p.hour,
      priceEurMwh: p.priceEurMwh,
      actualImportKw: p.importKw,
      evKw: p.evKw,
      b1SocPct: p.b1SocPct,
      b2SocPct: p.b2SocPct,
    })) ?? []

  return (
    <LabPageShell>
      <LabPageHeader
        icon={<BarChart3 className="size-7 text-teal-600" />}
        title="Dataset Explorer"
        description="Inspect the stored telemetry that feeds model training and backtests. Visualise power flows, SOC, and prices, and run a data-quality scan that flags gaps, duplicates, and any frames where the meter implied grid export — which must never happen under the no-export contract."
      />

      {/* Query bar */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="space-y-1.5">
            <Label>Date range</Label>
            <LabRangePicker
              from={fromDate}
              to={toDate}
              disabled={isPending}
              onApply={(f, t) => {
                setFromDate(f)
                setToDate(t)
              }}
            />
          </div>
          <Button onClick={handleQuery} disabled={isPending} className="gap-2">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Query dataset
          </Button>
        </CardContent>
      </Card>

      {result ? (
        <>
          <QualityPanel quality={result.quality} />

          <ArbitrageKpisPanel arbitrage={result.arbitrage} totals={result.totals} />

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Dispatching Overview (BMS, non-optimised)</CardTitle>
              <CardDescription>
                {result.points.length.toLocaleString()} plotted points (downsampled from{" "}
                {result.quality.rowsInRange.toLocaleString()} frames). Shows the real metered grid
                import, B1/B2 pack SOC, derived C1/C2 charging sessions, and total import vs EV
                delivered — exactly what the BMS actually did, with no optimization applied.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dispatchPoints.length === 0 ? (
                <EmptyState />
              ) : (
                <DispatchingOverview
                  mode="bms-only"
                  points={dispatchPoints}
                  sessions={result.sessions}
                  totals={{ actualImportKwh: result.totals.importKwh, evKwh: result.totals.evKwh }}
                />
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <BarChart3 className="size-8 opacity-40" />
            <p className="text-sm">Pick a date range and query the stored dataset.</p>
          </CardContent>
        </Card>
      )}
    </LabPageShell>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ARBITRAGE KPIs PANEL — the three inputs needed for a real estimate
// ════════════════════════════════════════════════════════════════════════════

function ArbitrageKpisPanel({
  arbitrage,
  totals,
}: {
  arbitrage: ArbitrageKpis
  totals: DatasetResult["totals"]
}) {
  const { sessionStats, gapDistribution, priceStats, bufferCapacity, powerStats, arbitrageEstimate } =
    arbitrage

  return (
    <div className="space-y-4">
      {/* Arbitrage Estimate — Hero Card */}
      <Card className="border-teal-500/30 bg-gradient-to-br from-teal-500/5 to-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="size-5 text-teal-600" />
            Arbitrage Estimate
          </CardTitle>
          <CardDescription>
            Capturable spread for the selected period. Baseline assumes no optimization;
            target assumes perfect arbitrage with the available timeable fraction.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Baseline Cost"
              value={`${arbitrageEstimate.baselineCostEur.toFixed(2)}`}
              unit="EUR"
              description="EV energy at mean price"
              icon={<DollarSign className="size-4" />}
            />
            <KpiCard
              label="Target Cost"
              value={`${arbitrageEstimate.targetCostEur.toFixed(2)}`}
              unit="EUR"
              description="With perfect arbitrage"
              icon={<Target className="size-4" />}
              highlight
            />
            <KpiCard
              label="Potential Savings"
              value={`${arbitrageEstimate.potentialSavingsEur.toFixed(2)}`}
              unit="EUR"
              description={`${arbitrageEstimate.savingsPercent.toFixed(1)}% of baseline`}
              icon={<TrendingUp className="size-4" />}
              tone="success"
            />
            <KpiCard
              label="Net Arbitrage"
              value={`${arbitrageEstimate.netArbitrageEur.toFixed(2)}`}
              unit="EUR"
              description="After efficiency + wear"
              icon={<Zap className="size-4" />}
            />
          </div>
        </CardContent>
      </Card>

      {/* Key Drivers Grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Session Stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="size-4 text-amber-600" />
              Session Statistics
            </CardTitle>
            <CardDescription className="text-xs">
              Average demand and duration of EV charging sessions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <MiniKpi label="Sessions" value={sessionStats.sessionCount.toString()} />
              <MiniKpi label="Avg Energy" value={`${sessionStats.avgEnergyKwh} kWh`} />
              <MiniKpi label="Avg Duration" value={formatDuration(sessionStats.avgDurationHours)} />
              <MiniKpi label="Avg Power" value={`${sessionStats.avgPowerKw} kW`} />
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Total EV delivered: <span className="font-medium text-foreground">{totals.evKwh} kWh</span>
            </div>
          </CardContent>
        </Card>

        {/* Gap Distribution (Timeable Fraction) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="size-4 text-blue-600" />
              Inter-Session Gaps
            </CardTitle>
            <CardDescription className="text-xs">
              Time available for arbitrage between charging sessions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <MiniKpi label="Gap Count" value={gapDistribution.gapCount.toString()} />
              <MiniKpi label="Total Free" value={`${gapDistribution.totalFreeHours} h`} />
              <MiniKpi label="Median Gap" value={formatDuration(gapDistribution.p50)} />
              <MiniKpi label="Mean Gap" value={formatDuration(gapDistribution.meanGapHours)} />
            </div>
            <div className="rounded-md bg-blue-500/10 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Timeable Fraction</span>
                <span className="text-sm font-semibold text-blue-600">
                  {(gapDistribution.timeableFraction * 100).toFixed(1)}%
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{ width: `${Math.min(100, gapDistribution.timeableFraction * 100)}%` }}
                />
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Gap percentiles (h): P10={gapDistribution.p10} · P25={gapDistribution.p25} · P75={gapDistribution.p75} · P90={gapDistribution.p90}
            </div>
          </CardContent>
        </Card>

        {/* Price Stats (Capturable Spread) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-emerald-600" />
              Price Statistics
            </CardTitle>
            <CardDescription className="text-xs">
              Day-ahead price curve — determines capturable spread
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <MiniKpi label="Price Slots" value={priceStats.slotCount.toString()} />
              <MiniKpi label="Mean Price" value={`${priceStats.meanPrice}`} unit="EUR/MWh" />
              <MiniKpi label="Min Price" value={`${priceStats.minPrice}`} unit="EUR/MWh" />
              <MiniKpi label="Max Price" value={`${priceStats.maxPrice}`} unit="EUR/MWh" />
            </div>
            <div className="space-y-2 rounded-md bg-emerald-500/10 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Gross Spread</span>
                <span className="text-sm font-semibold">{priceStats.grossSpread} EUR/MWh</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Net Spread</span>
                <span className="text-sm font-semibold text-emerald-600">{priceStats.netSpread} EUR/MWh</span>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Std Dev: {priceStats.stdDev} EUR/MWh · Net = gross × 0.9 (η) - 8 (wear)
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Measured Buffer Capacity + Speed Grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Buffer Energy Capacity — METERED */}
        <Card className="border-violet-500/30">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Battery className="size-4 text-violet-600" />
                  Buffer Energy Capacity
                </CardTitle>
                <CardDescription className="text-xs">
                  Estimated from metered SOC ↔ energy, not the nameplate
                </CardDescription>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                  bufferCapacity.source === "metered"
                    ? "bg-violet-500/15 text-violet-600"
                    : "bg-amber-500/15 text-amber-600",
                )}
              >
                {bufferCapacity.source === "metered" ? "Metered" : "Spec fallback"}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {bufferCapacity.source === "metered" ? (
              <>
                <div className="rounded-md bg-violet-500/10 px-3 py-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Median estimate</span>
                    <span className="text-lg font-semibold tabular-nums text-violet-600">
                      {bufferCapacity.estMedianKwh} kWh
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Range {bufferCapacity.estMinKwh}–{bufferCapacity.estMaxKwh} kWh · σ ±
                    {bufferCapacity.estStdDevKwh} kWh over {bufferCapacity.sampleCount} SOC-swing
                    segments
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <MiniKpi label="Min" value={`${bufferCapacity.estMinKwh}`} unit="kWh" />
                  <MiniKpi label="Avg" value={`${bufferCapacity.estAvgKwh}`} unit="kWh" />
                  <MiniKpi label="Max" value={`${bufferCapacity.estMaxKwh}`} unit="kWh" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MiniKpi label="Spec nameplate" value={`${bufferCapacity.specCapacityKwh}`} unit="kWh" />
                  <MiniKpi label="SOC span used" value={`${bufferCapacity.socSpanPct}`} unit="%" />
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground">
                  Not enough clean SOC swings ({bufferCapacity.sampleCount} segment
                  {bufferCapacity.sampleCount === 1 ? "" : "s"}, need ≥3) in this window to estimate
                  capacity from the meter. Falling back to the nameplate spec. Pick a longer range
                  with more charge/discharge activity.
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MiniKpi label="Spec nameplate" value={`${bufferCapacity.specCapacityKwh}`} unit="kWh" />
                  <MiniKpi label="SOC span seen" value={`${bufferCapacity.socSpanPct}`} unit="%" />
                </div>
              </div>
            )}
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Method: over each sustained charge/discharge, energy through the terminals E = ∫P·dt
              equals capacity × ΔSOC, so capacity = E / (ΔSOC/100). Segments closed every ≥8% SOC
              swing and kept only when mostly one-directional (rejects round-trip-loss noise).
            </p>
          </CardContent>
        </Card>

        {/* Speed — METERED charge/discharge + EV power */}
        <Card className="border-orange-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4 text-orange-600" />
              Speed (Power)
            </CardTitle>
            <CardDescription className="text-xs">
              Metered battery and EV power — max / avg from the frames
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Battery buffer
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MiniKpi label="Charge max" value={`${powerStats.battChargeMaxKw}`} unit="kW" />
                <MiniKpi label="Charge avg" value={`${powerStats.battChargeAvgKw}`} unit="kW" />
                <MiniKpi label="Discharge max" value={`${powerStats.battDischargeMaxKw}`} unit="kW" />
                <MiniKpi label="Discharge avg" value={`${powerStats.battDischargeAvgKw}`} unit="kW" />
              </div>
              <div className="mt-2 rounded-md bg-orange-500/10 px-3 py-1.5 text-[10px] text-muted-foreground">
                Spec ceiling: <span className="font-medium text-foreground">{powerStats.battSpecMaxKw} kW</span>{" "}
                (2 × {powerStats.battSpecMaxKw / 2} kW packs) — peak metered{" "}
                {Math.max(powerStats.battChargeMaxKw, powerStats.battDischargeMaxKw)} kW
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                EV charging
              </div>
              <div className="grid grid-cols-3 gap-3">
                <MiniKpi label="Max" value={`${powerStats.evMaxKw}`} unit="kW" />
                <MiniKpi label="Avg" value={`${powerStats.evAvgKw}`} unit="kW" />
                <MiniKpi label="Min" value={`${powerStats.evMinKw}`} unit="kW" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Throughput drivers (uses the metered capacity above) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Battery className="size-4 text-teal-600" />
            Throughput Drivers
          </CardTitle>
          <CardDescription className="text-xs">
            How the {bufferCapacity.source === "metered" ? "metered" : "spec"} capacity feeds the
            arbitrage estimate
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            <MiniKpi label="Capacity used" value={`${arbitrageEstimate.bufferCapacityKwh}`} unit="kWh" />
            <MiniKpi label="Usable (×0.85)" value={`${arbitrageEstimate.usableCapacityKwh}`} unit="kWh" />
            <MiniKpi label="Cycles/Day" value={arbitrageEstimate.cyclesPerDay.toFixed(2)} />
            <MiniKpi label="Gross Arb." value={`${arbitrageEstimate.grossArbitrageEur.toFixed(2)}`} unit="EUR" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function KpiCard({
  label,
  value,
  unit,
  description,
  icon,
  highlight,
  tone,
}: {
  label: string
  value: string
  unit?: string
  description?: string
  icon?: React.ReactNode
  highlight?: boolean
  tone?: "success" | "warning" | "danger"
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        highlight && "border-teal-500/40 bg-teal-500/5",
        tone === "success" && "border-emerald-500/40 bg-emerald-500/5",
        tone === "warning" && "border-amber-500/40 bg-amber-500/5",
        tone === "danger" && "border-red-500/40 bg-red-500/5",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums",
            tone === "success" && "text-emerald-600",
            tone === "warning" && "text-amber-600",
            tone === "danger" && "text-red-600",
            highlight && "text-teal-600",
          )}
        >
          {value}
        </span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      {description && <div className="mt-0.5 text-[10px] text-muted-foreground">{description}</div>}
    </div>
  )
}

function MiniKpi({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-0.5">
        <span className="text-sm font-medium tabular-nums">{value}</span>
        {unit && <span className="text-[10px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 24) return `${hours.toFixed(1)} h`
  return `${(hours / 24).toFixed(1)} d`
}

function QualityPanel({ quality }: { quality: DatasetResult["quality"] }) {
  const hasExport = quality.observedExportFrames > 0
  const cards = [
    { label: "Frames in range", value: quality.rowsInRange.toLocaleString(), tone: "default" as const },
    { label: "Gaps (> 2× step)", value: quality.gapCount.toLocaleString(), tone: quality.gapCount > 0 ? "warn" : "ok" as const },
    {
      label: "Largest gap",
      value: quality.largestGapSeconds ? `${quality.largestGapSeconds}s` : "—",
      tone: quality.largestGapSeconds > 60 ? "warn" : "ok",
    },
    { label: "Duplicate ts", value: quality.duplicateTimestamps.toLocaleString(), tone: quality.duplicateTimestamps > 0 ? "warn" : "ok" },
    { label: "Null price frames", value: quality.nullPriceFrames.toLocaleString(), tone: quality.nullPriceFrames > 0 ? "warn" : "ok" },
    {
      label: "Observed export frames",
      value: quality.observedExportFrames.toLocaleString(),
      tone: hasExport ? "danger" : "ok",
      icon: hasExport ? ArrowUpFromLine : CheckCircle2,
    },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {hasExport ? (
            <AlertTriangle className="size-5 text-red-500" />
          ) : (
            <CheckCircle2 className="size-5 text-emerald-600" />
          )}
          Data quality
        </CardTitle>
        <CardDescription>
          {hasExport
            ? "Warning: the meter recorded grid export in this window. Under the no-export contract this should be zero — investigate the source data."
            : "No grid export observed — consistent with the no-export contract."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {cards.map((c) => {
            const Icon = "icon" in c ? c.icon : undefined
            return (
              <div
                key={c.label}
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  c.tone === "danger" && "border-red-500/40 bg-red-500/5",
                  c.tone === "warn" && "border-amber-500/40 bg-amber-500/5",
                )}
              >
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {Icon ? <Icon className="size-3" /> : null}
                  {c.label}
                </div>
                <div
                  className={cn(
                    "mt-0.5 text-xl font-semibold tabular-nums",
                    c.tone === "danger" && "text-red-600",
                    c.tone === "warn" && "text-amber-600",
                  )}
                >
                  {c.value}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
      <BarChart3 className="size-8 opacity-40" />
      <p className="text-sm">No frames in this range. Try a different window or run a backfill first.</p>
    </div>
  )
}
