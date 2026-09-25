import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierPayment: { findUnique: vi.fn(), update: vi.fn() },
    journal: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../accounting/accounting.reversal", () => ({ postReversalNow: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { postReversalNow } from "../accounting/accounting.reversal"
import { buildSupplierPaymentLines, reverseSupplierPayment } from "./supplierPayment.posting"

const d = (v: string) => new Prisma.Decimal(v)
const SUPER_ADMIN = { sub: "admin-1", role: "SUPER_ADMIN", email: "a@b.com", mustChangePassword: false, salesRole: null } as any

const RULES = {
  event: "SUPPLIER_PAYMENT" as const,
  byKey: new Map([
    ["PAYABLE", "2111"],
    ["BANK", "1242"],
  ]),
}

const FX_RULES = {
  event: "FX" as const,
  byKey: new Map([
    ["LOSS", "5320"],
    ["GAIN", "4220"],
  ]),
}

type Line = ReturnType<typeof buildSupplierPaymentLines>[number]

function expectBalanced(lines: Line[]) {
  const debit = lines.reduce((s, l) => s.plus(l.debit ?? 0), d("0"))
  const credit = lines.reduce((s, l) => s.plus(l.credit ?? 0), d("0"))
  expect(debit.toFixed(2)).toBe(credit.toFixed(2))
}

function bdtPayment(amount: string, allocations: Array<{ amount: string }>) {
  return {
    id: "p", supplierId: "sup-1", opportunityId: "opp-1", amount: d(amount), sourceAmount: null, currency: "BDT" as const, fxRateToBdt: null,
    allocations: allocations.map((a) => ({ billId: "b1", amount: d(a.amount), amountUsd: null })),
  }
}

describe("buildSupplierPaymentLines, taka", () => {
  it("debits 2111 for the allocated portion, credits 1242 for the full amount, every line carrying the deal", () => {
    const lines = buildSupplierPaymentLines(bdtPayment("500000", [{ amount: "500000" }]), RULES, FX_RULES)

    expect(lines).toEqual([
      expect.objectContaining({ accountCode: "2111", debit: "500000.00", opportunityId: "opp-1" }),
      expect.objectContaining({ accountCode: "1242", credit: "500000.00", opportunityId: "opp-1" }),
    ])
    expectBalanced(lines)
  })
})

describe("buildSupplierPaymentLines, USD", () => {
  // USD 10,000 billed at 122.5 (12,25,000 taka owed), paid at 125.
  function usdPayment(totalUsd: string, allocatedUsd: string) {
    const rate = d("125")
    return {
      id: "p", supplierId: "sup-1", opportunityId: "opp-1", currency: "USD" as const, fxRateToBdt: rate,
      amount: d(totalUsd).times(rate), sourceAmount: d(totalUsd),
      allocations: [{ billId: "b2", amount: d(allocatedUsd).times("122.5"), amountUsd: d(allocatedUsd) }],
    }
  }

  it("clears the bill at its own rate and books the difference as an exchange loss", () => {
    const lines = buildSupplierPaymentLines(usdPayment("10000", "10000"), RULES, FX_RULES)

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "2111", debit: "1225000.00", opportunityId: "opp-1" }),
        expect.objectContaining({ accountCode: "5320", debit: "25000.00", opportunityId: "opp-1" }),
        expect.objectContaining({ accountCode: "1242", credit: "1250000.00", opportunityId: "opp-1" }),
      ])
    )
    expectBalanced(lines)
  })

  it("books a gain when the rate moved in our favour", () => {
    const rate = d("120")
    const payment = {
      id: "p", supplierId: "sup-1", opportunityId: "opp-1", currency: "USD" as const, fxRateToBdt: rate,
      amount: d("10000").times(rate), sourceAmount: d("10000"),
      allocations: [{ billId: "b2", amount: d("1225000"), amountUsd: d("10000") }],
    }
    const lines = buildSupplierPaymentLines(payment, RULES, FX_RULES)

    expect(lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: "4220", credit: "25000.00", opportunityId: "opp-1" })]))
    expectBalanced(lines)
  })
})

function arrangePostedPayment({ id, journalId }: { id: string; journalId: string }) {
  const payment = { id, status: "APPROVED", supplierId: "sup-1" }
  vi.mocked(prisma.supplierPayment.findUnique).mockResolvedValue(payment as any)
  vi.mocked(prisma.supplierPayment.update).mockResolvedValue({ ...payment, status: "REVERSED" } as any)
  vi.mocked(prisma.journal.findFirst).mockResolvedValue({ id: journalId } as any)
  vi.mocked(postReversalNow).mockResolvedValue({ id: journalId, journalNo: "BS-JV-00099" })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("reverseSupplierPayment", () => {
  it("lets a Super Admin reverse a payment, with a reason", async () => {
    arrangePostedPayment({ id: "p1", journalId: "j1" })

    await reverseSupplierPayment("p1", { reason: "Typed the wrong amount" }, SUPER_ADMIN)

    expect(postReversalNow).toHaveBeenCalledWith(expect.anything(), "j1", "Typed the wrong amount", SUPER_ADMIN.sub)
    expect(prisma.supplierPayment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "REVERSED" }),
    }))
  })

  it("refuses a payment that is not approved", async () => {
    vi.mocked(prisma.supplierPayment.findUnique).mockResolvedValue({ id: "p1", status: "REVERSED" } as any)
    await expect(reverseSupplierPayment("p1", { reason: "x" }, SUPER_ADMIN)).rejects.toThrow("This payment is already reversed.")
    expect(postReversalNow).not.toHaveBeenCalled()
  })

  it("refuses a payment that is still a draft", async () => {
    vi.mocked(prisma.supplierPayment.findUnique).mockResolvedValue({ id: "p1", status: "DRAFT" } as any)
    await expect(reverseSupplierPayment("p1", { reason: "x" }, SUPER_ADMIN)).rejects.toThrow(
      "This payment is still a draft. There is nothing posted to reverse yet."
    )
    expect(postReversalNow).not.toHaveBeenCalled()
  })

  it("refuses when no posted journal can be found for the payment", async () => {
    vi.mocked(prisma.supplierPayment.findUnique).mockResolvedValue({ id: "p1", status: "APPROVED", supplierId: "sup-1" } as any)
    vi.mocked(prisma.journal.findFirst).mockResolvedValue(null)
    await expect(reverseSupplierPayment("p1", { reason: "x" }, SUPER_ADMIN)).rejects.toThrow("This payment has no posted entry to reverse.")
  })
})
