import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    employee: { findUnique: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    passwordResetToken: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { sendPasswordChangedEmail } from "../notification/notification.mailer"
import { hashPassword, verifyAccessToken } from "./auth.utils"
import { changePassword, loginAdmin, loginStaff, logout, refresh, requestPasswordReset, resetPassword } from "./auth.service"

const mockedPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  employee: { findUnique: ReturnType<typeof vi.fn> }
  refreshToken: {
    create: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  passwordResetToken: {
    create: ReturnType<typeof vi.fn>
    findFirst: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("loginAdmin", () => {
  it("returns tokens and a public user for a correct SUPER_ADMIN login", async () => {
    const passwordHash = await hashPassword("correct-password")
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "admin@demo.com",
      passwordHash,
      role: "SUPER_ADMIN",
      isActive: true,
      mustChangePassword: false,
    })
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await loginAdmin("admin@demo.com", "correct-password")

    expect(result.accessToken).toBeTruthy()
    expect(result.user.role).toBe("SUPER_ADMIN")
    expect(mockedPrisma.refreshToken.create).toHaveBeenCalledOnce()
  })

  it("throws AppError 401 for a nonexistent email", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null)
    await expect(loginAdmin("nobody@b.com", "whatever")).rejects.toMatchObject({ statusCode: 401 })
  })

  it("throws AppError 401 when the account is an EMPLOYEE (wrong login mode)", async () => {
    const passwordHash = await hashPassword("correct-password")
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "staff@b.com",
      passwordHash,
      role: "EMPLOYEE",
      isActive: true,
      mustChangePassword: true,
    })
    await expect(loginAdmin("staff@b.com", "correct-password")).rejects.toMatchObject({ statusCode: 401 })
  })

  it("throws AppError 401 for a wrong password", async () => {
    const passwordHash = await hashPassword("correct-password")
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "admin@demo.com",
      passwordHash,
      role: "SUPER_ADMIN",
      isActive: true,
      mustChangePassword: false,
    })
    await expect(loginAdmin("admin@demo.com", "wrong-password")).rejects.toMatchObject({ statusCode: 401 })
  })

  it("throws AppError 403 for a deactivated user", async () => {
    const passwordHash = await hashPassword("correct-password")
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "admin@demo.com",
      passwordHash,
      role: "SUPER_ADMIN",
      isActive: false,
      mustChangePassword: false,
    })
    await expect(loginAdmin("admin@demo.com", "correct-password")).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("loginStaff", () => {
  it("carries salesRole in the access token so requireSales needs no query", async () => {
    const passwordHash = await hashPassword("correct-password")
    mockedPrisma.employee.findUnique.mockResolvedValue({
      employeeCode: "BS-EMP-00001",
      user: {
        id: "u1",
        email: "rahim@demo.com",
        passwordHash,
        role: "EMPLOYEE",
        salesRole: "SALES_USER",
        isActive: true,
        mustChangePassword: false,
      },
    })
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await loginStaff("BS-EMP-00001", "correct-password")

    expect(verifyAccessToken(result.accessToken).salesRole).toBe("SALES_USER")
  })

  // The hole this closes was found in live testing: stripping the role from
  // the JWT alone was not enough, because the client hides the hub button and
  // gates the route on the `salesRole` in the PublicUser payload. With only
  // the claim stripped, a resigned employee was still shown the door and then
  // got a 403 behind it. Both must say the same thing.
  it("strips salesRole from both the token and the user payload for a resigned employee", async () => {
    const passwordHash = await hashPassword("correct-password")
    mockedPrisma.employee.findUnique.mockResolvedValue({
      employeeCode: "BS-EMP-DEMO",
      employmentStatus: "RESIGNED",
      user: {
        id: "u9",
        email: "ayesha@demo.com",
        passwordHash,
        role: "EMPLOYEE",
        salesRole: "SALES_USER",
        isActive: true,
        mustChangePassword: false,
      },
    })
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await loginStaff("BS-EMP-DEMO", "correct-password")

    expect(verifyAccessToken(result.accessToken).salesRole).toBeNull()
    expect(result.user.salesRole).toBeNull()
  })

  // Leaving is a departure; being away is not.
  it("keeps salesRole for an employee who is only on leave", async () => {
    const passwordHash = await hashPassword("correct-password")
    mockedPrisma.employee.findUnique.mockResolvedValue({
      employeeCode: "BS-EMP-00001",
      employmentStatus: "ON_LEAVE",
      user: {
        id: "u1",
        email: "rahim@demo.com",
        passwordHash,
        role: "EMPLOYEE",
        salesRole: "SALES_USER",
        isActive: true,
        mustChangePassword: false,
      },
    })
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await loginStaff("BS-EMP-00001", "correct-password")

    expect(verifyAccessToken(result.accessToken).salesRole).toBe("SALES_USER")
    expect(result.user.salesRole).toBe("SALES_USER")
  })

  it("carries null salesRole for someone with no Sales Hub access", async () => {
    const passwordHash = await hashPassword("correct-password")
    mockedPrisma.employee.findUnique.mockResolvedValue({
      employeeCode: "BS-EMP-00002",
      user: {
        id: "u2",
        email: "karim@demo.com",
        passwordHash,
        role: "EMPLOYEE",
        salesRole: null,
        isActive: true,
        mustChangePassword: false,
      },
    })
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await loginStaff("BS-EMP-00002", "correct-password")

    expect(verifyAccessToken(result.accessToken).salesRole).toBeNull()
  })

  it("returns tokens, a public user, and employeeCode for a correct EMPLOYEE login", async () => {
    const passwordHash = await hashPassword("temp-password")
    mockedPrisma.employee.findUnique.mockResolvedValue({
      employeeCode: "BS-EMP-00001",
      user: {
        id: "u2",
        email: "aisha@b.com",
        passwordHash,
        role: "EMPLOYEE",
        isActive: true,
        mustChangePassword: true,
      },
    })
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await loginStaff("BS-EMP-00001", "temp-password")

    expect(result.accessToken).toBeTruthy()
    expect(result.user.employeeCode).toBe("BS-EMP-00001")
    expect(result.user.mustChangePassword).toBe(true)
  })

  it("throws AppError 401 for an unknown employeeId", async () => {
    mockedPrisma.employee.findUnique.mockResolvedValue(null)
    await expect(loginStaff("BS-EMP-99999", "whatever")).rejects.toMatchObject({ statusCode: 401 })
  })

  it("throws AppError 401 when the linked user is not EMPLOYEE/REPORTING_MANAGER", async () => {
    mockedPrisma.employee.findUnique.mockResolvedValue({
      employeeCode: "BS-EMP-00001",
      user: {
        id: "u2",
        email: "weird@b.com",
        passwordHash: "irrelevant",
        role: "SUPER_ADMIN",
        isActive: true,
        mustChangePassword: false,
      },
    })
    await expect(loginStaff("BS-EMP-00001", "whatever")).rejects.toMatchObject({ statusCode: 401 })
  })

  it("throws AppError 401 for a wrong password", async () => {
    const passwordHash = await hashPassword("temp-password")
    mockedPrisma.employee.findUnique.mockResolvedValue({
      employeeCode: "BS-EMP-00001",
      user: {
        id: "u2",
        email: "aisha@b.com",
        passwordHash,
        role: "EMPLOYEE",
        isActive: true,
        mustChangePassword: true,
      },
    })
    await expect(loginStaff("BS-EMP-00001", "wrong")).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe("refresh", () => {
  it("carries the current salesRole into a rotated access token", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt-sales",
      userId: "u-sales-admin",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      revokedAt: null,
      user: {
        id: "u-sales-admin",
        email: "sales-admin@demo.com",
        role: "EMPLOYEE",
        salesRole: "SALES_ADMIN",
        isActive: true,
        mustChangePassword: false,
      },
    })
    mockedPrisma.employee.findUnique.mockResolvedValue({ employeeCode: "BS-EMP-00003" })
    mockedPrisma.refreshToken.update.mockResolvedValue({})
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await refresh("sales-admin-refresh-token")

    expect(verifyAccessToken(result.accessToken).salesRole).toBe("SALES_ADMIN")
  })

  it("rotates a valid, unrevoked, unexpired refresh token for an admin user", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      revokedAt: null,
      user: { id: "u1", email: "admin@demo.com", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false },
    })
    mockedPrisma.employee.findUnique.mockResolvedValue(null)
    mockedPrisma.refreshToken.update.mockResolvedValue({})
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await refresh("some-raw-token")

    expect(result.accessToken).toBeTruthy()
    expect(result.user.employeeCode).toBeUndefined()
    expect(mockedPrisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rt1" } })
    )
  })

  it("re-attaches employeeCode for a staff user on refresh", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt2",
      userId: "u2",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      revokedAt: null,
      user: { id: "u2", email: "aisha@b.com", role: "EMPLOYEE", isActive: true, mustChangePassword: false },
    })
    mockedPrisma.employee.findUnique.mockResolvedValue({ employeeCode: "BS-EMP-00001" })
    mockedPrisma.refreshToken.update.mockResolvedValue({})
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await refresh("some-raw-token")

    expect(result.user.employeeCode).toBe("BS-EMP-00001")
  })

  it("throws AppError 401 for an unknown token", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValue(null)
    await expect(refresh("unknown-token")).rejects.toMatchObject({ statusCode: 401 })
  })

  it("throws AppError 401 for a revoked token", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      revokedAt: new Date(),
      user: { id: "u1", email: "admin@demo.com", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false },
    })
    await expect(refresh("revoked-token")).rejects.toMatchObject({ statusCode: 401 })
  })

  it("throws AppError 401 for an expired token", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      user: { id: "u1", email: "admin@demo.com", role: "SUPER_ADMIN", isActive: true, mustChangePassword: false },
    })
    await expect(refresh("expired-token")).rejects.toMatchObject({ statusCode: 401 })
  })

  it("throws AppError 403 when the user has been deactivated since the token was issued", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      revokedAt: null,
      user: { id: "u1", email: "admin@demo.com", role: "SUPER_ADMIN", isActive: false, mustChangePassword: false },
    })
    await expect(refresh("some-raw-token")).rejects.toMatchObject({ statusCode: 403 })
    expect(mockedPrisma.refreshToken.update).not.toHaveBeenCalled()
  })
})

describe("logout", () => {
  it("revokes the matching refresh token", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValue({ id: "rt1", revokedAt: null })
    mockedPrisma.refreshToken.update.mockResolvedValue({})
    await logout("some-raw-token")
    expect(mockedPrisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: "rt1" },
      data: { revokedAt: expect.any(Date) },
    })
  })

  it("does nothing (no throw) if the token doesn't exist", async () => {
    mockedPrisma.refreshToken.findUnique.mockResolvedValue(null)
    await expect(logout("unknown-token")).resolves.toBeUndefined()
  })
})

vi.mock("./mailer", () => ({
  sendPasswordResetEmail: vi.fn(),
  sendCredentialsEmail: vi.fn(),
}))

vi.mock("../notification/notification.mailer", () => ({
  sendPasswordChangedEmail: vi.fn(() => Promise.resolve()),
}))

describe("requestPasswordReset", () => {
  it("creates a reset token and sends an email when the user exists", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com" })
    mockedPrisma.passwordResetToken.create.mockResolvedValue({})
    const { sendPasswordResetEmail } = await import("./mailer")

    await requestPasswordReset("a@b.com")

    expect(mockedPrisma.passwordResetToken.create).toHaveBeenCalledOnce()
    expect(sendPasswordResetEmail).toHaveBeenCalledWith("a@b.com", expect.stringContaining("token="))
  })

  it("resolves without error when the email doesn't exist (no user enumeration)", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null)
    await expect(requestPasswordReset("nobody@b.com")).resolves.toBeUndefined()
    expect(mockedPrisma.passwordResetToken.create).not.toHaveBeenCalled()
  })

  it("does not create a second token within the cooldown", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com" })
    mockedPrisma.passwordResetToken.findFirst.mockResolvedValue({
      id: "t1",
      createdAt: new Date(),
    })

    await requestPasswordReset("a@b.com")

    expect(mockedPrisma.passwordResetToken.create).not.toHaveBeenCalled()
  })

  it("creates a token when the last one is older than the cooldown", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.com" })
    mockedPrisma.passwordResetToken.findFirst.mockResolvedValue(null)
    mockedPrisma.passwordResetToken.create.mockResolvedValue({})

    await requestPasswordReset("a@b.com")

    expect(mockedPrisma.passwordResetToken.create).toHaveBeenCalled()
  })
})

describe("resetPassword", () => {
  it("updates the password and clears mustChangePassword for a valid token", async () => {
    mockedPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "prt1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      usedAt: null,
    })
    mockedPrisma.user.update.mockResolvedValue({})
    mockedPrisma.passwordResetToken.update.mockResolvedValue({})
    mockedPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 })

    await resetPassword("raw-reset-token", "newlongpassword")

    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { passwordHash: expect.any(String), mustChangePassword: false },
    })
    expect(mockedPrisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: "prt1" },
      data: { usedAt: expect.any(Date) },
    })
    expect(mockedPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  it("throws AppError 400 for an unknown token", async () => {
    mockedPrisma.passwordResetToken.findUnique.mockResolvedValue(null)
    await expect(resetPassword("unknown", "newlongpassword")).rejects.toMatchObject({ statusCode: 400 })
  })

  it("throws AppError 400 for an already-used token", async () => {
    mockedPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "prt1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      usedAt: new Date(),
    })
    await expect(resetPassword("used", "newlongpassword")).rejects.toMatchObject({ statusCode: 400 })
  })

  it("throws AppError 400 for an expired token", async () => {
    mockedPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "prt1",
      userId: "u1",
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
    })
    await expect(resetPassword("expired", "newlongpassword")).rejects.toMatchObject({ statusCode: 400 })
  })

  it("emails the account holder when a reset completes", async () => {
    // Reset is precisely the flow an attacker uses, so this is the
    // notification that matters most.
    mockedPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "prt1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      usedAt: null,
      user: { email: "a@b.com" },
    })
    mockedPrisma.user.update.mockResolvedValue({})
    mockedPrisma.passwordResetToken.update.mockResolvedValue({})
    mockedPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 })

    await resetPassword("raw-token", "newlongpassword")

    expect(sendPasswordChangedEmail).toHaveBeenCalledWith({ to: "a@b.com", userId: "u1" })
  })
})

describe("changePassword", () => {
  it("refuses to mint a new session for a deactivated account", async () => {
    const passwordHash = await hashPassword("old-password")
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      passwordHash,
      role: "EMPLOYEE",
      isActive: false,
      mustChangePassword: false,
    })

    await expect(changePassword("u1", "old-password", "brand-new-password")).rejects.toMatchObject({
      statusCode: 403,
      message: "This account has been deactivated",
    })
    expect(mockedPrisma.user.update).not.toHaveBeenCalled()
    expect(mockedPrisma.refreshToken.create).not.toHaveBeenCalled()
  })

  it("preserves employeeCode in the replacement session user", async () => {
    const passwordHash = await hashPassword("old-password")
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      passwordHash,
      role: "EMPLOYEE",
      isActive: true,
      mustChangePassword: false,
      employee: { employeeCode: "BS-EMP-00001" },
    })
    mockedPrisma.user.update.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      role: "EMPLOYEE",
      salesRole: null,
      isActive: true,
      mustChangePassword: false,
    })
    mockedPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 })
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await changePassword("u1", "old-password", "brand-new-password")

    expect(result.user.employeeCode).toBe("BS-EMP-00001")
  })

  it("carries salesRole into the replacement access token", async () => {
    const passwordHash = await hashPassword("old-password")
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      passwordHash,
      role: "EMPLOYEE",
      salesRole: "SALES_USER",
      isActive: true,
      mustChangePassword: true,
    })
    mockedPrisma.user.update.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      role: "EMPLOYEE",
      salesRole: "SALES_USER",
      isActive: true,
      mustChangePassword: false,
    })
    mockedPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 })
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await changePassword("u1", "old-password", "brand-new-password")

    expect(verifyAccessToken(result.accessToken).salesRole).toBe("SALES_USER")
  })

  /**
   * The third and least obvious way to mint a token.
   *
   * Resigning does not revoke refresh tokens or disable the login — account
   * status and employment status are deliberately independent — so a resigned
   * employee's session keeps rotating. Login and refresh both strip the sales
   * role, but this endpoint needs only `requireAuth` and the person's own
   * current password, which they still know. Reading the raw column here
   * would have handed back a full-strength token indefinitely, bounded by
   * nothing.
   */
  it("strips salesRole when a resigned employee changes their password", async () => {
    const passwordHash = await hashPassword("old-password")
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u9",
      email: "ayesha@demo.com",
      passwordHash,
      role: "EMPLOYEE",
      salesRole: "SALES_USER",
      isActive: true,
      mustChangePassword: false,
    })
    mockedPrisma.user.update.mockResolvedValue({
      id: "u9",
      email: "ayesha@demo.com",
      role: "EMPLOYEE",
      salesRole: "SALES_USER",
      isActive: true,
      mustChangePassword: false,
    })
    mockedPrisma.employee.findUnique.mockResolvedValue({ employmentStatus: "RESIGNED" })
    mockedPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 })
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await changePassword("u9", "old-password", "brand-new-password")

    expect(verifyAccessToken(result.accessToken).salesRole).toBeNull()
    expect(result.user.salesRole).toBeNull()
  })

  it("updates the password, clears mustChangePassword, and returns a fresh access token", async () => {
    const passwordHash = await hashPassword("old-password")
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      passwordHash,
      role: "EMPLOYEE",
      isActive: true,
      mustChangePassword: true,
    })
    mockedPrisma.user.update.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      role: "EMPLOYEE",
      isActive: true,
      mustChangePassword: false,
    })
    mockedPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 })
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    const result = await changePassword("u1", "old-password", "brand-new-password")

    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).toBeTruthy()
    expect(result.user.mustChangePassword).toBe(false)
    expect(mockedPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
    expect(mockedPrisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u1" }) })
    )
  })

  it("emails the account holder when they change their own password", async () => {
    const passwordHash = await hashPassword("old-password")
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      passwordHash,
      role: "EMPLOYEE",
      isActive: true,
      mustChangePassword: false,
    })
    mockedPrisma.user.update.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      role: "EMPLOYEE",
      isActive: true,
      mustChangePassword: false,
    })
    mockedPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 })
    mockedPrisma.refreshToken.create.mockResolvedValue({})

    await changePassword("u1", "old-password", "brand-new-password")

    expect(sendPasswordChangedEmail).toHaveBeenCalledWith({ to: "a@b.com", userId: "u1" })
  })

  it("throws AppError 401 for an incorrect current password", async () => {
    const passwordHash = await hashPassword("old-password")
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      passwordHash,
      role: "EMPLOYEE",
      isActive: true,
      mustChangePassword: true,
    })
    await expect(changePassword("u1", "wrong-password", "brand-new-password")).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it("throws AppError 404 for an unknown user id", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null)
    await expect(changePassword("unknown", "old", "brand-new-password")).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})
