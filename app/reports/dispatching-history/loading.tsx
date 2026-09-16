import { TelemetryLoader } from "@/components/prototype/telemetry-loader"

// Route-level fallback while the (client-heavy) Dispatching History screen —
// calendar picker + telemetry chart bundle — streams in. Uses the same branded
// loader as the Live Bird's-Eye View so navigation shows a consistent loader
// instead of a blank delay before the range picker appears.
export default function Loading() {
  return (
    <div className="w-full px-4 py-6 lg:px-6">
      <TelemetryLoader
        mode="historical"
        title="Loading Dispatching History"
        subtitle="Preparing the metered telemetry view"
      />
    </div>
  )
}
