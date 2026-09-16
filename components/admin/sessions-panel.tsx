"use client"

import { useState } from "react"
import { ExternalLink, Laptop, LogOut, Smartphone } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  revokeAllUserSessions,
  revokeSession,
  type AdminSessionRow,
} from "@/app/actions/admin-users"

function fmtRelative(ts: number): string {
  const diffMs = Date.now() - ts
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Sessions tab: every active session across all accounts, with per-session
 * revoke and a per-user "revoke all" kick. Self-kick is confirmed explicitly
 * because it signs the admin out of THIS tab too.
 */
export function SessionsPanel({
  rows,
  isPending,
  act,
}: {
  rows: AdminSessionRow[]
  isPending: boolean
  act: (fn: () => Promise<{ ok: boolean; error?: string }>) => void
}) {
  const [kickTarget, setKickTarget] = useState<AdminSessionRow | null>(null)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Active sessions</CardTitle>
          <CardDescription>
            Every signed-in device across all accounts. Revoking a session signs that device out on its next
            request — the instant kick for a compromised account.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No active sessions.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Device</th>
                    <th className="px-3 py-2 font-medium">Location</th>
                    <th className="px-3 py-2 font-medium">Last active</th>
                    <th className="px-3 py-2 font-medium">Expires</th>
                    <th className="py-2 pl-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.userImageUrl || "/placeholder.svg"} alt="" className="size-7 rounded-full border" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {s.userName}
                              {s.isSelf ? <span className="ml-1.5 text-xs text-muted-foreground">(you)</span> : null}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{s.userEmail}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5 text-xs">
                          {s.isMobile ? (
                            <Smartphone className="size-3.5 text-muted-foreground" />
                          ) : (
                            <Laptop className="size-3.5 text-muted-foreground" />
                          )}
                          {s.browser ?? "Unknown"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{s.location ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmtRelative(s.lastActiveAt)}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmtDate(s.expireAt)}</td>
                      <td className="py-2.5 pl-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 text-xs"
                            disabled={isPending}
                            onClick={() => {
                              // Self-revocation kicks the admin out of THIS
                              // tab too — confirm instead of silent sign-out.
                              if (s.isSelf) setKickTarget(s)
                              else act(() => revokeSession(s.id))
                            }}
                          >
                            <LogOut className="size-3.5" />
                            Revoke
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
                            disabled={isPending}
                            onClick={() => setKickTarget(s)}
                          >
                            Kick all
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Instance settings (Clerk Dashboard)</CardTitle>
          <CardDescription>
            Everything else — users, roles, approvals, invitations, bans, sessions — is managed right here in the
            app. Only these instance-level switches still live in the Clerk Dashboard:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-0 text-sm leading-relaxed">
          <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">SSO providers</span> (Google, Microsoft…) —
              Configure → SSO connections. New providers appear on the sign-in page automatically.
            </li>
            <li>
              <span className="font-medium text-foreground">MFA policy</span> — Configure → Multi-factor.
            </li>
            <li>
              <span className="font-medium text-foreground">Session token claims</span> — Sessions → Customize
              session token: <span className="font-mono text-xs">{'{"metadata":"{{user.public_metadata}}"}'}</span>{" "}
              (makes the role gate claim-fast; the app works without it via a Backend-API fallback).
            </li>
            <li>
              <span className="font-medium text-foreground">Sign-up mode</span> — Configure → Restrictions. With the
              in-app approval flow, Public sign-up is safe: new accounts are locked out until approved here.
            </li>
          </ul>
          <Button asChild variant="outline" size="sm" className="gap-1.5 bg-transparent">
            <a href="https://dashboard.clerk.com" target="_blank" rel="noopener noreferrer">
              Open Clerk Dashboard <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={kickTarget !== null} onOpenChange={(open) => !open && setKickTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {kickTarget?.isSelf ? "Sign yourself out everywhere?" : `Kick ${kickTarget?.userEmail}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {kickTarget?.isSelf
                ? "This revokes ALL of your sessions, including this one — you will be signed out immediately and must sign in again."
                : "This revokes all of this user's active sessions. They are signed out on every device and must sign in again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (kickTarget) act(() => revokeAllUserSessions(kickTarget.userId))
                setKickTarget(null)
              }}
            >
              {kickTarget?.isSelf ? "Sign me out everywhere" : "Revoke all sessions"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
