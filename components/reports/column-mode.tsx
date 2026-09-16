"use client"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * ONE column-visibility rule for every settlement table (Fleet Monthly,
 * Fleet Yearly months + stations).
 *
 * "essential" is a CLOSED money set: every result printed is derivable from
 * the inputs printed next to it, so nothing has to be taken on trust —
 *   Net €      = Flat € − As-run € − Extra wear €
 *   LS gain €  = (No-LS € − As-run €) − Extra wear €
 * plus the one wear base the client asked to see directly (Wear no-LS €).
 * Sized to fit a 1150 px laptop with the sidebar open — no horizontal scroll.
 *
 * "all" adds the volumes (Grid import, EV delivered / AUX or Site load),
 * Sessions, the applied flat rate, the two derived intermediates (Saving €,
 * Wear as-run €) and the audit columns (Data through / Avg spread / Loss
 * days). The Excel export ALWAYS carries every column regardless of this
 * toggle — it is a screen-width control, not a data filter.
 */
export type ColumnMode = "essential" | "all"

/** Columns that appear only in "all" mode. */
export type OptionalColumn =
  | "volumes"
  | "sessions"
  | "flatRate"
  | "procurementSaving"
  | "wearAsRun"
  | "audit"

export function showColumn(mode: ColumnMode, _col: OptionalColumn): boolean {
  return mode === "all"
}

/**
 * Put on the settlement <Table>: lets the two-word header labels ("Wear
 * no-LS €", "Extra wear €") wrap to two lines instead of forcing a column
 * 30 px wider than the numbers under it.
 */
export const SETTLEMENT_TABLE_CLASS =
  "[&_th]:whitespace-normal [&_th]:leading-tight [&_th]:align-bottom [&_th]:py-1.5 [&_th]:min-w-16"

export function ColumnModeTabs({
  value,
  onChange,
}: {
  value: ColumnMode
  onChange: (mode: ColumnMode) => void
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as ColumnMode)}>
      <TabsList className="h-8" aria-label="Table columns">
        <TabsTrigger value="essential" className="px-3 text-xs">
          Essential
        </TabsTrigger>
        <TabsTrigger value="all" className="px-3 text-xs">
          All columns
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
