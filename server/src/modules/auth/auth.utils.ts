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
