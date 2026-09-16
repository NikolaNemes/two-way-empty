"use client"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { PageHeader } from "@/components/page-header"
import { ArrowDownToLine, Info } from "lucide-react"

// ── Main Screen ──
export function GridPricingScreen() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Import From Grid"
        description="Actual grid import data -- will be populated by simulation results"
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex w-full flex-col gap-6">
          <Card className="border-dashed">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10">
                  <ArrowDownToLine className="size-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Grid Import Data</CardTitle>
                  <CardDescription>
                    Awaiting BMS/EMS simulation results
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center gap-4 py-12 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                  <Info className="size-5 text-muted-foreground" />
                </div>
                <div className="max-w-md">
                  <p className="text-sm font-medium text-foreground">
                    No simulation data yet
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    This page will show the actual grid import profile once the BMS/EMS
                    simulation is run. It will include minute-by-minute grid draw, 15-min
                    demand peaks, energy sourcing breakdown (grid vs battery vs PV), and
                    cost allocation based on the pricing model configured in the{" "}
                    <strong>Price Breakdown</strong> page.
                  </p>
                </div>
                <div className="mt-4 grid gap-3 text-left w-full max-w-sm">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs font-medium text-foreground">What will appear here:</p>
                    <ul className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
                      <li>1-min grid import profile (15-min chart aggregation)</li>
                      <li>Peak 15-min demand for Leistungspreis calculation</li>
                      <li>Grid vs battery vs PV sourcing per interval</li>
                      <li>Actual procurement cost per kWh delivered</li>
                      <li>Demand charge impact from peak grid draw</li>
                    </ul>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
