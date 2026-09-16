import type { ReactNode } from "react"
import { PrototypeTelemetryProvider } from "@/lib/prototype-telemetry-context"
import { TelemetryLayoutShell } from "@/components/prototype/telemetry-layout-shell"

export default function TelemetryLayout({ children }: { children: ReactNode }) {
  return (
    <PrototypeTelemetryProvider>
      <TelemetryLayoutShell>{children}</TelemetryLayoutShell>
    </PrototypeTelemetryProvider>
  )
}
