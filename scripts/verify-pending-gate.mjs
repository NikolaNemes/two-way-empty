// READ-ONLY probe: verifies the deny-by-default premise against the LIVE
// Clerk instance — an admin must exist, so resolveRole() would assign
// 'pending' (not 'user'/'admin') to the next brand-new SSO sign-in.
// No mutations. Run: node --env-file-if-exists=/vercel/share/.env.project scripts/verify-pending-gate.mjs
const key = process.env.CLERK_SECRET_KEY
if (!key) {
  console.error("CLERK_SECRET_KEY missing")
  process.exit(1)
}

const res = await fetch("https://api.clerk.com/v1/users?limit=100&order_by=created_at", {
  headers: { Authorization: `Bearer ${key}` },
})
if (!res.ok) {
  console.error("Clerk API error:", res.status, await res.text())
  process.exit(1)
}
const users = await res.json()

let admins = 0
let members = 0
let pending = 0
let roleless = 0
for (const u of users) {
  const role = u.public_metadata?.role
  if (role === "admin") admins++
  else if (role === "user") members++
  else if (role === "pending") pending++
  else roleless++
  const req = u.public_metadata?.accessRequest
  console.log(
    `[v0] ${u.email_addresses?.[0]?.email_address ?? u.id}: role=${role ?? "(none)"}` +
      (req ? ` accessRequest=${req.status} wants=${req.requestedRole}` : ""),
  )
}

console.log(`[v0] admins=${admins} users=${members} pending=${pending} roleless=${roleless}`)
const nextRole = admins > 0 ? "pending" : "admin (bootstrap)"
console.log(`[v0] resolveRole() for the NEXT brand-new sign-in would assign: ${nextRole}`)
if (admins === 0) {
  console.log("[v0] WARNING: no admin exists — first sign-in bootstraps as admin (expected only on a fresh instance)")
}
