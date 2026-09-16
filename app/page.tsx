import { redirect } from "next/navigation"

// Fleet Overview is the landing page: the operator's first question is
// "what state is my fleet in?", answered by the status tiers + SOC clusters.
export default function HomePage() {
  redirect("/fleet")
}
