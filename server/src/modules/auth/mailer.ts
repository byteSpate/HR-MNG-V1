// The transport, its dev-mode console fallback and the EmailDispatch log all
// live in src/utils/mailer, so every module sends the same way and no send
// can escape the log. The shared Advice-Form markup lives in src/templates.
import { env } from "../../config/env"
import { renderEmail, serialFor } from "../../templates/email"
import { sendMail } from "../../utils/mailer"

export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  const kind = "PASSWORD_RESET" as const
  await sendMail({
    to,
    kind,
    subject: `Reset your ${env.COMPANY_NAME} password`,
    text: `Reset your password: ${resetLink}`,
    html: renderEmail({
      serial: serialFor(kind),
      subject: `Reset your ${env.COMPANY_NAME} password`,
      stamp: { label: "Action required", tone: "action" },
      intro: "We received a request to reset the password for your account.",
      action: {
        label: "Reset password",
        href: resetLink,
        note: "If you didn't request this, ignore this email — your password stays unchanged.",
      },
      footer: `You are receiving this because a password reset was requested for this address at ${env.COMPANY_NAME}.`,
    }),
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
  const kind = "CREDENTIALS" as const
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

  await sendMail({
    to: input.to,
    kind,
    subject: `Your ${env.COMPANY_NAME} account is ready`,
    text,
    html: renderEmail({
      serial: serialFor(kind),
      subject: `Your ${env.COMPANY_NAME} account is ready`,
      stamp: { label: "Action required", tone: "action" },
      intro: "Your account has been created. Here is how you sign in:",
      facts: [
        { label: input.identifierLabel, value: input.identifier },
        { label: "Temporary password", value: input.temporaryPassword },
      ],
      prose: ["You'll be asked to change this password on first sign-in."],
      action: { label: "Sign in", href: loginUrl },
      footer: `You are receiving this because an account was created for you at ${env.COMPANY_NAME}.`,
    }),
  })
}
