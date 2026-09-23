import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierPayment: { findUnique: vi.fn(), update: vi.fn() },
    supplierPaymentAllocation: { create: vi.fn() },
    supplierBill: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { approveSupplierPayment, matchAdvance } from "./supplierPayment.posting"

const d = (v: string) => new Prisma.Decimal(v)
const ADMIN = { sub: "admin-1", role: "SUPER_ADMIN", email: "a@b.com", mustChangePassword: false, salesRole: null } as any

// A bill with only 100000 left to pay.
const NEARLY_PAID_BILL = {
  id: "b1", supplierId: "sup-1", status: "APPROVED", billNumber: "INV-1",
  lines: [{ amount: d("500000"), vatAmount: d("0") }],
  allocations: [{ amount: d("400000") }], creditNotes: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([NEARLY_PAID_BILL] as any)
})

describe("approveSupplierPayment", () => {
  it("re-checks allocations at approval, since another payment may have been approved against the same bill", async () => {
    vi.mocked(prisma.supplierPayment.findUnique).mockResolvedValue({
      id: "p1", supplierId: "sup-1", status: "DRAFT", createdBy: "finance-1",
      allocations: [{ billId: "b1", amount: d("300000"), matchedAt: null }],
    } as any)

    await expect(approveSupplierPayment("p1", ADMIN)).rejects.toThrow("Bill INV-1 only has 100000.00 left to pay")
    expect(prisma.supplierPayment.update).not.toHaveBeenCalled()
  })
})

describe("matchAdvance", () => {
  it("refuses to match more than the bill still owes", async () => {
    vi.mocked(prisma.supplierPayment.findUnique).mockResolvedValue({
      id: "p2", supplierId: "sup-1", status: "APPROVED", amount: d("500000"), allocations: [],
    } as any)

    await expect(matchAdvance("p2", { billId: "b1", amount: "200000" }, ADMIN)).rejects.toThrow(
      "Bill INV-1 only has 100000.00 left to pay"
    )
    expect(prisma.supplierPaymentAllocation.create).not.toHaveBeenCalled()
  })
})
