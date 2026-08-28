// The transport, its dev-mode console fallback and the EmailDispatch log all
// live in src/utils/mailer, so every module sends the same way and no send
// can escape the log. The shared Advice-Form markup lives in src/templates.
import { env } from "../../config/env"
import { renderEmail, serialFor } from "../../templates/email"
import { notify, sendMail } from "../../utils/mailer"

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

// ── Changing the address on an account ────────

/**
 * To the address **currently on file**, asking the owner to approve.
 *
 * This is the one email in the flow that has to be read by a human who might
 * not have asked for it, so it leads with what is happening and to which
 * address — not with the button. Somebody skimming it in a notification
 * preview should be able to tell a change they started from one they did not.
 *
 * Sent with `sendMail`, not `notify`: if this never leaves, the request is
 * stranded with a link nobody has, and the caller needs to know that rather
 * than being told to check an inbox that will stay empty.
 */
export async function sendEmailChangeApprovalEmail(i: {
  to: string
  newEmail: string
  approveLink: string
  userId: string
}): Promise<void> {
  const kind = "EMAIL_CHANGE_WARNING" as const
  const subject = `Approve the email change on your ${env.COMPANY_NAME} account`
  await sendMail({
    to: i.to,
    kind,
    subject,
    text: [
      `Someone asked to change the email address on your ${env.COMPANY_NAME} account to ${i.newEmail}.`,
      ``,
      `If that was you, approve it here: ${i.approveLink}`,
      ``,
      `If it was not you, do not click the link. Change your password now and tell your administrator —`,
      `whoever asked for this can currently sign in as you.`,
    ].join("\n"),
    html: renderEmail({
      serial: serialFor(kind, i.userId),
      subject,
      stamp: { label: "Action required", tone: "action" },
      intro: `Someone asked to change the email address on your account to ${i.newEmail}. Nothing has changed yet.`,
      action: {
        label: "Yes, this was me",
        href: i.approveLink,
        note: "If it was not you, do not click. Change your password now and tell your administrator — whoever asked for this can currently sign in as you.",
      },
      footer: `You are receiving this because someone asked to move this ${env.COMPANY_NAME} account to a different address.`,
    }),
  })
}

/**
 * To the **new** address, once the owner has approved.
 *
 * Proves the inbox is real and reachable. Without this step an approved typo
 * points the account at an address nobody reads, and the owner is locked out
 * with no way back in.
 */
export async function sendEmailChangeConfirmEmail(i: {
  to: string
  confirmLink: string
  userId: string
}): Promise<void> {
  const kind = "EMAIL_CHANGE_CONFIRM" as const
  const subject = `Confirm this address for your ${env.COMPANY_NAME} account`
  await sendMail({
    to: i.to,
    kind,
    subject,
    text: [
      `This address was given as the new sign-in address for a ${env.COMPANY_NAME} account.`,
      ``,
      `Confirm it here: ${i.confirmLink}`,
      ``,
      `If you were not expecting this, ignore this email. Nothing will change.`,
    ].join("\n"),
    html: renderEmail({
      serial: serialFor(kind, i.userId),
      subject,
      stamp: { label: "Action required", tone: "action" },
      intro: `This address was given as the new sign-in address for a ${env.COMPANY_NAME} account. One more click and it takes effect.`,
      action: {
        label: "Confirm this address",
        href: i.confirmLink,
        note: "If you were not expecting this, ignore this email. Nothing will change.",
      },
      footer: `You are receiving this because this address was given as the new sign-in address for a ${env.COMPANY_NAME} account.`,
    }),
  })
}

/**
 * To **both** addresses once the change is done: the new one because it is
 * now the account, the old one because it is the last place a change nobody
 * wanted can still be noticed.
 *
 * Sent with `notify`, unlike the two above. The address has already changed by
 * this point, and a mail outage must not surface as a failure on an operation
 * that succeeded — the same reasoning as `sendPasswordChangedEmail`.
 */
export async function sendEmailChangedNotice(i: {
  to: string
  previousEmail: string
  newEmail: string
  userId: string
}): Promise<void> {
  const kind = "EMAIL_CHANGED" as const
  const subject = `Your ${env.COMPANY_NAME} sign-in address has changed`
  await notify({
    to: i.to,
    kind,
    subject,
    text: [
      `The sign-in address on your ${env.COMPANY_NAME} account changed from ${i.previousEmail} to ${i.newEmail}.`,
      ``,
      `You have been signed out everywhere. Sign in again with the new address.`,
      ``,
      `If this was not you, tell your administrator immediately.`,
    ].join("\n"),
    html: renderEmail({
      serial: serialFor(kind, i.userId),
      subject,
      stamp: { label: "Security notice", tone: "notice" },
      intro: `The sign-in address on this account changed from ${i.previousEmail} to ${i.newEmail}. You have been signed out everywhere and will need to sign in again with the new address.`,
      action: {
        label: "Sign in",
        href: `${env.CLIENT_ORIGIN}/login`,
        note: "If this was not you, tell your administrator immediately.",
      },
      footer: `You are receiving this because the sign-in address on a ${env.COMPANY_NAME} account was changed.`,
    }),
  })
}
