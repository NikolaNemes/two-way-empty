"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import Link from "next/link"
import {
  Gauge,
  Battery,
  BatteryCharging,
  Car,
  Moon,
  Zap,
  Ban,
  TrendingUp,
  ArrowRightLeft,
  ShieldAlert,
  CircleDollarSign,
  Clock,
  Sparkles,
  Cable,
  Layers,
  ArrowRight,
  Settings2,
} from "lucide-react"

export function ChargePostControlExplainedScreen() {
  return (
    <div className="w-full py-8 px-6 overflow-hidden">
      {/* ---------- Hero ---------- */}
      <div className="space-y-3 mb-8">
        <div className="flex items-center gap-3">
          <Gauge className="size-8 text-primary shrink-0" />
          <h1 className="text-3xl font-bold tracking-tight">
            ChargePost Control Explained
          </h1>
        </div>
        <p className="text-muted-foreground text-lg max-w-4xl text-pretty">
          How arbitrage actually happens on a ChargePost site &mdash; told through
          the handful of levers the{" "}
          <Link href="/dispatching-api" className="underline text-foreground hover:text-primary">
            v1 Dispatching API
          </Link>{" "}
          already puts at Enexa&apos;s disposal.
        </p>
        <div className="max-w-6xl grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
            <div className="flex items-start gap-2">
              <ShieldAlert className="size-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-foreground mb-1">
                  Rule 1 &mdash; EV demand is must-serve
                </div>
                <p className="text-muted-foreground text-pretty">
                  Whenever a car is plugged in, the site delivers the power the
                  car asks for, up to the unit&apos;s commissioning rating.
                  Arbitrage is <strong>never</strong> achieved by throttling the
                  vehicle. Every lever below works on the{" "}
                  <em>battery and grid</em> side &mdash; on <em>where</em> the
                  EV&apos;s energy comes from, not on how much it is allowed to
                  draw.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <div className="flex items-start gap-2">
              <Ban className="size-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-foreground mb-1">
                  Rule 2 &mdash; Pilot scope: no grid export
                </div>
                <p className="text-muted-foreground text-pretty">
                  In the pilot there is no commercial contract and no settlement
                  route to sell energy back to the grid. Battery discharge is{" "}
                  <strong>only</strong> used to displace expensive grid{" "}
                  <em>imports</em> for plugged-in EVs. The{" "}
                  <code>P_grid_w</code> setpoint is constrained to{" "}
                  <strong>non-negative</strong> values; Middleware clamps any
                  negative dispatch to zero before it reaches Modbus.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-muted-foreground/30 bg-muted/40 p-4 text-sm">
            <div className="flex items-start gap-2">
              <Ban className="size-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-foreground mb-1">
                  Rule 3 &mdash; Pilot scope: no on-site PV
                </div>
                <p className="text-muted-foreground text-pretty">
                  The pilot site has no solar generation. The ChargePost unit
                  exposes a PV register, but it is hard-wired to zero. That
                  leaves just <strong>two places</strong> a watt can come from
                  at the unit &mdash; the grid or the battery &mdash; so every
                  &ldquo;cheap electrons&rdquo; scenario on this page means{" "}
                  <strong>cheap grid</strong>, not free sun.
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <Badge variant="outline" className="border-primary/40 text-primary bg-primary/5 font-normal">
            <Cable className="size-3 mr-1" />
            Narrative &mdash; v1 levers only
          </Badge>
          <Badge variant="outline" className="border-green-600/40 text-green-700 bg-green-500/5 font-normal">
            In pilot scope
          </Badge>
        </div>
      </div>

      {/* ---------- What arbitrage means here ---------- */}
      <Card className="mb-6 border-primary/30 bg-primary/5 overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CircleDollarSign className="size-5 text-primary" />
            What &ldquo;arbitrage&rdquo; means on a ChargePost site
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">API field</TableHead>
                  <TableHead className="w-[70px]">Scope</TableHead>
                  <TableHead className="w-[160px]">Modbus</TableHead>
                  <TableHead>Meaning &amp; pilot usage</TableHead>
                </TableRow>
              </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-mono text-xs">
                  station.operation_mode
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">Site</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="text-xs">
                    station.mgmt.op_mode
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  The master switch. <code>1 = On (Enexa controls)</code> hands
                  the site over to dispatch. <code>0 = Off</code> returns it to
                  local reactive control. Every arbitrage strategy starts here.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono text-xs">
                  station.grid_mgmt_mode
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">Site</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="text-xs">
                    station.mgmt.grid_mode
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  Chooses <em>who</em> steers grid flow.{" "}
                  <code>0 = Automatic</code> lets the unit self-balance under
                  a global clearance.
                  <code> 1 = Manual</code> means Enexa writes a{" "}
                  <code>P_grid_w</code> target per unit. Arbitrage uses{" "}
                  <strong>Manual</strong>; resilience fallbacks use{" "}
                  <strong>Automatic</strong>.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono text-xs">
                  station.P_grid_clearance_w
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">Site</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="text-xs">
                    station.mgmt.P_grid_clearance
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  The grid-import ceiling for the whole site. The single
                  load-management lever &mdash; nothing on the site may cause
                  net import above it. Used to throttle aggressive battery
                  charging when the grid connection can&apos;t take it, and
                  (set to 0) to block import entirely during a peak.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono text-xs">
                  chargers[].P_grid_w
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">Per unit</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="text-xs">P_grid (12005/22005)</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  The arbitrage lever. Per-unit meter target in watts.{" "}
                  <strong>Positive = import from grid</strong>. In the pilot,
                  negative values (export to grid) are blocked &mdash;
                  Middleware clamps any <code>P_grid_w &lt; 0</code> to zero.
                  Because of the power balance, setting the meter target also
                  implicitly decides whether the battery charges or holds;
                  pure-export discharges are out of pilot scope.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono text-xs">
                  chargers[].P_cp_lim_w
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">Per unit</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="text-xs">P_cp_lim (12001/22001)</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <strong>Not an arbitrage lever.</strong> Commissioning-rated
                  hardware ceiling for what the plug and the unit can physically
                  deliver (typical 150 kW single / 300 kW dual). Left at its
                  factory-rated value in normal operation so the EV always gets what
                  it asks for. Only changed for genuine hardware / safety
                  reasons &mdash; never to shift cost.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono text-xs">
                  chargers[].soc_cp_max_pct
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">Per unit</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="text-xs">soc_cp_max (12009/22009)</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  Battery SOC ceiling. Set high (90%) during cheap hours to
                  store as much as possible; lower during volatile periods
                  so you leave room to absorb another cheap block later.
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono text-xs">
                  chargers[].soc_cp_min_pct
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">Per unit</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="text-xs">soc_cp_min (12010/22010)</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  Battery SOC floor &mdash; the hardware-enforced reserve.
                  Protects a slice of stored energy for the next forecast
                  peak (or for backup), so aggressive discharge now
                  can&apos;t starve the more valuable discharge later.
                </TableCell>
              </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/30 border">
            Two more fields appear on the dispatch without being arbitrage
            levers: <code>charging_mode</code> selects the unit topology (Off /
            Single 150 kW / Dual-coupled 300 kW / Disabled), and{" "}
            <code>metadata.price_trajectory[]</code> stamps the price curve
            Enexa saw for post-hoc attribution. Neither affects the
            battery/grid/EV split at the unit.
          </p>
        </CardContent>
      </Card>

      <Separator className="my-8" />

      {/* ---------- Two operating modes ---------- */}
      <div className="mb-4">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ArrowRightLeft className="size-6 text-primary" />
          Two situations &mdash; how dispatch handles each
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-4xl text-pretty">
          At any given moment the site is in one of two simple situations:{" "}
          <strong>a car is plugged in, or it isn&apos;t</strong>. Enexa
          doesn&apos;t choose which &mdash; the driver does. But the same
          dispatch command means something different in each case, so before
          picking values Enexa needs to know which situation it&apos;s in. The
          current state arrives via telemetry (Middleware publishes the plug
          status every second).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* ---- Idle mode ---- */}
        <Card className="border-l-4 border-l-chart-1">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-chart-1/10">
                <Battery className="size-5 text-chart-1" />
              </div>
              <div>
                <CardTitle className="text-lg">No car plugged in</CardTitle>
                <CardDescription>
                  The simple case. Car draw is zero, so whatever we pull from
                  the grid goes straight into the battery.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                The power balance simplifies
              </div>
              <div className="rounded-lg border bg-muted/50 p-3 font-mono text-center">
                Battery output = &minus;&thinsp;Grid import
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 text-pretty">
                With no car to feed, anything we import has nowhere else to
                go &mdash; it goes into the battery. The meter target{" "}
                <em>is</em> the battery charging rate, just written the
                opposite way around.
              </p>
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                What Enexa actually decides
              </div>
              <p className="text-muted-foreground text-pretty">
                Just one number: <code>P_grid_w</code>. Whatever value is
                sent is exactly what flows into the battery.
              </p>
              <ul className="mt-2 space-y-1.5 text-xs">
                <li className="flex items-start gap-2">
                  <ArrowRight className="size-3.5 text-primary mt-0.5 shrink-0" />
                  <span>
                    <code>P_grid_w &gt; 0</code> &rarr; battery charges at
                    that rate
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight className="size-3.5 text-primary mt-0.5 shrink-0" />
                  <span>
                    <code>P_grid_w = 0</code> &rarr; battery holds SOC
                  </span>
                </li>
                <li className="flex items-start gap-2 opacity-50">
                  <Ban className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">
                    <code>P_grid_w &lt; 0</code> &rarr; export discharge{" "}
                    <span className="text-[11px]">
                      (blocked &mdash; Rule 2)
                    </span>
                  </span>
                </li>
              </ul>
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                When to charge, when to wait
              </div>
              <p className="text-muted-foreground text-pretty">
                Charge when the grid is cheap <em>enough</em> that the stored
                kWh will still be worth more at the forecast peak after
                round-trip losses &mdash; and SOC is below the ceiling.
                Otherwise just wait.
              </p>
            </div>
            <div className="rounded-lg bg-muted/30 border p-2.5 text-xs">
              <span className="font-semibold text-foreground">
                See in action:
              </span>{" "}
              <span className="text-muted-foreground">
                Move 1 (charging from cheap grid) and Move 3 (sitting tight
                at an expensive peak, because there&apos;s no export route).
              </span>
            </div>
          </CardContent>
        </Card>

        {/* ---- Plugged mode ---- */}
        <Card className="border-l-4 border-l-chart-2">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-chart-2/10">
                <Car className="size-5 text-chart-2" />
              </div>
              <div>
                <CardTitle className="text-lg">Car is plugged in</CardTitle>
                <CardDescription>
                  The car asks for some amount of power. Enexa doesn&apos;t
                  get to change that &mdash; it only decides how much comes
                  from the grid, and the battery covers the rest.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                The power balance
              </div>
              <div className="rounded-lg border bg-muted/50 p-3 font-mono text-center text-xs">
                Battery output = Car draw &minus; Grid import
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 text-pretty">
                The car&apos;s draw is whatever the car asks for (up to the
                hardware rating <code>P_cp_lim_w</code>). Dispatch can
                <em> see</em> it in telemetry but cannot{" "}
                <strong>change</strong> it &mdash; that&apos;s Rule 1.
              </p>
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                What Enexa actually decides
              </div>
              <p className="text-muted-foreground text-pretty">
                How much of the car&apos;s draw comes from the grid, and how
                much from the battery. Set the meter target{" "}
                <code>P_grid_w</code> anywhere between <code>0</code> and the
                car&apos;s draw, and the battery fills the remainder:
              </p>
              <ul className="mt-2 space-y-1.5 text-xs">
                <li className="flex items-start gap-2">
                  <ArrowRight className="size-3.5 text-primary mt-0.5 shrink-0" />
                  <span>
                    <code>P_grid_w = 0</code> &rarr; battery serves the car
                    entirely; meter reads zero.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight className="size-3.5 text-primary mt-0.5 shrink-0" />
                  <span>
                    <code>P_grid_w = car draw</code> &rarr; grid serves the
                    car entirely; battery just holds.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <ArrowRight className="size-3.5 text-primary mt-0.5 shrink-0" />
                  <span>
                    anywhere in between &rarr; blended; the battery covers
                    whatever the meter isn&apos;t delivering.
                  </span>
                </li>
              </ul>
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                When to lean on battery, when to let the grid carry it
              </div>
              <p className="text-muted-foreground text-pretty">
                Lean on the battery (low <code>P_grid_w</code>) when the
                current spot price is expensive and SOC is comfortably above
                the floor. Let the grid carry the car (higher{" "}
                <code>P_grid_w</code>) when it&apos;s cheap. If the site
                ceiling <code>P_grid_clearance_w</code> drops below the
                car&apos;s draw, the battery has to cover the difference
                whether Enexa wants to or not &mdash; otherwise the car
                would be under-served and Rule 1 would break.
              </p>
            </div>
            <div className="rounded-lg bg-muted/30 border p-2.5 text-xs">
              <span className="font-semibold text-foreground">
                See in action:
              </span>{" "}
              <span className="text-muted-foreground">
                Move 2 (battery serves the car at an expensive peak) and Move
                4 (site ceiling forces the battery to pick up the slack).
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---- Explicit setpoint-by-setpoint mapping ---- */}
      <Card className="mb-6 overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Settings2 className="size-5 text-primary" />
            What Enexa actually puts on the wire &mdash; setpoint by setpoint
          </CardTitle>
          <CardDescription className="text-pretty">
            v1 has no &ldquo;battery setpoint&rdquo; register. The only power
            flow the dispatch command sets is the <em>meter</em>. Whether the
            battery charges, discharges, or holds is a consequence of the
            power balance &mdash; the unit&apos;s firmware makes it happen
            continuously, with no extra instruction needed. The dispatch
            payload is the <strong>same shape</strong> whether a car is
            plugged in or not; only the chosen <code>P_grid_w</code> value
            differs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm leading-relaxed">
          {/* Table: the one-to-one mapping */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              The v1 command &mdash; one setpoint carries the decision
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">Setpoint</TableHead>
                    <TableHead className="w-[220px]">
                      Role when no car is plugged in
                    </TableHead>
                    <TableHead>Role when a car is plugged in</TableHead>
                  </TableRow>
                </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono text-xs align-top">
                    P_grid_w
                    <div className="text-[10px] text-muted-foreground font-sans font-normal mt-0.5">
                      the one lever
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground align-top">
                    <strong className="text-foreground">
                      Battery charge rate.
                    </strong>{" "}
                    With P<sub>ev</sub> = 0, every watt imported goes into the
                    bank. Send <code>+60000</code> &rarr; battery charges at
                    60 kW. Send <code>0</code> &rarr; battery holds.
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground align-top">
                    <strong className="text-foreground">
                      The grid&apos;s share of the car&apos;s draw.
                    </strong>{" "}
                    The battery automatically covers whatever&apos;s left
                    over. Send <code>0</code> &rarr; battery serves the car
                    entirely. Send the car&apos;s current draw &rarr; grid
                    serves the car entirely, battery just holds. Anywhere in
                    between is a blend.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs align-top">
                    soc_cp_max_pct
                    <br />
                    soc_cp_min_pct
                    <div className="text-[10px] text-muted-foreground font-sans font-normal mt-0.5">
                      guardrails
                    </div>
                  </TableCell>
                  <TableCell
                    className="text-xs text-muted-foreground align-top"
                    colSpan={2}
                  >
                    Hardware-enforced SOC boundaries. In either situation,
                    the unit&apos;s firmware prevents the battery from
                    charging above <code>soc_cp_max_pct</code> or discharging
                    below <code>soc_cp_min_pct</code> &mdash; even if
                    Enexa&apos;s <code>P_grid_w</code> would otherwise drive
                    it there. This is what silently reserves headroom for the
                    next EV session without the optimizer having to think
                    about it.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs align-top">
                    P_grid_clearance_w
                    <div className="text-[10px] text-muted-foreground font-sans font-normal mt-0.5">
                      site ceiling
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground align-top">
                    Rarely matters &mdash; imports while idle are modest.
                    Present so the site never trips its connection while
                    charging the battery.
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground align-top">
                    Can <em>force</em> the battery to pick up more of the
                    load. If the car is drawing more than the site ceiling
                    allows, the unit caps grid import at the ceiling
                    regardless of what <code>P_grid_w</code> asked for, and
                    the battery has to cover the remainder (or Rule 1
                    breaks). See Move 4.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs align-top">
                    P_cp_lim_w
                    <div className="text-[10px] text-muted-foreground font-sans font-normal mt-0.5">
                      hardware ceiling
                    </div>
                  </TableCell>
                  <TableCell
                    className="text-xs text-muted-foreground align-top"
                    colSpan={2}
                  >
                    Left at its rated value (150 kW single / 300 kW dual) in
                    either situation. Not an arbitrage lever &mdash; it is
                    the plug&apos;s factory rating. A car that arrives while
                    idle is served immediately on the next telemetry cycle; a
                    car already plugged in sees no change when the situation
                    changes.
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono text-xs align-top">
                    charging_mode
                    <div className="text-[10px] text-muted-foreground font-sans font-normal mt-0.5">
                      unit topology
                    </div>
                  </TableCell>
                  <TableCell
                    className="text-xs text-muted-foreground align-top"
                    colSpan={2}
                  >
                    Selects Off / Single (150 kW per plug) / Dual-coupled
                    (300 kW on one plug, the other disabled) / Disabled.
                    Chosen at 15-minute market-slot boundaries based on
                    expected sessions, not every time a car plugs or
                    unplugs.
                  </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Two side-by-side worked commands */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-chart-1/30 bg-chart-1/5 p-4 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Battery className="size-4 text-chart-1" />
                <span className="font-semibold text-sm">
                  No car plugged in &mdash; the command
                </span>
              </div>
              <p className="text-xs text-muted-foreground text-pretty">
                Intent: &ldquo;Charge the battery at 60 kW from cheap grid.&rdquo;
              </p>
              <div className="rounded-lg bg-background border p-3 font-mono text-[11px] overflow-x-auto max-w-full">
                <pre>{`{
  "chargers": [{
    "unit_id":        1,
    "charging_mode":  1,
    "P_cp_lim_w":     150000,
    "soc_cp_max_pct": 90,
    "soc_cp_min_pct": 25,
    "P_grid_w":       +60000  // ← charge at 60 kW
  }]
}`}</pre>
              </div>
              <p className="text-xs text-muted-foreground text-pretty">
                The unit imports 60 kW. With no car drawing, that 60 kW has
                nowhere to go except into the battery &mdash; the battery
                charges at 60 kW. Notice there&apos;s nothing about the
                battery in the payload itself; the battery outcome falls
                out of the meter target.
              </p>
            </div>

            <div className="rounded-lg border border-chart-2/30 bg-chart-2/5 p-4 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Car className="size-4 text-chart-2" />
                <span className="font-semibold text-sm">
                  Car plugged in &mdash; the command
                </span>
              </div>
              <p className="text-xs text-muted-foreground text-pretty">
                Intent: &ldquo;Serve the 150 kW car entirely from the
                battery.&rdquo; (Spot price high; SOC healthy.)
              </p>
              <div className="rounded-lg bg-background border p-3 font-mono text-[11px] overflow-x-auto max-w-full">
                <pre>{`{
  "chargers": [{
    "unit_id":        1,
    "charging_mode":  1,
    "P_cp_lim_w":     150000,
    "soc_cp_max_pct": 90,
    "soc_cp_min_pct": 25,
    "P_grid_w":       0       // ← meter at zero
  }]
}`}</pre>
              </div>
              <p className="text-xs text-muted-foreground text-pretty">
                Same shape of command. The car pulls 150 kW (driven by the
                car, must-serve). With the grid set to 0, the battery
                automatically supplies all 150 kW &mdash; it&apos;s
                discharging at 150 kW. To blend 50/50 instead, Enexa would
                send <code>P_grid_w = 75000</code> and the battery would
                discharge the remaining 75 kW, no separate instruction
                needed.
              </p>
            </div>
          </div>

          {/* The critical caveat */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2 text-xs">
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert className="size-4 text-amber-700" />
              <span className="font-semibold text-sm text-foreground">
                The subtle catch: when a car is plugged in, Enexa can&apos;t
                know in advance what the car will actually draw
              </span>
            </div>
            <p className="text-muted-foreground text-pretty">
              When <strong>no car is plugged in</strong>, the command is
              unambiguous: whatever <code>P_grid_w</code> Enexa writes, the
              battery charges at exactly that rate. Nothing can drift.
            </p>
            <p className="text-muted-foreground text-pretty">
              When <strong>a car is plugged in</strong>, it&apos;s trickier.
              How much the battery ends up supplying depends on what the
              car is actually drawing right now &mdash; and the car can
              change its draw at any time (the BMS tapers as the pack fills,
              cabin pre-conditioning kicks in, etc.). Two cases to watch:
            </p>
            <ul className="space-y-1.5 pl-4 list-disc text-muted-foreground">
              <li>
                Enexa sends <code>P_grid_w = 0</code> expecting the car to
                keep pulling 150 kW. The car tapers to 80 kW instead (pack
                nearly full). Battery supplies 80 kW, not 150 kW &mdash;
                still fully covering the car (good), but less revenue than
                planned.
              </li>
              <li>
                Enexa sends a 50/50 blend, <code>P_grid_w = 75000</code>,
                expecting 75 kW of battery discharge alongside 75 kW of
                grid. The car tapers to 40 kW. Now the meter is pushing
                more into the unit than the car is pulling, so the
                leftover 35 kW <em>charges</em> the battery &mdash; while
                a car is plugged in. The car still gets its 40 kW (Rule 1
                intact), but the battery is doing the opposite of what
                Enexa intended.
              </li>
            </ul>
            <p className="text-muted-foreground text-pretty">
              Middleware smooths this out by re-dispatching every time
              telemetry ticks: read the car&apos;s current draw, recompute{" "}
              <code>P_grid_w</code>, write the register. A fast inner loop
              (Middleware &harr; unit, every 1&ndash;10 s) chases whatever
              Enexa&apos;s slower outer loop last asked for. Good enough for
              the pilot; holding a multi-slot plan against link flaps is a
              v2 feature, not a v1 gap.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ---- Mode transitions ---- */}
      <Card className="mb-8 overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ArrowRightLeft className="size-5 text-primary" />
            When the plug state changes &mdash; the gap between situations
          </CardTitle>
          <CardDescription className="text-pretty">
            The system runs on three nested timescales, not one. Cars arrive
            and leave on their own schedule; the gap between what the market
            is pricing and what the site is actually doing has to stay narrow
            without ever breaking Rule 1.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          {/* Three timescales block */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Three clocks, one control loop
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span className="font-semibold text-foreground">
                    Market slot &middot; 15 min
                  </span>
                </div>
                <p className="text-muted-foreground text-pretty">
                  Spot prices step on this boundary. This is what Enexa{" "}
                  <em>optimizes against</em>, not how often it dispatches.
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span className="font-semibold text-foreground">
                    Scheduled dispatch tick &middot; order of 10&ndash;60 s
                  </span>
                </div>
                <p className="text-muted-foreground text-pretty">
                  Enexa re-solves and writes a fresh <code>P_grid_w</code> on a
                  rolling cadence &mdash; configurable per site, far tighter
                  than the 15-minute market slot so that P<sub>ev</sub> drift,
                  SOC drift, and forecast updates are tracked continuously.
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span className="font-semibold text-foreground">
                    Event-triggered re-solve &middot; within a telemetry tick
                  </span>
                </div>
                <p className="text-muted-foreground text-pretty">
                  Enexa doesn&apos;t wait for the next scheduled tick when
                  something interesting shows up in the incoming telemetry
                  stream &mdash; plug / unplug transitions (a change in{" "}
                  <code>plug_state</code>), SOC threshold crossings, or the
                  site approaching the grid clearance. There is{" "}
                  <em>no dedicated plug-event endpoint</em> on Enexa: the
                  transition is carried inside the normal telemetry payload
                  (pushed every ~1 s) and Enexa fires an out-of-cycle
                  re-solve the moment it notices the diff.
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span className="font-semibold text-foreground">
                    Unit firmware &middot; continuous
                  </span>
                </div>
                <p className="text-muted-foreground text-pretty">
                  Whatever the registers hold, ChargePost firmware keeps the
                  power balance satisfied from millisecond to millisecond
                  &mdash; the battery automatically covers every wobble in
                  the car&apos;s draw between register rewrites. This is
                  why the &ldquo;we don&apos;t know what the car will
                  actually draw&rdquo; caveat is an <em>economic</em> risk,
                  never a <em>safety</em> one.
                </p>
              </div>
            </div>
          </div>

          <Separator />

          <p>
            Walk through a concrete moment. At 14:00:00 Enexa issues a{" "}
            <strong>no-car-plugged-in</strong> command:{" "}
            <code>P_grid_w = +90000</code> &mdash; charge the battery at 90 kW
            from cheap grid, no car expected. At 14:00:24 a driver plugs in
            on unit 1 and the car requests 150 kW. Even at the fast scheduled
            cadence, the <em>next</em> scheduled dispatch might still be
            10&ndash;45 seconds away. What does the site actually do in the
            gap?
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border bg-muted/30 p-3 space-y-0.5">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider">
                Car asks for
              </div>
              <p className="font-mono">150 kW</p>
              <p className="text-muted-foreground">
                driven by the car (must-serve)
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-0.5">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider">
                Stale meter target
              </div>
              <p className="font-mono">P<sub>grid</sub> = +90 kW</p>
              <p className="text-muted-foreground">
                last command was for an empty plug
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-0.5">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider">
                Battery has to make up
              </div>
              <p className="font-mono">
                150 &minus; 90 = <strong>60 kW</strong>
              </p>
              <p className="text-muted-foreground">
                battery automatically discharges 60 kW
              </p>
            </div>
          </div>

          <p>
            The unit&apos;s firmware treats <code>P_grid_w</code> as an
            <em>import ceiling</em> and the car&apos;s request as a
            must-serve draw. Grid contributes its 90 kW; the battery covers
            the remaining 60 kW to the car automatically. This is{" "}
            <strong>functionally correct</strong> &mdash; Rule 1 is upheld,
            the car gets its full 150 kW &mdash; but the 90 kW meter target
            was chosen to charge the battery, not to split a car&apos;s draw
            at a cheap spot price. The site is operating on a stale
            command, and a few euros of margin are being left on the table
            until the next dispatch arrives.
          </p>

          <Separator />

          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              How the loop closes
            </div>
            <ol className="space-y-2.5 text-xs text-muted-foreground list-decimal pl-5">
              <li>
                <strong className="text-foreground">Telemetry sees it first.</strong>{" "}
                Within one polling cycle (order of 1 s) Middleware observes{" "}
                <code>plug_state = connected</code> on unit 1 and{" "}
                P<sub>ev</sub> rising from zero.
              </li>
              <li>
                <strong className="text-foreground">
                  Enexa notices via telemetry.
                </strong>{" "}
                The next telemetry push (scheduled every ~1 s) carries the
                flipped <code>plug_state</code>. v1 has no dedicated
                plug-event endpoint on Enexa &mdash; plug transitions
                aren&apos;t a separate channel, they&apos;re a field in the
                regular telemetry payload. Enexa diffs against the previous
                push, sees the transition, and fires an out-of-cycle
                re-solve immediately &mdash; it does <em>not</em> wait for
                the next scheduled dispatch tick, and it certainly does not
                wait for the next 15-minute market slot. A fresh{" "}
                <code>P_grid_w</code> is back on the wire typically within a
                second or two of the plug-in.
              </li>
              <li>
                <strong className="text-foreground">Register rewrite.</strong>{" "}
                Middleware writes the new value to register 12001 (unit 1)
                or 22001 (unit 2). From that tick onward the site is
                executing the new decision &mdash; battery share chosen for
                the prevailing economics, with the unit firmware making the
                split happen automatically.
              </li>
              <li>
                <strong className="text-foreground">
                  If Enexa doesn&apos;t respond in time.
                </strong>{" "}
                The outstanding command carries a <code>valid_until</code>{" "}
                timestamp. If it expires without a refresh, Middleware falls
                back to a safe default: let the grid carry the car up to the
                site ceiling, and the battery covers whatever is left. Rule 1
                is honoured; the optimizer has simply lost its chance to
                pick the battery share for this slot.
              </li>
            </ol>
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground text-pretty">
            <strong className="text-foreground">The mirror case</strong>{" "}
            &mdash; car unplugs mid-slot, leaving a command that was
            tailored for a plugged-in situation now applying to an empty
            plug &mdash; is handled the same way: the unplug event triggers
            an out-of-cycle dispatch. The brief window where the command
            is tuned for the wrong situation is always bounded by telemetry
            latency plus the round-trip to Enexa, and is always physically
            safe because the unit&apos;s firmware keeps the power balance
            satisfied on its own. Worst case: a sub-optimal economic
            decision for a few seconds, never an unsafe or under-served
            one. Holding a multi-slot plan that survives link flaps is a
            known limitation of the current API &mdash; an{" "}
            <code>intertemporal_plan[]</code> field is on the roadmap to
            address it.
          </div>
        </CardContent>
      </Card>

      <Separator className="my-8" />

      {/* ---------- The playbook ---------- */}
      <div className="mb-4">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="size-6 text-primary" />
          The arbitrage playbook &mdash; four worked moments
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl text-pretty">
          Four representative moments in a day &mdash; two in each mode.
          For each one: what the market and the site look like, which levers
          Enexa pulls, and the dispatch payload that encodes the decision.
        </p>
      </div>

      {/* Move 1 — charge from cheap grid (off-peak) */}
      <Card className="mb-6 border-l-4 border-l-chart-1 overflow-hidden">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-chart-1/10">
              <Moon className="size-5 text-chart-1" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <Badge variant="outline" className="text-[10px] border-chart-1/40 text-chart-1 bg-chart-1/5 font-medium gap-1">
                  <Battery className="size-3" />
                  No car plugged in
                </Badge>
              </div>
              <CardTitle className="text-lg">
                Move 1 &mdash; Off-peak window, grid is cheap, no EV plugged in
              </CardTitle>
              <CardDescription>
                Pull cheap grid electrons into the battery so the evening peak
                can be served from storage instead of from the meter.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                Market
              </div>
              <p>
                Spot price at EUR 32/MWh, 70 % below the forecast evening peak.
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                Site
              </div>
              <p>No PV. Battery at 45 % SOC. No EV plugged in.</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                Goal
              </div>
              <p>
                Lift SOC toward 90 % using cheap grid import, within the site
                connection ceiling.
              </p>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Lever moves
            </div>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>soc_cp_max_pct = 90</code> &mdash; raise the ceiling so
                  the battery will accept the incoming energy.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>P_grid_w = +90000</code> &mdash; import 90 kW per unit
                  of cheap grid. With no EV, the entire flow goes into the
                  battery.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>P_grid_clearance_w = 200000</code> &mdash; site ceiling
                  stays comfortable above the combined import across both units.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>P_cp_lim_w = 150000</code> &mdash; irrelevant right now
                  (no EV) but left at its commissioning default, so a car that
                  arrives mid-slot is served immediately.
                </span>
              </li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              How the power balance plays out
            </div>
            <p className="text-muted-foreground">
              Car draw is zero; grid is importing 90 kW per unit &mdash; so
              all 90 kW has to go into the battery.{" "}
              <strong>Battery charges at 90 kW per unit</strong>. Two units
              &times; 90 kW = 180 kW of charge into storage, all at EUR
              32/MWh &mdash; the electrons we will serve to tonight&apos;s EV
              drivers instead of buying at the evening spot.
            </p>
          </div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Dispatch payload
            </div>
<div className="bg-muted/50 rounded-lg p-4 font-mono text-xs overflow-x-auto max-w-full">
            <pre>{`{
  "site_id":     "site_munich_01",
  "command_id":  "cmd_20260422_120000",
  "valid_until": "2026-04-22T12:15:00Z",
  "metadata":    { "price_zone": "cheap", "gate_reason": "cheap_slot" },

  "station": {
    "operation_mode":     1,
    "grid_mgmt_mode":     1,
    "P_grid_clearance_w": 80000
  },
  "chargers": [
    { "unit_id": 1, "charging_mode": 2,
      "P_grid_w": 30000, "P_cp_lim_w": 150000,
      "soc_cp_max_pct": 90, "soc_cp_min_pct": 20 },
    { "unit_id": 2, "charging_mode": 2,
      "P_grid_w": 30000, "P_cp_lim_w": 150000,
      "soc_cp_max_pct": 90, "soc_cp_min_pct": 20 }
  ]
}`}</pre>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Move 2 — discharge to serve EV */}
      <Card className="mb-6 border-l-4 border-l-red-500 overflow-hidden">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
              <TrendingUp className="size-5 text-red-600" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <Badge variant="outline" className="text-[10px] border-chart-2/40 text-chart-2 bg-chart-2/5 font-medium gap-1">
                  <Car className="size-3" />
                  Car plugged in &middot; battery serves it all
                </Badge>
              </div>
              <CardTitle className="text-lg">
                Move 2 &mdash; Evening peak, EV plugs in, grid expensive
              </CardTitle>
              <CardDescription>
                Serve the EV from the battery; keep the meter near zero.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                Market
              </div>
              <p>Spot price at EUR 180/MWh. This is the block we stored for.</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                Site
              </div>
              <p>No PV. Battery at 85 %. EV on unit 1 pulling 150 kW.</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                Goal
              </div>
              <p>
                Deliver EV energy from stored cheap electrons, not from EUR 180
                ones.
              </p>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Lever moves
            </div>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>P_grid_w = 0</code> &mdash; pin the meter at zero. Any
                  energy the EV draws must come from the battery.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>P_cp_lim_w = 150000</code> &mdash; let the EV charge at
                  full rate; that&apos;s exactly what the stored energy is
                  for.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>soc_cp_min_pct = 30</code> &mdash; raise the floor so
                  the battery doesn&apos;t drain below reserve even if the EV
                  stays plugged in longer than expected.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>P_grid_clearance_w = 0</code> &mdash; belt-and-braces
                  site-level import block; if the unit-level setpoint ever
                  slipped, the clearance would still catch it.
                </span>
              </li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              How the power balance plays out
            </div>
            <p className="text-muted-foreground">
              Car is pulling 150 kW; grid is pinned at 0 &mdash; so the
              battery has to deliver the full 150 kW.{" "}
              <strong>Battery discharges at 150 kW</strong> and the car gets
              everything it asked for. Revenue is the price gap between what
              we paid in the off-peak window and EUR 180/MWh now, minus
              round-trip losses.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Move 3 — the null case: no EV, battery holds */}
      <Card className="mb-6 border-l-4 border-l-muted-foreground/40 overflow-hidden">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Ban className="size-5 text-muted-foreground" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <Badge variant="outline" className="text-[10px] border-chart-1/40 text-chart-1 bg-chart-1/5 font-medium gap-1">
                  <Battery className="size-3" />
                  No car plugged in
                </Badge>
              </div>
              <CardTitle className="text-lg">
                Move 3 &mdash; Evening peak, no EV plugged in
              </CardTitle>
              <CardDescription>
                The null case in pilot scope &mdash; battery holds, waits for
                the next session.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                Market
              </div>
              <p>Spot at EUR 220/MWh. No export route.</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                Site
              </div>
              <p>No EV on either unit. Battery at 85 %.</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                Goal
              </div>
              <p>Preserve stored energy for the next EV that arrives.</p>
            </div>
          </div>

          <p>
            This is the slot where, in a post-pilot world with an export
            contract, the battery would earn its best euros &mdash; sell 85% SOC
            into EUR 220/MWh. In <strong>pilot scope that option does not
            exist</strong>. Sending <code>P_grid_w &lt; 0</code> would be
            clamped to zero by Middleware; the battery would cycle for nothing,
            burning round-trip efficiency without revenue. So the optimizer
            deliberately does <em>nothing</em>.
          </p>

          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Lever moves
            </div>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>P_grid_w = 0</code> &mdash; no import, no (attempted)
                  export. The meter reads zero, the battery is idle.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>charging_mode = 0</code> (Off) on both units &mdash;
                  nothing is plugged in, nothing to drive.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>soc_cp_max_pct = 100</code>, <code>soc_cp_min_pct = 25</code>{" "}
                  &mdash; unchanged. The battery just sits at its current SOC
                  until either an EV plugs in (Move 2 takes over) or the next
                  off-peak window arrives (Move 1 refills whatever was spent).
                </span>
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
            <Ban className="size-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-muted-foreground text-pretty">
              <strong>Why this slot exists on the page at all.</strong> It makes
              the pilot scope visible: the single biggest arbitrage opportunity
              on paper &mdash; cheap midday charge, expensive evening discharge
              to the grid &mdash; is structurally unavailable until an export
              contract and settlement route are in place. Post-pilot, this same
              slot becomes the highest-margin dispatch of the day. Today it is
              an intentional hold.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Move 4 — curtailment */}
      <Card className="mb-6 border-l-4 border-l-sky-500 overflow-hidden">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10">
              <ShieldAlert className="size-5 text-sky-700" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <Badge variant="outline" className="text-[10px] border-chart-2/40 text-chart-2 bg-chart-2/5 font-medium gap-1">
                  <Car className="size-3" />
                  Car plugged in &middot; battery picks up the slack
                </Badge>
              </div>
              <CardTitle className="text-lg">
                Move 4 &mdash; Grid ceiling under pressure, EV still plugged in
              </CardTitle>
              <CardDescription>
                Cap EV draw without cutting it off; serve the rest from battery.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                Market
              </div>
              <p>Prices high. Site behind a DSO headroom restriction.</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                Site
              </div>
              <p>EV wants 150 kW. Grid ceiling down to 40 kW. Battery at 70 %.</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold text-muted-foreground text-[10px] uppercase tracking-wider mb-1">
                Goal
              </div>
              <p>Keep the car charging; stay inside the ceiling.</p>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Lever moves
            </div>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>P_grid_clearance_w = 40000</code> &mdash; accept the
                  new ceiling explicitly.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>P_grid_w = +40000</code> on the unit with the EV
                  &mdash; take the full ceiling at the meter.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>P_cp_lim_w = 150000</code> &mdash; let the EV ask for
                  everything; the battery will cover whatever the meter
                  can&apos;t.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowRight className="size-4 text-primary mt-0.5 shrink-0" />
                <span>
                  <code>soc_cp_min_pct = 25</code> &mdash; the battery will
                  carry the other 110 kW, but only until the floor.
                </span>
              </li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              How the power balance plays out
            </div>
            <p className="text-muted-foreground">
              Car is pulling 150 kW; grid is capped at 40 kW &mdash; so the
              battery automatically covers the remaining 110 kW.{" "}
              <strong>Battery discharges at 110 kW</strong>. The driver
              sees no curtailment at all &mdash; the car is still at 150 kW.
            </p>
          </div>
        </CardContent>
      </Card>

      <Separator className="my-8" />

      {/* ---------- Constraints honoured ---------- */}
<Card className="mb-6 overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Layers className="size-5 text-primary" />
            Key takeaway
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed space-y-2">
          <p>
            v1 is deliberately a <strong>small, honest toolkit</strong>. The
            three battery/grid setpoints, combined with the simple rule{" "}
            <em>battery output = car draw &minus; grid import</em>, are
            enough to execute instantaneous arbitrage <em>while</em> the EV
            must-serve obligation holds. The car gets what it asks for,
            every tick; the optimizer&apos;s job is to arrange the rest so
            the electrons are as cheap as possible.
          </p>
          <p className="text-muted-foreground">
            The two things the current API can&apos;t express &mdash; committed
            multi-slot plans and declarative conflict resolution between grid,
            battery, and must-serve &mdash; are roadmap conversations, and any
            future addition stays strictly on the battery/grid side. No
            additional field will ever give Enexa a lever to withhold service
            from a plugged-in vehicle.
          </p>
        </CardContent>
      </Card>

      {/* ---------- Known limitations of the current API ---------- */}
      <Card className="mb-6 border-amber-500/30 bg-amber-500/5 overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="size-5 text-amber-600" />
            Known limitations of the current API
          </CardTitle>
          <CardDescription className="text-pretty">
            The Dispatching API dispatches one tick at a time. Two capabilities
            that require knowing the future are out of scope today and tracked
            as roadmap items.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <ul className="space-y-3 text-muted-foreground">
            <li className="flex items-start gap-2">
              <ArrowRight className="size-4 text-amber-600 mt-0.5 shrink-0" />
              <span>
                <strong className="text-foreground">
                  Committed multi-slot plans.
                </strong>{" "}
                Today the API can only say &ldquo;right now, import X.&rdquo;
                It cannot pre-commit a trajectory like &ldquo;hold flat for the
                next two hours, then ramp.&rdquo; A future{" "}
                <code>intertemporal_plan[]</code> field would let Enexa upload
                a slot-by-slot schedule that Middleware caches and executes
                even if the upstream link flaps.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <ArrowRight className="size-4 text-amber-600 mt-0.5 shrink-0" />
              <span>
                <strong className="text-foreground">
                  Declarative conflict resolution.
                </strong>{" "}
                What should the site do when a car plugs in during a
                price-triggered battery hold? The current API has no vocabulary
                for expressing priority &mdash; Middleware uses a built-in
                must-serve default. A future <code>metadata.strategy</code>{" "}
                field would let Enexa tag a command with its intent so
                Middleware can pick the right override.
              </span>
            </li>
          </ul>
          <p>
            Smooth ramps <em>across</em> market-slot boundaries &mdash; where
            the spot price steps &mdash; so the site doesn&apos;t bang into
            grid-clearance limits on the edge, and thermal pre-conditioning of
            the battery ahead of a big discharge, both belong in{" "}
            <code>intertemporal_plan[]</code>. They are roadmap items the
            current single-tick API was never designed to express.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
