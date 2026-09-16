"use client"

import Link from "next/link"
import { useMemo } from "react"
import { ArrowLeft, PlugZap } from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import { ChargerCard } from "@/components/prototype/panel-cards"
import { InfoHint } from "@/components/prototype/info-hint"
import {
  ChartTooltipContent,
  chartAxisProps,
  chartGridProps,
} from "@/components/prototype/chart-tooltip"
import { cn } from "@/lib/utils"
import { formatKW } from "@/lib/prototype-telemetry"

interface Props {
  unitId: 1 | 2
}

export function PrototypeTelemetryConnectorDetailScreen({ unitId }: Props) {
  const { simulated, frame } = usePrototypeTelemetryContext()
  const { history } = simulated

  const rows = useMemo(() => {
    if (history.length === 0) return []
    const t0 = history[0].t_s
    return history.map((f) => {
      const c = f.chargers[unitId - 1]
      return {
        t: f.t_s - t0,
        power_kw: +(c.P_EV_w / 1000).toFixed(2),
        soc_ev: c.plug_state === "Plugged" ? c.soc_EV_pct : Number.NaN,
        cap_kw: c.P_cp_max_w / 1000,
        max_kw: c.P_EV_max_w / 1000,
        plug: c.plug_state === "Plugged" ? 1 : 0,
      }
    })
  }, [history, unitId])

  if (!frame) {
    return <p className="text-muted-foreground text-sm">Initialising telemetry stream…</p>
  }
  const c = frame.chargers[unitId - 1]
  if (!c) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Connector {unitId} not found.
        </CardContent>
      </Card>
    )
  }

  const otherId = unitId === 1 ? 2 : 1
  const isPlugged = c.plug_state === "Plugged"

  // Compute plug-state transitions from history for the timeline strip
  const transitions = useMemo(() => {
    const out: Array<{ t: number; to: "Plugged" | "Unplugged" }> = []
    let prev: 0 | 1 | null = null
    for (const f of history) {
      const cur = f.chargers[unitId - 1].plug_state === "Plugged" ? 1 : 0
      if (prev !== null && cur !== prev) {
        out.push({
          t: f.t_s - history[0].t_s,
          to: cur === 1 ? "Plugged" : "Unplugged",
        })
      }
      prev = cur
    }
    return out
  }, [history, unitId])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link href="/prototype/telemetry/drill-down">
              <ArrowLeft className="size-4" />
              All assets
            </Link>
          </Button>
          <span className="text-muted-foreground text-xs">/</span>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <PlugZap className="size-5 text-primary" />
            Connector {unitId}
          </h2>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/prototype/telemetry/drill-down/connector/${otherId}`}>
            Connector {otherId} →
          </Link>
        </Button>
      </div>

      {/* Card: full field set */}
      <ChargerCard unit={c} />

      {/* Power sparkline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            Delivery power
            <InfoHint side="bottom">
              <p className="font-medium mb-1">What this shows</p>
              <p>
                <code>P_EV_w</code> across the page&rsquo;s history. The
                upper red dashed line is the charge-post hardware ceiling{" "}
                <code>P_cp_max_w</code>; the lower amber dashed line is{" "}
                <code>P_EV_max_w</code>, the per-session ceiling negotiated
                with the vehicle. Power should never cross either.
              </p>
            </InfoHint>
          </CardTitle>
          <CardDescription className="text-xs">
            Now: <span className="font-mono text-foreground">{formatKW(c.P_EV_w)}</span>
            {" · "}
            Cap{" "}
            <span className="font-mono text-foreground">
              {(c.P_cp_max_w / 1000).toFixed(0)} kW
            </span>
            {" · "}
            Session limit{" "}
            <span className="font-mono text-foreground">
              {(c.P_EV_max_w / 1000).toFixed(0)} kW
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="t" hide />
              <YAxis width={50} unit=" kW" {...chartAxisProps} />
              <Tooltip
                content={<ChartTooltipContent unit=" kW" precision={1} />}
              />
              <ReferenceLine
                y={c.P_cp_max_w / 1000}
                stroke="var(--destructive)"
                strokeDasharray="4 3"
                strokeWidth={1.2}
                label={{
                  value: "P_cp,max",
                  fontSize: 10,
                  position: "right",
                  fill: "var(--destructive)",
                }}
              />
              <ReferenceLine
                y={c.P_EV_max_w / 1000}
                stroke="oklch(0.7 0.15 75)"
                strokeDasharray="4 3"
                strokeWidth={1.2}
                label={{
                  value: "P_EV,max",
                  fontSize: 10,
                  position: "right",
                  fill: "oklch(0.7 0.15 75)",
                }}
              />
              <Line
                dataKey="power_kw"
                name="P_EV"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* EV SOC sparkline (only if currently plugged or has been) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            EV state of charge
            <InfoHint side="bottom">
              <p className="font-medium mb-1">What this shows</p>
              <p>
                <code>soc_EV_pct</code>, only meaningful while the connector is
                in <code>plug_state = Plugged</code>. Gaps in the trace
                indicate the connector being free, e.g. a plug-out event.
              </p>
            </InfoHint>
          </CardTitle>
          <CardDescription className="text-xs">
            Now:{" "}
            <span className="font-mono text-foreground">
              {isPlugged ? `${c.soc_EV_pct.toFixed(1)} %` : "no vehicle"}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="t" hide />
              <YAxis width={50} domain={[0, 100]} unit=" %" {...chartAxisProps} />
              <Tooltip
                content={<ChartTooltipContent unit=" %" precision={1} />}
              />
              <Line
                dataKey="soc_ev"
                stroke="hsl(173 58% 39%)"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Plug-state transitions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            Plug-state transitions
            <InfoHint side="bottom">
              <p className="font-medium mb-1">What this shows</p>
              <p>
                Every change in <code>plug_state</code> for this connector
                during the page&rsquo;s lifetime, oldest first. In a real
                deployment these are the events Enexa watches in the
                telemetry diff to fire its out-of-cycle re-solve.
              </p>
            </InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {transitions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No transitions yet &mdash; flip the scenario in the header to
              trigger a plug-in or plug-out.
            </p>
          ) : (
            <ul className="space-y-1.5 font-mono text-xs">
              {transitions.map((tr, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="text-muted-foreground tabular-nums w-12 text-right">
                    {`${Math.floor(tr.t / 60)}:${(tr.t % 60).toString().padStart(2, "0")}`}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[10px]",
                      tr.to === "Plugged"
                        ? "border-emerald-500/40 text-emerald-600"
                        : "text-muted-foreground"
                    )}
                  >
                    → {tr.to}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}
