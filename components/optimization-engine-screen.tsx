"use client"

import {
  Activity,
  ArrowRight,
  Zap,
  Clock,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Radio,
  Cpu,
  GitBranch,
  Gauge,
  PlugZap,
  BatteryCharging,
  DollarSign,
  Wifi,
  WifiOff,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react"
import { GRID_IMPORT_LIMIT_KW } from "@/lib/dispatch-kernel"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

// ---------------------------------------------------------------------------
// Optimization Engine Mechanics
// ---------------------------------------------------------------------------
// This page explains the core control loop of the pilot optimization engine:
//   1. Telemetry ingestion (1 Hz state snapshots)
//   2. Event detection (plug/unplug derived from charger state)
//   3. Decision logic (when to dispatch new setpoints)
//   4. Command emission (only on strategy change)
//   5. Price signal integration (spot market windows)
//   6. Online-mode assumptions and future fallback work
// ---------------------------------------------------------------------------

export function OptimizationEngineScreen() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="border-b bg-gradient-to-b from-muted/60 to-background px-6 py-16 md:px-12">
        <div className="mx-auto max-w-4xl">
          <Badge variant="outline" className="mb-4 text-xs uppercase tracking-wider">
            Pilot Architecture
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Optimization Engine Mechanics
          </h1>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed text-pretty">
            How the Enexa optimizer receives state, detects events, and dispatches
            commands in real time. This document covers the <strong>full online mode</strong>{" "}
            assumed for the pilot — fallback mechanisms for degraded connectivity
            will be developed in subsequent phases.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl space-y-12 px-6 py-12 md:px-12">
        {/* ------------------------------------------------------------------ */}
        {/* Section 1: The Control Loop */}
        {/* ------------------------------------------------------------------ */}
        <section>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <RefreshCw className="size-5 text-primary" />
            The 1-Second Control Loop
          </h2>
          <p className="mt-2 text-muted-foreground leading-relaxed text-pretty">
            The optimizer operates on a tight <strong>1 Hz cadence</strong>. Every second
            the Middleware pushes a telemetry snapshot; every second the engine
            re-evaluates whether to emit a new dispatch command.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <LoopStepCard
              step={1}
              icon={ArrowDownToLine}
              title="Receive State"
              description="Telemetry arrives from Middleware — batteries, chargers, grid, timestamps."
            />
            <LoopStepCard
              step={2}
              icon={Cpu}
              title="Evaluate"
              description="Detect events, run optimization, compare proposed setpoints to the last command."
            />
            <LoopStepCard
              step={3}
              icon={ArrowUpFromLine}
              title="Dispatch (if changed)"
              description="If setpoints differ from the previous command, push a new dispatch; otherwise, hold."
            />
          </div>

          <Card className="mt-6 border-primary/30 bg-primary/5">
            <CardContent className="flex items-start gap-3 p-4">
              <Gauge className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="text-sm leading-relaxed">
                <strong className="font-medium">Key principle: dispatch-on-change.</strong>{" "}
                We do not spam the Middleware with identical setpoints. A new command
                is emitted only when the optimizer decides the strategy should shift —
                triggered by an event or a price-window boundary.
              </div>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* ------------------------------------------------------------------ */}
        {/* Section 2: Telemetry & Event Detection */}
        {/* ------------------------------------------------------------------ */}
        <section>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Activity className="size-5 text-sky-600" />
            Telemetry Ingestion & Event Detection
          </h2>
          <p className="mt-2 text-muted-foreground leading-relaxed text-pretty">
            Each telemetry frame carries the full state of the site. By comparing
            consecutive frames the optimizer <em>derives</em> discrete events
            without requiring explicit event messages from the Middleware.
          </p>

          <div className="mt-6 space-y-4">
            <EventCard
              icon={PlugZap}
              title="Car Plugged In"
              detection="chargers[i].plug_state transitions from Unplugged to Plugged"
              impact="Primary trigger. Optimizer immediately re-plans: how much power does the EV need, what's the target SOC, how should battery discharge be scheduled?"
              tone="emerald"
            />
            <EventCard
              icon={PlugZap}
              title="Car Unplugged"
              detection="chargers[i].plug_state transitions from Plugged to Unplugged"
              impact="Session ends. Optimizer shifts to idle/arbitrage mode — batteries can now charge from cheap grid or hold SOC for the next arrival."
              tone="amber"
            />
            <EventCard
              icon={BatteryCharging}
              title="Battery SOC Threshold"
              detection="batteries[i].soc_pct crosses a configured threshold (e.g., 20% floor, 95% ceiling)"
              impact="Secondary trigger. Prevents over-discharge or over-charge; may force a strategy shift even mid-session."
              tone="sky"
            />
            <EventCard
              icon={AlertTriangle}
              title="Hardware Fault"
              detection="contactor_state, charging_state, or error flags change unexpectedly"
              impact="Defensive trigger. Optimizer may curtail or halt dispatch until the fault clears."
              tone="destructive"
            />
          </div>

          <Card className="mt-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">
                Why derive events from state?
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed">
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  <strong>Single source of truth.</strong> The telemetry payload is already
                  contractually defined and versioned. No separate event schema to maintain.
                </li>
                <li>
                  <strong>Resilience.</strong> If a frame is lost, the next frame still carries
                  full state — no event replay or gap-fill needed.
                </li>
                <li>
                  <strong>Simplicity for Middleware.</strong> Middleware only has to push state;
                  Enexa owns the event-detection logic and can evolve it server-side.
                </li>
              </ul>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* ------------------------------------------------------------------ */}
        {/* Section 3: Price Signal Integration */}
        {/* ------------------------------------------------------------------ */}
        <section>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <DollarSign className="size-5 text-amber-600" />
            Price Signal Integration
          </h2>
          <p className="mt-2 text-muted-foreground leading-relaxed text-pretty">
            For the pilot, the optimizer subscribes to{" "}
            <strong>fully dynamic intraday spot-market prices</strong> (EPEX
            continuous intraday). Unlike day-ahead markets where prices are
            fixed 12–36 hours in advance, intraday prices update continuously
            and can shift significantly in response to real-time supply/demand
            imbalances, renewable forecast errors, or unplanned outages.
          </p>

          <Card className="mt-4 border-primary/30 bg-primary/5">
            <CardContent className="flex items-start gap-3 p-4">
              <Zap className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="text-sm leading-relaxed">
                <strong className="font-medium">Why intraday?</strong>{" "}
                Intraday prices reflect the true marginal cost of electricity
                in near real-time. By reacting to these signals the optimizer
                can capture arbitrage opportunities that day-ahead schedules
                would miss — for example, a sudden price spike caused by an
                unexpected generator trip or a price dip from excess solar.
              </div>
            </CardContent>
          </Card>

          <p className="mt-4 text-muted-foreground leading-relaxed text-pretty">
            Price changes are the <strong>second major trigger</strong> for
            setpoint changes (after EV plug/unplug events). The optimizer
            evaluates the current price against configurable thresholds to
            decide which quadrant of the strategy matrix applies:
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <PriceScenarioCard
              title="Cheap Window (low price)"
              scenario="No EV connected"
              action="Charge batteries from grid at full import envelope"
              rationale="Store cheap energy now, discharge later when prices rise or an EV arrives."
            />
            <PriceScenarioCard
              title="Cheap Window (low price)"
              scenario="EV connected"
              action="Charge EV from grid + batteries if SOC allows"
              rationale="Maximize cheap-grid utilization; batteries can top-up after the session."
            />
            <PriceScenarioCard
              title="Expensive Window (high price)"
              scenario="No EV connected"
              action="Hold battery SOC (no grid charge) or export if profitable"
              rationale="Avoid buying expensive energy; preserve capacity for the next EV."
            />
            <PriceScenarioCard
              title="Expensive Window (high price)"
              scenario="EV connected"
              action="Discharge batteries to cover EV demand, minimize grid import"
              rationale="Sell stored cheap energy to the EV at the higher effective rate."
            />
          </div>

          <Card className="mt-6 border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex items-start gap-3 p-4">
              <Clock className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <div className="text-sm leading-relaxed">
                <strong className="font-medium">Continuous re-evaluation.</strong>{" "}
                Because intraday prices can change at any moment, the optimizer
                re-evaluates strategy on every incoming telemetry tick. If the
                current price crosses a threshold (cheap → expensive or vice
                versa), a new command is dispatched immediately — there is no
                fixed 15-minute slot boundary as in day-ahead scheduling.
              </div>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* ------------------------------------------------------------------ */}
        {/* Section 4: Decision Flow Diagram */}
        {/* ------------------------------------------------------------------ */}
        <section>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <GitBranch className="size-5 text-violet-600" />
            Decision Flow
          </h2>
          <p className="mt-2 text-muted-foreground leading-relaxed text-pretty">
            On every tick the optimizer walks through a simple decision tree.
            The output is either <em>hold</em> (no dispatch) or <em>dispatch</em> (new command).
          </p>

          <div className="mt-6 rounded-lg border bg-muted/30 p-6">
            <ol className="relative ml-3 space-y-6 border-l-2 border-border pl-6">
              <DecisionStep
                number={1}
                title="Parse incoming telemetry"
                detail="Validate schema, extract charger/battery/grid state."
              />
              <DecisionStep
                number={2}
                title="Detect events"
                detail="Compare chargers[].plug_state and batteries[].soc_pct to previous frame."
                highlight
              />
              <DecisionStep
                number={3}
                title="Evaluate price threshold"
                detail="Has the intraday spot price crossed a cheap/expensive threshold since the last dispatch?"
                highlight
              />
              <DecisionStep
                number={4}
                title="Run optimization"
                detail="Given current state, events, and price forecast, compute optimal setpoints for station + per-unit."
              />
              <DecisionStep
                number={5}
                title="Compare to last command"
                detail="Are the proposed setpoints materially different from the active command?"
              />
              <DecisionStep
                number={6}
                title="Dispatch or hold"
                detail="If different: POST /api/v1/dispatch. Otherwise: do nothing (hold)."
              />
            </ol>
          </div>
        </section>

        <Separator />

        {/* ------------------------------------------------------------------ */}
        {/* Section 5: Command Payload Recap */}
        {/* ------------------------------------------------------------------ */}
        <section>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Zap className="size-5 text-emerald-600" />
            What Goes in a Command?
          </h2>
          <p className="mt-2 text-muted-foreground leading-relaxed text-pretty">
            A dispatch payload sets the operating envelope for the next interval.
            The Middleware translates these setpoints into Modbus writes.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <SetpointCard
              field="station.P_grid_clearance_w"
              description="Maximum power the site may draw from (or export to) the grid."
              example={`+${(GRID_IMPORT_LIMIT_KW * 1000).toLocaleString("de-DE").replace(/\./g, " ")} W (import cap)`}
            />
            <SetpointCard
              field="chargers[i].P_cp_lim_w"
              description="Per-connector power ceiling imposed by the optimizer."
              example="150 000 W (full DC fast-charge)"
            />
            <SetpointCard
              field="chargers[i].soc_cp_max_pct"
              description="Target SOC ceiling for the connected EV (session policy)."
              example="80 % (fleet policy)"
            />
            <SetpointCard
              field="metadata.price_trajectory[]"
              description="Lookahead price forecast shared with Middleware for transparency."
              example="[42.5, 44.0, 51.2, ...] EUR/MWh"
            />
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            See the{" "}
            <a href="/dispatching-api" className="font-medium text-primary hover:underline">
              Dispatching API
            </a>{" "}
            page for the full schema and semantics.
          </p>
        </section>

        <Separator />

        {/* ------------------------------------------------------------------ */}
        {/* Section 6: Online Mode & Future Fallbacks */}
        {/* ------------------------------------------------------------------ */}
        <section>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Wifi className="size-5 text-primary" />
            Online Mode Assumptions
          </h2>
          <p className="mt-2 text-muted-foreground leading-relaxed text-pretty">
            The pilot operates in <strong>full online mode</strong>: the optimizer
            expects uninterrupted bidirectional connectivity with the Middleware.
            This simplifies the control loop but creates a dependency on network availability.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Wifi className="size-4 text-emerald-600" />
                  <CardTitle className="text-base font-medium">Online Mode (Pilot)</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground leading-relaxed">
                <ul className="list-disc space-y-1 pl-4">
                  <li>1 Hz telemetry push assumed reliable</li>
                  <li>Optimizer always has fresh state</li>
                  <li>Commands dispatched immediately on decision</li>
                  <li>No local decision-making at Middleware</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-dashed opacity-75">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <WifiOff className="size-4 text-muted-foreground" />
                  <CardTitle className="text-base font-medium text-muted-foreground">
                    Fallback Modes (Future)
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground leading-relaxed">
                <ul className="list-disc space-y-1 pl-4">
                  <li>Middleware-local decision cache</li>
                  <li>Price-schedule preload for offline slots</li>
                  <li>Safe-mode setpoints on connectivity loss</li>
                  <li>Store-and-forward telemetry</li>
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6 border-primary/30 bg-primary/5">
            <CardContent className="flex items-start gap-3 p-4">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="text-sm leading-relaxed">
                <strong className="font-medium">Pilot assumption:</strong> If
                connectivity is lost for more than the <code>valid_until</code> window
                of the last command (default 60 s), the Middleware reverts to its
                local safe-fallback (batteries hold, chargers pause). Designing
                richer fallback logic is explicitly <em>out of scope</em> for the
                pilot phase.
              </div>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* ------------------------------------------------------------------ */}
        {/* Section 7: Summary */}
        {/* ------------------------------------------------------------------ */}
        <section>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <CheckCircle2 className="size-5 text-emerald-600" />
            Summary
          </h2>

          <div className="mt-4 rounded-lg border bg-muted/30 p-6">
            <ul className="space-y-3 text-sm leading-relaxed">
              <SummaryItem
                icon={Radio}
                text="Telemetry arrives every second; the optimizer always has near-real-time state."
              />
              <SummaryItem
                icon={PlugZap}
                text="Events (plug/unplug, SOC thresholds) are derived from consecutive state snapshots — no separate event API."
              />
              <SummaryItem
                icon={DollarSign}
                text="Price-slot boundaries are the second major trigger; the optimizer re-evaluates strategy at every 15-min mark."
              />
              <SummaryItem
                icon={Zap}
                text="Commands are dispatched only when the proposed setpoints differ from the active command — no redundant traffic."
              />
              <SummaryItem
                icon={Wifi}
                text="Pilot assumes full online mode; fallback mechanisms are planned for future phases."
              />
            </ul>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="/telemetry-api"
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 transition-colors"
            >
              Telemetry API
              <ArrowRight className="size-4" />
            </a>
            <a
              href="/dispatching-api"
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
            >
              Dispatching API
              <ArrowRight className="size-4" />
            </a>
            <a
              href="/prototype/telemetry/dispatcher"
              className="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Live Dispatcher Demo
              <ArrowRight className="size-4" />
            </a>
          </div>
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoopStepCard({
  step,
  icon: Icon,
  title,
  description,
}: {
  step: number
  icon: typeof Activity
  title: string
  description: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {step}
          </span>
          <Icon className="size-4 text-muted-foreground" />
          <span className="font-medium">{title}</span>
        </div>
        <p className="text-sm text-muted-foreground leading-snug">{description}</p>
      </CardContent>
    </Card>
  )
}

function EventCard({
  icon: Icon,
  title,
  detection,
  impact,
  tone,
}: {
  icon: typeof PlugZap
  title: string
  detection: string
  impact: string
  tone: "emerald" | "amber" | "sky" | "destructive"
}) {
  const toneClasses: Record<typeof tone, string> = {
    emerald: "border-emerald-500/40 bg-emerald-500/5",
    amber: "border-amber-500/40 bg-amber-500/5",
    sky: "border-sky-500/40 bg-sky-500/5",
    destructive: "border-destructive/40 bg-destructive/5",
  }
  const iconClasses: Record<typeof tone, string> = {
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    sky: "text-sky-600",
    destructive: "text-destructive",
  }

  return (
    <Card className={toneClasses[tone]}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <Icon className={`size-5 ${iconClasses[tone]}`} />
          <span className="font-medium">{title}</span>
        </div>
        <div className="mt-3 space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Detection:</span>{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{detection}</code>
          </div>
          <div>
            <span className="text-muted-foreground">Impact:</span>{" "}
            <span className="text-foreground">{impact}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PriceScenarioCard({
  title,
  scenario,
  action,
  rationale,
}: {
  title: string
  scenario: string
  action: string
  rationale: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-xs">{scenario}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="space-y-1.5">
          <div>
            <span className="font-medium text-foreground">Action:</span>{" "}
            <span className="text-muted-foreground">{action}</span>
          </div>
          <div>
            <span className="font-medium text-foreground">Rationale:</span>{" "}
            <span className="text-muted-foreground">{rationale}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DecisionStep({
  number,
  title,
  detail,
  highlight,
}: {
  number: number
  title: string
  detail: string
  highlight?: boolean
}) {
  return (
    <li className="relative">
      <span
        className={`absolute -left-[calc(1.5rem+1px)] flex size-6 items-center justify-center rounded-full text-xs font-bold ${
          highlight
            ? "bg-primary text-primary-foreground"
            : "bg-muted-foreground/20 text-muted-foreground"
        }`}
      >
        {number}
      </span>
      <div>
        <span className="font-medium">{title}</span>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
    </li>
  )
}

function SetpointCard({
  field,
  description,
  example,
}: {
  field: string
  description: string
  example: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{field}</code>
        <p className="mt-2 text-sm text-muted-foreground leading-snug">{description}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          <span className="font-medium">Example:</span> {example}
        </p>
      </CardContent>
    </Card>
  )
}

function SummaryItem({ icon: Icon, text }: { icon: typeof Radio; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      <span>{text}</span>
    </li>
  )
}
