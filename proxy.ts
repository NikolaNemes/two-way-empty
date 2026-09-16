import { clerkClient, clerkMiddleware } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * ENTERPRISE AUTH BOUNDARY (Clerk) — every page and browser-initiated API
 * call requires a Clerk session; /admin additionally requires the admin role,
 * and 'pending' (unapproved) users are locked to /request-access.
 *
 * MACHINE BYPASS — the dispatch worker, Vercel Cron, and the Amperio
 * middleware authenticate with `Authorization: Bearer <CRON_SECRET>` (or
 * `?secret=`) and know nothing about Clerk. Machine-scoped API prefixes skip
 * Clerk entirely and rely on each route's OWN secret validation (unchanged,
 * so this is a second gate, not the only one). Wrong-secret requests still
 * hit the route's 401 — they must NOT be redirected to a human sign-in page.
 *
 * Role model: publicMetadata.role ('admin' | 'user' | 'pending'), read from
 * session claims when the instance has token customization, with a
 * Backend-API fallback HERE for the pending gate (the deny-by-default
 * boundary must hold even without the dashboard token customization).
 */

// Plain pathname prefix checks (createRouteMatcher is deprecated; Clerk's
// guidance is resource-based checks in each page/route — which this app
// already has: /admin layout re-verifies via Backend API, machine routes
// validate CRON_SECRET themselves, data access goes through requireUser().
// This middleware remains as the outer deny-by-default gate on top).
const startsWithAny = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"))

const isPublicRoute = (req: NextRequest) =>
  startsWithAny(req.nextUrl.pathname, ["/sign-in", "/sign-up"]) ||
  // Post-activation confirmation (ENEXA onboarding step 4) — invited users
  // land here after Clerk's account-update flow, possibly without a session.
  req.nextUrl.pathname === "/welcome"

// API prefixes that machines call with CRON_SECRET. Auth for these lives in
// the routes themselves (validateSecret pattern) — Clerk never gates them.
const isMachineRoute = (req: NextRequest) =>
  startsWithAny(req.nextUrl.pathname, ["/api/cron", "/api/dispatcher", "/api/amperio", "/api/ingestion"])

const isAdminRoute = (req: NextRequest) => startsWithAny(req.nextUrl.pathname, ["/admin"])

// The ONLY page a signed-in-but-unapproved ('pending') user may load.
// Server actions posted FROM this page target /request-access too (Next.js
// posts server actions to the current URL), so the self-service
// submit/poll actions work for pending users while every other action
// path stays blocked.
const isRequestAccessRoute = (req: NextRequest) => startsWithAny(req.nextUrl.pathname, ["/request-access"])

/**
 * PUBLIC origin of this request — the scheme+host a BROWSER used, which behind
 * a reverse proxy is not what `req.url` reports.
 *
 * Self-hosted behind nginx, Next builds `req.url` from the forwarded scheme but
 * its own internal host, yielding `https://localhost:3000/...`. Next normalises
 * the `Location` header of a redirect, so that leak is invisible there — but a
 * URL embedded in a QUERY PARAM (`redirect_url` below) is opaque text and ships
 * the internal origin straight to the browser, sending users to localhost after
 * sign-in. On Vercel the two origins coincide, which is why this never showed
 * up before. Deriving from the forwarded headers is deterministic on both.
 */
function publicOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  if (!host) return req.nextUrl.origin
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")
  return `${proto}://${host}`
}

/** Same path+query the user asked for, rebuilt on the public origin. */
function publicHref(req: NextRequest): string {
  return new URL(req.nextUrl.pathname + req.nextUrl.search, publicOrigin(req)).href
}

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return

  // Machine-to-machine surface: leave it to the route's own secret check.
  if (isMachineRoute(req)) return

  const { userId, sessionClaims } = await auth()

  if (!userId) {
    // Browser API calls should get a clean 401, not an HTML redirect.
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    // Send humans to OUR enexa-branded /sign-in (not Clerk's hosted
    // accounts.dev page), preserving the deep link they wanted.
    const signInUrl = new URL("/sign-in", publicOrigin(req))
    signInUrl.searchParams.set("redirect_url", publicHref(req))
    return NextResponse.redirect(signInUrl)
  }

  // ---- DENY-BY-DEFAULT GATE (pending users) --------------------------------
  // Fast path: role from session claims (requires Clerk Dashboard → Sessions →
  // Customize session token: {"metadata":"{{user.public_metadata}}"}).
  // Fallback: one Backend-API getUser() call when the claim is absent — the
  // deny-by-default boundary must NEVER be skippable just because the
  // dashboard step wasn't done. Approved users on claim-less instances pay
  // one extra API call per request; with claims it's free.
  const metadata = (sessionClaims?.metadata ?? {}) as { role?: string }
  let role: string | undefined = metadata.role
  if (role === undefined) {
    try {
      const client = await clerkClient()
      const user = await client.users.getUser(userId)
      role = (user.publicMetadata as { role?: string })?.role
      // A brand-new user may have NO role yet (resolveRole runs on first
      // getCurrentUser()). Treat role-less as pending here — /request-access
      // resolves and persists the real role server-side.
    } catch {
      // Backend API hiccup: fail CLOSED for the boundary (treat as pending).
      role = undefined
    }
  }
  const isPending = role !== "admin" && role !== "user"

  if (isPending) {
    if (isRequestAccessRoute(req)) return
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden: access not approved" }, { status: 403 })
    }
    return NextResponse.redirect(new URL("/request-access", publicOrigin(req)))
  }

  // Approved users have no business on the request screen — send them home.
  if (isRequestAccessRoute(req)) {
    return NextResponse.redirect(new URL("/", publicOrigin(req)))
  }

  if (isAdminRoute(req)) {
    // Role is known here (claims or fallback). The /admin layout re-verifies
    // via the Backend API regardless (defense in depth).
    if (role !== "admin") {
      return NextResponse.redirect(new URL("/", publicOrigin(req)))
    }
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
}
