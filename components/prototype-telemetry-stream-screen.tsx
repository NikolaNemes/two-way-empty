"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Code2,
  Copy,
  Check,
  Network,
  Radio,
  RotateCw,
  Pause,
  ArrowDown,
  ArrowUp,
  Minus,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { usePrototypeTelemetryContext } from "@/lib/prototype-telemetry-context"
import { InfoHint } from "@/components/prototype/info-hint"
import { cn } from "@/lib/utils"
import type { TelemetryFrame } from "@/lib/prototype-telemetry"

type ViewMode = "current" | "tail"

// ----------------------------------------------------------------------------
// JSON syntax highlighting
// Tokenises a single line of pretty-printed JSON into (text, kind) pairs
// so the renderer can apply colour-blind-distinct token classes.
// ----------------------------------------------------------------------------

type Token =
  | { kind: "key"; text: string }
  | { kind: "string"; text: string }
  | { kind: "number"; text: string }
  | { kind: "boolean"; text: string }
  | { kind: "null"; text: string }
  | { kind: "punct"; text: string }
  | { kind: "ws"; text: string }

const TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false)|(null)|([{}[\],])|(\s+)/g

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = []
  let lastIndex = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ kind: "ws", text: line.slice(lastIndex, m.index) })
    }
    if (m[1] !== undefined) {
      // string OR key (depending on whether ":" follows)
      if (m[2]) {
        tokens.push({ kind: "key", text: m[1] })
        tokens.push({ kind: "punct", text: m[2] })
      } else {
        tokens.push({ kind: "string", text: m[1] })
      }
    } else if (m[3] !== undefined) {
      tokens.push({ kind: "number", text: m[3] })
    } else if (m[4] !== undefined) {
      tokens.push({ kind: "boolean", text: m[4] })
    } else if (m[5] !== undefined) {
      tokens.push({ kind: "null", text: m[5] })
    } else if (m[6] !== undefined) {
      tokens.push({ kind: "punct", text: m[6] })
    } else if (m[7] !== undefined) {
      tokens.push({ kind: "ws", text: m[7] })
    }
    lastIndex = TOKEN_RE.lastIndex
  }
  if (lastIndex < line.length) {
    tokens.push({ kind: "ws", text: line.slice(lastIndex) })
  }
  return tokens
}

const TOKEN_CLS: Record<Token["kind"], string> = {
  key: "text-sky-700 dark:text-sky-400",
  string: "text-emerald-700 dark:text-emerald-400",
  number: "text-amber-700 dark:text-amber-400",
  boolean: "text-violet-700 dark:text-violet-400",
  null: "text-violet-700 dark:text-violet-400 italic",
  punct: "text-muted-foreground",
  ws: "",
}

function HighlightedLine({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeLine(text), [text])
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={TOKEN_CLS[t.kind]}>
          {t.text}
        </span>
      ))}
    </>
  )
}

// ----------------------------------------------------------------------------
// Diff helpers
// ----------------------------------------------------------------------------

function diffLines(prev: string[] | null, curr: string[]): boolean[] {
  if (!prev) return curr.map(() => false)
  return curr.map((line, i) => {
    const p = prev[i]
    if (p === undefined) return true
    return p !== line
  })
}

// ----------------------------------------------------------------------------
// Screen
// ----------------------------------------------------------------------------

export function PrototypeTelemetryStreamScreen() {
  const { simulated, frame } = usePrototypeTelemetryContext()
  const { history, isPaused } = simulated
  const [view, setView] = useState<ViewMode>("current")
  const [copied, setCopied] = useState(false)
  const previousLinesRef = useRef<string[] | null>(null)
  const tailRef = useRef<HTMLDivElement | null>(null)

  const json = useMemo(() => {
    if (!frame) return "{}"
    return JSON.stringify(frame, null, 2)
  }, [frame])

  const lines = useMemo(() => json.split("\n"), [json])
  const changed = useMemo(
    () => diffLines(previousLinesRef.current, lines),
    [lines],
  )

  useEffect(() => {
    if (!isPaused) {
      previousLinesRef.current = lines
    }
  }, [lines, isPaused])

  const tailFrames = useMemo(() => history.slice(-30).reverse(), [history])

  useEffect(() => {
    if (view === "tail" && tailRef.current) {
      tailRef.current.scrollTop = 0
    }
  }, [tailFrames.length, view])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const changedCount = changed.filter(Boolean).length
  const sizeKB = (json.length / 1024).toFixed(1)
  const tickWallClock = frame?.ts.split("T")[1]?.slice(0, 8)

  // Quick at-a-glance summary chips above the JSON
  const summary = frame
    ? {
        P_grid_kw: frame.grid.P_grid_w / 1000,
        P_bat_kw:
          (frame.batteries[0].power_w + frame.batteries[1].power_w) / 1000,
        P_ev_kw:
          (frame.chargers[0].P_EV_w + frame.chargers[1].P_EV_w) / 1000,
      }
    : null

  return (
    <>
      {/* ------------------------- HEADER CARD ------------------------- */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Network className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="text-lg font-semibold tracking-tight">
                  Wire-format inspector
                </h2>
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] gap-1.5"
                >
                  <span
                    className={cn(
                      "inline-block size-1.5 rounded-full",
                      isPaused
                        ? "bg-amber-500"
                        : "bg-emerald-500 animate-pulse",
                    )}
                  />
                  {isPaused ? "paused" : "live"}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px]">
                  v1 Telemetry API
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed text-pretty max-w-3xl">
                The exact <code className="text-xs">application/json</code>{" "}
                payload Middleware would{" "}
                <code className="text-xs">POST /api/v1/telemetry</code> at
                ~1 Hz. Field names, units and sign conventions are the
                contract &mdash; this is the screen integrators check first.
                Lines that moved since the previous tick highlight green so
                you can see what each scenario actually changes on the wire.
              </p>
            </div>
          </div>

          <div className="grid gap-4 border-t pt-4 sm:grid-cols-3">
            <NarrativeBlock
              title="Purpose"
              body={
                <>
                  Source-of-truth view onto the wire payload. Use it to verify
                  field names (<code>P_grid_w</code>,{" "}
                  <code>plug_state</code>), units (W vs kW), and sign
                  conventions (+ = import) before integrating with real
                  Middleware.
                </>
              }
            />
            <NarrativeBlock
              title="How to use it"
              body={
                <>
                  <strong>Current frame</strong> &mdash; full JSON with
                  per-line green diff highlight against the previous tick.{" "}
                  <strong>Frame tail</strong> &mdash; last 30 ticks in a
                  scannable table so you can scrub recent history. Pause from
                  the header to freeze the diff.
                </>
              }
            />
            <NarrativeBlock
              title="Watch for"
              body={
                <>
                  Check that <code>P_grid_w</code> equals the sum of{" "}
                  <code>P_battery</code> + <code>P_EV</code> +{" "}
                  <code>P_aux</code> &mdash; conservation must hold to the
                  watt. SOC moves slowly; power numbers move every tick.
                </>
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ------------------------- META STRIP ------------------------- */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetaChip
            label="Frame ID"
            value={`t = ${frame!.t_s}s`}
            sub={tickWallClock ? `${tickWallClock}Z` : ""}
            icon={Radio}
          />
          <MetaChip
            label="Payload size"
            value={`${sizeKB} kB`}
            sub={`${lines.length} lines`}
            icon={Code2}
          />
          <MetaChip
            label="Changed lines"
            value={`${changedCount}`}
            sub={
              isPaused
                ? "diff frozen"
                : changedCount === 0
                  ? "steady state"
                  : "vs previous tick"
            }
            icon={isPaused ? Pause : RotateCw}
            tone={changedCount > 0 && !isPaused ? "emerald" : "muted"}
          />
          <MetaChip
            label="History buffer"
            value={`${history.length}`}
            sub={`${tailFrames.length} shown in tail`}
            icon={Network}
          />
        </div>
      )}

      {/* ------------------------- TOOLBAR ------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={view}
          onValueChange={(v) => v && setView(v as ViewMode)}
          variant="outline"
        >
          <ToggleGroupItem value="current" className="text-xs">
            <Code2 className="size-3" />
            Current frame
          </ToggleGroupItem>
          <ToggleGroupItem value="tail" className="text-xs">
            <Network className="size-3" />
            Frame tail (last 30)
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-2">
          {view === "current" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleCopy}
              disabled={!frame}
            >
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy JSON"}
            </Button>
          )}
        </div>
      </div>

      {/* ------------------------- BODY ------------------------- */}
      <Card className="overflow-hidden">
        <CardHeader className="gap-1.5 border-b bg-muted/40 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              {view === "current" ? (
                <>
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/40 font-mono text-[10px]"
                  >
                    POST
                  </Badge>
                  <code className="text-foreground">/api/v1/telemetry</code>
                </>
              ) : (
                <>
                  <Network className="size-4 text-muted-foreground" />
                  <span>Frame tail</span>
                </>
              )}
              <InfoHint side="bottom">
                <p className="font-medium mb-1">
                  {view === "current"
                    ? "Current frame inspector"
                    : "Frame tail summary"}
                </p>
                <p>
                  {view === "current" ? (
                    <>
                      Renders the most recent payload with per-line diff
                      highlighting. Field names match the v1 Telemetry API
                      contract verbatim.
                    </>
                  ) : (
                    <>
                      Compact one-line summary of the last 30 frames so you
                      can scrub recent history without drowning in JSON.
                    </>
                  )}
                </p>
              </InfoHint>
            </CardTitle>
            <CardDescription className="text-[11px]">
              {view === "current"
                ? "Lines highlighted green changed since the previous tick."
                : "Newest frame at the top."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {view === "current" ? (
            <div className="overflow-x-auto bg-card">
              {!frame ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Waiting for first frame&hellip;
                </div>
              ) : (
                <pre className="m-0 font-mono text-[11.5px] leading-[1.6] tabular-nums">
                  {lines.map((line, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex border-l-2 px-3 transition-colors",
                        changed[i] && !isPaused
                          ? "border-l-emerald-500 bg-emerald-500/5"
                          : "border-l-transparent",
                      )}
                    >
                      <span className="select-none pr-3 text-muted-foreground/50 text-right tabular-nums w-9 shrink-0">
                        {i + 1}
                      </span>
                      <span className="flex-1 whitespace-pre">
                        <HighlightedLine text={line} />
                      </span>
                    </div>
                  ))}
                </pre>
              )}
            </div>
          ) : (
            <div ref={tailRef} className="max-h-[600px] overflow-y-auto">
              {tailFrames.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No frames in buffer yet&hellip;
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
                    <tr className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                      <th className="text-left px-3 py-2.5">t</th>
                      <th className="text-left px-3 py-2.5">Wall-clock</th>
                      <th className="text-right px-3 py-2.5">P_grid</th>
                      <th className="text-right px-3 py-2.5">P_bat</th>
                      <th className="text-right px-3 py-2.5">P_EV</th>
                      <th className="text-right px-3 py-2.5">SOC b1 / b2</th>
                      <th className="text-center px-3 py-2.5">Plug</th>
                      <th className="text-right px-3 py-2.5">EPEX</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {tailFrames.map((f, i) => (
                      <TailRow key={f.t_s} f={f} isLatest={i === 0} />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function NarrativeBlock({
  title,
  body,
}: {
  title: string
  body: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      <p className="text-xs leading-relaxed text-foreground/80 text-pretty">
        {body}
      </p>
    </div>
  )
}

function MetaChip({
  label,
  value,
  sub,
  icon: Icon,
  tone = "muted",
}: {
  label: string
  value: string
  sub: string
  icon: typeof Code2
  tone?: "muted" | "emerald"
}) {
  const accent =
    tone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
      : "text-muted-foreground bg-muted"
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-md",
            accent,
          )}
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      <div className="mt-1.5 font-mono text-base font-semibold tabular-nums leading-none text-foreground">
        {value}
      </div>
      <div className="mt-1 text-[10.5px] text-muted-foreground">{sub}</div>
    </div>
  )
}

function PowerCell({ kw }: { kw: number }) {
  const Icon = kw > 0.05 ? ArrowDown : kw < -0.05 ? ArrowUp : Minus
  const tone =
    kw > 0.05
      ? "text-sky-700 dark:text-sky-400"
      : kw < -0.05
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-muted-foreground"
  return (
    <span className={cn("inline-flex items-center justify-end gap-1", tone)}>
      <Icon className="size-3" aria-hidden="true" />
      <span className="tabular-nums">{Math.abs(kw).toFixed(1)}</span>
    </span>
  )
}

function PlugDots({ plug }: { plug: { c1: boolean; c2: boolean } }) {
  return (
    <span className="inline-flex items-center justify-center gap-1">
      <span
        className={cn(
          "size-1.5 rounded-full",
          plug.c1 ? "bg-primary" : "bg-muted-foreground/30",
        )}
        title={plug.c1 ? "Connector 1: plugged" : "Connector 1: unplugged"}
      />
      <span
        className={cn(
          "size-1.5 rounded-full",
          plug.c2 ? "bg-primary" : "bg-muted-foreground/30",
        )}
        title={plug.c2 ? "Connector 2: plugged" : "Connector 2: unplugged"}
      />
    </span>
  )
}

function TailRow({ f, isLatest }: { f: TelemetryFrame; isLatest: boolean }) {
  const plug = {
    c1: f.chargers[0].plug_state === "Plugged",
    c2: f.chargers[1].plug_state === "Plugged",
  }
  return (
    <tr
      className={cn(
        "border-b last:border-0 hover:bg-muted/40",
        isLatest && "bg-emerald-500/[0.04]",
      )}
    >
      <td className="px-3 py-1.5 text-muted-foreground">
        {isLatest ? (
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {f.t_s}s
          </span>
        ) : (
          <>{f.t_s}s</>
        )}
      </td>
      <td className="px-3 py-1.5 text-muted-foreground">
        {f.ts.split("T")[1].slice(0, 8)}
      </td>
      <td className="px-3 py-1.5 text-right">
        <PowerCell kw={f.grid.P_grid_w / 1000} />
      </td>
      <td className="px-3 py-1.5 text-right">
        <PowerCell
          kw={(f.batteries[0].power_w + f.batteries[1].power_w) / 1000}
        />
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        {((f.chargers[0].P_EV_w + f.chargers[1].P_EV_w) / 1000).toFixed(1)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
        <span className="text-foreground">
          {f.batteries[0].soc_pct.toFixed(1)}
        </span>
        <span className="mx-1 text-muted-foreground/50">/</span>
        <span className="text-foreground">
          {f.batteries[1].soc_pct.toFixed(1)}
        </span>
      </td>
      <td className="px-3 py-1.5 text-center">
        <PlugDots plug={plug} />
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        {f.market.epex_price_eur_mwh.toFixed(0)}
      </td>
    </tr>
  )
}
