import "server-only"

/**
 * Transactional emails (Resend) — ENEXA-style onboarding notifications.
 *
 * Modeled on the ENEXA Onboarding User Guide the client shared (aug 2026):
 * after an admin assigns/changes a role, the user receives a branded
 * confirmation email with a ROLES ASSIGNED section, a "Go to Platform"
 * button and a footer note about re-logging for changes to take effect.
 *
 * FAIL-SOFT BY DESIGN: email delivery must NEVER break the role change
 * itself. Every send is wrapped: missing RESEND_API_KEY or a provider error
 * returns { sent: false, reason } and the caller proceeds normally.
 *
 * FROM address: enexa.app verified in Resend on aug 26 2026 (EU region,
 * DKIM + SPF green, DNS on Vercel nameservers). Sending from the apex domain
 * — if deliverability ever needs isolating, verify mail.enexa.app and swap.
 */

const EMAIL_FROM = "Enexa Platform <no-reply@enexa.app>"
const APP_URL = "https://amperio.enexa.app"

/**
 * While EMAIL_FROM is the resend.dev sandbox sender, Resend only delivers to
 * the Resend account owner's own address — so INVITES must keep going through
 * Clerk's built-in sender (notify: true). The moment EMAIL_FROM is swapped to
 * a Resend-verified domain (e.g. no-reply@mail.enexa.app), this flips true and
 * invitation emails switch to the branded Resend template automatically.
 */
export const BRANDED_INVITES_ENABLED = !EMAIL_FROM.includes("resend.dev") && !!process.env.RESEND_API_KEY

/** enexa palette (mirrors auth-shell): navy brand panel + orange accent. */
const NAVY = "#203366"
const ORANGE = "#E47A3C"

export interface SendResult {
  sent: boolean
  /** Human-readable reason when not sent (missing key, provider error). */
  reason?: string
}

function roleLabel(role: string): string {
  if (role === "admin") return "Administrator"
  if (role === "user") return "User"
  return role
}

/**
 * Branded invitation email (ENEXA guide step 1 — "You're invited").
 * Used INSTEAD of Clerk's built-in invite email once BRANDED_INVITES_ENABLED
 * is true: Clerk creates the invitation with notify:false and hands us the
 * accept URL; we deliver it from the enexa domain. The link leads to account
 * setup (password) and then the /welcome confirmation screen.
 */
export async function sendInvitationEmail(params: {
  to: string
  inviteUrl: string
  role: string
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { sent: false, reason: "RESEND_API_KEY not configured" }
  const { to, inviteUrl, role } = params
  if (!to) return { sent: false, reason: "No recipient email" }
  if (!inviteUrl) return { sent: false, reason: "No invitation URL from Clerk" }

  const label = roleLabel(role)

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e6eb;">
        <tr>
          <td style="background-color:${NAVY};padding:24px 32px;">
            <span style="color:#ffffff;font-size:22px;font-weight:600;letter-spacing:-0.5px;">enexa</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 16px;font-size:20px;color:#1a2035;">You&rsquo;re invited to Enexa</h1>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3d4356;">
              Hello,
            </p>
            <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#3d4356;">
              You have been invited to the Enexa platform. Click the button below
              to set up your account and choose a password.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f8fa;border:1px solid #e4e6eb;border-radius:6px;margin-bottom:28px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1px;color:#6b7186;">YOUR ROLE</p>
                  <span style="display:inline-block;background-color:${NAVY};color:#ffffff;font-size:13px;font-weight:600;padding:6px 14px;border-radius:99px;">${label}</span>
                </td>
              </tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 8px;">
              <tr>
                <td style="background-color:${ORANGE};border-radius:6px;">
                  <a href="${inviteUrl}" style="display:inline-block;padding:12px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Set Up Your Account</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e4e6eb;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#8a90a3;">
              This invitation link is personal — please don't forward this email.
              If you weren't expecting this invitation, you can safely ignore it.
            </p>
            <p style="margin:12px 0 0;font-size:11px;color:#b2b7c6;">
              &copy; ${new Date().getFullYear()} enexa. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  try {
    const { Resend } = await import("resend")
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject: "You're invited to the Enexa Platform",
      html,
    })
    if (error) return { sent: false, reason: error.message }
    return { sent: true }
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "Send failed" }
  }
}

/**
 * Branded role-confirmation email (ENEXA guide step 5).
 * Sent after an admin assigns or changes a user's role.
 */
export async function sendRoleConfirmationEmail(params: {
  to: string
  name: string
  role: string
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { sent: false, reason: "RESEND_API_KEY not configured" }
  }
  const { to, name, role } = params
  if (!to || to === "—") return { sent: false, reason: "No recipient email" }

  const greeting = name && name !== "—" ? name : "there"
  const label = roleLabel(role)

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e6eb;">
        <!-- Header -->
        <tr>
          <td style="background-color:${NAVY};padding:24px 32px;">
            <span style="color:#ffffff;font-size:22px;font-weight:600;letter-spacing:-0.5px;">enexa</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 16px;font-size:20px;color:#1a2035;">Your account has been updated</h1>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3d4356;">
              Hello ${greeting},
            </p>
            <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#3d4356;">
              An administrator has updated your access on the Enexa platform. Your
              assigned role is listed below.
            </p>
            <!-- ROLES ASSIGNED block -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f8fa;border:1px solid #e4e6eb;border-radius:6px;margin-bottom:28px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1px;color:#6b7186;">ROLES ASSIGNED</p>
                  <span style="display:inline-block;background-color:${NAVY};color:#ffffff;font-size:13px;font-weight:600;padding:6px 14px;border-radius:99px;">${label}</span>
                </td>
              </tr>
            </table>
            <!-- CTA -->
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 8px;">
              <tr>
                <td style="background-color:${ORANGE};border-radius:6px;">
                  <a href="${APP_URL}" style="display:inline-block;padding:12px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Go to Platform</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e4e6eb;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#8a90a3;">
              Note: if you are currently logged in, please log out and log back in
              for the changes to take effect.
            </p>
            <p style="margin:12px 0 0;font-size:11px;color:#b2b7c6;">
              &copy; ${new Date().getFullYear()} enexa. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  try {
    // Lazy import keeps the module load cheap on paths that never send.
    const { Resend } = await import("resend")
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject: "Your Enexa account has been updated",
      html,
    })
    if (error) return { sent: false, reason: error.message }
    return { sent: true }
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "Send failed" }
  }
}
