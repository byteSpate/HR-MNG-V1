import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = { user: { update: vi.fn() }, auditLog: { create: vi.fn() } }
  return {
    default: {
      employee: { findUnique: vi.fn() },
      user: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  }
})

vi.mock("../auth/auth.service", () => ({ revokeAllUserTokens: vi.fn() }))
vi.mock("../../utils/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("../auth/auth.utils", () => ({
  generateTemporaryPassword: vi.fn(() => "Temp-1234"),
  hashPassword: vi.fn(async () => "hashed"),
}))
vi.mock("../auth/mailer", () => ({
  sendCredentialsEmail: vi.fn(),
  sendEmailChangedNotice: vi.fn(),
}))

import prisma from "../../config/prisma"
import { writeAudit } from "../../utils/audit"
import { revokeAllUserTokens } from "../auth/auth.service"
import { sendCredentialsEmail, sendEmailChangedNotice } from "../auth/mailer"
import { changeEmployeeEmail } from "./employee.email"
import type { AccessTokenPayload } from "../auth/auth.types"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tx = (prisma as any).__tx as {
  user: { update: ReturnType<typeof vi.fn> }
}

const HR = { sub: "user-hr", role: "HR_ADMIN", email: "hr@demo.com", mustChangePassword: false } as AccessTokenPayload

function employee(over: { mustChangePassword?: boolean; email?: string; user?: unknown } = {}) {
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({
    id: "emp-1",
    fullName: "Ayesha Rahman",
    employeeCode: "BS-EMP-001",
    userId: "user-1",
    user:
      over.user === undefined
        ? {
            id: "user-1",
            email: over.email ?? "jhon@demo.com",
            mustChangePassword: over.mustChangePassword ?? false,
          }
        : over.user,
  } as never)
}

const addressFree = (taken = false) =>
  vi.mocked(prisma.user.findUnique).mockResolvedValue((taken ? { id: "other" } : null) as never)

beforeEach(() => {
  vi.clearAllMocks()
  addressFree(false)
})

describe("HR changing an employee's sign-in address", () => {
  it("applies immediately — there is no old inbox to approve from", async () => {
    employee()

    const result = await changeEmployeeEmail("emp-1", "John@demo.com", HR)

    expect(result).toMatchObject({ email: "john@demo.com", previousEmail: "jhon@demo.com" })
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "john@demo.com" }) })
    )
  })

  it("writes both addresses to the audit log", async () => {
    employee()

    await changeEmployeeEmail("emp-1", "john@demo.com", HR)

    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entity: "USER_ACCOUNT",
        changedBy: "user-hr",
        before: { email: "jhon@demo.com" },
        after: expect.objectContaining({ email: "john@demo.com" }),
      })
    )
  })

  // The old address is the only place a change nobody wanted is still visible.
  it("notifies both the old and the new address", async () => {
    employee()

    await changeEmployeeEmail("emp-1", "john@demo.com", HR)

    const to = vi.mocked(sendEmailChangedNotice).mock.calls.map((c) => c[0].to)
    expect(to).toEqual(expect.arrayContaining(["john@demo.com", "jhon@demo.com"]))
  })

  it("signs every session out", async () => {
    employee()
    await changeEmployeeEmail("emp-1", "john@demo.com", HR)
    expect(revokeAllUserTokens).toHaveBeenCalledWith("user-1")
  })

  it("refuses an address already on another account", async () => {
    employee()
    addressFree(true)

    await expect(changeEmployeeEmail("emp-1", "taken@demo.com", HR)).rejects.toThrow(
      "already in use on another account"
    )
    expect(tx.user.update).not.toHaveBeenCalled()
  })

  it("refuses when it is the same address in different case", async () => {
    employee({ email: "john@demo.com" })

    await expect(changeEmployeeEmail("emp-1", "John@DEMO.com", HR)).rejects.toThrow(
      "already the address on this account"
    )
  })

  it("refuses an employee with no account to change", async () => {
    employee({ user: null })

    await expect(changeEmployeeEmail("emp-1", "john@demo.com", HR)).rejects.toThrow(
      "no account to change"
    )
  })
})

describe("the typo-in-the-invite case", () => {
  /**
   * The reason this endpoint exists. Correcting the address without reissuing
   * would fix the typo and leave the person exactly as locked out as before.
   */
  it("reissues the invite when the account has never been used", async () => {
    employee({ mustChangePassword: true })

    const result = await changeEmployeeEmail("emp-1", "john@demo.com", HR)

    expect(result.inviteResent).toBe(true)
    expect(sendCredentialsEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "john@demo.com", identifier: "BS-EMP-001" })
    )
  })

  // The old one went to a stranger's inbox.
  it("issues a fresh temporary password rather than resending the old one", async () => {
    employee({ mustChangePassword: true })

    await changeEmployeeEmail("emp-1", "john@demo.com", HR)

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ passwordHash: "hashed" }),
      })
    )
  })

  it("leaves a working password alone when the account is in use", async () => {
    employee({ mustChangePassword: false })

    const result = await changeEmployeeEmail("emp-1", "john@demo.com", HR)

    expect(result.inviteResent).toBe(false)
    expect(sendCredentialsEmail).not.toHaveBeenCalled()
    const data = tx.user.update.mock.calls[0][0].data as Record<string, unknown>
    expect(data.passwordHash).toBeUndefined()
  })
})
