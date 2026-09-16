"use client"

import { Menu, PlugZap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { UserMenu } from "@/components/user-menu"

/**
 * A persistent header shown only on mobile (md:hidden) providing access to the
 * sidebar via a hamburger menu button. Sits at the top of every page so users
 * always have a way to open navigation.
 */
export function MobileHeader() {
  const { toggleSidebar } = useSidebar()

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
      <Button
        variant="ghost"
        size="icon"
        className="size-9 shrink-0"
        onClick={toggleSidebar}
        aria-label="Open navigation menu"
      >
        <Menu className="size-5" />
      </Button>

      <div className="flex items-center gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm">
          <PlugZap className="size-4 text-primary-foreground" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight">Enexa</span>
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
            Amperio
          </span>
        </div>
      </div>

      <div className="ml-auto flex items-center">
        <UserMenu />
      </div>
    </header>
  )
}
