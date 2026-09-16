"use server"

import { auth, clerkClient } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import {
  requireAdmin,
  type AccessRequest,
  type AppRole,
  type StoredRole,
} from "@/lib/auth"
import { sendRoleConfirmationEmail } from "@/lib/emails"

/**
 * Access-request workflow (deny-by-default onboarding).
 *
 * SELF-SERVICE half: available to any SIGNED-IN user, including 'pending' —
 * these are the only actions a pending user can reach (they're posted from
 * /request-access, the one route the proxy leaves open to them). They only
 * ever touch the CALLER's own metadata — userId always comes from auth(),
 * never from a parameter.
 *
 * ADMIN half: requireAdmin() first, always.
 */

const MAX_NOTE_LENGTH = 500

function readRole(metadata: unknown): StoredRole | undefined {
  const role = (metadata as { role?: string } | undefined)?.role
  if (role === "admin" || role === "user" || role === "pending") return role
  return undefined
}

function readRequest(metadata: unknown): AccessRequest | null {
  const req = (metadata as { accessRequest?: AccessRequest } | undefined)?.accessRequest
  if (!req || (req.requestedRole !== "admin" && req.requestedRole !== "user")) return null
  return req
}

// ── Self-service (signed-in, incl. pending) ──────────────────────────────────

export interface MyAccessStatus {
  role: StoredRole
  request: AccessRequest | null
}

/**
 * Authoritative role + request state for the polling /request-access screen.
 * Reads through the Backend API (never session claims) so an approval is
 * visible on the next poll even before the session token refreshes.
 */
export async function getMyAccessStatus(): Promise<MyAccessStatus | null> {
  const { userId } = await auth()
  if (!userId) return null
  const client = await clerkClient()
  const user = await client.users.getUser(userId)
  return {
    role: readRole(user.publicMetadata) ?? "pending",
    request: readRequest(user.publicMetadata),
  }
}

export async function submitAccessRequest(
  requestedRole: AppRole,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const { userId } = await auth()
  if (!userId) return { ok: false, error: "Sign in required." }
  if (requestedRole !== "admin" && requestedRole !== "user") {
    return { ok: false, error: "Invalid access type." }
  }
  const trimmedNote = note.trim().slice(0, MAX_NOTE_LENGTH)

  const client = await clerkClient()
  const user = await client.users.getUser(userId)
  const role = readRole(user.publicMetadata)
  // Approved members have nothing to request; don't let them overwrite state.
  if (role === "admin" || role === "user") {
    return { ok: false, error: "Your access is already approved." }
  }

  const request: AccessRequest = {
    requestedRole,
    note: trimmedNote,
    requestedAt: new Date().toISOString(),
    status: "requested",
  }
  await client.users.updateUserMetadata(userId, {
    publicMetadata: { role: "pending", accessRequest: request },
  })
  revalidatePath("/admin")
  return { ok: true }
}

// ── Admin ────────────────────────────────────────────────────────────────────

export interface AccessRequestRow {
  userId: string
  name: string
  email: string
  imageUrl: string
  signInMethods: string[]
  createdAt: number
  request: AccessRequest | null
}

/** All locked-out users (role 'pending'), newest request first. */
export async function listAccessRequests(): Promise<AccessRequestRow[]> {
  await requireAdmin()
  const client = await clerkClient()
  const { data } = await client.users.getUserList({ limit: 200, orderBy: "-created_at" })
  return data
    .filter((u) => (readRole(u.publicMetadata) ?? "pending") === "pending")
    .map((u) => {
      const methods = new Set<string>()
      if (u.passwordEnabled) methods.add("password")
      for (const acc of u.externalAccounts) methods.add(acc.provider)
      return {
        userId: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || "—",
        email: u.primaryEmailAddress?.emailAddress ?? "—",
        imageUrl: u.imageUrl,
        signInMethods: [...methods],
        createdAt: u.createdAt,
        request: readRequest(u.publicMetadata),
      }
    })
    .sort((a, b) => {
      const ta = a.request ? Date.parse(a.request.requestedAt) : a.createdAt
      const tb = b.request ? Date.parse(b.request.requestedAt) : b.createdAt
      return tb - ta
    })
}

/** Pending-request count for the sidebar badge. Cheap enough to poll. */
export async function getPendingRequestCount(): Promise<number> {
  await requireAdmin()
  const client = await clerkClient()
  const { data } = await client.users.getUserList({ limit: 200 })
  return data.filter(
    (u) =>
      (readRole(u.publicMetadata) ?? "pending") === "pending" &&
      readRequest(u.publicMetadata)?.status === "requested",
  ).length
}

/**
 * Approve: grant the role (admin may override what was requested). Clears the
 * accessRequest so the state is clean if the user is ever re-locked.
 */
export async function approveAccessRequest(
  userId: string,
  role: AppRole,
): Promise<{ ok: boolean; error?: string; emailSent?: boolean }> {
  await requireAdmin()
  if (role !== "admin" && role !== "user") {
    return { ok: false, error: "Invalid role." }
  }
  try {
    const client = await clerkClient()
    const target = await client.users.getUser(userId)
    if (readRole(target.publicMetadata) !== "pending") {
      return { ok: false, error: "This user is not pending approval." }
    }
    await client.users.updateUserMetadata(userId, {
      publicMetadata: { role, accessRequest: null },
    })
    revalidatePath("/admin")

    // ENEXA-style role confirmation email (fail-soft — approval already
    // succeeded; a mail failure only flips the toast copy).
    const { sent } = await sendRoleConfirmationEmail({
      to: target.primaryEmailAddress?.emailAddress ?? "",
      name: [target.firstName, target.lastName].filter(Boolean).join(" "),
      role,
    })
    return { ok: true, emailSent: sent }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Approve failed." }
  }
}

/**
 * Deny: user STAYS pending (locked out) and sees the denial + optional reason
 * on /request-access, from where they may submit a new request. Per operator
 * decision: no auto-ban, no auto-delete — those remain manual tools on the
 * Users tab.
 */
export async function denyAccessRequest(
  userId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  try {
    const client = await clerkClient()
    const target = await client.users.getUser(userId)
    const existing = readRequest(target.publicMetadata)
    if (readRole(target.publicMetadata) !== "pending" || !existing) {
      return { ok: false, error: "This user has no pending request." }
    }
    const denied: AccessRequest = {
      ...existing,
      status: "denied",
      deniedReason: reason?.trim().slice(0, MAX_NOTE_LENGTH) || undefined,
      deniedAt: new Date().toISOString(),
    }
    await client.users.updateUserMetadata(userId, {
      publicMetadata: { role: "pending", accessRequest: denied },
    })
    revalidatePath("/admin")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Deny failed." }
  }
}
