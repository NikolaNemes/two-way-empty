"use client"

import Link from "next/link"
import { useMemo } from "react"
import { ArrowLeft, Battery, ThermometerSun } from "lucide-react"
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
import { BatteryCard } from "@/components/prototype/panel-cards"
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

export function PrototypeTelemetryBatteryDetailScreen({ unitId }: Props) {
  const { simulated, frame } = usePrototypeTelemetryContext()
  const { history } = simulated

  const rows = useMemo(() => {
    if (history.length === 0) return []
    const t0 = history[0].t_s
    return history.map((f) => {
      const b = f.batteries[unitId - 1]
      return {
        t: f.t_s - t0,
        soc: b.soc_pct,
        power_kw: +(b.power_w / 1000).toFixed(2),
        temp_min: b.temp_min_c,
        temp_max: b.temp_max_c,
      }
    })
  }, [history, unitId])

  if (!frame) {
    return <p className="text-muted-foreground text-sm">Initialising telemetry stream…</p>
  }

  const b = frame.batteries[unitId - 1]
  if (!b) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Battery {unitId} not found.
        </CardContent>
      </Card>
    )
  }

  const otherId = unitId === 1 ? 2 : 1

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
            <Battery className="size-5 text-emerald-500" />
            Battery {unitId}
          </h2>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/prototype/telemetry/drill-down/battery/${otherId}`}>
            Battery {otherId} →
          </Link>
        </Button>
      </div>

      {/* Card: full field set */}
      <BatteryCard unit={b} />

      {/* SOC sparkline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            SOC trajectory
            <InfoHint side="bottom">
              <p className="font-medium mb-1">What this shows</p>
              <p>
                <code>soc_pct</code> for this unit over the time the page has
                been open. The dashed reference is the 15 % low-SOC threshold
                that triggers a <code>BATTERY_SOC_LOW</code> warning event.
              </p>
            </InfoHint>
          </CardTitle>
          <CardDescription className="text-xs">
            Now: <span className="font-mono text-foreground">{b.soc_pct.toFixed(1)} %</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Sparkline rows={rows} dataKey="soc" unit="%" color="hsl(142 71% 45%)" yDomain={[0, 100]} reference={15} />
        </CardContent>
      </Card>

      {/* Power sparkline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            Power flow (signed)
            <InfoHint side="bottom">
              <p className="font-medium mb-1">Sign convention</p>
              <p>
                <strong>+</strong> = battery charging (energy in),{" "}
                <strong>−</strong> = battery discharging (energy out). The
                pack&rsquo;s C-rate ceilings are{" "}
                <code>max_charge_w</code> ={" "}
                {(b.max_charge_w / 1000).toFixed(0)} kW and{" "}
                <code>max_discharge_w</code> ={" "}
                {(b.max_discharge_w / 1000).toFixed(0)} kW.
              </p>
            </InfoHint>
          </CardTitle>
          <CardDescription className="text-xs">
            Now: <span className="font-mono text-foreground">{formatKW(b.power_w, { signed: true })}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Sparkline
            rows={rows}
            dataKey="power_kw"
            unit=" kW"
            color="hsl(199 89% 48%)"
            zeroAxis
          />
        </CardContent>
      </Card>

      {/* Temperature spread */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ThermometerSun className="size-4 text-amber-500" />
            Cell temperature spread
            <InfoHint side="bottom">
              <p className="font-medium mb-1">What this shows</p>
              <p>
                Coldest and hottest cell in the pack. A widening spread is the
                first indicator of cell-level imbalance or cooling issues. In
                the prototype the spread stays under 4 K; real packs would
                typically alarm above 6&ndash;8 K.
              </p>
            </InfoHint>
          </CardTitle>
          <CardDescription className="text-xs">
            Now: <span className="font-mono text-foreground">
              {b.temp_min_c.toFixed(1)} … {b.temp_max_c.toFixed(1)} °C
            </span>{" "}
            (Δ {(b.temp_max_c - b.temp_min_c).toFixed(1)} K)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="t" hide />
              <YAxis width={50} unit=" °C" {...chartAxisProps} />
              <Tooltip
                content={<ChartTooltipContent unit=" °C" precision={1} />}
              />
              <Line
                dataKey="temp_min"
                name="min"
                stroke="oklch(0.65 0.13 240)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="temp_max"
                name="max"
                stroke="oklch(0.65 0.18 30)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-5 rounded-full"
                style={{ background: "oklch(0.65 0.13 240)" }}
              />
              min
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-5 rounded-full"
                style={{ background: "oklch(0.65 0.18 30)" }}
              />
              max
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Limits & contactor */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Hardware limits &amp; contactor</CardTitle>
          <CardDescription className="text-xs">
            Static fields that wouldn&rsquo;t plot but matter for diagnosis.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
          <Field label="max_charge_w" value={`${(b.max_charge_w / 1000).toFixed(0)} kW`} />
          <Field label="max_discharge_w" value={`${(b.max_discharge_w / 1000).toFixed(0)} kW`} />
          <Field label="soh_pct" value={`${b.soh_pct.toFixed(1)} %`} />
          <Field
            label="contactor_state"
            value={
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[10px]",
                  b.contactor_state === "closed" &&
                    "border-emerald-500/40 text-emerald-600",
                  b.contactor_state === "open" && "text-muted-foreground",
                  b.contactor_state === "fault" &&
                    "border-red-500/40 text-red-600"
                )}
              >
                {b.contactor_state}
              </Badge>
            }
          />
        </CardContent>
      </Card>
    </>
  )
}

function Sparkline({
  rows,
  dataKey,
  unit,
  color,
  yDomain,
  reference,
  zeroAxis,
}: {
  rows: Array<Record<string, number>>
  dataKey: string
  unit: string
  color: string
  yDomain?: [number, number]
  reference?: number
  zeroAxis?: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid {...chartGridProps} />
        <XAxis dataKey="t" hide />
        <YAxis width={50} domain={yDomain} unit={unit} {...chartAxisProps} />
        <Tooltip content={<ChartTooltipContent unit={unit} precision={1} />} />
        {zeroAxis && (
          <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
        )}
        {reference !== undefined && (
          <ReferenceLine
            y={reference}
            stroke="var(--destructive)"
            strokeDasharray="4 3"
            strokeWidth={1.2}
          />
        )}
        <Line
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <code className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </code>
      <div className="mt-0.5 font-mono tabular-nums">{value}</div>
    </div>
  )
}
