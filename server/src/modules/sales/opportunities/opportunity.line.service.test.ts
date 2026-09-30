import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
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

import prisma from "../../../config/prisma"
import { dec } from "../../payroll/payroll.money"
import {
  addOpportunityLine, deleteOpportunityLine, reorderOpportunityLines,
  suggestOpportunityLineValues, updateOpportunityLine,
} from "./opportunity.line.service"
import { presentLine } from "./opportunity.present"
import { createOpportunityLineSchema, updateOpportunityLineSchema } from "./opportunity.validators"

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "sales@example.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as any
const OPP = { id: "opp-1", salesAccountId: "account-1", track: "NETWORKING", salesAccount: { ownerEmployeeId: "emp-1" } }
const LINE = {
  id: "line-1", opportunityId: "opp-1", product: "Switch", oemBrand: "Cisco",
  model: null, partNo: null, quantity: 2, unitValue: dec("100"), lineValue: null,
  note: null, order: 0, createdAt: new Date("2026-09-09"), updatedAt: new Date("2026-09-09"),
  // The parent Opportunity's track, which decides whether this line is a
  // Networking product or a Software module.
  opportunity: { track: "NETWORKING" },
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
    expect(prisma.opportunityLine.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      opportunityId: "opp-1", order: 2, unitValue: expect.anything(), lineValue: null,
      // No margin typed is "no margin yet", not 0%.
      marginPercent: null,
    }) }))
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

  it("lets an editor clear optional prices instead of silently storing zero", async () => {
    vi.mocked(prisma.opportunityLine.findFirst).mockResolvedValue({
      ...LINE, unitValue: dec("100"), lineValue: dec("200"),
    } as any)
    await updateOpportunityLine("line-1", { unitValue: null, lineValue: null } as any, USER)
    expect(prisma.opportunityLine.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ unitValue: null, lineValue: null }),
    }))
  })

  it("stores a product's margin percentage and answers with its margin in taka", async () => {
    vi.mocked(prisma.opportunityLine.create).mockResolvedValue({
      ...LINE, lineValue: dec("10000"), marginPercent: dec("12"), order: 2,
    } as any)

    const created = await addOpportunityLine("opp-1", {
      product: "Switch", lineValue: "10000", marginPercent: "12",
    }, USER)

    const data = vi.mocked(prisma.opportunityLine.create).mock.calls[0][0].data as any
    expect(data.marginPercent.toFixed(2)).toBe("12.00")
    // 12% of the Total price, worked out when read.
    expect(created).toMatchObject({ marginPercent: "12.00", marginAmount: "1200.00" })
  })

  it("audits a product's margin change, old beside new, and lets it be cleared", async () => {
    vi.mocked(prisma.opportunityLine.findFirst).mockResolvedValue({ ...LINE, marginPercent: dec("10") } as any)

    await updateOpportunityLine("line-1", { marginPercent: "15" } as any, USER)

    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entity: "OPPORTUNITY_LINE",
        before: { marginPercent: "10.00" },
        after: { marginPercent: "15.00" },
      }),
    }))

    vi.mocked(prisma.opportunityLine.update).mockClear()
    await updateOpportunityLine("line-1", { marginPercent: null } as any, USER)
    expect(prisma.opportunityLine.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { marginPercent: null },
    }))
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
  it("asks for product suggestions without a null check, which Prisma refuses on a required column", async () => {
    vi.mocked(prisma.opportunityLine.groupBy).mockResolvedValue([
      { product: "Firewall", _count: { product: 2 } },
    ] as any)

    const result = await suggestOpportunityLineValues({ field: "product", q: "fire" }, USER)

    expect(result).toEqual(["Firewall"])
    const args = vi.mocked(prisma.opportunityLine.groupBy).mock.calls[0][0] as any
    // `product` is NOT NULL, and Prisma 7 rejects `not: null` on it ("Argument
    // `not` must not be null"), so every product suggestion answered 500.
    // `contains` already skips null rows, on every column, so no check is needed.
    expect(args.where.product).toEqual({ contains: "fire", mode: "insensitive" })
  })

  it("scopes prior values through visible accounts, orders by frequency, and caps at 20", async () => {
    vi.mocked(prisma.opportunityLine.groupBy).mockResolvedValue([
      { oemBrand: "Cisco", _count: { oemBrand: 4 } },
    ] as any)
    const result = await suggestOpportunityLineValues({ field: "brand", q: "cis" }, USER)
    expect(result).toEqual(["Cisco"])
    expect(prisma.opportunityLine.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ["oemBrand"], take: 20,
      where: expect.objectContaining({
        oemBrand: { contains: "cis", mode: "insensitive" },
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

describe("modules on a Software Opportunity", () => {
  const SOFTWARE = () => vi.mocked(prisma.opportunity.findFirst).mockResolvedValue({ ...OPP, track: "SOFTWARE_DEVELOPMENT" } as any)

  it("refuses Networking fields on a Software module", async () => {
    SOFTWARE()
    await expect(addOpportunityLine("opp-1", { product: "HR module", model: "X1" } as any, USER))
      .rejects.toThrow("A module has a name, what it covers, and a price. OEM, model, part number, quantity, unit price, margin and supplier are for Networking products.")
    expect(prisma.opportunityLine.create).not.toHaveBeenCalled()
  })

  it("refuses a supplier on a Software module", async () => {
    SOFTWARE()
    await expect(addOpportunityLine("opp-1", { product: "HR module", supplierId: "s1" } as any, USER))
      .rejects.toThrow("A module has a name, what it covers, and a price.")
  })

  it("lets an empty Networking field through, because clearing is not setting", async () => {
    SOFTWARE()
    await addOpportunityLine("opp-1", { product: "HR module", model: "", oemBrand: null } as any, USER)
    expect(prisma.opportunityLine.create).toHaveBeenCalled()
  })

  it("adds a module with a name, what it covers and a price", async () => {
    SOFTWARE()
    await addOpportunityLine("opp-1", { product: "HR module", note: "Leave and attendance", lineValue: "250000" } as any, USER)
    expect(prisma.opportunityLine.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ product: "HR module", note: "Leave and attendance" }),
    }))
  })

  it("refuses Networking fields when a module is edited", async () => {
    vi.mocked(prisma.opportunityLine.findFirst).mockResolvedValue({
      ...LINE, opportunity: { track: "SOFTWARE_DEVELOPMENT" },
    } as any)
    await expect(updateOpportunityLine("line-1", { quantity: 4 } as any, USER))
      .rejects.toThrow("A module has a name, what it covers, and a price.")
  })

  it("still takes every Networking field on a Networking product", async () => {
    vi.mocked(prisma.opportunityLine.findFirst).mockResolvedValue(LINE as any)
    await updateOpportunityLine("line-1", { quantity: 4 } as any, USER)
    expect(prisma.opportunityLine.update).toHaveBeenCalled()
  })
})

describe("a product's part number", () => {
  it("is stored trimmed on a new product, and a blank one is stored as no part number", async () => {
    await addOpportunityLine("opp-1", { product: "Firewall", partNo: "FG-100F-BDL" } as any, USER)
    expect(vi.mocked(prisma.opportunityLine.create).mock.calls[0][0].data).toMatchObject({ partNo: "FG-100F-BDL" })
    vi.clearAllMocks()
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(OPP as any)
    vi.mocked(prisma.opportunityLine.aggregate).mockResolvedValue({ _max: { order: 1 } } as any)
    vi.mocked(prisma.opportunityLine.create).mockResolvedValue({ ...LINE, order: 2 } as any)
    await addOpportunityLine("opp-1", { product: "Firewall", partNo: "" } as any, USER)
    expect(vi.mocked(prisma.opportunityLine.create).mock.calls[0][0].data).toMatchObject({ partNo: null })
  })

  it("is null when none is given", async () => {
    await addOpportunityLine("opp-1", { product: "Firewall" } as any, USER)
    expect(vi.mocked(prisma.opportunityLine.create).mock.calls[0][0].data).toMatchObject({ partNo: null })
  })

  it("can be added to a product later, and the history shows old beside new", async () => {
    await updateOpportunityLine("line-1", { partNo: "FG-100F" } as any, USER)
    expect(vi.mocked(prisma.opportunityLine.update).mock.calls[0][0].data).toMatchObject({ partNo: "FG-100F" })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ before: { partNo: null }, after: { partNo: "FG-100F" } }),
    }))
  })

  it("can be cleared by sending null", async () => {
    vi.mocked(prisma.opportunityLine.findFirst).mockResolvedValue({ ...LINE, partNo: "FG-100F" } as any)
    await updateOpportunityLine("line-1", { partNo: null } as any, USER)
    expect(vi.mocked(prisma.opportunityLine.update).mock.calls[0][0].data).toMatchObject({ partNo: null })
  })

  it("is left alone when the same value is sent again, so History says nothing changed", async () => {
    vi.mocked(prisma.opportunityLine.findFirst).mockResolvedValue({ ...LINE, partNo: "FG-100F" } as any)
    await expect(updateOpportunityLine("line-1", { partNo: "FG-100F" } as any, USER)).resolves.toBeDefined()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("is refused on a Software module, like the other Networking fields", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue({ ...OPP, track: "SOFTWARE_DEVELOPMENT" } as any)
    await expect(addOpportunityLine("opp-1", { product: "HR module", partNo: "X1" } as any, USER))
      .rejects.toThrow("A module has a name, what it covers, and a price. OEM, model, part number, quantity, unit price, margin and supplier are for Networking products.")
    expect(prisma.opportunityLine.create).not.toHaveBeenCalled()
  })

  it("is answered on the line", () => {
    const row = { ...LINE, id: "l1", partNo: "FG-100F", createdAt: new Date("2026-09-09"), updatedAt: new Date("2026-09-09") }
    expect(presentLine(row).partNo).toBe("FG-100F")
    expect(presentLine({ ...row, partNo: undefined }).partNo).toBeNull()
  })

  it("is limited to 80 characters and may be null on an edit", () => {
    expect(createOpportunityLineSchema.safeParse({ product: "Firewall", partNo: "x".repeat(81) }).success).toBe(false)
    expect(createOpportunityLineSchema.safeParse({ product: "Firewall", partNo: "x".repeat(80) }).success).toBe(true)
    expect(updateOpportunityLineSchema.safeParse({ partNo: null }).success).toBe(true)
  })
})
