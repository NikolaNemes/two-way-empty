import { StationsAdmin } from "@/components/stations/stations-admin"

export const metadata = {
  title: "Stations — Enexa Dispatch",
  description: "Location registry: physical and commercial parameters per Chargepost station.",
}

export default function StationsPage() {
  return <StationsAdmin />
}
