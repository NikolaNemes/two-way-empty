"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import useSWR from "swr"
import {
  Microscope,
  Loader2,
  Play,
  ShieldCheck,
  TrendingDown,
  Battery,
  AlertTriangle,
  GitCompare,
  RefreshCw,
  Activity,
  } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { listModelVersions } from "@/app/actions/models"
import { runAndStoreBacktest, listBacktestRuns } from "@/app/actions/backtest"
import { useStation } from "@/components/station-context"
import type { BacktestRunRow, ModelVersionRow } from "@/lib/db/schema"
import type { BacktestKpis, BacktestSeriesPoint } from "@/lib/backtest"
import { cn } from "@/lib/utils"
import { LabPageHeader, LabPageShell } from "./lab-page-header"
import { LabRangePicker } from "./lab-range-picker"
import { DispatchingOverview, type DispatchPoint, type SessionLite } from "./dispatching-overview"

export function BacktestLabScreen() {
  const now = new Date()
  const defaultYear = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
  const [fromDate, setFromDate] = useState(`${defaultYear}-05-01`)
  const [toDate, setToDate] = useState(`${defaultYear}-05-02`)
  const [versionId, setVersionId] = useState<string>("")
  // Optimizer look-ahead horizon (steps). "" = use the model version's own horizon.
  // Lets us A/B 24h vs 30h vs 35h to see if a longer horizon defers charging to
  // a cheaper/negative-price tomorrow once the day-ahead curve is published.
  const [horizonSteps, setHorizonSteps] = useState<string>("")
  const [isPending, startTransition] = useTransition()
  const [latestRun, setLatestRun] = useState<BacktestRunRow | null>(null)
  const [compareIds, setCompareIds] = useState<[string, string]>(["", ""])

  // MULTI-LOCATION: replays run against the sidebar-selected station's frames.
  const { stationId } = useStation()
  const { data: versions } = useSWR("lab:models", () => listModelVersions())
  const { data: runs, mutate: mutateRuns } = useSWR("lab:runs", () => listBacktestRuns())

  useEffect(() => {
    if (!versionId && versions && versions.length > 0) {
      setVersionId(String(versions.find((v) => v.isDefault)?.id ?? versions[0].id))
    }
  }, [versions, versionId])

  function handleRun() {
    if (!versionId) return
    startTransition(async () => {
      const toExclusive = new Date(`${toDate}T00:00:00Z`)
      toExclusive.setUTCDate(toExclusive.getUTCDate() + 1)
      const run = await runAndStoreBacktest({
        stationId,
        modelVersionId: Number(versionId),
        fromIso: new Date(`${fromDate}T00:00:00Z`).toISOString(),
        toIso: toExclusive.toISOString(),
        horizonStepsOverride: horizonSteps ? Number(horizonSteps) : undefined,
      })
      setLatestRun(run)
      await mutateRuns()
    })
  }

  const versionLabel = (id: number) => versions?.find((v) => v.id === id)?.label ?? `#${id}`

  return (
    <LabPageShell>
      <LabPageHeader
        icon={<Microscope className="size-7 text-teal-600" />}
        title="Backtest Lab"
        description="Replay any model version over the stored telemetry as a true counterfactual: the kernel re-plans and re-decides each tick while SOC is simulated forward from commanded battery power. Every run enforces the no-export clamp and reports whether it was ever triggered."
      />

      {/* Run config */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="space-y-1.5">
            <Label>Model version</Label>
            <Select value={versionId} onValueChange={setVersionId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select version" />
              </SelectTrigger>
              <SelectContent>
                {(versions ?? []).map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    <span className="font-mono">{v.label}</span> — {v.name}
                    {v.isDefault ? " · published default" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {versions && versionId && !versions.find((v) => String(v.id) === versionId)?.isDefault ? (
              <p className="max-w-56 text-[11px] leading-snug text-amber-600">
                The Data Analysis report always replays the published default
                {" "}
                <span className="font-mono">
                  {versions.find((v) => v.isDefault)?.label ?? "default"}
                </span>
                . Select it here to reproduce identical numbers.
              </p>
            ) : null}
          </div>
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
          <div className="space-y-1.5">
            <Label>Plan horizon</Label>
            <Select value={horizonSteps || "default"} onValueChange={(v) => setHorizonSteps(v === "default" ? "" : v)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Model default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Model default</SelectItem>
                <SelectItem value="96">96 steps · 24h</SelectItem>
                <SelectItem value="120">120 steps · 30h</SelectItem>
                <SelectItem value="140">140 steps · 35h</SelectItem>
              </SelectContent>
            </Select>
            <p className="max-w-44 text-[11px] leading-snug text-muted-foreground">
              Look-ahead length. A longer horizon only helps once tomorrow&apos;s day-ahead
              prices are published (~13:00 CET) — to defer charging into a cheaper or
              negative-price trough.
            </p>
          </div>
          <Button onClick={handleRun} disabled={isPending || !versionId} className="gap-2">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Run backtest
          </Button>
        </CardContent>
      </Card>

      {latestRun ? <RunResult run={latestRun} versionLabel={versionLabel(latestRun.modelVersionId)} /> : null}

      {/* A/B compare */}
      <ComparePanel runs={runs ?? []} versions={versions ?? []} compareIds={compareIds} setCompareIds={setCompareIds} />

      {/* Run history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Backtest runs</CardTitle>
          <CardDescription>Stored runs — select two above to compare.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!runs || runs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No backtest runs yet.</p>
          ) : (
            runs.map((r) => {
              const k = r.kpis as BacktestKpis
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setLatestRun(r)}
                  className="flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  <Badge variant="outline" className="font-mono text-xs">
                    {versionLabel(r.modelVersionId)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.fromTs).toISOString().slice(0, 10)} → {new Date(r.toTs).toISOString().slice(0, 10)}
                  </span>
                  {r.notes ? (
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {r.notes}
                    </Badge>
                  ) : null}
                  <span className="ml-auto text-sm font-medium tabular-nums text-emerald-600">
                    €{k.savingsEur.toFixed(2)} saved
                  </span>
                  {k.exportViolations > 0 ? (
                    <Badge variant="destructive" className="gap-1 text-[10px]">
                      <AlertTriangle className="size-3" /> {k.exportViolations} export
                    </Badge>
                  ) : null}
                </button>
              )
            })
          )}
        </CardContent>
      </Card>
    </LabPageShell>
  )
}

interface CompareRow {
  label: string
  actual: string
  optimized: string
  diff: string
  /** Whether the optimised side is an improvement (drives the green/amber colour). */
  good: boolean
}

function RunResult({ run, versionLabel }: { run: BacktestRunRow; versionLabel: string }) {
  const k = run.kpis as BacktestKpis
  const series = (run.series ?? []) as BacktestSeriesPoint[]
  const sessions = (run.sessions ?? []) as SessionLite[]
  const runTotals = (run.totals ?? null) as
    | {
        actualImportKwh: number
        optimizedImportKwh: number
        evKwh: number
        mEv1Kwh?: number
        mEv2Kwh?: number
        evUnservedKwh?: number
      }
    | null
  const dispatchPoints: DispatchPoint[] = series.map((p) => ({
    ts: p.ts,
    hour: p.hour ?? 0,
    priceEurMwh: p.priceEurMwh,
    actualImportKw: p.actualGridKw,
    optimizedImportKw: p.gridKw,
    siteGridLimitKw: p.siteGridLimitKw ?? null,
    // EV load isn't stored on older series points; fall back to 0.
    evKw: p.evKw ?? 0,
    b1SocPct: p.b1SocPct ?? p.socPct ?? null,
    b2SocPct: p.b2SocPct ?? p.socPct ?? null,
    actualB1SocPct: p.actualB1SocPct ?? null,
    actualB2SocPct: p.actualB2SocPct ?? null,
    g1Kw: p.g1Kw ?? null,
    g2Kw: p.g2Kw ?? null,
    b1Kw: p.b1Kw ?? null,
    b2Kw: p.b2Kw ?? null,
    mEv1Kw: p.mEv1Kw ?? null,
    mEv2Kw: p.mEv2Kw ?? null,
    mEv1Kwh: p.mEv1Kwh ?? null,
    mEv2Kwh: p.mEv2Kwh ?? null,
    sEv1Kwh: p.sEv1Kwh ?? null,
    sEv2Kwh: p.sEv2Kwh ?? null,
  }))

  // ── Optimised vs non-optimised (actual) comparison values ──────────────
  const actualImport = runTotals?.actualImportKwh ?? 0
  const optImport = runTotals?.optimizedImportKwh ?? 0
  const evKwh = runTotals?.evKwh ?? 0
  // METERED per-connector EV (ground truth). Older runs lack these.
  const mEv1Kwh = runTotals?.mEv1Kwh ?? null
  const mEv2Kwh = runTotals?.mEv2Kwh ?? null
  const meteredEvTotal = mEv1Kwh != null && mEv2Kwh != null ? mEv1Kwh + mEv2Kwh : null
  const evUnservedKwh = runTotals?.evUnservedKwh ?? null
  const importDelta = optImport - actualImport // negative ⇒ optimiser imports less
  const avgPriceActual = actualImport > 0 ? (k.actualCostEur / actualImport) * 1000 : null
  const avgPriceOpt = optImport > 0 ? (k.optimizedCostEur / optImport) * 1000 : null

  // SOC over the period (simulated optimised SOC at first/last frame).
  const socStart = series.length ? series[0].socPct : null
  const socEnd = series.length ? series[series.length - 1].socPct : null
  const socDelta = socStart != null && socEnd != null ? socEnd - socStart : null

  // ── Per-pack SOC: actual (non-optimised) vs simulated optimised ────────
  // Hardware spec: 2 packs �� 280 kWh usable = 560 kWh, so 1 pp ≈ 5.6 kWh combined.
  const PACK_KWH = 280
  const ppToKwh = (pp: number, packs = 1) => (pp / 100) * PACK_KWH * packs
  const fmtPp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)} pp`
  const fmtKwh = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} kWh`
  const first = series.length ? series[0] : undefined
  const last = series.length ? series[series.length - 1] : undefined
  const packSoc = (
    optKey: "b1SocPct" | "b2SocPct",
    actKey: "actualB1SocPct" | "actualB2SocPct",
  ) => {
    const optStart = first?.[optKey] ?? null
    const optEnd = last?.[optKey] ?? null
    const actStart = first?.[actKey] ?? null
    const actEnd = last?.[actKey] ?? null
    return {
      optStart,
      optEnd,
      optDelta: optStart != null && optEnd != null ? optEnd - optStart : null,
      actStart,
      actEnd,
      actDelta: actStart != null && actEnd != null ? actEnd - actStart : null,
    }
  }
  const b1 = packSoc("b1SocPct", "actualB1SocPct")
  const b2 = packSoc("b2SocPct", "actualB2SocPct")

  // Combined actual SOC delta (avg of both packs) for the comparison table.
  const actualSocStart =
    b1.actStart != null && b2.actStart != null ? (b1.actStart + b2.actStart) / 2 : null
  const actualSocEnd =
    b1.actEnd != null && b2.actEnd != null ? (b1.actEnd + b2.actEnd) / 2 : null
  const actualSocDelta =
    actualSocStart != null && actualSocEnd != null ? actualSocEnd - actualSocStart : null

  const compareRows: CompareRow[] = [
    {
      label: "Energy cost",
      actual: `€${(k.actualCostEur ?? 0).toFixed(2)}`,
      optimized: `€${k.optimizedCostEur.toFixed(2)}`,
      diff: `${k.savingsEur >= 0 ? "−" : "+"}€${Math.abs(k.savingsEur).toFixed(2)} (${k.savingsPct.toFixed(1)}%)`,
      good: k.savingsEur >= 0,
    },
    {
      label: "Grid import",
      actual: `${actualImport.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
      optimized: `${optImport.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
      diff: `${importDelta >= 0 ? "+" : "−"}${Math.abs(importDelta).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
      good: importDelta <= 0,
    },
    {
      label: "EV delivered",
      actual: `${evKwh.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
      // EV demand is exogenous: the cars need the same energy regardless of the
      // dispatch policy, so the optimised counterfactual delivers the same kWh.
      optimized: `${evKwh.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
      diff: "0.0 kWh (exogenous)",
      good: true,
    },
    // ── METERED per-connector EV (ground truth from e_ev_chg_kwh counters) ──
    ...(meteredEvTotal != null
      ? ([
          {
            label: "› Connector A (metered)",
            actual: `${(mEv1Kwh ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
            optimized: `${(mEv1Kwh ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
            diff: "metered",
            good: true,
          },
          {
            label: "› Connector B (metered)",
            actual: `${(mEv2Kwh ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
            optimized: `${(mEv2Kwh ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
            diff: "metered",
            good: true,
          },
          {
            label: "› Metered total (A+B)",
            actual: `${meteredEvTotal.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
            optimized: `${meteredEvTotal.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
            // How much of the signal fed to the kernel was real EV vs aux baseload.
            diff:
              evKwh > 0
                ? `${((meteredEvTotal / evKwh) * 100).toFixed(0)}% of signal`
                : "metered",
            good: true,
          },
        ] as CompareRow[])
      : []),
    // ── HARD RULE guard: EV is must-serve, so unserved must be 0 ────────────
    ...(evUnservedKwh != null
      ? ([
          {
            label: "EV unserved (must-serve)",
            actual: "—",
            optimized: `${evUnservedKwh.toLocaleString(undefined, { maximumFractionDigits: 2 })} kWh`,
            diff: evUnservedKwh <= 0.01 ? "✓ full demand served" : "RULE VIOLATED",
            good: evUnservedKwh <= 0.01,
          },
        ] as CompareRow[])
      : []),
    {
      label: "Avg price paid",
      actual: avgPriceActual != null ? `€${avgPriceActual.toFixed(1)}/MWh` : "—",
      optimized: avgPriceOpt != null ? `€${avgPriceOpt.toFixed(1)}/MWh` : "—",
      diff:
        avgPriceActual != null && avgPriceOpt != null
          ? `${avgPriceOpt - avgPriceActual >= 0 ? "+" : "−"}€${Math.abs(avgPriceOpt - avgPriceActual).toFixed(1)}/MWh`
          : "—",
      good: avgPriceActual != null && avgPriceOpt != null ? avgPriceOpt <= avgPriceActual : true,
    },
    {
      label: "SOC retained (Δ, both packs)",
      actual:
        actualSocDelta != null ? `${fmtPp(actualSocDelta)} (${fmtKwh(ppToKwh(actualSocDelta, 2))})` : "—",
      optimized: socDelta != null ? `${fmtPp(socDelta)} (${fmtKwh(ppToKwh(socDelta, 2))})` : "—",
      diff:
        actualSocDelta != null && socDelta != null
          ? `${fmtPp(socDelta - actualSocDelta)} (${fmtKwh(ppToKwh(socDelta - actualSocDelta, 2))})`
          : "—",
      good: actualSocDelta != null && socDelta != null ? socDelta >= actualSocDelta : true,
    },
  ]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              Run #{run.id} · <span className="font-mono">{versionLabel}</span>
            </CardTitle>
            <CardDescription>
              {new Date(run.fromTs).toISOString().slice(0, 10)} → {new Date(run.toTs).toISOString().slice(0, 10)} ·{" "}
              {k.frames.toLocaleString()} frames · {k.durationHours.toFixed(1)}h
            </CardDescription>
          </div>
          {k.exportViolations === 0 ? (
            <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
              <ShieldCheck className="size-3" /> No-export verified
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="size-3" /> {k.exportViolations} export clamps
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Headline outcomes */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi icon={TrendingDown} label="Savings" value={`€${k.savingsEur.toFixed(2)}`} tone={k.savingsEur >= 0 ? "ok" : "warn"} />
          <Kpi label="Savings %" value={`${k.savingsPct.toFixed(1)}%`} tone={k.savingsPct >= 0 ? "ok" : "warn"} />
          <Kpi icon={Battery} label="Cycles" value={k.batteryCycles.toFixed(2)} />
          <Kpi label="Emergency ticks" value={k.emergencyTicks.toLocaleString()} tone={k.emergencyTicks > 0 ? "warn" : "default"} />
        </div>

        {/* Event-driven replanning + intraday pricing diagnostics */}
        {k.engine === "v4-mpc" && k.mpcReplans != null ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <RefreshCw className="size-3.5" />
              Replanning & intraday
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi icon={RefreshCw} label="LP replans" value={k.mpcReplans.toLocaleString()} />
              <Kpi
                label="Solves saved"
                value={(k.mpcReplansSaved ?? 0).toLocaleString()}
                tone={(k.mpcReplansSaved ?? 0) > 0 ? "ok" : "default"}
              />
              <Kpi
                icon={Activity}
                label="IDM-priced slots"
                value={(k.mpcIdmPricedSlots ?? 0).toLocaleString()}
              />
              <Kpi
                label="Infeasible slots"
                value={(k.mpcInfeasibleSlots ?? 0).toLocaleString()}
                tone={(k.mpcInfeasibleSlots ?? 0) > 0 ? "warn" : "default"}
              />
            </div>
            {k.mpcReplanTriggers ? (
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                <Badge variant="outline" className="font-mono">init {k.mpcReplanTriggers.init}</Badge>
                <Badge variant="outline" className="font-mono">connect {k.mpcReplanTriggers.connect}</Badge>
                <Badge variant="outline" className="font-mono">disconnect {k.mpcReplanTriggers.disconnect}</Badge>
                <Badge variant="outline" className="font-mono">session {k.mpcReplanTriggers.session ?? 0}</Badge>
                <Badge variant="outline" className="font-mono">idm {k.mpcReplanTriggers.idm}</Badge>
                <Badge variant="outline" className="font-mono">safety {k.mpcReplanTriggers.safety}</Badge>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Optimised vs non-optimised — what actually changed */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <GitCompare className="size-3.5" />
            Optimised vs non-optimised
          </div>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Metric</th>
                  <th className="px-3 py-2 text-right font-medium">Non-optimised (actual)</th>
                  <th className="px-3 py-2 text-right font-medium">Optimised ({versionLabel})</th>
                  <th className="px-3 py-2 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row, i) => (
                  <tr key={row.label} className={cn("border-b last:border-0", i % 2 ? "bg-muted/20" : "")}>
                    <td className="px-3 py-2 text-muted-foreground">{row.label}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{row.actual}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{row.optimized}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-mono font-semibold tabular-nums",
                        row.good ? "text-emerald-600" : "text-amber-600",
                      )}
                    >
                      {row.diff}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Energy balance & state of charge over the period */}
        <div className="space-y-3">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Energy balance &amp; state of charge
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi label="Actual import" value={`${actualImport.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`} />
            <Kpi label="Optimised import" value={`${optImport.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`} tone={importDelta <= 0 ? "ok" : "default"} />
            <Kpi label="EV delivered" value={`${evKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh`} />
          </div>

          {/* Per-pack SOC: non-optimised (actual) vs optimised, B1 & B2 */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              State of charge per pack — non-optimised vs optimised
            </div>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Pack</th>
                    <th className="px-3 py-2 text-left font-medium">Scenario</th>
                    <th className="px-3 py-2 text-right font-medium">SOC start</th>
                    <th className="px-3 py-2 text-right font-medium">SOC end</th>
                    <th className="px-3 py-2 text-right font-medium">Δ SOC</th>
                    <th className="px-3 py-2 text-right font-medium">Δ Energy</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { pack: "B1", opt: false, start: b1.actStart, end: b1.actEnd, delta: b1.actDelta, better: b1.actDelta != null && b1.optDelta != null ? b1.optDelta >= b1.actDelta : null },
                    { pack: "B1", opt: true, start: b1.optStart, end: b1.optEnd, delta: b1.optDelta, better: b1.actDelta != null && b1.optDelta != null ? b1.optDelta >= b1.actDelta : null },
                    { pack: "B2", opt: false, start: b2.actStart, end: b2.actEnd, delta: b2.actDelta, better: b2.actDelta != null && b2.optDelta != null ? b2.optDelta >= b2.actDelta : null },
                    { pack: "B2", opt: true, start: b2.optStart, end: b2.optEnd, delta: b2.optDelta, better: b2.actDelta != null && b2.optDelta != null ? b2.optDelta >= b2.actDelta : null },
                  ].map((r, i) => {
                    const deltaTone =
                      r.opt && r.delta != null
                        ? r.better === true
                          ? "font-semibold text-emerald-600"
                          : r.better === false
                            ? "font-semibold text-amber-600"
                            : "font-semibold text-foreground"
                        : ""
                    return (
                      <tr
                        key={`${r.pack}-${r.opt ? "opt" : "act"}`}
                        className={cn("border-b last:border-0", i === 2 ? "border-t-2" : "", r.opt ? "" : "text-muted-foreground")}
                      >
                        <td className="px-3 py-2 font-medium text-foreground">{i % 2 === 0 ? r.pack : ""}</td>
                        <td className="px-3 py-2">{r.opt ? "Optimised" : "Non-optimised (actual)"}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{r.start != null ? `${r.start.toFixed(0)}%` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{r.end != null ? `${r.end.toFixed(0)}%` : "—"}</td>
                        <td className={cn("px-3 py-2 text-right font-mono tabular-nums", deltaTone)}>{r.delta != null ? fmtPp(r.delta) : "—"}</td>
                        <td className={cn("px-3 py-2 text-right font-mono tabular-nums", deltaTone)}>{r.delta != null ? fmtKwh(ppToKwh(r.delta, 1)) : "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Energy uses the 280 kWh/pack spec (1 pp ≈ 2.8 kWh per pack). Start is seeded from the
              measured SOC, so non-optimised and optimised diverge over the window.
            </p>
          </div>

          {/* Optimised SOC envelope across the run */}
          <div className="grid grid-cols-3 gap-3">
            <Kpi label="SOC min (optimised)" value={`${k.socMinPct.toFixed(0)}%`} />
            <Kpi label="SOC avg (optimised)" value={`${k.socAvgPct.toFixed(0)}%`} />
            <Kpi label="SOC max (optimised)" value={`${k.socMaxPct.toFixed(0)}%`} />
          </div>
        </div>

        {dispatchPoints.length > 0 ? (
          <DispatchingOverview
            mode="optimized"
            points={dispatchPoints}
            sessions={sessions}
            totals={{
              actualImportKwh: runTotals?.actualImportKwh ?? 0,
              optimizedImportKwh: runTotals?.optimizedImportKwh ?? 0,
              evKwh: runTotals?.evKwh ?? 0,
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

function ComparePanel({
  runs,
  versions,
  compareIds,
  setCompareIds,
}: {
  runs: BacktestRunRow[]
  versions: ModelVersionRow[]
  compareIds: [string, string]
  setCompareIds: (v: [string, string]) => void
}) {
  const a = runs.find((r) => String(r.id) === compareIds[0])
  const b = runs.find((r) => String(r.id) === compareIds[1])
  const versionLabel = (id: number) => versions.find((v) => v.id === id)?.label ?? `#${id}`

  const rows = useMemo(() => {
    if (!a || !b) return []
    const ka = a.kpis as BacktestKpis
    const kb = b.kpis as BacktestKpis
    const fmt = (n: number, d = 2) => n.toFixed(d)
    return [
      { label: "Savings (€)", a: fmt(ka.savingsEur), b: fmt(kb.savingsEur), better: ka.savingsEur >= kb.savingsEur ? "a" : "b" },
      { label: "Savings (%)", a: fmt(ka.savingsPct, 1), b: fmt(kb.savingsPct, 1), better: ka.savingsPct >= kb.savingsPct ? "a" : "b" },
      { label: "Optimized cost (€)", a: fmt(ka.optimizedCostEur), b: fmt(kb.optimizedCostEur), better: ka.optimizedCostEur <= kb.optimizedCostEur ? "a" : "b" },
      { label: "Battery cycles", a: fmt(ka.batteryCycles), b: fmt(kb.batteryCycles), better: "" },
      { label: "Emergency ticks", a: String(ka.emergencyTicks), b: String(kb.emergencyTicks), better: ka.emergencyTicks <= kb.emergencyTicks ? "a" : "b" },
      { label: "Export clamps", a: String(ka.exportViolations), b: String(kb.exportViolations), better: ka.exportViolations <= kb.exportViolations ? "a" : "b" },
    ] as const
  }, [a, b])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <GitCompare className="size-5 text-teal-600" />
          Compare runs (A/B)
        </CardTitle>
        <CardDescription>Pick two stored runs to compare their KPIs side by side.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {[0, 1].map((slot) => (
            <Select
              key={slot}
              value={compareIds[slot]}
              onValueChange={(val) => {
                const next: [string, string] = [...compareIds] as [string, string]
                next[slot] = val
                setCompareIds(next)
              }}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder={slot === 0 ? "Run A" : "Run B"} />
              </SelectTrigger>
              <SelectContent>
                {runs.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    #{r.id} · {versionLabel(r.modelVersionId)} ·{" "}
                    {new Date(r.fromTs).toISOString().slice(5, 10)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
        </div>

        {a && b ? (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Metric</th>
                  <th className="px-3 py-2 text-right font-medium">
                    A · {versionLabel(a.modelVersionId)} #{a.id}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    B · {versionLabel(b.modelVersionId)} #{b.id}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.label} className={cn("border-b last:border-0", i % 2 ? "bg-muted/20" : "")}>
                    <td className="px-3 py-1.5 text-muted-foreground">{row.label}</td>
                    <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", row.better === "a" && "font-semibold text-emerald-600")}>
                      {row.a}
                    </td>
                    <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", row.better === "b" && "font-semibold text-emerald-600")}>
                      {row.b}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">Select two runs to see the comparison.</p>
        )}
      </CardContent>
    </Card>
  )
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string
  value: string
  icon?: typeof TrendingDown
  tone?: "default" | "ok" | "warn"
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        tone === "ok" && "border-emerald-500/30 bg-emerald-500/5",
        tone === "warn" && "border-amber-500/40 bg-amber-500/5",
      )}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon ? <Icon className="size-3" /> : null}
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums",
          tone === "ok" && "text-emerald-600",
          tone === "warn" && "text-amber-600",
        )}
      >
        {value}
      </div>
    </div>
  )
}
