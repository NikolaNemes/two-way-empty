"use client"

import { Card } from "@/components/ui/card"
import { type TelemetryFrame } from "@/lib/prototype-telemetry"
import { InfoHint } from "@/components/prototype/info-hint"

interface Props {
  frame: TelemetryFrame
}

/**
 * Top-of-page clock widget.
 *
 * Left  : large digital clock (HH:MM:SS) and the human-readable date.
 * Right : 24-hour position bar with the current wall-clock as a primary-color
 *         marker. No price/period semantics — EPEX information lives in its
 *         own widget on the bird's-eye view.
 */
export function TimeOfDayBar({ frame }: Props) {
  const d = new Date(frame.ts)

  // Extract time in Europe/Berlin timezone (CEST/CET)
  // The server runs in UTC, so we must explicitly format in Europe/Berlin
  const berlinTime = d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Berlin",
    hour12: false,
  })
  const [hh, mm, ss] = berlinTime.split(":")

  // For day fraction, we need the Berlin hours/minutes/seconds
  const berlinHours = parseInt(hh, 10)
  const berlinMins = parseInt(mm, 10)
  const berlinSecs = parseInt(ss, 10)

  // Fraction of the day (0..1) — used to position the now-marker.
  const dayFraction =
    (berlinHours * 3600 + berlinMins * 60 + berlinSecs) / 86400
  const dayPercent = dayFraction * 100

  const dateLabel = d.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Berlin",
  })

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:gap-6">
        {/* Clock */}
        <div className="flex shrink-0 items-baseline gap-3">
          <div className="font-mono text-3xl md:text-4xl font-semibold tabular-nums tracking-tight">
            <span>{hh}</span>
            <span className="text-muted-foreground/40">:</span>
            <span>{mm}</span>
            <span className="text-muted-foreground/40">:</span>
            <span className="text-muted-foreground">{ss}</span>
          </div>
          <div className="flex flex-col text-[11px] uppercase tracking-wider text-muted-foreground leading-tight">
            <span>{dateLabel}</span>
            <span className="font-mono normal-case tracking-normal text-foreground/70">
              local time
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="hidden md:block h-12 w-px bg-border" />

        {/* 24-hour bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
            <span className="inline-flex items-center gap-1">
              Time of day
              <InfoHint side="bottom">
                <p className="font-medium mb-1">Daily monitoring timeline</p>
                <p>
                  Position of the current telemetry frame within the 24 h day.
                  The marker walks across the bar once per second as new
                  telemetry arrives. Live spot-market price information lives
                  on the EPEX widget on the bird&rsquo;s-eye view.
                </p>
              </InfoHint>
            </span>
            <span className="font-mono normal-case tracking-normal text-foreground/70">
              {dayPercent.toFixed(1)}% of day
            </span>
          </div>

          {/* Bar */}
          <div
            className="relative h-7 rounded-md overflow-hidden border bg-muted/30"
            role="img"
            aria-label={`Current time ${hh}:${mm} of 24 hours`}
          >
            {/* Hour ticks */}
            <div className="absolute inset-0 flex">
              {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                <div
                  key={h}
                  className={`flex-1 border-l ${
                    h === 0
                      ? "border-transparent"
                      : h % 6 === 0
                      ? "border-foreground/15"
                      : "border-foreground/[0.06]"
                  }`}
                />
              ))}
            </div>

            {/* Now marker */}
            <div
              className="absolute inset-y-0 w-px bg-primary shadow-[0_0_0_1px_var(--primary)]"
              style={{ left: `${dayPercent}%` }}
            >
              <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 size-2 rounded-full bg-primary ring-2 ring-background" />
              <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 size-2 rounded-full bg-primary ring-2 ring-background" />
            </div>
          </div>

          {/* Hour labels */}
          <div className="relative mt-1 h-4 text-[10px] font-mono text-muted-foreground">
            {[0, 6, 12, 18, 24].map((h) => (
              <span
                key={h}
                className={`absolute top-0 ${
                  h === 0
                    ? "translate-x-0"
                    : h === 24
                    ? "-translate-x-full"
                    : "-translate-x-1/2"
                }`}
                style={{ left: `${(h / 24) * 100}%` }}
              >
                {h.toString().padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
