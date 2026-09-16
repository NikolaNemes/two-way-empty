import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { getPriceAnalysisAction } from "@/app/actions/price-analysis"
import { PriceAnalysisScreen } from "@/components/portfolio/price-analysis-screen"

export const metadata: Metadata = {
  title: "Price Analysis — dynamic tariff vs flat",
  description:
    "Day-by-day IDM price analysis vs the fleet's flat rate: favorable, headwind and guaranteed-loss days, with actual archive euros where volumes exist.",
}

export const dynamic = "force-dynamic"

export default async function PriceAnalysisPage() {
  // Admin-only (client request aug 25 2026): Amperio users get the "user"
  // role and must not see tariff/price internals. Server-side gate — the
  // hidden sidebar item alone is cosmetic.
  const user = await getCurrentUser()
  if (user?.role !== "admin") redirect("/")
  const analysis = await getPriceAnalysisAction()
  return <PriceAnalysisScreen analysis={analysis} />
}
