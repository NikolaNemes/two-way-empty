"use client"

import { useEffect, useRef, useState } from "react"
import { Activity, CheckCircle2, Loader2, Radio, Zap } from "lucide-react"
import { Card } from "@/components/ui/card"
import {
  getReportPercent,
  getReportUnits,
  subscribeReportProgress,
  type ProgressEndpoint,
  type ProgressEvent,
} from "@/lib/report-progress"

const ENDPOINT_LABELS: Record<ProgressEndpoint, string> = {
  frames: "Telemetry frames",
  "prices-DAM": "DAM prices",
  "prices-IDM": "IDM prices",
  cost: "Cost buckets",
  sessions: "Sessions",
}

/**
 * Drives the loader's progress bar. Subscribes to the shared report-progress
 * emitter and returns EITHER a real percentage (when the pipeline has declared
 * a plan via `progressPlan`) OR an honest, elapsed-time "trickle" that eases
 * toward ~92% without ever fake-completing — so even route transitions and
 * server-action waits (which emit no events) feel like they are progressing
 * rather than sitting on a decorative shimmer.
 */
function useLoaderProgress(): {
  percent: number
  determinate: boolean
  done: number
  planned: number
  label: string | null
} {
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [trickle, setTrickle] = useState(6)
  const startedAt = useRef(
    typeof performance !== "undefined" ? performance.now() : Date.now(),
  )

  useEffect(() => {
    const unsub = subscribeReportProgress(setEvents)
    const id = setInterval(() => {
      // Ease toward 92%: fast at first, asymptotically slower. Honest —
      // it advances with elapsed time and only "completes" when the real
      // work finishes and this loader unmounts.
      setTrickle((prev) => (prev >= 92 ? prev : prev + Math.max(0.4, (92 - prev) * 0.06)))
    }, 140)
    return () => {
      unsub()
      clearInterval(id)
    }
  }, [])

  const real = getReportPercent()
  const { done, planned } = getReportUnits()

  // Newest meaningful event → a short "what's happening now" label.
  let label: string | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.kind === "fetch-start") {
      const scope = e.range
        ? e.range[0] === e.range[1]
          ? e.range[0]
          : `${e.range[0]} → ${e.range[1]}`
        : e.day
      label = `Fetching ${ENDPOINT_LABELS[e.endpoint] ?? e.endpoint}${scope ? ` · ${scope}` : ""}`
      break
    }
    if (e.kind === "fetch-end" || e.kind === "cache-hit") {
      label = `${ENDPOINT_LABELS[e.endpoint] ?? e.endpoint} ready`
      break
    }
  }

  if (real != null) {
    // Never let the real bar visually regress below the trickle it replaced.
    return { percent: Math.max(real, 3), determinate: true, done, planned, label }
  }
  return { percent: Math.round(trickle), determinate: false, done, planned, label }
}

// ════════════════════════════════════════════════════════════════════════
// TELEMETRY LOADER — the single branded loading scene shared by every
// surface (Live Bird's-Eye snapshot, the telemetry/history card, the Live
// Commands Stack, and route-level loading.tsx fallbacks). One loader, one
// look — no ad-hoc spinners.
//
// Design: a sleek "live signal" panel — an animated power waveform sweeps
// across a scope while a battery charges and three energy nodes pulse in
// sequence. Built from inline SVG + CSS keyframes (signalFlow / scanSweep /
// chargeRise / nodePulse, defined in globals.css) so it is crisp at any size
// and theme-aware via design tokens.
// ════════════════════════════════════════════════════════════════════════

export type TelemetryLoaderMode = "live" | "simulated" | "historical"

const MODE_CONFIG: Record<
  TelemetryLoaderMode,
  { title: string; subtitle: string; icon: typeof Radio; endpoint: string; footer: string }
> = {
  live: {
    title: "Connecting to Today's Telemetry",
    subtitle: "Establishing real-time API connection",
    icon: Radio,
    endpoint: "GET /api/amperio/telemetry/latest",
    footer: "Waiting for first telemetry frame",
  },
  simulated: {
    title: "Initialising Simulation",
    subtitle: "Preparing simulation engine",
    icon: Activity,
    endpoint: "sim://engine/boot",
    footer: "Spinning up the simulation engine",
  },
  historical: {
    title: "Loading Historical Telemetry",
    subtitle: "Replaying metered frames over the selected range",
    icon: Loader2,
    endpoint: "POST runBacktestForRange",
    footer: "Fetching telemetry frames",
  },
}

/**
 * Branded animated loader. `mode` picks the default copy/endpoint/footer;
 * `title`, `subtitle`, `endpoint` and `footer` can each override the default.
 * Set `bare` to drop the outer Card (so it can be embedded inside an existing
 * card body, e.g. the Live Commands Stack).
 */
export function TelemetryLoader({
  mode = "live",
  title,
  subtitle,
  endpoint,
  footer,
  bare = false,
  className,
}: {
  mode?: TelemetryLoaderMode
  title?: string
  subtitle?: string
  endpoint?: string
  footer?: string
  bare?: boolean
  className?: string
}) {
  const [dots, setDots] = useState(0)
  const progress = useLoaderProgress()

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev + 1) % 4)
    }, 450)
    return () => clearInterval(interval)
  }, [])

  const config = MODE_CONFIG[mode]
  const Icon = config.icon
  const heading = title ?? config.title
  const sub = subtitle ?? config.subtitle
  const ep = endpoint ?? config.endpoint
  const foot = footer ?? config.footer

  const inner = (
    <div className="relative overflow-hidden bg-gradient-to-br from-primary/[0.04] via-transparent to-sky-500/[0.04] p-5 sm:p-6">
      {/* ── Live signal scope ─────────────────────────────────────────── */}
      <SignalScope />

      {/* ── Status row: charging battery + heading + endpoint ─────────── */}
      <div className="mt-5 flex items-center gap-4">
        <ChargingBattery />

        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Icon className={`size-4 text-primary ${mode === "historical" ? "animate-spin" : ""}`} />
            <span className="truncate">
              {heading}
              <span className="inline-block w-4 text-left text-primary">{".".repeat(dots)}</span>
            </span>
          </h3>
          <p className="truncate text-xs text-muted-foreground">{sub}</p>
        </div>
      </div>

      {/* ── Real progress bar (determinate when the pipeline declared a
             plan; honest elapsed-time trickle otherwise) ────────────────── */}
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] tabular-nums">
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            {progress.determinate && progress.done >= progress.planned && progress.planned > 0 ? (
              <CheckCircle2 className="size-3 text-emerald-500" />
            ) : null}
            <span className="truncate">{progress.label ?? foot}</span>
          </span>
          <span className="shrink-0 font-medium text-foreground">
            {progress.percent}%
            {progress.determinate && progress.planned > 0 ? (
              <span className="ml-1 font-normal text-muted-foreground">
                · {progress.done}/{progress.planned}
              </span>
            ) : null}
          </span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={progress.determinate ? progress.percent : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={heading}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary via-primary/80 to-sky-500 transition-[width] duration-300 ease-out"
            style={{ width: `${Math.max(3, progress.percent)}%` }}
          />
        </div>
      </div>
    </div>
  )

  const statusBar = (
    <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        {foot}
      </span>
      <span className="truncate font-mono text-[10px]">{ep}</span>
    </div>
  )

  if (bare) {
    return (
      <div className={`overflow-hidden rounded-lg border ${className ?? ""}`}>
        {inner}
        {statusBar}
      </div>
    )
  }

  return (
    <Card className={`overflow-hidden border-primary/20 ${className ?? ""}`}>
      {inner}
      {statusBar}
    </Card>
  )
}

/**
 * The animated "scope": a faint grid, a flowing power waveform, a sweeping
 * scan highlight, and three energy nodes pulsing in sequence.
 */
function SignalScope() {
  return (
    <div className="relative h-24 w-full overflow-hidden rounded-xl border border-primary/15 bg-card/60">
      {/* faint grid */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* waveform */}
      <svg viewBox="0 0 240 96" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="tl-wave" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.2" />
            <stop offset="50%" stopColor="var(--primary)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        {/* baseline */}
        <line x1="0" y1="48" x2="240" y2="48" stroke="var(--border)" strokeWidth="1" />
        {/* animated power trace */}
        <path
          d="M0 48 L30 48 L42 20 L54 72 L66 36 L78 48 L120 48 L132 28 L144 64 L156 48 L240 48"
          fill="none"
          stroke="url(#tl-wave)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="240"
          style={{ animation: "signalFlow 2s linear infinite" }}
        />
      </svg>

      {/* scanning highlight */}
      <div
        className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-primary/15 to-transparent"
        style={{ animation: "scanSweep 2.4s ease-in-out infinite" }}
      />

      {/* energy nodes */}
      <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 rounded-full bg-primary"
            style={{ animation: "nodePulse 1.2s ease-in-out infinite", animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>

      {/* corner badge */}
      <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-primary">
        <Zap className="size-2.5" />
        live
      </div>
    </div>
  )
}

/** A small battery that charges from empty toward full, with a glowing fill. */
function ChargingBattery() {
  return (
    <div className="relative flex size-11 shrink-0 items-center justify-center">
      <div className="absolute inset-0 animate-spin rounded-full border-2 border-primary/15 border-t-primary" />
      <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
        {/* battery body */}
        <rect x="6" y="9" width="18" height="14" rx="2.5" fill="none" stroke="var(--primary)" strokeWidth="1.8" />
        {/* terminal */}
        <rect x="24.5" y="13" width="2.5" height="6" rx="1" fill="var(--primary)" />
        {/* animated fill (anchored to bottom via transform-origin) */}
        <rect
          x="8"
          y="11"
          width="14"
          height="10"
          rx="1"
          fill="var(--primary)"
          opacity="0.85"
          style={{ transformOrigin: "8px 21px", animation: "chargeRise 1.4s ease-in-out infinite alternate" }}
        />
        {/* bolt */}
        <path d="M16 11 L12.5 17 L15.5 17 L14 21 L18.5 15 L15.5 15 Z" fill="var(--card)" />
      </svg>
    </div>
  )
}
