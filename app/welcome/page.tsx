import type { Metadata } from "next"
import Link from "next/link"
import { CheckCircle2 } from "lucide-react"
import { AuthShell } from "@/components/auth/auth-shell"

export const metadata: Metadata = {
  title: "Account updated — enexa",
  description: "Your enexa account is now active.",
}

/**
 * Post-activation confirmation screen (ENEXA onboarding guide step 4).
 * Invited users land here after completing the Clerk account-update flow:
 * a clean "account updated" confirmation with a single link back into the
 * application, mirroring the ENEXA "« Back to Application" pattern.
 * Public route (see proxy.ts) — the user may not have a session yet.
 */
export default function WelcomePage() {
  return (
    <AuthShell>
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-[#203366]/10">
          <CheckCircle2 className="size-8 text-[#E47A3C]" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold text-[#203366]">Account updated</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your account has been updated successfully and is now active. Sign in
          with your email and password to access the platform.
        </p>
        <Link
          href="/sign-in"
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#E47A3C] hover:text-[#d06c31]"
        >
          <span aria-hidden>&laquo;</span> Back to Application
        </Link>
      </div>
    </AuthShell>
  )
}
