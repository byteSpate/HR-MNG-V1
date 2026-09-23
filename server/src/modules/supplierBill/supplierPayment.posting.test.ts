import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { buildFxVarianceLines, buildSupplierPaymentLines } from "./supplierPayment.posting"

const RULES = {
  event: "SUPPLIER_PAYMENT" as const,
  byKey: new Map([
    ["PAYABLE", "2111"],
    ["BANK", "1242"],
    ["ADVANCE", "1232"],
  ]),
}

const FX_RULES = {
  event: "FX" as const,
  byKey: new Map([
    ["LOSS", "5320"],
    ["GAIN", "4220"],
  ]),
}

describe("buildSupplierPaymentLines", () => {
  it("debits 2111 for the allocated portion, credits 1242 for the full amount", () => {
    const payment = {
      id: "p1", supplierId: "sup-1", amount: new Prisma.Decimal("500000"), currency: "BDT" as const, fxRateToBdt: null,
      allocations: [{ billId: "b1", amount: new Prisma.Decimal("500000"), amountUsd: null, matchedAt: null, bill: { fxRateToBdt: null } }],
    }
    const lines = buildSupplierPaymentLines(payment, RULES)

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "2111", debit: "500000.00" }),
        expect.objectContaining({ accountCode: "1242", credit: "500000.00" }),
      ])
    )
  })

  it("debits 1232 for a fully unallocated advance", () => {
    const payment = {
      id: "p2", supplierId: "sup-1", amount: new Prisma.Decimal("200000"), currency: "BDT" as const, fxRateToBdt: null, allocations: [],
    }
    const lines = buildSupplierPaymentLines(payment, RULES)

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "1232", debit: "200000.00" }),
        expect.objectContaining({ accountCode: "1242", credit: "200000.00" }),
      ])
    )
  })

  it("splits between 2111 and 1232 for a partial allocation", () => {
    const payment = {
      id: "p3", supplierId: "sup-1", amount: new Prisma.Decimal("300000"), currency: "BDT" as const, fxRateToBdt: null,
      allocations: [{ billId: "b1", amount: new Prisma.Decimal("100000"), amountUsd: null, matchedAt: null, bill: { fxRateToBdt: null } }],
    }
    const lines = buildSupplierPaymentLines(payment, RULES)

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "2111", debit: "100000.00" }),
        expect.objectContaining({ accountCode: "1232", debit: "200000.00" }),
        expect.objectContaining({ accountCode: "1242", credit: "300000.00" }),
      ])
    )
  })

  it("ignores an allocation matched later by matchAdvance, it posts its own journal", () => {
    const payment = {
      id: "p4", supplierId: "sup-1", amount: new Prisma.Decimal("200000"), currency: "BDT" as const, fxRateToBdt: null,
      allocations: [{ billId: "b1", amount: new Prisma.Decimal("200000"), amountUsd: null, matchedAt: new Date("2026-11-01"), bill: { fxRateToBdt: null } }],
    }
    const lines = buildSupplierPaymentLines(payment, RULES)

    // The whole 200000 is treated as unallocated for THIS journal, since the
    // matched allocation was not part of the original payment split.
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "1232", debit: "200000.00" }),
      ])
    )
    expect(lines.find((l) => l.accountCode === "2111")).toBeUndefined()
  })
})

describe("buildFxVarianceLines", () => {
  it("debits FX loss when more BDT was paid than the bill recorded for the same USD principal", () => {
    const payment = {
      id: "p1", supplierId: "sup-1", amount: new Prisma.Decimal("1250000"), currency: "USD" as const,
      fxRateToBdt: new Prisma.Decimal("125"),
      allocations: [{ billId: "b1", amount: new Prisma.Decimal("1250000"), amountUsd: new Prisma.Decimal("10000"), matchedAt: null, bill: { fxRateToBdt: new Prisma.Decimal("122.5") } }],
    }
    const lines = buildFxVarianceLines(payment, FX_RULES)

    // Bill recorded 10000 x 122.5 = 1225000; paid 10000 x 125 = 1250000.
    // The 25000 shortfall is a loss.
    expect(lines).toEqual([
      expect.objectContaining({ accountCode: "5320", debit: "25000.00", supplierId: "sup-1" }),
    ])
  })

  it("returns nothing for a BDT payment", () => {
    const payment = { id: "p2", supplierId: "sup-1", amount: new Prisma.Decimal("500000"), currency: "BDT" as const, fxRateToBdt: null, allocations: [] }
    expect(buildFxVarianceLines(payment, FX_RULES)).toEqual([])
  })
})
