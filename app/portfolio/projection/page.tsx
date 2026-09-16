import type { Metadata } from "next"
import { FleetProjectionScreen } from "@/components/portfolio/fleet-projection-screen"

export const metadata: Metadata = {
  title: "Fleet Monthly Report — historical simulation",
  description:
    "Pick a historical month and see what the entire fleet would have earned had every location run the Gronau dispatching system: flat vs IDM procurement per location, load shifting net of battery wear, priced with real IDM history.",
}

export default function FleetProjectionPage() {
  return <FleetProjectionScreen />
}
