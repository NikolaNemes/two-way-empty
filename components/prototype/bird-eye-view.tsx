"use client"

import { useEffect, useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  type TelemetryFrame,
  type PlugState,
  formatKW,
  formatCapKW,
} from "@/lib/prototype-telemetry"
import { InfoHint } from "@/components/prototype/info-hint"
import { EpexWidget } from "@/components/prototype/epex-widget"

interface Props {
  frame: TelemetryFrame
  /**
   * Compact mode trims the chrome (shorter header, smaller schematic, mobile
   * EPEX widget) so the schematic can sit inside a denser dashboard column —
   * e.g. the Dispatcher Status page — without dominating the layout.
   */
  compact?: boolean
}

type CarState = "absent" | "arriving" | "parked" | "departing"

/**
 * Smoothly tween a numeric value toward its target with rAF + ease-out cubic.
 * Live frames arrive every ~5 s (backend updates ~30 s), so raw values step
 * abruptly; tweening the DISPLAYED value over ~600 ms makes label changes,
 * SOC bars and flow speeds glide instead of snapping. Falls back to instant
 * updates when the user prefers reduced motion.
 */
function useTweenedNumber(target: number, durationMs = 600): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setValue(target)
      return
    }
    const from = fromRef.current
    if (from === target) return
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = from + (target - from) * eased
      setValue(next)
      fromRef.current = next
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, durationMs])

  return value
}

/**
 * Map |power| to a continuous animation period: idle flows crawl (1.8 s),
 * full-tilt 150 kW flows race (0.45 s). Replaces the old 2-tier hard
 * threshold, so crossing 50 kW no longer visibly "gear-shifts" the dashes.
 */
function flowPeriodSec(absPowerW: number): number {
  const kw = Math.min(150, Math.abs(absPowerW) / 1000)
  return 1.8 - (kw / 150) * 1.35
}

/**
 * Bird's-eye view of a ChargePost site:
 *   - 1 grid feeder at top (utility transformer)
 *   - 1 ChargePost cabinet (PCC + power electronics) in the centre
 *   - 2 battery cabinets flanking the post
 *   - 2 parking bays at the bottom, each with a connector pillar
 *
 * Cars animate in / out when plug_state transitions Plugged <-> Unplugged.
 * Power flow on each wire is visualised with an animated dashed stroke
 * whose speed scales with |kW|, and direction is encoded by the dash offset
 * sign. Implemented in a single SVG so coordinates and animations stay
 * in sync regardless of viewport width.
 */
export function BirdEyeView({ frame, compact = false }: Props) {
  // Defensive shape guard: every anchor below indexes batteries[0..1] and
  // chargers[0..1] directly. A truncated API payload (station in commissioning,
  // partial outage, schema drift) must degrade to a message — not a crash that
  // takes the whole monitoring page down with it.
  const shapeOk = frame.batteries.length >= 2 && frame.chargers.length >= 2

  // ---- Detect plug-state transitions for car animation ----
  const prevPlugRef = useRef<[PlugState, PlugState]>([
    frame.chargers[0]?.plug_state ?? "Unplugged",
    frame.chargers[1]?.plug_state ?? "Unplugged",
  ])
  const [carStates, setCarStates] = useState<[CarState, CarState]>([
    frame.chargers[0]?.plug_state === "Plugged" ? "parked" : "absent",
    frame.chargers[1]?.plug_state === "Plugged" ? "parked" : "absent",
  ])

  useEffect(() => {
    const prev = prevPlugRef.current
    const curr: [PlugState, PlugState] = [
      frame.chargers[0]?.plug_state ?? "Unplugged",
      frame.chargers[1]?.plug_state ?? "Unplugged",
    ]
    const next: [CarState, CarState] = [carStates[0], carStates[1]]
    let changed = false
    for (let i = 0; i < 2; i++) {
      if (prev[i] !== curr[i]) {
        changed = true
        if (curr[i] === "Plugged") next[i] = "arriving"
        else next[i] = "departing"
      }
    }
    if (changed) {
      setCarStates(next)
      // settle the transition state after the animation completes
      const timer = window.setTimeout(() => {
        setCarStates((s) => {
          const settled: [CarState, CarState] = [...s] as [CarState, CarState]
          for (let i = 0; i < 2; i++) {
            if (s[i] === "arriving") settled[i] = "parked"
            else if (s[i] === "departing") settled[i] = "absent"
          }
          return settled
        })
      }, 1100)
      prevPlugRef.current = curr
      return () => window.clearTimeout(timer)
    }
    prevPlugRef.current = curr
  }, [frame.chargers, carStates])

  // ---- Layout constants ----
  const W = 880
  const H = 520

  // Anchor coordinates
  const grid = { x: W / 2, y: 60 }
  const post = { x: W / 2, y: 200 }
  const batt1 = { x: 130, y: 200 }
  const batt2 = { x: 750, y: 200 }
  const conn1 = { x: 270, y: 380 }
  const conn2 = { x: 610, y: 380 }
  const bay1 = { x: 270, y: 460 }
  const bay2 = { x: 610, y: 460 }

  const P_grid_raw = frame.grid.P_grid_w
  const P_b1_raw = frame.batteries[0]?.power_w ?? 0
  const P_b2_raw = frame.batteries[1]?.power_w ?? 0
  const P_ev1_raw = frame.chargers[0]?.P_EV_w ?? 0
  const P_ev2_raw = frame.chargers[1]?.P_EV_w ?? 0

  // Tweened DISPLAY values — the schematic glides between polls instead of
  // snapping. All numeric truth (narrative, tooltips' derived aux, thresholds)
  // still uses the raw frame values so nothing physical is misstated.
  const P_grid = useTweenedNumber(P_grid_raw)
  const P_b1 = useTweenedNumber(P_b1_raw)
  const P_b2 = useTweenedNumber(P_b2_raw)
  const P_ev1 = useTweenedNumber(P_ev1_raw)
  const P_ev2 = useTweenedNumber(P_ev2_raw)

  // AUX (hotel load): the P_aux_w register is often UNPOPULATED (reads 0) even
  // though the site's always-on load is real — the same class of dead register
  // as ev_load_w. When that happens, derive aux from PCC power conservation:
  //   inflow (grid import + battery discharge) = EV + battery charge + export + aux
  // and label the figure as derived so nobody mistakes it for a metered value.
  const P_aux_reg = frame.grid.P_aux_w
  const P_bat_sum = P_b1_raw + P_b2_raw
  const residualAuxW = Math.max(
    0,
    Math.max(0, -P_grid_raw) + // grid import
      Math.max(0, -P_bat_sum) - // battery discharge
      (P_ev1_raw + P_ev2_raw) - // EV delivery
      Math.max(0, P_bat_sum) - // battery charge
      Math.max(0, P_grid_raw), // grid export
  )
  const auxIsDerived = P_aux_reg < 100 && residualAuxW > 500
  const P_aux = auxIsDerived ? residualAuxW : P_aux_reg

  // Speed pill — runs the simulation at N× wall-clock so SOC drift is
  // visible from a TV-room distance. Reads from the shared telemetry
  // context so reset / pause stay in sync across screens.

  // Surfaced low-SOC alerts so we can show a sticky red ribbon at the top
  // of the card. Floor (<= 15 %) is the "command-room TV" trigger.
  const lowBatteries = frame.batteries.filter((b) => b.soc_pct <= 15)
  const warnBatteries = frame.batteries.filter(
    (b) => b.soc_pct > 15 && b.soc_pct <= 25,
  )

  // Early return AFTER all hooks (React rules): incomplete payloads degrade
  // to an explanatory card instead of crashing on batteries[1]/chargers[1].
  if (!shapeOk) {
    return (
      <Card className="p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Bird&rsquo;s-eye view
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Telemetry payload is incomplete ({frame.batteries.length}/2 batteries,{" "}
          {frame.chargers.length}/2 chargers reported). The schematic needs both
          packs and both connectors — waiting for a full frame.
        </p>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      {lowBatteries.length > 0 ? (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center justify-between gap-3 bg-red-500/10 border-b border-red-500/40 px-4 py-2 text-xs"
        >
          <span className="inline-flex items-center gap-2 font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
            </span>
            SOC FLOOR REACHED
          </span>
          <span className="text-[11px] font-medium text-red-700 dark:text-red-300">
            {lowBatteries
              .map(
                (b) =>
                  `Battery ${b.unit_id} at ${b.soc_pct.toFixed(0)}% — discharge clamped`,
              )
              .join(" · ")}
          </span>
        </div>
      ) : warnBatteries.length > 0 ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 bg-amber-500/10 border-b border-amber-500/40 px-4 py-2 text-xs"
        >
          <span className="inline-flex items-center gap-2 font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            <span className="size-2 rounded-full bg-amber-500" />
            APPROACHING SOC FLOOR
          </span>
          <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
            {warnBatteries
              .map(
                (b) =>
                  `Battery ${b.unit_id} at ${b.soc_pct.toFixed(0)}% — plan recharge window`,
              )
              .join(" · ")}
          </span>
        </div>
      ) : null}
      <div
        className={cn(
          "flex flex-col gap-2 border-b px-4 text-xs md:flex-row md:items-start md:justify-between",
          compact ? "py-2" : "py-3",
        )}
      >
        <div className="space-y-1 max-w-2xl">
          <p className="font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
            Bird&rsquo;s-eye view
            <InfoHint side="bottom" align="start">
              <p className="font-medium mb-1">What you&rsquo;re looking at</p>
              <p>
                A top-down schematic of the physical ChargePost site. The
                utility transformer at the top, the central PCC cabinet, the
                two flanking battery packs, and the two parking bays at the
                bottom. Solid lines are static wiring; the dashed pulses on
                top show direction and magnitude of real-time power flow.
              </p>
              <p className="mt-2 text-[10px] font-mono text-muted-foreground border-t pt-2">
                API: GET /telemetry/latest<br />
                All power values from: grid.*, batteries[].*, chargers[].*
              </p>
            </InfoHint>
          </p>
          {!compact && (
            <p className="text-[11px] text-muted-foreground leading-snug normal-case tracking-normal text-pretty">
              Power flow is live: dash speed scales with kW, dash direction
              shows where energy is heading. Hover any element for detail.
            </p>
          )}
        </div>

        {/* Wire-color legend — decodes the flow tones at a glance */}
        {!compact && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] md:justify-end md:pt-0.5 shrink-0">
            <Legend tone="sky" label="Grid supply" />
            <Legend tone="emerald" label="Charging / export" />
            <Legend tone="amber" label="Discharging" />
            <Legend tone="primary" label="EV delivery" />
          </div>
        )}
      </div>

      <div className={cn("relative w-full", compact && "mx-auto max-w-md")}>
  {/* Live EPEX intraday widget — overlay in the upper-left corner */}
  {/* Compact version on mobile (and whenever the schematic itself is compact),
      full version on larger screens. */}
  {/* Full widget only at lg+ — below that it overlapped the Battery 1 node
      at mid-size viewports (~850 px), so the compact chip takes over. */}
  <div className={cn("pointer-events-none absolute left-1 top-1 z-10", !compact && "lg:hidden")}>
    <EpexWidget frame={frame} compact />
  </div>
  {!compact && (
    <div className="pointer-events-none absolute left-3 top-3 z-10 w-44 hidden lg:block">
      <EpexWidget frame={frame} />
    </div>
  )}

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto block bg-[radial-gradient(ellipse_at_center,_var(--muted)_0%,_var(--background)_70%)]"
          role="img"
          aria-label="Bird's eye view of ChargePost site"
        >
          {/* Background grid pattern (asphalt) */}
          <defs>
            <pattern
              id="asphalt"
              patternUnits="userSpaceOnUse"
              width="20"
              height="20"
            >
              <path
                d="M 20 0 L 0 0 0 20"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.04"
                strokeWidth="1"
                className="text-foreground"
              />
            </pattern>
            {/* Fixed small arrow markers - refX=10 so arrow tip is at line end */}
            <marker id="arrow-primary" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-primary" />
            </marker>
            <marker id="arrow-sky" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-sky-500" />
            </marker>
            <marker id="arrow-emerald" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-emerald-500" />
            </marker>
            <marker id="arrow-amber" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-amber-500" />
            </marker>
            {/* Soft glow for traveling energy dots */}
            <filter id="dot-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect width={W} height={H} fill="url(#asphalt)" />

          {/* --- WIRES (drawn before nodes so nodes overlap them cleanly) --- */}

          {/* Grid -> Post
              API convention: negative = import (grid supplying site), positive = export (site pushing to grid)
              We pass -P_grid so that positive means "flow from grid to post" for FlowWire's direction logic */}
          <FlowWire
            x1={grid.x}
            y1={grid.y + 32}
            x2={post.x}
            y2={post.y - 40}
            powerW={-P_grid}
            tone={P_grid < -50 ? "sky" : P_grid > 50 ? "emerald" : "muted"}
            label={`${formatKW(Math.abs(P_grid))}`}
            labelOffset={{ x: 18, y: -8 }}
            tipName="Grid \u2194 PCC feeder"
            tipExtra={`Direction: ${
              P_grid < -50 ? "import (utility \u2192 site)" : P_grid > 50 ? "export (site \u2192 utility)" : "near zero"
            }
Envelope use: ${
              P_grid < 0
                ? `${((Math.abs(P_grid) / frame.station.P_grid_consumption_limit_w) * 100).toFixed(0)}% of import cap`
                : `${((P_grid / frame.station.P_grid_generation_limit_w) * 100).toFixed(0)}% of export cap`
            }`}
          />

          {/* PCC <-> Battery 1.
              Wire geometry: x1=post, x2=batt -> default flow direction is post -> batt.
              Sign convention: P_b1 > 0 charging (post -> batt, NOT reversed),
              P_b1 < 0 discharging (batt -> post, reversed). Pass powerW unchanged. */}
          <FlowWire
            x1={post.x - 50}
            y1={post.y}
            x2={batt1.x + 50}
            y2={batt1.y}
            powerW={P_b1}
            tone={P_b1 > 50 ? "emerald" : P_b1 < -50 ? "amber" : "muted"}
            label={`${formatKW(Math.abs(P_b1))}`}
            labelOffset={{ x: 0, y: -10 }}
            tipName="PCC \u2194 Battery 1"
            tipExtra={`Direction: ${
              P_b1 > 50 ? "into battery (charging)" : P_b1 < -50 ? "out of battery (discharging)" : "idle"
            }
Throughput: ${formatKW(Math.abs(P_b1))} of ${(frame.batteries[0].max_charge_w / 1000).toFixed(0)} kW limit`}
          />

          {/* PCC <-> Battery 2 (same convention as Battery 1 above) */}
          <FlowWire
            x1={post.x + 50}
            y1={post.y}
            x2={batt2.x - 50}
            y2={batt2.y}
            powerW={P_b2}
            tone={P_b2 > 50 ? "emerald" : P_b2 < -50 ? "amber" : "muted"}
            label={`${formatKW(Math.abs(P_b2))}`}
            labelOffset={{ x: 0, y: -10 }}
            tipName="PCC \u2194 Battery 2"
            tipExtra={`Direction: ${
              P_b2 > 50 ? "into battery (charging)" : P_b2 < -50 ? "out of battery (discharging)" : "idle"
            }
Throughput: ${formatKW(Math.abs(P_b2))} of ${(frame.batteries[1].max_charge_w / 1000).toFixed(0)} kW limit`}
          />

          {/* Post -> Connector 1 */}
          <FlowWire
            x1={post.x - 30}
            y1={post.y + 30}
            x2={conn1.x}
            y2={conn1.y - 30}
            powerW={P_ev1}
            tone={P_ev1 > 50 ? "primary" : "muted"}
            label={P_ev1 > 50 ? `${formatKW(P_ev1)}` : ""}
            labelOffset={{ x: -34, y: 4 }}
            tipName="PCC \u2192 Connector 1"
            tipExtra={`Plug: ${frame.chargers[0].plug_state}
Delivery: ${formatKW(P_ev1)} of ${(frame.chargers[0].P_cp_max_w / 1000).toFixed(0)} kW limit`}
          />

          {/* Post -> Connector 2 */}
          <FlowWire
            x1={post.x + 30}
            y1={post.y + 30}
            x2={conn2.x}
            y2={conn2.y - 30}
            powerW={P_ev2}
            tone={P_ev2 > 50 ? "primary" : "muted"}
            label={P_ev2 > 50 ? `${formatKW(P_ev2)}` : ""}
            labelOffset={{ x: 34, y: 4 }}
            tipName="PCC \u2192 Connector 2"
            tipExtra={`Plug: ${frame.chargers[1].plug_state}
Delivery: ${formatKW(P_ev2)} of ${(frame.chargers[1].P_cp_max_w / 1000).toFixed(0)} kW limit`}
          />

          {/* --- NODES --- */}

          {/* Grid utility */}
          <g transform={`translate(${grid.x}, ${grid.y})`} className="cursor-help">
            <title>
              {`Grid utility (PCC interconnection)
P_grid: ${formatKW(P_grid, { signed: true })} (${
                P_grid < -50 ? "importing" : P_grid > 50 ? "exporting" : "near zero"
              })
Frequency: ${frame.grid.f_grid_hz.toFixed(2)} Hz
Power factor: ${frame.grid.cos_phi.toFixed(3)}
Envelope: import \u2264 ${formatCapKW(frame.station.P_grid_consumption_limit_w)} \u00b7 export \u2264 ${formatCapKW(frame.station.P_grid_generation_limit_w)}
Lifetime imp: ${frame.grid.E_grid_imp_kwh.toFixed(0)} kWh \u00b7 exp: ${frame.grid.E_grid_exp_kwh.toFixed(0)} kWh`}
            </title>
            {/* 200 px wide: the widest sub-label ("importing · 100% of 81 kW
                cap" ≈ 190 px at 10 px mono) must fit INSIDE the border. */}
            <rect
              x={-100}
              y={-32}
              width={200}
              height={64}
              rx={8}
              className="fill-sky-500/10 stroke-sky-500/40 bev-smooth"
              strokeWidth={1.5}
            />
            <text
              x={0}
              y={-14}
              textAnchor="middle"
              className="fill-sky-600 text-[11px] font-medium"
              style={{ fontSize: 11 }}
            >
              GRID UTILITY
            </text>
            {/* HERO: live power exchange — the number that actually drives
                dispatch. Frequency/cos φ are steady-state constants and live
                in the hover tooltip instead. */}
            <text
              x={0}
              y={8}
              textAnchor="middle"
              className={`font-mono font-semibold bev-smooth ${
                P_grid < -50 ? "fill-sky-600" : P_grid > 50 ? "fill-emerald-600" : "fill-muted-foreground"
              }`}
              style={{ fontSize: 15 }}
            >
              {P_grid < -50 ? "\u2193 " : P_grid > 50 ? "\u2191 " : ""}
              {formatKW(Math.abs(P_grid))}
            </text>
            <text
              x={0}
              y={24}
              textAnchor="middle"
              className="fill-muted-foreground font-mono"
              style={{ fontSize: 10 }}
            >
              {P_grid < -50
                ? `import · ${Math.min(100, Math.round((-P_grid / Math.max(1, frame.station.P_grid_consumption_limit_w)) * 100))}% of ${formatCapKW(frame.station.P_grid_consumption_limit_w)} cap`
                : P_grid > 50
                  ? `export · cap ${formatCapKW(frame.station.P_grid_generation_limit_w)}`
                  : `idle · cap ${formatCapKW(frame.station.P_grid_consumption_limit_w)}`}
            </text>
          </g>

          {/* ChargePost cabinet */}
          <g transform={`translate(${post.x}, ${post.y})`} className="cursor-help">
            <title>
              {`ChargePost cabinet (PCC + power electronics)
Operation state: ${frame.station.operation_state}
Aux load: ${formatKW(P_aux)}${auxIsDerived ? " (derived from power balance — register reads 0)" : ""} (always-on site loads)
Power balance @ PCC:
  P_grid       = ${formatKW(P_grid, { signed: true })}
  P_battery 1+2 = ${formatKW(P_b1 + P_b2, { signed: true })}
  P_EV 1+2     = ${formatKW(P_ev1 + P_ev2)}
  P_aux        = ${formatKW(P_aux)}${auxIsDerived ? " (derived)" : ""}
Sign convention: + = consumed by station / + = imported

\u2014 Site setup (master data) \u2014
Grid envelope: import \u2264 ${formatCapKW(frame.station.P_grid_consumption_limit_w)} \u00b7 export \u2264 ${formatCapKW(frame.station.P_grid_generation_limit_w)}
Storage: 2 packs \u00b7 ${((frame.batteries[0].max_charge_w + frame.batteries[1].max_charge_w) / 1000).toFixed(0)} kW charge / ${((frame.batteries[0].max_discharge_w + frame.batteries[1].max_discharge_w) / 1000).toFixed(0)} kW discharge combined${
                frame.batteries[0].E_full_kwh != null && frame.batteries[0].E_empty_kwh != null
                  ? `
Usable energy (now): \u2248 ${frame.batteries
                      .reduce((s, b) => s + (b.E_full_kwh ?? 0) + (b.E_empty_kwh ?? 0), 0)
                      .toFixed(0)} kWh across both packs`
                  : ""
              }
Connectors: 2 \u00d7 ${(frame.chargers[0].P_cp_max_w / 1000).toFixed(0)} kW hardware ceiling (boost via battery)
Boost principle: EV can draw more than the grid cap \u2014 batteries make up the difference`}
            </title>
            <rect
              x={-90}
              y={-40}
              width={180}
              height={80}
              rx={10}
              className="fill-card stroke-foreground/30"
              strokeWidth={1.5}
            />
            <rect
              x={-78}
              y={-30}
              width={156}
              height={10}
              rx={2}
              className="fill-foreground/10"
            />
            <text
              x={0}
              y={-2}
              textAnchor="middle"
              className="fill-foreground text-[11px] font-semibold"
              style={{ fontSize: 11 }}
            >
              CHARGEPOST · PCC
            </text>
            <text
              x={0}
              y={14}
              textAnchor="middle"
              className="fill-muted-foreground font-mono"
              style={{ fontSize: 10 }}
            >
              aux {formatKW(P_aux)}
              {auxIsDerived ? "*" : ""}
            </text>
            <foreignObject x={-50} y={20} width={100} height={20}>
              <div className="flex items-center justify-center">
                <Badge
                  variant="outline"
                  className={`text-[9px] h-4 px-1.5 ${
                    frame.station.operation_state === "Ready"
                      ? "border-emerald-500/40 text-emerald-600"
                      : "border-amber-500/40 text-amber-600"
                  }`}
                >
                  {frame.station.operation_state}
                </Badge>
              </div>
            </foreignObject>
          </g>

          {/* Battery 1 */}
          <BatteryNodeSVG
            x={batt1.x}
            y={batt1.y}
            id={1}
            unit={frame.batteries[0]}
          />

          {/* Battery 2 */}
          <BatteryNodeSVG
            x={batt2.x}
            y={batt2.y}
            id={2}
            unit={frame.batteries[1]}
          />

          {/* Parking bays + connectors */}
          <ParkingBay
            x={bay1.x}
            y={bay1.y}
            connX={conn1.x}
            connY={conn1.y}
            id={1}
            carState={carStates[0]}
            unit={frame.chargers[0]}
          />
          <ParkingBay
            x={bay2.x}
            y={bay2.y}
            connX={conn2.x}
            connY={conn2.y}
            id={2}
            carState={carStates[1]}
            unit={frame.chargers[1]}
          />
        </svg>

        {/* Local CSS for animations (scoped to this component via class names) */}
        <style>{`
          @keyframes flow-dash {
            from { stroke-dashoffset: 0; }
            to   { stroke-dashoffset: -28; }
          }
          @keyframes flow-dash-rev {
            from { stroke-dashoffset: 0; }
            to   { stroke-dashoffset: 28; }
          }
          /* Period is set per-wire via inline animation-duration so speed
             scales continuously with |kW|. */
          .flow-anim       { animation: flow-dash 1.2s linear infinite; }
          .flow-anim-rev   { animation: flow-dash-rev 1.2s linear infinite; }

          /* Smooth visual state changes: tone flips (sky->emerald etc),
             stroke-width breathing and SOC-bar width glide instead of snap. */
          .bev-smooth {
            transition:
              stroke 0.5s ease,
              fill 0.5s ease,
              stroke-width 0.5s ease,
              opacity 0.5s ease,
              width 0.6s ease;
          }

          @keyframes car-arrive {
            from { transform: translateY(80px); opacity: 0; }
            to   { transform: translateY(0); opacity: 1; }
          }
          @keyframes car-depart {
            from { transform: translateY(0); opacity: 1; }
            to   { transform: translateY(80px); opacity: 0; }
          }
          .car-arrive  { animation: car-arrive 1s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
          .car-depart  { animation: car-depart 1s cubic-bezier(0.55, 0, 0.68, 0.53) forwards; }

          @keyframes pulse-ring {
            0%   { r: 6; opacity: 0.7; }
            100% { r: 22; opacity: 0; }
          }
          .pulse-ring { animation: pulse-ring 1.6s ease-out infinite; }

          /* Accessibility: honor reduced-motion — freeze dashes, cars and
             pulses; direction stays readable from the static arrowheads. */
          @media (prefers-reduced-motion: reduce) {
            .flow-anim, .flow-anim-rev, .pulse-ring,
            .car-arrive, .car-depart { animation: none !important; }
            .car-arrive { opacity: 1; transform: none; }
            .car-depart { opacity: 0; }
            .bev-smooth { transition: none; }
          }
        `}</style>
      </div>

      <PowerFlowNarrative
        P_grid={P_grid_raw}
        P_b1={P_b1_raw}
        P_b2={P_b2_raw}
        P_ev1={P_ev1_raw}
        P_ev2={P_ev2_raw}
        P_aux={P_aux}
        gridImportLimit={frame.station.P_grid_consumption_limit_w}
        gridExportLimit={frame.station.P_grid_generation_limit_w}
      />
    </Card>
  )
}

// ---- Live narrative under the diagram --------------------------------------
//
// Goal: answer the question "where does the energy hitting the EV come from?"
// without needing to mentally trace arrows. Renders a single sentence describing
// the dominant flow this tick, plus a stacked bar showing source attribution
// when an EV is being delivered. Always honors conservation:
//
//     P_grid + P_battery_discharge = P_EV + P_aux + P_battery_charge
//
function PowerFlowNarrative({
  P_grid,
  P_b1,
  P_b2,
  P_ev1,
  P_ev2,
  P_aux,
  gridImportLimit,
  gridExportLimit,
}: {
  P_grid: number
  P_b1: number
  P_b2: number
  P_ev1: number
  P_ev2: number
  P_aux: number
  gridImportLimit: number
  gridExportLimit: number
}) {
  const P_ev = P_ev1 + P_ev2
  const P_bat = P_b1 + P_b2
  // Producer counting convention used throughout this codebase:
  //   P_grid  < 0  → import (utility → site)
  //   P_grid  > 0  → export (site → utility)
  //   P_bat   < 0  → battery discharging (energy leaving the cells)
  //   P_bat   > 0  → battery charging
  // Sources INTO the PCC bus (positive watts entering the bus)
  const fromGrid = Math.max(0, -P_grid)        // grid import
  const fromBatt = Math.max(0, -P_bat)         // battery discharge
  const totalIn = fromGrid + fromBatt
  // Sinks OUT of the PCC bus
  const toEv = P_ev
  const toAux = P_aux
  const toBatt = Math.max(0, P_bat)            // battery charge
  const exporting = Math.max(0, P_grid)        // grid export

  // Pick a primary scenario phrase
  let headline: React.ReactNode
  let sublabel: string

  if (P_ev > 50) {
    // EV is being delivered. Attribute its 145-ish kW between grid and battery.
    const total = totalIn || 1
    const gridShare = (fromGrid / total) * 100
    const battShare = (fromBatt / total) * 100
    const fromBattLabel =
      fromBatt > 50
        ? ` and ${formatKW(fromBatt)} from batteries discharging`
        : ""
    headline = (
      <>
        Delivering <strong className="text-primary">{formatKW(P_ev)}</strong>{" "}
        to the EV: <strong>{formatKW(fromGrid)}</strong> from the grid
        {fromBattLabel}.
      </>
    )
    sublabel = `Site aux ${formatKW(P_aux)} also drawn from the bus. Grid usage ${
      ((fromGrid / gridImportLimit) * 100).toFixed(0)
    }% of the ${formatCapKW(gridImportLimit)} import cap; batteries cover the rest so the cap is never breached.`
    return (
      <NarrativeBand
        headline={headline}
        sublabel={sublabel}
        sources={[
          { label: "Grid", kw: fromGrid, tone: "sky", pct: (fromGrid / total) * 100 },
          { label: "Batteries", kw: fromBatt, tone: "amber", pct: (fromBatt / total) * 100 },
        ]}
        sourceTotalKw={total}
        sinkLabel={`To EV ${formatKW(P_ev)} · aux ${formatKW(P_aux)}`}
      />
    )
  }

  if (toBatt > 50 && fromGrid > 50) {
    // Idle, batteries charging from grid (cheap-tariff window)
    headline = (
      <>
        No EV charging. Batteries absorbing{" "}
        <strong className="text-emerald-600">{formatKW(toBatt)}</strong> from
        the grid.
      </>
    )
    sublabel = `Grid import ${formatKW(fromGrid)} (${((fromGrid / gridImportLimit) * 100).toFixed(0)}% of cap) covers battery charge plus ${formatKW(P_aux)} of site aux. Typical off-peak tariff behavior.`
    return (
      <NarrativeBand
        headline={headline}
        sublabel={sublabel}
        sources={[{ label: "Grid", kw: fromGrid, tone: "sky", pct: 100 }]}
        sourceTotalKw={fromGrid}
        sinkLabel={`To batteries ${formatKW(toBatt)} · aux ${formatKW(P_aux)}`}
      />
    )
  }

  if (exporting > 50) {
    // Discharging out to the grid
    headline = (
      <>
        Exporting <strong className="text-emerald-600">{formatKW(exporting)}</strong>{" "}
        back to the grid from batteries.
      </>
    )
    sublabel = `Battery discharge ${formatKW(fromBatt)} feeds ${formatKW(P_aux)} of site aux and pushes ${formatKW(exporting)} upstream (${((exporting / gridExportLimit) * 100).toFixed(0)}% of export cap).`
    return (
      <NarrativeBand
        headline={headline}
        sublabel={sublabel}
        sources={[{ label: "Batteries", kw: fromBatt, tone: "amber", pct: 100 }]}
        sourceTotalKw={fromBatt}
        sinkLabel={`To grid ${formatKW(exporting)} · aux ${formatKW(P_aux)}`}
      />
    )
  }

  // Quiet site
  headline = (
    <>
      Site quiet. Grid covering{" "}
      <strong>{formatKW(P_aux)}</strong> of always-on aux load.
    </>
  )
  sublabel = `No EV active, batteries holding state of charge. Grid usage ${((fromGrid / gridImportLimit) * 100).toFixed(0)}% of cap.`
  return (
    <NarrativeBand
      headline={headline}
      sublabel={sublabel}
      sources={[{ label: "Grid", kw: fromGrid, tone: "sky", pct: 100 }]}
      sourceTotalKw={fromGrid}
      sinkLabel={`Aux ${formatKW(P_aux)}`}
    />
  )
}

function NarrativeBand({
  headline,
  sublabel,
  sources,
  sourceTotalKw,
  sinkLabel,
}: {
  headline: React.ReactNode
  sublabel: string
  sources: { label: string; kw: number; tone: "sky" | "amber" | "emerald"; pct: number }[]
  sourceTotalKw: number
  sinkLabel: string
}) {
  const toneBg: Record<string, string> = {
    sky: "bg-sky-500",
    amber: "bg-amber-500",
    emerald: "bg-emerald-500",
  }
  const toneText: Record<string, string> = {
    sky: "text-sky-700 dark:text-sky-400",
    amber: "text-amber-700 dark:text-amber-500",
    emerald: "text-emerald-700 dark:text-emerald-500",
  }
  const toneDot: Record<string, string> = {
    sky: "bg-sky-500",
    amber: "bg-amber-500",
    emerald: "bg-emerald-500",
  }

  return (
    <div className="border-t bg-muted/40 px-4 py-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Energy flow this tick
          </p>
          <p className="text-sm leading-snug text-foreground text-pretty">
            {headline}
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug mt-1 text-pretty">
            {sublabel}
          </p>
        </div>

        {sourceTotalKw > 50 ? (
          <div className="md:w-72 shrink-0">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              <span>Source mix</span>
              <span className="font-mono normal-case tracking-normal text-foreground">
                {formatKW(sourceTotalKw)}
              </span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              {sources.map((s) => (
                <div
                  key={s.label}
                  className={`${toneBg[s.tone]} transition-[width] duration-500`}
                  style={{ width: `${Math.max(0, Math.min(100, s.pct))}%` }}
                  title={`${s.label}: ${formatKW(s.kw)} (${s.pct.toFixed(0)}%)`}
                />
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              {sources
                .filter((s) => s.kw > 50)
                .map((s) => (
                  <span key={s.label} className="inline-flex items-center gap-1.5">
                    <span className={`inline-block size-1.5 rounded-full ${toneDot[s.tone]}`} />
                    <span className={`font-medium ${toneText[s.tone]}`}>
                      {s.label}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {formatKW(s.kw)}
                    </span>
                  </span>
                ))}
              <span className="ml-auto text-[11px] text-muted-foreground">
                → {sinkLabel}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// -------------------- SVG sub-components --------------------

type Tone = "sky" | "emerald" | "amber" | "primary" | "muted"

const wireStrokeClass: Record<Tone, string> = {
  sky: "stroke-sky-500",
  emerald: "stroke-emerald-500",
  amber: "stroke-amber-500",
  primary: "stroke-primary",
  muted: "stroke-muted-foreground/30",
}

// Returns marker ID based on tone (fixed size arrows)
function getWireMarkerId(tone: Tone): string {
  if (tone === "muted") return ""
  return `url(#arrow-${tone})`
}

// Tone -> fill class for the traveling glow dots. Kept in lockstep with
// wireStrokeClass so the dot inherits exactly the same hue as its wire.
const dotFillClass: Record<Tone, string> = {
  sky: "fill-sky-500",
  emerald: "fill-emerald-500",
  amber: "fill-amber-500",
  primary: "fill-primary",
  muted: "fill-muted-foreground/40",
}

function FlowWire({
  x1,
  y1,
  x2,
  y2,
  powerW,
  tone,
  label,
  labelOffset,
  tipName,
  tipExtra,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  powerW: number
  tone: Tone
  label: string
  labelOffset: { x: number; y: number }
  tipName?: string
  tipExtra?: string
}) {
  const absPower = Math.abs(powerW)
  const isActive = absPower > 50
  const reversed = powerW < 0

  // Stroke width breathes with load: 2 px near idle up to 4 px at 150 kW —
  // a second magnitude cue alongside speed, readable at TV distance.
  const strokeWidth = isActive ? 2 + Math.min(2, absPower / 75_000) : 2
  const baseStrokeWidth = 4

  // Dot size also scales slightly with power
  const dotRadius = isActive ? 2.5 + Math.min(1.5, absPower / 100_000) : 3
  const dotRadius2 = dotRadius * 0.66

  // CONTINUOUS animation period from |kW| (no hard gear-shift thresholds).
  const animDuration = flowPeriodSec(absPower)

  // Visible flow line: ALWAYS goes from energy source to energy sink so the
  // arrow head (markerEnd) lands on the sink. When powerW is negative the
  // caller's logical x1->x2 direction is the wrong way, so we swap endpoints
  // for the flow line itself. The base/hit lines are visually symmetric so
  // they don't need to swap.
  const sx = reversed ? x2 : x1
  const sy = reversed ? y2 : y1
  const tx = reversed ? x1 : x2
  const ty = reversed ? y1 : y2

  // Animated dashed overlay (only when active). With endpoints already
  // oriented source -> sink, the forward animation is always correct.
  const cls = wireStrokeClass[isActive ? tone : "muted"]
  // Single animation class; the period is set inline so speed scales
  // continuously with power instead of jumping between two fixed tiers.
  const animClass = isActive ? "flow-anim" : ""

  const midX = (x1 + x2) / 2 + labelOffset.x
  const midY = (y1 + y2) / 2 + labelOffset.y

  return (
    <g className={tipName ? "cursor-help" : undefined}>
      {tipName ? (
        <title>
          {`${tipName}
Power: ${formatKW(Math.abs(powerW))}${tipExtra ? `\n${tipExtra}` : ""}`}
        </title>
      ) : null}
      {/* invisible thicker hit-area so the tooltip is easy to grab */}
      {tipName ? (
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="transparent"
          strokeWidth={16}
          strokeLinecap="round"
        />
      ) : null}
      {/* base */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        className="stroke-foreground/15"
        strokeWidth={baseStrokeWidth}
        strokeLinecap="round"
      />
  {/* flow (oriented source -> sink so markerEnd lands on the sink) */}
  <line
  x1={sx}
  y1={sy}
  x2={tx}
  y2={ty}
  className={`${cls} ${animClass} bev-smooth`}
  strokeWidth={strokeWidth}
  strokeLinecap="round"
  strokeDasharray={isActive ? "8 4" : "0"}
  markerEnd={isActive ? getWireMarkerId(tone) : undefined}
  style={isActive ? { animationDuration: `${animDuration}s` } : undefined}
  />
  {/* Traveling glow dot -- the strongest "energy direction" cue at a glance.
      Two staggered dots ride from source to sink; faster and larger on high-power flows. */}
  {isActive ? (
    <>
      <circle
        r={dotRadius}
        className={dotFillClass[tone]}
        filter="url(#dot-glow)"
      >
        <animate
          attributeName="cx"
          from={sx}
          to={tx}
          dur={`${animDuration}s`}
          repeatCount="indefinite"
        />
        <animate
          attributeName="cy"
          from={sy}
          to={ty}
          dur={`${animDuration}s`}
          repeatCount="indefinite"
        />
      </circle>
      <circle
        r={dotRadius2}
        className={dotFillClass[tone]}
        opacity={0.7}
        filter="url(#dot-glow)"
      >
        <animate
          attributeName="cx"
          from={sx}
          to={tx}
          dur={`${animDuration}s`}
          begin={`${animDuration / 2}s`}
          repeatCount="indefinite"
        />
        <animate
          attributeName="cy"
          from={sy}
          to={ty}
          dur={`${animDuration}s`}
          begin={`${animDuration / 2}s`}
          repeatCount="indefinite"
        />
      </circle>
    </>
  ) : null}
      {label ? (
        <g>
          <rect
            x={midX - Math.max(44, label.length * 6.2 + 12) / 2}
            y={midY - 9}
            width={Math.max(44, label.length * 6.2 + 12)}
            height={16}
            rx={4}
            className="fill-background stroke-border"
            strokeWidth={1}
          />
          <text
            x={midX}
            y={midY + 3}
            textAnchor="middle"
            className="fill-foreground font-mono"
            style={{ fontSize: 10 }}
          >
            {label}
          </text>
        </g>
      ) : null}
    </g>
  )
}

function BatteryNodeSVG({
  x,
  y,
  id,
  unit,
}: {
  x: number
  y: number
  id: 1 | 2
  unit: import("@/lib/prototype-telemetry").BatteryUnit
}) {
  const soc = unit.soc_pct
  const power_w = unit.power_w
  // Defensive sanitisation: clamp temps into a physically plausible
  // range so a transient numerical issue upstream (NaN, Infinity, an
  // unstable integration step at very large dt) can never bleed into
  // the UI as `7.5e29 °C` text. -40..120 °C covers every realistic
  // BMS reading; everything outside that is treated as a missing
  // sample and rendered as the seed-temperature fallback (27 °C).
  const safeTemp = (t: number) =>
    Number.isFinite(t) && t > -40 && t < 120 ? t : 27
  const tempMin = safeTemp(unit.temp_min_c)
  const tempMax = safeTemp(unit.temp_max_c)
  const charging = power_w > 50
  const discharging = power_w < -50

  // Alert thresholds — meant to be glanceable on a command-room TV.
  //   floor: at 15 % the dispatcher will clamp discharge to zero
  //   warn:  at 25 % the optimiser plans the next charge window
  const socFloor = soc <= 15
  const socWarn = !socFloor && soc <= 25

  // Alert tone wins over normal tone when active.
  const tone: Tone = socFloor
    ? "amber" // discharge clamped -> visually amber (idle)
    : charging
    ? "emerald"
    : discharging
    ? "amber"
    : "muted"

  const cabinetCls = socFloor
    ? "fill-red-500/15 stroke-red-500"
    : socWarn
    ? "fill-amber-500/10 stroke-amber-500/70"
    : tone === "emerald"
    ? "fill-emerald-500/10 stroke-emerald-500/40"
    : tone === "amber"
    ? "fill-amber-500/10 stroke-amber-500/40"
    : "fill-card stroke-foreground/25"

  const stateLabel = charging ? "charging" : discharging ? "discharging" : "idle"
  const limit = power_w >= 0 ? unit.max_charge_w : unit.max_discharge_w
  const utilisationPct = (Math.abs(power_w) / limit) * 100

  return (
    <g transform={`translate(${x}, ${y})`} className="cursor-help">
      <title>
        {`Battery unit ${id}
State: ${stateLabel}
Power: ${formatKW(power_w, { signed: true })} (${utilisationPct.toFixed(0)}% of ${
          (limit / 1000).toFixed(0)
        } kW limit)
SOC: ${soc.toFixed(1)}%
Temperature: ${tempMin.toFixed(1)} \u2013 ${tempMax.toFixed(1)} \u00b0C (\u0394 ${(tempMax - tempMin).toFixed(1)})

\u2014 Pack specs \u2014
Power rating: charge ${(unit.max_charge_w / 1000).toFixed(0)} kW \u00b7 discharge ${(unit.max_discharge_w / 1000).toFixed(0)} kW${
          unit.E_full_kwh != null && unit.E_empty_kwh != null
            ? `
Usable capacity (now): \u2248 ${(unit.E_full_kwh + unit.E_empty_kwh).toFixed(0)} kWh (derated by temp/SoH)
  room to full: ${unit.E_full_kwh.toFixed(0)} kWh \u00b7 available to empty: ${unit.E_empty_kwh.toFixed(0)} kWh`
            : ""
        }
SOH: ${unit.soh_pct.toFixed(1)}% \u00b7 Contactor: ${unit.contactor_state}
Lifetime throughput: ${unit.E_charged_kwh.toFixed(0)} kWh charged \u00b7 ${unit.E_discharged_kwh.toFixed(0)} kWh discharged`}
      </title>
      {/* Pulsing alert halo behind the cabinet for low-SOC states.
          Floor: red, hard pulse. Warn: amber, gentler pulse. */}
      {(socFloor || socWarn) ? (
        <rect
          x={-66}
          y={-50}
          width={132}
          height={100}
          rx={9}
          className={
            socFloor
              ? "fill-none stroke-red-500"
              : "fill-none stroke-amber-500"
          }
          strokeWidth={2}
          opacity={0.9}
        >
          <animate
            attributeName="opacity"
            values={socFloor ? "0.35;1;0.35" : "0.25;0.7;0.25"}
            dur={socFloor ? "0.9s" : "1.6s"}
            repeatCount="indefinite"
          />
          <animate
            attributeName="stroke-width"
            values={socFloor ? "2;5;2" : "1.5;3;1.5"}
            dur={socFloor ? "0.9s" : "1.6s"}
            repeatCount="indefinite"
          />
        </rect>
      ) : null}
      <rect
        x={-60}
        y={-44}
        width={120}
        height={88}
        rx={6}
        className={`${cabinetCls} bev-smooth`}
        strokeWidth={1.5}
      />
      {/* "Cabinet door" detail */}
      <rect
        x={-52}
        y={-36}
        width={104}
        height={6}
        rx={2}
        className="fill-foreground/10"
      />
      <text
        x={0}
        y={-18}
        textAnchor="middle"
        className="fill-foreground text-[10px] font-semibold"
        style={{ fontSize: 10 }}
      >
        BATTERY {id}
      </text>
      {/* SOC bar */}
      <rect
        x={-44}
        y={-8}
        width={88}
        height={8}
        rx={2}
        className="fill-muted stroke-border"
        strokeWidth={1}
      />
      <rect
        x={-44}
        y={-8}
        width={Math.max(2, (88 * Math.min(100, Math.max(0, soc))) / 100)}
        height={8}
        rx={2}
        className={`bev-smooth ${
          socFloor
            ? "fill-red-500"
            : socWarn
            ? "fill-amber-500"
            : tone === "emerald"
            ? "fill-emerald-500"
            : tone === "amber"
            ? "fill-amber-500"
            : "fill-muted-foreground/60"
        }`}
      >
        {(socFloor || socWarn) ? (
          <animate
            attributeName="opacity"
            values={socFloor ? "0.55;1;0.55" : "0.7;1;0.7"}
            dur={socFloor ? "0.7s" : "1.4s"}
            repeatCount="indefinite"
          />
        ) : null}
      </rect>
      <text
        x={0}
        y={14}
        textAnchor="middle"
        className="fill-foreground font-mono"
        style={{ fontSize: 11 }}
      >
        {soc.toFixed(0)}% · {formatKW(power_w, { signed: true })}
      </text>
      <text
        x={0}
        y={28}
        textAnchor="middle"
        className="fill-muted-foreground font-mono"
        style={{ fontSize: 9 }}
      >
        {tempMin.toFixed(0)}–{tempMax.toFixed(0)} °C
      </text>

      {/* Low-SOC pill on top edge — visible at TV-room distance */}
      {(socFloor || socWarn) ? (
        <g transform="translate(0, -56)">
          <rect
            x={-32}
            y={-9}
            width={64}
            height={16}
            rx={8}
            className={
              socFloor
                ? "fill-red-500 stroke-red-700"
                : "fill-amber-500 stroke-amber-700"
            }
            strokeWidth={0.5}
          />
          <text
            x={0}
            y={3}
            textAnchor="middle"
            className="fill-white font-semibold"
            style={{ fontSize: 10, letterSpacing: 0.5 }}
          >
            {socFloor ? "SOC FLOOR" : "LOW SOC"}
          </text>
        </g>
      ) : null}
    </g>
  )
}

function ParkingBay({
  x,
  y,
  connX,
  connY,
  id,
  carState,
  unit,
}: {
  x: number
  y: number
  connX: number
  connY: number
  id: 1 | 2
  carState: CarState
  unit: import("@/lib/prototype-telemetry").ChargerUnit
}) {
  const P_ev_w = unit.P_EV_w
  const socEv = unit.soc_EV_pct
  // Charging is true if we have power OR if charging_state indicates active charging
  const charging = P_ev_w > 50 || unit.charging_state === "InProgress"
  const carVisible = carState !== "absent"
  const carClass =
    carState === "arriving"
      ? "car-arrive"
      : carState === "departing"
      ? "car-depart"
      : ""

  return (
    <g>
      {/* Connector pillar */}
      <g transform={`translate(${connX}, ${connY})`} className="cursor-help">
        <title>
          {`Connector pillar C${id}
Plug state: ${unit.plug_state}
Charging state: ${unit.charging_state}
Process: ${unit.charging_process_state}
Delivering: ${formatKW(P_ev_w)} (P_EV)
Limits: P_EV_max ${(unit.P_EV_max_w / 1000).toFixed(0)} kW \u00b7 P_cp_max ${(unit.P_cp_max_w / 1000).toFixed(0)} kW
Boost contactor: ${unit.boost_contactor}
Session energy: ${unit.E_EV_chg_kwh.toFixed(2)} kWh`}
        </title>
        <rect
          x={-22}
          y={-26}
          width={44}
          height={52}
          rx={5}
          className={`bev-smooth ${
            charging
              ? "fill-primary/15 stroke-primary/50"
              : carState === "parked" || carState === "arriving"
              ? "fill-card stroke-foreground/40"
              : "fill-card stroke-foreground/25"
          }`}
          strokeWidth={1.5}
        />
        <text
          x={0}
          y={-10}
          textAnchor="middle"
          className="fill-foreground text-[9px] font-semibold"
          style={{ fontSize: 9 }}
        >
          C{id}
        </text>
        <text
          x={0}
          y={4}
          textAnchor="middle"
          className="fill-foreground font-mono"
          style={{ fontSize: 11 }}
        >
          {charging ? (P_ev_w > 50 ? `${(P_ev_w / 1000).toFixed(0)}` : "...") : "—"}
        </text>
        <text
          x={0}
          y={16}
          textAnchor="middle"
          className="fill-muted-foreground font-mono"
          style={{ fontSize: 7 }}
        >
          {charging ? (P_ev_w > 50 ? "kW" : "") : ""}
        </text>
        {/* charging pulse ring */}
        {charging && (
          <circle
            cx={0}
            cy={-26}
            r={6}
            className="fill-none stroke-primary pulse-ring"
            strokeWidth={2}
          />
        )}
      </g>

      {/* Parking bay outline */}
      <g transform={`translate(${x}, ${y})`}>
        {/* bay rectangle */}
        <rect
          x={-50}
          y={-30}
          width={100}
          height={60}
          rx={4}
          className="fill-transparent stroke-foreground/30"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        {/* curb stop */}
        <line
          x1={-30}
          y1={-22}
          x2={30}
          y2={-22}
          className="stroke-foreground/30"
          strokeWidth={2}
          strokeLinecap="round"
        />

        {/* Cable from connector to car (only when parked/arriving) */}
        {carVisible && (
          <path
            d={`M ${connX - x} ${connY - y + 22} Q ${connX - x} ${
              connY - y + 28
            }, ${0} ${-12} T ${0} 0`}
            className={
              charging
                ? "stroke-primary/70 fill-none"
                : "stroke-foreground/40 fill-none"
            }
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}

        {/* Car (top-down) */}
        {carVisible && (
          <g className={`${carClass} cursor-help`}>
            <title>
              {`Vehicle in bay ${id}
Plug state: ${unit.plug_state}
Status: ${charging ? "charging" : carState === "arriving" ? "arriving" : carState === "departing" ? "departing" : "parked, idle"}
EV SOC: ${socEv.toFixed(1)}%
Receiving: ${charging ? formatKW(P_ev_w) : "0 kW"}
Session energy received: ${unit.E_EV_chg_kwh.toFixed(2)} kWh`}
            </title>
            <Car charging={charging} socEv={socEv} />
          </g>
        )}
      </g>
    </g>
  )
}

function Car({ charging, socEv }: { charging: boolean; socEv: number }) {
  // Top-down silhouette: rounded rectangle body + small windshield
  return (
    <g>
      {/* shadow */}
      <ellipse
        cx={2}
        cy={6}
        rx={32}
        ry={6}
        className="fill-black/20"
      />
      {/* body */}
      <rect
        x={-30}
        y={-14}
        width={60}
        height={28}
        rx={9}
        className={
          charging
            ? "fill-primary stroke-primary/70"
            : "fill-foreground/80 stroke-foreground/40"
        }
        strokeWidth={1}
      />
      {/* windscreen / roof */}
      <rect
        x={-14}
        y={-9}
        width={26}
        height={18}
        rx={4}
        className="fill-foreground/20 stroke-foreground/30"
        strokeWidth={0.5}
      />
      {/* headlights (front = left) */}
      <rect x={-31} y={-10} width={3} height={4} rx={1} className="fill-amber-200" />
      <rect x={-31} y={6} width={3} height={4} rx={1} className="fill-amber-200" />

      {/* SOC strip */}
      {charging && (
        <g transform="translate(0, 22)">
          <rect
            x={-22}
            y={-4}
            width={44}
            height={6}
            rx={1.5}
            className="fill-card stroke-border"
            strokeWidth={0.5}
          />
          <rect
            x={-22}
            y={-4}
            width={Math.max(1, (44 * Math.min(100, Math.max(0, socEv))) / 100)}
            height={6}
            rx={1.5}
            className="fill-emerald-500"
          />
          <text
            x={0}
            y={11}
            textAnchor="middle"
            className="fill-muted-foreground font-mono"
            style={{ fontSize: 8 }}
          >
            EV {socEv.toFixed(0)}%
          </text>
        </g>
      )}
    </g>
  )
}

function Legend({ tone, label }: { tone: Tone; label: string }) {
  const dotCls =
    tone === "sky"
      ? "bg-sky-500"
      : tone === "emerald"
      ? "bg-emerald-500"
      : tone === "amber"
      ? "bg-amber-500"
      : tone === "primary"
      ? "bg-primary"
      : "bg-muted-foreground"
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={`inline-block size-2 rounded-full ${dotCls}`} />
      {label}
    </span>
  )
}
