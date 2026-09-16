import { BacktestLabScreen } from "@/components/lab/backtest-lab-screen"

export const metadata = {
  title: "Backtest Lab · Enexa Lab",
  description: "Replay and compare dispatch model versions over stored telemetry.",
}

// Backtest server actions run as POST requests to this route, so the route's
// duration limit governs them. A month-long optimizer run does ~2,880 LP solves
// (~40s); raise the cap well above the platform default so it isn't killed.
export const maxDuration = 300

export default function BacktestPage() {
  return <BacktestLabScreen />
}
