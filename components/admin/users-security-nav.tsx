"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { useUser } from "@clerk/nextjs"
import useSWR from "swr"
import {
  ChevronDown,
  KeyRound,
  MailPlus,
  MonitorSmartphone,
  ShieldCheck,
  UserRoundPlus,
  Users,
} from "lucide-react"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { getPendingRequestCount } from "@/app/actions/access-requests"

/**
 * Admin-only "Users & Security" sidebar section, deep-linking into the /admin
 * tabs. Visibility here is COSMETIC (client-side role from Clerk's cached
 * user) — the real boundary is the proxy + /admin layout + requireAdmin() on
 * every action. The Access-requests item badges the live pending count so an
 * admin notices new requests without leaving whatever they're doing.
 */
const NAV_ITEMS = [
  { title: "Users", tab: "users", icon: Users, description: "Roles, bans, deletion" },
  { title: "Access requests", tab: "requests", icon: UserRoundPlus, description: "Approve or deny new sign-ins" },
  { title: "Invitations", tab: "invitations", icon: MailPlus, description: "Invite-first onboarding" },
  { title: "Sessions", tab: "sessions", icon: MonitorSmartphone, description: "Active devices, instant kick" },
  { title: "Sign-in methods", tab: "signin", icon: KeyRound, description: "SSO & instance settings" },
] as const

function UsersSecurityNavInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { setOpenMobile } = useSidebar()
  const { user, isLoaded } = useUser()

  const isAdmin = isLoaded && (user?.publicMetadata as { role?: string } | undefined)?.role === "admin"

  // Poll the pending count ONLY for admins (server re-verifies anyway).
  const { data: pendingCount } = useSWR(
    isAdmin ? "pending-request-count" : null,
    () => getPendingRequestCount().catch(() => 0),
    { refreshInterval: 60_000, revalidateOnFocus: true },
  )

  if (!isAdmin) return null

  const activeTab = pathname === "/admin" ? (searchParams.get("tab") ?? "users") : null
  const count = pendingCount ?? 0

  return (
    <Collapsible defaultOpen className="group/users-security">
      <SidebarGroup>
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 font-semibold px-3 flex items-center gap-1.5 cursor-pointer hover:text-sidebar-foreground/60 transition-colors">
            <ShieldCheck className="size-3 text-violet-500" />
            Users &amp; Security
            {count > 0 ? (
              <span
                aria-label={`${count} pending access request${count === 1 ? "" : "s"}`}
                className="inline-block size-1.5 rounded-full bg-destructive"
              />
            ) : null}
            <ChevronDown className="ml-auto size-3.5 transition-transform duration-200 group-data-[state=open]/users-security:rotate-180" />
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const href = `/admin?tab=${item.tab}`
                const isActive = activeTab === item.tab
                const showBadge = item.tab === "requests" && count > 0
                return (
                  <SidebarMenuItem key={item.tab}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={`${item.title} -- ${item.description}`}
                      className="h-auto py-2"
                    >
                      <Link href={href} onClick={() => setOpenMobile(false)}>
                        <item.icon className="size-4 shrink-0" />
                        <div className="flex flex-1 flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
                          <span className="flex items-center gap-1.5 text-sm leading-none font-medium">
                            {item.title}
                            {showBadge ? (
                              <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
                                {count}
                              </span>
                            ) : null}
                          </span>
                          <span className="text-[11px] leading-tight text-sidebar-foreground/50 font-normal">
                            {item.description}
                          </span>
                        </div>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

export function UsersSecurityNav() {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <UsersSecurityNavInner />
    </Suspense>
  )
}
