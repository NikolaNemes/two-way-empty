"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useUser } from "@clerk/nextjs"
import { ADVANCED_VISIBLE_EVENT, ADVANCED_VISIBLE_STORAGE_KEY } from "@/hooks/use-advanced-visible"
import Link from "next/link"
import {
  PlugZap,
  AlertTriangle,
  BookOpen,
  Settings2,
  FileText,
  LayoutGrid,
  MapPin,
  Cable,
  ChevronDown,
  Database,
  BookMarked,
  Target,
  Activity,
  Zap,
  CheckCircle2,
  Gauge,
  Cpu,
  Play,
  BarChart3,
  Radio,
  Microscope,
  FlaskConical,
  History,
  Receipt,
  TrendingDown,
  CalendarRange,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { StationSwitcher } from "@/components/station-switcher"
import { UsersSecurityNav } from "@/components/admin/users-security-nav"

type NavItem = {
  title: string
  href: string
  icon: typeof BookOpen
  description: string
}

// Fleet — multi-location: overview of all stations + the registry admin.
const fleetItems: NavItem[] = [
  {
    title: "Fleet Overview",
    href: "/fleet",
    icon: LayoutGrid,
    description: "All locations at a glance",
  },
  {
  title: "Stations",
  href: "/stations",
  icon: MapPin,
  description: "Location registry & parameters",
  },
  {
    title: "Fleet Monthly Report",
    href: "/fleet-reports/monthly",
    icon: TrendingDown,
    description: "Real stations, measured telemetry",
  },
  {
    title: "Fleet Yearly Report",
    href: "/fleet-reports/yearly",
    icon: CalendarRange,
    description: "Real fleet settlement + Excel export",
  },
]

// History Analysis — the hist_* archive-twin simulation dataset. Kept fully
// separate from the real fleet reports above; the two are NEVER combined.
const historyAnalysisItems: NavItem[] = [
  {
    title: "Fleet Monthly Report",
    href: "/portfolio/projection",
    icon: TrendingDown,
    description: "Historical simulation with Gronau dispatching",
  },
  {
    title: "Fleet Yearly Report",
    href: "/portfolio/yearly",
    icon: CalendarRange,
    description: "Pre-computed 12-month table + Excel export",
  },
  {
    title: "Price Analysis",
    href: "/portfolio/prices",
    icon: BarChart3,
    description: "Dynamic vs flat: favorable / headwind / loss days",
  },
]

const pilotScopeItems: NavItem[] = [
  {
    title: "Pilot Scope",
    href: "/pilot-scope",
    icon: Target,
    description: "What's in-scope for the pilot",
  },
  {
    title: "Optimization Engine",
    href: "/optimization-engine",
    icon: Cpu,
    description: "How the optimizer works",
  },
]

const solutionOverviewItems: NavItem[] = [
  {
    title: "Solution Overview",
    href: "/overview",
    icon: BookOpen,
    description: "Architecture & responsibilities",
  },
  {
    title: "Onboarding & Deployment",
    href: "/onboarding-config",
    icon: Settings2,
    description: "Site setup process",
  },
  {
    title: "Communication",
    href: "/comm-architecture",
    icon: Cable,
    description: "API integration patterns",
  },
  {
    title: "ChargePost Control Explained",
    href: "/chargepost-control",
    icon: Gauge,
    description: "How v1 levers achieve load shifting",
  },
  {
    title: "Exception Handling",
    href: "/exception-handling",
    icon: AlertTriangle,
    description: "Fallbacks & failure scenarios",
  },
]

// Order: Live Dispatching (today's real-time dispatch) is the landing view and
// sits topmost, followed by the live bird's-eye view + command stream, then the
// Dispatching Plan beneath its Live Commands Stack, and the analysis views last.
const prototypeItems: NavItem[] = [
  {
    title: "Live Dispatching",
    href: "/prototype/telemetry/day-sim",
    icon: Play,
    description: "Today's real-time dispatch view",
  },
  {
    title: "Live Birds-Eye View",
    href: "/prototype/telemetry",
    icon: Activity,
    description: "Bird-eye live state of the site",
  },
  {
    title: "Commands",
    href: "/prototype/telemetry/commands",
    icon: Zap,
    description: "Live dispatch stack & status loop",
  },
  {
    title: "Live Commands Stack",
    href: "/live-commands",
    icon: Zap,
    description: "Committed commands sent to Amperio",
  },
  {
    title: "Dispatching Plan",
    href: "/dispatcher-status",
    icon: Radio,
    description: "Live worker heartbeat & dispatch plan",
  },
  {
    title: "Live Test Plan",
    href: "/live-test",
    icon: FlaskConical,
    description: "Today's deliberate-scenario run sheet",
  },
  {
    title: "Data Analysis",
    href: "/prototype/telemetry/data-analysis",
    icon: BarChart3,
    description: "Historical backtest & optimizer comparison",
  },
]

// Reports — historical & financial reporting. "Dispatching Replay" is the former
// Backtesting walk-forward engine sim, relocated and renamed here.
const reportsItems: NavItem[] = [
  {
    title: "Dispatching History",
    href: "/reports/dispatching-history",
    icon: History,
    description: "Past dispatch decisions & outcomes",
  },
  {
    title: "Dispatching Replay",
    href: "/reports/dispatching-replay",
    icon: Cpu,
    description: "Walk-forward engine sim on telemetry",
  },
  {
  title: "Financial Report",
  href: "/reports/financial-breakdown",
  icon: Receipt,
  description: "Cost, savings & load shifting accounting",
  },
  {
  title: "Settlement Methodology",
  href: "/reports/settlement-methodology",
  icon: FileText,
  description: "Printable contract annex — margin calculation",
  },
  ]

const modelLabItems: NavItem[] = [
  {
    title: "Model Registry",
    href: "/lab/models",
    icon: BookMarked,
    description: "Single optimizer engine & parameterisations",
  },
  {
    title: "Telemetry Ingestion",
    href: "/lab/ingestion",
    icon: Database,
    description: "Backfill frames into Neon",
  },
  {
    title: "Dataset Explorer",
    href: "/lab/dataset",
    icon: BarChart3,
    description: "Stored frames & data quality",
  },
  {
    title: "Backtest Lab",
    href: "/lab/backtest",
    icon: Microscope,
    description: "Replay & compare model versions",
  },
]

const apiSpecificationsItems: NavItem[] = [
  {
    title: "General API",
    href: "/middleware-api",
    icon: FileText,
    description: "Shared context, taxonomy, Modbus",
  },
  {
    title: "Telemetry API",
    href: "/telemetry-api",
    icon: Activity,
    description: "Middleware → Enexa uplink",
  },
  {
    title: "Dispatching API",
    href: "/dispatching-api",
    icon: Zap,
    description: "Enexa → Middleware commands",
  },
  {
    title: "Command Status API",
    href: "/command-status-api",
    icon: CheckCircle2,
    description: "Per-event dispatch feedback",
  },
  {
    title: "Config API",
    href: "/config-api",
    icon: Database,
    description: "Master data pulled from Enexa",
  },
  {
    title: "API Repository",
    href: "/api-repository",
    icon: BookMarked,
    description: "Swagger-like endpoint catalogue",
  },
]

// Easter-egg gated routes: hidden by default, shown only after the user
// double-clicks the Enexa logo (advancedVisible). Settlement Methodology is a
// contract-annex document — internal until formalized with Amperio.
const HIDDEN_NAV_HREFS = [
  "/chargepost-control",
  "/reports/dispatching-replay",
  "/reports/settlement-methodology",
]

// Easter-egg gating: when advanced items are hidden (default), ONLY these core
// operational views are shown anywhere in the sidebar. Everything else
// (Pilot, Solution Overview, Model Lab, API Specifications, and the remaining
// Prototype items) stays hidden until the user double-clicks the Enexa logo.
const CORE_VISIBLE_HREFS = [
  "/prototype/telemetry/day-sim", // Live Dispatching (landing)
  "/prototype/telemetry", // Live Birds-Eye View
  "/dispatcher-status", // Dispatching Plan
  "/live-commands", // Live Commands Stack
]
// Storage key is versioned so stale "true" values from earlier builds are
// ignored -- advanced items must be hidden-by-default on a fresh page load.
const HIDDEN_NAV_STORAGE_KEY = ADVANCED_VISIBLE_STORAGE_KEY
const HIDDEN_NAV_LEGACY_KEYS = ["enexa.nav.advancedVisible"]

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { setOpenMobile } = useSidebar()
  const { user, isLoaded } = useUser()

  // Double-click the Enexa logo to toggle advanced items (ChargePost Control
  // Explained, Dispatching API v2). Preference persists in localStorage.
  const [advancedVisible, setAdvancedVisible] = useState(false)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    try {
      // Purge legacy keys from older builds so they can never re-reveal the
      // advanced items without an explicit double-click.
      for (const legacy of HIDDEN_NAV_LEGACY_KEYS) {
        window.localStorage.removeItem(legacy)
      }
      const saved = window.localStorage.getItem(HIDDEN_NAV_STORAGE_KEY)
      if (saved === "true") setAdvancedVisible(true)
    } catch {
      // localStorage unavailable (private mode, SSR edge) -- stay hidden.
    }
  }, [])

  // Deliberately no auto-reveal when landing on a hidden route: the user
  // asked for the items to be hidden until they explicitly double-click the
  // Enexa logo. A stale pathname must not override that intent.

  const handleLogoClick = (e: React.MouseEvent) => {
    // Custom single-vs-double click handling: we need the single click to
    // navigate home AND the double click to toggle advanced items. Using a
    // short debounce distinguishes the two without layering odd prevent-
    // default tricks on top of <Link>.
    e.preventDefault()
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      setAdvancedVisible((prev) => {
        const next = !prev
        try {
          window.localStorage.setItem(HIDDEN_NAV_STORAGE_KEY, String(next))
          // Same-tab consumers (e.g. the report���s load shifting strip) can't see
          // localStorage writes — notify them explicitly.
          window.dispatchEvent(new Event(ADVANCED_VISIBLE_EVENT))
        } catch {
          // ignore
        }
        return next
      })
      return
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      setOpenMobile(false)
      router.push("/")
    }, 220)
  }

  const visibleSolutionOverviewItems = advancedVisible
    ? solutionOverviewItems
    : solutionOverviewItems.filter((i) => !HIDDEN_NAV_HREFS.includes(i.href))

  const visibleApiSpecificationsItems = advancedVisible
    ? apiSpecificationsItems
    : apiSpecificationsItems.filter((i) => !HIDDEN_NAV_HREFS.includes(i.href))

  // Reports: History & Financial are always visible; Dispatching Replay is
  // gated behind the logo double-click easter egg via HIDDEN_NAV_HREFS.
  const visibleReportsItems = advancedVisible
    ? reportsItems
    : reportsItems.filter((i) => !HIDDEN_NAV_HREFS.includes(i.href))

  // Price Analysis is ADMIN-ONLY (client request aug 25 2026): Amperio users
  // get the "user" role and must not see tariff/price internals. Hiding here
  // is cosmetic — the page, the server action, and the xlsx route all
  // re-verify the role server-side. (Now lives in the History Analysis group.)
  const isAdmin = isLoaded && (user?.publicMetadata as { role?: string } | undefined)?.role === "admin"
  const visibleFleetItems = fleetItems
  const visibleHistoryItems = isAdmin
    ? historyAnalysisItems
    : historyAnalysisItems.filter((i) => i.href !== "/portfolio/prices")

  // When hidden, the Prototype group is trimmed to the four core views (kept in
  // their original order); when revealed, all prototype items are shown.
  const visiblePrototypeItems = advancedVisible
    ? prototypeItems
    : prototypeItems.filter((i) => CORE_VISIBLE_HREFS.includes(i.href))

  const renderNavItem = (item: NavItem) => {
    const isActive = pathname === item.href
    return (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip={`${item.title} -- ${item.description}`}
          className="h-auto py-2"
        >
          <Link href={item.href} onClick={() => setOpenMobile(false)}>
            <item.icon className="size-4 shrink-0" />
            <div className="flex flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
              <span className="text-sm leading-none font-medium">{item.title}</span>
              <span className="text-[11px] leading-tight text-sidebar-foreground/50 font-normal">{item.description}</span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="px-4 py-5">
        <button
          type="button"
          onClick={handleLogoClick}
          aria-label={
            advancedVisible
              ? "Enexa — go home (double-click to hide all but the core views)"
              : "Enexa — go home (double-click to reveal all menu items)"
          }
          title={
            advancedVisible
              ? "Double-click to hide all but the core views"
              : "Double-click to reveal all menu items"
          }
          className="flex w-full items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:justify-center select-none text-left"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm">
            <PlugZap className="size-5 text-primary-foreground" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-base font-semibold tracking-tight text-sidebar-foreground">
              Enexa
            </span>
            <span className="text-[10px] uppercase tracking-widest text-sidebar-foreground/50 font-medium">
              Amperio Integration
            </span>
          </div>
        </button>
      </SidebarHeader>

      <SidebarSeparator className="opacity-60" />

      <SidebarContent className="px-1">
        <Collapsible defaultOpen className="group/fleet">
          <SidebarGroup>
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 font-semibold px-3 flex items-center gap-1.5 cursor-pointer hover:text-sidebar-foreground/60 transition-colors">
                <span className="inline-block size-1.5 rounded-full bg-sky-500" />
                Fleet
                <ChevronDown className="ml-auto size-3.5 transition-transform duration-200 group-data-[state=open]/fleet:rotate-180" />
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleFleetItems.map(renderNavItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>

        {advancedVisible ? (
          <Collapsible defaultOpen className="group/pilot-scope">
            <SidebarGroup>
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 font-semibold px-3 flex items-center gap-1.5 cursor-pointer hover:text-sidebar-foreground/60 transition-colors">
                  <span className="inline-block size-1.5 rounded-full bg-amber-500" />
                  Pilot
                  <ChevronDown className="ml-auto size-3.5 transition-transform duration-200 group-data-[state=open]/pilot-scope:rotate-180" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {pilotScopeItems.map(renderNavItem)}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ) : null}

        {advancedVisible ? (
        <Collapsible defaultOpen className="group/solution-overview">
          <SidebarGroup>
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 font-semibold px-3 flex items-center gap-1.5 cursor-pointer hover:text-sidebar-foreground/60 transition-colors">
                <span className="inline-block size-1.5 rounded-full bg-orange-500" />
                Solution Overview
                <ChevronDown className="ml-auto size-3.5 transition-transform duration-200 group-data-[state=open]/solution-overview:rotate-180" />
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleSolutionOverviewItems.map(renderNavItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
        ) : null}

        {/* ── LOCATION CONTEXT ─────────────────────────────────────────────
            Everything below the picker is scoped to the SELECTED location.
            Monitoring & Reports are visually nested (left rail + indent) under
            the switcher card so the hierarchy reads: global fleet pages above,
            one location's live views + reports below. */}
        <div className="mt-1 px-2 group-data-[collapsible=icon]:hidden">
          <StationSwitcher />
        </div>
        <div className="ml-4 border-l border-sidebar-border/70 pl-1 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:border-l-0 group-data-[collapsible=icon]:pl-0">
          <Collapsible defaultOpen className="group/prototype">
            <SidebarGroup>
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 font-semibold px-3 flex items-center gap-1.5 cursor-pointer hover:text-sidebar-foreground/60 transition-colors">
                  <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
                  Monitoring
                  <ChevronDown className="ml-auto size-3.5 transition-transform duration-200 group-data-[state=open]/prototype:rotate-180" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visiblePrototypeItems.map(renderNavItem)}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>

          <Collapsible defaultOpen className="group/reports">
            <SidebarGroup>
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 font-semibold px-3 flex items-center gap-1.5 cursor-pointer hover:text-sidebar-foreground/60 transition-colors">
                  <span className="inline-block size-1.5 rounded-full bg-rose-500" />
                  Reports
                  <ChevronDown className="ml-auto size-3.5 transition-transform duration-200 group-data-[state=open]/reports:rotate-180" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleReportsItems.map(renderNavItem)}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        </div>

        {/* ── HISTORY ANALYSIS ─────────────────────────────────────────────
            The hist_* archive-twin simulation dataset (Gronau anchor +
            capture scaling). Fully separate from the real fleet reports in
            the Fleet group above — the two datasets are NEVER combined. */}
        <Collapsible defaultOpen className="group/history">
          <SidebarGroup>
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 font-semibold px-3 flex items-center gap-1.5 cursor-pointer hover:text-sidebar-foreground/60 transition-colors">
                <History className="size-3 text-violet-500" />
                History Analysis
                <ChevronDown className="ml-auto size-3.5 transition-transform duration-200 group-data-[state=open]/history:rotate-180" />
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleHistoryItems.map(renderNavItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>

        {advancedVisible ? (
          <Collapsible defaultOpen className="group/model-lab">
            <SidebarGroup>
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 font-semibold px-3 flex items-center gap-1.5 cursor-pointer hover:text-sidebar-foreground/60 transition-colors">
                  <FlaskConical className="size-3 text-teal-500" />
                  Model Lab
                  <ChevronDown className="ml-auto size-3.5 transition-transform duration-200 group-data-[state=open]/model-lab:rotate-180" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {modelLabItems.map(renderNavItem)}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ) : null}

        {advancedVisible ? (
          <Collapsible defaultOpen className="group/api-specifications">
            <SidebarGroup>
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 font-semibold px-3 flex items-center gap-1.5 cursor-pointer hover:text-sidebar-foreground/60 transition-colors">
                  <span className="inline-block size-1.5 rounded-full bg-sky-500" />
                  API Specifications
                  <ChevronDown className="ml-auto size-3.5 transition-transform duration-200 group-data-[state=open]/api-specifications:rotate-180" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleApiSpecificationsItems.map(renderNavItem)}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ) : null}

        {/* Admin-only: in-app user management, approvals, sessions. Rendered
            for admins regardless of the easter-egg gate — security tooling
            must never be hidden behind it. */}
        <UsersSecurityNav />
      </SidebarContent>
    </Sidebar>
  )
}
