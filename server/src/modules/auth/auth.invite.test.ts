import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const client = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  }
  client.$transaction.mockImplementation((fn: (tx: typeof client) => unknown) => fn(client))
  return { default: client }
})

vi.mock("../../utils/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("./auth.service", () => ({
  revokeAllUserTokens: vi.fn(async () => undefined),
  STAFF_ROLES: ["EMPLOYEE", "REPORTING_MANAGER"],
}))
vi.mock("./auth.utils", () => ({
  generateTemporaryPassword: vi.fn(() => "NewTemp-5678"),
  hashPassword: vi.fn(async () => "hashed-new"),
}))
vi.mock("./mailer", () => ({ sendCredentialsEmail: vi.fn(async () => undefined) }))

import prisma from "../../config/prisma"
import { writeAudit } from "../../utils/audit"
import { revokeAllUserTokens } from "./auth.service"
import { sendCredentialsEmail } from "./mailer"
import { INVITE_COOLDOWN_MS, resendInvite } from "./auth.invite"
import type { AccessTokenPayload } from "./auth.types"

const SUPER = { sub: "actor-super", role: "SUPER_ADMIN", email: "s@demo.com", mustChangePassword: false } as AccessTokenPayload
const HR = { sub: "actor-hr", role: "HR_ADMIN", email: "hr@demo.com", mustChangePassword: false } as AccessTokenPayload

function account(over: Record<string, unknown> = {}) {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: "user-1",
    email: "new.admin@demo.com",
    role: "SUPER_ADMIN",
    isActive: true,
    mustChangePassword: true,
    employee: null,
    ...over,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null as never)
  vi.mocked(sendCredentialsEmail).mockResolvedValue(undefined)
})

describe("resending the temporary password", () => {
  it("replaces the password, signs the person out, and returns the new one once", async () => {
    account()

    const result = await resendInvite("user-1", SUPER)

    expect(result).toEqual({ id: "user-1", email: "new.admin@demo.com", temporaryPassword: "NewTemp-5678" })
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "hashed-new", mustChangePassword: true },
    })
    // The old password may already be in a stranger's hands; sessions go too.
    expect(revokeAllUserTokens).toHaveBeenCalledWith("user-1")
  })

  it("emails an account with no employee record using its email address", async () => {
    account()

    await resendInvite("user-1", SUPER)

    expect(sendCredentialsEmail).toHaveBeenCalledWith({
      to: "new.admin@demo.com",
      identifier: "new.admin@demo.com",
      identifierLabel: "Email address",
      temporaryPassword: "NewTemp-5678",
    })
  })

  it("emails staff with their Employee ID, because that is what their sign-in form asks for", async () => {
    account({
      role: "EMPLOYEE",
      email: "ayesha@demo.com",
      employee: { employeeCode: "BS-EMP-001" },
    })

    await resendInvite("user-1", HR)

    expect(sendCredentialsEmail).toHaveBeenCalledWith({
      to: "ayesha@demo.com",
      identifier: "BS-EMP-001",
      identifierLabel: "Employee ID",
      temporaryPassword: "NewTemp-5678",
    })
  })

  it("writes who sent it to the audit log, without the password", async () => {
    account({ role: "EMPLOYEE", employee: { employeeCode: "BS-EMP-001" } })

    await resendInvite("user-1", HR)

    expect(writeAudit).toHaveBeenCalledTimes(1)
    const entry = vi.mocked(writeAudit).mock.calls[0][1]
    expect(entry).toMatchObject({
      entity: "USER_ACCOUNT",
      entityId: "user-1",
      action: "SEND",
      changedBy: "actor-hr",
      note: "Temporary password sent again",
    })
    expect(JSON.stringify(entry)).not.toContain("NewTemp-5678")
  })

  it("still returns the password when the email cannot be sent, so the admin can pass it on", async () => {
    account()
    vi.mocked(sendCredentialsEmail).mockRejectedValue(new Error("smtp down"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const result = await resendInvite("user-1", SUPER)

    expect(result.temporaryPassword).toBe("NewTemp-5678")
    spy.mockRestore()
  })
})

describe("when a resend is not allowed", () => {
  it("returns 404 when the account does not exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never)

    await expect(resendInvite("nope", SUPER)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("refuses when the person already chose their own password, and changes nothing", async () => {
    account({ mustChangePassword: false })

    await expect(resendInvite("user-1", SUPER)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("Forgot password"),
    })
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(sendCredentialsEmail).not.toHaveBeenCalled()
  })

  it("refuses a deactivated account", async () => {
    account({ isActive: false })

    await expect(resendInvite("user-1", SUPER)).rejects.toMatchObject({ statusCode: 409 })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("refuses a second send inside the wait time, and changes nothing", async () => {
    account()
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue({ id: "a-1" } as never)

    await expect(resendInvite("user-1", SUPER)).rejects.toMatchObject({ statusCode: 429 })
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(sendCredentialsEmail).not.toHaveBeenCalled()

    // The wait is measured on the audit log, from the last send.
    const where = vi.mocked(prisma.auditLog.findFirst).mock.calls[0][0]!.where as {
      entityId: string
      changedAt: { gt: Date }
    }
    expect(where.entityId).toBe("user-1")
    const age = Date.now() - where.changedAt.gt.getTime()
    expect(age).toBeGreaterThanOrEqual(INVITE_COOLDOWN_MS - 1000)
    expect(age).toBeLessThanOrEqual(INVITE_COOLDOWN_MS + 1000)
  })

  it("does not let HR replace the password of a Super Admin", async () => {
    account({ role: "SUPER_ADMIN" })

    await expect(resendInvite("user-1", HR)).rejects.toMatchObject({ statusCode: 403 })
    expect(prisma.user.update).not.toHaveBeenCalled()
  })
})
