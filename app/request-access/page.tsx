import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { AuthShell } from "@/components/auth/auth-shell"
import { RequestAccessScreen } from "@/components/request-access-screen"
import { getCurrentUser } from "@/lib/auth"

export const metadata: Metadata = {
  title: "Request access — enexa",
  description: "Request access to the enexa energy operations platform.",
}

/**
 * The ONLY page a signed-in-but-unapproved ('pending') user can load — the
 * proxy locks everything else. Server-side render resolves the authoritative
 * role (this is also what assigns 'pending' to a brand-new SSO sign-in via
 * resolveRole) and bounces approved users home immediately.
 */
export default async function RequestAccessPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in")
  if (user.role === "admin" || user.role === "user") redirect("/")

  return (
    <AuthShell>
      <RequestAccessScreen
        name={user.name}
        email={user.email}
        initialRequest={user.accessRequest}
      />
    </AuthShell>
  )
}
