"use client"

import { useSimulation } from "@/lib/simulation-store"
import { AlertTriangle, Play } from "lucide-react"
import { Button } from "@/components/ui/button"

export function StaleSimulationBanner() {
  const { isStale, runSimulation } = useSimulation()

  if (!isStale) return null

  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <AlertTriangle className="size-4 text-primary shrink-0" />
      <p className="text-sm text-foreground flex-1">
        <span className="font-semibold">Parameters changed.</span>{" "}
        <span className="text-muted-foreground">Results below are from the previous run. Click to recalculate.</span>
      </p>
      <Button size="sm" onClick={runSimulation} className="gap-1.5 shrink-0">
        <Play className="size-3" />
        Run Simulation
      </Button>
    </div>
  )
}
