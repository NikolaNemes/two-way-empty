"use client"

// ── Station registry admin ───────────────────────────────────────────────────
// Table of locations + add/edit dialog. Onboarding a new location happens
// here (INSERT into the stations table via server action) — no deploy needed.

import { useState } from "react"
import useSWR from "swr"
import {
  listStationsAction,
  upsertStationAction,
  setStationFlagsAction,
  setStationSiteClassAction,
} from "@/app/actions/stations"
import type { SiteClass, StationConfig } from "@/lib/stations"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Plus, Pencil, MapPin, Search } from "lucide-react"

const EMPTY: StationConfig = {
  stationId: "",
  name: "",
  siteId: "",
  assetId: "",
  enabled: true,
  dispatchEnabled: false,
  gridImportLimitKw: 90,
  gridRealPowerCapKw: 90,
  battCount: 2,
  battCapacityKwh: 280,
  battMaxPowerKw: 120,
  connectorSingleMaxW: 150_000,
  connectorDualMaxW: 300_000,
  flatRateCtKwh: 12.5,
  wearCtKwh: 3.5,
  idmAdderCtKwh: 0,
  priceZone: "DE-LU",
  linkedStationId: null,
  siteClass: null,
  notes: null,
}

export function StationsAdmin() {
  // fresh: true — the admin must read its own writes immediately; the server
  // TTL cache is per instance and can serve a pre-write row for up to 30s.
  const { data: stations, mutate } = useSWR("stations:all", () => listStationsAction({ fresh: true }), {
    revalidateOnFocus: false,
  })

  /** Optimistically apply a flag patch (with the coupling invariant mirrored
   *  client-side), then persist and revalidate — the switch never flips back
   *  while the round-trip is in flight. */
  const toggleFlags = async (stationId: string, patch: { telemetry?: boolean; dispatch?: boolean }) => {
    await mutate(
      async (current) => {
        await setStationFlagsAction(stationId, patch)
        return current?.map((s) => {
          if (s.stationId !== stationId) return s
          let { enabled, dispatchEnabled } = s
          if (patch.dispatch !== undefined) {
            dispatchEnabled = patch.dispatch
            if (patch.dispatch) enabled = true
          }
          if (patch.telemetry !== undefined) {
            enabled = patch.telemetry
            if (!patch.telemetry) dispatchEnabled = false
          }
          return { ...s, enabled, dispatchEnabled }
        })
      },
      {
        optimisticData: (current) =>
          (current ?? []).map((s) => {
            if (s.stationId !== stationId) return s
            let { enabled, dispatchEnabled } = s
            if (patch.dispatch !== undefined) {
              dispatchEnabled = patch.dispatch
              if (patch.dispatch) enabled = true
            }
            if (patch.telemetry !== undefined) {
              enabled = patch.telemetry
              if (!patch.telemetry) dispatchEnabled = false
            }
            return { ...s, enabled, dispatchEnabled }
          }),
        rollbackOnError: true,
        revalidate: true,
      },
    )
  }
  /** Inline site-class change from the list — optimistic like toggleFlags,
   *  so the select never snaps back while the round-trip is in flight. */
  const setSiteClass = async (stationId: string, siteClass: SiteClass | null) => {
    await mutate(
      async (current) => {
        await setStationSiteClassAction(stationId, siteClass)
        return current?.map((s) => (s.stationId === stationId ? { ...s, siteClass } : s))
      },
      {
        optimisticData: (current) =>
          (current ?? []).map((s) => (s.stationId === stationId ? { ...s, siteClass } : s)),
        rollbackOnError: true,
        revalidate: true,
      },
    )
  }

  const [editing, setEditing] = useState<StationConfig | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [query, setQuery] = useState("")
  // "Enabled only" hides registry-only (never enabled) locations — the bulk
  // of the archive imports — leaving just the actually connected ones.
  const [enabledOnly, setEnabledOnly] = useState(false)

  // Case-insensitive match on name, site ID, or station ID.
  const q = query.trim().toLowerCase()
  const visible = (stations ?? []).filter(
    (s) =>
      (!enabledOnly || s.enabled) &&
      (!q ||
        s.name.toLowerCase().includes(q) ||
        s.siteId.toLowerCase().includes(q) ||
        s.stationId.toLowerCase().includes(q)),
  )

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2">
              <MapPin className="size-4 text-muted-foreground" aria-hidden />
              Stations
            </CardTitle>
            <CardDescription>
              Location registry — physical and commercial parameters per Chargepost. The dispatcher,
              backtest and reports all read from here.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditing(EMPTY)
              setIsNew(true)
            }}
          >
            <Plus className="size-4" aria-hidden />
            Add station
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex items-center gap-3">
            <div className="relative w-full max-w-sm">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                placeholder="Search by name or site ID…"
                aria-label="Search stations by name or site ID"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
              <Switch
                checked={enabledOnly}
                onCheckedChange={setEnabledOnly}
                aria-label="Show enabled stations only"
              />
              Enabled only
            </label>
            {q || enabledOnly ? (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {visible.length} of {(stations ?? []).length}
              </span>
            ) : null}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Station</TableHead>
                <TableHead>Grid (kW)</TableHead>
                <TableHead>Storage</TableHead>
                <TableHead>Flat / wear (ct)</TableHead>
                <TableHead>Zone</TableHead>
                <TableHead>Site class</TableHead>
                <TableHead>Telemetry</TableHead>
                <TableHead>Dispatching</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && stations ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">
                    No station matches &quot;{query}&quot;.
                  </TableCell>
                </TableRow>
              ) : null}
              {visible.map((s) => (
                <TableRow key={s.stationId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1.5 font-medium">
                        {s.name}
                        {/* Pilot stations absorb their historical twin row
                            (linked_station_id) — one physical location. */}
                        {s.stationId.startsWith("chargepost_") ? (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                            Live pilot
                          </Badge>
                        ) : null}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">{s.stationId}</span>
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {s.gridRealPowerCapKw} / {s.gridImportLimitKw}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {s.battCount} × {s.battCapacityKwh} kWh
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {s.flatRateCtKwh} / {s.wearCtKwh}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{s.priceZone}</Badge>
                  </TableCell>
                  <TableCell>
                    {/* Inline classifier — "unknown" maps to null in the DB. */}
                    <Select
                      value={s.siteClass ?? "unknown"}
                      onValueChange={(v) => setSiteClass(s.stationId, v === "unknown" ? null : (v as SiteClass))}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={`Site class for ${s.name}`}
                        className={`h-7 w-[110px] text-xs ${s.siteClass ? "" : "text-muted-foreground"}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unknown">Unknown</SelectItem>
                        <SelectItem value="ev_only">EV-only</SelectItem>
                        <SelectItem value="ev_pv">EV + PV</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={s.enabled}
                      aria-label={`Telemetry for ${s.name}`}
                      // Turning telemetry OFF also drops dispatch (enforced
                      // server-side too — you cannot drive blind).
                      onCheckedChange={(v) => toggleFlags(s.stationId, { telemetry: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={s.dispatchEnabled}
                      aria-label={`Dispatching for ${s.name}`}
                      // Turning dispatch ON auto-enables telemetry.
                      onCheckedChange={(v) => toggleFlags(s.stationId, { dispatch: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${s.name}`}
                      onClick={() => {
                        setEditing(s)
                        setIsNew(false)
                      }}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {stations && stations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No stations registered.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing ? (
        <StationDialog
          station={editing}
          isNew={isNew}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            mutate()
          }}
        />
      ) : null}
    </div>
  )
}

function NumberField({
  id,
  label,
  value,
  step,
  onChange,
}: {
  id: string
  label: string
  value: number
  step?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        step={step ?? "any"}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        className="tabular-nums"
      />
    </div>
  )
}

function StationDialog({
  station,
  isNew,
  onClose,
  onSaved,
}: {
  station: StationConfig
  isNew: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<StationConfig>(station)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof StationConfig>(k: K, v: StationConfig[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add station" : `Edit ${station.name}`}</DialogTitle>
          <DialogDescription>
            {isNew
              ? "Register a new Chargepost location. The station id must match the Amperio API station_id."
              : "Physical limits feed the dispatcher and backtest; commercial rates feed the financial reports."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-id" className="text-xs">
                Station id (Amperio)
              </Label>
              <Input
                id="st-id"
                value={form.stationId}
                disabled={!isNew}
                onChange={(e) => set("stationId", e.target.value)}
                placeholder="chargepost_city_001"
                className="font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-name" className="text-xs">
                Display name
              </Label>
              <Input
                id="st-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Chargepost City"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-site" className="text-xs">
                Site id
              </Label>
              <Input
                id="st-site"
                value={form.siteId}
                onChange={(e) => set("siteId", e.target.value)}
                placeholder="site_city_01"
                className="font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="st-asset" className="text-xs">
                Asset id
              </Label>
              <Input
                id="st-asset"
                value={form.assetId}
                onChange={(e) => set("assetId", e.target.value)}
                placeholder="chargepost_city_001"
                className="font-mono"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Physical
            </span>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <NumberField
                id="st-gil"
                label="Grid import limit (kW)"
                value={form.gridImportLimitKw}
                onChange={(v) => set("gridImportLimitKw", v)}
              />
              <NumberField
                id="st-cap"
                label="Real-power cap (kW)"
                value={form.gridRealPowerCapKw}
                onChange={(v) => set("gridRealPowerCapKw", v)}
              />
              <NumberField
                id="st-bc"
                label="Battery packs"
                value={form.battCount}
                step="1"
                onChange={(v) => set("battCount", v)}
              />
              <NumberField
                id="st-bkwh"
                label="Capacity per pack (kWh)"
                value={form.battCapacityKwh}
                onChange={(v) => set("battCapacityKwh", v)}
              />
              <NumberField
                id="st-bkw"
                label="Pack max power (kW)"
                value={form.battMaxPowerKw}
                onChange={(v) => set("battMaxPowerKw", v)}
              />
              <NumberField
                id="st-c1"
                label="Connector single max (W)"
                value={form.connectorSingleMaxW}
                onChange={(v) => set("connectorSingleMaxW", v)}
              />
              <NumberField
                id="st-c2"
                label="Connector dual max (W)"
                value={form.connectorDualMaxW}
                onChange={(v) => set("connectorDualMaxW", v)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Commercial
            </span>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <NumberField
                id="st-flat"
                label="Flat rate (ct/kWh)"
                value={form.flatRateCtKwh}
                onChange={(v) => set("flatRateCtKwh", v)}
              />
              <NumberField
                id="st-wear"
                label="Wear (ct/kWh throughput)"
                value={form.wearCtKwh}
                onChange={(v) => set("wearCtKwh", v)}
              />
              <NumberField
                id="st-adder"
                label="IDM adder (ct/kWh)"
                value={form.idmAdderCtKwh}
                onChange={(v) => set("idmAdderCtKwh", v)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="st-enabled"
                  checked={form.enabled}
                  onCheckedChange={(v) =>
                    // No telemetry ⇒ no dispatch (cannot drive blind).
                    setForm((f) => ({ ...f, enabled: v, dispatchEnabled: v ? f.dispatchEnabled : false }))
                  }
                />
                <Label htmlFor="st-enabled" className="text-sm">
                  Telemetry enabled
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="st-dispatch"
                  checked={form.dispatchEnabled}
                  onCheckedChange={(v) =>
                    // Dispatch ⇒ telemetry auto-on.
                    setForm((f) => ({ ...f, dispatchEnabled: v, enabled: v ? true : f.enabled }))
                  }
                />
                <Label htmlFor="st-dispatch" className="text-sm">
                  Dispatching enabled
                </Label>
              </div>
            </div>
            <Badge variant="outline">{form.priceZone}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Telemetry = the platform tracks this location (whether data actually arrives is measured on
            the Fleet Overview). Dispatching = the optimizer actively drives it — enabling dispatch turns
            telemetry on automatically.
          </p>

          {/* Site class: manual master data from the partner (drives the
              site-class split on the yearly report). Never auto-derived. */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm">Site class</Label>
            <div className="flex gap-2">
              {(
                [
                  { value: null, label: "Unknown" },
                  { value: "ev_only", label: "EV-only" },
                  { value: "ev_pv", label: "EV + PV" },
                ] as const
              ).map((opt) => (
                <Button
                  key={opt.label}
                  type="button"
                  size="sm"
                  variant={form.siteClass === opt.value ? "default" : "outline"}
                  onClick={() => setForm((f) => ({ ...f, siteClass: opt.value }))}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              setError(null)
              const res = await upsertStationAction(form)
              setSaving(false)
              if (res.ok) onSaved()
              else setError(res.error)
            }}
          >
            {saving ? "Saving…" : "Save station"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
