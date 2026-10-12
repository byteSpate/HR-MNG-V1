/**
 * Sending the temporary password again.
 *
 * A new account gets a temporary password by email once, at creation. If that
 * email is lost, deleted or never arrives, the person cannot sign in and has
 * no way to ask for another: the only way out used to be changing their email
 * address, which reissues the password as a side effect (`employee.email.ts`).
 * This is the direct way.
 *
 * Only for an account that has never had its own password chosen
 * (`mustChangePassword`). Everybody else has Forgot password, and this must
 * not become a way for an admin to take over a working account.
 *
 * Shared by `POST /api/users/:id/resend-invite` and
 * `POST /api/employees/:id/resend-invite`, which differ only in how they find
 * the user id.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { revokeAllUserTokens, STAFF_ROLES } from "./auth.service"
import type { AccessTokenPayload } from "./auth.types"
import { generateTemporaryPassword, hashPassword } from "./auth.utils"
import { sendCredentialsEmail } from "./mailer"

/**
 * The same narrow defence as `TOKEN_COOLDOWN_MS`: the app has no request rate
 * limit, and each send costs an email. Measured on the audit log so it holds
 * across dynos without a store of its own.
 */
export const INVITE_COOLDOWN_MS = 60_000

/** Doubles as the key the wait time looks for, so it is one constant. */
const SENT_NOTE = "Temporary password sent again"

export interface ResendInviteResult {
  id: string
  email: string
  /** Returned once, like account creation, so an admin can pass it on if mail fails. */
  temporaryPassword: string
}

export async function resendInvite(
  userId: string,
  actor: AccessTokenPayload
): Promise<ResendInviteResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
      employee: { select: { employeeCode: true } },
    },
  })
  if (!user) throw new AppError(404, "We could not find this account.")

  // Replacing a Super Admin's password is not part of HR's work, the same
  // line `/api/users` draws for every other account action.
  if (user.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new AppError(403, "Only a Super Admin can send a password for a Super Admin account.")
  }
  if (!user.mustChangePassword) {
    throw new AppError(
      409,
      "This person already chose their own password. Ask them to use Forgot password on the sign-in page."
    )
  }
  if (!user.isActive) {
    throw new AppError(409, "This account is turned off. Turn it on first, then send the password again.")
  }

  const recent = await prisma.auditLog.findFirst({
    where: {
      entity: "USER_ACCOUNT",
      entityId: user.id,
      action: "SEND",
      note: SENT_NOTE,
      changedAt: { gt: new Date(Date.now() - INVITE_COOLDOWN_MS) },
    },
    select: { id: true },
  })
  if (recent) {
    throw new AppError(429, "A password was sent a moment ago. Wait one minute, then try again.")
  }

  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: true },
    })
    // The password itself is never written here.
    await writeAudit(tx, {
      entity: "USER_ACCOUNT",
      entityId: user.id,
      action: "SEND",
      changedBy: actor.sub,
      note: SENT_NOTE,
    })
  })

  // The old password may already be somewhere it should not be, and the
  // person may have signed in with it to reach the change-password screen.
  await revokeAllUserTokens(user.id)

  // Staff sign in with their Employee ID; everyone else with an address. The
  // same split the two login routes make.
  const usesEmployeeId = STAFF_ROLES.includes(user.role) && user.employee !== null
  // Swallowed like creation: a dead mail server must not undo the new
  // password, which is returned below. The failure is an EmailDispatch row.
  await sendCredentialsEmail({
    to: user.email,
    identifier: usesEmployeeId ? user.employee!.employeeCode : user.email,
    identifierLabel: usesEmployeeId ? "Employee ID" : "Email address",
    temporaryPassword,
  }).catch((err) => {
    console.error("Failed to send credentials email", err)
  })

  return { id: user.id, email: user.email, temporaryPassword }
}
