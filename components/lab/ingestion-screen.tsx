"use client"

import { useState, useTransition } from "react"
import useSWR from "swr"
import {
  Database,
  Download,
  Loader2,
  CheckCircle2,
  CircleAlert,
  CalendarRange,
  HardDriveDownload,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { LabRangePicker } from "./lab-range-picker"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { startBackfill, listIngestionJobs, getDatasetCoverage } from "@/app/actions/ingestion"
import { useStation } from "@/components/station-context"
import type { IngestionJobRow } from "@/lib/db/schema"
import { LabPageHeader, LabPageShell } from "./lab-page-header"
import { CoverageCalendar } from "./coverage-calendar"

const coverageConfig = {
  count: { label: "Frames", color: "var(--chart-1)" },
} satisfies ChartConfig

export function IngestionScreen() {
  // Default to the full month of May (the dataset the user has). Year is the
  // most recent May not in the future.
  const now = new Date()
  const defaultYear = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
  const [fromDate, setFromDate] = useState(`${defaultYear}-05-01`)
  const [toDate, setToDate] = useState(`${defaultYear}-05-31`)
  const [isPending, startTransition] = useTransition()
  const [activeJob, setActiveJob] = useState<IngestionJobRow | null>(null)

  // MULTI-LOCATION: backfill + coverage target the sidebar-selected station.
  // stationId is part of the SWR key so switching stations refetches coverage.
  const { stationId } = useStation()
  const { data: jobs, mutate: mutateJobs } = useSWR("lab:jobs", () => listIngestionJobs(), {
    refreshInterval: isPending ? 1500 : 0,
  })
  const { data: coverage, mutate: mutateCoverage } = useSWR(`lab:coverage:${stationId}`, () =>
    getDatasetCoverage(stationId),
  )

  function handleBackfill() {
    startTransition(async () => {
      // to is end-exclusive: add a day so the whole 'toDate' is included.
      const toExclusive = new Date(`${toDate}T00:00:00Z`)
      toExclusive.setUTCDate(toExclusive.getUTCDate() + 1)
      const job = await startBackfill({
        stationId,
        fromIso: new Date(`${fromDate}T00:00:00Z`).toISOString(),
        toIso: toExclusive.toISOString(),
        stepSeconds: 15,
      })
      setActiveJob(job)
      await Promise.all([mutateJobs(), mutateCoverage()])
    })
  }

  const perDay = coverage?.perDay ?? []
  const totalRows = coverage?.totalRows ?? 0
  const overallPct = coverage ? coverage.overallCompleteness * 100 : 0
  const missingDays = coverage?.missingDays ?? 0
  const expectedPerDay = coverage?.expectedPerDay ?? 5760
  const spanDays = perDay.length
  const effectiveStep = coverage?.effectiveStepSeconds ?? 15
  const requestedStep = coverage?.requestedStepSeconds ?? 15
  const dropoutCount = coverage?.dropoutCount ?? 0
  const maxGapMin = coverage ? Math.round((coverage.maxGapSeconds / 60) * 10) / 10 : 0

  return (
    <LabPageShell>
      <LabPageHeader
        icon={<Database className="size-7 text-teal-600" />}
        title="Telemetry Ingestion"
        description="Backfill historical telemetry frames from the live Amperio API into Neon at the 15-second dispatch resolution. Stored frames power the dataset explorer and reproducible backtests. Re-running a range is safe — duplicate timestamps are skipped."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Backfill control */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <HardDriveDownload className="size-5 text-teal-600" />
              Backfill range
            </CardTitle>
            <CardDescription>Pull a date range from Amperio into Neon (15s frames).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Backfill range (inclusive)</Label>
              <LabRangePicker
                from={fromDate}
                to={toDate}
                disabled={isPending}
                onApply={(f, t) => {
                  setFromDate(f)
                  setToDate(t)
                }}
              />
            </div>
            <Button onClick={handleBackfill} disabled={isPending} className="w-full gap-2">
              {isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {isPending ? "Ingesting…" : "Start backfill"}
            </Button>
            {activeJob ? <JobStatusCard job={jobs?.find((j) => j.id === activeJob.id) ?? activeJob} /> : null}
            <p className="text-xs text-muted-foreground leading-relaxed">
              At 15s resolution a full day is ~5,760 frames. A whole month is ~178k rows. The backfill
              runs day-by-day and updates progress as it goes.
            </p>
          </CardContent>
        </Card>

        {/* Coverage */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CalendarRange className="size-5 text-teal-600" />
                  Stored coverage
                </CardTitle>
                <CardDescription>
                  {totalRows.toLocaleString()} frames
                  {coverage?.minTs
                    ? ` · ${coverage.minTs.slice(0, 10)} → ${coverage.maxTs?.slice(0, 10)}`
                    : " · no data yet"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {perDay.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
                <Database className="size-8 opacity-40" />
                <p className="text-sm">No frames stored yet. Run a backfill to populate the dataset.</p>
              </div>
            ) : (
              <>
                {/* Completeness summary tiles */}
                <div className="grid grid-cols-4 gap-3">
                  <CoverageStat
                    label="Completeness"
                    value={`${overallPct.toFixed(1)}%`}
                    tone={overallPct >= 99 ? "good" : overallPct >= 95 ? "warn" : "bad"}
                  />
                  <CoverageStat
                    label="Days covered"
                    value={`${spanDays - missingDays} / ${spanDays}`}
                    tone={missingDays === 0 ? "good" : "warn"}
                  />
                  <CoverageStat
                    label="Dropouts"
                    value={dropoutCount.toLocaleString()}
                    tone={dropoutCount === 0 ? "good" : dropoutCount <= 50 ? "warn" : "bad"}
                  />
                  <CoverageStat
                    label="Cadence"
                    value={`${effectiveStep}s`}
                    tone={effectiveStep <= requestedStep ? "good" : "warn"}
                  />
                </div>

                {effectiveStep !== requestedStep ? (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700">
                    Source delivers frames every{" "}
                    <span className="font-semibold tabular-nums">{effectiveStep}s</span>, not the
                    requested {requestedStep}s — completeness is measured against the observed{" "}
                    {effectiveStep}s cadence. Largest gap: {maxGapMin} min.
                  </p>
                ) : null}

                {/* Calendar heatmap of daily completeness */}
                <CoverageCalendar days={perDay} expectedPerDay={expectedPerDay} />

                {/* Per-day frame volume */}
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Frames per day (expected {expectedPerDay.toLocaleString()} @ {effectiveStep}s)
                  </p>
                  <ChartContainer config={coverageConfig} className="h-40 w-full">
                    <BarChart data={perDay} margin={{ left: 4, right: 4, top: 8 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={11} tickLine={false} />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} width={48} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="count" fill="var(--color-count)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Job history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ingestion jobs</CardTitle>
          <CardDescription>Recent backfill runs and their outcomes.</CardDescription>
        </CardHeader>
        <CardContent>
          {!jobs || jobs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No ingestion jobs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Range</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead className="text-right">Frames</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-mono text-xs">
                      {new Date(job.fromTs).toISOString().slice(0, 10)} →{" "}
                      {new Date(job.toTs).toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-xs">{job.stepSeconds}s</TableCell>
                    <TableCell className="text-right tabular-nums">{job.framesIngested.toLocaleString()}</TableCell>
                    <TableCell>
                      <JobBadge status={job.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(job.startedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </LabPageShell>
  )
}

function CoverageStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "good" | "warn" | "bad"
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : "text-red-600"
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  )
}

function JobStatusCard({ job }: { job: IngestionJobRow }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Job #{job.id}</span>
        <JobBadge status={job.status} />
      </div>
      <div className="mt-1 text-sm tabular-nums">
        {job.framesIngested.toLocaleString()} frames ingested
      </div>
      {job.error ? <p className="mt-1 text-xs text-red-600">{job.error}</p> : null}
    </div>
  )
}

function JobBadge({ status }: { status: string }) {
  if (status === "done") {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
        <CheckCircle2 className="size-3" /> done
      </Badge>
    )
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" className="gap-1">
        <CircleAlert className="size-3" /> error
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 border-sky-500/40 text-sky-600">
      <Loader2 className="size-3 animate-spin" /> running
    </Badge>
  )
}
