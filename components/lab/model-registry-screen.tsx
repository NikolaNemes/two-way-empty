"use client"

import { useEffect, useState, useTransition } from "react"
import useSWR from "swr"
import {
  BookMarked,
  Lock,
  Star,
  Plus,
  Loader2,
  ChevronRight,
  ShieldCheck,
  Lightbulb,
  CalendarClock,
  PiggyBank,
  BatteryCharging,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  listModelVersions,
  setDefaultVersion,
  createDraftVersion,
} from "@/app/actions/models"
import type { ModelVersionRow } from "@/lib/db/schema"
import { OPTIMIZER_PARAM_META, type OptimizerParams } from "@/lib/model-registry"
import { LabPageHeader, LabPageShell } from "./lab-page-header"

export function ModelRegistryScreen() {
  const { data, isLoading, mutate } = useSWR("lab:models", () => listModelVersions(), {
    revalidateOnFocus: false,
  })
  const [selected, setSelected] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()

  const versions = data ?? []
  const selectedVersion = versions.find((v) => v.id === selected) ?? versions[0] ?? null

  useEffect(() => {
    if (selected == null && versions.length > 0) setSelected(versions[0].id)
  }, [versions, selected])

  function handleSetDefault(id: number) {
    startTransition(async () => {
      await setDefaultVersion(id)
      await mutate()
    })
  }

  return (
    <LabPageShell>
      <LabPageHeader
        icon={<BookMarked className="size-7 text-teal-600" />}
        title="Model Registry"
        description="The single dispatch engine is versioned here. The current optimizer — an event-driven LP with an adaptive, uncertainty-sized reserve and a hard self-consumption throughput cap on the metered ChargePost model — is the live default and the only engine in production. Earlier heuristic planners and the flat-floor parameterisation have been retired; their version labels remain for stored history. New draft versions are parameterisations of this one engine for comparison."
        actions={<CreateDraftDialog onCreated={() => mutate()} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Version list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Versions</CardTitle>
            <CardDescription>Select a version to inspect its parameter snapshot.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading versions…
              </div>
            ) : (
              versions.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  active={selectedVersion?.id === v.id}
                  onClick={() => setSelected(v.id)}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* Detail */}
        {selectedVersion ? (
          <VersionDetail
            version={selectedVersion}
            onSetDefault={handleSetDefault}
            settingDefault={isPending}
          />
        ) : null}
      </div>
    </LabPageShell>
  )
}

function VersionRow({
  version,
  active,
  onClick,
}: {
  version: ModelVersionRow
  active: boolean
  onClick: () => void
}) {
  const frozen = version.status === "frozen"
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
        active ? "border-teal-500/50 bg-teal-500/5" : "hover:bg-muted/50",
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-sm font-semibold">
        {version.label}
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{version.name}</span>
        <div className="flex items-center gap-1.5">
          {frozen ? (
            <Badge variant="outline" className="h-4 gap-0.5 border-sky-500/40 px-1 text-[10px] text-sky-600">
              <Lock className="size-2.5" /> frozen
            </Badge>
          ) : (
            <Badge variant="outline" className="h-4 px-1 text-[10px] text-muted-foreground">
              {version.status}
            </Badge>
          )}
          {version.isDefault ? (
            <Badge variant="outline" className="h-4 gap-0.5 border-amber-500/40 px-1 text-[10px] text-amber-600">
              <Star className="size-2.5 fill-amber-500 text-amber-500" /> default
            </Badge>
          ) : null}
        </div>
      </div>
      <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

/**
 * Plain-language explainer of the optimizer engine — written for a non-technical
 * reader (an operator or stakeholder), not an engineer. No jargon, no maths.
 */
function McpNarrative() {
  const steps = [
    {
      icon: CalendarClock,
      title: "It looks ahead, not just at right now",
      body: "Every few minutes the model looks at the whole day ahead — tomorrow's electricity prices and how many cars we expect to charge, hour by hour — instead of only reacting to the current moment.",
    },
    {
      icon: PiggyBank,
      title: "It buys energy when it's cheapest",
      body: "When power is cheap (often overnight or midday), it fills the battery. When power is expensive, it leans on the stored energy instead of buying at the high price. Same cars get charged — just paid for at a better moment.",
    },
    {
      icon: ShieldCheck,
      title: "Charging the cars always comes first",
      body: "Cost-saving never gets in the way of service. The plan is only allowed if every car still gets the energy it needs, and the battery is always kept above a safety reserve so we're never caught empty before a busy period.",
    },
    {
      icon: BatteryCharging,
      title: "The battery only ever feeds the cars",
      body: "We never sell energy back to the grid, so the battery is only emptied to serve real cars in front of it. The model is told it can't discharge more than the cars will actually use that day — no wasteful cycling of the battery just to chase prices.",
    },
  ]

  return (
    <div className="rounded-lg border border-teal-500/30 bg-teal-500/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Lightbulb className="size-4 text-teal-600" />
        <h3 className="text-sm font-semibold text-teal-800">How the dispatcher decides — in plain English</h3>
      </div>
      <p className="mb-4 text-pretty text-sm leading-relaxed text-muted-foreground">
        Think of it as a planner that re-draws the best plan for the rest of the day every few minutes. Rather
        than following a fixed set of {'"'}if this, then that{'"'} rules, it weighs every option at once and picks the
        cheapest way to keep every car charged.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {steps.map((s) => (
          <div key={s.title} className="flex gap-3 rounded-md border bg-card p-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-teal-500/10">
              <s.icon className="size-4 text-teal-600" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-semibold leading-snug">{s.title}</p>
              <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-pretty text-xs leading-relaxed text-muted-foreground">
        The result: the same cars are charged just as reliably as before, but the energy behind them is bought at
        the smartest possible times — which is why it typically lands a lower bill (and often a net credit) than the
        older rule-based versions.
      </p>
    </div>
  )
}

function VersionDetail({
  version,
  onSetDefault,
  settingDefault,
}: {
  version: ModelVersionRow
  onSetDefault: (id: number) => void
  settingDefault: boolean
}) {
  const params = (version.params ?? {}) as Record<string, unknown>
  // The optimizer block is a nested object — pull it out so it renders as its own
  // labeled table instead of "[object Object]" in the flat snapshot.
  const mpc = (params.mpc ?? null) as OptimizerParams | null
  const isV4 = params.engine === "v4-mpc"
  const entries = Object.entries(params).filter(([k]) => k !== "mpc")

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <span className="font-mono">{version.label}</span>
              {version.name}
            </CardTitle>
            <CardDescription>{version.description}</CardDescription>
          </div>
          {!version.isDefault ? (
            <Button size="sm" variant="outline" disabled={settingDefault} onClick={() => onSetDefault(version.id)}>
              {settingDefault ? <Loader2 className="size-4 animate-spin" /> : <Star className="size-4" />}
              Make default
            </Button>
          ) : (
            <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600">
              <Star className="size-3 fill-amber-500 text-amber-500" /> Active default
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isV4 ? <McpNarrative /> : null}

        {version.kernelNotes ? (
          <div className="flex items-start gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-700">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <span>{version.kernelNotes}</span>
          </div>
        ) : null}

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Parameter snapshot ({entries.length})
          </h3>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <tbody>
                {entries.map(([k, val], i) => (
                  <tr key={k} className={cn("border-b last:border-0", i % 2 ? "bg-muted/30" : "")}>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{k}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {typeof val === "number" ? val.toLocaleString() : String(val)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {isV4 && mpc ? (
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="size-3.5 text-teal-600" />
              Optimizer model & constraints ({OPTIMIZER_PARAM_META.length})
            </h3>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <tbody>
                  {OPTIMIZER_PARAM_META.map((meta, i) => {
                    const v = mpc[meta.key]
                    const display =
                      v == null
                        ? "auto"
                        : typeof v === "number"
                          ? v.toLocaleString()
                          : typeof v === "boolean"
                            ? v
                              ? "on"
                              : "off"
                            : String(v)
                    return (
                      <tr key={meta.key} className={cn("border-b last:border-0", i % 2 ? "bg-muted/30" : "")}>
                        <td className="px-3 py-1.5">
                          <div className="text-xs font-medium">{meta.label}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{meta.key}</div>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                          {display}
                          {meta.unit ? <span className="ml-1 text-[10px] text-muted-foreground">{meta.unit}</span> : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CreateDraftDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState("")
  const [name, setName] = useState("")
  const [gridLimit, setGridLimit] = useState("")
  const [isPending, startTransition] = useTransition()

  function handleCreate() {
    startTransition(async () => {
      const override: Record<string, number> = {}
      const parsed = Number(gridLimit)
      if (gridLimit.trim() && Number.isFinite(parsed)) override.gridImportLimitKw = parsed
      await createDraftVersion({
        label: label.trim() || `draft-${Date.now()}`,
        name: name.trim() || "Untitled draft",
        paramOverride: override,
      })
      setOpen(false)
      setLabel("")
      setName("")
      setGridLimit("")
      onCreated()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" /> New draft version
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create draft version</DialogTitle>
          <DialogDescription>
            Clones the production (v3) parameter snapshot. Only kernel-input params (e.g. grid import
            limit) are applied during backtests; the rest are recorded for documentation and comparison.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="draft-label">Label</Label>
            <Input id="draft-label" placeholder="v2-grid-cap" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="draft-name">Name</Label>
            <Input
              id="draft-name"
              placeholder="Per-slot grid-limited fill"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="draft-grid">Grid import limit override (kW)</Label>
            <Input
              id="draft-grid"
              type="number"
              placeholder="leave blank to inherit v1"
              value={gridLimit}
              onChange={(e) => setGridLimit(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isPending}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
