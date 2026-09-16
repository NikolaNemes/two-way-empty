"use client"

import { useMemo, useState } from "react"
import { format, startOfMonth, subDays, subMonths } from "date-fns"
import type { DateRange } from "react-day-picker"
import { ArrowLeft, CalendarRange, Cpu, Play, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Calendar } from "@/components/ui/calendar"
import { Slider } from "@/components/ui/slider"
import { EngineSimCard } from "@/components/prototype/engine-sim-card"

/**
 * Backtesting — a closed-loop, walk-forward TEST HARNESS for the production
 * dispatch logic.
 *
 * Unlike Data Analysis (which contrasts the metered reality against the LP
 * counterfactual), this screen drives the PRODUCTION engine decision core
 * (decideDispatch → planHorizon → commandedGridImport) over a historical window
 * in a closed loop. Only the exogenous inputs come from history — prices, an
 * EDITABLE EV-demand proxy, baseload, and the starting SoC. Grid import, buffer
 * SoC and served EV are then computed by the shared BMS physics, as if our
 * dispatch were the one commanding the chargepost.
 *
 * Flow: configure (range + demand lever) → report (reused timeline + KPIs +
 * the engine command trace). Nothing is persisted — this is a test surface.
 */

type ScreenState =
  | { kind: "configure" }
  | { kind: "report"; from: Date; to: Date; demandScaleProxy: number }

const PRESETS = [
  { label: "Yesterday", daysBack: 1 },
  { label: "Last 2 days", daysBack: 2 },
  { label: "Last 7 days", daysBack: 7 },
  { label: "Last 14 days", daysBack: 14 },
]

function getInitialRange(): DateRange {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = subDays(today, 1)
  return { from: yesterday, to: yesterday }
}

export default function DispatchingReplayPage() {
  const [state, setState] = useState<ScreenState>({ kind: "configure" })
  const initial = useMemo(() => getInitialRange(), [])

  if (state.kind === "configure") {
    return (
      <div className="w-full px-4 py-6 lg:px-6">
        <PageIntro />
        <BacktestIntake
          initialRange={initial}
          onRun={({ from, to, demandScaleProxy }) =>
            setState({ kind: "report", from, to, demandScaleProxy })
          }
        />
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-6 lg:px-6">
      <ReportHeader
        from={state.from}
        to={state.to}
        demandScaleProxy={state.demandScaleProxy}
        onEditRange={() => setState({ kind: "configure" })}
      />
      <EngineSimCard from={state.from} to={state.to} demandScaleProxy={state.demandScaleProxy} />
    </div>
  )
}

function PageIntro() {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-teal-500/10">
        <Cpu className="size-5 text-teal-600" />
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Dispatching Replay</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Replay the production dispatch engine walk-forward over historical telemetry. The
          simulator feeds the engine only exogenous inputs — prices, EV demand and starting buffer
          state — then computes grid import and served EV assuming our dispatch is driving the
          chargepost. Use it to see how the live logic behaves before it runs in production.
        </p>
      </div>
    </div>
  )
}

function BacktestIntake({
  initialRange,
  onRun,
}: {
  initialRange: DateRange
  onRun: (v: { from: Date; to: Date; demandScaleProxy: number }) => void
}) {
  const [draft, setDraft] = useState<DateRange | undefined>(initialRange)
  const [visibleMonth, setVisibleMonth] = useState<Date>(() =>
    startOfMonth(subMonths(new Date(), 1)),
  )
  // Editable EV-demand lever (×0 … ×3 of the reconstructed historical proxy).
  const [demandPct, setDemandPct] = useState<number>(100)

  const applyPreset = (daysBack: number) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    setDraft({ from: subDays(today, daysBack), to: subDays(today, 1) })
  }

  const dayCount =
    draft?.from && draft?.to
      ? Math.max(1, Math.round((draft.to.getTime() - draft.from.getTime()) / 86_400_000) + 1)
      : 0

  const handleRun = () => {
    if (!draft?.from) return
    onRun({
      from: draft.from,
      to: draft.to ?? draft.from,
      demandScaleProxy: demandPct / 100,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="size-5 text-primary" />
          Configure simulation run
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="lg:w-44 lg:shrink-0">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Quick ranges
            </div>
            <div className="flex flex-col gap-1">
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  variant="ghost"
                  size="sm"
                  className="h-auto justify-start px-2 py-2 text-left"
                  onClick={() => applyPreset(p.daysBack)}
                >
                  <span className="text-xs font-medium">{p.label}</span>
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium tabular-nums">
                {draft?.from ? format(draft.from, "MMM d, yyyy") : "—"}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="font-medium tabular-nums">
                {draft?.to ? format(draft.to, "MMM d, yyyy") : draft?.from ? "pick end date" : "—"}
              </span>
              {dayCount > 0 ? (
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {dayCount} day{dayCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>

            <div className="rounded-md border p-2">
              <Calendar
                mode="range"
                numberOfMonths={2}
                selected={draft}
                onSelect={setDraft}
                disabled={(date) => date > new Date()}
                month={visibleMonth}
                onMonthChange={setVisibleMonth}
                endMonth={startOfMonth(new Date())}
                className="rounded-md"
              />
            </div>

            {/* Editable EV-demand lever */}
            <div className="rounded-md border bg-muted/20 px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Gauge className="size-4 text-teal-600" />
                  EV demand scale
                </span>
                <span className="text-sm font-semibold tabular-nums text-teal-700">×{(demandPct / 100).toFixed(2)}</span>
              </div>
              <Slider
                value={[demandPct]}
                onValueChange={(v) => setDemandPct(v[0] ?? 100)}
                min={0}
                max={300}
                step={5}
                className="py-1"
                aria-label="EV demand scale"
              />
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Scales the reconstructed historical EV demand fed to both the engine and the
                simulated post. ×1.00 replays demand as it actually occurred; raise it to stress
                dispatch against heavier load, lower it for a quieter day.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(undefined)}
                disabled={!draft?.from}
              >
                Clear
              </Button>
              <Button size="sm" onClick={handleRun} disabled={!draft?.from} className="gap-2">
                <Play className="size-4" />
                Run simulation
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ReportHeader({
  from,
  to,
  demandScaleProxy,
  onEditRange,
}: {
  from: Date
  to: Date
  demandScaleProxy: number
  onEditRange: () => void
}) {
  const dayCount = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 px-4 py-2">
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Simulation range
        </span>
        <span className="text-sm font-medium tabular-nums">
          {format(from, "MMM d, yyyy")} → {format(to, "MMM d, yyyy")}
          <span className="ml-2 text-xs text-muted-foreground">
            ({dayCount} day{dayCount === 1 ? "" : "s"} · demand ×{demandScaleProxy.toFixed(2)})
          </span>
        </span>
      </div>
      <Button variant="outline" size="sm" onClick={onEditRange} className="gap-2">
        <ArrowLeft className="size-4" />
        Edit run
      </Button>
    </div>
  )
}
