import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierPayment: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    supplierBill: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { createSupplierPayment } from "./supplierPayment.service"

const ACTOR = { sub: "u1", role: "FINANCE_OFFICER", email: "f@byte.spate", mustChangePassword: false, salesRole: null } as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([
    {
      id: "b1", supplierId: "sup-1", status: "APPROVED", billNumber: "INV-1",
      lines: [{ amount: new Prisma.Decimal("500000"), vatAmount: new Prisma.Decimal("0") }],
      allocations: [], creditNotes: [],
    },
  ] as any)
})

describe("createSupplierPayment", () => {
  it("creates a DRAFT payment with its allocations", async () => {
    vi.mocked(prisma.supplierPayment.create).mockResolvedValue({ id: "p1", status: "DRAFT" } as any)

    await createSupplierPayment(
      { supplierId: "sup-1", date: "2026-10-10", amount: "500000", currency: "BDT", allocations: [{ billId: "b1", amount: "500000" }] },
      ACTOR
    )

    expect(prisma.supplierPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierId: "sup-1",
          status: "DRAFT",
          allocations: { create: [expect.objectContaining({ billId: "b1", amount: "500000" })] },
        }),
      })
    )
  })

  it("creates a pure advance with no allocations", async () => {
    vi.mocked(prisma.supplierPayment.create).mockResolvedValue({ id: "p2", status: "DRAFT" } as any)

    await createSupplierPayment(
      { supplierId: "sup-1", date: "2026-10-10", amount: "200000", currency: "BDT", allocations: [] },
      ACTOR
    )

    expect(prisma.supplierPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ allocations: { create: [] } }) })
    )
  })

  it("refuses an allocation larger than what the bill still owes", async () => {
    await expect(
      createSupplierPayment(
        { supplierId: "sup-1", date: "2026-10-10", amount: "600000", currency: "BDT", allocations: [{ billId: "b1", amount: "600000" }] },
        ACTOR
      )
    ).rejects.toThrow("Bill INV-1 only has 500000.00 left to pay")
    expect(prisma.supplierPayment.create).not.toHaveBeenCalled()
  })

  it("refuses allocations that add up to more than the payment amount", async () => {
    await expect(
      createSupplierPayment(
        { supplierId: "sup-1", date: "2026-10-10", amount: "100000", currency: "BDT", allocations: [{ billId: "b1", amount: "150000" }] },
        ACTOR
      )
    ).rejects.toThrow("Allocations cannot add up to more than the payment amount")
  })
})
