import type { Metadata } from "next"
import { FinancialBreakdownPage } from "@/components/reports/financial-breakdown-page"

export const metadata: Metadata = {
  title: "Financial Report | Amperio Dispatch",
  description: "Flat vs dynamic tariff settlement of the metered grid import — same engine as the Fleet reports.",
}

export const dynamic = "force-dynamic"

/**
 * Server shell: reads the optional `?from=&to=` deep link (a Fleet Monthly row
 * opening its Financial Report) and hands it to the client page. `?stationId=`
 * is consumed by the station context provider.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const { from, to } = await searchParams
  return <FinancialBreakdownPage initialFrom={from} initialTo={to} />
}
