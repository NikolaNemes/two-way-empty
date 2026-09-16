"use client"

/**
 * STATION SWITCHER — sidebar control for choosing which location the UI
 * shows (multi-location). Searchable picker (Command palette inside a
 * Popover) with MEASURED STATUS per location (Dispatching / Telemetry Only /
 * Disconnected) from one /api/fleet/status aggregate call, fetched only
 * while the picker is open. Disabled (never-enabled) locations are hidden.
 * This control scopes EVERYTHING the app shows, so it reads as a
 * first-class context card, not a menu row.
 */

import { useState } from "react"
import useSWR from "swr"
import { Check, ChevronsUpDown, MapPin } from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useStation } from "@/components/station-context"
import { authedFetcher } from "@/lib/authed-fetcher"

/**
 * MEASURED operational status per location — the same tiers the Fleet
 * Overview reports, from the same single source of truth (/api/fleet/status):
 *   - "full"      → Dispatching     (dispatcher actively driving, fresh plan)
 *   - "telemetry" → Telemetry Only  (data arriving regularly, not driving)
 *   - "offline"   → Disconnected    (ENABLED but data/commands not flowing —
 *                                    an anomaly, shown red)
 *   - "disabled"  → never enabled — these locations are HIDDEN from the
 *                   picker entirely (registry-only entries, nothing to view)
 * One aggregate call covers the entire list — no per-row polling.
 */
type MeasuredStatus = "full" | "telemetry" | "offline" | "disabled"

const STATUS_META: Record<MeasuredStatus, { dot: string; text: string; label: string; ping: boolean }> = {
  full: { dot: "bg-emerald-500", text: "text-emerald-600", label: "Dispatching", ping: true },
  telemetry: { dot: "bg-amber-500", text: "text-amber-600", label: "Telemetry only", ping: true },
  offline: { dot: "bg-red-500", text: "text-red-600", label: "Disconnected", ping: false },
  disabled: { dot: "bg-muted-foreground/40", text: "text-muted-foreground", label: "Disabled", ping: false },
}

/** Map stationId → measured status from the fleet aggregate. */
function useFleetStatuses(enabled: boolean) {
  const { data } = useSWR<{ stations: { stationId: string; status: MeasuredStatus }[] }>(
    enabled ? "/api/fleet/status" : null,
    authedFetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false, keepPreviousData: true },
  )
  const map = new Map<string, MeasuredStatus>()
  if (data?.stations) {
    for (const s of data.stations as { stationId: string; status: MeasuredStatus }[]) {
      map.set(s.stationId, s.status)
    }
  }
  return { statuses: map, loading: data == null }
}

/**
 * Compact status line rendered UNDER the location name (not beside it) so
 * the name always gets the full row width — the old right-aligned
 * "DISPATCHING" badge ate ~40% of the row and forced name truncation.
 */
function StationHealth({ status, loading }: { status: MeasuredStatus | undefined; loading: boolean }) {
  if (loading && !status) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="inline-flex size-1.5 animate-pulse rounded-full bg-muted-foreground/30" />
        <span className="text-[10px] text-muted-foreground/50">Checking…</span>
      </span>
    )
  }
  // Double fallback: `status ?? "offline"` covers a missing entry, the outer
  // `?? STATUS_META.offline` covers an API status value this bundle doesn't
  // know yet (deploy/HMR skew) — same crash class as fleet-overview TIER_META.
  const meta = STATUS_META[status ?? "offline"] ?? STATUS_META.offline
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("relative inline-flex size-1.5 rounded-full", meta.dot)}>
        {meta.ping ? (
          <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", meta.dot)} />
        ) : null}
      </span>
      <span className={cn("text-[10px] font-medium", meta.text)}>{meta.label}</span>
    </span>
  )
}

/**
 * Trigger card: label + name only. The raw station_id is deliberately NOT
 * shown anywhere in this control (client feedback: ugly mono ID crowded the
 * card and stole the line the name needed) — IDs remain searchable in the
 * picker and live in Stations admin for operators who need them.
 */
function CardBody({ label }: { label: string }) {
  return (
    <>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <MapPin className="size-4 text-primary" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
        <span className="text-[9px] uppercase tracking-widest text-sidebar-foreground/45 font-semibold">
          Location
        </span>
        <span className="truncate text-[13px] font-semibold text-sidebar-foreground">{label}</span>
      </div>
    </>
  )
}

export function StationSwitcher() {
  const { stationId, station, stations, loaded, setStationId } = useStation()
  const [open, setOpen] = useState(false)
  // One aggregate status call for all rows, fetched only while the picker is open.
  const { statuses, loading: statusesLoading } = useFleetStatuses(open)
  const enabled = stations.filter((s) => s.enabled)
  const label = station?.name ?? (loaded ? stationId : "Loading…")

  if (enabled.length <= 1 && stations.length <= 1) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2">
        <CardBody label={label} />
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="group/switcher flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-left outline-none transition-colors hover:border-primary/40 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-primary/40 data-[state=open]:bg-sidebar-accent">
        <CardBody label={label} />
        <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-foreground/40 transition-colors group-hover/switcher:text-sidebar-foreground/70" />
      </PopoverTrigger>
      {/* Fixed width slightly wider than the sidebar trigger: rows need room
          for full names + status line without wrapping or truncating. */}
      <PopoverContent align="start" sideOffset={6} className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search locations…" className="h-9" />
          <CommandList>
            <CommandEmpty>No location found.</CommandEmpty>
            <CommandGroup heading="Locations">
              {/* Disabled (never enabled) locations are hidden — the picker
                  only offers locations that are actually connected/tracked.
                  The station_id stays in `value` so operators can still
                  search by ID even though it's not displayed. */}
              {enabled.map((s) => {
                const active = s.stationId === stationId
                return (
                  <CommandItem
                    key={s.stationId}
                    value={`${s.name} ${s.stationId}`}
                    onSelect={() => {
                      setStationId(s.stationId)
                      setOpen(false)
                    }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-2",
                      active && "bg-primary/5",
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-md",
                        active ? "bg-primary/15" : "bg-muted",
                      )}
                    >
                      <MapPin className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
                      <span className={cn("truncate text-[13px]", active ? "font-semibold" : "font-medium")}>
                        {s.name}
                      </span>
                      <StationHealth status={statuses.get(s.stationId)} loading={statusesLoading} />
                    </div>
                    <Check
                      className={cn(
                        "size-4 shrink-0 text-primary transition-opacity",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
