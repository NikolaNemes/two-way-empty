import { IngestionScreen } from "@/components/lab/ingestion-screen"

export const metadata = {
  title: "Telemetry Ingestion · Enexa Lab",
  description: "Backfill historical telemetry frames into Neon for training and backtests.",
}

export default function IngestionPage() {
  return <IngestionScreen />
}
