/**
 * Per-tab dispatch source identity.
 * ────────────────────────────────────────────────────────────────────────
 * Each open Dispatcher Status tab gets a stable `dash:<uuid>` id (persisted in
 * sessionStorage, so it survives reloads but is unique per tab). The id is sent
 * as the `X-Dispatch-Source` header on both the status poll (presence) and the
 * tick call, so the server can tell dashboard tabs apart from external pingers
 * and the client can run a deterministic "who drives ticks" election.
 */

import type { DispatchGuard } from "./dispatcher-status"

const STORAGE_KEY = "dispatch-source-id"

export const DISPATCH_SOURCE_HEADER = "x-dispatch-source"

/**
 * Header carrying the caller's human-meaningful NAME (mandatory on the tick
 * API). The dashboard derives a name from the browser + OS so the Pingers
 * monitor can label this tab as e.g. "Chrome on macOS (dashboard tab)" instead
 * of an opaque `dash:<uuid>`.
 */
export const DISPATCH_NAME_HEADER = "x-dispatch-name"

/** Best-effort browser name from a user-agent string. */
function detectBrowser(ua: string): string {
  if (/\bEdg\//.test(ua)) return "Edge"
  if (/\bOPR\/|\bOpera\b/.test(ua)) return "Opera"
  if (/\bFirefox\//.test(ua)) return "Firefox"
  if (/\bChrome\//.test(ua) && !/\bChromium\b/.test(ua)) return "Chrome"
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return "Safari"
  return "Browser"
}

/** Best-effort OS name from a user-agent string. */
function detectOs(ua: string): string {
  if (/Windows NT/.test(ua)) return "Windows"
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS"
  if (/Android/.test(ua)) return "Android"
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS"
  if (/Linux/.test(ua)) return "Linux"
  return "Unknown OS"
}

/**
 * A meaningful, human-readable name for THIS dashboard tab — browser + OS, e.g.
 * "Chrome on macOS (dashboard tab)". Sent on the mandatory name header so the
 * Pingers monitor shows recognisable process names rather than GUIDs.
 *
 * ASCII only: this travels over an HTTP header (latin-1 by spec), so non-ASCII
 * separators like "·" would arrive mangled.
 */
export function getDispatchSourceName(): string {
  if (typeof navigator === "undefined") return "Dashboard (server)"
  const ua = navigator.userAgent || ""
  return `${detectBrowser(ua)} on ${detectOs(ua)} (dashboard tab)`
}

export interface DriverDecision {
  /** Whether THIS tab should be the one triggering ticks. */
  driving: boolean
  /** Why this tab is yielding (null when it is driving). */
  reason: "external-pinger" | "another-tab" | null
}

/**
 * Deterministic "who drives ticks" election so multiple open tabs / pingers
 * never double-dispatch:
 *   1. If an external pinger is actively driving, every dashboard tab yields.
 *   2. Otherwise the active dashboard tab with the smallest id drives; the rest
 *      yield. Including our own id guarantees exactly one driver even before
 *      our first presence ping has registered server-side.
 */
export function electDispatchDriver(
  guard: DispatchGuard | null | undefined,
  sourceId: string,
): DriverDecision {
  if (!guard) return { driving: true, reason: null }
  if (guard.externalActive) return { driving: false, reason: "external-pinger" }
  const dashIds = new Set<string>([sourceId])
  for (const s of guard.activeSources) {
    if (s.kind === "dashboard") dashIds.add(s.id)
  }
  const driver = [...dashIds].sort()[0]
  return driver === sourceId
    ? { driving: true, reason: null }
    : { driving: false, reason: "another-tab" }
}

export function getDispatchSourceId(): string {
  if (typeof window === "undefined") return "dash:ssr"
  try {
    let v = window.sessionStorage.getItem(STORAGE_KEY)
    if (!v) {
      const rand =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2)
      v = `dash:${rand}`
      window.sessionStorage.setItem(STORAGE_KEY, v)
    }
    return v
  } catch {
    // Private mode / storage disabled: fall back to a non-unique id.
    return "dash:anon"
  }
}
