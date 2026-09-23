import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierBill: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    supplierBillLine: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../payroll/payroll.fx", () => ({
  resolveRateOrThrow: vi.fn().mockResolvedValue({ toFixed: () => "122.500000" }),
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { createSupplierBill, getSupplierBill, updateSupplierBill } from "./supplierBill.service"

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
