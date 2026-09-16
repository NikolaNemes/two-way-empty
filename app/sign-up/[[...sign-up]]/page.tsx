import { SignUp } from "@clerk/nextjs"
import type { Metadata } from "next"
import { AuthShell, clerkAppearance } from "@/components/auth/auth-shell"

export const metadata: Metadata = {
  title: "Create account — enexa",
  description: "Accept your invitation to the enexa energy operations platform.",
}

/**
 * INVITE-ONLY: with sign-up mode set to Restricted in the Clerk Dashboard,
 * this page only completes registrations arriving through an invitation
 * link (__clerk_ticket). Direct visitors see Clerk's restricted-access
 * message instead of a working form.
 */
export default function SignUpPage() {
  return (
    <AuthShell>
      {/* Invited users arrive here with a __clerk_ticket — <SignUp> consumes
          it (account + password). After completion they land on the branded
          /welcome confirmation (ENEXA onboarding step 4); its "Back to
          Application" link takes them into the app with the fresh session. */}
      <SignUp appearance={clerkAppearance} forceRedirectUrl="/welcome" />
    </AuthShell>
  )
}
