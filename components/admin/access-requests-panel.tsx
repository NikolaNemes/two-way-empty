"use client"

import { useState } from "react"
import { Check, ShieldCheck, ShieldX, UserRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  approveAccessRequest,
  denyAccessRequest,
  type AccessRequestRow,
} from "@/app/actions/access-requests"
import type { AppRole } from "@/lib/auth"

const PROVIDER_LABELS: Record<string, string> = {
  password: "Password",
  oauth_google: "Google",
  oauth_microsoft: "Microsoft",
  oauth_github: "GitHub",
  oauth_apple: "Apple",
}

function fmtDateTime(iso: string | undefined, fallbackTs?: number): string {
  const d = iso ? new Date(iso) : fallbackTs ? new Date(fallbackTs) : null
  if (!d) return "—"
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Access requests tab: locked-out ('pending') users awaiting a decision.
 * Approve grants user/admin (admin may override what was requested); deny
 * keeps them locked out with an optional reason and lets them re-request.
 */
export function AccessRequestsPanel({
  rows,
  isPending,
  act,
}: {
  rows: AccessRequestRow[]
  isPending: boolean
  act: (fn: () => Promise<{ ok: boolean; error?: string }>) => void
}) {
  const [denyTarget, setDenyTarget] = useState<AccessRequestRow | null>(null)
  const [denyReason, setDenyReason] = useState("")

  const requested = rows.filter((r) => r.request?.status === "requested")
  const others = rows.filter((r) => r.request?.status !== "requested")

  const renderRow = (r: AccessRequestRow) => {
    const status = r.request?.status ?? "none"
    return (
      <div key={r.userId} className="flex flex-col gap-3 border-b py-4 last:border-0 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.imageUrl || "/placeholder.svg"} alt="" className="mt-0.5 size-8 rounded-full border" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{r.name}</p>
              {r.signInMethods.map((m) => (
                <Badge key={m} variant="outline" className="text-[11px]">
                  {PROVIDER_LABELS[m] ?? m}
                </Badge>
              ))}
              {status === "requested" ? (
                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  Awaiting decision
                </Badge>
              ) : status === "denied" ? (
                <Badge variant="destructive">Denied</Badge>
              ) : (
                <Badge variant="secondary">No request yet</Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{r.email}</p>
            {r.request ? (
              <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                <p>
                  Requested{" "}
                  <span className="font-medium text-foreground">
                    {r.request.requestedRole === "admin" ? "Administrator" : "Regular user"}
                  </span>{" "}
                  access · {fmtDateTime(r.request.requestedAt)}
                </p>
                {r.request.note ? (
                  <p className="rounded-md bg-muted/60 px-2.5 py-1.5 leading-relaxed">
                    &ldquo;{r.request.note}&rdquo;
                  </p>
                ) : null}
                {status === "denied" && r.request.deniedReason ? (
                  <p className="text-destructive">Denied: {r.request.deniedReason}</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Signed in {fmtDateTime(undefined, r.createdAt)} but hasn&apos;t submitted a request.
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:pt-0.5">
          <Button
            size="sm"
            className="h-8 gap-1 text-xs"
            disabled={isPending}
            onClick={() => act(() => approveAccessRequest(r.userId, "user"))}
          >
            <UserRound className="size-3.5" />
            Approve as user
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs bg-transparent"
            disabled={isPending}
            onClick={() => act(() => approveAccessRequest(r.userId, "admin"))}
          >
            <ShieldCheck className="size-3.5" />
            Admin
          </Button>
          {status === "requested" ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
              disabled={isPending}
              onClick={() => {
                setDenyReason("")
                setDenyTarget(r)
              }}
            >
              <ShieldX className="size-3.5" />
              Deny
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Access requests</CardTitle>
          <CardDescription>
            New sign-ins are locked out until approved here. Approving grants the role immediately — the
            requester&apos;s waiting screen lets them in within ~30 seconds. Denied users stay locked out but may
            submit a new request.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Check className="size-6 text-emerald-600" />
              <p className="text-sm font-medium">No pending accounts</p>
              <p className="text-xs text-muted-foreground">
                Everyone who has signed in has been approved or denied.
              </p>
            </div>
          ) : (
            <div>
              {requested.map(renderRow)}
              {others.map(renderRow)}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={denyTarget !== null} onOpenChange={(open) => !open && setDenyTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny access for {denyTarget?.email}?</DialogTitle>
            <DialogDescription>
              They stay locked out and will see the denial (and your reason, if given) on their request screen.
              They can submit a new request. Use Ban on the Users tab to block re-requests entirely.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            placeholder="Reason (optional, shown to the requester)…"
            maxLength={500}
            rows={3}
            className="resize-none text-sm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenyTarget(null)} className="bg-transparent">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                if (denyTarget) act(() => denyAccessRequest(denyTarget.userId, denyReason || undefined))
                setDenyTarget(null)
              }}
            >
              Deny request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Re-exported so admin-screen can badge without re-deriving.
export type { AccessRequestRow, AppRole }
