import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { buildSupplierPaymentLines } from "./supplierPayment.posting"

const d = (v: string) => new Prisma.Decimal(v)

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
    id: "p", supplierId: "sup-1", amount: d(amount), sourceAmount: null, currency: "BDT" as const, fxRateToBdt: null,
    allocations: allocations.map((a) => ({ billId: "b1", amount: d(a.amount), amountUsd: null })),
  }
}

describe("buildSupplierPaymentLines, taka", () => {
  it("debits 2111 for the allocated portion, credits 1242 for the full amount", () => {
    const lines = buildSupplierPaymentLines(bdtPayment("500000", [{ amount: "500000" }]), RULES, FX_RULES)

    expect(lines).toEqual([
      expect.objectContaining({ accountCode: "2111", debit: "500000.00" }),
      expect.objectContaining({ accountCode: "1242", credit: "500000.00" }),
    ])
    expectBalanced(lines)
  })
})

describe("buildSupplierPaymentLines, USD", () => {
  // USD 10,000 billed at 122.5 (12,25,000 taka owed), paid at 125.
  function usdPayment(totalUsd: string, allocatedUsd: string) {
    const rate = d("125")
    return {
      id: "p", supplierId: "sup-1", currency: "USD" as const, fxRateToBdt: rate,
      amount: d(totalUsd).times(rate), sourceAmount: d(totalUsd),
      allocations: [{ billId: "b2", amount: d(allocatedUsd).times("122.5"), amountUsd: d(allocatedUsd) }],
    }
  }

  it("clears the bill at its own rate and books the difference as an exchange loss", () => {
    const lines = buildSupplierPaymentLines(usdPayment("10000", "10000"), RULES, FX_RULES)

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "2111", debit: "1225000.00" }),
        expect.objectContaining({ accountCode: "5320", debit: "25000.00" }),
        expect.objectContaining({ accountCode: "1242", credit: "1250000.00" }),
      ])
    )
    expectBalanced(lines)
  })

  it("books a gain when the rate moved in our favour", () => {
    const rate = d("120")
    const payment = {
      id: "p", supplierId: "sup-1", currency: "USD" as const, fxRateToBdt: rate, amount: d("10000").times(rate), sourceAmount: d("10000"),
      allocations: [{ billId: "b2", amount: d("1225000"), amountUsd: d("10000") }],
    }
    const lines = buildSupplierPaymentLines(payment, RULES, FX_RULES)

    expect(lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: "4220", credit: "25000.00" })]))
    expectBalanced(lines)
  })
})
