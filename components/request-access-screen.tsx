"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useClerk } from "@clerk/nextjs"
import { Clock3, LogOut, ShieldCheck, ShieldX, UserRound } from "lucide-react"
import useSWR from "swr"
import {
  getMyAccessStatus,
  submitAccessRequest,
} from "@/app/actions/access-requests"
import type { AccessRequest, AppRole } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

/**
 * Deny-by-default landing for 'pending' users. Three states, driven by
 * accessRequest.status: none → form, requested → waiting, denied → denial
 * + re-request (operator decision: deny keeps the door open, no auto-ban).
 *
 * Polls getMyAccessStatus (Backend-API-authoritative) every 30s — when an
 * admin approves, the screen hard-navigates to "/" with a full reload so the
 * Clerk session token refreshes claims on the way in.
 */
export function RequestAccessScreen({
  name,
  email,
  initialRequest,
}: {
  name: string | null
  email: string | null
  initialRequest: AccessRequest | null
}) {
  const router = useRouter()
  const { signOut } = useClerk()
  const [requestedRole, setRequestedRole] = useState<AppRole>("user")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // Local override so a just-submitted request flips the UI instantly while
  // SWR revalidates in the background.
  const [localRequest, setLocalRequest] = useState<AccessRequest | null>(null)

  const { data: status, mutate } = useSWR("my-access-status", () => getMyAccessStatus(), {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })

  // Approval detected → full reload into the app (claims refresh en route).
  useEffect(() => {
    if (status && (status.role === "admin" || status.role === "user")) {
      window.location.assign("/")
    }
  }, [status])

  const request = status !== undefined ? status?.request ?? localRequest : (localRequest ?? initialRequest)

  const submit = useCallback(() => {
    setError(null)
    startTransition(async () => {
      const res = await submitAccessRequest(requestedRole, note)
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.")
        return
      }
      setLocalRequest({
        requestedRole,
        note: note.trim(),
        requestedAt: new Date().toISOString(),
        status: "requested",
      })
      void mutate()
    })
  }, [requestedRole, note, mutate])

  const handleSignOut = useCallback(() => {
    void signOut(() => router.push("/sign-in"))
  }, [signOut, router])

  const identity = (
    <div className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-medium text-foreground">{name ?? email ?? "Signed in"}</span>
        {name && email ? <span className="truncate text-xs text-muted-foreground">{email}</span> : null}
      </div>
      <Button variant="ghost" size="sm" onClick={handleSignOut} className="shrink-0 gap-1.5 text-muted-foreground">
        <LogOut className="size-3.5" />
        Sign out
      </Button>
    </div>
  )

  // ── Waiting state ──────────────────────────────────────────────────────────
  if (request?.status === "requested") {
    return (
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        {identity}
        <div className="flex w-full flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-amber-500/10">
            <Clock3 className="size-6 text-amber-600" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold text-foreground">Waiting for approval</h1>
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              Your request for{" "}
              <span className="font-medium text-foreground">
                {request.requestedRole === "admin" ? "administrator" : "regular user"}
              </span>{" "}
              access was submitted and is waiting for a system administrator. This page checks
              automatically — you&apos;ll be let in the moment it&apos;s approved.
            </p>
          </div>
          {request.note ? (
            <p className="w-full rounded-md bg-muted/60 px-3 py-2 text-left text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Your note:</span> {request.note}
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground/70">
            Submitted {new Date(request.requestedAt).toLocaleString()}
          </p>
        </div>
      </div>
    )
  }

  // ── Denied state (may re-request) ──────────────────────────────────────────
  const denied = request?.status === "denied" ? request : null

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6">
      {identity}
      <div className="flex w-full flex-col gap-5 rounded-xl border border-border bg-card p-8">
        {denied ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <ShieldX className="size-6 text-destructive" />
            </div>
            <div className="flex flex-col gap-1.5">
              <h1 className="text-lg font-semibold text-foreground">Request denied</h1>
              <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
                Your previous request was denied
                {denied.deniedReason ? (
                  <>
                    {": "}
                    <span className="font-medium text-foreground">{denied.deniedReason}</span>
                  </>
                ) : (
                  " by a system administrator."
                )}{" "}
                You may submit a new request below.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 text-center">
            <h1 className="text-lg font-semibold text-foreground">Request access</h1>
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              Your account doesn&apos;t have access to the platform yet. Choose the access type
              you need and a system administrator will review your request.
            </p>
          </div>
        )}

        <RadioGroup
          value={requestedRole}
          onValueChange={(v) => setRequestedRole(v === "admin" ? "admin" : "user")}
          className="flex flex-col gap-2.5"
        >
          {(
            [
              {
                value: "user" as const,
                icon: UserRound,
                title: "Regular user",
                desc: "Dashboards, telemetry, dispatching and reports.",
              },
              {
                value: "admin" as const,
                icon: ShieldCheck,
                title: "Administrator",
                desc: "Everything above, plus user management and security.",
              },
            ]
          ).map((opt) => (
            <Label
              key={opt.value}
              htmlFor={`role-${opt.value}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors",
                requestedRole === opt.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40",
              )}
            >
              <RadioGroupItem id={`role-${opt.value}`} value={opt.value} className="mt-0.5" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <opt.icon className="size-3.5 text-muted-foreground" />
                  {opt.title}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{opt.desc}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="access-note" className="text-xs text-muted-foreground">
            Note to the administrator (optional)
          </Label>
          <Textarea
            id="access-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Who you are and why you need access…"
            maxLength={500}
            rows={3}
            className="resize-none text-sm"
          />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button onClick={submit} disabled={isPending} className="w-full">
          {isPending ? "Submitting…" : denied ? "Submit new request" : "Request access"}
        </Button>
      </div>
    </div>
  )
}
