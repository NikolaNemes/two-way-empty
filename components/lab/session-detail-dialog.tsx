"use client"

// ════════════════════════════════════════════════════════════════════════
// SESSION DETAIL DIALOG — per-session supply breakdown popover
// ════════════════════════════════════════════════════════════════════════
//
// Opened by clicking a bar in the C1/C2 charging-session strip. Shows, over
// the SESSION'S duration only (X-axis clamped to [startMs, endMs]), how that
// connector's EV demand was met each frame, decomposed into:
//   • Grid      — grid import that served the car
//   • Battery 1 — discharge from pack 1
//   • Battery 2 — discharge from pack 2
// stacked as areas (kW), with the connector's REQUESTED demand overlaid as a
// line so served-vs-requested (and any curtailment) is visible.
//
// Attribution hierarchy (strongest truth first):
//   1. MEASURED station grid import — the grid can only have supplied up to
//      its metered import (by demand share); the battery pool covers the rest.
//      Live-telemetry ground truth: catches battery-first serving with
//      import ≈ 0, which engine setpoints (optimizer-mode fields, often 0 in
//      the live view) miss entirely.
//   2. Engine as-run split (b1Kw/b2Kw setpoints) for optimized replays.
//   3. Cap physics (grid up to site cap) for raw BMS datasets.
// Battery serve is then split across the two physical packs by their
// per-frame SOC drops (dual-mode: both packs can feed one car).
// ════════════════════════════════════════════════════════════════════════

import { useMemo } from "react"
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type { DispatchPoint, SessionLite } from "./dispatching-overview"
import { GRID_REAL_POWER_CAP_KW } from "@/lib/dispatch-kernel"

// Source-family colour coding so a glance tells you WHERE the energy came from:
//   • GRID    — warm orange (chart-1): energy imported from OUTSIDE the site.
//   • BATTERY — a shared BLUE family: stored on-site energy. The two packs use
//     the same hue at different lightness (B1 deep, B2 light) so they read as
//     "both battery" while staying distinguishable from each other.
//   • SERVED  — neutral foreground line (the car's delivered power).
const GRID_COLOR = "var(--chart-1)"
const BAT1_COLOR = "oklch(0.50 0.13 240)" // deep blue — Battery 1
const BAT2_COLOR = "oklch(0.68 0.11 240)" // light blue (same hue) — Battery 2

// Fallback site grid-import cap (kW) when a frame carries no per-frame limit.
// Single-sourced from the dispatch kernel's REAL-power cap (~83.5 kW; the 87
// nameplate is kVA at PF ≈ 0.96); used to split metered served into grid vs
// battery — using 87 would over-attribute served power to the grid.
const DEFAULT_GRID_CAP_KW = GRID_REAL_POWER_CAP_KW

const CHART_CONFIG: ChartConfig = {
  gridKw: { label: "Grid", color: GRID_COLOR },
  bat1Kw: { label: "Battery 1", color: BAT1_COLOR },
  bat2Kw: { label: "Battery 2", color: BAT2_COLOR },
  requestedKw: { label: "Served", color: "var(--foreground)" },
}

const SOC_CONFIG: ChartConfig = {
  carSoc: { label: "Car SOC %", color: "var(--chart-1)" },
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

/** Humanise a time-to-full estimate (seconds) into e.g. "1h 20m" / "45m". */
function fmtEta(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function SessionDetailDialog({
  session,
  points,
  open,
  onOpenChange,
}: {
  session: SessionLite | null
  points: DispatchPoint[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { rows, totals, unit, hasData, hasSoc } = useMemo(() => {
    if (!session) return { rows: [], totals: null, unit: "1", hasData: false, hasSoc: false }
    const u = session.unitId
    // Pick this connector's per-unit fields (unit 1 → A, unit 2 → B).
    const pick = (p: DispatchPoint) =>
      u === "1"
        ? { g: p.g1Kw, b: p.b1Kw, ev: p.ev1Kw, mEv: p.mEv1Kw, mEvOther: p.mEv2Kw, soc: p.ev1SocCarPct }
        : { g: p.g2Kw, b: p.b2Kw, ev: p.ev2Kw, mEv: p.mEv2Kw, mEvOther: p.mEv1Kw, soc: p.ev2SocCarPct }
    const validSoc = (s: number | null | undefined): number | null =>
      typeof s === "number" && s >= 0 && s <= 100 ? s : null
    // Per-pack SOC reading (measured preferred, simulated fallback) for the
    // dual-mode discharge split below.
    const packSoc = (s: number | null | undefined): number | null =>
      typeof s === "number" && Number.isFinite(s) ? s : null

    // Pad the window slightly so the session edges are visible.
    const pad = 90_000
    const inWindow = points.filter((p) => {
      const t = new Date(p.ts).getTime()
      return t >= session.startMs - pad && t <= session.endMs + pad
    })

    let gridSum = 0
    let bat1Sum = 0
    let bat2Sum = 0
    let servedSum = 0
    let reqSum = 0
    let lastT = inWindow.length ? new Date(inWindow[0].ts).getTime() : 0
    let firstSoc: number | null = null
    let lastSoc: number | null = null
    let hasSoc = false
    // Previous per-pack SOC, to detect which physical pack(s) discharged each
    // frame (SOC falling ⇒ that pack is supplying). Both packs form a shared
    // pool feeding both connectors, so dual-mode discharge is real.
    let prevPack1: number | null = null
    let prevPack2: number | null = null
    // Decayed per-pack discharge accumulators. Pack SOC is reported in coarse
    // steps, so raw per-frame drops arrive as alternating spikes (one pack
    // "drops" while the other is flat, then vice versa) — splitting by the raw
    // drop made the B1/B2 bands saw-tooth to zero. Decayed sums retain each
    // pack's recent discharge trend, so the split follows which pack is REALLY
    // supplying while staying responsive to genuine handoffs between packs.
    const DECAY = 0.75
    let acc1 = 0
    let acc2 = 0

    const mapped = inWindow.map((p) => {
      const t = new Date(p.ts).getTime()
      const dtH = Math.max(0, (t - lastT) / 3_600_000)
      lastT = t
      const { g, b, ev, mEv, mEvOther, soc } = pick(p)
      // SERVED = what the car actually got this frame. In this LIVE-telemetry view
      // the ground truth is the METERED delivered power (mEv); fall back to the
      // simulated split only when no meter counter exists.
      const served =
        mEv != null
          ? Math.max(0, mEv)
          : ev != null
            ? Math.max(0, ev)
            : Math.max(0, (g ?? 0) - (b ?? 0))
      // SOURCE SPLIT — attribution hierarchy, strongest truth first:
      //
      //  1. MEASURED station grid import (meteredImportKw / actualImportKw).
      //     The grid can only have served this car up to its metered import
      //     (allocated by demand share); whatever the meter did NOT import
      //     while the car was drawing power MUST have come from the battery
      //     pool. This is the live-telemetry ground truth: it catches the real
      //     case where the BMS serves a car battery-first with import ≈ 0 —
      //     which the engine setpoints below can miss entirely (in the live
      //     view b1Kw/b2Kw are optimizer-mode fields and often 0/absent, which
      //     previously misattributed a fully battery-served session to grid).
      //  2. ENGINE as-run split (b1Kw/b2Kw setpoints): station discharge
      //     max(0, −(b1+b2)) allocated by demand share (optimized replays).
      //  3. CAP PHYSICS (raw BMS datasets with neither signal): grid up to the
      //     site cap, battery covers the surplus above it.
      //
      // In every branch grid + battery equals served exactly (no white gap).
      const evOther = Math.max(0, mEvOther ?? 0)
      const totalEv = served + evOther
      const demandShare = totalEv > 0 ? served / totalEv : 1
      const measuredImportKw = p.meteredImportKw ?? p.actualImportKw
      const hasEngineSplit = p.b1Kw != null || p.b2Kw != null
      let batteryServe: number
      if (measuredImportKw != null) {
        // Grid share of this connector is bounded by the metered import
        // allocated by demand share; the battery pool covers the remainder.
        const gridAvail = Math.max(0, Math.abs(measuredImportKw)) * demandShare
        batteryServe = Math.max(0, served - Math.min(served, gridAvail))
      } else if (hasEngineSplit) {
        const stationDischargeKw = Math.max(0, -((p.b1Kw ?? 0) + (p.b2Kw ?? 0)))
        batteryServe = Math.min(served, stationDischargeKw * demandShare)
      } else {
        // Fallback (no meter and no engine per-unit fields): cap physics —
        // grid up to the available cap, battery covers the surplus.
        const gridAvail =
          p.siteGridLimitKw != null && p.siteGridLimitKw > 0
            ? p.siteGridLimitKw
            : DEFAULT_GRID_CAP_KW
        batteryServe = Math.max(0, served - Math.min(served, gridAvail * demandShare))
      }
      const gridServe = Math.max(0, served - batteryServe)
      // DUAL-MODE pack attribution: split this connector's battery serve across
      // the two PHYSICAL packs in proportion to how much each actually
      // discharged this frame (measured pack SOC falling; simulated SOC as
      // fallback). This surfaces both packs feeding one car — the real behaviour
      // of the shared battery pool — instead of the old fixed connector↔pack map
      // that always pinned all discharge onto a single pack.
      const pack1 = packSoc(p.actualB1SocPct) ?? packSoc(p.b1SocPct)
      const pack2 = packSoc(p.actualB2SocPct) ?? packSoc(p.b2SocPct)
      const drop1 = prevPack1 != null && pack1 != null ? Math.max(0, prevPack1 - pack1) : 0
      const drop2 = prevPack2 != null && pack2 != null ? Math.max(0, prevPack2 - pack2) : 0
      if (pack1 != null) prevPack1 = pack1
      if (pack2 != null) prevPack2 = pack2
      // Decayed accumulation smooths the coarse SOC-step reporting (see above).
      acc1 = acc1 * DECAY + drop1
      acc2 = acc2 * DECAY + drop2
      const dropSum = acc1 + acc2
      let w1: number
      let w2: number
      if (dropSum > 1e-6) {
        // Both packs equal capacity, so the SOC-drop ratio is the energy ratio.
        w1 = acc1 / dropSum
        w2 = acc2 / dropSum
      } else {
        // No discharge signal this frame (flat/rounded SOC) → fall back to the
        // connector's nominally-paired pack so energy is never lost.
        w1 = u === "1" ? 1 : 0
        w2 = u === "1" ? 0 : 1
      }
      const bat1 = batteryServe * w1
      const bat2 = batteryServe * w2
      const requested = served

      gridSum += gridServe * dtH
      bat1Sum += bat1 * dtH
      bat2Sum += bat2 * dtH
      servedSum += served * dtH
      reqSum += requested * dtH

      const socPct = validSoc(soc)
      if (socPct != null) {
        hasSoc = true
        if (firstSoc == null) firstSoc = socPct
        lastSoc = socPct
      }

      return {
        t,
        clock: fmtClock(t),
        gridKw: Math.round(gridServe * 10) / 10,
        bat1Kw: Math.round(bat1 * 10) / 10,
        bat2Kw: Math.round(bat2 * 10) / 10,
        requestedKw: Math.round(requested * 10) / 10,
        carSoc: socPct,
      }
    })

    return {
      rows: mapped,
      unit: u,
      hasData: mapped.length > 0,
      hasSoc,
      totals: {
        gridKwh: Math.round(gridSum * 10) / 10,
        bat1Kwh: Math.round(bat1Sum * 10) / 10,
        bat2Kwh: Math.round(bat2Sum * 10) / 10,
        servedKwh: Math.round(servedSum * 10) / 10,
        requestedKwh: Math.round(reqSum * 10) / 10,
        startSoc: firstSoc as number | null,
        endSoc: lastSoc as number | null,
      },
    }
  }, [session, points])

  const durationMin = session ? Math.round((session.endMs - session.startMs) / 60_000) : 0
  // SoC over the session: prefer the per-frame values measured here; fall back
  // to the session summary captured upstream.
  const startSoc = totals?.startSoc ?? session?.startSocPct ?? null
  const endSoc = totals?.endSoc ?? session?.endSocPct ?? null
  const deltaSoc = startSoc != null && endSoc != null ? endSoc - startSoc : null
  const etaLabel = fmtEta(session?.etaFullS)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {session ? `Connector C${unit} session — supply & charge curve` : "Session"}
          </DialogTitle>
          <DialogDescription>
            {session
              ? `${fmtClock(session.startMs)} → ${fmtClock(session.endMs)} · ${durationMin} min · ${session.energyKwh} kWh delivered · ${session.avgKw} kW avg`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {hasData && totals ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="From grid" value={`${totals.gridKwh} kWh`} swatch={GRID_COLOR} />
              <Stat label="From battery 1" value={`${totals.bat1Kwh} kWh`} swatch={BAT1_COLOR} />
              <Stat label="From battery 2" value={`${totals.bat2Kwh} kWh`} swatch={BAT2_COLOR} />
              <Stat label="Delivered" value={`${totals.servedKwh} kWh`} />
              <Stat
                label="Car SOC"
                value={
                  startSoc != null && endSoc != null
                    ? `${startSoc.toFixed(0)} → ${endSoc.toFixed(0)}%`
                    : "—"
                }
                hint={deltaSoc != null ? `+${deltaSoc.toFixed(0)} pts` : undefined}
              />
              <Stat label="Time to full" value={etaLabel ?? "—"} />
            </div>

            <ChartContainer config={CHART_CONFIG} className="aspect-[16/7] w-full">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="clock"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={32}
                  fontSize={11}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  fontSize={11}
                  unit="kW"
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Area
                  type="monotone"
                  dataKey="gridKw"
                  stackId="supply"
                  stroke="var(--color-gridKw)"
                  fill="var(--color-gridKw)"
                  fillOpacity={0.35}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="bat1Kw"
                  stackId="supply"
                  stroke="var(--color-bat1Kw)"
                  fill="var(--color-bat1Kw)"
                  fillOpacity={0.35}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="bat2Kw"
                  stackId="supply"
                  stroke="var(--color-bat2Kw)"
                  fill="var(--color-bat2Kw)"
                  fillOpacity={0.35}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="requestedKw"
                  stroke="var(--color-requestedKw)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ChartContainer>
            <p className="text-xs text-muted-foreground text-pretty">
              Stacked areas show how connector C{unit}&apos;s metered demand was sourced each
              frame, anchored to the station&apos;s METERED grid import: the grid can only have
              supplied this car up to what the site actually imported that frame (allocated by
              demand share), and the battery pool covers the remainder — so a session served
              battery-first with near-zero import shows as blue, and grid + battery add up to the
              dashed &ldquo;Served&rdquo; line (the metered power delivered to the car). The
              battery band is split between packs 1 and 2 by their actual per-frame SOC drops, so
              dual-mode (both packs feeding one car) shows up as a stacked blue band.
            </p>

            {hasSoc ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Car state of charge
                </span>
                <ChartContainer config={SOC_CONFIG} className="aspect-[16/4] w-full">
                  <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="clock" tickLine={false} axisLine={false} minTickGap={32} fontSize={11} />
                    <YAxis
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      fontSize={11}
                      unit="%"
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      type="monotone"
                      dataKey="carSoc"
                      name="Car SOC %"
                      stroke="var(--color-carSoc)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ChartContainer>
                <p className="text-xs text-muted-foreground text-pretty">
                  The vehicle&apos;s own reported SOC over the session. Charge speed tapers
                  as SOC rises — the car lowers its accepted power near the top of the curve.
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No per-frame supply data available for this session.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Stat({
  label,
  value,
  hint,
  swatch,
}: {
  label: string
  value: string
  hint?: string
  swatch?: string
}) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1.5">
        {swatch ? (
          <span
            className="size-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: swatch }}
            aria-hidden
          />
        ) : null}
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums">{value}</span>
        {hint ? <span className="text-xs text-muted-foreground tabular-nums">{hint}</span> : null}
      </div>
    </div>
  )
}
