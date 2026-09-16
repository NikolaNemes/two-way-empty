import { SignIn } from "@clerk/nextjs"
import type { Metadata } from "next"
import { AuthShell, clerkAppearance } from "@/components/auth/auth-shell"

export const metadata: Metadata = {
  title: "Sign in — enexa",
  description: "Sign in to the enexa energy operations platform.",
}

export default function SignInPage() {
  return (
    <AuthShell>
      {/* forceRedirectUrl goes STRAIGHT to /fleet: routing through "/" made
          Clerk's client-side navigation race the root page's server
          redirect("/fleet"), flashing "Application error" (or a blank shell)
          for a moment after every login. A relative path also sidesteps the
          allowedRedirectOrigins warning in preview environments. */}
      <SignIn appearance={clerkAppearance} forceRedirectUrl="/fleet" />
    </AuthShell>
  )
}
