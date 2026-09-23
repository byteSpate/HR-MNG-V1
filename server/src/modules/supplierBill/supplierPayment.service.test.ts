import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierPayment: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    supplierBill: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../payroll/payroll.fx", () => ({
  resolveRateOrThrow: vi.fn(),
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { resolveRateOrThrow } from "../payroll/payroll.fx"
import { createSupplierPayment } from "./supplierPayment.service"

const ACTOR = { sub: "u1", role: "FINANCE_OFFICER", email: "f@byte.spate", mustChangePassword: false, salesRole: null } as any
const d = (v: string) => new Prisma.Decimal(v)

const BDT_BILL = {
  id: "b1", supplierId: "sup-1", status: "APPROVED", billNumber: "INV-1", currency: "BDT", fxRateToBdt: null,
  lines: [{ amount: d("500000"), vatAmount: d("0") }],
  allocations: [], creditNotes: [],
}

// USD 10,000 billed at 122.5, recorded as 12,25,000 taka.
const USD_BILL = {
  id: "b2", supplierId: "sup-1", status: "APPROVED", billNumber: "INV-2", currency: "USD", fxRateToBdt: d("122.5"),
  lines: [{ amount: d("1225000"), vatAmount: d("0") }],
  allocations: [], creditNotes: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([BDT_BILL] as any)
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
          amount: "500000.00",
          allocations: { create: [expect.objectContaining({ billId: "b1", amount: "500000.00", amountUsd: null })] },
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

describe("createSupplierPayment in USD", () => {
  it("converts at the payment-date rate, and clears each USD bill at that bill's own rate", async () => {
    vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([USD_BILL] as any)
    vi.mocked(resolveRateOrThrow).mockResolvedValue(d("125") as any)
    vi.mocked(prisma.supplierPayment.create).mockResolvedValue({ id: "p3" } as any)

    await createSupplierPayment(
      { supplierId: "sup-1", date: "2026-11-01", amount: "10000", currency: "USD", allocations: [{ billId: "b2", amount: "10000" }] },
      ACTOR
    )

    expect(prisma.supplierPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currency: "USD",
          amount: "1250000.00",
          sourceAmount: "10000",
          fxRateToBdt: "125.000000",
          allocations: {
            create: [expect.objectContaining({ billId: "b2", amount: "1225000.00", amountUsd: "10000" })],
          },
        }),
      })
    )
  })

  it("refuses a USD payment against a taka bill", async () => {
    vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([BDT_BILL] as any)
    vi.mocked(resolveRateOrThrow).mockResolvedValue(d("125") as any)

    await expect(
      createSupplierPayment(
        { supplierId: "sup-1", date: "2026-11-01", amount: "1000", currency: "USD", allocations: [{ billId: "b1", amount: "1000" }] },
        ACTOR
      )
    ).rejects.toThrow("A USD payment can only settle a USD bill. Bill INV-1 is in taka.")
  })
})
