import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierPayment: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { createSupplierPayment } from "./supplierPayment.service"

const ACTOR = { sub: "u1", role: "FINANCE_OFFICER", email: "f@byte.spate", mustChangePassword: false, salesRole: null } as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
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

  it("refuses allocations that add up to more than the payment amount", async () => {
    await expect(
      createSupplierPayment(
        { supplierId: "sup-1", date: "2026-10-10", amount: "100000", currency: "BDT", allocations: [{ billId: "b1", amount: "150000" }] },
        ACTOR
      )
    ).rejects.toThrow("Allocations cannot add up to more than the payment amount")
  })
})
