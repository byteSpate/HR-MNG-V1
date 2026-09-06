import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesAccount: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    salesAccountAssignment: { createMany: vi.fn(), findMany: vi.fn() },
    employee: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { createSalesAccount } from "./account.service"

const ADMIN = {
  sub: "user-1",
  role: "EMPLOYEE",
  email: "karim@demo.com",
  mustChangePassword: false,
  salesRole: "SALES_ADMIN",
} as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-1", fullName: "Karim" } as any)
  vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)
})

describe("createSalesAccount", () => {
  it("creates the account, audits it, and puts it on the timeline", async () => {
    vi.mocked(prisma.salesAccount.create).mockResolvedValue({
      id: "sa-1",
      name: "Rising Group",
      status: "ACTIVE",
      ownerEmployeeId: "emp-1",
      createdAt: new Date("2026-09-05"),
    } as any)

    const result = await createSalesAccount(
      { name: "Rising Group", ownerEmployeeId: "emp-1" },
      ADMIN
    )

    expect(result.name).toBe("Rising Group")
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "SALES_ACCOUNT",
          entityId: "sa-1",
          action: "CREATE",
          changedBy: "user-1",
        }),
      })
    )
    expect(prisma.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "sales.account.created",
          entity: "SALES_ACCOUNT",
          entityId: "sa-1",
          // Role-agnostic: the sales client prefixes it with /sales.
          href: "/accounts/sa-1",
        }),
      })
    )
  })

  // Postgres will happily accept "rising group" beside "Rising Group", and
  // then nobody can tell which one holds the real history.
  it("refuses a duplicate name case-insensitively and names the existing owner", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({
      id: "sa-9",
      name: "Rising Group",
      owner: { fullName: "Rahim" },
    } as any)

    await expect(
      createSalesAccount({ name: "rising group", ownerEmployeeId: "emp-1" }, ADMIN)
    ).rejects.toThrow(AppError)

    await expect(
      createSalesAccount({ name: "rising group", ownerEmployeeId: "emp-1" }, ADMIN)
    ).rejects.toThrow(/Rising Group.*Rahim/)

    expect(prisma.salesAccount.create).not.toHaveBeenCalled()
  })

  it("refuses an owner who is not an employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)

    await expect(
      createSalesAccount({ name: "New Co", ownerEmployeeId: "nope" }, ADMIN)
    ).rejects.toThrow(AppError)
  })

  it("stores the extra assignees without duplicating the owner", async () => {
    vi.mocked(prisma.salesAccount.create).mockResolvedValue({
      id: "sa-2",
      name: "APS Group",
      status: "ACTIVE",
      ownerEmployeeId: "emp-1",
      createdAt: new Date("2026-09-05"),
    } as any)

    await createSalesAccount(
      { name: "APS Group", ownerEmployeeId: "emp-1", assigneeIds: ["emp-1", "emp-2"] },
      ADMIN
    )

    expect(prisma.salesAccountAssignment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ salesAccountId: "sa-2", employeeId: "emp-2", assignedBy: "user-1" }],
      })
    )
  })
})
