import type { Metadata } from "next"
import { getFleetYearlyReport } from "@/app/actions/fleet-yearly"
import { FleetYearlyScreen } from "@/components/portfolio/fleet-yearly-screen"

export const metadata: Metadata = {
  title: "Fleet Yearly Report — pre-computed 12-month view",
  description:
    "Twelve months of Fleet Monthly Report results served from a pre-computed table (no on-the-fly simulation), with Excel export.",
}

// The table is refreshed nightly by /api/cron/fleet-report — always render fresh.
export const dynamic = "force-dynamic"

export default async function FleetYearlyPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  // Period comes from the shared from–to picker (?from=YYYY-MM&to=YYYY-MM);
  // the action clamps it to the dataset's history, so no validation here.
  const { from, to } = await searchParams
  const report = await getFleetYearlyReport({ fromMonth: from, toMonth: to })
  return <FleetYearlyScreen report={report} />
}
