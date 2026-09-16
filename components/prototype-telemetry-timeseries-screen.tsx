"use client"

import { useMemo } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ArrowDownRight, ArrowUpRight, BatteryCharging, Gauge, LineChart as LineChartIcon, Zap } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import { SiteContextHeader } from "@/components/prototype/site-context-header"
import { InfoHint } from "@/components/prototype/info-hint"
import {
  ChartTooltipContent,
  chartAxisProps,
  chartGridProps,
} from "@/components/prototype/chart-tooltip"
import { formatKW, type TelemetryFrame } from "@/lib/prototype-telemetry"
import { cn } from "@/lib/utils"

// ----------------------------------------------------------------------------
// Data shaping
// ----------------------------------------------------------------------------

interface ChartRow {
  t: number
  ts: string
  P_grid_kw: number
  P_battery_total_kw: number
  P_ev_total_kw: number
  P_aux_kw: number
  soc_b1: number
  soc_b2: number
  soc_ev1: number
  soc_ev2: number
  epex: number
}

function buildRows(history: TelemetryFrame[]): ChartRow[] {
  if (history.length === 0) return []
  const t0 = history[0].t_s
  return history.map((f) => ({
    t: f.t_s - t0,
    ts: f.ts.split("T")[1].slice(0, 8),
    P_grid_kw: +(f.grid.P_grid_w / 1000).toFixed(2),
    P_battery_total_kw: +(
      (f.batteries[0].power_w + f.batteries[1].power_w) /
      1000
    ).toFixed(2),
    P_ev_total_kw: +(
      (f.chargers[0].P_EV_w + f.chargers[1].P_EV_w) /
      1000
    ).toFixed(2),
    P_aux_kw: +(f.grid.P_aux_w / 1000).toFixed(2),
    soc_b1: f.batteries[0].soc_pct,
    soc_b2: f.batteries[1].soc_pct,
    soc_ev1:
      f.chargers[0].plug_state === "Plugged"
        ? f.chargers[0].soc_EV_pct
        : Number.NaN,
    soc_ev2:
      f.chargers[1].plug_state === "Plugged"
        ? f.chargers[1].soc_EV_pct
        : Number.NaN,
    epex: f.market.epex_price_eur_mwh,
  }))
}

function fmtT(t: number): string {
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

// ----------------------------------------------------------------------------
// Palette  (chart colours mapped to globals.css tokens where possible,
// hand-picked otherwise so the four series remain colour-blind-distinct.)
// ----------------------------------------------------------------------------

const POWER_COLORS = {
  grid: "var(--chart-2)", // blue
  battery: "var(--chart-3)", // green
  ev: "var(--chart-1)", // primary orange
  aux: "var(--muted-foreground)",
  envelope: "var(--destructive)",
}

const SOC_COLORS = {
  b1: "var(--chart-3)",
  b2: "oklch(0.55 0.10 145)",
  ev1: "var(--chart-1)",
  ev2: "var(--chart-4)",
}

// ----------------------------------------------------------------------------
// Screen
// ----------------------------------------------------------------------------

export function PrototypeTelemetryTimeseriesScreen() {
  const { simulated, frame } = usePrototypeTelemetryContext()
  const { history } = simulated
  const rows = useMemo(() => buildRows(history), [history])

  if (rows.length < 2 || !frame) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Building up history… let the simulation run for a few seconds.
        </CardContent>
      </Card>
    )
  }

  const lastT = rows[rows.length - 1].t
  const last = rows[rows.length - 1]
  const envelopeKw = frame.station.P_grid_consumption_limit_w / 1000

  return (
    <div className="flex flex-col gap-6">
      {/* ---------- Site identity strip ---------- */}
      <SiteContextHeader frame={frame} />

      {/* ---------- Page-level introduction ---------- */}
      <PageIntro
        framesCount={rows.length}
        windowText={fmtT(lastT)}
        envelopeKw={envelopeKw}
      />

      {/* ---------- Chart 1: Power flows ---------- */}
      <PowerFlowsChart rows={rows} envelopeKw={envelopeKw} last={last} />

      {/* ---------- Chart 2: SOC ---------- */}
      <SocChart rows={rows} last={last} frame={frame} />

      {/* ---------- Chart 3: EPEX ---------- */}
      <EpexChart rows={rows} last={last} frame={frame} />
    </div>
  )
}

// ----------------------------------------------------------------------------
// Page intro
// ----------------------------------------------------------------------------

function PageIntro({
  framesCount,
  windowText,
  envelopeKw,
}: {
  framesCount: number
  windowText: string
  envelopeKw: number
}) {
  return (
    <Card className="border-border/60 bg-gradient-to-b from-card to-muted/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <LineChartIcon className="size-5 text-primary" />
          Time-series view
        </CardTitle>
        <CardDescription className="text-pretty leading-relaxed">
          A rolling history of every telemetry frame received during this
          session — three coordinated charts let you see <em>why</em> the
          live snapshot looks the way it does, and how the controller
          balances grid, batteries and EVs over time.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-xs leading-relaxed text-muted-foreground sm:grid-cols-3">
        <IntroBlock
          icon={<Zap className="size-3.5" />}
          title="Purpose"
          body={
            <>
              Validate that the site is honouring its{" "}
              <span className="text-foreground">
                {envelopeKw} kW grid envelope
              </span>{" "}
              while still serving EV demand, and that battery dispatch lines
              up with EPEX price moves.
            </>
          }
        />
        <IntroBlock
          icon={<BatteryCharging className="size-3.5" />}
          title="How to use it"
          body={
            <>
              Pause the stream in the page header to freeze every chart for a
              shared <span className="text-foreground">t-cursor</span>{" "}
              reading. Switch the scenario to make a car arrive or leave —
              you&rsquo;ll see all three charts react together.
            </>
          }
        />
        <IntroBlock
          icon={<Gauge className="size-3.5" />}
          title="Window"
          body={
            <>
              Last <span className="font-mono text-foreground">{framesCount}</span>{" "}
              frames covering{" "}
              <span className="font-mono text-foreground">{windowText}</span>{" "}
              of wall-clock at 1 Hz. The buffer caps at 10 minutes; older
              frames roll off the left edge.
            </>
          }
        />
      </CardContent>
    </Card>
  )
}

function IntroBlock({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-border/50 bg-background/40 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <p className="text-pretty">{body}</p>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Chart 1 - Power flows
// ----------------------------------------------------------------------------

function PowerFlowsChart({
  rows,
  envelopeKw,
  last,
}: {
  rows: ChartRow[]
  envelopeKw: number
  last: ChartRow
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              Power flows at the PCC
              <InfoHint side="bottom">
                <p className="font-medium mb-1">What this shows</p>
                <p>
                  Three signed power signals on a shared kW axis: grid
                  exchange, total stationary battery throughput and total
                  delivery to vehicles. Sum-of-three ≡ aux load (a few kW
                  baseline) by Kirchhoff at the point of common coupling.
                </p>
              </InfoHint>
            </CardTitle>
            <CardDescription className="mt-1 text-xs leading-snug text-pretty">
              Sign convention: <span className="text-foreground">+</span> =
              power flowing <em>into</em> the site / battery / EV.
            </CardDescription>
          </div>
          <SeriesNowPills
            items={[
              {
                color: POWER_COLORS.grid,
                label: "P_grid",
                value: last.P_grid_kw,
                unit: "kW",
                trend: last.P_grid_kw > 0.5 ? "import" : last.P_grid_kw < -0.5 ? "export" : null,
              },
              {
                color: POWER_COLORS.battery,
                label: "P_battery",
                value: last.P_battery_total_kw,
                unit: "kW",
                trend:
                  last.P_battery_total_kw > 0.5
                    ? "charge"
                    : last.P_battery_total_kw < -0.5
                      ? "discharge"
                      : null,
              },
              {
                color: POWER_COLORS.ev,
                label: "P_EV",
                value: last.P_ev_total_kw,
                unit: "kW",
                trend: last.P_ev_total_kw > 0.5 ? "delivery" : null,
              },
            ]}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart
            data={rows}
            margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
          >
            <CartesianGrid {...chartGridProps} />
            <XAxis dataKey="t" tickFormatter={fmtT} {...chartAxisProps} />
            <YAxis unit=" kW" width={60} {...chartAxisProps} />
            <Tooltip
              content={
                <ChartTooltipContent
                  unit=" kW"
                  precision={1}
                  labelFormatter={(t) => `t = ${fmtT(Number(t))}`}
                />
              }
            />
            <ReferenceLine
              y={envelopeKw}
              stroke={POWER_COLORS.envelope}
              strokeDasharray="4 3"
              strokeWidth={1.2}
              label={{
                value: `Envelope ${envelopeKw} kW`,
                fontSize: 10,
                fill: "var(--destructive)",
                position: "right",
              }}
            />
            <ReferenceLine y={0} stroke="var(--border)" />
            <Line
              type="monotone"
              dataKey="P_grid_kw"
              name="P_grid"
              stroke={POWER_COLORS.grid}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="P_battery_total_kw"
              name="P_battery_total"
              stroke={POWER_COLORS.battery}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="P_ev_total_kw"
              name="P_EV_total"
              stroke={POWER_COLORS.ev}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>

        <ChartLegend
          items={[
            { color: POWER_COLORS.grid, label: "P_grid" },
            { color: POWER_COLORS.battery, label: "P_battery_total" },
            { color: POWER_COLORS.ev, label: "P_EV_total" },
            { color: POWER_COLORS.envelope, label: "Grid envelope", dashed: true },
          ]}
        />

        <NarrativeStack
          purpose="Verify that the site is using the battery as a buffer between EV demand and the constrained grid feeder. The grid trace should never crest the dashed envelope line."
          how={[
            "Watch the orange P_EV trace — its peak is your peak-shave target.",
            "Compare it to the green battery trace — when battery flips negative it's contributing to the EV load.",
            "Read the blue grid trace under both — that's how much of the demand the utility is actually serving.",
          ]}
          watchFor={[
            "P_grid pinning the envelope: site is curtailment-limited.",
            "Battery plateau at ±220 kW (2 × 110 kW): pack hardware-limited.",
            "Brief grid spikes when an EV plugs in before the battery has ramped.",
          ]}
        />
      </CardContent>
    </Card>
  )
}

// ----------------------------------------------------------------------------
// Chart 2 - SOC
// ----------------------------------------------------------------------------

function SocChart({
  rows,
  last,
  frame,
}: {
  rows: ChartRow[]
  last: ChartRow
  frame: TelemetryFrame
}) {
  const ev1Plugged = frame.chargers[0].plug_state === "Plugged"
  const ev2Plugged = frame.chargers[1].plug_state === "Plugged"

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              State of charge
              <InfoHint side="bottom">
                <p className="font-medium mb-1">What this shows</p>
                <p>
                  Continuous SOC for both stationary battery units (solid)
                  and the two vehicle packs (dashed; rendered only while
                  plugged — gaps are <code>plug_state = Unplugged</code>).
                </p>
              </InfoHint>
            </CardTitle>
            <CardDescription className="mt-1 text-xs leading-snug text-pretty">
              Stationary packs (solid) vs vehicles (dashed). Y axis clamped
              0&ndash;100 %.
            </CardDescription>
          </div>
          <SeriesNowPills
            items={[
              {
                color: SOC_COLORS.b1,
                label: "Battery 1",
                value: last.soc_b1,
                unit: "%",
              },
              {
                color: SOC_COLORS.b2,
                label: "Battery 2",
                value: last.soc_b2,
                unit: "%",
              },
              ev1Plugged
                ? {
                    color: SOC_COLORS.ev1,
                    label: "EV 1",
                    value: last.soc_ev1,
                    unit: "%",
                  }
                : null,
              ev2Plugged
                ? {
                    color: SOC_COLORS.ev2,
                    label: "EV 2",
                    value: last.soc_ev2,
                    unit: "%",
                  }
                : null,
            ].filter(Boolean) as Array<{
              color: string
              label: string
              value: number
              unit: string
            }>}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart
            data={rows}
            margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
          >
            <CartesianGrid {...chartGridProps} />
            <XAxis dataKey="t" tickFormatter={fmtT} {...chartAxisProps} />
            <YAxis domain={[0, 100]} unit=" %" width={50} {...chartAxisProps} />
            <Tooltip
              content={
                <ChartTooltipContent
                  unit=" %"
                  precision={1}
                  labelFormatter={(t) => `t = ${fmtT(Number(t))}`}
                />
              }
            />
            <ReferenceLine
              y={18}
              stroke="var(--destructive)"
              strokeDasharray="2 4"
              strokeOpacity={0.5}
              label={{
                value: "Discharge floor 18 %",
                fontSize: 9,
                fill: "var(--destructive)",
                position: "right",
              }}
            />
            <Line
              dataKey="soc_b1"
              name="Battery 1"
              stroke={SOC_COLORS.b1}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="soc_b2"
              name="Battery 2"
              stroke={SOC_COLORS.b2}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="soc_ev1"
              name="EV 1"
              stroke={SOC_COLORS.ev1}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="soc_ev2"
              name="EV 2"
              stroke={SOC_COLORS.ev2}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>

        <ChartLegend
          items={[
            { color: SOC_COLORS.b1, label: "Battery 1" },
            { color: SOC_COLORS.b2, label: "Battery 2" },
            { color: SOC_COLORS.ev1, label: "EV 1 (plugged)", dashed: true },
            { color: SOC_COLORS.ev2, label: "EV 2 (plugged)", dashed: true },
          ]}
        />

        <NarrativeStack
          purpose="Confirm the dispatch logic is keeping enough headroom in the stationary pack to cover the next charging session, and that the charge curve into each EV looks healthy."
          how={[
            "Solid traces show energy stored at the site — falling = discharging into EV / aux.",
            "Dashed traces show the EV pack filling up — slope flattens above 60 % as the BMS tapers.",
            "When a session ends the dashed trace disappears (gap), and the solid traces should start recovering.",
          ]}
          watchFor={[
            "A solid trace nearing the dashed 18 % floor: site can no longer help the next car.",
            "Both stationary traces drifting in lock-step: load split is balanced.",
            "EV trace flattening abruptly: hardware limit hit (P_cp_max or vehicle BMS).",
          ]}
        />
      </CardContent>
    </Card>
  )
}

// ----------------------------------------------------------------------------
// Chart 3 - EPEX
// ----------------------------------------------------------------------------

function EpexChart({
  rows,
  last,
  frame,
}: {
  rows: ChartRow[]
  last: ChartRow
  frame: TelemetryFrame
}) {
  const trend = last.epex - rows[Math.max(0, rows.length - 31)].epex
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              EPEX day-ahead spot
              <InfoHint side="bottom">
                <p className="font-medium mb-1">What this shows</p>
                <p>
                  The clearing price for the current 15-minute settlement
                  slot, in &euro;/MWh. Drives every arbitrage decision — at
                  slot rollover the controller re-evaluates whether to
                  charge, hold or discharge the battery.
                </p>
              </InfoHint>
            </CardTitle>
            <CardDescription className="mt-1 text-xs leading-snug text-pretty">
              Slot{" "}
              <span className="font-mono text-foreground">
                {frame.market.slot_label}
              </span>
              {" \u00b7 "} Streamed at 1 Hz; in production this updates only
              at 15-min boundaries from the Config API.
            </CardDescription>
          </div>
          <SeriesNowPills
            items={[
              {
                color: "var(--primary)",
                label: "EPEX",
                value: last.epex,
                unit: "€/MWh",
                trend: trend > 1 ? "rising" : trend < -1 ? "falling" : null,
              },
            ]}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart
            data={rows}
            margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
          >
            <defs>
              <linearGradient id="epex-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid {...chartGridProps} />
            <XAxis dataKey="t" tickFormatter={fmtT} {...chartAxisProps} />
            <YAxis width={50} {...chartAxisProps} />
            <Tooltip
              content={
                <ChartTooltipContent
                  precision={1}
                  unit=" €/MWh"
                  labelFormatter={(t) => `t = ${fmtT(Number(t))}`}
                />
              }
            />
            <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
            <Area
              dataKey="epex"
              name="EPEX"
              stroke="var(--primary)"
              fill="url(#epex-fill)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>

        <NarrativeStack
          purpose="Provide the price signal the controller uses for stationary arbitrage. When prices spike, the battery should be discharging; when they dip, it should be charging if SOC permits."
          how={[
            "Each step you can see is a new 15-min slot clearing in production; the ticker in the header reflects the active slot.",
            "Compare against the SOC chart above — battery direction should track price valleys / peaks.",
          ]}
          watchFor={[
            "Sustained high prices (> 110 €/MWh): expect discharge bias.",
            "Sustained low prices (< 70 €/MWh): expect charge-from-grid bias.",
            "Negative prices: rare, would trigger forced charging if hit.",
          ]}
        />
      </CardContent>
    </Card>
  )
}

// ----------------------------------------------------------------------------
// Shared building blocks
// ----------------------------------------------------------------------------

function ChartLegend({
  items,
}: {
  items: Array<{ color: string; label: string; dashed?: boolean }>
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              "inline-block h-[3px] w-5 rounded-full",
              it.dashed && "border-t-2 border-dashed bg-transparent",
            )}
            style={
              it.dashed
                ? { borderColor: it.color, height: 0 }
                : { background: it.color }
            }
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}

interface SeriesPill {
  color: string
  label: string
  value: number | null | undefined
  unit?: string
  trend?: "import" | "export" | "charge" | "discharge" | "delivery" | "rising" | "falling" | null
}

function SeriesNowPills({ items }: { items: SeriesPill[] }) {
  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      {items.map((it) => (
        <div
          key={it.label}
          className="flex flex-col rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 leading-tight"
        >
          <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <span
              aria-hidden
              className="inline-block size-2 rounded-[2px]"
              style={{ background: it.color }}
            />
            {it.label}
          </span>
          <span className="font-mono text-sm tabular-nums text-foreground">
            {typeof it.value === "number" && Number.isFinite(it.value)
              ? `${it.unit === "kW" ? formatKW(it.value * 1000, { signed: true }) : `${it.value.toFixed(1)} ${it.unit ?? ""}`}`
              : "—"}
            {it.trend ? (
              <TrendIcon trend={it.trend} />
            ) : null}
          </span>
        </div>
      ))}
    </div>
  )
}

function TrendIcon({ trend }: { trend: NonNullable<SeriesPill["trend"]> }) {
  const iconCls = "ml-1 inline size-3 align-text-top"
  switch (trend) {
    case "import":
    case "charge":
    case "delivery":
    case "rising":
      return <ArrowUpRight className={cn(iconCls, "text-emerald-500")} />
    case "export":
    case "discharge":
    case "falling":
      return <ArrowDownRight className={cn(iconCls, "text-amber-500")} />
    default:
      return null
  }
}

function NarrativeStack({
  purpose,
  how,
  watchFor,
}: {
  purpose: string
  how: string[]
  watchFor: string[]
}) {
  return (
    <div className="grid gap-3 rounded-md border border-border/50 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground sm:grid-cols-3">
      <NarrativeBlock title="Purpose">{purpose}</NarrativeBlock>
      <NarrativeBlock title="How to read it">
        <ul className="list-disc space-y-0.5 pl-4 marker:text-muted-foreground/40">
          {how.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      </NarrativeBlock>
      <NarrativeBlock title="Watch for">
        <ul className="list-disc space-y-0.5 pl-4 marker:text-muted-foreground/40">
          {watchFor.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </NarrativeBlock>
    </div>
  )
}

function NarrativeBlock({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground">
        {title}
      </div>
      <div className="text-pretty">{children}</div>
    </div>
  )
}
