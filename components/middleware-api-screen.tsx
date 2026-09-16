"use client"

import * as React from "react"
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { 
  Cable, 
  ArrowDownToLine, 
  ArrowUpFromLine, 
  ArrowRight,
  Activity,
  Zap,
  BatteryCharging,
  Car,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Check,
  Copy,
  Server,
  Cpu,
  Calculator,
  Target,
  Shield,
  Info,
  Package,
  ListOrdered,
  RefreshCw,
  AlertCircle,
  XCircle,
  ShieldAlert,
  FileJson,
  SlidersHorizontal,
} from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// ---------------------------------------------------------------------------
// CopyableCodeBlock — labeled code block with a "Copy" button.
// Used for the full-payload JSONC sample in Payload Details.
// ---------------------------------------------------------------------------
function CopyableCodeBlock({
  label,
  code,
  language = "jsonc",
}: {
  label: string
  code: string
  language?: string
}) {
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast({ title: "Copied", description: `${label} copied to clipboard.` })
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast({
        title: "Copy failed",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {language}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-xs"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="size-3.5" /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" /> Copy
            </>
          )}
        </Button>
      </div>
      <pre className="p-3 text-xs leading-relaxed overflow-x-auto font-mono">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export type MiddlewareApiMode = "all" | "general" | "telemetry" | "dispatching" | "command-status"

const MODE_META: Record<
  Exclude<MiddlewareApiMode, "all">,
  { title: string; badges: string[]; description: React.ReactNode }
> = {
  general: {
    title: "General API",
    badges: ["Enexa ↔ Middleware", "Shared Context", "HTTPS / JSON"],
    description: (
      <>
        The shared contract between <strong>Enexa</strong> and <strong>Middleware</strong> &mdash;
        integration architecture, data-field taxonomy, payload identifiers, the Modbus register
        reference, and the operational details that apply to every endpoint. The three wire-level
        API surfaces &mdash; <strong>Telemetry API</strong>, <strong>Dispatching API</strong>,
        and <strong>Command Status API</strong> &mdash; each live on their own page under{" "}
        <em>API Specifications</em> in the sidebar.
      </>
    ),
  },
  telemetry: {
    title: "Telemetry API",
    badges: ["Middleware → Enexa", "Per-site snapshot", "HTTPS / JSON"],
    description: (
      <>
        The uplink contract from <strong>Middleware</strong> to <strong>Enexa</strong>. Defines
        the per-site state snapshot Middleware pushes on a configurable cadence &mdash; envelope
        plus three payload blocks (<code>batteries[]</code>, <code>chargers[]</code>,{" "}
        <code>grid</code>). Dispatch-feedback is <em>not</em> part of telemetry; it flows through
        the dedicated <strong>Command Status API</strong>. For the shared context see the{" "}
        <strong>General API</strong> page.
      </>
    ),
  },
  dispatching: {
    title: "Dispatching API",
    badges: ["Enexa → Middleware", "Setpoint Commands", "HTTPS / JSON"],
    description: (
      <>
        The downlink contract from <strong>Enexa</strong> to <strong>Middleware</strong>. Defines
        the setpoint-command envelope the optimizer sends, the synchronous ack (<em>accepted /
        rejected</em> &mdash; pure receipt, no execution outcome), and how real execution state
        flows back asynchronously through the <strong>Command Status API</strong>. For the shared
        context (architecture, field-purpose taxonomy, Modbus register mapping) see the{" "}
        <strong>General API</strong> page.
      </>
    ),
  },
  "command-status": {
    title: "Command Status API",
    badges: ["Middleware → Enexa", "Event-driven", "HTTPS / JSON"],
    description: (
      <>
        The dispatch-feedback channel. Every time a dispatch command changes state on the
        Middleware side &mdash; <code>accepted</code>, <code>executing</code>,{" "}
        <code>executed</code>, <code>deviated</code>, <code>superseded</code>,{" "}
        <code>timed_out</code>, <code>rejected</code> &mdash; Middleware POSTs a single event
        here, individually acked, with at-least-once delivery. Keyed by the{" "}
        <code>command_id</code> issued on the <strong>Dispatching API</strong>, it closes the
        control loop independently of telemetry cadence.
      </>
    ),
  },
}

// ---------------------------------------------------------------------------
// Reusable section block used inside Summary / Error Handling cards
// ---------------------------------------------------------------------------
function SummaryBlock({
  title,
  icon: Icon,
  iconColor = "text-primary",
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  iconColor?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <h4 className="font-semibold flex items-center gap-2 text-sm">
        <span className={`flex size-6 shrink-0 items-center justify-center rounded-md bg-muted ${iconColor}`}>
          <Icon className="size-3.5" />
        </span>
        {title}
      </h4>
      <div className="text-sm text-muted-foreground leading-relaxed pl-8 space-y-2">
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TELEMETRY — Summary card (rendered only when mode === "telemetry")
// ---------------------------------------------------------------------------
function TelemetrySummaryCard() {
  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Info className="size-5 text-primary" />
              Summary
            </CardTitle>
            <CardDescription className="mt-1">
              The quick-read contract: when Middleware calls it, what goes in, what comes back,
              and how aggregation survives missed pushes.
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">POST /api/v1/telemetry</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <SummaryBlock title="When it's called" icon={Clock} iconColor="text-primary">
          <p>
            <strong>Middleware-initiated push</strong> &mdash; Enexa never polls. The Middleware
            scheduler fires on every <code className="text-xs">telemetry.report_interval_s</code> tick
            (Middleware app config, <strong>default 1 s</strong>, configurable <strong>1&ndash;60 s</strong>{" "}
            via the Config API; see the General API &rarr; <em>push cadence</em> callout).
          </p>
          <p>
            Additionally, an <strong>out-of-band immediate push</strong> is fired on any critical
            state transition (safety veto, contactor trip, grid-limit breach) regardless of the
            interval timer &mdash; so Enexa never waits up to <code className="text-xs">report_interval_s</code>{" "}
            to learn about an emergency.
          </p>
          <p>
            Payload granularity is <strong>per site</strong>: one POST per <code className="text-xs">site_id</code> per tick,
            carrying all assets at that site.
          </p>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="What's in the payload" icon={Package} iconColor="text-chart-2">
          <p>
            Every push is a single JSON document composed of an <strong>envelope</strong> (identity
            + sequencing) and <strong>four payload blocks</strong> &mdash; all snapshots of current
            state at <code className="text-xs">timestamp</code>. Each bullet below maps 1-to-1 to
            a section in <em>Payload Details</em>, in the same order:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 not-prose">
            <div className="p-2 rounded-md border bg-muted/30 text-xs">
              <span className="font-mono font-semibold text-foreground">envelope</span>
              <span className="block text-muted-foreground mt-0.5">
                <code>site_id</code>, <code>asset_id</code>, <code>timestamp</code>,{" "}
                <code>sequence_number</code>, <code>middleware_version</code>.
              </span>
            </div>
            <div className="p-2 rounded-md border bg-muted/30 text-xs">
              <span className="font-mono font-semibold text-foreground">batteries[]</span>
              <span className="block text-muted-foreground mt-0.5">
                One entry per power unit &mdash; SOC, power, temperature min/max, real-time
                charge/discharge headroom, contactor state.
              </span>
            </div>
            <div className="p-2 rounded-md border bg-muted/30 text-xs">
              <span className="font-mono font-semibold text-foreground">grid</span>
              <span className="block text-muted-foreground mt-0.5">
                Single PCC reading &mdash; <code>P_grid</code>, cumulative MID import/export,
                auxiliary load, frequency, power factor.
              </span>
            </div>
            <div className="p-2 rounded-md border bg-muted/30 text-xs">
              <span className="font-mono font-semibold text-foreground">chargers[]</span>
              <span className="block text-muted-foreground mt-0.5">
                One entry per connector &mdash; plug &amp; charging state, EV-negotiated limits,
                MID session energy, contactors.
              </span>
            </div>
            <div className="p-2 rounded-md border bg-muted/30 text-xs md:col-span-2">
              <span className="font-mono font-semibold text-foreground">station</span>
              <span className="block text-muted-foreground mt-0.5">
                Site-wide state &mdash; operation mode, grid-clearance consumption/generation
                limits, active warnings and errors.
              </span>
            </div>
          </div>
          <p className="text-xs">
            <strong>Reading order:</strong> envelope &rarr; batteries &rarr; grid &rarr; chargers
            &rarr; station. A copyable end-to-end example sits at the bottom of{" "}
            <em>Payload Details</em> under <strong>Full payload sample</strong>.
          </p>
          <p className="text-xs">
            <strong>Dispatch feedback is separate.</strong> Command-state transitions (<em>executing,
            executed, deviated, superseded</em>&hellip;) travel over the dedicated{" "}
            <strong>Command Status API</strong> &mdash; not telemetry &mdash; so dispatch feedback
            latency is independent of <code className="text-xs">report_interval_s</code>.
          </p>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="How Middleware builds the request" icon={ListOrdered} iconColor="text-chart-3">
          <ol className="list-decimal pl-4 space-y-1.5">
            <li>
              <strong>Snapshot state:</strong> read the Modbus register cache (continuously refreshed
              by the Modbus client) for every battery, charger, and the PCC meter.
            </li>
            <li>
              <strong>Build envelope:</strong> assign the next monotonically-increasing{" "}
              <code className="text-xs">sequence_number</code>, stamp <code className="text-xs">timestamp = now()</code>,
              attach <code className="text-xs">middleware_version</code>.
            </li>
            <li>
              <strong>Authenticate:</strong> bearer <code className="text-xs">tenant_api_key</code> +{" "}
              <code className="text-xs">X-Device-ID</code> header.
            </li>
            <li>
              <strong>POST</strong> with 5-second request timeout. On <code className="text-xs">2xx</code>,
              advance <code className="text-xs">last_successful_push_ts</code>. Otherwise: see{" "}
              <em>Error Handling</em>.
            </li>
          </ol>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="Response (happy path)" icon={CheckCircle2} iconColor="text-green-600">
          <p>
            A single status line is all Middleware needs. A <code className="text-xs">2xx</code>{" "}
            response means the push was received and persisted by Enexa &mdash; Middleware advances{" "}
            <code className="text-xs">last_successful_push_ts</code>. Empty body.
          </p>
          <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs overflow-x-auto">
            <pre>{`HTTP/1.1 202 Accepted`}</pre>
          </div>
          <p className="text-xs">
            Any non-2xx code is handled per the <em>Error Handling</em> section below.
          </p>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="What if a push is missed" icon={RefreshCw} iconColor="text-orange-500">
          <p>
            Telemetry is <strong>at-most-once</strong>: a dropped or rejected push is simply
            discarded &mdash; the next snapshot supersedes it, no backfill is attempted. Gaps in{" "}
            <code className="text-xs">sequence_number</code> at the Enexa side quantify how many
            pushes were lost; Enexa&apos;s ingestion exposes this as a per-site integrity metric.
          </p>
          <p className="text-xs">
            Dispatch feedback is <strong>not</strong> at risk here &mdash; command-state transitions
            ride the <strong>Command Status API</strong> (at-least-once, individually acked,
            buffered on Middleware until delivery), so telemetry outages never lose a command event.
          </p>
          <p className="text-xs">
            <strong>Autonomous fallback:</strong> if no telemetry push succeeds for{" "}
            <code className="text-xs">telemetry.missed_push_threshold_s</code> (default{" "}
            <strong>30 s</strong>), Middleware switches the dispatch loop to{" "}
            <strong>LOCAL AUTONOMOUS</strong> and continues safe-fallback setpoints until
            connectivity is restored.
          </p>
        </SummaryBlock>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// TELEMETRY — Error Handling card
// ---------------------------------------------------------------------------
function TelemetryErrorHandlingCard() {
  return (
    <Card className="border-l-4 border-l-red-500">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="size-5 text-red-500" />
          Error Handling
        </CardTitle>
        <CardDescription>
          Response codes, retry policy, and what Enexa does when a site stops pushing. Dispatch
          feedback is unaffected by telemetry failures &mdash; it lives on the Command Status API.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h4 className="font-semibold text-sm mb-3">Response codes</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Code</TableHead>
                <TableHead className="w-[180px]">Meaning</TableHead>
                <TableHead>Middleware action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell><Badge className="bg-green-600">202</Badge></TableCell>
                <TableCell className="text-sm font-mono">Accepted</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Advance <code className="text-xs">last_successful_push_ts</code>. Nothing else to do.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="destructive">400</Badge></TableCell>
                <TableCell className="text-sm font-mono">Bad Request (schema)</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Schema violation or clock skew &gt; 5 min. <strong>Do NOT retry</strong> &mdash; log,
                  raise <code className="text-xs">middleware.schema_error</code> alert, drop the snapshot.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="destructive">401</Badge></TableCell>
                <TableCell className="text-sm font-mono">Unauthorized</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Token expired or revoked. Pull a fresh <code className="text-xs">tenant_api_key</code>{" "}
                  via the Config API, retry next push with the new token.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="destructive">403</Badge></TableCell>
                <TableCell className="text-sm font-mono">Forbidden</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Site not provisioned or deactivated. Stop pushing, raise operator alert, enter LOCAL AUTONOMOUS.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge className="bg-yellow-600">413</Badge></TableCell>
                <TableCell className="text-sm font-mono">Payload Too Large</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Rare. Disable <code className="text-xs">telemetry.include_detailed_bms</code> or lower{" "}
                  <code className="text-xs">batch_size</code>; then retry.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge className="bg-yellow-600">429</Badge></TableCell>
                <TableCell className="text-sm font-mono">Too Many Requests</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Back off per <code className="text-xs">Retry-After</code> header. If persistent,
                  Enexa will issue a new <code className="text-xs">report_interval_s</code> via Config API.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="destructive">5xx</Badge></TableCell>
                <TableCell className="text-sm font-mono">Enexa server error</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Exponential-backoff retry. State snapshot discarded on exhaustion. After 5
                  consecutive failures &rarr; LOCAL AUTONOMOUS.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="outline">timeout</Badge></TableCell>
                <TableCell className="text-sm font-mono">Request &gt; 5 s</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Treated as 5xx. Network path likely congested; the next tick simply produces a
                  fresh snapshot.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <Separator />

        <SummaryBlock title="Retry policy" icon={RefreshCw} iconColor="text-primary">
          <p>
            Exponential backoff, jittered, with an upper cap. Retries apply to <strong>5xx and
            network-layer failures only</strong>. 4xx responses are terminal for that push (with the
            401 token-rotation exception).
          </p>
          <div className="bg-muted/50 rounded-md p-3 font-mono text-xs">
            backoff = min(1s &times; 2^attempt, 60s) + random(0, 500ms)<br />
            max_attempts = 5<br />
            on_exhausted =&gt; enter LOCAL AUTONOMOUS
          </div>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="What Enexa does when a site goes quiet" icon={ShieldAlert} iconColor="text-red-500">
          <p>
            Enexa watches two signals: the per-site <strong>heartbeat liveness</strong> (separate{" "}
            <code className="text-xs">POST /api/v1/heartbeat</code> channel) and{" "}
            <strong><code className="text-xs">sequence_number</code> gaps</strong> in telemetry. A silence of{" "}
            <code className="text-xs">&gt; 90 s</code> on heartbeat marks the site OFFLINE in Exception
            Handling; incoming dispatch calls for that site are suspended until telemetry resumes.
          </p>
          <p className="text-xs">
            Dispatch audit is <em>not</em> rebuilt from telemetry &mdash; the{" "}
            <strong>Command Status API</strong> persists every transition independently, so
            Enexa&apos;s command history remains complete even when telemetry is missing.
          </p>
        </SummaryBlock>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// DISPATCH — Summary card (rendered only when mode === "dispatching")
// ---------------------------------------------------------------------------
function DispatchSummaryCard() {
  return (
    <Card className="border-l-4 border-l-orange-500">
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Info className="size-5 text-orange-500" />
              Summary
            </CardTitle>
            <CardDescription className="mt-1">
              The quick-read contract: when Enexa calls it, what goes in, what the sync ack looks
              like, and how real execution state flows back.
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">POST /api/v1/dispatch</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <SummaryBlock title="When it's called" icon={Clock} iconColor="text-orange-500">
          <p>
            <strong>Enexa-initiated</strong>. Called by the optimizer on its scheduled tick
            (every <strong>15 minutes</strong>, aligned to the EPEX imbalance-settlement period), and
            on-demand whenever a material state change invalidates the current plan &mdash; e.g. a new
            EV plug-in, grid-limit breach, or price alert.
          </p>
          <p>
            Granularity is <strong>per site, per plan</strong>: one POST carries the full setpoint
            block for a site. A new <code className="text-xs">command_id</code> is assigned on each
            call. Subsequent calls within a valid-until window <em>supersede</em> the previous one.
          </p>
          <p className="text-xs text-muted-foreground">
            <strong>Note:</strong> supersede is now scoped per{" "}
            <code className="text-[11px]">(site_id, asset_id)</code> rather than per site &mdash; a new
            command only supersedes a prior in-flight command for the same chargepost.
          </p>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="What's in the payload" icon={Package} iconColor="text-chart-2">
          <p>A compact envelope plus a station block and per-unit setpoints:</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="p-2 rounded-md border bg-muted/30 text-xs">
              <span className="font-mono font-semibold text-foreground">envelope</span>
              <span className="block text-muted-foreground mt-0.5">
                <code>command_type</code>, <code>command_id</code>, <code>site_id</code>,{" "}
                <code>asset_id</code>, <code>timestamp</code>, <code>valid_until</code>,{" "}
                <code>metadata</code>
              </span>
            </div>
            <div className="p-2 rounded-md border bg-muted/30 text-xs">
              <span className="font-mono font-semibold text-foreground">station</span>
              <span className="block text-muted-foreground mt-0.5">
                <code>operation_mode</code>, <code>grid_mgmt_mode</code> (always 0 = Automatic),{" "}
                the arbitrage lever <code>P_grid_clearance_w</code>, plus{" "}
                <code>soc_reserve_pct</code> &amp; <code>soc_cp_max_pct</code> &mdash; all
                re-asserted every tick.
              </span>
            </div>
            <div className="p-2 rounded-md border bg-muted/30 text-xs">
              <span className="font-mono font-semibold text-foreground">chargers[]</span>
              <span className="block text-muted-foreground mt-0.5">
                <code>charging_mode</code> (auto topology) + <code>P_ev_limit_w</code> (EV safety
                clamp) per power unit. No per-unit grid request &mdash; the station owns the split.
              </span>
            </div>
          </div>
          <p className="text-xs">
            Full field reference in <em>Payload Details</em> below.
          </p>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="How Enexa builds the request" icon={ListOrdered} iconColor="text-chart-3">
          <ol className="list-decimal pl-4 space-y-1.5">
            <li>
              <strong>Snapshot + decide:</strong> fetch fresh telemetry (SoC, EV load) and the
              cached price curve, then run the dispatch kernel to produce the decision for{" "}
              <em>now</em> &mdash; a grid-import clearance, an anticipatory SoC reserve, and a
              charge target.
            </li>
            <li>
              <strong>Clamp against site limits:</strong> the commanded{" "}
              <code className="text-xs">P_grid_clearance_w</code> is clamped to the configured DSO
              envelope read from telemetry (never raised above it). Corrupt inputs fall back to
              safe defaults (80&nbsp;kW clearance, reserve 40&nbsp;%, target 95&nbsp;%).
            </li>
            <li>
              <strong>Allocate <code className="text-xs">command_id</code>:</strong> deterministic
              and idempotent &mdash; <code className="text-xs">cmd_&#123;asset_id&#125;_&#123;UTC timestamp to ms&#125;</code>.
            </li>
            <li>
              <strong>Set <code className="text-xs">valid_until</code>:</strong>{" "}
              <code className="text-xs">timestamp + TICK_MS</code> (default <strong>15 s</strong>) &mdash;
              the dead-man&apos;s switch.
            </li>
            <li>
              <strong>POST</strong> to the Middleware dispatch endpoint, authenticated with the
              site&apos;s dispatch credentials.
            </li>
          </ol>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="Synchronous response (happy path)" icon={CheckCircle2} iconColor="text-green-600">
          <p>
            Middleware answers <strong>synchronously</strong> within 3 s. The response is a{" "}
            <strong>pure acknowledgement</strong> that the payload was received, parsed, and
            queued &mdash; <em>not</em> that any setpoint has been validated against site limits
            or written to Modbus. All execution detail (including whether any setpoint was
            ultimately clipped or rejected) flows back on the <strong>Command Status API</strong>.
          </p>
          <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs overflow-x-auto">
            <pre>{`HTTP/1.1 200 OK
Content-Type: application/json

{
  "command_id":  "cmd_chargepost_gronau_001_20260609_110000_000",
  "status":      "accepted",                  // accepted | rejected
  "received_at": "2026-06-09T11:00:00.182Z"
}`}</pre>
          </div>
          <p className="text-xs">
            Only two sync outcomes exist: <code className="text-xs">accepted</code> (stored, will
            be executed) or <code className="text-xs">rejected</code> (malformed / auth / expired
            &mdash; see the <em>Error Handling</em> card below for the full code table). There is
            no &quot;partial&quot; outcome at this layer.
          </p>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="Async execution feedback" icon={Activity} iconColor="text-primary">
          <p>
            Real hardware-level execution state flows back through the{" "}
            <strong>Command Status API</strong> (<code className="text-xs">POST /api/v1/command-events</code>),
            not this endpoint and not telemetry. Every time this <code className="text-xs">command_id</code>{" "}
            changes state on the Middleware side, Middleware posts a single event:
          </p>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30" variant="outline">accepted</Badge>
            <ArrowRight className="size-3 text-muted-foreground" />
            <Badge className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 border-yellow-500/30" variant="outline">executing</Badge>
            <ArrowRight className="size-3 text-muted-foreground" />
            <Badge className="bg-green-500/10 text-green-700 dark:text-green-500 border-green-500/30" variant="outline">executed</Badge>
            <span className="text-muted-foreground mx-1">or</span>
            <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30">deviated</Badge>
            <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30">superseded</Badge>
            <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30">timed_out</Badge>
            <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30">rejected</Badge>
          </div>
          <p>
            Events are individually acked and retried (at-least-once), so no transition is ever lost
            &mdash; and dispatch feedback latency is independent of telemetry cadence. See the{" "}
            <strong>Command Status API</strong> page for the full contract.
          </p>
        </SummaryBlock>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// DISPATCH — Error Handling card
// ---------------------------------------------------------------------------
function DispatchErrorHandlingCard() {
  return (
    <Card className="border-l-4 border-l-red-500">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="size-5 text-red-500" />
          Error Handling
        </CardTitle>
        <CardDescription>
          How Middleware rejects bad dispatches, how Enexa handles ack failures, and why the
          optimizer does not retry specific commands.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h4 className="font-semibold text-sm mb-3">Response codes</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Code</TableHead>
                <TableHead className="w-[180px]">Meaning</TableHead>
                <TableHead>Enexa action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell><Badge className="bg-green-600">200</Badge></TableCell>
                <TableCell className="text-sm font-mono">OK &mdash; accepted</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Persist <code className="text-xs">command_id</code> &rarr; plan mapping; await async
                  execution state via the <strong>Command Status API</strong>. Any clip / drop of
                  individual setpoints will be reported there, not here.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="destructive">400</Badge></TableCell>
                <TableCell className="text-sm font-mono">Bad Request</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Schema violation or expired <code className="text-xs">valid_until</code>. <strong>Do NOT retry</strong>;
                  raise <code className="text-xs">enexa.dispatch_schema_error</code> alert, re-plan.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="destructive">401 / 403</Badge></TableCell>
                <TableCell className="text-sm font-mono">Auth failure</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Rotate <code className="text-xs">dispatch_api_key</code> via the site-provisioning workflow.
                  Commands suspended for this site until auth restored.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge className="bg-yellow-600">409</Badge></TableCell>
                <TableCell className="text-sm font-mono">Conflict &mdash; superseded</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  A newer <code className="text-xs">command_id</code> is already active.
                  Optimizer drops this plan; newer plan continues.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="destructive">422</Badge></TableCell>
                <TableCell className="text-sm font-mono">Rejected &mdash; safety veto</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Middleware&apos;s local safety rules blocked the dispatch (grid-limit, thermal,
                  contactor, SOC guard). Body contains <code className="text-xs">reason</code> code.
                  Re-plan on next tick with the updated constraint.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="destructive">5xx</Badge></TableCell>
                <TableCell className="text-sm font-mono">Middleware error</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Enexa does <strong>not retry this command</strong>. The optimizer tick is idempotent
                  &mdash; the next tick (up to 15 min later, or immediately on trigger) produces a fresh plan.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="outline">timeout</Badge></TableCell>
                <TableCell className="text-sm font-mono">Response &gt; 3 s</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Treated as rejected. Optimizer re-plans. Middleware may still apply setpoints if
                  they eventually arrive &mdash; Enexa reconciles via the <strong>Command Status API</strong>.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <Separator />

        <SummaryBlock title="Why Enexa does not retry commands" icon={XCircle} iconColor="text-red-500">
          <p>
            Unlike telemetry (where retries preserve event history), <strong>dispatch is idempotent at
            the tick level, not the command level</strong>. A 5-minute-old setpoint is usually wrong
            by the time it arrives &mdash; prices, SOC, and EV sessions have all shifted. Retrying a
            stale command risks violating <code className="text-xs">valid_until</code> or fighting a newer plan.
          </p>
          <p>
            The correct recovery is to <strong>re-plan</strong> on the next optimizer tick (or
            immediately via the on-demand trigger), which naturally produces a fresh{" "}
            <code className="text-xs">command_id</code> with a valid window.
          </p>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="Safety-veto reason codes" icon={Shield} iconColor="text-red-500">
          <p>When Middleware returns <code className="text-xs">422</code>, the body includes a machine-readable reason:</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded-md border bg-muted/30">
              <code className="font-semibold">grid_limit_exceeded</code>
              <div className="text-muted-foreground mt-0.5">Setpoint breaches PCC contracted power.</div>
            </div>
            <div className="p-2 rounded-md border bg-muted/30">
              <code className="font-semibold">thermal_derate</code>
              <div className="text-muted-foreground mt-0.5">Battery temperature forces reduced power.</div>
            </div>
            <div className="p-2 rounded-md border bg-muted/30">
              <code className="font-semibold">soc_guard</code>
              <div className="text-muted-foreground mt-0.5">SOC outside operating envelope.</div>
            </div>
            <div className="p-2 rounded-md border bg-muted/30">
              <code className="font-semibold">contactor_open</code>
              <div className="text-muted-foreground mt-0.5">Battery contactor not closed.</div>
            </div>
            <div className="p-2 rounded-md border bg-muted/30">
              <code className="font-semibold">modbus_write_failed</code>
              <div className="text-muted-foreground mt-0.5">Downstream Modbus error to ADS-TEC.</div>
            </div>
            <div className="p-2 rounded-md border bg-muted/30">
              <code className="font-semibold">ev_session_conflict</code>
              <div className="text-muted-foreground mt-0.5">Active EV session overrides the setpoint.</div>
            </div>
          </div>
        </SummaryBlock>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// COMMAND STATUS — Summary card
// ---------------------------------------------------------------------------
function CommandStatusSummaryCard() {
  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-primary" />
          Command Status API &mdash; Summary
        </CardTitle>
        <CardDescription>
          Dedicated feedback channel for dispatch commands. Event-driven, individually acked,
          independent of telemetry.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <SummaryBlock title="Why it's a separate API" icon={Info} iconColor="text-blue-500">
          <p>
            Dispatch feedback and state telemetry have different delivery requirements. State is
            <strong> at-most-once</strong> (a stale snapshot is useless) and flows on a fixed cadence;
            command-state transitions are <strong>at-least-once</strong> events (losing one breaks the
            audit log) and fire whenever the hardware moves, not on a clock.
          </p>
          <p>
            Separating them lets Enexa tune telemetry cadence for bandwidth without delaying
            dispatch feedback, and lets Middleware persist the command queue independently of the
            state pipeline.
          </p>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="When Middleware POSTs an event" icon={Activity} iconColor="text-orange-500">
          <p>
            Every transition of a dispatched <code className="text-xs">command_id</code> emits one
            event. A single dispatch typically produces 3&ndash;5 events across its lifetime:
          </p>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30" variant="outline">accepted</Badge>
            <ArrowRight className="size-3 text-muted-foreground" />
            <Badge className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 border-yellow-500/30" variant="outline">executing</Badge>
            <ArrowRight className="size-3 text-muted-foreground" />
            <Badge className="bg-green-500/10 text-green-700 dark:text-green-500 border-green-500/30" variant="outline">executed</Badge>
            <span className="text-muted-foreground mx-1">|</span>
            <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30">deviated</Badge>
            <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30">superseded</Badge>
            <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30">timed_out</Badge>
            <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30">rejected</Badge>
          </div>
          <p className="text-xs">
            The first event is typically emitted within ~50&nbsp;ms of the dispatch ack; subsequent
            events fire as soon as the Middleware observes the transition (Modbus readback,
            deviation-filter threshold, watchdog expiry, supersession).
          </p>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="Payload shape" icon={Package} iconColor="text-chart-2">
          <p>
            A single command-state event &mdash; flat JSON, keyed by <code className="text-xs">command_id</code>:
          </p>
          <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs overflow-x-auto">
            <pre>{`POST /api/v1/command-events
Content-Type: application/json
Authorization: Bearer <tenant_api_key>
X-Device-ID: <middleware_id>

{
  "event_id":     "evt_20240115_143000_182",
  "site_id":      "site_munich_01",
  "command_id":   "cmd_20240115_143000_001",
  "status":       "executing",
  "event_ts":     "2024-01-15T14:30:00.182Z",
  "received_at":  "2024-01-15T14:30:00.182Z",
  "applied_at":   "2024-01-15T14:30:00.612Z",
  "valid_until":  "2024-01-15T14:45:00Z",
  "deviation_pct": 1.8,
  "reason":        null,
  "supersedes":    "cmd_20240115_142800_001"
}`}</pre>
          </div>
          <p className="text-xs">
            Field-by-field reference lives in <em>Payload Details</em> below.
          </p>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="Response (happy path)" icon={CheckCircle2} iconColor="text-green-600">
          <p>
            Each event is individually acked. A <code className="text-xs">2xx</code> means Enexa has
            persisted it &mdash; Middleware can drop the event from its local queue. Empty body.
          </p>
          <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs overflow-x-auto">
            <pre>{`HTTP/1.1 202 Accepted`}</pre>
          </div>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="At-least-once delivery" icon={RefreshCw} iconColor="text-orange-500">
          <p>
            Middleware persists every emitted event in a local queue keyed by{" "}
            <code className="text-xs">event_id</code>. On any non-2xx or network failure, the event
            is retried with exponential backoff until acked. Enexa deduplicates by{" "}
            <code className="text-xs">event_id</code>, so a replayed event is a no-op.
          </p>
          <p className="text-xs">
            <strong>Queue cap:</strong> 1&nbsp;000 events. Beyond that Middleware evicts the oldest
            terminal-state events first and raises{" "}
            <code className="text-xs">middleware.command_queue_overflow</code> on the Heartbeat channel.
          </p>
        </SummaryBlock>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// COMMAND STATUS — Error Handling card
// ---------------------------------------------------------------------------
function CommandStatusErrorHandlingCard() {
  return (
    <Card className="border-l-4 border-l-red-500">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="size-5 text-red-500" />
          Error Handling
        </CardTitle>
        <CardDescription>
          Response codes, retry policy, and the guarantees the at-least-once contract places on
          both sides.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h4 className="font-semibold text-sm mb-3">Response codes</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Code</TableHead>
                <TableHead className="w-[180px]">Meaning</TableHead>
                <TableHead>Middleware action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell><Badge className="bg-green-600">202</Badge></TableCell>
                <TableCell className="text-sm font-mono">Accepted</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Drop the event from the local queue. Done.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="destructive">400</Badge></TableCell>
                <TableCell className="text-sm font-mono">Bad Request (schema)</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Do <strong>not</strong> retry. Log, raise{" "}
                  <code className="text-xs">middleware.command_event_schema_error</code>, drop the event.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="destructive">401</Badge></TableCell>
                <TableCell className="text-sm font-mono">Unauthorized</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Token expired or revoked. Pull a fresh <code className="text-xs">tenant_api_key</code>{" "}
                  via the Config API, retry.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="destructive">409</Badge></TableCell>
                <TableCell className="text-sm font-mono">Duplicate event_id</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Idempotent success &mdash; Enexa already has this event. Drop from queue.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge className="bg-yellow-600">429</Badge></TableCell>
                <TableCell className="text-sm font-mono">Too Many Requests</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Back off per <code className="text-xs">Retry-After</code>. Events keep accumulating
                  in the local queue; delivery order is preserved per <code className="text-xs">command_id</code>.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="destructive">5xx</Badge></TableCell>
                <TableCell className="text-sm font-mono">Enexa server error</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Exponential-backoff retry. Event stays in queue until acked.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell><Badge variant="outline">timeout</Badge></TableCell>
                <TableCell className="text-sm font-mono">Request &gt; 5 s</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Treated as 5xx. Retry with the same <code className="text-xs">event_id</code> &mdash;
                  Enexa deduplicates.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <Separator />

        <SummaryBlock title="Retry policy" icon={RefreshCw} iconColor="text-primary">
          <p>
            Exponential backoff, jittered, per event. Retries apply to <strong>5xx, 429, and
            network-layer failures</strong>. 4xx (other than 401 / 409) are terminal for that event.
          </p>
          <div className="bg-muted/50 rounded-md p-3 font-mono text-xs">
            backoff = min(1s &times; 2^attempt, 60s) + random(0, 500ms)<br />
            max_attempts = unlimited (until acked or queue-overflow eviction)<br />
            on_queue_overflow =&gt; evict oldest terminal-state events first
          </div>
        </SummaryBlock>

        <Separator />

        <SummaryBlock title="What Enexa guarantees back" icon={ShieldAlert} iconColor="text-red-500">
          <p>
            Every <code className="text-xs">event_id</code> is persisted before the{" "}
            <code className="text-xs">202</code> is returned, so an ack is a durability guarantee,
            not an in-memory receipt. Duplicates are collapsed by <code className="text-xs">event_id</code>.
            A command lifecycle reconstructed by joining events on <code className="text-xs">command_id</code>{" "}
            and ordering by <code className="text-xs">event_ts</code> is always complete and
            monotonically-progressing &mdash; even across Middleware restarts or multi-hour Enexa outages.
          </p>
        </SummaryBlock>
      </CardContent>
    </Card>
  )
}

export function MiddlewareApiScreen({ mode = "all" }: { mode?: MiddlewareApiMode } = {}) {
  const showGeneral = mode === "all" || mode === "general"
  const showTelemetry = mode === "all" || mode === "telemetry"
  const showDispatching = mode === "all" || mode === "dispatching"
  const showCommandStatus = mode === "all" || mode === "command-status"
  // Summary + Error Handling blocks only render on the dedicated pages.
  const isDedicatedTelemetry = mode === "telemetry"
  const isDedicatedDispatching = mode === "dispatching"
  const isDedicatedCommandStatus = mode === "command-status"

  const defaultAccordion: string[] = []
  if (showTelemetry) defaultAccordion.push("monitoring")
  if (showDispatching) {
    defaultAccordion.push("dispatch")
    defaultAccordion.push("site-config")
  }
  if (showCommandStatus) defaultAccordion.push("command-status")
  if (showGeneral) defaultAccordion.push("registers")

  const meta =
    mode === "all"
      ? {
          title: "Middleware API",
          badges: ["Enexa ↔ Middleware", "Telemetry & Dispatch", "HTTPS / JSON"],
          description: (
            <>
              The interface contract between <strong>Enexa</strong> and{" "}
              <strong>Middleware</strong>. Defines the telemetry Middleware pushes to Enexa on a
              configurable cadence, the dispatch commands Enexa sends back, and the Modbus
              registers on the ADS-TEC ChargePost each field maps to &mdash; so the three teams
              stay in sync on a single source of truth.
            </>
          ),
        }
      : MODE_META[mode]

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-clip py-6 sm:py-8 px-3 sm:px-6 space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {meta.badges.map((b) => (
            <Badge key={b} variant="outline" className="text-[10px] tracking-wider uppercase">
              {b}
            </Badge>
          ))}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{meta.title}</h1>
        <p className="text-muted-foreground max-w-3xl leading-relaxed">{meta.description}</p>
      </div>

      {showGeneral && <>
      {/* Architecture Overview */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Server className="size-5 text-primary" />
            Integration Architecture
          </CardTitle>
          <CardDescription>
            How Enexa optimization communicates with Amperio infrastructure
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-lg border bg-primary/5 border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <Cpu className="size-5 text-primary" />
                <h4 className="font-semibold">Enexa</h4>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                Optimization engine, asset registry, configuration repository, and monitoring dashboards
              </p>
              <Badge variant="outline" className="text-xs">NITES Responsibility</Badge>
            </div>
            <div className="p-4 rounded-lg border bg-orange-500/5 border-orange-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Cable className="size-5 text-orange-500" />
                <h4 className="font-semibold">Middleware</h4>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                Centralized backend that routes commands to site controllers via Modbus/TCP
              </p>
              <Badge variant="outline" className="text-xs border-orange-500/50 text-orange-600">Amperio Responsibility</Badge>
            </div>
            <div className="p-4 rounded-lg border bg-muted">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="size-5 text-chart-3" />
                <h4 className="font-semibold">ADS-TEC ChargePost</h4>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                Ultrafast charging hardware with integrated battery storage (up to 300 kW)
              </p>
              <Badge variant="outline" className="text-xs border-orange-500/50 text-orange-600">Amperio</Badge>
            </div>
          </div>
          
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono bg-muted px-2 py-1 rounded">Enexa</span>
            <ArrowDownToLine className="size-4 text-primary" />
            <span className="text-primary font-medium">Commands</span>
            <ArrowDownToLine className="size-4" />
            <span className="font-mono bg-muted px-2 py-1 rounded">Middleware</span>
            <ArrowUpFromLine className="size-4 text-orange-500" />
            <span className="text-orange-500 font-medium">Telemetry</span>
            <ArrowUpFromLine className="size-4" />
            <span className="font-mono bg-muted px-2 py-1 rounded">Enexa</span>
          </div>
        </CardContent>
      </Card>

      {/* Data Purpose Legend */}
      <Card className="mb-6 border-primary/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Info className="size-5 text-primary" />
            Data Field Purpose Categories
          </CardTitle>
          <CardDescription>
            Each telemetry and command field is tagged with its primary purpose. Fields may have multiple tags if they serve multiple purposes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Quick Reference */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-2 rounded-lg border bg-blue-500/10 border-blue-500/30 text-center">
              <Badge className="bg-blue-600 text-white">OPT</Badge>
              <p className="text-xs mt-1 font-medium">Optimization</p>
            </div>
            <div className="p-2 rounded-lg border bg-green-500/10 border-green-500/30 text-center">
              <Badge className="bg-green-600 text-white">MON</Badge>
              <p className="text-xs mt-1 font-medium">Monitoring</p>
            </div>
            <div className="p-2 rounded-lg border bg-orange-500/10 border-orange-500/30 text-center">
              <Badge className="bg-orange-600 text-white">DSP</Badge>
              <p className="text-xs mt-1 font-medium">Dispatch</p>
            </div>
            <div className="p-2 rounded-lg border bg-purple-500/10 border-purple-500/30 text-center">
              <Badge className="bg-purple-600 text-white">IMP</Badge>
              <p className="text-xs mt-1 font-medium">Impact</p>
            </div>
          </div>

          <Separator />

          {/* Detailed Explanations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* OPT - Optimization */}
            <div className="p-4 rounded-lg border bg-blue-500/5 border-blue-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Calculator className="size-5 text-blue-600" />
                <Badge className="bg-blue-600 text-white">OPT</Badge>
                <span className="font-semibold text-blue-700">Optimization Engine Input</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Data required by the Enexa optimization algorithm to compute optimal dispatch schedules. These fields directly influence charge/discharge decisions.
              </p>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">When:</span>
                  <span className="text-muted-foreground">Polled every 15 minutes (aligned with EPEX market intervals)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">Used for:</span>
                  <span className="text-muted-foreground">SOC curve calculation, arbitrage decisions, EV load management, grid constraint adherence</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">Examples:</span>
                  <span className="text-muted-foreground">soc_pct, max_charge_w, max_discharge_w, P_EV_max_w, P_grid_clearance_w</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">Critical:</span>
                  <span className="text-muted-foreground">Missing OPT data = optimizer cannot run, falls back to safe defaults</span>
                </div>
              </div>
            </div>

            {/* MON - Monitoring */}
            <div className="p-4 rounded-lg border bg-green-500/5 border-green-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="size-5 text-green-600" />
                <Badge className="bg-green-600 text-white">MON</Badge>
                <span className="font-semibold text-green-700">Operational Monitoring</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Data displayed on NOC dashboards for real-time operational awareness. Enables operators to monitor system health and troubleshoot issues.
              </p>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <span className="text-green-600 font-bold">When:</span>
                  <span className="text-muted-foreground">Streamed continuously (1-5 second intervals for live dashboards)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-600 font-bold">Used for:</span>
                  <span className="text-muted-foreground">Status indicators, alert generation, health checks, diagnostic displays</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-600 font-bold">Examples:</span>
                  <span className="text-muted-foreground">charging_state, contactor_state, temp_min/max, operation_state, warnings</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-600 font-bold">Screens:</span>
                  <span className="text-muted-foreground">Site Overview, Fleet Status, System Health Dashboard</span>
                </div>
              </div>
            </div>

            {/* DSP - Dispatch */}
            <div className="p-4 rounded-lg border bg-orange-500/5 border-orange-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Target className="size-5 text-orange-600" />
                <Badge className="bg-orange-600 text-white">DSP</Badge>
                <span className="font-semibold text-orange-700">Dispatch Verification</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Data used to verify that dispatched commands were executed correctly. Compares commanded setpoints to actual system response.
              </p>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <span className="text-orange-600 font-bold">When:</span>
                  <span className="text-muted-foreground">Captured before/after each command (command-response pairing)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-orange-600 font-bold">Used for:</span>
                  <span className="text-muted-foreground">Command acknowledgment, deviation detection, audit logs, troubleshooting</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-orange-600 font-bold">Examples:</span>
                  <span className="text-muted-foreground">P_grid_w (telemetry, actual) vs P_grid_clearance_w (dispatch, commanded ceiling), charging_state, operation_mode</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-orange-600 font-bold">Screens:</span>
                  <span className="text-muted-foreground">Dispatch Log, Command History, Execution Status</span>
                </div>
              </div>
            </div>

            {/* IMP - Impact */}
            <div className="p-4 rounded-lg border bg-purple-500/5 border-purple-500/30">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="size-5 text-purple-600" />
                <Badge className="bg-purple-600 text-white">IMP</Badge>
                <span className="font-semibold text-purple-700">Impact Analysis & KPIs</span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Data used to calculate cost savings, demonstrate optimization value, and generate customer reports showing ROI of Smart Enexa layer.
              </p>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <span className="text-purple-600 font-bold">When:</span>
                  <span className="text-muted-foreground">Aggregated hourly/daily for reporting, stored historically for trend analysis</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-purple-600 font-bold">Used for:</span>
                  <span className="text-muted-foreground">Cost calculation, uplift metrics, counterfactual comparison, ROI dashboards</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-purple-600 font-bold">Examples:</span>
                  <span className="text-muted-foreground">E_grid_imp_kwh, E_grid_exp_kwh, E_EV_chg_kwh, P_grid_w (time-series)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-purple-600 font-bold">Screens:</span>
                  <span className="text-muted-foreground">Savings Dashboard, What-If Scenarios, Monthly Reports, Uplift Analysis</span>
                </div>
              </div>
            </div>
          </div>

          {/* Multi-Tag Note */}
          <div className="p-3 rounded-lg bg-muted/50 border">
            <p className="text-xs text-muted-foreground">
              <strong>Multi-Purpose Fields:</strong> Some fields serve multiple purposes. For example, <code className="bg-muted px-1 rounded">P_grid_w</code> is tagged 
              <Badge className="bg-blue-600 text-white text-xs mx-1">OPT</Badge> (optimization uses current grid power) and 
              <Badge className="bg-purple-600 text-white text-xs mx-1">IMP</Badge> (time-series used for cost calculation).
              When a field has multiple tags, it means the same data point flows to multiple systems.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Site & Asset Identification */}
      <Card className="mb-6 border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="size-5 text-primary" />
            API Payload Identification
          </CardTitle>
          <CardDescription>
            Every API call includes identifiers linking payloads to the asset registry configured during onboarding
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg border bg-blue-500/5 border-blue-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-blue-600 text-white">site_id</Badge>
              </div>
              <p className="text-sm font-medium mb-1">Site Identifier</p>
              <p className="text-xs text-muted-foreground mb-2">
                Unique identifier for the physical location. Assigned during site registration in Enexa portal.
              </p>
              <code className="text-xs bg-muted px-2 py-1 rounded block">&quot;site_id&quot;: &quot;site_abc123&quot;</code>
            </div>
            <div className="p-4 rounded-lg border bg-purple-500/5 border-purple-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-purple-600 text-white">asset_id</Badge>
              </div>
              <p className="text-sm font-medium mb-1">ChargePost Identifier</p>
              <p className="text-xs text-muted-foreground mb-2">
                Unique identifier for the ADS-TEC ChargePost unit at this site. Maps to hardware serial number.
              </p>
              <code className="text-xs bg-muted px-2 py-1 rounded block">&quot;asset_id&quot;: &quot;cp_01&quot;</code>
            </div>
            <div className="p-4 rounded-lg border bg-green-500/5 border-green-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-green-600 text-white">unit_id</Badge>
              </div>
              <p className="text-sm font-medium mb-1">Power Unit Identifier</p>
              <p className="text-xs text-muted-foreground mb-2">
                Sub-component within ChargePost (1 or 2). Each unit has independent battery + charger.
              </p>
              <code className="text-xs bg-muted px-2 py-1 rounded block">&quot;unit_id&quot;: 1</code>
            </div>
          </div>

          <Separator />

          <div className="p-4 rounded-lg bg-muted/50">
            <h4 className="font-semibold mb-3 flex items-center gap-2 text-sm">
              <ArrowRight className="size-4" />
              Hierarchy: Site → Asset → Unit
            </h4>
            <div className="bg-background rounded-lg p-4 font-mono text-xs overflow-x-auto">
              <pre>{`// Every telemetry POST includes envelope with identifiers
POST /api/v1/telemetry
{
  "site_id": "site_abc123",      // From Enexa Site Registry
  "asset_id": "cp_01",        // ChargePost serial/asset ID
  "timestamp": "2024-01-15T14:30:00Z", // ISO8601 UTC
  
  "batteries": [
    { "unit_id": 1, "soc_pct": 65, ... },
    { "unit_id": 2, "soc_pct": 62, ... }
  ],
  "chargers": [...],
  "grid": {...},
  "commands": [...]                    // Array of dispatch commands processed in this window
}

// Dispatch commands are routed using same identifiers
POST /api/v1/dispatch
{
  "site_id": "site_abc123",
  "asset_id": "cp_01",
  "command_id": "cmd_20240115_143000_001",  // Unique for ACK tracking
  "timestamp": "2024-01-15T14:30:00Z",
  
  "station": {...},
  "chargers": [
    { "unit_id": 1, "charging_mode": 1, ... },
    { "unit_id": 2, "charging_mode": 1, ... }
  ]
}`}</pre>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 rounded-lg border">
              <p className="text-sm font-medium mb-1">Telemetry Direction</p>
              <p className="text-xs text-muted-foreground">
                <strong>Middleware → Enexa:</strong> Middleware includes site_id + asset_id in every telemetry push. 
                Enexa uses these to route data to correct site dashboard and optimizer instance.
              </p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-sm font-medium mb-1">Dispatch Direction</p>
              <p className="text-xs text-muted-foreground">
                <strong>Enexa → Middleware:</strong> Enexa includes site_id + asset_id in dispatch commands. 
                Middleware validates these match its configured identity before executing.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      </>}

        {isDedicatedTelemetry && <TelemetrySummaryCard />}
        {isDedicatedDispatching && <DispatchSummaryCard />}
        {isDedicatedCommandStatus && <CommandStatusSummaryCard />}

        {(isDedicatedTelemetry || isDedicatedDispatching || isDedicatedCommandStatus) && (
          <div className="space-y-1 pt-2">
            <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Package className="size-5 text-primary" />
              Payload Details
            </h2>
            <p className="text-sm text-muted-foreground">
              Field-by-field reference for every value that crosses the wire. Expand the section
              below to inspect envelope, payload blocks, and their Modbus register mapping.
            </p>
          </div>
        )}

        <Accordion type="multiple" defaultValue={defaultAccordion} className="space-y-4">
        {showTelemetry && <>
        {/* MONITORING API */}
        <AccordionItem value="monitoring" className="border rounded-lg px-4 !border-b">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Activity className="size-5 text-green-600" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-base">Monitoring API (Telemetry)</h3>
                <p className="text-sm text-muted-foreground font-normal">Real-time data from site controllers to Enexa</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pt-2 pb-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ArrowUpFromLine className="size-5 text-orange-500" />
                    Telemetry Endpoint
                  </CardTitle>
                  <CardDescription>
                    Middleware pushes aggregated telemetry to Enexa every{" "}
                    <code className="text-[11px] font-mono bg-muted px-1 py-0.5 rounded">report_interval_s</code>{" "}
                    seconds (default <strong>1 s</strong>, configurable via Config API)
                  </CardDescription>
                </div>
                <Badge variant="outline" className="font-mono">POST /api/v1/telemetry</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Accordion
                type="multiple"
                defaultValue={["envelope"]}
                className="space-y-3"
              >
              {/* Envelope */}
              <AccordionItem
                value="envelope"
                className="border rounded-lg px-4 !border-b bg-muted/10"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <Package className="size-4 text-chart-3 shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">Envelope</h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        Identity + sequencing wrapped around every push
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    The envelope is the small set of top-level keys that sit <em>alongside</em>{" "}
                    <code className="text-[11px]">batteries[]</code>,{" "}
                    <code className="text-[11px]">chargers[]</code>, and{" "}
                    <code className="text-[11px]">grid</code> in every telemetry body. It
                    lets Enexa route the push to the right tenant, order late-arriving pushes,
                    and detect lost snapshots.
                  </p>
                  <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                    <pre>{`{
  "site_id": "site_munich_01",
  "asset_id": "ads_tec_cp_001",
  "timestamp": "2026-04-22T11:00:00.000Z",
  "sequence_number": 12845,
  "middleware_version": "1.4.2",
  "batteries": [ ... ],
  "chargers":  [ ... ],
  "grid":      { ... },
  "station":   { ... }
}`}</pre>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[180px]">Field</TableHead>
                        <TableHead className="w-[70px]">Purpose</TableHead>
                        <TableHead className="w-[150px]">Source</TableHead>
                        <TableHead>Why Needed &amp; How Used</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">site_id</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware identity</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Tenant routing.</strong> Assigned by Enexa during site onboarding and configured on the Middleware. Every row Enexa persists is partitioned on this key.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">asset_id</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware identity</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Asset attribution.</strong> Stable hardware identifier (the ChargePost itself). One <code className="text-xs">site_id</code> may cover multiple assets in future multi-station sites; for the pilot it is 1:1.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">timestamp</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware-generated</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Snapshot instant.</strong> ISO8601 moment the Modbus cache was read for this push. Clock-skew vs Enexa ingestion &gt; 5 min causes a <code className="text-xs">400</code> &mdash; NTP on the Middleware is a deploy prerequisite.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">sequence_number</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware-generated</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Gap detection.</strong> Monotonically increasing per site. A gap in Enexa&apos;s ingestion quantifies dropped pushes and drives the per-site integrity metric.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">middleware_version</TableCell>
                        <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware build</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Compatibility &amp; ops.</strong> Lets Enexa tolerate additive schema changes and lets the NOC see which Middleware build is running on each site at a glance.</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>

              {/* Batteries */}
              <AccordionItem
                value="batteries"
                className="border rounded-lg px-4 !border-b bg-muted/10"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <BatteryCharging className="size-4 text-chart-2 shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">
                        <code className="text-xs mr-1">batteries[]</code> &mdash; Battery State (per power unit)
                      </h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        One entry per of the two ChargePost battery strings
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  ADS-TEC ChargePost has two independent battery strings. Data mapped from Modbus registers charger.X.status.battery.*
                </p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto mb-4">
                  <pre>{`{
  "batteries": [
    {
      "unit_id": 1,
      "soc_pct": 65,
      "power_w": -25000,
      "temp_min_c": 28.5,
      "temp_max_c": 32.5,
      "max_charge_w": 110000,
      "max_discharge_w": 110000,
      "energy_empty_kwh": 45.2,
      "energy_full_kwh": 12.8,
      "contactor_state": "closed"
    },
    {
      "unit_id": 2,
      "soc_pct": 62,
      "power_w": -22000,
      ...
    }
  ]
}`}</pre>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px]">Field</TableHead>
                      <TableHead className="w-[70px]">Purpose</TableHead>
                      <TableHead className="w-[150px]">Modbus Source</TableHead>
                      <TableHead>Why Needed & How Used</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">unit_id</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">charger.1 / charger.2</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">Identifies which power unit (1 or 2). Used in dashboards to display per-unit status and in dispatch logs to track which unit executed commands.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">soc_pct</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">soc_cp (7006/17006)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Critical optimization input.</strong> Compared to target SOC curve to decide charge/discharge actions. Drives arbitrage decisions - if SOC low during cheap hours, charge; if SOC high during expensive hours, available for EV boost.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">power_w</TableCell>
                      <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">P_bat (7000/17000)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Dispatch verification.</strong> Compares actual power to commanded setpoint. Negative = discharge. Used to confirm commands executed correctly and detect deviations for alert generation.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">temp_min_c / temp_max_c</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">T_bat_min/max (7008-7010)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Safety monitoring only.</strong> Displayed on dashboard for operator awareness. Not used in optimization - hardware handles thermal derating automatically via P_bat_chg_max limits.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">max_charge_w</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">P_bat_chg_max (7012/17012)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization constraint.</strong> Real-time available charging headroom. Optimizer uses this to cap scheduled charge power - never commands more than hardware can accept. Reflects thermal/SOC derating.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">max_discharge_w</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">P_bat_dischg_max (7014/17014)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization constraint.</strong> Real-time available discharge capacity (up to 110kW/unit). Used to calculate maximum EV boost power and grid export potential during peak pricing.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">energy_empty_kwh</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">E_empty (7016/17016)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization input.</strong> Usable energy available for discharge. Critical for calculating: (1) How long can we boost EVs at a given power? (2) Total arbitrage potential in EUR during expensive hours.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">energy_full_kwh</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">E_full (7018/17018)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization input.</strong> Usable energy capacity for charging. Used to calculate: (1) How much cheap energy can we store? (2) Time required to reach target SOC at given charge rate.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">contactor_state</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">battery_contactor_state (7024/17024)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Operational monitoring.</strong> 0=undefined, 1=open, 2=closed. Displayed on dashboard. Must be closed for power flow - open state indicates fault or startup sequence.</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                </AccordionContent>
              </AccordionItem>

              {/* Grid */}
              <AccordionItem
                value="grid"
                className="border rounded-lg px-4 !border-b bg-muted/10"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <Zap className="size-4 text-primary shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">
                        <code className="text-xs mr-1">grid</code> &mdash; Grid Meter State
                      </h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        Single PCC reading &mdash; ground truth for grid-limit compliance
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Data from ChargePost integrated smart meter. Registers in &quot;grid.*&quot; namespace (addresses 1000+).
                </p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto mb-4">
                  <pre>{`{
  "grid": {
    "P_grid_w": 35000,
    "E_grid_imp_kwh": 245.6,
    "E_grid_exp_kwh": 12.3,
    "P_aux_w": 3200,
    "f_grid_hz": 50.01,
    "cos_phi": 0.98
  }
}`}</pre>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Field</TableHead>
                      <TableHead className="w-[70px]">Purpose</TableHead>
                      <TableHead className="w-[130px]">Modbus Source</TableHead>
                      <TableHead>Why Needed & How Used</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">P_grid_w</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge> <Badge className="text-xs bg-purple-600">IMP</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">grid.P_grid (1000)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Primary cost driver.</strong> Real-time grid import/export. Multiplied by EPEX price for cost calculation. Negative = export. Used in: (1) Optimization for real-time adjustments, (2) Impact dashboards showing actual vs baseline costs.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">E_grid_imp_kwh</TableCell>
                      <TableCell><Badge className="text-xs bg-purple-600">IMP</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">grid.E_grid_imp (1022)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Cost settlement.</strong> Cumulative import counter. Used for: (1) Daily/monthly cost calculations, (2) EPEX settlement validation, (3) KPI: total grid consumption vs baseline. Essential for uplift reporting.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">E_grid_exp_kwh</TableCell>
                      <TableCell><Badge className="text-xs bg-purple-600">IMP</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">grid.E_grid_exp (1024)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Revenue tracking.</strong> Cumulative export counter. Used for: (1) Feed-in tariff calculations if applicable, (2) Arbitrage profit calculation (sold high, bought low), (3) Grid support revenue attribution.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">P_aux_w</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">grid.P_aux (1026)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization constraint.</strong> Auxiliary load (HVAC, displays) up to 8kW. Subtracted from P_grid_clearance to get actual available capacity for charging. Important during hot/cold weather when HVAC load increases.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">f_grid_hz</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">grid.f_grid (1008)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Future use - monitoring only.</strong> Grid frequency (nominal 50Hz). Displayed on dashboard for grid health awareness. Phase 2: May trigger frequency containment reserve (FCR) participation if contracted.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">cos_phi</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">grid.cos_phi (1006)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Grid compliance monitoring.</strong> Power factor. Displayed on dashboard. Low values may indicate power quality issues. Some grid operators penalize poor power factor - useful for compliance reporting.</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground mt-3 p-2 bg-muted/50 rounded">
                  <strong>Note:</strong> Per-phase voltages (U_L1/L2/L3) and currents (I_L1/L2/L3) are available in registers 1010-1020 but <strong>not included in Phase 1 scope</strong>.
                  These are diagnostic data points useful for fault analysis but not required for optimization or standard monitoring. Add if grid quality analysis becomes a requirement.
                </p>
                </AccordionContent>
              </AccordionItem>

              {/* Chargers */}
              <AccordionItem
                value="chargers"
                className="border rounded-lg px-4 !border-b bg-muted/10"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <Car className="size-4 text-chart-4 shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">
                        <code className="text-xs mr-1">chargers[]</code> &mdash; EV Charging State (per charger unit)
                      </h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        One entry per connector &mdash; plug &amp; charging state, EV-negotiated limits, MID session energy
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  ChargePost has 2 charging points (charger.1 and charger.2). In coupled mode, both power units serve one connector.
                </p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto mb-4">
                  <pre>{`{
  "chargers": [
    {
      "unit_id": 1,
      "charging_state": "InProgress",
      "charging_process_state": "Charging",
      "plug_state": "Plugged",
      "P_EV_w": 145000,
      "P_EV_max_w": 150000,
      "P_cp_max_w": 150000,
      "P_grid_chg_max_w": 75000,
      "P_grid_dischg_max_w": 75000,
      "soc_EV_pct": 45,
      "t_bulk_s": 420,
      "t_full_s": 1260,
      "E_EV_chg_kwh": 23.5,
      "E_EVse_kwh": 23.48,
      "boost_contactor": "closed",
      "grid_contactor_state": "closed"
    },
    {
      "unit_id": 2,
      "charging_state": "Available",
      ...
    }
  ]
}`}</pre>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[170px]">Field</TableHead>
                      <TableHead className="w-[70px]">Purpose</TableHead>
                      <TableHead className="w-[140px]">Modbus Source</TableHead>
                      <TableHead>Why Needed & How Used</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">unit_id</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">charger.1 / charger.2</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Charger identification.</strong> Identifies which charging unit (1 or 2). Used in dashboards to show per-connector status and in logs to track which unit served which session.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">charging_state</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge> <Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">charging_state (3000/13000)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Dashboard & dispatch prerequisite.</strong> 0=NotAvailable, 1=Available, 2=InProgress. Displayed on monitoring dashboard. Optimizer checks state before sending EV-related commands - no commands sent if NotAvailable.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">charging_process_state</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">process_state (3001/13001)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Detailed monitoring only.</strong> States: Offline, ReadyToCharge, Authorization, ChargingSetup, Charging, ChargingTeardown, ChargingFinished, ChargingError. Enables detailed dashboard status and error diagnosis.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">plug_state</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">plug_state (3002/13002)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization trigger.</strong> 0=Unplugged, 1=Plugged. When plug_state changes to 1, optimizer immediately re-evaluates: Should we boost from battery? Throttle charging to cheap hours? Key event for real-time decisions.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">P_EV_w</TableCell>
                      <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge> <Badge className="text-xs bg-purple-600">IMP</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">P_EV (3008/13008)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Dispatch verification + KPI.</strong> Actual charging power in watts. Compared to P_cp_lim setpoint for verification. Summed over session for impact analysis: &quot;Session delivered X kWh at Y EUR average cost.&quot;</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">P_EV_max_w</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">P_EV_max (3010/13010)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization constraint.</strong> Maximum power EV currently accepts (ISO 15118/CHAdeMO). Optimizer never commands P_cp_lim above this - would be wasted headroom. Used to calculate: Can we shift load to cheaper hours and still finish in time?</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">P_cp_max_w</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">P_cp_max (3004/13004)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization constraint.</strong> Maximum power deliverable by chargepoint (hardware limit). Combined with P_EV_max and battery availability to calculate actual charging headroom for optimization.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">soc_EV_pct</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">soc_EV (3020/13020)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization input (if available).</strong> EV battery SOC communicated by vehicle. Used with energy_target (if V2G/smart charging) to calculate remaining kWh needed. Not all vehicles report this - optional field.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">E_EV_chg_kwh</TableCell>
                      <TableCell><Badge className="text-xs bg-purple-600">IMP</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">E_EV_chg (3021/13021)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Impact KPI.</strong> Energy delivered this session as counted by the charger&apos;s <em>internal</em> counter. Used for: (1) operational session tracking, (2) calculating per-session cost with time-weighted EPEX prices, (3) Impact dashboard: &quot;Saved X EUR vs flat-rate charging.&quot;</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">E_EVse_kwh</TableCell>
                      <TableCell><Badge className="text-xs bg-purple-600">IMP</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">E_EVse (3028/13028)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Billing / MID-certified reading.</strong> Session energy measured by the <strong>MID-certified DC meter</strong> on the charger output — this is the legally-binding value used for customer invoicing and regulatory audits. Distinct from <code>E_EV_chg</code> (internal counter): the two should track closely, and any persistent divergence flags a metering / calibration issue. Paired with the MID meter serial number exposed in Config API (<code>meters[].serial_number</code>) for full traceability.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">boost_contactor</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">boost_contactor_state (3031)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Monitoring only.</strong> 0=undefined, 1=open, 2=closed. Shows on dashboard whether 300kW coupled mode is active. Hardware manages coupling automatically based on charging_mode command.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">t_bulk_s</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">t_bulk (3024/13024)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization input.</strong> EV-reported seconds remaining until bulk SOC reached. Canonical answer to &quot;Can we shift load to cheaper hours and still finish in time?&quot; More reliable than inferring from soc_EV_pct (which not all EVs report).</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">t_full_s</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">t_full (3026/13026)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization input.</strong> EV-reported seconds remaining until 100% SOC. Used together with t_bulk_s to model charging curve taper and refine end-time predictions for cost-shifting decisions.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">P_grid_chg_max_w</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">P_grid_chg_max (3036/13036)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Dispatch safety bound.</strong> Per-charger maximum grid import power currently allowed (distinct from battery-only P_bat_chg_max). The kernel reads it so the commanded site-level <code className="text-[11px]">P_grid_clearance_w</code> never exceeds what the hardware can actually draw.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">P_grid_dischg_max_w</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">P_grid_dischg_max (3038/13038)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Dispatch safety bound.</strong> Per-charger maximum grid export (feed-in) power currently allowed. Constrains V2G / grid-export dispatch decisions. Reflects real-time derating from thermal, SOC, or grid-code limits.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">grid_contactor_state</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">grid_contactor_state (3044/13044)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Operational monitoring.</strong> 0=undefined, 1=open, 2=closed. Parallel to battery_contactor_state — grid path must be closed for any grid-side power flow. Displayed on dashboard; optimizer checks before issuing grid-export commands.</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                </AccordionContent>
              </AccordionItem>

              {/* Station */}
              <AccordionItem
                value="station"
                className="border rounded-lg px-4 !border-b bg-muted/10"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <Server className="size-4 text-primary shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">
                        <code className="text-xs mr-1">station</code> &mdash; Station Status (per site)
                      </h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        Site-wide state &mdash; op-mode, grid clearance limits, warnings &amp; errors
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Station-level status from registers in station.status.* namespace. Important for operational awareness.
                </p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto mb-4">
                  <pre>{`{
  "station": {
    "operation_state": "Ready",
    "P_grid_consumption_limit_w": 87000,
    "P_grid_generation_limit_w": 87000,
    "warnings": [],
    "errors": []
  }
}`}</pre>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">Field</TableHead>
                      <TableHead className="w-[70px]">Purpose</TableHead>
                      <TableHead className="w-[150px]">Modbus Source</TableHead>
                      <TableHead>Why Needed & How Used</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">operation_state</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">operation_state (2000)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Dashboard status.</strong> Values: Off, Startup, Ready, LeftCharge, RightCharge, BothCharge, Shutdown. Shows operational state on monitoring dashboard and helps diagnose why commands may not execute.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">P_grid_consumption_limit_w</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">P_grid_consumption_limit (2010)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization constraint.</strong> Maximum grid power consumption allowed without violating clearance. Dynamic value reflecting current limits. Optimizer uses this as upper bound for charge commands.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">P_grid_generation_limit_w</TableCell>
                      <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">P_grid_generation_limit (2012)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Optimization constraint.</strong> Maximum grid export power allowed. Limits how much battery discharge power can be fed back to grid. Critical for arbitrage optimization.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">warnings</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">station.status.warnings (2100)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Alert generation.</strong> Bitfield: watchdog_triggered, no_modbus_ctrl, manual_ctrl, P_clearance_violation, etc. Mapped to dashboard alerts. Helps diagnose control issues.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">errors</TableCell>
                      <TableCell><Badge className="text-xs bg-green-600">MON</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">station.status.errors.* (2110+)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Critical alerts.</strong> Hardware errors: CrashSensor_Triggered, USV_GridSupplyFailure, HVAC errors. Triggers immediate alerts to operators. Not used in optimization - system is typically non-functional.</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                </AccordionContent>
              </AccordionItem>

              {/* Full Payload Sample */}
              <AccordionItem
                value="full-sample"
                className="border rounded-lg px-4 !border-b border-primary/30 bg-primary/5"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <FileJson className="size-4 text-primary shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">Full payload sample</h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        Complete, copyable JSONC &mdash; envelope + all four blocks in one document
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    A single well-formed <code className="text-[11px]">POST /api/v1/telemetry</code>{" "}
                    body, annotated with inline comments (<code className="text-[11px]">//</code>).
                    Strip the comments before sending &mdash; the wire format is strict JSON.
                    All values are representative of a site serving a single EV on charger&nbsp;1
                    while charger&nbsp;2 is idle.
                  </p>
                  <CopyableCodeBlock
                    label="POST /api/v1/telemetry — request body"
                    language="jsonc"
                    code={`{
  // ---------- envelope ----------
  "site_id":            "site_munich_01",
  "asset_id":           "ads_tec_cp_001",
  "timestamp":          "2026-04-22T11:00:00.000Z",
  "sequence_number":    12845,
  "middleware_version": "1.4.2",

  // ---------- batteries[] (per power unit) ----------
  "batteries": [
    {
      "unit_id":          1,
      "soc_pct":          65,
      "power_w":          -25000,       // <0 = discharging
      "temp_min_c":       28.5,
      "temp_max_c":       32.5,
      "max_charge_w":     110000,       // real-time headroom (derated)
      "max_discharge_w":  110000,
      "energy_empty_kwh": 45.2,
      "energy_full_kwh":  12.8,
      "contactor_state":  "closed"      // "open" | "closed" | "undefined"
    },
    {
      "unit_id":          2,
      "soc_pct":          62,
      "power_w":          -22000,
      "temp_min_c":       28.1,
      "temp_max_c":       31.9,
      "max_charge_w":     110000,
      "max_discharge_w":  110000,
      "energy_empty_kwh": 43.1,
      "energy_full_kwh":  14.9,
      "contactor_state":  "closed"
    }
  ],

  // ---------- chargers[] (per connector) ----------
  "chargers": [
    {
      "unit_id":               1,
      "charging_state":        "InProgress",   // NotAvailable | Available | InProgress
      "charging_process_state":"Charging",
      "plug_state":            "Plugged",      // Unplugged | Plugged
      "P_EV_w":                145000,         // actual DC power to vehicle
      "P_EV_max_w":            150000,         // EV-negotiated ceiling
      "P_cp_max_w":            150000,         // hardware ceiling
      "P_grid_chg_max_w":      75000,
      "P_grid_dischg_max_w":   75000,
      "soc_EV_pct":            45,             // null if vehicle does not report
      "t_bulk_s":              420,
      "t_full_s":              1260,
      "E_EV_chg_kwh":          23.50,          // internal counter
      "E_EVse_kwh":            23.48,          // MID-certified meter
      "boost_contactor":       "closed",
      "grid_contactor_state":  "closed"
    },
    {
      "unit_id":               2,
      "charging_state":        "Available",
      "charging_process_state":"ReadyToCharge",
      "plug_state":            "Unplugged",
      "P_EV_w":                0,
      "P_EV_max_w":            0,
      "P_cp_max_w":            150000,
      "P_grid_chg_max_w":      75000,
      "P_grid_dischg_max_w":   75000,
      "soc_EV_pct":            null,
      "t_bulk_s":              null,
      "t_full_s":              null,
      "E_EV_chg_kwh":          0,
      "E_EVse_kwh":            0,
      "boost_contactor":       "open",
      "grid_contactor_state":  "closed"
    }
  ],

  // ---------- grid (single PCC reading) ----------
  "grid": {
    "P_grid_w":       35000,        // + import, - export (producer counting)
    "E_grid_imp_kwh": 245.6,        // cumulative MID import
    "E_grid_exp_kwh": 12.3,         // cumulative MID export
    "P_aux_w":        3200,         // HVAC + controllers
    "f_grid_hz":      50.01,
    "cos_phi":        0.98
  },

  // ---------- station (site-wide status) ----------
  "station": {
    "operation_state":            "BothCharge",
    "P_grid_consumption_limit_w": 87000,
    "P_grid_generation_limit_w":  87000,
    "warnings":                   [],
    "errors":                     []
  }
}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    <strong>Notes.</strong> Dispatch-feedback events are <em>not</em> part of this
                    payload &mdash; they travel on the dedicated{" "}
                    <strong>Command Status API</strong>. Null-valued fields are always emitted
                    (never omitted) so Enexa&apos;s schema validator sees a stable shape.
                  </p>
                </AccordionContent>
              </AccordionItem>
              </Accordion>

            </CardContent>
          </Card>
          </AccordionContent>
        </AccordionItem>
        </>}

        {showCommandStatus && <>
        {/* COMMAND STATUS API */}
        <AccordionItem value="command-status" className="border rounded-lg px-4 !border-b">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <CheckCircle2 className="size-5 text-primary" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-base">Command Status API (Dispatch Feedback)</h3>
                <p className="text-sm text-muted-foreground font-normal">
                  One event per command-state transition &mdash; independently acked, at-least-once
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pt-2 pb-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ArrowUpFromLine className="size-5 text-primary" />
                    Event Fields
                  </CardTitle>
                  <CardDescription>
                    Field-by-field reference for each <code className="text-xs">POST /api/v1/command-events</code> body.
                  </CardDescription>
                </div>
                <Badge className="bg-primary/10 text-primary border-primary/30">HTTPS / JSON</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Accordion
                type="multiple"
                defaultValue={["envelope"]}
                className="space-y-3"
              >
              {/* Envelope — identity + correlation */}
              <AccordionItem
                value="envelope"
                className="border rounded-lg px-4 !border-b bg-muted/10"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <Package className="size-4 text-chart-3 shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">Envelope</h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        Identity, tenant routing, and correlation back to the dispatch
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    The three top-level keys Enexa uses to deduplicate, route, and join each event
                    to its parent <code className="text-[11px]">POST /api/v1/dispatch</code>. Every
                    event in a command&apos;s lifecycle shares the same{" "}
                    <code className="text-[11px]">site_id</code> +{" "}
                    <code className="text-[11px]">command_id</code>; only{" "}
                    <code className="text-[11px]">event_id</code> is unique per event.
                  </p>
                  <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                    <pre>{`{
  "event_id":   "evt_20260609_110000_182",
  "site_id":    "site_munich_01",
  "command_id": "cmd_chargepost_gronau_001_20260609_110000_000",
  "status":     "...",
  "event_ts":   "...",
  // ...lifecycle + exception fields
}`}</pre>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[180px]">Field</TableHead>
                        <TableHead className="w-[70px]">Purpose</TableHead>
                        <TableHead className="w-[150px]">Source</TableHead>
                        <TableHead>Why Needed &amp; How Used</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">event_id</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware-generated</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Idempotency key.</strong> Unique per emitted event. Enexa deduplicates on this field, so a retried event after a 5xx or timeout is a no-op. Typical shape: <code>evt_YYYYMMDD_HHMMSS_ms</code>.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">site_id</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware identity</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Tenant routing.</strong> Same convention as telemetry &mdash; lets Enexa route the event to the correct tenant &amp; per-site dispatch ledger.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">command_id</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Echoed from dispatch</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Dispatch correlation.</strong> The <code>command_id</code> assigned on <code>POST /api/v1/dispatch</code>. Enexa joins all events for a command on this key &mdash; the lifecycle is reconstructed by ordering those rows by <code>event_ts</code>.</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>

              {/* Lifecycle — state + timing */}
              <AccordionItem
                value="lifecycle"
                className="border rounded-lg px-4 !border-b bg-muted/10"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <Activity className="size-4 text-green-600 shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">Lifecycle &mdash; state &amp; timing</h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        The state-machine transition this event announces + its four timestamps
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    The core fields that let Enexa reconstruct the execution lifecycle of a command
                    (accepted &rarr; executing &rarr; executed / deviated / superseded / timed_out /
                    rejected) and measure network, queue, and apply latencies. All five are always
                    present; <code className="text-[11px]">applied_at</code> is null until the
                    Middleware transitions to <code className="text-[11px]">executing</code>.
                  </p>
                  <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                    <pre>{`{
  // ...envelope fields
  "status":      "executing",
  "event_ts":    "2026-06-09T11:00:00.612Z",
  "received_at": "2026-06-09T11:00:00.182Z",
  "applied_at":  "2026-06-09T11:00:00.612Z",
  "valid_until": "2026-06-09T11:00:15.000Z",
  // ...exception fields
}`}</pre>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[180px]">Field</TableHead>
                        <TableHead className="w-[70px]">Purpose</TableHead>
                        <TableHead className="w-[150px]">Source</TableHead>
                        <TableHead>Why Needed &amp; How Used</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">status</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware-derived</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Execution state.</strong> Enum: <code>accepted</code> (validated, not yet written), <code>executing</code> (setpoints written, system converging), <code>executed</code> (hardware matches setpoints within tolerance), <code>deviated</code> (tracking error persists &gt; 60&nbsp;s), <code>superseded</code> (a newer command replaced it), <code>timed_out</code> (watchdog expired before apply), <code>rejected</code> (Modbus write failed / safety veto). Optimizer re-plans on any terminal state other than <code>executed</code>.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">event_ts</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware-generated</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Ordering key.</strong> ISO8601 moment the state transition was observed at the Middleware. Enexa orders events per <code>command_id</code> by this field when replaying the lifecycle.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">received_at</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware-generated</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Dispatch latency.</strong> ISO8601 timestamp when the Middleware received the HTTPS dispatch this command came from. Echoed on every event for that <code>command_id</code>. Combined with Enexa&apos;s send time gives network-path latency.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">applied_at</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware-generated</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Apply timestamp.</strong> ISO8601 moment the setpoints were written to ADS-TEC holding registers for this command. Null until <code>status == &quot;executing&quot;</code>. Bounds the attributable window for downstream energy KPIs.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">valid_until</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Echoed from dispatch</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Command expiry.</strong> Echoes the <code>valid_until</code> field Enexa included in the dispatch. After this instant (and absent a successor), Middleware auto-transitions to safe fallback &mdash; which also emits a final event. Lets operator UI show a live countdown per command.</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>

              {/* Exception detail + chain */}
              <AccordionItem
                value="exception"
                className="border rounded-lg px-4 !border-b bg-muted/10"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <AlertCircle className="size-4 text-yellow-600 shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">Exception detail &amp; command chain</h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        Populated only on non-happy paths and on optimizer re-plans
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Three fields that are null on the happy path but carry the root-cause + chain
                    information Enexa needs when execution doesn&apos;t land cleanly. Always emitted
                    (never omitted) so Enexa&apos;s schema validator sees a stable shape.
                  </p>
                  <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                    <pre>{`{
  // ...envelope + lifecycle fields
  "deviation_pct": 14.2,                    // null unless status == "deviated"
  "reason":        "grid_limit_hit",        // null on the happy path
  "supersedes":    "cmd_chargepost_gronau_001_20260609_105945_000" // null if not a re-plan
}`}</pre>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[180px]">Field</TableHead>
                        <TableHead className="w-[70px]">Purpose</TableHead>
                        <TableHead className="w-[150px]">Source</TableHead>
                        <TableHead>Why Needed &amp; How Used</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">deviation_pct</TableCell>
                        <TableCell><Badge className="text-xs bg-yellow-600">EXC</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware-computed</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Deviation signal.</strong> Rolling 60-s average of |measured &minus; commanded| &divide; commanded on the dominant setpoint (typically grid import vs the commanded <code>P_grid_clearance_w</code>) at the moment of the event. A value &gt; 10&nbsp;% is what promotes <code>status</code> to <code>deviated</code> and fires this event. Null while <code>status &isin; &#123;accepted, executed&#125;</code>.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">reason</TableCell>
                        <TableCell><Badge className="text-xs bg-yellow-600">EXC</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware-generated</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Root cause (non-happy paths).</strong> Human-readable string populated when <code>status</code> is <code>deviated</code>, <code>timed_out</code>, <code>rejected</code>, or <code>superseded</code>. E.g. <code>&quot;grid_limit_hit&quot;</code>, <code>&quot;thermal_derate&quot;</code>, <code>&quot;battery_contactor_open&quot;</code>, <code>&quot;modbus_write_failed&quot;</code>, <code>&quot;replaced_by_newer_dispatch&quot;</code>. Drives operator notifications and the &quot;why didn&apos;t my command execute?&quot; support flow.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">supersedes</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">CTL</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Middleware-tracked</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Command chain.</strong> The <code>command_id</code> this one replaced, if any (null otherwise). Together with <code>event_ts</code>, lets Enexa&apos;s audit log reconstruct the full causal sequence when multiple optimizer re-plans land in rapid succession.</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </AccordionContent>
              </AccordionItem>

              {/* Full event sample */}
              <AccordionItem
                value="full-sample"
                className="border rounded-lg px-4 !border-b border-primary/30 bg-primary/5"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <FileJson className="size-4 text-primary shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">Full event sample</h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        Complete, copyable JSONC &mdash; one event transitioning to{" "}
                        <code className="text-[11px]">executing</code>
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    A single well-formed <code className="text-[11px]">POST /api/v1/command-events</code>{" "}
                    body, annotated with inline comments (<code className="text-[11px]">//</code>).
                    Strip the comments before sending &mdash; the wire format is strict JSON. A
                    typical dispatch emits 3&ndash;5 of these across its lifetime.
                  </p>
                  <CopyableCodeBlock
                    label="POST /api/v1/command-events — request body"
                    language="jsonc"
                    code={`{
  // ---------- envelope ----------
  "event_id":      "evt_20260609_110000_182",  // idempotency key, unique per event
  "site_id":       "site_munich_01",
  "command_id":    "cmd_chargepost_gronau_001_20260609_110000_000",  // echoed from the dispatch

  // ---------- lifecycle ----------
  "status":        "executing",                // accepted | executing | executed |
                                               // deviated | superseded | timed_out | rejected
  "event_ts":      "2026-06-09T11:00:00.612Z", // when this transition was observed
  "received_at":   "2026-06-09T11:00:00.182Z", // when the parent dispatch landed
  "applied_at":    "2026-06-09T11:00:00.612Z", // when setpoints were written to Modbus
                                               // (null until status == "executing")
  "valid_until":   "2026-06-09T11:00:15.000Z", // echoed from the dispatch

  // ---------- exception detail (nulls on the happy path) ----------
  "deviation_pct": null,                       // populated only when status == "deviated"
  "reason":        null,                       // populated on deviated / timed_out /
                                               // rejected / superseded
  "supersedes":    null                        // command_id this one replaced, or null
}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    <strong>Notes.</strong> Null-valued fields are always emitted (never omitted)
                    so Enexa&apos;s schema validator sees a stable shape across all seven possible
                    values of <code className="text-[11px]">status</code>. Events are individually
                    acked &mdash; see <em>Delivery &amp; Retry</em> above for the full code table.
                  </p>
                </AccordionContent>
              </AccordionItem>
              </Accordion>

            </CardContent>
          </Card>
          </AccordionContent>
        </AccordionItem>
        </>}

        {showDispatching && <>
        {/* DISPATCH API */}
        <AccordionItem value="dispatch" className="border rounded-lg px-4 !border-b">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <Zap className="size-5 text-orange-600" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-base">Dispatch API &mdash; runtime arbitrage loop</h3>
                <p className="text-sm text-muted-foreground font-normal">
                  High-frequency per-tick setpoints from Enexa optimizer (volatile state only)
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pt-2 pb-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ArrowDownToLine className="size-5 text-primary" />
                    Dispatch Commands
                  </CardTitle>
                  <CardDescription>
                    The runtime arbitrage loop &mdash; one per-unit setpoint per tick. Sticky-state
                    (clearance, modes, hardware ceilings) lives in Site Configuration below.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="font-mono">POST /api/v1/dispatch</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Accordion
                type="multiple"
                defaultValue={["envelope"]}
                className="space-y-3"
              >
              {/* Envelope — command metadata */}
              <AccordionItem
                value="envelope"
                className="border rounded-lg px-4 !border-b bg-muted/10"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <Package className="size-4 text-chart-3 shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">
                        Envelope <span className="text-muted-foreground font-normal">&amp; metadata</span>
                      </h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        Identity, idempotency, command expiry &mdash; plus an informational{" "}
                        <code className="text-[11px]">metadata</code> object that never touches
                        Modbus
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Top-level keys that sit <em>alongside</em>{" "}
                    <code className="text-[11px]">station</code> and{" "}
                    <code className="text-[11px]">chargers[]</code> in every dispatch body. They
                    let Middleware route the command to the right site, deduplicate replays, and
                    auto-revert to safe fallback after{" "}
                    <code className="text-[11px]">valid_until</code>. The optional{" "}
                    <code className="text-[11px]">metadata</code> object carries operator-facing
                    context (price zone + the triggering event type) that Middleware stores in its
                    audit log but never writes to hardware.
                  </p>
                  <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                    <pre>{`{
  "site_id":      "site_munich_01",
  "asset_id":     "chargepost_gronau_001",
  "command_type": "dispatch",
  "command_id":   "cmd_chargepost_gronau_001_20260609_110000_000",
  "timestamp":    "2026-06-09T11:00:00.000Z",
  "valid_until":  "2026-06-09T11:00:15.000Z",
  "metadata":     { "price_zone": "cheap", "event_type": "price_update" },
  "station":      { ... },
  "chargers":     [ ... ]
}`}</pre>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[180px]">Field</TableHead>
                        <TableHead className="w-[70px]">Purpose</TableHead>
                        <TableHead className="w-[150px]">Source</TableHead>
                        <TableHead>Why Needed &amp; How Used</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">site_id</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Enexa &rarr; Middleware</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Target routing.</strong> Same tenant identifier used everywhere else. Middleware rejects the dispatch if this does not match its configured site.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">asset_id</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Enexa &rarr; Middleware</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Required.</strong> Names the specific chargepost at the site (e.g. <code>&quot;chargepost_gronau_001&quot;</code>). A single <code>site_id</code> can host multiple assets, so the downstream system requires this to route the command to the correct chargepost. String.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">command_type</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Enexa-generated</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Command discriminator.</strong> <code>&quot;dispatch&quot;</code> = a real, actuating command (default). <code>&quot;test&quot;</code> = an inert liveness probe the edge device must recognise and ignore (see the liveness-probe note in the full-payload sample). Lets the device branch on the command kind without inspecting individual setpoints.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">command_id</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Enexa-generated</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Idempotency + correlation.</strong> Deterministic, built as <code>cmd_&#123;asset_id&#125;_&#123;UTC YYYYMMDD_HHMMSS_mmm&#125;</code>. A second POST with the same <code>command_id</code> is a no-op &mdash; Middleware returns the original ack. Every event on the Command Status API echoes this key.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">timestamp</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Enexa-generated</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Send instant.</strong> ISO8601 moment the optimizer committed the setpoints. Paired with <code>received_at</code> on the Command Status API it quantifies network &amp; queue latency.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">valid_until</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">Enexa-generated</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Dead-man&apos;s switch.</strong> ISO8601 instant after which the command expires. Set to <code>timestamp + TICK_MS</code> (default <strong>~15&nbsp;s</strong>). Absent a fresh successor, the station auto-reverts to its own fallback and Middleware emits a final event on the Command Status API. This single mechanism covers <em>every</em> upstream failure (event creator, telemetry, planner, or middleware down).</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>

                  {/* metadata sub-section */}
                  <div className="pt-2">
                    <div className="flex items-center gap-2 mb-2">
                      <Info className="size-4 text-blue-500" />
                      <h5 className="font-semibold text-sm">
                        <code className="text-xs mr-1">metadata</code>
                        <span className="text-muted-foreground font-normal">&mdash; informational only (never written to Modbus)</span>
                      </h5>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Optional top-level object. Middleware echoes its contents into the audit
                      log alongside the matching <code className="text-[11px]">command_id</code>,
                      but performs no hardware action on them. Drives operator-dashboard copy
                      (&quot;why did Enexa pick this setpoint?&quot;) without giving Middleware a
                      second set of levers for the physical effect already reachable via the
                      station-level <code className="text-[11px]">P_grid_clearance_w</code>.
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">Field</TableHead>
                          <TableHead className="w-[70px]">Purpose</TableHead>
                          <TableHead className="w-[150px]">Source</TableHead>
                          <TableHead>Why Needed &amp; How Used</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-mono text-xs">metadata.price_zone</TableCell>
                          <TableCell><Badge className="text-xs" variant="secondary">INFO</Badge></TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">Enexa-computed</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground"><strong>Price classification.</strong> Enum: <code>cheap</code> | <code>moderate</code> | <code>expensive</code> | <code>peak</code>. Enexa derives it from EPEX prices using percentile thresholds. Appears verbatim in Middleware&apos;s audit log and the operator dashboard &mdash; <em>no Modbus effect</em>. The physical decision is the station-level <code>P_grid_clearance_w</code>.</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-xs">metadata.event_type</TableCell>
                          <TableCell><Badge className="text-xs" variant="secondary">INFO</Badge></TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">Enexa-generated</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground"><strong>Triggering event.</strong> Echoes the <code>eventType</code> that fired this tick (e.g. <code>price_update</code>, <code>ev_plug_event</code>, <code>grid_constraint</code>, <code>test</code>). Answers &quot;why did the optimizer recompute now?&quot; in the operator UI and the audit trail. Omitted on scheduled pinger ticks. <em>No Modbus effect.</em></TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* station — control-mode assertion */}
              <AccordionItem
                value="station"
                className="border rounded-lg px-4 !border-b bg-muted/10"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <SlidersHorizontal className="size-4 text-chart-4 shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">
                        <code className="text-xs mr-1">station</code> &mdash; control-mode
                        assertion (re-asserted every tick)
                      </h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        Claims external control so the per-unit setpoints are actually honoured
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="size-4 text-red-600 shrink-0" />
                      <span className="font-semibold text-sm">
                        Without this block the device silently ignores every setpoint
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Per ChargePost interface spec &sect;2.7, our station setpoints are only
                      actuated when the station is in{" "}
                      <code className="text-[11px]">operation_mode = 1</code> (Active). In v3 the
                      station always runs <code className="text-[11px]">grid_mgmt_mode = 0</code>{" "}
                      (Automatic) &mdash; the firmware does the EV/battery split itself within the{" "}
                      <code className="text-[11px]">P_grid_clearance_w</code> ceiling we set. We
                      re-assert <code className="text-[11px]">operation_mode = 1</code> on{" "}
                      <strong>every</strong> dispatch so a device reboot, firmware fallback,
                      watchdog revert, or manual technician flip self-heals on the next tick
                      (&le; 15 s) instead of leaving us silently uncontrolled.
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs sm:text-sm overflow-x-auto mb-4">
                    <pre>{`{
  "station": {
    "operation_mode":     1,      // 1 = Active (external EMS controls)
    "grid_mgmt_mode":     0,      // ALWAYS 0 = Automatic (v3)
    "P_grid_clearance_w": 80000,  // THE lever: grid import ceiling (W)
    "soc_reserve_pct":    40,     // anticipatory floor SoC (%)
    "soc_cp_max_pct":     95      // charge target SoC (%)
  }
}`}</pre>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[170px]">Field</TableHead>
                        <TableHead className="w-[70px]">Purpose</TableHead>
                        <TableHead className="w-[170px]">Modbus Register</TableHead>
                        <TableHead>Why Needed &amp; How Used</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">operation_mode</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">operation_mode (2501)</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Control claim.</strong> <code>0</code> = Standby (station inactive), <code>1</code> = Active (external EMS in control). Held at <code>1</code> for the whole arbitrage session; set to <code>0</code> only when the dispatcher cleanly releases the site.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">grid_mgmt_mode</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">grid_mgmt_mode (2502)</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Always 0 (Automatic) in v3.</strong> The firmware computes the EV/battery split itself and respects our <code>P_grid_clearance_w</code> ceiling. (The retired v2 manual mode, <code>1</code>, drove per-unit <code>P_grid_request_w</code> directly &mdash; no longer sent.) Re-asserted every tick.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">P_grid_clearance_w</TableCell>
                        <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">P_grid_clearance (2506)</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>The one arbitrage lever.</strong> Max grid import ceiling (W). Cheap hours &rarr; high clearance (charge battery + serve EV from grid); expensive hours &rarr; low clearance (battery supplements EV). Clamped to the DSO envelope read from telemetry; never raised above it.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">soc_reserve_pct</TableCell>
                        <TableCell><Badge className="text-xs bg-blue-600">OPT</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">soc_reserve (517)</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Anticipatory floor SoC.</strong> The battery is held at or above this level so it can cover an expensive-hour EV draw. Recomputed by the kernel every tick from the price curve and upcoming sessions.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">soc_cp_max_pct</TableCell>
                        <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">soc_cp_max (515)</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Charge target SoC.</strong> Upper bound the station charges the battery to (default 95&nbsp;%). Bounds how much cheap energy we store; the warranty ceiling lives in Site Config.</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>

                  {/* Watchdog liveness callout (P2) */}
                  <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 mt-4">
                    <div className="flex items-center gap-2 mb-1">
                      <RefreshCw className="size-4 text-blue-600 shrink-0" />
                      <span className="font-semibold text-sm">
                        Watchdog liveness &mdash; why control never lapses
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The ChargePost runs a hardware watchdog (
                      <code className="text-[11px]">station.mgmt.watchdog_interval</code>, reg 2500,
                      configurable <strong>2&ndash;60 s</strong>). If it is not refreshed before it
                      expires, the firmware drops external control and reverts to its safe fallback
                      clearance &mdash; exactly the silent-loss-of-control failure the{" "}
                      <code className="text-[11px]">station</code> mode flags guard against.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      <strong>This is owned by the on-site Middleware, not Vercel Cron.</strong>{" "}
                      Middleware polls the Enexa <strong>tick endpoint every 15&nbsp;s</strong> and,
                      on each poll, writes the returned setpoints + mode flags <em>and</em> refreshes
                      the watchdog register. A fixed 15&nbsp;s cadence sits comfortably inside the
                      60&nbsp;s window, so a missed Enexa optimizer tick, serverless cold start, or
                      coarse cron schedule can never expire the watchdog. If Enexa itself goes
                      unreachable for{" "}
                      <code className="text-[11px]">telemetry.missed_push_threshold_s</code> (default
                      30&nbsp;s), Middleware switches to <strong>LOCAL AUTONOMOUS</strong> safe
                      fallback rather than holding a stale setpoint.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* chargers[] — per-unit commands */}
              <AccordionItem
                value="chargers"
                className="border rounded-lg px-4 !border-b bg-muted/10"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <BatteryCharging className="size-4 text-chart-2 shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">
                        <code className="text-xs mr-1">chargers[]</code> &mdash; Per-unit topology
                        &amp; EV clamp (charger.1 / charger.2)
                      </h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        Per-unit setpoints each tick &mdash;{" "}
                        <code className="text-[11px]">charging_mode</code>,{" "}
                        <code className="text-[11px]">P_ev_limit_w</code>
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Each power unit carries two device-actuated setpoints the kernel owns:{" "}
                  <code className="text-[11px]">charging_mode</code>{" "}
                  (auto-selected from live plug / coupling state) and{" "}
                  <code className="text-[11px]">P_ev_limit_w</code> (the EV power safety clamp).
                  There is no per-unit grid request &mdash; the firmware resolves the EV/battery
                  split internally within the station-level{" "}
                  <code className="text-[11px]">P_grid_clearance_w</code> ceiling.
                  The control-mode flags + clearance + SoC band travel in the{" "}
                  <code className="text-[11px]">station</code> block above; the remaining site
                  controls &mdash; hardware ceilings, audit tag &mdash; are sticky-state owned by the
                  Site Configuration endpoint below.
                </p>
                <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs sm:text-sm overflow-x-auto mb-4">
                  <pre>{`{
  "chargers": [
    { "unit_id": 1, "charging_mode": 1, "P_ev_limit_w": 150000 },
    { "unit_id": 2, "charging_mode": 1, "P_ev_limit_w": 150000 }
  ]
}`}</pre>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px]">Field</TableHead>
                      <TableHead className="w-[70px]">Purpose</TableHead>
                      <TableHead className="w-[150px]">Modbus Register</TableHead>
                      <TableHead>Why Needed &amp; How Used</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">unit_id</TableCell>
                      <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">charger.1 / charger.2</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Target unit identifier.</strong> Specifies which power unit (1 or 2) receives the command. Required to route to the correct Modbus address space (12xxx vs 22xxx).</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">charging_mode</TableCell>
                      <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">charging_mode (12000/22000)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>Auto-selected topology / enable state.</strong> 0=Off, 1=Single (&le;150&nbsp;kW), 2=Dual (coupled, &le;300&nbsp;kW). The kernel picks it per tick from live plug/couple telemetry. Re-asserted every tick so a reboot self-heals. <em>Not</em> an arbitrage lever &mdash; the arbitrage decision is the station <code>P_grid_clearance_w</code>.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">P_ev_limit_w</TableCell>
                      <TableCell><Badge className="text-xs bg-orange-600">DSP</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">P_cp_lim (12001/22001)</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>EV power safety clamp.</strong> Max power deliverable to the EV on this connector (W). Set to the live connector max (<code className="text-[11px]">p_cp_max_w</code>, or the static 150/300&nbsp;kW topology rating when absent) so the vehicle always gets full power &mdash; the kernel <em>never</em> throttles the EV for arbitrage. The arbitrage lever is the station-level <code className="text-[11px]">P_grid_clearance_w</code>.</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>

                {/* Commissioning / sticky-state callout */}
                <div className="p-3 sm:p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 mt-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-amber-600 shrink-0" />
                    <span className="font-semibold text-sm">Intentionally NOT in the dispatch payload</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Everything that does not change between consecutive ticks lives in{" "}
                    <strong>Site Configuration</strong>, not here. The dispatch payload carries
                    only the volatile arbitrage decision; every other lever is sticky-state.
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                    <li>
                      <code className="text-[11px]">chargers[].soc_cp_max</code> &mdash; BESS SOC
                      ceiling; warranty &amp; longevity policy (typically 85&ndash;90&nbsp;%),
                      fixed at commissioning. There is no <code className="text-[11px]">soc_cp_min</code>{" "}
                      register in hardware &mdash; the SOC floor concept does not exist.
                    </li>
                    <li>
                      <code className="text-[11px]">config.soc_reserve</code> &mdash; SOC reserved
                      for grid operations (reg&nbsp;517); a commissioning constant the kernel reads
                      but never writes.
                    </li>
                    <li>
                      <code className="text-[11px]">external_control_id</code> &mdash; audit tag
                      written once at commissioning.
                    </li>
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Note: <code className="text-[11px]">charging_mode</code>,{" "}
                    <code className="text-[11px]">P_ev_limit_w</code>,{" "}
                    <code className="text-[11px]">station.P_grid_clearance_w</code>,{" "}
                    <code className="text-[11px]">soc_reserve_pct</code>, and{" "}
                    <code className="text-[11px]">soc_cp_max_pct</code> are NOT in this list &mdash;
                    the kernel owns them and re-asserts them every tick (clearance is clamped to the
                    DSO envelope and never raised). Site Configuration still holds their
                    commissioning <em>source</em> values.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    All of the above are owned by{" "}
                    <code className="text-[11px]">PUT /api/v1/site/config</code> &mdash; see the
                    Site Configuration card below.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <strong>The one exception:</strong>{" "}
                    <code className="text-[11px]">operation_mode</code> /{" "}
                    <code className="text-[11px]">grid_mgmt_mode</code> are <em>also</em> re-asserted
                    on every dispatch via the <code className="text-[11px]">station</code> block
                    (above). Site Config still defines their commissioning default, but re-sending
                    them each tick means a device reboot, firmware fallback, or watchdog revert
                    can never silently strand us in automatic mode &mdash; control self-heals on the
                    next tick.
                  </p>
                </div>

                {/* Clearance Violation Warning — clearance is config, but firmware still enforces it */}
                <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 mt-4">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="size-4 text-yellow-600" />
                    <span className="font-semibold text-sm">Site clearance enforcement</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The site-wide <code className="text-[11px]">P_grid_clearance_w</code> we send in
                    the <code className="text-[11px]">station</code> block is the import ceiling the
                    ChargePost firmware enforces on total grid draw:
                  </p>
                  <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                    <li><strong>At/under the ceiling:</strong> firmware freely splits import between EV charging and battery within the budget.</li>
                    <li><strong>Demand approaches the ceiling:</strong> firmware curtails battery charging first, then trims to hold total import &le; clearance &mdash; the EV is never throttled for arbitrage.</li>
                  </ul>
                  <p className="text-xs text-muted-foreground mt-1">
                    The optimizer also reads the current DSO envelope from telemetry
                    (<code className="text-[11px]">station.status.P_grid_clearance_w</code>) and
                    clamps the commanded clearance to it &mdash; never raising it above the
                    contractual limit.
                  </p>
                </div>
                </AccordionContent>
              </AccordionItem>

              {/* Full Payload Sample */}
              <AccordionItem
                value="full-sample"
                className="border rounded-lg px-4 !border-b border-primary/30 bg-primary/5"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3 text-left">
                    <FileJson className="size-4 text-primary shrink-0" />
                    <div>
                      <h4 className="font-semibold text-sm">Full payload sample</h4>
                      <p className="text-xs text-muted-foreground font-normal">
                        Complete, copyable JSONC &mdash; envelope +{" "}
                        <code className="text-[11px]">metadata</code> +{" "}
                        <code className="text-[11px]">station</code> +{" "}
                        <code className="text-[11px]">chargers[]</code> in one minimal document
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    A single well-formed <code className="text-[11px]">POST /api/v1/dispatch</code>{" "}
                    body, annotated with inline comments (<code className="text-[11px]">//</code>).
                    Strip the comments before sending &mdash; the wire format is strict JSON.
                    Values represent a typical cheap-hours arbitrage decision: a high station{" "}
                    <code className="text-[11px]">P_grid_clearance_w</code> so the firmware can import
                    from the grid to charge the BESS and serve any EV, within the DSO envelope.
                  </p>
                  <CopyableCodeBlock
                    label="POST /api/v1/dispatch — request body (command_type: dispatch)"
                    language="jsonc"
                    code={`{
  // ---------- envelope ----------
  "site_id":      "site_munich_01",
  "asset_id":     "chargepost_gronau_001",      // specific chargepost at the site (required)
  "command_type": "dispatch",                   // "dispatch" = real, actuating command
  "command_id":   "cmd_chargepost_gronau_001_20260609_110000_000", // idempotency + correlation
  "timestamp":    "2026-06-09T11:00:00.000Z",
  "valid_until":  "2026-06-09T11:00:15.000Z",   // = timestamp + TICK_MS (~15s); auto-revert after

  // ---------- metadata (informational — never written to Modbus) ----------
  "metadata": {
    "price_zone": "cheap",                      // cheap | moderate | expensive | peak
    "event_type": "price_update"                // the trigger that produced this command
  },

  // ---------- station (automatic-mode control surface — re-sent every tick) ----------
  "station": {
    "operation_mode":     1,                    // 1 = Active (external EMS controls)
    "grid_mgmt_mode":     0,                     // ALWAYS 0 = Automatic (v3)
    "P_grid_clearance_w": 80000,                // THE lever: grid import ceiling (W)
    "soc_reserve_pct":    40,                   // anticipatory floor SoC (%)
    "soc_cp_max_pct":     95                    // charge target SoC (%)
  },

  // ---------- chargers[] (topology + EV clamp — re-sent every tick) ----------
  "chargers": [
    { "unit_id": 1, "charging_mode": 1, "P_ev_limit_w": 150000 },
    { "unit_id": 2, "charging_mode": 1, "P_ev_limit_w": 150000 }
  ]
}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    <strong>That is the entire dispatch contract.</strong> The kernel owns the full
                    setpoint surface and re-asserts it every tick: on the{" "}
                    <code className="text-[11px]">station</code>, the control claim{" "}
                    <code className="text-[11px]">operation_mode</code>, the always-Automatic{" "}
                    <code className="text-[11px]">grid_mgmt_mode</code>, the single arbitrage lever{" "}
                    <code className="text-[11px]">P_grid_clearance_w</code>, plus the{" "}
                    <code className="text-[11px]">soc_reserve_pct</code> floor and{" "}
                    <code className="text-[11px]">soc_cp_max_pct</code> target; and per power unit the
                    auto-selected <code className="text-[11px]">charging_mode</code> and the EV safety
                    clamp <code className="text-[11px]">P_ev_limit_w</code>. The firmware resolves the
                    EV/battery split internally within the clearance ceiling &mdash; there is no
                    per-unit grid request and no &ldquo;split ratio&rdquo; field.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <strong>Two-step feedback loop.</strong> (1) The sync ack above proves
                    Middleware received a well-formed command and queued it for Modbus. (2) Every
                    subsequent state transition (<em>executing, executed, deviated, superseded,
                    timed_out, rejected</em>) is POSTed as a single event over the{" "}
                    <strong>Command Status API</strong>, individually acked and retried
                    at-least-once &mdash; so no transition is ever lost, independent of telemetry
                    cadence.
                  </p>

                  {/* Liveness probe / test command */}
                  <div className="p-3 sm:p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 mt-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Activity className="size-4 text-emerald-600 shrink-0" />
                      <span className="font-semibold text-sm">Liveness probe &mdash; <code className="text-[12px]">command_type: &quot;test&quot;</code></span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Trigger a replan with{" "}
                      <code className="text-[11px]">?eventType=test</code> and the kernel emits an{" "}
                      <strong>inert</strong> command that traverses the full path &mdash; Enexa &rarr;
                      Middleware &rarr; edge device &rarr; Command Status API &mdash; <strong>without
                      actuating any hardware</strong>. It short-circuits before any telemetry, price,
                      or planner read, so a green probe isolates the transport/round-trip from the
                      data plane. Every setpoint is the literal string{" "}
                      <code className="text-[11px]">&quot;test&quot;</code>; the envelope (ids,
                      timestamps, <code className="text-[11px]">valid_until</code>) stays real so it
                      flows through normal validation and logging.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <strong>Edge-device contract:</strong> recognise the probe via{" "}
                      <code className="text-[11px]">command_type === &quot;test&quot;</code> (check this
                      first) &mdash; or, as a secondary sentinel, any setpoint equal to the string{" "}
                      <code className="text-[11px]">&quot;test&quot;</code>. On either signal, <strong>ignore
                      all setpoints, leave actuation untouched, and ack the command</strong> (e.g.{" "}
                      <code className="text-[11px]">status: &quot;accepted&quot;</code>) so the round trip
                      is proven alive.
                    </p>
                    <CopyableCodeBlock
                      label="POST /api/v1/dispatch — liveness probe (command_type: test)"
                      language="jsonc"
                      code={`{
  "site_id":      "site_munich_01",
  "asset_id":     "chargepost_gronau_001",
  "command_type": "test",                       // <-- primary discriminator: ignore + ack
  "command_id":   "cmd_chargepost_gronau_001_20260609_110000_000",
  "timestamp":    "2026-06-09T11:00:00.000Z",
  "valid_until":  "2026-06-09T11:00:15.000Z",   // real envelope — flows through validation
  "metadata":     { "price_zone": "test", "event_type": "test" },
  "station": {
    "operation_mode":     "test",               // every setpoint is the literal string "test"
    "grid_mgmt_mode":     "test",
    "P_grid_clearance_w": "test",
    "soc_reserve_pct":    "test",
    "soc_cp_max_pct":     "test"
  },
  "chargers": [
    { "unit_id": 1, "charging_mode": "test", "P_ev_limit_w": "test" },
    { "unit_id": 2, "charging_mode": "test", "P_ev_limit_w": "test" }
  ]
}`}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
              </Accordion>

            </CardContent>
          </Card>
          </AccordionContent>
        </AccordionItem>

        {/* SITE CONFIGURATION — sticky-state, low-frequency */}
        <AccordionItem value="site-config" className="border rounded-lg px-4 !border-b">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <SlidersHorizontal className="size-5 text-blue-600" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-base">Site Configuration &mdash; sticky-state envelope</h3>
                <p className="text-sm text-muted-foreground font-normal">
                  Low-frequency contract for everything that does not change per tick &mdash; clearance,
                  modes, hardware ceilings, audit tags
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pt-2 pb-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <SlidersHorizontal className="size-5 text-blue-600" />
                      Site configuration
                    </CardTitle>
                    <CardDescription>
                      One source of truth for site-wide envelope and per-unit hardware limits.
                      Written rarely (commissioning, DSO events, contract changes); read by the
                      optimizer from telemetry every tick.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="font-mono">PUT /api/v1/site/config</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  The dispatch loop owns the live setpoint surface (grid request,{" "}
                  <code className="text-[11px]">charging_mode</code>,{" "}
                  <code className="text-[11px]">P_ev_limit_w</code>, the mode flags, and the
                  clearance echo). What lives here are the slow-moving commissioning constants
                  &mdash; the SOC ceiling, <code className="text-[11px]">soc_reserve</code>, audit
                  tag &mdash; plus the <em>source</em> values for clearance and the mode defaults.
                  Idempotent &mdash; sending the same body twice is a no-op.
                </p>

                {/* Cadence rationale */}
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                    <div className="text-xs font-semibold">Commissioning</div>
                    <p className="text-xs text-muted-foreground">
                      Once at site deployment. <code className="text-[11px]">operation_mode</code> /{" "}
                      <code className="text-[11px]">grid_mgmt_mode</code> defaults,{" "}
                      <code className="text-[11px]">soc_cp_max</code>,{" "}
                      <code className="text-[11px]">soc_reserve</code>,{" "}
                      <code className="text-[11px]">external_control_id</code>.
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                    <div className="text-xs font-semibold">Weekly / DSO events</div>
                    <p className="text-xs text-muted-foreground">
                      <code className="text-[11px]">P_grid_clearance_w</code> &mdash; the DSO
                      envelope source value, updated when the contract or curtailment instruction
                      changes. The kernel echoes this value back on every dispatch tick (for
                      self-healing) but never raises it.
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                    <div className="text-xs font-semibold">Operator action</div>
                    <p className="text-xs text-muted-foreground">
                      Sets the commissioning default for{" "}
                      <code className="text-[11px]">operation_mode</code> /{" "}
                      <code className="text-[11px]">grid_mgmt_mode</code>. To hand the station back
                      to internal control the operator <strong>stops the dispatch loop</strong> &mdash;
                      a running loop re-asserts Active each tick, so a soft register flip alone
                      would be re-overridden. Physical emergency-off stays on the hardware
                      E-stop / contactor path.
                    </p>
                  </div>
                </div>

                {/* Full config payload */}
                <CopyableCodeBlock
                  label="PUT /api/v1/site/config — request body"
                  language="jsonc"
                  code={`{
  "site_id": "site_munich_01",
  "config_id": "cfg_20260422_001",   // idempotency key for this revision
  "applied_at": "2026-04-22T08:00:00.000Z",

  // ---------- station-level ----------
  "station": {
    "operation_mode":      1,         // 0 = Standby, 1 = Active (Enexa control enabled).
                                      //   Commissioning default; dispatch re-asserts it each tick.
    "grid_mgmt_mode":      0,         // ALWAYS 0 = Automatic (firmware-managed) in v3.
                                      //   Commissioning default; dispatch re-asserts it each tick.
    "P_grid_clearance_w":  80000,     // Site-wide grid import ceiling (W).
                                      //   DSO-driven envelope; dispatch clamps to it each tick.
    "external_control_id": "ENEXA_PROD"  // Audit tag shown on hardware UI (max 32 chars).
  },

  // ---------- per-unit commissioning constants ----------
  //   charging_mode + P_ev_limit_w are NOT here — the dispatch loop owns and
  //   re-asserts them every tick (auto-selected topology + EV safety clamp).
  //   soc_reserve_pct + soc_cp_max_pct are likewise re-asserted on the station
  //   block every tick; the values below are only the commissioning source.
  "chargers": [
    {
      "unit_id":     1,
      "soc_cp_max":  95,              // BESS SOC ceiling / charge target (%).
                                      //   Warranty/longevity policy; dispatch re-asserts as soc_cp_max_pct.
      "soc_reserve": 40              // Anticipatory floor SOC (%); dispatch re-asserts as soc_reserve_pct.
    },
    {
      "unit_id":     2,
      "soc_cp_max":  95,
      "soc_reserve": 40
    }
  ]
}`}
                />

                {/* Field reference table */}
                <div>
                  <h4 className="text-sm font-semibold mb-2">Field reference</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[180px]">Field</TableHead>
                        <TableHead className="w-[110px]">Cadence</TableHead>
                        <TableHead className="w-[170px]">Modbus register</TableHead>
                        <TableHead>Why it lives here, not in dispatch</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">station.operation_mode</TableCell>
                        <TableCell className="text-xs">Config + every tick</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">operation_mode (2501)</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Master on/off.</strong> Config sets the commissioning default; the <code className="text-[11px]">station</code> block then re-asserts it each dispatch tick so a reboot or fallback self-heals. An operator hands the site back by stopping the dispatch loop (which sends <code className="text-[11px]">operation_mode=0</code> on release), not by a soft register flip.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">station.grid_mgmt_mode</TableCell>
                        <TableCell className="text-xs">Config + every tick</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">grid_mgmt_mode (2502)</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Strategy mode.</strong> <strong>Always 0 = Automatic</strong> in v3 &mdash; the firmware computes the EV/battery split itself within our <code className="text-[11px]">P_grid_clearance_w</code> ceiling. (The retired v2 manual mode <code>1</code> drove per-unit grid requests directly &mdash; no longer used.) Config sets the default; re-asserted every tick via the <code className="text-[11px]">station</code> block &mdash; without it the firmware silently ignores our setpoints (spec &sect;2.7).</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">station.P_grid_clearance_w</TableCell>
                        <TableCell className="text-xs">Config source + every tick</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">P_grid_clearance (2506)</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>DSO-driven envelope.</strong> Site-wide grid import/export ceiling. Config holds the source value (changes weekly at most, on contract changes or TSO curtailment); the kernel echoes it back on every dispatch tick for self-healing but <em>never raises it</em>. The optimizer plans within it.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">station.external_control_id</TableCell>
                        <TableCell className="text-xs">Commissioning</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">external_control_id (2514)</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Audit tag (max 32 chars).</strong> Identifies the operator on the hardware UI and in logs. Set once at commissioning.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">chargers[].soc_reserve</TableCell>
                        <TableCell className="text-xs">Commissioning</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">soc_reserve (517)</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>Anticipatory floor SOC.</strong> The SOC the kernel keeps in reserve so it can ride through expensive hours and grid events. Config holds the commissioning source value; dispatch re-asserts it every tick as <code className="text-[11px]">soc_reserve_pct</code> on the <code className="text-[11px]">station</code> block.</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">chargers[].soc_cp_max</TableCell>
                        <TableCell className="text-xs">Commissioning</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">soc_cp_max (12009/22009)</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground"><strong>BESS SOC ceiling / charge target.</strong> Warranty &amp; longevity policy (typically 85&ndash;95&nbsp;%). Config holds the source value; dispatch re-asserts it every tick as <code className="text-[11px]">soc_cp_max_pct</code> on the <code className="text-[11px]">station</code> block. The optimizer drives arbitrage through the station-level <code className="text-[11px]">P_grid_clearance_w</code> within this envelope. There is no <code className="text-[11px]">soc_cp_min</code> &mdash; the hard SOC floor concept does not exist in hardware; the anticipatory floor is <code className="text-[11px]">soc_reserve_pct</code>.</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                {/* Reading guide */}
                <div className="p-3 sm:p-4 rounded-lg border bg-muted/30 space-y-2">
                  <div className="flex items-center gap-2">
                    <Info className="size-4 text-blue-500 shrink-0" />
                    <span className="font-semibold text-sm">How the two endpoints relate</span>
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                    <li>
                      <code className="text-[11px]">PUT /api/v1/site/config</code> is the{" "}
                      <strong>only</strong> writer for sticky-state. It is idempotent and produces
                      its own audit trail keyed by <code className="text-[11px]">config_id</code>.
                    </li>
                    <li>
                      <code className="text-[11px]">POST /api/v1/dispatch</code> owns the live
                      setpoint surface re-asserted every tick: the station mode flags, the
                      arbitrage lever <code className="text-[11px]">P_grid_clearance_w</code>, the
                      <code className="text-[11px]">soc_reserve_pct</code> floor and{" "}
                      <code className="text-[11px]">soc_cp_max_pct</code> target, plus per-unit{" "}
                      <code className="text-[11px]">charging_mode</code> and{" "}
                      <code className="text-[11px]">P_ev_limit_w</code>. It never <em>raises</em>{" "}
                      clearance above the DSO envelope and never <em>writes</em> the audit tag or
                      hardware ceilings &mdash; those remain Config-only.
                    </li>
                    <li>
                      The optimizer reads the current configured envelope from the standard
                      telemetry stream &mdash;{" "}
                      <code className="text-[11px]">station.status.P_grid_clearance_w</code> echoes
                      back whatever was last written via <code className="text-[11px]">/site/config</code>.
                    </li>
                    <li>
                      A config change does not interrupt dispatching. The next tick simply plans
                      against the new envelope.
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </AccordionContent>
        </AccordionItem>
        </>}

        {showGeneral && <>
        {/* MODBUS REGISTERS */}
        <AccordionItem value="registers" className="border rounded-lg px-4 !border-b">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Server className="size-5 text-blue-600" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-base">Modbus Register Reference</h3>
                <p className="text-sm text-muted-foreground font-normal">Hardware register addresses for low-level integration</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-6 pt-2 pb-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="size-5 text-orange-500" />
                ADS-TEC ChargePost Modbus Register Reference
              </CardTitle>
              <CardDescription>
                Complete register map for Modbus/TCP interface v2.6. Function codes: 03 (read holding), 04 (read input), 06/16 (write holding).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Station Status Registers */}
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Activity className="size-4 text-blue-500" />
                  Station Status Registers (Input - FC 04)
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Address</TableHead>
                      <TableHead className="w-[220px]">Register Name</TableHead>
                      <TableHead className="w-[80px]">Type</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2000</TableCell>
                      <TableCell className="font-mono text-xs">station.status.operation_state</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">0=Off, 1=Startup, 2=Ready, 3=LeftCharge, 4=LeftConCharge, 5=RightCharge, 6=RightConCharge, 7=BothCharge, 8=Shutdown</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2006</TableCell>
                      <TableCell className="font-mono text-xs">station.status.T_ambient</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Ambient temperature near heat exchanger (°C)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2009</TableCell>
                      <TableCell className="font-mono text-xs">station.status.watchdog_timeout</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Seconds until watchdog expires</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2010</TableCell>
                      <TableCell className="font-mono text-xs">station.status.P_grid_consumption_limit</TableCell>
                      <TableCell className="text-xs">uint32</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Max grid consumption power (W) without clearance violation</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2012</TableCell>
                      <TableCell className="font-mono text-xs">station.status.P_grid_generation_limit</TableCell>
                      <TableCell className="text-xs">uint32</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Max grid feed-in power (W) without clearance violation</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2100</TableCell>
                      <TableCell className="font-mono text-xs">station.status.warnings</TableCell>
                      <TableCell className="text-xs">bitlist</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Bit 0: watchdog_triggered, Bit 1: no_modbus_ctrl, Bit 2: manual_ctrl, Bit 3: P_clearance_violation, Bit 4: I_clearance_violation</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2110</TableCell>
                      <TableCell className="font-mono text-xs">station.status.errors.general</TableCell>
                      <TableCell className="text-xs">bitlist</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Bit 0: error_flags_corrupted, Bit 1: CrashSensor_Triggered, Bit 2: USV_GridSupplyFailure</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <Separator />

              {/* Station Management Registers */}
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Target className="size-4 text-green-500" />
                  Station Management Registers (Holding - FC 03/06/16)
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Address</TableHead>
                      <TableHead className="w-[220px]">Register Name</TableHead>
                      <TableHead className="w-[80px]">Type</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="bg-yellow-500/5">
                      <TableCell className="font-mono text-xs">2500</TableCell>
                      <TableCell className="font-mono text-xs">station.mgmt.watchdog_interval</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground"><strong>CRITICAL:</strong> Write every 2-60s to maintain control. Expiry reverts to fallback config.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2501</TableCell>
                      <TableCell className="font-mono text-xs">station.mgmt.operation_mode</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">0=Off (system offline), 1=On (system active)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2502</TableCell>
                      <TableCell className="font-mono text-xs">station.mgmt.grid_mgmt_mode</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">0=Automatic (system manages), 1=Manual (per-unit P_grid setpoints)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2504</TableCell>
                      <TableCell className="font-mono text-xs">station.mgmt.energy_saving_mode_reaction_speed</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">0=Fast (always active), 1=Slow (sleep after 60s idle)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2506</TableCell>
                      <TableCell className="font-mono text-xs">station.mgmt.P_grid_clearance</TableCell>
                      <TableCell className="text-xs">uint32</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Maximum grid power (W). Can exceed config limit with active Modbus control. Max 87kVA.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2512</TableCell>
                      <TableCell className="font-mono text-xs">station.mgmt.power_gradient_mode</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">0=No gradient, 1=VDE4105 third party gradient (for direct marketing)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">2514</TableCell>
                      <TableCell className="font-mono text-xs">station.mgmt.external_control_id</TableCell>
                      <TableCell className="text-xs">string</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Identifier of external EMS (max 32 chars). Written once at commissioning &mdash; not part of the runtime dispatch payload.</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <Separator />

              {/* Charger Registers */}
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <BatteryCharging className="size-4 text-chart-2" />
                  Per-Unit Charger Registers (charger.1 / charger.2)
                </h4>
                <p className="text-xs text-muted-foreground mb-3">
                  charger.1 addresses shown. Add 10000 for charger.2 (e.g., 3000 → 13000, 7000 → 17000, 12000 → 22000).
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Address</TableHead>
                      <TableHead className="w-[220px]">Register Name</TableHead>
                      <TableHead className="w-[80px]">Type</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="bg-blue-500/5">
                      <TableCell colSpan={4} className="font-semibold text-xs">Status Registers (Input - FC 04)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3000</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.charging_state</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">0=NotAvailable, 1=Available, 2=InProgress</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3001</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.charging_process_state</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">0=Offline, 1=ReadyToCharge, 2=Authorization, 3=ChargingSetup, 4=Charging, 5=ChargingTeardown, 6=ChargingFinished, 7=ChargingError</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3002</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.plug_state</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">0=Unplugged, 1=Plugged</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3008</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.P_EV</TableCell>
                      <TableCell className="text-xs">int32</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Current EV charging power (W)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3010</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.P_EV_max</TableCell>
                      <TableCell className="text-xs">int32</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Maximum power EV accepts (W)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3020</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.soc_EV</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">EV battery SOC (%)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3021</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.E_EV_chg</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Energy delivered this session — charger internal counter (kWh)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3028</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.E_EVse</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Session energy from MID-certified DC meter — billing-grade (kWh)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3024</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.t_bulk</TableCell>
                      <TableCell className="text-xs">uint32</TableCell>
                      <TableCell className="text-sm text-muted-foreground">EV-reported seconds remaining to bulk SOC</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3026</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.t_full</TableCell>
                      <TableCell className="text-xs">uint32</TableCell>
                      <TableCell className="text-sm text-muted-foreground">EV-reported seconds remaining to full SOC</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3036</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.P_grid_chg_max</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Max grid import power available at this charger (W)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3038</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.P_grid_dischg_max</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Max grid export power available at this charger (W)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">3044</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.grid_contactor_state</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">0=undefined, 1=open, 2=closed</TableCell>
                    </TableRow>
                    <TableRow className="bg-green-500/5">
                      <TableCell colSpan={4} className="font-semibold text-xs">Battery Status Registers (Input - FC 04)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">7000</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.battery.P_bat</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Battery power in producer counting (W). Negative = discharge.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">7006</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.battery.soc_cp</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Internal battery SOC (%)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">7008</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.battery.T_bat_min</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Min battery string temperature (°C)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">7010</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.battery.T_bat_max</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Max battery string temperature (°C)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">7012</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.battery.P_bat_chg_max</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Max battery charging power available (W)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">7014</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.status.battery.P_bat_dischg_max</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Max battery discharge power available (W)</TableCell>
                    </TableRow>
                    <TableRow className="bg-orange-500/5">
                      <TableCell colSpan={4} className="font-semibold text-xs">Management Registers (Holding - FC 03/06/16)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">12000</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.mgmt.charging_mode</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">0=Off, 1=Single (150kW), 2=Dual (300kW), 3=Disabled (grid only)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">12001</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.mgmt.P_cp_lim</TableCell>
                      <TableCell className="text-xs">uint32</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Max EV charging power (W). 0=no charging. &gt;300000 treated as 300000.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">12003</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.mgmt.I_cp_lim</TableCell>
                      <TableCell className="text-xs">uint32</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Max EV charging current (A). 0=no charging. &gt;500 treated as 500.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">12005</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.mgmt.P_grid</TableCell>
                      <TableCell className="text-xs">int32</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Target grid power in manual mode (W). Negative = feed to grid.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">12009</TableCell>
                      <TableCell className="font-mono text-xs">charger.1.mgmt.soc_cp_max</TableCell>
                      <TableCell className="text-xs">uint16</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Max battery SOC target (%). Must be &lt; backup config value.</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <Separator />

              {/* Grid Meter Registers */}
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Zap className="size-4 text-primary" />
                  Grid Meter Registers (Input - FC 04)
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Address</TableHead>
                      <TableHead className="w-[220px]">Register Name</TableHead>
                      <TableHead className="w-[80px]">Type</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">1000</TableCell>
                      <TableCell className="font-mono text-xs">grid.P_grid</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Active grid power in producer counting (W). Negative = export.</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">1002</TableCell>
                      <TableCell className="font-mono text-xs">grid.Q_grid</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Reactive grid power (VA)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">1008</TableCell>
                      <TableCell className="font-mono text-xs">grid.f_grid</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Grid frequency (Hz)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">1010-1014</TableCell>
                      <TableCell className="font-mono text-xs">grid.U_L1/L2/L3_grid</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Per-phase grid voltages (V)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">1016-1020</TableCell>
                      <TableCell className="font-mono text-xs">grid.I_L1/L2/L3_grid</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Per-phase grid currents (A)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">1022</TableCell>
                      <TableCell className="font-mono text-xs">grid.E_grid_imp</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Grid import energy counter (kWh)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">1024</TableCell>
                      <TableCell className="font-mono text-xs">grid.E_grid_exp</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Grid export energy counter (kWh)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">1026</TableCell>
                      <TableCell className="font-mono text-xs">grid.P_aux</TableCell>
                      <TableCell className="text-xs">float</TableCell>
                      <TableCell className="text-sm text-muted-foreground">Auxiliary consumer power - HVAC, displays (W)</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          </AccordionContent>
        </AccordionItem>
        </>}
      </Accordion>

      {isDedicatedTelemetry && <TelemetryErrorHandlingCard />}
      {isDedicatedDispatching && <DispatchErrorHandlingCard />}
      {isDedicatedCommandStatus && <CommandStatusErrorHandlingCard />}

      {showGeneral && <>
      {/* API Versioning & Error Codes */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="size-5 text-primary" />
            API Versioning & Error Handling
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-sm mb-3">API Versioning</h4>
              <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs mb-3">
                <p>Base URL: https://api.enexa.io/v1/</p>
                <p>Current Version: v1 (stable)</p>
                <p>Deprecation Policy: 12 months notice</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Version is included in the URL path. Breaking changes will increment the major version.
                Enexa will maintain backwards compatibility within a major version.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-3">Rate Limits</h4>
              <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs mb-3">
                <p>Telemetry: 2 requests/second per site</p>
                <p>Commands: 10 requests/minute per site</p>
                <p>Burst: 5 requests allowed</p>
              </div>
              <p className="text-sm text-muted-foreground">
                HTTP 429 returned when exceeded. Retry-After header indicates wait time.
                Contact Enexa to increase limits for high-throughput sites.
              </p>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="font-semibold text-sm mb-3">Error Response Codes</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <p className="font-medium">4xx Client Errors</p>
                <ul className="text-muted-foreground space-y-1">
                  <li><span className="font-mono text-xs">400</span> - Invalid JSON or schema violation</li>
                  <li><span className="font-mono text-xs">401</span> - Missing or invalid auth token</li>
                  <li><span className="font-mono text-xs">403</span> - Token valid but not authorized for site</li>
                  <li><span className="font-mono text-xs">404</span> - Site ID not found</li>
                  <li><span className="font-mono text-xs">409</span> - Command conflicts with active emergency</li>
                  <li><span className="font-mono text-xs">422</span> - Semantically invalid (e.g., SOC &gt; 100%)</li>
                  <li><span className="font-mono text-xs">429</span> - Rate limit exceeded</li>
                </ul>
              </div>
              <div className="space-y-2">
                <p className="font-medium">5xx Server Errors</p>
                <ul className="text-muted-foreground space-y-1">
                  <li><span className="font-mono text-xs">500</span> - Enexa internal error (retry later)</li>
                  <li><span className="font-mono text-xs">502</span> - Upstream service unavailable</li>
                  <li><span className="font-mono text-xs">503</span> - Enexa maintenance mode</li>
                  <li><span className="font-mono text-xs">504</span> - Timeout processing request</li>
                </ul>
                <p className="text-muted-foreground mt-2">
                  On 5xx errors: retry with exponential backoff (1s, 2s, 4s, 8s, max 60s).
                  After 5 failures, switch to LOCAL AUTONOMOUS mode.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Heartbeat & Health Check */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-5 text-green-500" />
            Heartbeat & Health Check Protocol
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-sm mb-2">Middleware Heartbeat</h4>
              <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs mb-3">
                <p>POST /api/v1/heartbeat</p>
                <p>Frequency: Every 10 seconds</p>
                <p>{`{ "site_id": "...", "status": "healthy", "uptime_s": 3600, "mode": "cloud_connected" }`}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                If Enexa receives no heartbeat for 30 seconds, the site is marked OFFLINE.
                Alerts are sent to configured operators.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-2">Enexa Health Check</h4>
              <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs mb-3">
                <p>GET /api/v1/health</p>
                <p>Response: {`{ "status": "ok", "time": "..." }`}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Middleware should check Enexa health before critical operations.
                If unhealthy, cache commands locally and retry later.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Implementation Notes */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Implementation Notes for Middleware Developers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Connection Requirements</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- HTTPS with TLS 1.3 minimum</li>
                <li>- Bearer token authentication per site</li>
                <li>- WebSocket option for low-latency bidirectional</li>
                <li>- Retry with exponential backoff on failure</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Fallback Behavior</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- If no command in 60s: enter local auto mode</li>
                <li>- Local mode: serve EVs, maintain 50% SOC target</li>
                <li>- Resume cloud control when connection restored</li>
                <li>- Log all local decisions for reconciliation</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Data Quality</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Timestamps must be UTC ISO 8601</li>
                <li>- Power values in kW, energy in kWh</li>
                <li>- Missing fields should be null, not omitted</li>
                <li>- Include measurement accuracy metadata</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Safety Constraints</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Hardware limits always override cloud commands</li>
                <li>- Battery BMS has final say on charge/discharge</li>
                <li>- Grid connection limits are physical constraints</li>
                <li>- Never exceed equipment ratings</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      </>}

    </div>
  )
}
