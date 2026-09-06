import { env } from "../../config/env"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { Role, type SalesRole } from "../../generated/prisma/client"
import { generateOpaqueToken, hashPassword, hashToken, signAccessToken, toPublicUser, verifyPassword } from "./auth.utils"
import { sendPasswordResetEmail } from "./mailer"
import { sendPasswordChangedEmail } from "../notification/notification.mailer"
import type { PublicUser } from "./auth.types"

export interface SessionResult {
  accessToken: string
  refreshToken: string
  user: PublicUser
}

type UserRow = {
  id: string
  email: string
  passwordHash: string
  role: Role
  salesRole: SalesRole | null
  isActive: boolean
  mustChangePassword: boolean
}

const STAFF_ROLES: Role[] = [Role.EMPLOYEE, Role.REPORTING_MANAGER]

function refreshExpiryDate(): Date {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_REFRESH_EXPIRY)
  const amount = match ? Number(match[1]) : 7
  const unit = match ? match[2] : "d"
  const msPerUnit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 86_400_000
  return new Date(Date.now() + amount * msPerUnit)
}

/**
 * Where a sign-in came from, as far as the request can say.
 *
 * Both are optional at every call site: a request without a user agent is
 * unusual but not an error, and recording "Unknown device" is better than
 * refusing to log somebody in over a missing header.
 */
export interface SessionContext {
  userAgent?: string | null
  ipAddress?: string | null
}

/**
 * A new session, or the next token in an existing one.
 *
 * `continuing` is what makes the sign-in list possible. Rotation writes a new
 * row on every refresh, so without carrying the session's identity forward,
 * one device would appear as a new entry every fifteen minutes and no session
 * could be signed out individually.
 */
async function issueRefreshToken(
  userId: string,
  context: SessionContext,
  continuing?: { sessionId: string; startedAt: Date; userAgent: string | null }
): Promise<string> {
  const raw = generateOpaqueToken()
  const now = new Date()
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: refreshExpiryDate(),
      ...(continuing
        ? {
            sessionId: continuing.sessionId,
            startedAt: continuing.startedAt,
            // The browser does not change mid-session; the address can, and
            // where a session is *now* is the fact worth showing.
            userAgent: continuing.userAgent,
          }
        : { startedAt: now, userAgent: context.userAgent ?? null }),
      lastUsedAt: now,
      ipAddress: context.ipAddress ?? null,
    },
  })
  return raw
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

async function issueSession(
  user: UserRow,
  context: SessionContext,
  employeeCode?: string
): Promise<SessionResult> {
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    mustChangePassword: user.mustChangePassword,
    salesRole: user.salesRole ?? null,
  })
  const refreshToken = await issueRefreshToken(user.id, context)
  return { accessToken, refreshToken, user: toPublicUser(user, employeeCode) }
}

export async function loginAdmin(
  email: string,
  password: string,
  context: SessionContext = {}
): Promise<SessionResult> {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    throw new AppError(401, "Invalid email or password")
  }
  if (STAFF_ROLES.includes(user.role)) {
    throw new AppError(401, "Invalid email or password")
  }
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    throw new AppError(401, "Invalid email or password")
  }
  if (!user.isActive) {
    throw new AppError(403, "This account has been deactivated")
  }
  return issueSession(user, context)
}

export async function loginStaff(
  employeeId: string,
  password: string,
  context: SessionContext = {}
): Promise<SessionResult> {
  const employee = await prisma.employee.findUnique({
    where: { employeeCode: employeeId },
    include: { user: true },
  })
  if (!employee) {
    throw new AppError(401, "Invalid ID or password")
  }
  const user = employee.user
  if (!STAFF_ROLES.includes(user.role)) {
    throw new AppError(401, "Invalid ID or password")
  }
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    throw new AppError(401, "Invalid ID or password")
  }
  if (!user.isActive) {
    throw new AppError(403, "This account has been deactivated")
  }
  return issueSession(user, context, employee.employeeCode)
}

export async function refresh(
  rawRefreshToken: string,
  context: SessionContext = {}
): Promise<SessionResult> {
  const tokenHash = hashToken(rawRefreshToken)
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  })
  if (!stored) {
    throw new AppError(401, "Invalid refresh token")
  }
  if (stored.revokedAt) {
    throw new AppError(401, "Refresh token has been revoked")
  }
  if (stored.expiresAt.getTime() < Date.now()) {
    throw new AppError(401, "Refresh token has expired")
  }
  if (!stored.user.isActive) {
    throw new AppError(403, "This account has been deactivated")
  }

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } })

  let employeeCode: string | undefined
  if (STAFF_ROLES.includes(stored.user.role)) {
    const employee = await prisma.employee.findUnique({ where: { userId: stored.user.id } })
    employeeCode = employee?.employeeCode
  }

  // The replacement token joins the same session rather than starting a new
  // one. `startedAt` and `userAgent` come off the row being replaced; the
  // address comes off this request, so a session that moved shows where it
  // moved to.
  const newRefreshToken = await issueRefreshToken(stored.user.id, context, {
    sessionId: stored.sessionId,
    startedAt: stored.startedAt,
    userAgent: stored.userAgent,
  })
  const accessToken = signAccessToken({
    sub: stored.user.id,
    role: stored.user.role,
    email: stored.user.email,
    mustChangePassword: stored.user.mustChangePassword,
    salesRole: stored.user.salesRole ?? null,
  })
  return { accessToken, refreshToken: newRefreshToken, user: toPublicUser(stored.user, employeeCode) }
}

export async function logout(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken)
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } })
  if (!stored) {
    return
  }
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } })
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * The narrowest useful defence against mail-bombing: this application has no
 * request-level rate limiting at all, so `POST /forgot-password` can be called
 * in a loop against any address an attacker can guess. Refusing to *create a
 * token* stops the send, which is where the cost is, without a store that has
 * to work across dynos. A real limiter is a separate task.
 */
export const TOKEN_COOLDOWN_MS = 60_000

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    return // don't reveal whether the email exists
  }
  const recent = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - TOKEN_COOLDOWN_MS) } },
    select: { id: true },
  })
  // Silent, like the unknown-email branch above: telling the caller they are
  // being throttled tells them the address exists.
  if (recent) return

  const raw = generateOpaqueToken()
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  })
  const resetLink = `${env.CLIENT_ORIGIN}/reset-password?token=${raw}`
  await sendPasswordResetEmail(email, resetLink)
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(rawToken)
  // The account's address is pulled in with the token: reset completion sends
  // a PASSWORD_CHANGED notice, and this is the only read on the path.
  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { email: true } } },
  })
  if (!stored) {
    throw new AppError(400, "Invalid or expired reset token")
  }
  if (stored.usedAt) {
    throw new AppError(400, "This reset token has already been used")
  }
  if (stored.expiresAt.getTime() < Date.now()) {
    throw new AppError(400, "This reset token has expired")
  }

  const passwordHash = await hashPassword(newPassword)
  await prisma.user.update({
    where: { id: stored.userId },
    data: { passwordHash, mustChangePassword: false },
  })
  await prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } })
  await revokeAllUserTokens(stored.userId)
  // Reset is precisely the flow an attacker uses, so this is the notification
  // that matters most. Not sent on the forced first-login change, where the
  // temporary password was emailed to this same address minutes earlier.
  if (stored.user?.email) {
    await sendPasswordChangedEmail({ to: stored.user.email, userId: stored.userId })
  }
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  context: SessionContext = {}
): Promise<{ accessToken: string; refreshToken: string; user: PublicUser }> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    throw new AppError(404, "User not found")
  }
  const valid = await verifyPassword(currentPassword, user.passwordHash)
  if (!valid) {
    throw new AppError(401, "Current password is incorrect")
  }
  const passwordHash = await hashPassword(newPassword)
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
  })
  // Revoke every existing session (e.g. one stolen alongside the old password), then
  // issue a fresh refresh token so the caller's own session survives the revocation.
  await revokeAllUserTokens(userId)
  // A new session rather than a continuation: every other device was just
  // signed out, and the sign-in list should show this one starting here.
  const refreshToken = await issueRefreshToken(userId, context)
  const accessToken = signAccessToken({
    sub: updated.id,
    role: updated.role,
    email: updated.email,
    mustChangePassword: false,
    salesRole: updated.salesRole ?? null,
  })
  // If it was not them, they find out in seconds.
  await sendPasswordChangedEmail({ to: updated.email, userId: updated.id })
  return { accessToken, refreshToken, user: toPublicUser(updated) }
}
