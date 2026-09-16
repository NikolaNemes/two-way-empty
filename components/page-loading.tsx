"use client"

import { TelemetryLoader } from "@/components/prototype/telemetry-loader"

/**
 * Route-level loading fallback shared by every page's `loading.tsx`.
 *
 * Renders the single branded app loader (same component used by the report
 * screens and the live telemetry card) so navigation shows ONE consistent,
 * advanced loader everywhere instead of a grab-bag of skeletons and plain
 * "Loading…" text. The loader shows a real percentage when a data pipeline is
 * active and an honest elapsed-time progress bar during route transitions.
 */
export function PageLoading({
  title = "Loading",
  subtitle = "Preparing the view",
}: {
  title?: string
  subtitle?: string
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-4 md:p-6">
      <TelemetryLoader
        mode="historical"
        title={title}
        subtitle={subtitle}
        endpoint="loading route bundle"
        footer="Loading"
        className="w-full max-w-md"
      />
    </div>
  )
}
