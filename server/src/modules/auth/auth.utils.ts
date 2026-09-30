import { createHash, randomBytes, randomInt } from "node:crypto"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"

import { env } from "../../config/env"
import type { AccessTokenPayload, PublicUser } from "./auth.types"

const SALT_ROUNDS = 12
const TEMP_PASSWORD_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
const TEMP_PASSWORD_LENGTH = 10

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRY as jwt.SignOptions["expiresIn"] })
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload
}

/**
 * How long a refresh token lives, in milliseconds, from a setting like "7d".
 *
 * One place, used for the token's own expiry in the database and for the
 * browser cookie that carries it. Two separate readings of the same setting
 * once disagreed: the database kept the token for seven days while the cookie
 * had no lifetime at all and was dropped when the browser closed.
 */
export function refreshLifetimeMs(setting: string = env.JWT_REFRESH_EXPIRY): number {
  const match = /^(\d+)([smhd])$/.exec(setting)
  const amount = match ? Number(match[1]) : 7
  const unit = match ? match[2] : "d"
  const msPerUnit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 86_400_000
  return amount * msPerUnit
}

export function generateOpaqueToken(): string {
  return randomBytes(40).toString("hex")
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function generateTemporaryPassword(): string {
  return Array.from(
    { length: TEMP_PASSWORD_LENGTH },
    () => TEMP_PASSWORD_CHARSET[randomInt(TEMP_PASSWORD_CHARSET.length)]
  ).join("")
}

export function toPublicUser(
  user: {
    id: string
    email: string
    role: PublicUser["role"]
    isActive: boolean
    mustChangePassword: boolean
    salesRole?: PublicUser["salesRole"] | null
  },
  employeeCode?: string
): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    employeeCode,
    salesRole: user.salesRole ?? null,
  }
}
