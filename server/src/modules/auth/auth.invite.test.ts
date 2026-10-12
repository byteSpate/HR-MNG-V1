import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const client = {
    user: { findUnique: vi.fn(), updateMany: vi.fn() },
    auditLog: { findFirst: vi.fn() },
    refreshToken: { updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  client.$transaction.mockImplementation((fn: (tx: typeof client) => unknown) => fn(client))
  return { default: client }
})

vi.mock("../../utils/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("./auth.service", () => ({
  STAFF_ROLES: ["EMPLOYEE", "REPORTING_MANAGER"],
}))
vi.mock("./auth.utils", () => ({
  generateTemporaryPassword: vi.fn(() => "NewTemp-5678"),
  hashPassword: vi.fn(async () => "hashed-new"),
}))
vi.mock("./mailer", () => ({ sendCredentialsEmail: vi.fn(async () => undefined) }))

import prisma from "../../config/prisma"
import { writeAudit } from "../../utils/audit"
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
  vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(sendCredentialsEmail).mockResolvedValue(undefined)
})

describe("resending the temporary password", () => {
  it("replaces the password, signs the person out, and returns the new one once", async () => {
    account()

    const result = await resendInvite("user-1", SUPER)

    expect(result).toEqual({ id: "user-1", email: "new.admin@demo.com", temporaryPassword: "NewTemp-5678" })
    // Eligibility is part of the write itself, not only a read before it.
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", mustChangePassword: true, isActive: true },
      data: { passwordHash: "hashed-new", mustChangePassword: true },
    })
    // The old password may already be in a stranger's hands; sessions go too.
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
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
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
    expect(sendCredentialsEmail).not.toHaveBeenCalled()
  })

  it("refuses a deactivated account", async () => {
    account({ isActive: false })

    await expect(resendInvite("user-1", SUPER)).rejects.toMatchObject({ statusCode: 409 })
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it("refuses a second send inside the wait time, and changes nothing", async () => {
    account()
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue({ id: "a-1" } as never)

    await expect(resendInvite("user-1", SUPER)).rejects.toMatchObject({ statusCode: 429 })
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
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
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it("refuses when the person chose a password between the first read and the lock", async () => {
    // The first read still says "has not chosen"; by the time we hold the lock, they have.
    const row = { id: "user-1", email: "a@demo.com", role: "EMPLOYEE", isActive: true, employee: null }
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({ ...row, mustChangePassword: true } as never)
      .mockResolvedValueOnce({ ...row, mustChangePassword: false } as never)

    await expect(resendInvite("user-1", HR)).rejects.toMatchObject({ statusCode: 409 })
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
    expect(writeAudit).not.toHaveBeenCalled()
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
    expect(sendCredentialsEmail).not.toHaveBeenCalled()
  })

  it("changes nothing when the guarded write matches no row", async () => {
    account()
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 0 } as never)

    await expect(resendInvite("user-1", SUPER)).rejects.toMatchObject({ statusCode: 409 })
    expect(writeAudit).not.toHaveBeenCalled()
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
    expect(sendCredentialsEmail).not.toHaveBeenCalled()
  })
})

describe("two sends at the same time", () => {
  it("locks the account row before it looks for a recent send, so the wait time cannot be skipped", async () => {
    account()

    await resendInvite("user-1", SUPER)

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    const [strings, id] = vi.mocked(prisma.$queryRaw).mock.calls[0] as unknown as [string[], string]
    expect(strings.join("?")).toMatch(/FROM "User" WHERE "id" = \? FOR UPDATE/)
    expect(id).toBe("user-1")

    const lockOrder = vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]
    const readOrder = vi.mocked(prisma.auditLog.findFirst).mock.invocationCallOrder[0]
    const writeOrder = vi.mocked(prisma.user.updateMany).mock.invocationCallOrder[0]
    expect(lockOrder).toBeLessThan(readOrder)
    expect(readOrder).toBeLessThan(writeOrder)
  })

  it("reads the recent send inside the transaction, not before it", async () => {
    account()
    const calls: string[] = []
    vi.mocked(prisma.$transaction).mockImplementationOnce((async (fn: (tx: unknown) => unknown) => {
      calls.push("begin")
      const out = await fn(prisma)
      calls.push("commit")
      return out
    }) as never)
    vi.mocked(prisma.auditLog.findFirst).mockImplementationOnce((async () => {
      calls.push("cooldown-read")
      return null
    }) as never)

    await resendInvite("user-1", SUPER)

    expect(calls).toEqual(["begin", "cooldown-read", "commit"])
  })
})


describe("atomic session revocation", () => {
  it.each([false, true])("uses the transaction client and aborts on revocation failure: %s", async (fails) => {
    account()
    const failure = new Error("revocation failed")
    const revoke = vi.fn(async () => {
      if (fails) throw failure
      return { count: 1 }
    })
    const tx = { ...prisma, refreshToken: { updateMany: revoke } }
    const committed = vi.fn()
    vi.mocked(prisma.$transaction).mockImplementationOnce((async (fn: (client: unknown) => unknown) => {
      const result = await fn(tx)
      committed()
      return result
    }) as never)

    if (fails) {
      await expect(resendInvite("user-1", SUPER)).rejects.toBe(failure)
      expect(committed).not.toHaveBeenCalled()
      expect(writeAudit).not.toHaveBeenCalled()
      expect(sendCredentialsEmail).not.toHaveBeenCalled()
    } else {
      await expect(resendInvite("user-1", SUPER)).resolves.toHaveProperty("temporaryPassword")
      expect(committed).toHaveBeenCalledOnce()
      expect(writeAudit).toHaveBeenCalledWith(tx, expect.any(Object))
      expect(committed.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(sendCredentialsEmail).mock.invocationCallOrder[0]
      )
    }
    expect(revoke).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
  })
})
