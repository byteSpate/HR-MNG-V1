import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    salesAccount: { findUnique: vi.fn() },
    salesAccountAssignment: { deleteMany: vi.fn() },
    salesCollaboratorRemoval: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    opportunity: { count: vi.fn() },
    employee: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("./account.card", () => ({ visitingCardUrlOf: () => null }))

import prisma from "../../../config/prisma"
import { cancelRemoval, listRemovals, requestRemoval } from "./removal.service"

const OWNER = { sub: "u-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const OTHER = { sub: "u-3", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "u-0", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any

const ACCOUNT = { id: "sa-1", name: "Rising Group", ownerEmployeeId: "emp-1", assignments: [{ employeeId: "emp-3" }] }
const ROW = {
  id: "r-1",
  salesAccountId: "sa-1",
  employeeId: "emp-3",
  requestedBy: "u-1",
  status: "PENDING",
  refusalReason: null,
  decidedAt: null,
  createdAt: new Date("2026-10-05T09:00:00Z"),
  salesAccount: { name: "Rising Group", ownerEmployeeId: "emp-1" },
  employee: { fullName: "Rahim" },
}

async function failureOf(run: () => Promise<unknown>) {
  try {
    await run()
    return null
  } catch (err) {
    return err as { statusCode?: number; message: string }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: any) => fn(prisma)) as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u-1", displayName: null, email: "k@d.c", employee: { fullName: "Karim" } }] as never)
  vi.mocked(prisma.salesAccount.findUnique).mockResolvedValue(ACCOUNT as never)
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-3", fullName: "Rahim" } as never)
  vi.mocked(prisma.opportunity.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.salesCollaboratorRemoval.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.salesCollaboratorRemoval.create).mockResolvedValue(ROW as never)
})

describe("requestRemoval", () => {
  it("lets the Owner ask, and leaves the collaborator in place", async () => {
    const row = await requestRemoval("sa-1", { employeeId: "emp-3" }, OWNER)
    expect(row).toMatchObject({ id: "r-1", status: "PENDING", employeeName: "Rahim" })
    expect(prisma.salesCollaboratorRemoval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { salesAccountId: "sa-1", employeeId: "emp-3", requestedBy: "u-1" } })
    )
    expect(prisma.salesAccountAssignment.deleteMany).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entity: "SALES_COLLABORATOR_REMOVAL", action: "CREATE" }),
    })
  })

  it("refuses a collaborator who is not the Owner", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-3" } } as never)
    expect(await failureOf(() => requestRemoval("sa-1", { employeeId: "emp-3" }, OTHER))).toMatchObject({ statusCode: 403 })
    expect(prisma.salesCollaboratorRemoval.create).not.toHaveBeenCalled()
  })

  it("tells a Sales Admin that no request is needed", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: null } as never)
    const err = await failureOf(() => requestRemoval("sa-1", { employeeId: "emp-3" }, ADMIN))
    expect(err).toMatchObject({ statusCode: 400 })
    expect(err?.message).toContain("directly")
  })

  it("refuses someone who is not a collaborator", async () => {
    expect(await failureOf(() => requestRemoval("sa-1", { employeeId: "emp-9" }, OWNER))).toMatchObject({ statusCode: 404 })
  })

  it("refuses while the person owns an Ongoing Opportunity on the Sales Account", async () => {
    vi.mocked(prisma.opportunity.count).mockResolvedValue(1 as never)
    expect(await failureOf(() => requestRemoval("sa-1", { employeeId: "emp-3" }, OWNER))).toMatchObject({ statusCode: 409 })
    expect(prisma.salesCollaboratorRemoval.create).not.toHaveBeenCalled()
  })

  it("refuses a second request while one is waiting", async () => {
    vi.mocked(prisma.salesCollaboratorRemoval.findFirst).mockResolvedValue({ id: "r-0" } as never)
    const err = await failureOf(() => requestRemoval("sa-1", { employeeId: "emp-3" }, OWNER))
    expect(err).toMatchObject({ statusCode: 409 })
    expect(err?.message).toContain("already waiting")
  })
})

describe("cancelRemoval", () => {
  beforeEach(() => {
    vi.mocked(prisma.salesCollaboratorRemoval.findUnique).mockResolvedValue(ROW as never)
    vi.mocked(prisma.salesCollaboratorRemoval.update).mockResolvedValue({ ...ROW, status: "CANCELLED" } as never)
  })

  it("lets the person who asked cancel it while it waits", async () => {
    const row = await cancelRemoval("r-1", OWNER)
    expect(row.status).toBe("CANCELLED")
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CANCEL", entityId: "r-1" }),
    })
  })

  it("refuses somebody else", async () => {
    expect(await failureOf(() => cancelRemoval("r-1", OTHER))).toMatchObject({ statusCode: 403 })
  })

  it("refuses a request that is already decided", async () => {
    vi.mocked(prisma.salesCollaboratorRemoval.findUnique).mockResolvedValue({ ...ROW, status: "APPROVED" } as never)
    expect(await failureOf(() => cancelRemoval("r-1", OWNER))).toMatchObject({ statusCode: 409 })
  })

  it("answers 404 for a request that does not exist", async () => {
    vi.mocked(prisma.salesCollaboratorRemoval.findUnique).mockResolvedValue(null as never)
    expect(await failureOf(() => cancelRemoval("r-9", OWNER))).toMatchObject({ statusCode: 404 })
  })
})

describe("listRemovals", () => {
  beforeEach(() => {
    vi.mocked(prisma.salesCollaboratorRemoval.findMany).mockResolvedValue([ROW] as never)
  })

  it("shows a Sales Admin every request", async () => {
    await listRemovals({ status: "PENDING" }, ADMIN)
    expect(prisma.salesCollaboratorRemoval.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "PENDING" } })
    )
  })

  it("shows a Sales User only the requests on Sales Accounts they own", async () => {
    await listRemovals({}, OWNER)
    expect(prisma.salesCollaboratorRemoval.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salesAccount: { ownerEmployeeId: "emp-1" } } })
    )
  })

  it("shows a Sales User with no Employee row nothing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: null } as never)
    expect(await listRemovals({}, OWNER)).toEqual([])
    expect(prisma.salesCollaboratorRemoval.findMany).not.toHaveBeenCalled()
  })

  it("narrows to one Sales Account when asked", async () => {
    await listRemovals({ accountId: "sa-1" }, ADMIN)
    expect(prisma.salesCollaboratorRemoval.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salesAccountId: "sa-1" } })
    )
  })
})
