import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    salesAccount: { findFirst: vi.fn() },
    opportunity: { findFirst: vi.fn(), update: vi.fn() },
    opportunityLine: {
      aggregate: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn(),
      delete: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { dec } from "../payroll/payroll.money"
import {
  addOpportunityLine, deleteOpportunityLine, reorderOpportunityLines,
  suggestOpportunityLineValues, updateOpportunityLine,
} from "./opportunity.line.service"

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "sales@example.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as any
const OPP = { id: "opp-1", salesAccountId: "account-1", salesAccount: { ownerEmployeeId: "emp-1" } }
const LINE = {
  id: "line-1", opportunityId: "opp-1", product: "Switch", oemBrand: "Cisco",
  model: null, quantity: 2, unitValue: dec("100"), lineValue: null,
  note: null, order: 0, createdAt: new Date("2026-09-09"), updatedAt: new Date("2026-09-09"),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(OPP as any)
  vi.mocked(prisma.opportunityLine.aggregate).mockResolvedValue({ _max: { order: 1 } } as any)
  vi.mocked(prisma.opportunityLine.create).mockResolvedValue({ ...LINE, order: 2 } as any)
  vi.mocked(prisma.opportunityLine.findFirst).mockResolvedValue(LINE as any)
  vi.mocked(prisma.opportunityLine.update).mockResolvedValue(LINE as any)
  vi.mocked(prisma.opportunityLine.findMany).mockResolvedValue([LINE] as any)
})

describe("opportunity lines", () => {
  it("assigns max order plus one and never derives lineValue", async () => {
    await addOpportunityLine("opp-1", {
      product: "Switch", quantity: 2, unitValue: "100",
    }, USER)
    expect(prisma.opportunityLine.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      opportunityId: "opp-1", order: 2, unitValue: expect.anything(), lineValue: null,
    }) })
    expect(prisma.opportunity.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { lastActivityAt: expect.any(Date) },
    }))
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "OPPORTUNITY_LINE", action: "CREATE" }),
    }))
  })

  it("edits and deletes only after inheriting opportunity access", async () => {
    await updateOpportunityLine("line-1", { model: "C9300" }, USER)
    expect(prisma.opportunityLine.update).toHaveBeenCalled()
    await deleteOpportunityLine("line-1", USER)
    expect(prisma.opportunityLine.delete).toHaveBeenCalledWith({ where: { id: "line-1" } })
  })

  it("refuses reorder arrays that omit or introduce line ids", async () => {
    await expect(reorderOpportunityLines("opp-1", { lineIds: ["line-1", "line-2"] }, USER))
      .rejects.toThrow(/all.*lines/i)
    expect(prisma.opportunityLine.update).not.toHaveBeenCalled()
  })

  it("reorders every line and audits the change", async () => {
    vi.mocked(prisma.opportunityLine.findMany).mockResolvedValue([
      LINE, { ...LINE, id: "line-2", order: 1 },
    ] as any)
    await reorderOpportunityLines("opp-1", { lineIds: ["line-2", "line-1"] }, USER)
    expect(prisma.opportunityLine.update).toHaveBeenCalledTimes(2)
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2)
  })
})

describe("OEM suggestions", () => {
  it("scopes prior values through visible accounts, orders by frequency, and caps at 20", async () => {
    vi.mocked(prisma.opportunityLine.groupBy).mockResolvedValue([
      { oemBrand: "Cisco", _count: { oemBrand: 4 } },
    ] as any)
    const result = await suggestOpportunityLineValues({ field: "brand", q: "cis" }, USER)
    expect(result).toEqual(["Cisco"])
    expect(prisma.opportunityLine.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ["oemBrand"], take: 20,
      where: expect.objectContaining({
        oemBrand: { not: null, contains: "cis", mode: "insensitive" },
        opportunity: { salesAccount: {
          OR: [
            { ownerEmployeeId: "emp-1" },
            { assignments: { some: { employeeId: "emp-1" } } },
          ],
        } },
      }),
    }))
  })
})
