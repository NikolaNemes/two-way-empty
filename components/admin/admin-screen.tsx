"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Users,
  MailPlus,
  KeyRound,
  ShieldCheck,
  Ban,
  Trash2,
  RotateCcw,
  ExternalLink,
  Loader2,
  UserRoundPlus,
  MonitorSmartphone,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  setUserRole,
  banUser,
  deleteUser,
  createInvitation,
  revokeInvitation,
  type AdminUserRow,
  type AdminInvitationRow,
  type AdminSessionRow,
} from "@/app/actions/admin-users"
import type { AccessRequestRow } from "@/app/actions/access-requests"
import { AccessRequestsPanel } from "@/components/admin/access-requests-panel"
import { SessionsPanel } from "@/components/admin/sessions-panel"
// Type-only import: erased at build time, so the server-only module never
// enters the client bundle.
import type { AppRole } from "@/lib/auth"

/**
 * Administration screen (admin role only — gated by app/admin/layout.tsx).
 * Users / Invitations / Sign-in methods. All mutations are server actions
 * that re-verify the admin role server-side.
 */

function fmtDate(ts: number | null): string {
  if (!ts) return "—"
  return new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

const PROVIDER_LABELS: Record<string, string> = {
  password: "Password",
  oauth_google: "Google",
  oauth_microsoft: "Microsoft",
  oauth_github: "GitHub",
  oauth_apple: "Apple",
}

export type AdminTab = "users" | "requests" | "invitations" | "sessions" | "signin"

export function AdminScreen({
  initialUsers,
  initialInvitations,
  initialAccessRequests,
  initialSessions,
  defaultTab = "users",
}: {
  initialUsers: AdminUserRow[]
  initialInvitations: AdminInvitationRow[]
  initialAccessRequests: AccessRequestRow[]
  initialSessions: AdminSessionRow[]
  defaultTab?: AdminTab
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AdminUserRow | null>(null)

  // Invitation form
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<AppRole>("user")

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) setError(res.error ?? "Action failed.")
      router.refresh()
    })
  }

  const pendingInvites = initialInvitations.filter((i) => i.status === "pending")
  const openRequests = initialAccessRequests.filter((r) => r.request?.status === "requested")
  const [tab, setTab] = useState<string>(defaultTab)

  const onTabChange = (value: string) => {
    setTab(value)
    // Deep-linkable tabs (sidebar links target these) without a nav reload.
    router.replace(`/admin?tab=${value}`, { scroll: false })
  }

  return (
    <main className="flex-1 space-y-6 p-4 md:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users &amp; Security</h1>
        <p className="text-sm text-muted-foreground">
          Approve access requests, manage users and sessions, send invitations, and configure sign-in.
        </p>
      </header>

      {error ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={onTabChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="size-4" /> Users
            <Badge variant="secondary" className="ml-1">{initialUsers.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="requests" className="gap-1.5">
            <UserRoundPlus className="size-4" /> Access requests
            {openRequests.length > 0 ? (
              <Badge className="ml-1 bg-destructive text-destructive-foreground">{openRequests.length}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="invitations" className="gap-1.5">
            <MailPlus className="size-4" /> Invitations
            {pendingInvites.length > 0 ? <Badge variant="secondary" className="ml-1">{pendingInvites.length}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="sessions" className="gap-1.5">
            <MonitorSmartphone className="size-4" /> Sessions
          </TabsTrigger>
          <TabsTrigger value="signin" className="gap-1.5">
            <KeyRound className="size-4" /> Sign-in methods
          </TabsTrigger>
        </TabsList>

        {/* ── Access requests ───────────────────────────────────────────── */}
        <TabsContent value="requests">
          <AccessRequestsPanel rows={initialAccessRequests} isPending={isPending} act={act} />
        </TabsContent>

        {/* ── Sessions ──────────────────────────────────────────────────── */}
        <TabsContent value="sessions">
          <SessionsPanel rows={initialSessions} isPending={isPending} act={act} />
        </TabsContent>

        {/* ── Users ─────────────────────────────────────────────────────── */}
        <TabsContent value="users">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">All users</CardTitle>
              <CardDescription>
                Role changes apply on the user&apos;s next token refresh (within a minute). Banned users cannot sign in.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">User</th>
                      <th className="px-3 py-2 font-medium">Role</th>
                      <th className="px-3 py-2 font-medium">Sign-in</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Last sign-in</th>
                      <th className="py-2 pl-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {initialUsers.map((u) => (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2.5">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u.imageUrl || "/placeholder.svg"} alt="" className="size-7 rounded-full border" />
                            <div className="min-w-0">
                              <p className="truncate font-medium">
                                {u.name}
                                {u.isSelf ? <span className="ml-1.5 text-xs text-muted-foreground">(you)</span> : null}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {u.role === "pending" ? (
                            <button
                              type="button"
                              onClick={() => onTabChange("requests")}
                              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
                              title="Locked out — decide on the Access requests tab"
                            >
                              <UserRoundPlus className="size-3" />
                              Pending
                            </button>
                          ) : (
                            <Select
                              value={u.role ?? "user"}
                              onValueChange={(v) => act(() => setUserRole(u.id, v as AppRole))}
                              disabled={isPending || u.isSelf}
                            >
                              <SelectTrigger className="h-8 w-28" aria-label={`Role for ${u.email}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">
                                  <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" /> Admin</span>
                                </SelectItem>
                                <SelectItem value="user">User</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {u.signInMethods.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              u.signInMethods.map((m) => (
                                <Badge key={m} variant="outline" className="text-[11px]">
                                  {PROVIDER_LABELS[m] ?? m}
                                </Badge>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {u.banned ? (
                            <Badge variant="destructive">Banned</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              Active
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(u.lastSignInAt)}</td>
                        <td className="py-2.5 pl-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 text-xs"
                              disabled={isPending || u.isSelf}
                              onClick={() => act(() => banUser(u.id, !u.banned))}
                            >
                              {u.banned ? <RotateCcw className="size-3.5" /> : <Ban className="size-3.5" />}
                              {u.banned ? "Unban" : "Ban"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
                              disabled={isPending || u.isSelf}
                              onClick={() => setConfirmDelete(u)}
                            >
                              <Trash2 className="size-3.5" />
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Invitations ───────────────────────────────────────────────── */}
        <TabsContent value="invitations" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Invite a new user</CardTitle>
              <CardDescription>
                Onboarding is invite-only. The invitee receives an email link; their role is assigned automatically on acceptance.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-center"
                onSubmit={(e) => {
                  e.preventDefault()
                  act(async () => {
                    const res = await createInvitation(inviteEmail, inviteRole)
                    if (res.ok) setInviteEmail("")
                    return res
                  })
                }}
              >
                <Input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="sm:max-w-xs"
                  aria-label="Invitee email"
                />
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
                  <SelectTrigger className="w-32" aria-label="Invitee role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={isPending || !inviteEmail} className="gap-1.5">
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : <MailPlus className="size-4" />}
                  Send invitation
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Invitations</CardTitle>
              <CardDescription>Pending invitations can be revoked; the link stops working immediately.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {initialInvitations.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No invitations yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium">Role</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Sent</th>
                        <th className="py-2 pl-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {initialInvitations.map((inv) => (
                        <tr key={inv.id} className="border-b last:border-0">
                          <td className="py-2.5 pr-3 font-medium">{inv.email}</td>
                          <td className="px-3 py-2.5">
                            <Badge variant="outline">{inv.role ?? "user"}</Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge
                              variant={inv.status === "pending" ? "secondary" : inv.status === "accepted" ? "default" : "outline"}
                            >
                              {inv.status}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(inv.createdAt)}</td>
                          <td className="py-2.5 pl-3 text-right">
                            {inv.status === "pending" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
                                disabled={isPending}
                                onClick={() => act(() => revokeInvitation(inv.id))}
                              >
                                <Trash2 className="size-3.5" />
                                Revoke
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Sign-in methods ───────────────────────────────────────────── */}
        <TabsContent value="signin">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Sign-in methods</CardTitle>
              <CardDescription>
                Authentication strategies are configured on the Clerk instance. Anything you enable there appears on the
                sign-in page automatically — no code changes needed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-0 text-sm leading-relaxed">
              <div className="space-y-2">
                <p className="font-medium">To add or remove a sign-in method (e.g. Sign in with Google):</p>
                <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
                  <li>
                    Open the Clerk Dashboard and select this application.
                  </li>
                  <li>
                    Go to <span className="font-medium text-foreground">Configure → SSO connections</span> to toggle social
                    providers (Google, Microsoft, GitHub…), or{" "}
                    <span className="font-medium text-foreground">Configure → Email, phone, username</span> for password,
                    email code, and passkey options.
                  </li>
                  <li>Enable the provider — it appears on the enexa sign-in page immediately.</li>
                </ol>
              </div>
              <div className="space-y-2">
                <p className="font-medium">Invite-only enforcement:</p>
                <p className="text-muted-foreground">
                  Under <span className="font-medium text-foreground">Configure → Restrictions</span>, set{" "}
                  <span className="font-medium text-foreground">Sign-up mode to Restricted</span>. Public self-registration is
                  disabled and only invitation links (sent from the Invitations tab) can create accounts.
                </p>
              </div>
              <div className="space-y-2">
                <p className="font-medium">Production domain:</p>
                <p className="text-muted-foreground">
                  Add <span className="font-mono text-foreground">amperio.enexa.app</span> under{" "}
                  <span className="font-medium text-foreground">Configure → Domains</span> when going live, and switch the app
                  to the production API keys.
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="gap-1.5 bg-transparent">
                <a href="https://dashboard.clerk.com" target="_blank" rel="noopener noreferrer">
                  Open Clerk Dashboard <ExternalLink className="size-3.5" />
                </a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete confirmation */}
      <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the user and their sessions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDelete) act(() => deleteUser(confirmDelete.id))
                setConfirmDelete(null)
              }}
            >
              Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
