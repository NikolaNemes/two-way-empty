"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Cpu, ShieldCheck, TrendingDown, ListTree } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TelemetryLoader } from "@/components/prototype/telemetry-loader"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { runEngineSimReplay, type EngineSimResult } from "@/app/actions/backtest"
import { useStation } from "@/components/station-context"
import { DispatchingOverview, type DispatchPoint } from "@/components/lab/dispatching-overview"

/**
 * Engine-sim result card for the Backtesting harness.
 *
 * Calls the `runEngineSimReplay` server action, which drives the PRODUCTION
 * decision core (decideDispatch → planHorizon → commandedGridImport) walk-forward
 * over the window in a closed loop: only exogenous inputs (prices, the editable
 * EV demand proxy, baseload, starting SoC) come from history; grid import / SoC /
 * served-EV are computed by the shared BMS physics assuming OUR dispatch drives
 * the post.
 *
 * It reuses the exact same timeline + KPI surface as the Data Analysis card
 * (`DispatchingOverview`, the KPI tiles) so the harness output is visually
 * consistent, and adds an engine command trace — the per-slot audit log of what
 * the live engine would have committed.
 */
export function EngineSimCard({
  from,
  to,
  demandScaleProxy,
}: {
  from: Date
  to: Date
  demandScaleProxy: number
}) {
  const [result, setResult] = useState<EngineSimResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Match the Backtest-Lab UTC-midnight calendar-day convention exactly so the
  // same picked days reproduce identical windows here and in Data Analysis.
  const fromIso = new Date(
    Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()),
  ).toISOString()
  const toIso = new Date(
    Date.UTC(to.getFullYear(), to.getMonth(), to.getDate() + 1),
  ).toISOString()

  // MULTI-LOCATION: the sim replays the sidebar-selected station's frames.
  const { stationId } = useStation()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    runEngineSimReplay({ stationId, fromIso, toIso, demandScaleProxy })
      .then((r) => {
        if (!cancelled) setResult(r)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Engine sim failed")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fromIso, toIso, demandScaleProxy, stationId])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Cpu className="size-5 text-teal-600" />
              Engine simulation
            </CardTitle>
            <CardDescription>
              The production optimizer{result?.versionLabel ? ` (${result.versionLabel})` : ""} driving a
              simulated chargepost walk-forward — grid import, buffer SoC and served EV are computed
              assuming OUR dispatch commands the post (closed loop), not replayed from the BMS.
              {demandScaleProxy !== 1 ? ` EV demand scaled ×${demandScaleProxy}.` : ""}
              {result?.frameSource === "live" ? " Telemetry pulled live from the API for this range." : ""}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {result && !result.empty ? (
              <Badge variant="outline" className="gap-1 border-teal-500/40 text-teal-600">
                {result.frameSource === "live" ? "Live frames" : "Stored frames"}
              </Badge>
            ) : null}
            {result && !result.empty ? (
              result.kpis.exportViolations === 0 ? (
                <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
                  <ShieldCheck className="size-3" /> No-export verified
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="size-3" /> {result.kpis.exportViolations} export clamps
                </Badge>
              )
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <TelemetryLoader
            mode="simulated"
            bare
            title="Running Optimizer Walk-Forward"
            subtitle="Re-deciding every slot over the metered telemetry"
            endpoint="POST runEngineSimReplay"
            footer="Solving the plan over each horizon"
          />
        ) : error ? (
          <div className="py-10 text-center text-sm text-destructive">{error}</div>
        ) : !result || result.empty || result.mpcStatus === "unavailable" ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <AlertTriangle className="size-5 text-amber-500" />
            <p className="text-sm font-medium text-foreground">Engine sim unavailable for this range</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {result?.mpcMessage ??
                "The engine could not run over this window (no telemetry, infeasible plan, or prices not yet published)."}
            </p>
          </div>
        ) : (
          <EngineReport result={result} />
        )}
      </CardContent>
    </Card>
  )
}

function EngineReport({ result }: { result: EngineSimResult }) {
  const k = result.kpis

  // Engine-mode mapping: the primary grid-import area is the COMMANDED grid
  // request (P_grid_request) the kernel actually sends the hardware — gated to 0
  // unless charging the battery from grid ABOVE demand. This is the exact
  // quantity the LIVE worker reports, so the replay is apples-to-apples with
  // live (the raw p.gridKw clearance envelope would otherwise show phantom
  // import while a car is merely being served from grid). We overlay the REAL
  // metered grid import (p.actualGridKw) as a dashed comparison line so the
  // replay can be checked against what the site actually did — they coincide
  // when the deployed kernel matches this version. SOC curves are the engine's
  // forward-simulated buffer state.
  const dispatchPoints: DispatchPoint[] = result.series.map((p) => ({
    ts: p.ts,
    hour: p.hour ?? 0,
    priceEurMwh: p.priceEurMwh,
    // Plot the engine's REALIZED physical grid draw (what actually flows from the
    // grid through the meter), NOT the gated battery-charging command. The gated
    // command (commandedGridKw = max(0, clearance − demand)) is 0 whenever the
    // grid is maxed serving the car directly, which made the line read 0 kW even
    // while the engine was importing ~80 kW at the cap. gridKw is apples-to-apples
    // with the dashed metered-import line.
    actualImportKw: p.gridKw ?? null,
    meteredImportKw: p.actualGridKw ?? null,
    evKw: p.evKw ?? 0,
    evRequestedKw: p.evRequestedKw ?? p.evKw ?? null,
    evServedKw: p.evServedKw ?? null,
    siteGridLimitKw: p.siteGridLimitKw ?? null,
    b1SocPct: p.b1SocPct ?? p.socPct ?? null,
    b2SocPct: p.b2SocPct ?? p.socPct ?? null,
    actualB1SocPct: p.actualB1SocPct ?? null,
    actualB2SocPct: p.actualB2SocPct ?? null,
    g1Kw: p.g1Kw ?? null,
    g2Kw: p.g2Kw ?? null,
    b1Kw: p.b1Kw ?? null,
    b2Kw: p.b2Kw ?? null,
    ev1Kw: p.ev1Kw ?? null,
    ev2Kw: p.ev2Kw ?? null,
    mEv1Kw: p.mEv1Kw ?? null,
    mEv2Kw: p.mEv2Kw ?? null,
    mEv1Kwh: p.mEv1Kwh ?? null,
    mEv2Kwh: p.mEv2Kwh ?? null,
    sEv1Kwh: p.sEv1Kwh ?? null,
    sEv2Kwh: p.sEv2Kwh ?? null,
  }))

  const trace = result.commandTrace ?? []
  const fallbacks = trace.filter((t) => !t.mpcOk).length

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Grid import" value={`${(result.totals.optimizedImportKwh ?? 0).toFixed(1)} kWh`} />
        <Kpi label="Grid cost" value={`€${k.optimizedCostEur.toFixed(2)}`} />
        {/* Simulation serves the SITE LOAD (EV + ChargePost AUX) — the kernel demand signal, not metered EV. */}
        <Kpi label="Site load served" value={`${result.totals.evKwh.toFixed(1)} kWh`} />
        <Kpi
          label="EV unserved"
          value={`${(result.totals.evUnservedKwh ?? 0).toFixed(1)} kWh`}
          tone={(result.totals.evUnservedKwh ?? 0) > 0.1 ? "warn" : "ok"}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="SoC range" value={`${k.socMinPct.toFixed(0)}���${k.socMaxPct.toFixed(0)}%`} />
        <Kpi label="Batt cycles" value={`${k.batteryCycles.toFixed(2)}`} />
        <Kpi
          label="Plan solves"
          value={`${trace.length - fallbacks}/${trace.length}`}
          tone={fallbacks === 0 ? "ok" : "warn"}
          hint={fallbacks > 0 ? `${fallbacks} safe fallbacks` : undefined}
        />
        <Kpi label="Frames" value={`${k.frames.toLocaleString()}`} />
      </div>

      {dispatchPoints.length > 0 ? (
        <DispatchingOverview
          mode="engine"
          points={dispatchPoints}
          sessions={result.sessions}
          totals={result.totals}
        />
      ) : null}

      {trace.length > 0 ? <CommandTrace trace={trace} /> : null}

      <p className="text-xs text-muted-foreground">
        {k.frames.toLocaleString()} frames · {k.durationHours.toFixed(1)}h · {trace.length} committed
        decisions · demand ×{result.demandScaleProxy}
      </p>
    </div>
  )
}

/**
 * Per-slot engine command trace — the audit log of exactly what the live engine
 * would have committed each replanned slot (clearance, reserve floor, SoC
 * ceiling, the signed grid setpoint, and whether the optimizer solved or fell back).
 * Collapsed by default; this is the "why did it dispatch that?" panel.
 */
function CommandTrace({ trace }: { trace: EngineSimResult["commandTrace"] }) {
  const rows = trace ?? []
  return (
    <Collapsible className="rounded-lg border bg-muted/20">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-2.5 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ListTree className="size-4 text-teal-600" />
          Engine command trace
        </span>
        <span className="text-xs text-muted-foreground">{rows.length} slots · click to expand</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-96 overflow-auto border-t">
          <table className="w-full text-xs tabular-nums">
            <thead className="sticky top-0 bg-muted/80 text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Time</th>
                <th className="px-3 py-2 text-right font-medium">Price €/MWh</th>
                <th className="px-3 py-2 text-right font-medium">SoC %</th>
                <th className="px-3 py-2 text-right font-medium">Demand kW</th>
                <th className="px-3 py-2 text-right font-medium">Clearance kW</th>
                <th className="px-3 py-2 text-right font-medium">Command kW</th>
                <th className="px-3 py-2 text-right font-medium">Reserve %</th>
                <th className="px-3 py-2 text-right font-medium">Ceiling %</th>
                <th className="px-3 py-2 text-center font-medium">Optimizer</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.ts} className={r.mpcOk ? "" : "bg-amber-500/5"}>
                  <td className="px-3 py-1.5 text-left text-muted-foreground">
                    {new Date(r.ts).toLocaleString("en-GB", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "UTC",
                    })}
                  </td>
                  <td className="px-3 py-1.5 text-right">{r.priceEurMwh != null ? r.priceEurMwh.toFixed(1) : "—"}</td>
                  <td className="px-3 py-1.5 text-right">{r.socPct.toFixed(0)}</td>
                  <td className="px-3 py-1.5 text-right">{r.demandKw.toFixed(1)}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{r.clearanceKw.toFixed(1)}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-teal-700">
                    {r.commandKw != null ? r.commandKw.toFixed(1) : "0.0"}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{r.reserveFloorPct.toFixed(0)}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{r.socCeilingPct.toFixed(0)}</td>
                  <td className="px-3 py-1.5 text-center">
                    {r.mpcOk ? (
                      <span className="text-emerald-600">ok</span>
                    ) : (
                      <span className="text-amber-600" title={r.solveStatus}>
                        fallback
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Kpi({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string
  value: string
  tone?: "default" | "ok" | "warn"
  hint?: string
}) {
  const toneClass =
    tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-foreground"
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div> : null}
    </div>
  )
}
