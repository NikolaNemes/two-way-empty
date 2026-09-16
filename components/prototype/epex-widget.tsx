"use client"

import { TrendingDown, TrendingUp } from "lucide-react"
import type { TelemetryFrame } from "@/lib/prototype-telemetry"
import { InfoHint } from "@/components/prototype/info-hint"

interface Props {
  frame: TelemetryFrame
  /** Optional className to position the widget (e.g. as an SVG overlay) */
  className?: string
  /** Compact mode for mobile - hides some elements */
  compact?: boolean
}

/**
 * Compact EPEX intraday-spot widget.
 *
 * Designed to sit as an overlay in the upper-left corner of the
 * bird's-eye view. Shows the active 15-minute slot label, the cleared
 * spot price (€/MWh) with a tone derived from cheap / mid / expensive
 * thresholds, and a small trend chevron derived from the price tag in
 * the slot label suffix (the trend logic is intentionally lightweight —
 * it just colours the chevron based on whether the price is above or
 * below a configurable mid-band).
 */
export function EpexWidget({ frame, className = "", compact = false }: Props) {
  const epex = frame.market.epex_price_eur_mwh
  const slot = frame.market.slot_label

  const tone =
    epex > 110
      ? {
          ring: "ring-red-500/30",
          dot: "bg-red-500",
          text: "text-red-600 dark:text-red-400",
          label: "Expensive",
          Icon: TrendingUp,
        }
      : epex < 60
        ? {
            ring: "ring-emerald-500/30",
            dot: "bg-emerald-500",
            text: "text-emerald-600 dark:text-emerald-500",
            label: "Cheap",
            Icon: TrendingDown,
          }
        : {
            ring: "ring-amber-500/30",
            dot: "bg-amber-500",
            text: "text-amber-600 dark:text-amber-500",
            label: "Mid-band",
            Icon: TrendingUp,
          }
  const Icon = tone.Icon

  // Compact mode for mobile - minimal footprint
  if (compact) {
    return (
      <div
        className={`pointer-events-auto rounded-md border bg-background/95 backdrop-blur-sm shadow-sm ring-1 ${tone.ring} px-2 py-1.5 ${className}`}
      >
        <div className="flex items-center gap-1.5">
          <span className="relative flex size-1.5">
            <span className={`absolute inset-0 ${tone.dot} rounded-full opacity-75 animate-ping`} />
            <span className={`relative size-1.5 rounded-full ${tone.dot}`} />
          </span>
          <span className={`font-mono text-sm font-semibold tabular-nums ${tone.text}`}>
            {epex.toFixed(0)}
          </span>
          <span className="text-[9px] text-muted-foreground">€</span>
          <Icon className="size-3 ml-auto" />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`pointer-events-auto rounded-lg border bg-background/95 backdrop-blur-sm shadow-sm ring-1 ${tone.ring} px-3 py-2 ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="relative flex size-1.5">
            <span
              className={`absolute inset-0 ${tone.dot} rounded-full opacity-75 animate-ping`}
            />
            <span className={`relative size-1.5 rounded-full ${tone.dot}`} />
          </span>
          EPEX Intraday
          <InfoHint side="bottom" align="start">
            <p className="font-medium mb-1">EPEX intraday spot price</p>
            <p>
              Continuous intraday clearing price for the current 15-minute
              settlement slot in the {frame.market.slot_label} window. This
              value drives every arbitrage decision the optimizer makes:
              cheap windows trigger battery charging from the grid, expensive
              windows trigger battery discharge to cover EV demand.
            </p>
            <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
              API: GET /telemetry/latest<br />
              Price: prices.idm (fallback: prices.dam)<br />
              Slot: prices.bucket_ts → Europe/Berlin time
            </p>
          </InfoHint>
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {slot}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`font-mono text-2xl font-semibold tabular-nums ${tone.text}`}>
          {epex.toFixed(1)}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          €/MWh
        </span>
      </div>
      <div
        className={`mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium ${tone.text}`}
      >
        <Icon className="size-3" />
        {tone.label}
      </div>
    </div>
  )
}
