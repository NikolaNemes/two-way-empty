"use client"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { UserMenu } from "@/components/user-menu"

/**
 * Global desktop top bar. Renders once (in the AppShell) so the account menu
 * is pinned top-right on EVERY page — not just the ~18 pages that opt into
 * PageHeader. Hidden on mobile, where MobileHeader carries the same UserMenu.
 * PageHeader sticks at top-14 so it stacks cleanly beneath this h-14 bar.
 */
export function AppTopbar() {
  return (
    <header className="sticky top-0 z-30 hidden h-14 items-center gap-2 border-b border-border bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:flex">
      <SidebarTrigger className="-ml-1 shrink-0" />
      <Separator orientation="vertical" className="h-5" />
      <div className="ml-auto flex items-center">
        <UserMenu />
      </div>
    </header>
  )
}
