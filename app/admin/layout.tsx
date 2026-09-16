import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"

/**
 * Authoritative admin gate. The proxy already filters on session claims, but
 * claims require dashboard token customization — this layout re-verifies the
 * role via the Backend API on every request, so /admin is safe even on a
 * freshly connected Clerk instance (defense in depth).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in")
  if (user.role !== "admin") redirect("/")
  return <>{children}</>
}
