import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesAccount: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    salesAccountAssignment: { createMany: vi.fn(), findMany: vi.fn() },
    salesContact: { findMany: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    event: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { createSalesAccount, getAccountHistory, listSalesEligibleEmployees } from "./account.service"

const USER = {
  sub: "user-2",
  role: "EMPLOYEE",
  email: "rahim@demo.com",
  mustChangePassword: false,
  salesRole: "SALES_USER",
} as any

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
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({
    id: "emp-1",
    fullName: "Karim",
    user: { salesRole: "SALES_ADMIN" },
  } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
  vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)
  // Every requested assignee exists and already has Sales Hub access, unless
  // a test says otherwise.
  vi.mocked(prisma.employee.findMany).mockImplementation((async (args: any) =>
    args.where.id.in.map((id: string) => ({
      id,
      fullName: id,
      user: { salesRole: "SALES_USER" },
    }))) as never)
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

  it("refuses an assignee who is not an employee, rather than letting the FK 500", async () => {
    vi.mocked(prisma.salesAccount.create).mockResolvedValue({
      id: "sa-3",
      name: "Ghost Co",
      status: "ACTIVE",
      ownerEmployeeId: "emp-1",
      createdAt: new Date("2026-09-06"),
    } as any)
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as any)

    await expect(
      createSalesAccount(
        { name: "Ghost Co", ownerEmployeeId: "emp-1", assigneeIds: ["emp-404"] },
        ADMIN
      )
    ).rejects.toMatchObject({ statusCode: 400 })

    expect(prisma.salesAccountAssignment.createMany).not.toHaveBeenCalled()
  })

  // The gap this closes: nothing previously stopped a Sales Admin naming
  // someone owner who had never been granted salesRole. They would then own
  // an account they cannot themselves open — requireSales blocks the door
  // regardless of what ownerEmployeeId says about them.
  it("refuses an owner who has no Sales Hub access", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "emp-1",
      fullName: "Karim",
      user: { salesRole: null },
    } as any)

    await expect(
      createSalesAccount({ name: "New Co", ownerEmployeeId: "emp-1" }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Karim/) })

    expect(prisma.salesAccount.create).not.toHaveBeenCalled()
  })

  it("refuses a collaborator who has no Sales Hub access", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-2", fullName: "Rahim", user: { salesRole: null } },
    ] as any)

    await expect(
      createSalesAccount(
        { name: "New Co", ownerEmployeeId: "emp-1", assigneeIds: ["emp-2"] },
        ADMIN
      )
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Rahim/) })

    expect(prisma.salesAccountAssignment.createMany).not.toHaveBeenCalled()
  })

  // A repeated id would violate @@unique([salesAccountId, employeeId]), and
  // P2002 renders as a 500.
  it("stores a repeated assignee once", async () => {
    vi.mocked(prisma.salesAccount.create).mockResolvedValue({
      id: "sa-4",
      name: "Twice Ltd",
      status: "ACTIVE",
      ownerEmployeeId: "emp-1",
      createdAt: new Date("2026-09-06"),
    } as any)

    await createSalesAccount(
      { name: "Twice Ltd", ownerEmployeeId: "emp-1", assigneeIds: ["emp-2", "emp-2"] },
      ADMIN
    )

    expect(prisma.salesAccountAssignment.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ salesAccountId: "sa-4", employeeId: "emp-2", assignedBy: "user-1" }],
      })
    )
  })

  // Two admins submitting the same name in the same instant both pass the
  // check above and both insert. The loser must get the sentence everyone
  // else gets, not "Internal server error".
  it("turns a concurrent duplicate into the same 409, still naming the owner", async () => {
    vi.mocked(prisma.salesAccount.findFirst)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValue({ id: "sa-9", name: "Rising Group", owner: { fullName: "Rahim" } } as any)
    vi.mocked(prisma.salesAccount.create).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
    )

    await expect(
      createSalesAccount({ name: "Rising Group", ownerEmployeeId: "emp-1" }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/Rising Group.*Rahim/) })
  })
})

describe("getAccountHistory", () => {
  beforeEach(() => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({ id: "sa-1", ownerEmployeeId: "emp-1" } as any)
  })

  it("merges SALES_ACCOUNT and SALES_CONTACT audit rows for this account, newest first", async () => {
    vi.mocked(prisma.salesContact.findMany).mockResolvedValue([{ id: "c-1" }, { id: "c-2" }] as any)
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      {
        id: "al-2",
        entity: "SALES_CONTACT",
        entityId: "c-1",
        action: "UPDATE",
        changedAt: new Date("2026-09-06"),
        changedBy: "user-1",
        before: { isPrimary: false },
        after: { isPrimary: true },
        note: null,
      },
      {
        id: "al-1",
        entity: "SALES_ACCOUNT",
        entityId: "sa-1",
        action: "CREATE",
        changedAt: new Date("2026-09-01"),
        changedBy: "user-1",
        before: null,
        after: { name: "Rising Group" },
        note: null,
      },
    ] as any)

    const result = await getAccountHistory("sa-1", USER)

    expect(prisma.salesContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salesAccountId: "sa-1" } })
    )
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { entity: "SALES_ACCOUNT", entityId: "sa-1" },
            { entity: "SALES_CONTACT", entityId: { in: ["c-1", "c-2"] } },
          ],
        },
        orderBy: { changedAt: "desc" },
      })
    )
    expect(result).toEqual([
      {
        id: "al-2",
        entity: "SALES_CONTACT",
        entityId: "c-1",
        action: "UPDATE",
        changedAt: "2026-09-06T00:00:00.000Z",
        changedBy: "user-1",
        before: { isPrimary: false },
        after: { isPrimary: true },
        note: null,
      },
      {
        id: "al-1",
        entity: "SALES_ACCOUNT",
        entityId: "sa-1",
        action: "CREATE",
        changedAt: "2026-09-01T00:00:00.000Z",
        changedBy: "user-1",
        before: null,
        after: { name: "Rising Group" },
        note: null,
      },
    ])
  })

  it("does not filter by contact when the account has no contacts yet", async () => {
    vi.mocked(prisma.salesContact.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as any)

    await getAccountHistory("sa-1", USER)

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ entity: "SALES_ACCOUNT", entityId: "sa-1" }] },
      })
    )
  })

  it("refuses a history read for an account the caller cannot see", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)

    await expect(getAccountHistory("sa-9", USER)).rejects.toThrow(AppError)

    expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
  })
})

describe("listSalesEligibleEmployees", () => {
  it("asks Prisma for employees whose user already holds a salesRole", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-1", fullName: "Karim", designation: "Sales Lead" },
    ] as any)

    const result = await listSalesEligibleEmployees()

    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user: { salesRole: { not: null } } },
        orderBy: { fullName: "asc" },
      })
    )
    expect(result).toEqual([{ id: "emp-1", fullName: "Karim", designation: "Sales Lead" }])
  })
})
