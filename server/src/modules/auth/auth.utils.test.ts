import { describe, expect, it } from "vitest"
import {
  generateOpaqueToken,
  generateTemporaryPassword,
  hashPassword,
  hashToken,
  signAccessToken,
  toPublicUser,
  verifyAccessToken,
  verifyPassword,
} from "./auth.utils"

describe("password hashing", () => {
  it("hashes a password and verifies it correctly", async () => {
    const hash = await hashPassword("correct-horse-battery-staple")
    expect(hash).not.toBe("correct-horse-battery-staple")
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true)
    expect(await verifyPassword("wrong-password", hash)).toBe(false)
  })
})

describe("access tokens", () => {
  const payload = { sub: "user-1", role: "EMPLOYEE" as const, email: "a@b.com", mustChangePassword: false, salesRole: null }

  it("round-trips a payload through sign and verify", () => {
    const token = signAccessToken(payload)
    const decoded = verifyAccessToken(token)
    expect(decoded).toMatchObject(payload)
  })

  it("throws on a tampered token", () => {
    const token = signAccessToken(payload)
    expect(() => verifyAccessToken(token + "x")).toThrow()
  })
})

describe("opaque tokens", () => {
  it("generates a non-empty random token and hashes it deterministically", () => {
    const token = generateOpaqueToken()
    expect(token.length).toBeGreaterThan(20)
    expect(hashToken(token)).toBe(hashToken(token))
    expect(hashToken(token)).not.toBe(token)
  })

  it("generates different tokens on each call", () => {
    expect(generateOpaqueToken()).not.toBe(generateOpaqueToken())
  })
})

describe("generateTemporaryPassword", () => {
  it("generates a 10-character password with no ambiguous characters", () => {
    const password = generateTemporaryPassword()
    expect(password).toHaveLength(10)
    expect(password).not.toMatch(/[0O1lI]/)
  })

  it("generates different passwords on each call", () => {
    expect(generateTemporaryPassword()).not.toBe(generateTemporaryPassword())
  })
})

describe("toPublicUser", () => {
  it("maps a user row to the public shape, omitting passwordHash", () => {
    const user = {
      id: "u1",
      email: "a@b.com",
      role: "EMPLOYEE" as const,
      isActive: true,
      mustChangePassword: true,
    }
    expect(toPublicUser(user)).toEqual({
      id: "u1",
      email: "a@b.com",
      role: "EMPLOYEE",
      isActive: true,
      mustChangePassword: true,
      employeeCode: undefined,
      salesRole: null,
    })
  })

  it("carries salesRole through when the user has Sales Hub access", () => {
    const user = {
      id: "u1",
      email: "a@b.com",
      role: "EMPLOYEE" as const,
      isActive: true,
      mustChangePassword: true,
      salesRole: "SALES_ADMIN" as const,
    }
    expect(toPublicUser(user).salesRole).toBe("SALES_ADMIN")
  })

  it("includes employeeCode when passed", () => {
    const user = { id: "u1", email: "a@b.com", role: "EMPLOYEE" as const, isActive: true, mustChangePassword: false }
    expect(toPublicUser(user, "BS-EMP-00001").employeeCode).toBe("BS-EMP-00001")
  })
})
