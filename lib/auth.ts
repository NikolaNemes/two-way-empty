import "server-only"
import { auth, clerkClient } from "@clerk/nextjs/server"

/**
 * Role model: publicMetadata.role on the Clerk user.
 *   'admin'   — full app + /admin (user management, security)
 *   'user'    — full app EXCEPT /admin
 *   'pending' — DENY-BY-DEFAULT: no app access at all; only /request-access.
 *
 * DENY-BY-DEFAULT (Aug 21 2026): a brand-new sign-in (e.g. first-time
 * Microsoft SSO) gets 'pending', NOT 'user'. They see only the request-access
 * screen until an existing admin approves them from /admin. The one exception
 * is the cold-start bootstrap below.
 *
 * The proxy gate reads the role from session claims (fast, but requires the
 * one-time Clerk Dashboard token customization) with a Backend-API fallback.
 * These helpers hit the Backend API directly — authoritative regardless of
 * dashboard config — and are what server actions and layouts MUST use.
 */

export type AppRole = "admin" | "user"
/** Role as stored on the Clerk user — includes the locked-out state. */
export type StoredRole = AppRole | "pending"

export type AccessRequestStatus = "none" | "requested" | "denied"

/** Self-service access request, stored in publicMetadata.accessRequest. */
export interface AccessRequest {
  requestedRole: AppRole
  note: string
  requestedAt: string // ISO
  status: AccessRequestStatus
  deniedReason?: string
  deniedAt?: string
}

export interface CurrentUser {
  userId: string
  role: StoredRole
  email: string | null
  name: string | null
  accessRequest: AccessRequest | null
}

function readStoredRole(metadata: unknown): StoredRole | undefined {
  const role = (metadata as { role?: string } | undefined)?.role
  if (role === "admin" || role === "user" || role === "pending") return role
  return undefined
}

function readAccessRequest(metadata: unknown): AccessRequest | null {
  const req = (metadata as { accessRequest?: AccessRequest } | undefined)?.accessRequest
  if (!req || (req.requestedRole !== "admin" && req.requestedRole !== "user")) return null
  return req
}

/**
 * SAFE BOOTSTRAP + DENY-BY-DEFAULT: if the instance has NO admin at all, the
 * current signed-in user is promoted to admin on first role read (solves the
 * cold-start problem without a manual dashboard step; once one admin exists
 * this path is permanently closed). Otherwise a role-less user is marked
 * 'pending' — locked out until an admin approves their access request.
 */
async function resolveRole(userId: string): Promise<StoredRole> {
  const client = await clerkClient()
  const user = await client.users.getUser(userId)
  const role = readStoredRole(user.publicMetadata)
  if (role) return role

  // No role on this user — check if ANY admin exists before bootstrapping.
  const { data: candidates } = await client.users.getUserList({ limit: 100, orderBy: "+created_at" })
  const adminExists = candidates.some((u) => readStoredRole(u.publicMetadata) === "admin")
  const assigned: StoredRole = adminExists ? "pending" : "admin"
  await client.users.updateUserMetadata(userId, {
    publicMetadata: { ...user.publicMetadata, role: assigned },
  })
  return assigned
}

/** Current Clerk user + resolved role. Null when not signed in. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { userId } = await auth()
  if (!userId) return null
  const client = await clerkClient()
  const user = await client.users.getUser(userId)
  let role = readStoredRole(user.publicMetadata)
  if (!role) {
    role = await resolveRole(userId)
  }
  return {
    userId,
    role,
    email: user.primaryEmailAddress?.emailAddress ?? null,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
    accessRequest: readAccessRequest(user.publicMetadata),
  }
}

/**
 * Guard for admin-only server actions and layouts. Throws on violation —
 * callers never proceed unauthenticated. Every action in
 * app/actions/admin-users.ts and the admin half of
 * app/actions/access-requests.ts MUST call this first.
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error("Unauthorized: sign in required")
  if (user.role !== "admin") throw new Error("Forbidden: admin role required")
  return user
}

/**
 * Guard for actions available to APPROVED members only (admin or user).
 * 'pending' users are blocked here even if they somehow reach an action
 * (defense in depth alongside the proxy gate).
 */
export async function requireApproved(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error("Unauthorized: sign in required")
  if (user.role !== "admin" && user.role !== "user") {
    throw new Error("Forbidden: access not approved yet")
  }
  return user
}
