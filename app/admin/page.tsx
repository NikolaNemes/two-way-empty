import type { Metadata } from "next"
import { AdminScreen, type AdminTab } from "@/components/admin/admin-screen"
import { listUsers, listInvitations, listAllSessions } from "@/app/actions/admin-users"
import { listAccessRequests } from "@/app/actions/access-requests"

export const metadata: Metadata = {
  title: "Users & Security — Enexa",
  description: "Access approvals, user management, sessions, invitations, and sign-in configuration.",
}

const VALID_TABS: AdminTab[] = ["users", "requests", "invitations", "sessions", "signin"]

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const defaultTab: AdminTab = VALID_TABS.includes(tab as AdminTab) ? (tab as AdminTab) : "users"

  // RSC-side initial load; the client screen mutates via server actions and
  // refreshes through revalidatePath.
  const [users, invitations, accessRequests, sessions] = await Promise.all([
    listUsers(),
    listInvitations(),
    listAccessRequests(),
    listAllSessions(),
  ])
  return (
    <AdminScreen
      initialUsers={users}
      initialInvitations={invitations}
      initialAccessRequests={accessRequests}
      initialSessions={sessions}
      defaultTab={defaultTab}
    />
  )
}
