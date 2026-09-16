import type { Metadata } from "next"
import { getFleetYearlyReport } from "@/app/actions/fleet-yearly"
import { FleetYearlyScreen } from "@/components/portfolio/fleet-yearly-screen"

export const metadata: Metadata = {
  title: "Fleet Yearly Report — real stations, measured telemetry",
  description:
    "Yearly fleet settlement computed ONLY from real station telemetry (Gronau, Norderstedt, Gifhorn) — no simulation, no historical twins. With Excel export.",
}

// Rows are refreshed by /api/cron/fleet-report — always render fresh.
export const dynamic = "force-dynamic"

export default async function LiveFleetYearlyPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  // Period comes from the shared from–to picker (?from=YYYY-MM&to=YYYY-MM);
  // the action clamps it to the dataset's history, so no validation here.
  const { from, to } = await searchParams
  const report = await getFleetYearlyReport({ dataset: "live", fromMonth: from, toMonth: to })
  return <FleetYearlyScreen report={report} dataset="live" />
}
