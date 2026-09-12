import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    salesAccount: { findFirst: vi.fn(), findUnique: vi.fn() },
    opportunity: { findFirst: vi.fn() },
    salesComment: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { createSalesComment, listSalesComments, updateSalesComment } from "./comment.service"

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "sales@example.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as any
const ADMIN = { ...USER, salesRole: "SALES_ADMIN" } as any
const SUPER_ADMIN = { ...USER, role: "SUPER_ADMIN", salesRole: null } as any
const COMMENT = {
  id: "comment-1", entity: "SALES_ACCOUNT", entityId: "account-1", kind: "GENERAL",
  body: "Customer wants a revised quote", authorUserId: "user-1",
  authorEmployeeId: "emp-1", funnelMeetingId: null,
  createdAt: new Date("2026-09-09T10:00:00Z"), updatedAt: new Date("2026-09-09T10:00:00Z"),
  author: { fullName: "Rahim" }, authorUser: { displayName: null, email: "sales@example.com" },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({ id: "account-1", ownerEmployeeId: "emp-1" } as any)
  vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue({ id: "account-1", ownerEmployeeId: "emp-1" } as any)
  vi.mocked(prisma.opportunity.findFirst).mockResolvedValue({
    id: "opp-1", salesAccountId: "account-1", salesAccount: { ownerEmployeeId: "emp-1" },
  } as any)
  vi.mocked(prisma.salesComment.create).mockResolvedValue(COMMENT as any)
  vi.mocked(prisma.salesComment.findUnique).mockResolvedValue(COMMENT as any)
  vi.mocked(prisma.salesComment.update).mockResolvedValue(COMMENT as any)
  vi.mocked(prisma.salesComment.findMany).mockResolvedValue([] as any)
})

describe("sales comments", () => {
  it("writes a general account remark with its employee author and audit", async () => {
    const result = await createSalesComment({
      entity: "SALES_ACCOUNT", entityId: "account-1", kind: "GENERAL",
      body: "Customer wants a revised quote",
    }, USER)
    expect(result.authorName).toBe("Rahim")
    expect(prisma.salesComment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        authorUserId: "user-1", authorEmployeeId: "emp-1", funnelMeetingId: null,
      }),
    }))
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "SALES_COMMENT", action: "CREATE" }),
    }))
  })

  it("refuses a Sales User management note with a named restriction", async () => {
    await expect(createSalesComment({
      entity: "SALES_ACCOUNT", entityId: "account-1", kind: "MANAGEMENT_NOTE", body: "Watch margin",
    }, USER)).rejects.toThrow(/management note.*Sales Admin/i)
  })

  it("allows an admin management note and leaves account feedback to the client UI", async () => {
    await expect(createSalesComment({
      entity: "SALES_ACCOUNT", entityId: "account-1", kind: "MANAGEMENT_NOTE", body: "Watch margin",
    }, ADMIN)).resolves.toBeDefined()
    await expect(createSalesComment({
      entity: "SALES_ACCOUNT", entityId: "account-1", kind: "CUSTOMER_FEEDBACK", body: "Happy",
    }, ADMIN)).resolves.toBeDefined()
  })

  it("lets a Super Admin without an Employee row write a management note", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: null } as any)
    vi.mocked(prisma.salesComment.create).mockResolvedValue({
      ...COMMENT,
      authorUserId: SUPER_ADMIN.sub,
      authorEmployeeId: null,
      author: null,
      authorUser: { displayName: "System Admin", email: "admin@example.com" },
    } as any)

    const result = await createSalesComment({
      entity: "SALES_ACCOUNT", entityId: "account-1", kind: "MANAGEMENT_NOTE", body: "Watch margin",
    }, SUPER_ADMIN)

    expect(result.authorName).toBe("System Admin")
    expect(prisma.salesComment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ authorUserId: SUPER_ADMIN.sub, authorEmployeeId: null }),
    }))
  })

  it("returns newest first, capped at 100, and says when the 101st exists", async () => {
    vi.mocked(prisma.salesComment.findMany).mockResolvedValue(
      Array.from({ length: 101 }, (_, index) => ({ ...COMMENT, id: `c-${index}` })) as any
    )
    const result = await listSalesComments({ entity: "SALES_ACCOUNT", entityId: "account-1" }, USER)
    expect(result.items).toHaveLength(100)
    expect(result).toMatchObject({ truncated: true, limit: 100 })
    expect(prisma.salesComment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: "desc" }, take: 101,
    }))
  })

  it("does not return comments when the entity is outside the caller's access", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null as any)
    await expect(listSalesComments({ entity: "SALES_ACCOUNT", entityId: "hidden" }, USER))
      .rejects.toThrow(/does not exist, or is not yours/i)
    expect(prisma.salesComment.findMany).not.toHaveBeenCalled()
  })

  it("refuses another author's edit", async () => {
    vi.mocked(prisma.salesComment.findUnique).mockResolvedValue({
      ...COMMENT, authorUserId: "user-2", authorEmployeeId: "emp-2",
    } as any)
    await expect(updateSalesComment("comment-1", { body: "Changed" }, USER))
      .rejects.toThrow(/author/i)
  })

  it("audits an author's correction with the old and new body", async () => {
    await updateSalesComment("comment-1", { body: "Changed" }, USER)
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entity: "SALES_COMMENT", action: "UPDATE",
        before: { body: COMMENT.body }, after: { body: "Changed" },
      }),
    }))
  })

  it("does not let a former admin edit a management note after demotion", async () => {
    vi.mocked(prisma.salesComment.findUnique).mockResolvedValue({
      ...COMMENT, kind: "MANAGEMENT_NOTE",
    } as any)
    await expect(updateSalesComment("comment-1", { body: "Changed" }, USER))
      .rejects.toThrow(/does not exist, or is not yours/i)
    expect(prisma.salesComment.update).not.toHaveBeenCalled()
  })
})

describe("management notes are for Sales Admins only", () => {
  const NOTE = { ...COMMENT, kind: "MANAGEMENT_NOTE", authorUserId: "user-9", authorEmployeeId: "emp-9" }

  it("does not ask for management notes when a Sales User lists comments", async () => {
    await listSalesComments({ entity: "SALES_ACCOUNT", entityId: "account-1" }, USER)

    // Excluded in the query, not filtered afterwards: a Sales User must not
    // cause the rows to be read at all.
    expect(prisma.salesComment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ kind: { not: "MANAGEMENT_NOTE" } }),
    }))
  })

  it.each([["a Sales Admin", ADMIN], ["a Super Admin", SUPER_ADMIN]])(
    "lists management notes for %s", async (_label, actor) => {
      await listSalesComments({ entity: "SALES_ACCOUNT", entityId: "account-1" }, actor)

      const where = (vi.mocked(prisma.salesComment.findMany).mock.calls[0][0] as any).where
      expect(where).not.toHaveProperty("kind")
    }
  )

  it("answers a Sales User's edit of a management note as if it did not exist", async () => {
    vi.mocked(prisma.salesComment.findUnique).mockResolvedValue(NOTE as any)

    // A 403 naming the kind would confirm that a hidden note is there.
    await expect(updateSalesComment("comment-1", { body: "Changed" }, USER))
      .rejects.toMatchObject({ statusCode: 404, message: expect.stringMatching(/does not exist, or is not yours/i) })
    expect(prisma.salesComment.update).not.toHaveBeenCalled()
  })
})
