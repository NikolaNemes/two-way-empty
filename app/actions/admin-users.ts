"use server"

import { clerkClient } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { requireAdmin, type AppRole, type StoredRole } from "@/lib/auth"
import { sendRoleConfirmationEmail, sendInvitationEmail, BRANDED_INVITES_ENABLED } from "@/lib/emails"

/**
 * Admin-only user management server actions. EVERY action starts with
 * requireAdmin() — the UI hiding a button is never the security boundary.
 * All mutations go through Clerk's Backend API; we store the app role in
 * publicMetadata.role.
 */

export interface AdminUserRow {
  id: string
  name: string
  email: string
  imageUrl: string
  /** 'pending' = locked out, awaiting approval (deny-by-default model). */
  role: StoredRole | null
  banned: boolean
  lastSignInAt: number | null
  createdAt: number
  /** e.g. ["password", "oauth_google"] — how this user can sign in. */
  signInMethods: string[]
  isSelf: boolean
}

export interface AdminInvitationRow {
  id: string
  email: string
  role: AppRole | null
  status: string
  createdAt: number
}

export async function listUsers(): Promise<AdminUserRow[]> {
  const self = await requireAdmin()
  const client = await clerkClient()
  const { data } = await client.users.getUserList({ limit: 200, orderBy: "-created_at" })
  return data.map((u) => {
    const role = (u.publicMetadata as { role?: string })?.role
    const methods = new Set<string>()
    if (u.passwordEnabled) methods.add("password")
    for (const acc of u.externalAccounts) methods.add(acc.provider)
    return {
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || "—",
      email: u.primaryEmailAddress?.emailAddress ?? "—",
      imageUrl: u.imageUrl,
      role: role === "admin" || role === "user" || role === "pending" ? role : null,
      banned: u.banned,
      lastSignInAt: u.lastSignInAt,
      createdAt: u.createdAt,
      signInMethods: [...methods],
      isSelf: u.id === self.userId,
    }
  })
}

export async function setUserRole(
  userId: string,
  role: AppRole,
): Promise<{ ok: boolean; error?: string; emailSent?: boolean }> {
  const self = await requireAdmin()
  // An admin demoting THEMSELVES could lock the instance out of /admin
  // entirely (last admin standing). Cheap guard: never allow self-demotion.
  if (userId === self.userId && role !== "admin") {
    return { ok: false, error: "You cannot remove your own admin role." }
  }
  const client = await clerkClient()
  const target = await client.users.getUser(userId)
  const previousRole = (target.publicMetadata as { role?: string })?.role
  await client.users.updateUserMetadata(userId, { publicMetadata: { role } })
  revalidatePath("/admin")

  // ENEXA-style role confirmation email (fail-soft — never blocks the role
  // change). Skipped when the role didn't actually change.
  let emailSent = false
  if (previousRole !== role) {
    const { sent } = await sendRoleConfirmationEmail({
      to: target.primaryEmailAddress?.emailAddress ?? "",
      name: [target.firstName, target.lastName].filter(Boolean).join(" "),
      role,
    })
    emailSent = sent
  }
  return { ok: true, emailSent }
}

export async function banUser(userId: string, ban: boolean): Promise<{ ok: boolean; error?: string }> {
  const self = await requireAdmin()
  if (userId === self.userId) return { ok: false, error: "You cannot ban yourself." }
  const client = await clerkClient()
  if (ban) await client.users.banUser(userId)
  else await client.users.unbanUser(userId)
  revalidatePath("/admin")
  return { ok: true }
}

export async function deleteUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  const self = await requireAdmin()
  if (userId === self.userId) return { ok: false, error: "You cannot delete yourself." }
  const client = await clerkClient()
  await client.users.deleteUser(userId)
  revalidatePath("/admin")
  return { ok: true }
}

// ── Invitations (invite-only onboarding) ─────────────────────────────────────

export async function listInvitations(): Promise<AdminInvitationRow[]> {
  await requireAdmin()
  const client = await clerkClient()
  const { data } = await client.invitations.getInvitationList({ limit: 100 })
  return data.map((inv) => {
    const role = (inv.publicMetadata as { role?: string } | null)?.role
    return {
      id: inv.id,
      email: inv.emailAddress,
      role: role === "admin" || role === "user" ? role : null,
      status: inv.status ?? "pending",
      createdAt: inv.createdAt,
    }
  })
}

export async function createInvitation(email: string, role: AppRole): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  const trimmed = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: "Enter a valid email address." }
  }
  try {
    const client = await clerkClient()
    // publicMetadata.role transfers onto the user when the invitation is
    // accepted — the invitee lands with the right role, no follow-up step.
    //
    // redirectUrl MUST be /sign-up: the invite link carries a __clerk_ticket
    // that only Clerk's <SignUp> component can consume (create the account +
    // set a password). Pointing it at /welcome (live-tested aug 26 2026)
    // showed the static "Account updated" card with NO password ever set and
    // the invitation stuck pending. /welcome comes AFTER sign-up completes
    // (SignUp forceRedirectUrl). Production domain per client request aug 25:
    // never surface *.vercel.app to users.
    //
    // Invite EMAIL delivery has two modes:
    //  - Clerk-sent (notify: true) — default while Resend runs on the sandbox
    //    sender, which can only deliver to the Resend account owner.
    //  - Branded via Resend (BRANDED_INVITES_ENABLED) — Clerk creates the
    //    invitation silently (notify: false) and returns the accept URL; we
    //    send the ENEXA "Update Your Account" template from the enexa domain.
    //    If the Resend send fails, we revoke + recreate with Clerk's sender
    //    so the invitee ALWAYS receives an email.
    const invitation = await client.invitations.createInvitation({
      emailAddress: trimmed,
      publicMetadata: { role },
      redirectUrl: "https://amperio.enexa.app/sign-up",
      notify: !BRANDED_INVITES_ENABLED,
      ignoreExisting: true,
    })

    if (BRANDED_INVITES_ENABLED) {
      const { sent } = await sendInvitationEmail({
        to: trimmed,
        inviteUrl: invitation.url ?? "",
        role,
      })
      if (!sent) {
        // Fallback: never leave an invitation without an email in flight.
        await client.invitations.revokeInvitation(invitation.id).catch(() => {})
        await client.invitations.createInvitation({
          emailAddress: trimmed,
          publicMetadata: { role },
          redirectUrl: "https://amperio.enexa.app/sign-up",
          notify: true,
          ignoreExisting: true,
        })
      }
    }
    revalidatePath("/admin")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invitation failed." }
  }
}

export async function revokeInvitation(invitationId: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  try {
    const client = await clerkClient()
    await client.invitations.revokeInvitation(invitationId)
    revalidatePath("/admin")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Revoke failed." }
  }
}

// ── Sessions (security: see who's signed in, kick compromised accounts) ─────

export interface AdminSessionRow {
  id: string
  userId: string
  userName: string
  userEmail: string
  userImageUrl: string
  status: string
  lastActiveAt: number
  expireAt: number
  createdAt: number
  /** From latestActivity (best effort): "Chrome 126 · Berlin, DE" style parts. */
  browser: string | null
  location: string | null
  isMobile: boolean
  isSelf: boolean
}

/**
 * Active sessions across ALL users (admins + users + pending). One Backend
 * API call per user — fine at this fleet's scale (a handful of accounts).
 */
export async function listAllSessions(): Promise<AdminSessionRow[]> {
  const self = await requireAdmin()
  const client = await clerkClient()
  const { data: users } = await client.users.getUserList({ limit: 200 })
  const perUser = await Promise.all(
    users.map(async (u) => {
      const { data: sessions } = await client.sessions.getSessionList({
        userId: u.id,
        status: "active",
        limit: 20,
      })
      return sessions.map((s): AdminSessionRow => {
        const act = s.latestActivity
        const browser = act?.browserName
          ? [act.browserName, act.browserVersion?.split(".")[0]].filter(Boolean).join(" ")
          : null
        const location = act ? [act.city, act.country].filter(Boolean).join(", ") || null : null
        return {
          id: s.id,
          userId: u.id,
          userName: [u.firstName, u.lastName].filter(Boolean).join(" ") || "—",
          userEmail: u.primaryEmailAddress?.emailAddress ?? "—",
          userImageUrl: u.imageUrl,
          status: s.status,
          lastActiveAt: s.lastActiveAt,
          expireAt: s.expireAt,
          createdAt: s.createdAt,
          browser,
          location,
          isMobile: act?.isMobile ?? false,
          isSelf: u.id === self.userId,
        }
      })
    }),
  )
  return perUser.flat().sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

/** Revoke ONE session (sign that device out). */
export async function revokeSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  try {
    const client = await clerkClient()
    await client.sessions.revokeSession(sessionId)
    revalidatePath("/admin")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Revoke failed." }
  }
}

/**
 * Revoke ALL sessions of one user — the "instant kick" for a compromised
 * account. Self-revocation of OTHER sessions is allowed (kick your stolen
 * laptop), but the CURRENT session can't be distinguished here, so kicking
 * yourself signs you out everywhere including this tab — guard in the UI.
 */
export async function revokeAllUserSessions(userId: string): Promise<{ ok: boolean; error?: string; revoked?: number }> {
  await requireAdmin()
  try {
    const client = await clerkClient()
    const { data: sessions } = await client.sessions.getSessionList({
      userId,
      status: "active",
      limit: 50,
    })
    await Promise.all(sessions.map((s) => client.sessions.revokeSession(s.id)))
    revalidatePath("/admin")
    return { ok: true, revoked: sessions.length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Revoke failed." }
  }
}
