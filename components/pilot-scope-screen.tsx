"use client"

import Link from "next/link"
import {
  Target,
  FileText,
  Activity,
  Zap,
  ArrowRight,
  CheckCircle2,
  MinusCircle,
  BookOpen,
  Cable,
  Settings2,
  AlertTriangle,
  Database,
  BookMarked,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

type PilotPage = {
  title: string
  href: string
  icon: typeof FileText
  tagline: string
  whatItCovers: string[]
  whyPilot: string
  tone: "primary" | "telemetry" | "dispatch" | "feedback"
}

const IN_SCOPE: PilotPage[] = [
  {
    title: "General API",
    href: "/middleware-api",
    icon: FileText,
    tone: "primary",
    tagline: "Shared context every integrator needs before reading the two wire APIs.",
    whatItCovers: [
      "Integration architecture (Enexa ↔ Middleware ↔ ChargePost)",
      "Data-field purpose taxonomy (OPT / MON / DSP / IMP)",
      "Payload identifiers (site_id, asset_id, unit_id)",
      "Modbus register reference for the ADS-TEC ChargePost",
      "API versioning, error handling, heartbeat, rate limits",
    ],
    whyPilot:
      "Foundation reading. Without it the Telemetry and Dispatching contracts look like opaque JSON — with it, every field ties back to a Modbus register and a real control-loop purpose.",
  },
  {
    title: "Telemetry API",
    href: "/telemetry-api",
    icon: Activity,
    tone: "telemetry",
    tagline: "Middleware → Enexa uplink. Per-site state snapshots.",
    whatItCovers: [
      "POST /api/v1/telemetry — cadence, envelope, when-called semantics",
      "Three payload blocks: batteries[], chargers[], grid",
      "At-most-once state semantics (no backfill)",
      "Configurable push interval (report_interval_s, default 1 s)",
    ],
    whyPilot:
      "The observability half of the integration. Single data source that drives the Enexa optimizer and the NOC dashboards.",
  },
  {
    title: "Dispatching API",
    href: "/dispatching-api",
    icon: Zap,
    tone: "dispatch",
    tagline: "Enexa → Middleware downlink. Setpoint commands with synchronous ack.",
    whatItCovers: [
      "POST /api/v1/dispatch — when called, payload, response",
      "Station- and per-unit setpoints (charging_mode, P_grid_w, limits)",
      "Synchronous ack: accepted | rejected | partial",
      "Middleware-assigned command_id (feedback ships on Command Status API)",
      "valid_until expiry & safe-fallback behaviour",
    ],
    whyPilot:
      "The control half of the integration. Proves Enexa can actually move energy at the pilot site — and that the Middleware writes setpoints to Modbus within the contracted SLO.",
  },
  {
    title: "Command Status API",
    href: "/command-status-api",
    icon: CheckCircle2,
    tone: "feedback",
    tagline: "Middleware → Enexa. One event per command-state transition.",
    whatItCovers: [
      "POST /api/v1/command-events — event-driven, independently acked",
      "States: accepted → executing → executed / deviated / superseded / timed_out / rejected",
      "At-least-once delivery with event_id deduplication",
      "Closes the dispatch loop independently of telemetry cadence",
    ],
    whyPilot:
      "The verification half of the loop. Without it the sync ack on Dispatching is just a syntactic receipt; with it, every command's hardware-level outcome is durably recorded in Enexa.",
  },
]

const OUT_OF_SCOPE: { title: string; href: string; icon: typeof BookOpen; reason: string }[] = [
  {
    title: "Solution Overview",
    href: "/overview",
    icon: BookOpen,
    reason: "Big-picture architecture — useful context, but not part of the pilot integration contract.",
  },
  {
    title: "Communication",
    href: "/comm-architecture",
    icon: Cable,
    reason: "Transport-level patterns (TLS, auth, retries). Referenced from the pilot APIs, not a pilot deliverable itself.",
  },
  {
    title: "Onboarding & Deployment",
    href: "/onboarding-config",
    icon: Settings2,
    reason: "Site-provisioning workflow. Handled outside the pilot's wire-level API scope.",
  },
  {
    title: "Exception Handling",
    href: "/exception-handling",
    icon: AlertTriangle,
    reason: "Fallbacks for degraded-mode scenarios. Triggered by, but not defined in, the pilot APIs.",
  },
  {
    title: "Config API",
    href: "/config-api",
    icon: Database,
    reason: "Master-data & runtime config pushed from Enexa. Separate surface from the pilot's Telemetry/Dispatch loop.",
  },
  {
    title: "API Repository",
    href: "/api-repository",
    icon: BookMarked,
    reason: "Catalogue of every endpoint across the full product. The pilot only uses the three APIs above.",
  },
]

const TONE_STYLES: Record<PilotPage["tone"], { border: string; bg: string; iconBg: string; iconText: string; badge: string }> = {
  primary: {
    border: "border-primary/30",
    bg: "bg-primary/5",
    iconBg: "bg-primary/10",
    iconText: "text-primary",
    badge: "bg-primary/10 text-primary border-primary/20",
  },
  telemetry: {
    border: "border-green-500/30",
    bg: "bg-green-500/5",
    iconBg: "bg-green-500/10",
    iconText: "text-green-600",
    badge: "bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400",
  },
  dispatch: {
    border: "border-orange-500/30",
    bg: "bg-orange-500/5",
    iconBg: "bg-orange-500/10",
    iconText: "text-orange-600",
    badge: "bg-orange-500/10 text-orange-700 border-orange-500/20 dark:text-orange-400",
  },
  feedback: {
    border: "border-primary/30",
    bg: "bg-primary/5",
    iconBg: "bg-primary/10",
    iconText: "text-primary",
    badge: "bg-primary/10 text-primary border-primary/20",
  },
}

export function PilotScopeScreen() {
  return (
    <div className="w-full py-8 px-6 space-y-10">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className="text-[10px] tracking-wider uppercase bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400 hover:bg-amber-500/15">
            <Target className="size-3 mr-1" />
            Pilot Scope
          </Badge>
          <Badge variant="outline" className="text-[10px] tracking-wider uppercase">
            Enexa ↔ Amperio
          </Badge>
          <Badge variant="outline" className="text-[10px] tracking-wider uppercase">
            ChargePost Integration
          </Badge>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-balance">
          What&apos;s in scope for the pilot
        </h1>
        <p className="text-muted-foreground max-w-3xl leading-relaxed text-pretty">
          The pilot delivers a single, production-grade integration loop between{" "}
          <strong>Enexa</strong> (optimizer) and <strong>Amperio Middleware</strong>
          {" "}(site-control layer) on the <strong>ADS-TEC ChargePost</strong>. The four pages
          below are the contract for that loop &mdash; everything else in the sidebar is
          supporting context for the broader product, not a pilot deliverable.
        </p>
      </div>

      {/* Loop diagram */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="size-5 text-amber-600" />
            The pilot control loop
          </CardTitle>
          <CardDescription>
            Four APIs, one continuous cycle: observe &rarr; decide &rarr; command &rarr; verify.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-stretch gap-3 md:gap-2">
            <div className="flex-1 p-4 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="size-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Foundation</span>
              </div>
              <p className="text-sm font-semibold mb-1">General API</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Shared taxonomy, identifiers, Modbus register map. Read first; referenced by both wire APIs.
              </p>
            </div>
            <div className="hidden md:flex items-center text-muted-foreground">
              <ArrowRight className="size-5" />
            </div>
            <div className="flex-1 p-4 rounded-lg border bg-green-500/5 border-green-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="size-4 text-green-600" />
                <span className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">Uplink</span>
              </div>
              <p className="text-sm font-semibold mb-1">Telemetry API</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Middleware pushes per-site state snapshots (batteries, chargers, grid) on a
                configurable cadence.
              </p>
            </div>
            <div className="hidden md:flex items-center text-muted-foreground">
              <ArrowRight className="size-5" />
            </div>
            <div className="flex-1 p-4 rounded-lg border bg-orange-500/5 border-orange-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="size-4 text-orange-600" />
                <span className="text-xs font-semibold uppercase tracking-wider text-orange-700 dark:text-orange-400">Downlink</span>
              </div>
              <p className="text-sm font-semibold mb-1">Dispatching API</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Enexa posts setpoints with a Middleware-assigned{" "}
                <code className="text-[11px]">command_id</code>; sync ack only.
              </p>
            </div>
            <div className="hidden md:flex items-center text-muted-foreground">
              <ArrowRight className="size-5" />
            </div>
            <div className="flex-1 p-4 rounded-lg border bg-primary/5 border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="size-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wider text-primary">Feedback</span>
              </div>
              <p className="text-sm font-semibold mb-1">Command Status API</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Middleware POSTs one event per transition (<code className="text-[11px]">executing</code>,{" "}
                <code className="text-[11px]">executed</code>, <code className="text-[11px]">deviated</code>
                &hellip;), keyed by <code className="text-[11px]">command_id</code>.
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            The loop is closed by <code>command_id</code> correlation: every dispatch emits events
            over the Command Status API until it reaches a terminal state &mdash; the sync ack on
            the Dispatching API alone does not prove hardware-level success.
          </p>
        </CardContent>
      </Card>

      {/* In-scope cards */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-amber-600" />
          <h2 className="text-xl font-semibold tracking-tight">In scope &mdash; the four pilot pages</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {IN_SCOPE.map((page) => {
            const tone = TONE_STYLES[page.tone]
            return (
              <Link
                key={page.href}
                href={page.href}
                className={`group flex flex-col p-5 rounded-lg border ${tone.border} ${tone.bg} hover:shadow-sm transition-all`}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tone.iconBg}`}>
                    <page.icon className={`size-5 ${tone.iconText}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base leading-tight">{page.title}</h3>
                    <p className="text-xs text-muted-foreground leading-snug mt-0.5">{page.tagline}</p>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
                </div>
                <Separator className="my-3" />
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  What it covers
                </p>
                <ul className="space-y-1.5 mb-4">
                  {page.whatItCovers.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
                      <span className={`inline-block size-1 rounded-full mt-1.5 shrink-0 ${tone.iconText.replace("text-", "bg-")}`} />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Why it matters for the pilot
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed flex-1">{page.whyPilot}</p>
              </Link>
            )
          })}
        </div>
      </section>

      {/* Out-of-scope */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <MinusCircle className="size-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold tracking-tight">
            Out of pilot scope &mdash; available as context
          </h2>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
          These pages describe the wider Enexa &times; Amperio product surface. They&apos;re useful
          background but <strong>not pilot deliverables</strong> &mdash; they describe work that
          either sits above the wire protocol (onboarding, overview) or outside the pilot&apos;s
          Telemetry / Dispatch loop (Config API, API Repository).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {OUT_OF_SCOPE.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-start gap-3 p-3 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background border">
                <item.icon className="size-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight mb-0.5">{item.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.reason}</p>
              </div>
              <ArrowRight className="size-3.5 text-muted-foreground/50 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
