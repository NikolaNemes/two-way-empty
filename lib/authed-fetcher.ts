"use client"

/**
 * AUTH-RESILIENT SWR FETCHER for Clerk-gated /api/* routes.
 *
 * WHY THIS EXISTS (live-prod bug, aug 2026): Clerk's session JWT lives ~60s
 * and refreshes in the background (~every 50s). A polling fetch that fires in
 * the expiry gap — typically right after the browser un-throttles a
 * background tab — hits the middleware with a stale cookie and gets a clean
 * 401 JSON. The naive per-component fetcher threw immediately, and pages
 * rendering `error ? <full-page error/> : …` replaced ALL existing data with
 * "Fleet status unavailable: HTTP 401" for one poll cycle.
 *
 * STRATEGY on 401:
 *   1. Ask Clerk to mint a fresh session token (`getToken({skipCache:true})`
 *      also rotates the __session cookie the middleware reads).
 *   2. Retry the request (up to 2 retries, short backoff).
 *   3. Only surface the error if it STILL fails — a real sign-out, not a gap.
 *
 * 403 is NEVER retried: that's the pending-approval gate, not token expiry.
 */

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Clerk global injected by <ClerkProvider>; typed loosely on purpose so this
 * lib doesn't import clerk client internals. */
declare global {
  interface Window {
    Clerk?: {
      session?: { getToken: (opts?: { skipCache?: boolean }) => Promise<string | null> } | null
    }
  }
}

async function refreshClerkSession(): Promise<void> {
  try {
    // Forces a fresh JWT AND rotates the __session cookie — the middleware
    // reads the cookie, so the retried fetch passes without any header work.
    await window.Clerk?.session?.getToken({ skipCache: true })
  } catch {
    // Clerk unreachable — the retry below will surface the real state.
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Drop-in SWR fetcher: `useSWR(url, authedFetcher)`. Retries 401 after a
 * forced token refresh; passes 5xx/network errors straight through to SWR's
 * own retry machinery (which already backs off correctly).
 */
export async function authedFetcher<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const MAX_401_RETRIES = 2
  let attempt = 0

  for (;;) {
    const res = await fetch(url, init)
    if (res.ok) return (await res.json()) as T

    if (res.status === 401 && attempt < MAX_401_RETRIES) {
      attempt++
      await refreshClerkSession()
      // Tiny backoff so a mid-rotation cookie write can land before we retry.
      await sleep(250 * attempt)
      continue
    }

    // Body may carry a structured error — prefer it over the bare status.
    let detail = ""
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      detail = body.error || body.message || ""
    } catch {
      // Non-JSON body (HTML error page etc.) — status alone is clearer.
    }
    throw new ApiError(
      res.status,
      res.status === 401
        ? "Session expired — please sign in again."
        : res.status === 403
          ? detail || "Access not approved."
          : `HTTP ${res.status}${detail ? ` — ${detail}` : ""}`,
    )
  }
}
