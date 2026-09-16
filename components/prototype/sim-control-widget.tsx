"use client"

/**
 * SimControlWidget — shared transport / scrubber for the simulation host.
 *
 * Why this exists
 * ---------------
 * The Day-Sim screen, the Snapshot screen and the Commands screen all
 * live under `app/prototype/telemetry/layout.tsx` which already wraps
 * them in a single `PrototypeTelemetryProvider`. That provider hosts
 * ONE instance of `usePrototypeTelemetry`, so every screen reads from
 * the same simulation tick, the same event log, the same SOC history.
 *
 * Previously, only the Day-Sim screen rendered the transport controls
 * (Pause / Reset / Speed) and the timeline scrubber inline. As a
 * consequence, switching to Snapshot or Commands meant losing the
 * ability to control the run without bouncing back to Day-Sim.
 *
 * This widget extracts the controls into a single drop-in card that
 * any page under the telemetry layout can render at the top of its
 * content. Because all data flows through the shared context, every
 * mounted instance of this widget reads/writes the same state — pause
 * on Snapshot, the Day-Sim screen pauses too; scrub on Commands, the
 * SOC chart on Day-Sim jumps to the same moment.
 *
 * Mode awareness
 * --------------
 * The simulation host has two modes: `realtime` (slowly drifting
 * sinusoid, used for the original telemetry-stream demo) and `day_sim`
 * (real EPEX prices replayed against a 24 h dispatch). The widget
 * adapts:
 *
 *   • day_sim   → full UI: Pause / Reset / Speed + LIVE/REWOUND badge
 *                 + simulated clock-of-day + day-progress + scrubber
 *   • realtime  → compact UI: Pause / Reset + Speed + live wall-clock,
 *                 plus a `Switch to Day-Sim` button so the operator can
 *                 enrol the simulation in the 24 h replay without
 *                 having to navigate back to the Day-Sim tab.
 */

import * as React from "react"
import { Pause, Play, RotateCw, FastForward, Clock } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"

// The day window starts at 06:00 (CEST) and runs 24 h. simHour is
// elapsed-since-06:00, so to read a clock-of-day we add 6 and wrap.
const DAY_START_HOUR = 6

/**
 * Format an elapsed-since-start hour as "HH:MM" CLOCK time.
 * 0 → "06:00", 6 → "12:00", 23 → "05:00", 24 → "06:00".
 */
function fmtClock(elapsed: number): string {
  const clock = (((elapsed + DAY_START_HOUR) % 24) + 24) % 24
  const hh = Math.floor(clock)
  const mm = Math.floor((clock - hh) * 60)
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

export interface SimControlWidgetProps {
  /**
   * If true, the widget will automatically switch the simulation host
   * into `day_sim` mode on mount. Use this on screens that ONLY make
   * sense against a 24 h replay (the Day-Sim screen itself). Snapshot
   * and Commands screens leave this off so the operator's chosen mode
   * is preserved across navigation.
   */
  forceDaySim?: boolean
  /** Optional className passthrough on the outer Card. */
  className?: string
}

export function SimControlWidget({
  forceDaySim,
  className,
}: SimControlWidgetProps) {
  const { dataSource, simulated, frame } = usePrototypeTelemetryContext()
  const {
    simMode,
    setSimMode,
    isPaused,
    togglePause,
    reset,
    speed,
    setSpeed,
    simHour,
    liveSimHour,
    isScrubbing,
    scrubToHour,
  } = simulated

  // Day-Sim screen passes forceDaySim — every other screen leaves the
  // mode alone so the operator can choose the realtime stream OR the
  // 24 h replay independently of which page they happen to be on.
  React.useEffect(() => {
    if (forceDaySim && simMode !== "day_sim") {
      setSimMode("day_sim")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceDaySim])

  // Don't render simulation controls when using live or historical data
  // The DataSourceSwitcher in the header handles those modes
  if (dataSource !== "simulated") {
    return null
  }

  const inDaySim = simMode === "day_sim"
  const dayProgress = (simHour / 24) * 100
  const wallClock = frame
    ? new Date(frame.ts).toLocaleTimeString("en-GB", { hour12: false })
    : "—"

  return (
    <Card className={className}>
      <CardContent className="p-4 space-y-3">
        {/* Top row: transport controls on the left, clock readouts on
            the right. Wraps to two stacked rows below `lg`. */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* ── Transport controls ─────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant={isPaused ? "default" : "outline"}
              onClick={togglePause}
              className="gap-1.5"
            >
              {isPaused ? (
                <Play className="size-4" />
              ) : (
                <Pause className="size-4" />
              )}
              {isPaused
                ? isScrubbing
                  ? "Resume live"
                  : "Play"
                : "Pause"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={reset}
              className="gap-1.5"
            >
              <RotateCw className="size-4" />
              Reset
            </Button>

            {/* Speed slider — same range and semantics in both modes.
                In day_sim, speed=1 means 10 sim-min/sec. In realtime
                it just paces tick generation faster. */}
            <div className="flex items-center gap-2 ml-1">
              <FastForward
                className="size-3.5 text-muted-foreground"
                aria-hidden
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Speed
              </span>
              <Slider
                value={[speed]}
                min={1}
                max={60}
                step={1}
                onValueChange={(v) => setSpeed(v[0])}
                className="w-32"
              />
              <Badge variant="outline" className="font-mono text-xs">
                {speed}x
              </Badge>
              {inDaySim && (
                <span className="text-[10px] text-muted-foreground whitespace-nowrap hidden md:inline">
                  ({(speed * 10).toFixed(0)} sim-min/sec)
                </span>
              )}
            </div>

            {/* Mode switch — only shown when NOT forced into day_sim
                (i.e. on Snapshot / Commands). Lets the operator opt
                in/out of the 24 h replay without leaving the page. */}
            {!forceDaySim && (
              <div
                className="hidden md:inline-flex items-center rounded-md border bg-muted/40 p-0.5 ml-1"
                role="tablist"
                aria-label="Simulation mode"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={simMode === "realtime"}
                  onClick={() => setSimMode("realtime")}
                  className={cn(
                    "px-2 py-0.5 text-[11px] rounded-sm font-medium transition-colors",
                    simMode === "realtime"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Realtime
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={simMode === "day_sim"}
                  onClick={() => setSimMode("day_sim")}
                  className={cn(
                    "px-2 py-0.5 text-[11px] rounded-sm font-medium transition-colors",
                    simMode === "day_sim"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Day-Sim
                </button>
              </div>
            )}
          </div>

          {/* ── Clock readouts ─────────────────────────────────────── */}
          <div className="flex items-center gap-4">
            {inDaySim ? (
              <>
                {/* Simulated time — translates the elapsed-since-06:00
                    cursor back to clock-of-day. Live or REWOUND
                    indicator next to the label so the operator
                    instantly knows whether the readout is the leading
                    edge of the simulation or a back-scrubbed snapshot. */}
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 justify-end">
                    {isScrubbing ? (
                      <Badge
                        variant="outline"
                        className="text-[9px] font-mono px-1 py-0 h-4 border-amber-500/50 text-amber-700 dark:text-amber-400"
                      >
                        REWOUND
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[9px] font-mono px-1 py-0 h-4 border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
                      >
                        LIVE
                      </Badge>
                    )}
                    Simulated time
                  </div>
                  <div className="font-mono text-lg font-semibold tabular-nums">
                    {fmtClock(simHour)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Day progress
                  </div>
                  <div className="font-mono text-lg font-semibold tabular-nums">
                    {dayProgress.toFixed(1)}%
                  </div>
                </div>
              </>
            ) : (
              /* Realtime mode has no day-of-clock concept — just the
                 wall clock of the most recent tick. We dim it when
                 paused so the readout reflects "this is the last
                 frame we drew" semantics. */
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 justify-end">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] font-mono px-1 py-0 h-4",
                      isPaused
                        ? "text-muted-foreground"
                        : "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
                    )}
                  >
                    {isPaused ? "PAUSED" : "LIVE"}
                  </Badge>
                  Wall clock
                </div>
                <div
                  className={cn(
                    "font-mono text-lg font-semibold tabular-nums inline-flex items-center gap-1.5",
                    isPaused && "text-muted-foreground",
                  )}
                >
                  <Clock className="size-4 opacity-60" aria-hidden />
                  {wallClock}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 2 — full-width scrubber. Only meaningful in day_sim
            (realtime has no random-access timeline), so we hide it
            entirely in realtime mode rather than render a disabled
            stub that would invite confusion. */}
        {inDaySim && (
          <DaySimScrubber
            simHour={simHour}
            liveSimHour={liveSimHour}
            isScrubbing={isScrubbing}
            onScrub={scrubToHour}
          />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Day-Sim rewind scrubber. Clicking/dragging anywhere on the track
 * jumps the simulation cursor to that moment, auto-pausing live
 * advancement; pressing Play exits scrub mode and resumes from where
 * the simulation actually is (i.e. `liveSimHour`, NOT the scrub
 * position — we never silently re-run the model from a back-rewound
 * point because that would corrupt the cost accumulators).
 *
 * The track range is [0, liveSimHour]; the un-simulated future is
 * rendered as a faint band so it's visually clear the cursor cannot
 * scrub past the leading edge.
 */
function DaySimScrubber({
  simHour,
  liveSimHour,
  isScrubbing,
  onScrub,
}: {
  simHour: number
  liveSimHour: number
  isScrubbing: boolean
  onScrub: (h: number | null) => void
}) {
  // Floor the max scrub at a tiny epsilon so the slider track has a
  // sane length even at t=0 (handle pinned at the start, no degenerate
  // div-by-zero in the bg width below).
  const maxScrub = Math.max(0.05, liveSimHour)
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24]

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono">{fmtClock(0)}</span>
          <span className="opacity-60">·</span>
          <span>
            {isScrubbing ? "Inspecting" : "Live cursor at"}{" "}
            <span className="font-mono text-foreground">
              {fmtClock(simHour)}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            Sim reached{" "}
            <span className="font-mono text-foreground">
              {fmtClock(liveSimHour)}
            </span>
          </span>
          <span className="opacity-60">·</span>
          <span className="font-mono">{fmtClock(24)}</span>
        </div>
      </div>

      {/* Slider track. The Radix slider produces the handle and hit
          target; the muted band behind shows the simulated-vs-future
          boundary. */}
      <div className="relative pt-1">
        <div
          aria-hidden
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-muted/40"
        />
        <div
          aria-hidden
          className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-muted"
          style={{ width: `${(liveSimHour / 24) * 100}%` }}
        />

        <Slider
          value={[Math.min(simHour, maxScrub)]}
          min={0}
          max={24}
          step={0.05}
          onValueChange={(v) => {
            const next = Math.min(maxScrub, v[0])
            onScrub(next >= liveSimHour - 1e-3 ? null : next)
          }}
          className="relative z-10"
        />
      </div>

      {/* Bottom hour-tick rail. Same cadence as the simulation charts
          on the page so the scrubber x-axis lines up with them when
          rendered in the same column. */}
      <div className="relative h-3 mt-0.5">
        {ticks.map((h) => {
          const x = (h / 24) * 100
          return (
            <div
              key={h}
              className="absolute -translate-x-1/2 text-[9px] font-mono text-muted-foreground tabular-nums"
              style={{ left: `${x}%` }}
            >
              {fmtClock(h)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
