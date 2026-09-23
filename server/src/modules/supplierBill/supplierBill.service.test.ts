import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierBill: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    supplierBillLine: { deleteMany: vi.fn() },
    vatCode: { findMany: vi.fn() },
    opportunity: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../payroll/payroll.fx", () => ({
  resolveRateOrThrow: vi.fn().mockResolvedValue({ toFixed: () => "122.500000" }),
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { createSupplierBill, getSupplierBill, listBillableOpportunities, updateSupplierBill } from "./supplierBill.service"

const ACTOR = { sub: "u1", role: "FINANCE_OFFICER", email: "f@byte.spate", mustChangePassword: false, salesRole: null } as any

const INPUT = {
  supplierId: "sup-1",
  billNumber: "INV-2201",
  date: "2026-10-05",
  dueDate: "2026-11-04",
  currency: "BDT" as const,
  lines: [
    { description: "Firewalls", kind: "GOODS" as const, amount: "800000", vatCodeId: "vat-std", opportunityId: "opp-1" },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.vatCode.findMany).mockResolvedValue([{ id: "vat-std", ratePercent: "15.00" }] as any)
  vi.mocked(prisma.opportunity.findMany).mockResolvedValue([{ id: "opp-1", status: "WON", serial: "BS-OPP-00001" }] as any)
})

describe("bill lines and deals", () => {
  it("refuses a line tagged to a deal that is not Won", async () => {
    vi.mocked(prisma.opportunity.findMany).mockResolvedValue([{ id: "opp-1", status: "ONGOING", serial: "BS-OPP-00001" }] as any)
    await expect(createSupplierBill(INPUT, ACTOR)).rejects.toThrow("BS-OPP-00001 is not a Won deal")
  })

  it("refuses a line tagged to a deal that does not exist", async () => {
    vi.mocked(prisma.opportunity.findMany).mockResolvedValue([])
    await expect(createSupplierBill(INPUT, ACTOR)).rejects.toThrow("A bill line names a deal that does not exist")
  })
})

describe("listBillableOpportunities", () => {
  it("lists only Won deals, with their account name", async () => {
    vi.mocked(prisma.opportunity.findMany).mockResolvedValue([
      { id: "opp-1", serial: "BS-OPP-00001", name: "Core refresh", salesAccount: { name: "Acme" } },
    ] as any)

    const result = await listBillableOpportunities()

    expect(prisma.opportunity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "WON" } }))
    expect(result).toEqual([{ id: "opp-1", serial: "BS-OPP-00001", name: "Core refresh", accountName: "Acme" }])
  })
})

describe("createSupplierBill", () => {
  it("creates a DRAFT bill with its lines in one transaction", async () => {
    vi.mocked(prisma.supplierBill.create).mockResolvedValue({ id: "b1", status: "DRAFT" } as any)

    const result = await createSupplierBill(INPUT, ACTOR)

    expect(prisma.supplierBill.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierId: "sup-1",
          billNumber: "INV-2201",
          status: "DRAFT",
          lines: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ description: "Firewalls", amount: "800000" }),
            ]),
          }),
        }),
      })
    )
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: "SUPPLIER_BILL", action: "CREATE" }) })
    )
    expect(result).toEqual({ id: "b1", status: "DRAFT" })
  })
})

describe("createSupplierBill VAT", () => {
  it("freezes each line's VAT from its VAT code's rate", async () => {
    vi.mocked(prisma.supplierBill.create).mockResolvedValue({ id: "b1" } as any)

    await createSupplierBill(INPUT, ACTOR)

    expect(prisma.supplierBill.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: { create: [expect.objectContaining({ amount: "800000", vatAmount: "120000.00" })] },
        }),
      })
    )
  })

  it("refuses a VAT code that does not exist or is inactive", async () => {
    vi.mocked(prisma.vatCode.findMany).mockResolvedValue([])
    await expect(createSupplierBill(INPUT, ACTOR)).rejects.toThrow("Unknown or inactive VAT code")
  })
})

describe("getSupplierBill", () => {
  it("throws 404 when missing", async () => {
    vi.mocked(prisma.supplierBill.findUnique).mockResolvedValue(null)
    await expect(getSupplierBill("missing")).rejects.toThrow(AppError)
  })
})

describe("updateSupplierBill", () => {
  it("refuses once the bill is no longer DRAFT", async () => {
    vi.mocked(prisma.supplierBill.findUnique).mockResolvedValue({ id: "b1", status: "APPROVED" } as any)
    await expect(updateSupplierBill("b1", INPUT, ACTOR)).rejects.toThrow(
      "Only a draft bill can be edited"
    )
  })
})
