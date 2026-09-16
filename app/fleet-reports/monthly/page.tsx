import type { Metadata } from "next"
import { getLiveFleetMonthlyReport } from "@/app/actions/live-fleet-monthly"
import { getCurrentUser } from "@/lib/auth"
import { LiveFleetMonthlyScreen } from "@/components/portfolio/live-fleet-monthly-screen"

export const metadata: Metadata = {
  title: "Fleet Monthly Report | Amperio Dispatch",
  description: "Real fleet monthly settlement — measured telemetry from live stations only.",
}

export const dynamic = "force-dynamic"

export default async function LiveFleetMonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const [report, user, { month }] = await Promise.all([getLiveFleetMonthlyReport(), getCurrentUser(), searchParams])
  return (
    <LiveFleetMonthlyScreen
      report={report}
      isAdmin={user?.role === "admin"}
      initialMonth={month && /^\d{4}-\d{2}$/.test(month) ? month : undefined}
    />
  )
}
