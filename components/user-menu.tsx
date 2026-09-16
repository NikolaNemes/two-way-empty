"use client"

import Link from "next/link"
import { useUser, useClerk } from "@clerk/nextjs"
import { ChevronDown, LogOut, ShieldCheck, UserCog } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function initialsFrom(name: string | null | undefined, email: string | null | undefined) {
  const src = (name ?? "").trim()
  if (src) {
    const parts = src.split(/\s+/)
    const first = parts[0]?.[0] ?? ""
    const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : ""
    return (first + last).toUpperCase()
  }
  return (email ?? "?").slice(0, 2).toUpperCase()
}

/**
 * Redesigned account widget for the global top bar (replaces the old
 * sidebar-footer Clerk UserButton). Purely cosmetic — the real security
 * boundary is server-side (proxy.ts + the /admin layout + requireAdmin()).
 * The admin role shown here is read from client-readable publicMetadata.
 */
export function UserMenu() {
  const { user, isLoaded } = useUser()
  const { signOut, openUserProfile } = useClerk()

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="hidden h-8 w-24 rounded-md sm:block" />
      </div>
    )
  }
  if (!user) return null

  const name = user.fullName
  const email = user.primaryEmailAddress?.emailAddress ?? null
  const role = (user.publicMetadata as { role?: string } | undefined)?.role
  const isAdmin = role === "admin"
  const initials = initialsFrom(name, email)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open account menu"
          className="flex items-center gap-2 rounded-full border border-border/60 bg-background/60 py-1 pl-1 pr-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="size-7">
            <AvatarImage src={user.imageUrl || "/placeholder.svg"} alt={name ?? email ?? "User"} />
            <AvatarFallback className="bg-primary text-[11px] font-semibold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 flex-col leading-tight sm:flex">
            <span className="max-w-[9rem] truncate text-xs font-medium text-foreground">
              {name ?? email ?? "Account"}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {isAdmin ? "Admin" : "User"}
            </span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
          <Avatar className="size-9">
            <AvatarImage src={user.imageUrl || "/placeholder.svg"} alt={name ?? email ?? "User"} />
            <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{name ?? "Account"}</p>
            {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
          </div>
        </DropdownMenuLabel>

        <div className="px-2 pb-1.5">
          <Badge variant={isAdmin ? "default" : "secondary"} className="gap-1 text-[10px] uppercase tracking-wide">
            {isAdmin ? <ShieldCheck className="size-3" /> : null}
            {isAdmin ? "Administrator" : "Standard user"}
          </Badge>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => openUserProfile()}>
          <UserCog className="size-4" />
          Manage account
        </DropdownMenuItem>

        {isAdmin ? (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <ShieldCheck className="size-4" />
              Administration
            </Link>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onSelect={() => signOut({ redirectUrl: "/sign-in" })}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
