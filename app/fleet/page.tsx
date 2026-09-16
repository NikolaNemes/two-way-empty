import type { Metadata } from "next"
import { FleetOverview } from "@/components/fleet/fleet-overview"

export const metadata: Metadata = {
  title: "Fleet Overview — Enexa",
  description: "All dispatch locations at a glance: live status, SOC, and plan intent per station.",
}

export default function FleetPage() {
  return <FleetOverview />
}
