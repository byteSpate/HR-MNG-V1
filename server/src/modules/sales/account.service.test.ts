import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    salesAccount: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    salesAccountAssignment: { createMany: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    salesContact: { findMany: vi.fn() },
    opportunity: { findMany: vi.fn() },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    event: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { dec } from "../payroll/payroll.money"
import {
  createSalesAccount,
  getAccountHistory,
  getAccountMargin,
  listSalesEligibleEmployees,
  updateSalesAccount,
} from "./account.service"

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
  // The default owner: a Sales User who still works here. Owners must be
  // Sales Users — an admin administers the hub rather than carrying accounts
  // in it — so this cannot be SALES_ADMIN.
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({
    id: "emp-1",
    fullName: "Karim",
    employmentStatus: "ACTIVE",
    lastWorkingDay: null,
    user: { salesRole: "SALES_USER", isActive: true },
  } as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)
  // Every requested assignee exists, holds Sales User, still works here and
  // still has a working login, unless a test says otherwise.
  vi.mocked(prisma.employee.findMany).mockImplementation((async (args: any) =>
    (args.where?.id?.in ?? []).map((id: string) => ({
      id,
      fullName: id,
      employmentStatus: "ACTIVE",
      lastWorkingDay: null,
      user: { salesRole: "SALES_USER", isActive: true },
    }))) as never)
})

describe("getAccountMargin", () => {
  it("adds up the product margins on the account's won deals, and names what it cannot", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({ id: "sa-1", ownerEmployeeId: "emp-2" } as any)
    vi.mocked(prisma.opportunity.findMany).mockResolvedValue([
      {
        lines: [
          { lineValue: dec("10000"), marginPercent: dec("12") },
          // No Total price, so its margin cannot be worked out.
          { lineValue: null, marginPercent: dec("12") },
        ],
      },
      { lines: [] },
    ] as any)

    const margin = await getAccountMargin("sa-1", USER)

    // Left out and counted, never summed as zero.
    expect(margin).toEqual({ value: "1200.00", counted: 1, missing: 1, dealsWithoutProducts: 1 })
    expect(prisma.opportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salesAccountId: "sa-1", status: "WON" } })
    )
  })

  it("refuses somebody who does not work the account, before reading any deal", async () => {
    // The directory is shared; its margin is not. Same gate as the deals list.
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)

    await expect(getAccountMargin("sa-1", USER)).rejects.toMatchObject({ statusCode: 404 })
    expect(prisma.opportunity.findMany).not.toHaveBeenCalled()
  })
})

describe("createSalesAccount", () => {
  it("takes the account-name lock before checking for a duplicate", async () => {
    vi.mocked(prisma.salesAccount.create).mockResolvedValue({
      id: "sa-1",
      name: "Rising Group",
      industry: null,
      website: null,
      address: null,
      status: "ACTIVE",
      ownerEmployeeId: "emp-1",
      createdAt: new Date("2026-09-05"),
    } as any)

    await createSalesAccount({ name: "Rising Group", ownerEmployeeId: "emp-1" }, ADMIN)

    expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.anything())
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.salesAccount.findFirst).mock.invocationCallOrder[0]
    )
  })

  it("creates the account, audits it, and puts it on the timeline", async () => {
    vi.mocked(prisma.salesAccount.create).mockResolvedValue({
      id: "sa-1",
      name: "Rising Group",
      industry: "Textiles",
      website: "rising.example",
      address: null,
      status: "ACTIVE",
      ownerEmployeeId: "emp-1",
      createdAt: new Date("2026-09-05"),
    } as any)

    const result = await createSalesAccount(
      { name: "Rising Group", ownerEmployeeId: "emp-1" },
      ADMIN
    )

    expect(result.name).toBe("Rising Group")
    // Stored at creation and read straight back, same as everything else on
    // the row — nothing typed into these fields should vanish from the
    // caller's own eyes the moment they save it.
    expect(result).toMatchObject({ industry: "Textiles", website: "rising.example", address: null })
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
      employmentStatus: "ACTIVE",
      user: { salesRole: null },
    } as any)

    await expect(
      createSalesAccount({ name: "New Co", ownerEmployeeId: "emp-1" }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Karim/) })

    expect(prisma.salesAccount.create).not.toHaveBeenCalled()
  })

  // An account owned by someone who left is answerable to nobody, and their
  // tokens no longer carry a sales role, so they could not open it anyway.
  it("refuses an owner who has left the company", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "emp-1",
      fullName: "Ayesha",
      employmentStatus: "RESIGNED",
      user: { salesRole: "SALES_USER" },
    } as any)

    await expect(
      createSalesAccount({ name: "New Co", ownerEmployeeId: "emp-1" }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/left the company/) })

    expect(prisma.salesAccount.create).not.toHaveBeenCalled()
  })

  // Sales Admins manage the hub rather than owning accounts inside it.
  it("refuses a Sales Admin as the owner", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "emp-1",
      fullName: "Jamal",
      employmentStatus: "ACTIVE",
      lastWorkingDay: null,
      user: { salesRole: "SALES_ADMIN", isActive: true },
    } as any)

    await expect(
      createSalesAccount({ name: "New Co", ownerEmployeeId: "emp-1" }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Sales Admin/) })

    expect(prisma.salesAccount.create).not.toHaveBeenCalled()
  })

  it("refuses a Sales Admin as a collaborator", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-2", fullName: "Jamal", employmentStatus: "ACTIVE", user: { salesRole: "SALES_ADMIN" } },
    ] as any)

    await expect(
      createSalesAccount(
        { name: "New Co", ownerEmployeeId: "emp-1", assigneeIds: ["emp-2"] },
        ADMIN
      )
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Jamal/) })

    expect(prisma.salesAccountAssignment.createMany).not.toHaveBeenCalled()
  })

  it("refuses a collaborator who has no Sales Hub access", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-2", fullName: "Rahim", employmentStatus: "ACTIVE", user: { salesRole: null } },
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
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue({ id: "sa-1", ownerEmployeeId: "emp-1" } as any)
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

    const { items: result, truncated } = await getAccountHistory("sa-1", USER)

    expect(truncated).toBe(false)
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
    // Rendered, not raw: column names become phrases, SHOUTING enum values
    // become sentence case, and a first-time value has no `before` so the
    // panel shows one value rather than an arrow from nothing.
    expect(result).toEqual([
      {
        id: "al-2",
        entity: "SALES_CONTACT",
        entityId: "c-1",
        action: "UPDATE",
        changedAt: "2026-09-06T00:00:00.000Z",
        changedByName: null,
        changes: [{ field: "isPrimary", label: "Primary contact", before: "No", after: "Yes" }],
        note: null,
      },
      {
        id: "al-1",
        entity: "SALES_ACCOUNT",
        entityId: "sa-1",
        action: "CREATE",
        changedAt: "2026-09-01T00:00:00.000Z",
        changedByName: null,
        changes: [{ field: "name", label: "Name", before: null, after: "Rising Group" }],
        note: null,
      },
    ])
  })

  // The defect this fixes: the panel printed `ownerEmployeeId:
  // "88604c6a-…"` — a column name and a uuid, neither of which means
  // anything to the person reading it.
  it("resolves an owner id to a name and drops the account id as noise", async () => {
    vi.mocked(prisma.salesContact.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-7", fullName: "Ayesha Rahman" },
    ] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", email: "admin@demo.com", employee: { fullName: "The Admin" } },
    ] as any)
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      {
        id: "al-3",
        entity: "SALES_ACCOUNT",
        entityId: "sa-1",
        action: "CREATE",
        changedAt: new Date("2026-09-06"),
        changedBy: "user-1",
        before: null,
        after: {
          name: "Rising Group",
          status: "ACTIVE",
          ownerEmployeeId: "emp-7",
          salesAccountId: "sa-1",
        },
        note: null,
      },
    ] as any)

    const { items: [entry] } = await getAccountHistory("sa-1", USER)

    expect(entry.changedByName).toBe("The Admin")
    expect(entry.changes).toEqual([
      { field: "name", label: "Name", before: null, after: "Rising Group" },
      { field: "status", label: "Status", before: null, after: "Active" },
      { field: "ownerEmployeeId", label: "Owner", before: null, after: "Ayesha Rahman" },
    ])
  })

  // A person can be deleted; their audit rows outlive them.
  it("says so plainly when an id no longer resolves", async () => {
    vi.mocked(prisma.salesContact.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      {
        id: "al-4",
        entity: "SALES_ACCOUNT",
        entityId: "sa-1",
        action: "UPDATE",
        changedAt: new Date("2026-09-06"),
        changedBy: null,
        before: { ownerEmployeeId: "11111111-1111-4111-8111-111111111111" },
        after: { ownerEmployeeId: "22222222-2222-4222-8222-222222222222" },
        note: null,
      },
    ] as any)

    const { items: [entry] } = await getAccountHistory("sa-1", USER)

    expect(entry.changes[0]).toEqual({
      field: "ownerEmployeeId",
      label: "Owner",
      before: "Someone no longer on file",
      after: "Someone no longer on file",
    })
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

  // Visibility is now permissive (any Sales Hub member), so this only 404s
  // for an account that genuinely does not exist — not an out-of-scope one.
  it("refuses a history read for an account that does not exist", async () => {
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(null)

    await expect(getAccountHistory("sa-9", USER)).rejects.toThrow(AppError)

    expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
  })
})

describe("listSalesEligibleEmployees", () => {
  // Two rules in one query: Sales Users only (an admin administers the hub
  // rather than owning accounts in it), and only people who still work here.
  it("offers only employed Sales Users", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "emp-1", fullName: "Karim", designation: "Sales Lead" },
    ] as any)

    const result = await listSalesEligibleEmployees()

    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user: { salesRole: "SALES_USER", isActive: true } },
        orderBy: { fullName: "asc" },
      })
    )
    expect(result).toEqual([{ id: "emp-1", fullName: "Karim", designation: "Sales Lead" }])
  })

  // A deactivated login cannot authenticate, so offering them as an owner
  // hands the account to somebody who can never open it.
  it("leaves out anyone whose login is deactivated", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as any)

    await listSalesEligibleEmployees()

    const where = vi.mocked(prisma.employee.findMany).mock.calls[0][0]?.where as any
    expect(where.user.isActive).toBe(true)
  })

  // Employment status alone would cut off somebody serving notice, on
  // exactly the accounts they are trying to hand over.
  it("still offers a leaver who is inside their notice period", async () => {
    const nextMonth = new Date(Date.now() + 30 * 86_400_000)
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      {
        id: "emp-1",
        fullName: "Karim",
        designation: "Sales Lead",
        employmentStatus: "RESIGNED",
        lastWorkingDay: nextMonth,
      },
      {
        id: "emp-2",
        fullName: "Ayesha",
        designation: "Engineer",
        employmentStatus: "RESIGNED",
        lastWorkingDay: new Date("2020-01-01"),
      },
    ] as any)

    const result = await listSalesEligibleEmployees()

    expect(result.map((e) => e.fullName)).toEqual(["Karim"])
  })
})

describe("updateSalesAccount", () => {
  /**
   * The row as it stands before each test edits it. A Sales User owns it and
   * still works here, so a test changing something else does not trip the
   * owner rules on the way past.
   */
  const CURRENT = {
    id: "sa-1",
    name: "Rising Group",
    industry: "Textiles",
    website: null,
    address: null,
    status: "ACTIVE",
    statusReason: null,
    ownerEmployeeId: "emp-1",
    createdAt: new Date("2026-09-05"),
    owner: {
      fullName: "Karim",
      employmentStatus: "ACTIVE",
      lastWorkingDay: null,
      user: { salesRole: "SALES_USER", isActive: true },
    },
    assignments: [],
  }

  beforeEach(() => {
    // Two callers share one findFirst mock: the access gate looks an account
    // up by id, the duplicate check looks one up by name. Branching on the
    // shape of `where` keeps them apart, so a test can stage a name clash
    // without also making the account invisible.
    vi.mocked(prisma.salesAccount.findFirst).mockImplementation((async (args: any) =>
      args?.where?.name ? null : { id: "sa-1", ownerEmployeeId: "emp-1" }) as never)
    vi.mocked(prisma.salesAccount.findUniqueOrThrow).mockResolvedValue(CURRENT as any)
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(CURRENT as any)
    vi.mocked(prisma.salesAccount.update).mockImplementation((async (args: any) => ({
      ...CURRENT,
      ...args.data,
    })) as never)
  })

  it("locks the account row before re-reading and authorizing the edit", async () => {
    await updateSalesAccount("sa-1", { industry: "Garments" }, ADMIN)

    expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.anything(), "sa-1")
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.salesAccount.findUnique).mock.invocationCallOrder[0]
    )
  })

  it("takes the account-name lock before checking a renamed account", async () => {
    await updateSalesAccount("sa-1", { name: "RISING GROUP LTD" }, ADMIN)

    expect(prisma.$queryRaw).toHaveBeenNthCalledWith(2, expect.anything())
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(prisma.salesAccount.findFirst).mock.invocationCallOrder[0]
    )
  })

  it("refuses a former owner whose access disappeared before the locked read", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue({
      ...CURRENT,
      ownerEmployeeId: "emp-9",
      owner: { ...CURRENT.owner, fullName: "Nasir" },
      assignments: [],
    } as any)

    await expect(
      updateSalesAccount("sa-1", { industry: "Garments" }, USER)
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(prisma.salesAccount.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("renames the account and audits the change", async () => {
    const result = await updateSalesAccount("sa-1", { name: "Rising Group Ltd" }, ADMIN)

    expect(result.name).toBe("Rising Group Ltd")
    expect(prisma.salesAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "Rising Group Ltd" } })
    )
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "SALES_ACCOUNT",
          action: "UPDATE",
          before: { name: "Rising Group" },
          after: { name: "Rising Group Ltd" },
        }),
      })
    )
  })

  it("audits only the fields that changed", async () => {
    await updateSalesAccount("sa-1", { name: "Rising Group", industry: "Garments" }, ADMIN)

    // `name` was submitted unchanged. A save that re-sends every field must
    // not produce a history row claiming the name was edited.
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          before: { industry: "Textiles" },
          after: { industry: "Garments" },
        }),
      })
    )
  })

  it("writes one singleton audit row for each changed field", async () => {
    await updateSalesAccount(
      "sa-1",
      { industry: "Garments", address: "12 Motijheel C/A" },
      ADMIN
    )

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2)
    expect(prisma.auditLog.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          before: { industry: "Textiles" },
          after: { industry: "Garments" },
        }),
      })
    )
    expect(prisma.auditLog.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          before: { address: null },
          after: { address: "12 Motijheel C/A" },
        }),
      })
    )
  })

  it("writes nothing at all when no field actually changed", async () => {
    await updateSalesAccount("sa-1", { name: "Rising Group" }, ADMIN)

    expect(prisma.salesAccount.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("refuses a rename onto an existing name, and names its owner", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockImplementation((async (args: any) =>
      args?.where?.name
        ? { id: "sa-9", name: "Bengal Group", owner: { fullName: "Rahim" } }
        : { id: "sa-1", ownerEmployeeId: "emp-1" }) as never)

    await expect(
      updateSalesAccount("sa-1", { name: "bengal group" }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("Rahim") })
    expect(prisma.salesAccount.update).not.toHaveBeenCalled()
  })

  it("does not treat the account's own name as a clash when only the case changes", async () => {
    // findFirst is case-insensitive, so renaming "Rising Group" to "Rising
    // group" finds this very row. Excluding self is the difference between a
    // capitalisation fix and a dead end.
    vi.mocked(prisma.salesAccount.findFirst).mockImplementation((async (args: any) =>
      args?.where?.name
        ? { id: "sa-1", name: "Rising Group", owner: { fullName: "Karim" } }
        : { id: "sa-1", ownerEmployeeId: "emp-1" }) as never)

    await expect(
      updateSalesAccount("sa-1", { name: "Rising group" }, ADMIN)
    ).resolves.toMatchObject({ name: "Rising group" })
  })

  it("refuses an owner who has left the company", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "emp-9",
      fullName: "Nasir",
      employmentStatus: "RESIGNED",
      lastWorkingDay: new Date("2026-01-31"),
      user: { salesRole: "SALES_USER", isActive: true },
    } as any)

    await expect(
      updateSalesAccount("sa-1", { ownerEmployeeId: "emp-9" }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("Nasir") })
  })

  it("refuses an owner with no hub access", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "emp-9",
      fullName: "Nasir",
      employmentStatus: "ACTIVE",
      lastWorkingDay: null,
      user: { salesRole: null, isActive: true },
    } as any)

    await expect(
      updateSalesAccount("sa-1", { ownerEmployeeId: "emp-9" }, ADMIN)
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("Techno Sales Hub access"),
    })
  })

  it("refuses a Sales Admin as owner", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "emp-9",
      fullName: "Nasir",
      employmentStatus: "ACTIVE",
      lastWorkingDay: null,
      user: { salesRole: "SALES_ADMIN", isActive: true },
    } as any)

    await expect(
      updateSalesAccount("sa-1", { ownerEmployeeId: "emp-9" }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("Sales Admin") })
  })

  it("reassigns the owner and puts it on the timeline", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "emp-9",
      fullName: "Nasir",
      employmentStatus: "ACTIVE",
      lastWorkingDay: null,
      user: { salesRole: "SALES_USER", isActive: true },
    } as any)

    await updateSalesAccount("sa-1", { ownerEmployeeId: "emp-9" }, ADMIN)

    expect(prisma.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "sales.account.reassigned" }),
      })
    )
  })

  it("removes the new owner from collaborators in the same transaction", async () => {
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue({
      ...CURRENT,
      assignments: [{ employee: { id: "emp-9", fullName: "Nasir" } }],
    } as any)
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "emp-9",
      fullName: "Nasir",
      employmentStatus: "ACTIVE",
      lastWorkingDay: null,
      user: { salesRole: "SALES_USER", isActive: true },
    } as any)

    await updateSalesAccount("sa-1", { ownerEmployeeId: "emp-9" }, ADMIN)

    expect(prisma.salesAccountAssignment.deleteMany).toHaveBeenCalledWith({
      where: { salesAccountId: "sa-1", employeeId: "emp-9" },
    })
  })

  it("requires a reason before an account can go INACTIVE", async () => {
    await expect(
      updateSalesAccount("sa-1", { status: "INACTIVE" }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("why") })
    expect(prisma.salesAccount.update).not.toHaveBeenCalled()
  })

  it("records the reason and puts the status change on the timeline", async () => {
    await updateSalesAccount(
      "sa-1",
      { status: "DO_NOT_CONTACT", statusReason: "They asked us to stop calling" },
      ADMIN
    )

    expect(prisma.salesAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DO_NOT_CONTACT",
          statusReason: "They asked us to stop calling",
        }),
      })
    )
    expect(prisma.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "sales.account.status_changed" }),
      })
    )
  })

  it("clears the reason when the account becomes ACTIVE again", async () => {
    const inactive = {
      ...CURRENT,
      status: "INACTIVE",
      statusReason: "Dormant since March",
    }
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(inactive as any)
    vi.mocked(prisma.salesAccount.findUniqueOrThrow).mockResolvedValue(inactive as any)

    await updateSalesAccount("sa-1", { status: "ACTIVE" }, ADMIN)

    // A stale reason on an active account reads as a live warning about an
    // account nobody is warning you about.
    expect(prisma.salesAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE", statusReason: null }),
      })
    )
  })

  it("requires a new reason when moving between non-active statuses", async () => {
    const inactive = {
      ...CURRENT,
      status: "INACTIVE",
      statusReason: "Dormant since March",
    }
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(inactive as any)
    vi.mocked(prisma.salesAccount.findUniqueOrThrow).mockResolvedValue(inactive as any)

    await expect(
      updateSalesAccount("sa-1", { status: "DO_NOT_CONTACT" }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("why") })
    await expect(
      updateSalesAccount("sa-1", { status: "DO_NOT_CONTACT", statusReason: null }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(prisma.salesAccount.update).not.toHaveBeenCalled()
  })

  it("replaces the reason when moving between non-active statuses", async () => {
    const inactive = {
      ...CURRENT,
      status: "INACTIVE",
      statusReason: "Dormant since March",
    }
    vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(inactive as any)
    vi.mocked(prisma.salesAccount.findUniqueOrThrow).mockResolvedValue(inactive as any)

    await updateSalesAccount(
      "sa-1",
      { status: "DO_NOT_CONTACT", statusReason: "Customer asked us to stop" },
      ADMIN
    )

    expect(prisma.salesAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statusReason: "Customer asked us to stop" }),
      })
    )
  })

  it("refuses a caller who does not work the account", async () => {
    // The shared directory already lets this caller see the account. The
    // refusal therefore names insufficient write access rather than hiding
    // the row behind a 404.

    await expect(updateSalesAccount("sa-1", { name: "Anything" }, USER)).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(prisma.salesAccount.update).not.toHaveBeenCalled()
  })
})
