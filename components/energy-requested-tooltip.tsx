"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import type { ChargingSession } from "@/lib/simulation-store"

/**
 * Expandable tooltip explaining how "Energy Requested" is calculated.
 * Shows the formula, per-session breakdown with top-N contributors, and total.
 */
export function EnergyRequestedTooltip({
  sessions,
  totalKwh,
  variant = "default",
}: {
  sessions: ChargingSession[]
  totalKwh: number
  variant?: "default" | "compact"
}) {
  const [open, setOpen] = useState(false)

  // Sort by energy descending to show biggest contributors first
  const sorted = [...sessions].sort(
    (a, b) => b.energyRequestedKwh - a.energyRequestedKwh
  )
  const top5 = sorted.slice(0, 5)
  const remaining = sorted.length - 5

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 cursor-pointer hover:underline ${
          variant === "compact"
            ? "text-[10px] text-muted-foreground"
            : "text-xs text-muted-foreground"
        }`}
      >
        <ChevronDown
          className={`size-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
        {open ? "Hide calculation" : "How is this calculated?"}
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t pt-2 text-left">
          {/* Formula */}
          <div className="rounded bg-muted p-2">
            <p className="text-[11px] font-medium text-foreground mb-1">
              Formula (per session)
            </p>
            <div className="font-mono text-[10px] space-y-0.5">
              <p>
                {'energyRequested = batteryCapacity'}
                <span className="text-muted-foreground">{' (kWh)'}</span>
                {' * (targetSOC - arrivalSOC)'}
                <span className="text-muted-foreground">{' (%)'}</span>
                {' / 100'}
              </p>
            </div>
          </div>

          {/* Per-session breakdown */}
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-foreground">
              Per-session breakdown
              {sessions.length > 5 && (
                <span className="font-normal text-muted-foreground">
                  {" "}(top 5 of {sessions.length})
                </span>
              )}
            </p>
            <div className="space-y-0.5 max-h-48 overflow-auto">
              {top5.map((s) => {
                const delta = s.targetSoc - s.arrivalSoc
                return (
                  <div
                    key={s.id}
                    className="flex items-baseline gap-2 font-mono text-[10px]"
                  >
                    <span className="text-muted-foreground w-4 shrink-0 text-right">
                      #{s.id}
                    </span>
                    <span className="truncate text-foreground flex-1 min-w-0">
                      {s.vehicleType}
                    </span>
                    <span className="text-muted-foreground shrink-0">
                      {s.batteryCapacityKwh}*{delta}%
                    </span>
                    <span className="text-foreground font-medium shrink-0 w-14 text-right">
                      {s.energyRequestedKwh.toFixed(1)}
                    </span>
                  </div>
                )
              })}
              {remaining > 0 && (
                <div className="font-mono text-[10px] text-muted-foreground pl-6">
                  + {remaining} more session{remaining > 1 ? "s" : ""} (
                  {(
                    totalKwh - top5.reduce((s, c) => s + c.energyRequestedKwh, 0)
                  ).toFixed(1)}{" "}
                  kWh)
                </div>
              )}
            </div>
          </div>

          {/* Total */}
          <div className="rounded bg-muted p-2 font-mono text-[10px]">
            <span className="text-muted-foreground">
              Total = SUM({sessions.length} sessions) ={" "}
            </span>
            <span className="font-medium text-foreground">
              {totalKwh.toFixed(1)} kWh
            </span>
          </div>

          {/* Example calculation */}
          {top5[0] && (
            <div className="rounded bg-muted p-2">
              <p className="text-[11px] font-medium text-foreground mb-0.5">
                Example: #{top5[0].id} {top5[0].vehicleType}
              </p>
              <div className="font-mono text-[10px] space-y-0.5">
                <p>
                  Battery: {top5[0].batteryCapacityKwh} kWh
                </p>
                <p>
                  SOC: {top5[0].arrivalSoc}%{" -> "}{top5[0].targetSoc}% (delta: {top5[0].targetSoc - top5[0].arrivalSoc}%)
                </p>
                <p className="border-t border-border pt-0.5 mt-0.5">
                  = {top5[0].batteryCapacityKwh} * {top5[0].targetSoc - top5[0].arrivalSoc} / 100 ={" "}
                  <span className="font-medium">
                    {top5[0].energyRequestedKwh.toFixed(1)} kWh
                  </span>
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
