"use client"

import { usePathname } from "next/navigation"
import { SimulationProvider } from "@/lib/simulation-store"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { MobileHeader } from "@/components/mobile-header"
import { AppTopbar } from "@/components/app-topbar"
import { StationProvider } from "@/components/station-context"

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // Auth pages render full-bleed (enexa-branded, no product chrome): the
  // sidebar tree also fires station/fleet fetches that would 401 before
  // sign-in, so it must not mount at all here.
  if (
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    // Post-activation confirmation — same full-bleed auth-shell treatment.
    pathname.startsWith("/welcome")
  ) {
    return <>{children}</>
  }

  return (
    <StationProvider>
      <SimulationProvider>
        <SidebarProvider style={{ "--sidebar-width": "18rem" } as React.CSSProperties}>
          <AppSidebar />
          <SidebarInset>
            <MobileHeader />
            <AppTopbar />
            {children}
          </SidebarInset>
        </SidebarProvider>
      </SimulationProvider>
    </StationProvider>
  )
}
