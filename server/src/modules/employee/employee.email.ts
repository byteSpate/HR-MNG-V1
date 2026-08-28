/**
 * HR changing the sign-in address on somebody else's account.
 *
 * The deliberate opposite of the self-service flow in
 * `auth.emailchange.ts`. That one sends a link to the address on file and
 * waits; this one applies immediately, and the difference is the point.
 *
 * HR does this for people who **cannot** act for themselves — the invite went
 * to `jhon@` instead of `john@`, so the employee never received it and has no
 * inbox to approve from. Asking them to confirm would leave them exactly as
 * locked out as before. So the safeguards are different in kind, not weaker:
 *
 * - it is HR-only, not Finance and not a reporting manager
 * - it is written to the audit log with both addresses
 * - **both** addresses are notified, so a change nobody wanted is still
 *   visible to whoever was reading the old one
 * - every session is revoked, exactly as in the self-service path
 *
 * When the account has never been used, the invite is reissued to the new
 * address with a fresh temporary password. That is almost always the reason
 * HR is here, and correcting the address without reissuing would fix the
 * typo while leaving the person still unable to sign in. The old temporary
 * password is discarded rather than resent — it went to a stranger's inbox.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { assertAddressFree, normaliseEmail } from "../auth/auth.emailchange"
import { revokeAllUserTokens } from "../auth/auth.service"
import { generateTemporaryPassword, hashPassword } from "../auth/auth.utils"
import { sendCredentialsEmail } from "../auth/mailer"
import { sendEmailChangedNotice } from "../auth/mailer"
import type { AccessTokenPayload } from "../auth/auth.types"

export interface EmployeeEmailChangeResult {
  email: string
  previousEmail: string
  /** True when the invite was reissued because the account had never been used. */
  inviteResent: boolean
}

export async function changeEmployeeEmail(
  employeeId: string,
  rawNewEmail: string,
  actor: AccessTokenPayload
): Promise<EmployeeEmailChangeResult> {
  const newEmail = normaliseEmail(rawNewEmail)

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      userId: true,
      user: { select: { id: true, email: true, mustChangePassword: true } },
    },
  })
  if (!employee) throw new AppError(404, "Employee not found")
  if (!employee.user) throw new AppError(409, "That employee has no account to change")

  const previousEmail = employee.user.email
  if (normaliseEmail(previousEmail) === newEmail) {
    throw new AppError(400, "That is already the address on this account")
  }
  await assertAddressFree(newEmail)

  /**
   * `mustChangePassword` is the "never completed a first sign-in" signal —
   * it is set when the account is created and cleared the moment they choose
   * their own password. Preferred over counting sessions, which depends on
   * refresh tokens never being pruned.
   */
  const neverUsed = employee.user.mustChangePassword
  const temporaryPassword = neverUsed ? generateTemporaryPassword() : null

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: employee.user!.id },
      data: {
        email: newEmail,
        ...(temporaryPassword ? { passwordHash: await hashPassword(temporaryPassword) } : {}),
      },
    })
    await writeAudit(tx, {
      entity: "USER_ACCOUNT",
      entityId: employee.user!.id,
      action: "UPDATE",
      changedBy: actor.sub,
      before: { email: previousEmail },
      after: { email: newEmail, inviteResent: temporaryPassword !== null },
    })
  })

  // Whatever the reason, anybody signed in on the old identity is signed out.
  await revokeAllUserTokens(employee.user.id)

  if (temporaryPassword) {
    await sendCredentialsEmail({
      to: newEmail,
      identifier: employee.employeeCode,
      identifierLabel: "Employee ID",
      temporaryPassword,
    })
  }

  // Both addresses, always — including when the invite was reissued. The old
  // address is the only place a wrong change can still be spotted.
  await sendEmailChangedNotice({
    to: newEmail,
    previousEmail,
    newEmail,
    userId: employee.user.id,
  })
  await sendEmailChangedNotice({
    to: previousEmail,
    previousEmail,
    newEmail,
    userId: employee.user.id,
  })

  return { email: newEmail, previousEmail, inviteResent: temporaryPassword !== null }
}
