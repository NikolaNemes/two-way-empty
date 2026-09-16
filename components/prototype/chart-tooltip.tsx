"use client"

import * as React from "react"

interface SeriesValue {
  name?: string | number
  value?: string | number
  color?: string
  dataKey?: string | number
  unit?: string
}

interface ChartTooltipContentProps {
  active?: boolean
  payload?: Array<SeriesValue & { payload?: Record<string, unknown> }>
  label?: string | number
  /**
   * How to format the x-axis label that appears at the top of the tooltip.
   * Defaults to identity.
   */
  labelFormatter?: (label: string | number) => React.ReactNode
  /**
   * How to format each series value. Returns the displayable string for
   * the value (number formatting, units, etc).
   */
  valueFormatter?: (value: number | string, name: string) => string
  /**
   * Optional unit suffix appended to every series, e.g. " kW" or " %".
   * Use valueFormatter for fully custom output.
   */
  unit?: string
  /** Maximum number of decimals when default-formatting numbers. */
  precision?: number
}

/**
 * Drop-in replacement for recharts default tooltip that uses the real
 * popover tokens, has a subtle border + shadow, and renders a swatch +
 * series name on each row. Pass it as the `content` prop on <Tooltip />.
 *
 *   <Tooltip content={<ChartTooltipContent unit=" kW" />} />
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
  unit,
  precision = 1,
}: ChartTooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null

  const renderedLabel = labelFormatter ? labelFormatter(label ?? "") : label

  const fmt = (v: number | string, name: string) => {
    if (valueFormatter) return valueFormatter(v, name)
    if (typeof v !== "number" || !Number.isFinite(v)) return "—"
    return `${v.toFixed(precision)}${unit ?? ""}`
  }

  return (
    <div
      className="min-w-[10rem] rounded-md border border-border/70 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/[0.03]"
      role="tooltip"
    >
      {renderedLabel != null && (
        <div className="mb-1.5 border-b border-border/60 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {renderedLabel}
        </div>
      )}
      <ul className="grid gap-1">
        {payload.map((p, i) => {
          const name = String(p.name ?? p.dataKey ?? "")
          const valueText =
            p.value === undefined ? "—" : fmt(p.value as number | string, name)
          return (
            <li
              key={`${name}-${i}`}
              className="flex items-center justify-between gap-3 leading-tight"
            >
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-[2px]"
                  style={{ background: p.color ?? "currentColor" }}
                />
                {name}
              </span>
              <span className="font-mono text-foreground tabular-nums">
                {valueText}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Common axis defaults so every chart in the telemetry section matches. */
export const chartAxisProps = {
  tick: { fontSize: 11, fill: "var(--muted-foreground)" },
  stroke: "var(--border)",
  tickLine: false,
  axisLine: { stroke: "var(--border)" },
}

export const chartGridProps = {
  stroke: "var(--border)",
  strokeOpacity: 0.5,
  strokeDasharray: "3 3",
}
