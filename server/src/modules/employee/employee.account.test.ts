import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: (() => {
    const tx = {
      employee: { findUnique: vi.fn() },
      user: { update: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    return {
      employee: { findUnique: vi.fn() },
      user: { update: vi.fn() },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    }
  })(),
}))

vi.mock("../auth/auth.service", () => ({
  revokeAllUserTokens: vi.fn(async () => undefined),
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import type { AccessTokenPayload } from "../auth/auth.types"
import { revokeAllUserTokens } from "../auth/auth.service"
import { setAccountActive, setSalesRole } from "./employee.account"

const transaction = (prisma as unknown as {
  __tx: {
    employee: { findUnique: ReturnType<typeof vi.fn> }
    user: { update: ReturnType<typeof vi.fn> }
    auditLog: { create: ReturnType<typeof vi.fn> }
  }
}).__tx

const HR_ADMIN: AccessTokenPayload = {
  sub: "hr-user-1",
  role: "HR_ADMIN",
  email: "hr@example.com",
  mustChangePassword: false,
  salesRole: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("setAccountActive", () => {
  it("resolves the user id from the employee id and disables the login", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "emp-1",
      userId: "u-1",
    } as never)
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "u-1", isActive: false } as never)

    const result = await setAccountActive("emp-1", false)

    // The caller only ever holds an employee id — userId is deliberately not
    // projected onto EmployeeView.
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u-1" },
      data: { isActive: false },
      select: { id: true, isActive: true },
    })
    expect(result).toEqual({ id: "emp-1", accountActive: false })
  })

  it("revokes every refresh token when disabling, or the session outlives the lockout", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "emp-1",
      userId: "u-1",
    } as never)
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "u-1", isActive: false } as never)

    await setAccountActive("emp-1", false)

    expect(revokeAllUserTokens).toHaveBeenCalledWith("u-1")
  })

  it("does NOT revoke tokens when re-enabling", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "emp-1",
      userId: "u-1",
    } as never)
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "u-1", isActive: true } as never)

    await setAccountActive("emp-1", true)

    expect(revokeAllUserTokens).not.toHaveBeenCalled()
  })

  it("404s for an unknown employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null as never)

    await expect(setAccountActive("nope", false)).rejects.toThrow(AppError)
    await expect(setAccountActive("nope", false)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("setSalesRole", () => {
  it("grants access and audits it as a USER_ACCOUNT change", async () => {
    transaction.employee.findUnique.mockResolvedValue({
      id: "emp-1",
      fullName: "Rahim",
      user: { id: "u-9", salesRole: null },
    })
    transaction.user.update.mockResolvedValue({ id: "u-9", salesRole: "SALES_USER" })

    const result = await setSalesRole("emp-1", { salesRole: "SALES_USER" }, HR_ADMIN)

    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: "u-9" },
      data: { salesRole: "SALES_USER" },
    })
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: "USER_ACCOUNT",
        entityId: "u-9",
        action: "UPDATE",
        before: { salesRole: null },
        after: { salesRole: "SALES_USER" },
        changedBy: "hr-user-1",
      }),
    })
    expect(result).toEqual({ salesRole: "SALES_USER" })
    expect(revokeAllUserTokens).not.toHaveBeenCalled()
  })

  it("revokes access with null and audits the removal", async () => {
    transaction.employee.findUnique.mockResolvedValue({
      id: "emp-1",
      fullName: "Rahim",
      user: { id: "u-9", salesRole: "SALES_ADMIN" },
    })
    transaction.user.update.mockResolvedValue({ id: "u-9", salesRole: null })

    const result = await setSalesRole("emp-1", { salesRole: null }, HR_ADMIN)

    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        before: { salesRole: "SALES_ADMIN" },
        after: { salesRole: null },
      }),
    })
    expect(result).toEqual({ salesRole: null })
    expect(revokeAllUserTokens).toHaveBeenCalledWith("u-9")
  })

  it("signs out a Sales Admin demoted to Sales User", async () => {
    transaction.employee.findUnique.mockResolvedValue({
      id: "emp-1",
      fullName: "Rahim",
      user: { id: "u-9", salesRole: "SALES_ADMIN" },
    })
    transaction.user.update.mockResolvedValue({ id: "u-9", salesRole: "SALES_USER" })

    await setSalesRole("emp-1", { salesRole: "SALES_USER" }, HR_ADMIN)

    expect(revokeAllUserTokens).toHaveBeenCalledWith("u-9")
  })

  it("does not sign the user out when the role change rolls back", async () => {
    transaction.employee.findUnique.mockResolvedValue({
      id: "emp-1",
      fullName: "Rahim",
      user: { id: "u-9", salesRole: "SALES_ADMIN" },
    })
    transaction.user.update.mockRejectedValue(new Error("database unavailable"))

    await expect(
      setSalesRole("emp-1", { salesRole: null }, HR_ADMIN)
    ).rejects.toThrow("database unavailable")
    expect(revokeAllUserTokens).not.toHaveBeenCalled()
  })

  it("writes nothing when the value is unchanged", async () => {
    transaction.employee.findUnique.mockResolvedValue({
      id: "emp-1",
      fullName: "Rahim",
      user: { id: "u-9", salesRole: "SALES_USER" },
    })

    const result = await setSalesRole("emp-1", { salesRole: "SALES_USER" }, HR_ADMIN)

    expect(transaction.user.update).not.toHaveBeenCalled()
    expect(transaction.auditLog.create).not.toHaveBeenCalled()
    expect(result).toEqual({ salesRole: "SALES_USER" })
  })

  it("404s for an employee with no user account", async () => {
    transaction.employee.findUnique.mockResolvedValue({
      id: "emp-1",
      fullName: "Rahim",
      user: null,
    })

    await expect(
      setSalesRole("emp-1", { salesRole: "SALES_USER" }, HR_ADMIN)
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(transaction.user.update).not.toHaveBeenCalled()
    expect(transaction.auditLog.create).not.toHaveBeenCalled()
  })

  it("404s for an unknown employee", async () => {
    transaction.employee.findUnique.mockResolvedValue(null)

    await expect(
      setSalesRole("nope", { salesRole: "SALES_USER" }, HR_ADMIN)
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(transaction.user.update).not.toHaveBeenCalled()
    expect(transaction.auditLog.create).not.toHaveBeenCalled()
  })
})
