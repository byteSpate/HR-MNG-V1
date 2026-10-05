import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    salesAccountAssignment: { deleteMany: vi.fn() },
    salesCollaboratorRemoval: { findUnique: vi.fn(), update: vi.fn() },
    opportunity: { count: vi.fn() },
    user: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("./account.card", () => ({ visitingCardUrlOf: () => null }))

import prisma from "../../../config/prisma"
import { approveRemoval, refuseRemoval } from "./removal.decide"
import { REQUEST_ALREADY_DECIDED } from "./removal.service"

const ADMIN = { sub: "u-0", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const SUPER = { sub: "u-9", role: "SUPER_ADMIN", salesRole: null } as any
const USER = { sub: "u-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any

const PENDING = {
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
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.opportunity.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.salesCollaboratorRemoval.findUnique).mockResolvedValue(PENDING as never)
  vi.mocked(prisma.salesCollaboratorRemoval.update).mockImplementation((async (args: any) => ({ ...PENDING, ...args.data })) as never)
})

describe("approveRemoval", () => {
  it("removes the collaborator, marks it approved, and audits both", async () => {
    const row = await approveRemoval("r-1", ADMIN)
    expect(row.status).toBe("APPROVED")
    expect(prisma.salesAccountAssignment.deleteMany).toHaveBeenCalledWith({
      where: { salesAccountId: "sa-1", employeeId: "emp-3" },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entity: "SALES_COLLABORATOR_REMOVAL", action: "APPROVE", entityId: "r-1" }),
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ entity: "SALES_ACCOUNT_ASSIGNMENT", action: "DELETE" }),
    })
  })

  it("lets the Super Admin approve", async () => {
    expect((await approveRemoval("r-1", SUPER)).status).toBe("APPROVED")
  })

  it("refuses a Sales User", async () => {
    expect(await failureOf(() => approveRemoval("r-1", USER))).toMatchObject({ statusCode: 403 })
    expect(prisma.salesAccountAssignment.deleteMany).not.toHaveBeenCalled()
  })

  it("refuses a request that is already decided, and removes nobody twice", async () => {
    vi.mocked(prisma.salesCollaboratorRemoval.findUnique).mockResolvedValue({ ...PENDING, status: "CANCELLED" } as never)
    expect(await failureOf(() => approveRemoval("r-1", ADMIN))).toMatchObject({
      statusCode: 409,
      message: REQUEST_ALREADY_DECIDED,
    })
    expect(prisma.salesAccountAssignment.deleteMany).not.toHaveBeenCalled()
  })

  it("checks the Opportunity guard again at approval time", async () => {
    vi.mocked(prisma.opportunity.count).mockResolvedValue(1 as never)
    expect(await failureOf(() => approveRemoval("r-1", ADMIN))).toMatchObject({ statusCode: 409 })
    expect(prisma.salesAccountAssignment.deleteMany).not.toHaveBeenCalled()
    expect(prisma.salesCollaboratorRemoval.update).not.toHaveBeenCalled()
  })

  it("answers 404 for a request that does not exist", async () => {
    vi.mocked(prisma.salesCollaboratorRemoval.findUnique).mockResolvedValue(null as never)
    expect(await failureOf(() => approveRemoval("r-9", ADMIN))).toMatchObject({ statusCode: 404 })
  })
})

describe("refuseRemoval", () => {
  it("marks it refused with the reason, and keeps the collaborator", async () => {
    const row = await refuseRemoval("r-1", { reason: "They still work on this account." }, ADMIN)
    expect(row).toMatchObject({ status: "REFUSED", refusalReason: "They still work on this account." })
    expect(prisma.salesAccountAssignment.deleteMany).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "REJECT", entityId: "r-1" }),
    })
  })

  it("refuses a Sales User", async () => {
    expect(await failureOf(() => refuseRemoval("r-1", { reason: "No" }, USER))).toMatchObject({ statusCode: 403 })
  })

  it("refuses a request that is already decided", async () => {
    vi.mocked(prisma.salesCollaboratorRemoval.findUnique).mockResolvedValue({ ...PENDING, status: "APPROVED" } as never)
    expect(await failureOf(() => refuseRemoval("r-1", { reason: "No reason" }, ADMIN))).toMatchObject({ statusCode: 409 })
  })
})
