// The transport, its dev-mode console fallback and the EmailDispatch log all
// live in src/utils/mailer, so every module sends the same way and no send
// can escape the log.
import { env } from "../../config/env"
import { sendMail } from "../../utils/mailer"

export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  await sendMail({
    to,
    kind: "PASSWORD_RESET",
    subject: "Reset your PeopleCore password",
    text: `Reset your password: ${resetLink}`,
    html: `<p>Reset your password: <a href="${resetLink}">${resetLink}</a></p>`,
  })
}

export interface CredentialsEmailInput {
  to: string
  /** The employee code for staff, the email address for everyone else. */
  identifier: string
  /** "Employee ID" or "Email address" — what the sign-in form asks for. */
  identifierLabel: string
  temporaryPassword: string
}

/**
 * Replaces `sendStaffCredentialsEmail`, which hardcoded "Your employee ID" —
 * wrong for a Finance Officer, who signs in with an email address at
 * /api/auth/login rather than an employee code at /api/auth/staff-login.
 */
export async function sendCredentialsEmail(input: CredentialsEmailInput): Promise<void> {
  const loginUrl = `${env.CLIENT_ORIGIN}/login`
  const text = [
    `Your ${env.COMPANY_NAME} account is ready.`,
    ``,
    `${input.identifierLabel}: ${input.identifier}`,
    `Temporary password: ${input.temporaryPassword}`,
    ``,
    `Sign in at ${loginUrl}`,
    `You'll be asked to change this password on first login.`,
  ].join("\n")
  const html = `<p>Your ${env.COMPANY_NAME} account is ready.</p>
    <p>${input.identifierLabel}: <strong>${input.identifier}</strong><br />
       Temporary password: <strong>${input.temporaryPassword}</strong></p>
    <p><a href="${loginUrl}">Sign in</a>. You'll be asked to change this password on first login.</p>`

  await sendMail({
    to: input.to,
    kind: "CREDENTIALS",
    subject: `Your ${env.COMPANY_NAME} account is ready`,
    text,
    html,
  })
}
