/**
 * Changing the address an account signs in with.
 *
 * Kept out of `auth.service.ts` because it is a workflow rather than a
 * request/response pair, and because the reasoning below is worth having in
 * one place rather than scattered across four handlers.
 *
 * ## Why two links and not one
 *
 * An email address here is not a contact detail. It is the sign-in identity
 * *and* the password-reset target, so whoever controls the address controls
 * the account. That makes a change of address a security operation.
 *
 * One link cannot do the job, because there are two different questions:
 *
 * - **Did the owner ask for this?** Only a link sent to the address already on
 *   file can answer that. Without it, anyone with a borrowed session types
 *   their own address, receives the link at their own inbox, clicks it, and
 *   owns the account permanently.
 * - **Is the new address real?** Only a link sent to the new address can
 *   answer that. Without it, a typo that got approved points the account at an
 *   inbox nobody reads, and the owner is locked out with no way back.
 *
 * Each catches exactly what the other misses. So: approve from the old
 * address, then confirm at the new one, and only then does anything change.
 *
 * ## What the HR path does instead
 *
 * `employee.service.ts` has its own entry point, and it deliberately skips
 * both links. It exists for the cases where the employee *cannot* act — a
 * typo in the original invite means they never received it — so requiring
 * them to approve from an inbox they cannot reach would defeat the purpose.
 * That path applies immediately, is audited, and notifies both addresses.
 */

import prisma from "../../config/prisma"
import { env } from "../../config/env"
import { AppError } from "../../middleware/errorHandler"
import { generateOpaqueToken, hashToken } from "./auth.utils"
import { revokeAllUserTokens } from "./auth.service"
import {
  sendEmailChangeApprovalEmail,
  sendEmailChangeConfirmEmail,
  sendEmailChangedNotice,
} from "./mailer"

/**
 * Both stages must happen inside this window, matching the password reset.
 * The security gate is the old inbox, not the clock — but a request left open
 * for days is a link sitting in an inbox waiting to be found.
 */
const REQUEST_TTL_MS = 60 * 60 * 1000

/** Stops a request being used to post repeatedly into somebody's inbox. */
const COOLDOWN_MS = 60_000

/**
 * Addresses are compared and stored lower-cased. Without this `Sales@` and
 * `sales@` are two rows against a `@unique` column that considers them
 * different, and one person ends up with two accounts.
 */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase()

/** The shape the client needs to show "a change is pending". */
export interface PendingEmailChange {
  newEmail: string
  /** Whether the owner has approved it from their current address yet. */
  approved: boolean
  expiresAt: string
}

function live(now = Date.now()) {
  return {
    completedAt: null,
    cancelledAt: null,
    expiresAt: { gt: new Date(now) },
  }
}

/**
 * Step 1. Starts a change and emails the address **currently on file**.
 *
 * Note what is *not* sent here: nothing goes to the new address yet. Mailing
 * it before the owner has approved would let anyone with a session use this
 * endpoint to send mail to an arbitrary address, which is a spam relay wearing
 * a feature's clothes.
 */
export async function requestEmailChange(
  userId: string,
  rawNewEmail: string
): Promise<PendingEmailChange> {
  const newEmail = normaliseEmail(rawNewEmail)

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  })
  if (!user) throw new AppError(404, "Account not found")

  if (normaliseEmail(user.email) === newEmail) {
    throw new AppError(400, "That is already the address on this account")
  }

  // Checked here for a clear message, and again at the end because somebody
  // else can take it in the meantime.
  await assertAddressFree(newEmail)

  const recent = await prisma.emailChangeRequest.findFirst({
    where: { userId, createdAt: { gt: new Date(Date.now() - COOLDOWN_MS) } },
    select: { id: true },
  })
  if (recent) {
    throw new AppError(429, "A change was just requested. Check your inbox, or try again shortly.")
  }

  const rawApprove = generateOpaqueToken()
  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS)

  const created = await prisma.$transaction(async (tx) => {
    // At most one live request per account. Two open requests means two
    // approve links in an inbox, and the owner cannot tell which is which.
    await tx.emailChangeRequest.updateMany({
      where: { userId, ...live() },
      data: { cancelledAt: new Date() },
    })
    return tx.emailChangeRequest.create({
      data: {
        userId,
        newEmail,
        approveTokenHash: hashToken(rawApprove),
        expiresAt,
      },
    })
  })

  await sendEmailChangeApprovalEmail({
    to: user.email,
    newEmail,
    approveLink: `${env.CLIENT_ORIGIN}/email-change/approve?token=${rawApprove}`,
    userId,
  })

  return { newEmail: created.newEmail, approved: false, expiresAt: expiresAt.toISOString() }
}

/**
 * Step 2. The owner clicked the link in their current inbox.
 *
 * Only now is a confirm token minted, and only now does the new address hear
 * anything at all.
 */
export async function approveEmailChange(rawToken: string): Promise<{ newEmail: string }> {
  const request = await requestByApproveToken(rawToken)

  const rawConfirm = generateOpaqueToken()
  await prisma.emailChangeRequest.update({
    where: { id: request.id },
    data: { approvedAt: new Date(), confirmTokenHash: hashToken(rawConfirm) },
  })

  await sendEmailChangeConfirmEmail({
    to: request.newEmail,
    confirmLink: `${env.CLIENT_ORIGIN}/email-change/confirm?token=${rawConfirm}`,
    userId: request.userId,
  })

  return { newEmail: request.newEmail }
}

/**
 * Step 2, refused. "This wasn't me."
 *
 * Deliberately uses the same token as approval: whoever can approve can also
 * refuse, and both prove the same thing — control of the address on file.
 * Sessions are revoked, because somebody being able to start this at all
 * means somebody else may be holding a session on this account.
 */
export async function cancelEmailChange(rawToken: string): Promise<void> {
  const request = await requestByApproveToken(rawToken)
  await prisma.emailChangeRequest.update({
    where: { id: request.id },
    data: { cancelledAt: new Date() },
  })
  await revokeAllUserTokens(request.userId)
}

/**
 * Step 3. The new inbox proved it exists. Apply the change.
 *
 * The collision check runs again here, against the same race the first one
 * cannot cover: an address free an hour ago may belong to somebody by now.
 */
export async function confirmEmailChange(rawToken: string): Promise<{ email: string }> {
  const tokenHash = hashToken(rawToken)
  const request = await prisma.emailChangeRequest.findUnique({
    where: { confirmTokenHash: tokenHash },
    include: { user: { select: { id: true, email: true } } },
  })

  assertUsable(request, "confirmation")
  if (!request!.approvedAt) {
    // Unreachable while a confirm token is only minted at approval, but the
    // rule is the point of the design and should not depend on that.
    throw new AppError(400, "This change has not been approved from the current address yet")
  }

  const req = request!
  await assertAddressFree(req.newEmail)
  const previousEmail = req.user.email

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: req.userId }, data: { email: req.newEmail } })
    await tx.emailChangeRequest.update({
      where: { id: req.id },
      data: { completedAt: new Date() },
    })
  })

  // Everywhere else is signed out. If this change was hostile, this is the
  // moment it costs the attacker their session; if it was not, it costs the
  // owner one sign-in on their phone.
  await revokeAllUserTokens(req.userId)

  // Both addresses. The new one because it is now the account, the old one
  // because it is the only place a wrongly-approved change can still be
  // noticed.
  await sendEmailChangedNotice({ to: req.newEmail, previousEmail, newEmail: req.newEmail, userId: req.userId })
  await sendEmailChangedNotice({ to: previousEmail, previousEmail, newEmail: req.newEmail, userId: req.userId })

  return { email: req.newEmail }
}

/** What the profile screen shows while a change is in flight. */
export async function getPendingEmailChange(userId: string): Promise<PendingEmailChange | null> {
  const request = await prisma.emailChangeRequest.findFirst({
    where: { userId, ...live() },
    orderBy: { createdAt: "desc" },
  })
  if (!request) return null
  return {
    newEmail: request.newEmail,
    approved: request.approvedAt !== null,
    expiresAt: request.expiresAt.toISOString(),
  }
}

// ── Shared checks ─────────────────────────────

/**
 * Refuses an address already in use.
 *
 * Deactivated accounts count. An address on a disabled account is not free —
 * it is one `isActive` flip away from being a second live account on the same
 * address, and the `@unique` column would reject it anyway with a message
 * nobody can act on.
 */
export async function assertAddressFree(email: string): Promise<void> {
  const taken = await prisma.user.findUnique({
    where: { email: normaliseEmail(email) },
    select: { id: true },
  })
  if (taken) {
    throw new AppError(409, "That email address is already in use on another account")
  }
}

async function requestByApproveToken(rawToken: string) {
  const request = await prisma.emailChangeRequest.findUnique({
    where: { approveTokenHash: hashToken(rawToken) },
  })
  assertUsable(request, "approval")
  return request!
}

/**
 * One place for the four ways a link can be dead, each with its own sentence.
 * "Invalid or expired" collapses a link somebody already used, a change they
 * cancelled, and a typo into one message that helps with none of them.
 */
function assertUsable(
  request: { completedAt: Date | null; cancelledAt: Date | null; expiresAt: Date } | null,
  what: string
): void {
  if (!request) throw new AppError(400, `That ${what} link is not valid`)
  if (request.completedAt) throw new AppError(400, "This email change has already been completed")
  if (request.cancelledAt) throw new AppError(400, "This email change was cancelled")
  if (request.expiresAt.getTime() < Date.now()) {
    throw new AppError(400, `That ${what} link has expired. Start the change again.`)
  }
}
