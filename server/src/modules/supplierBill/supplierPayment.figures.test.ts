import { describe, expect, it, vi } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { loadBillFigures, savedFigures } from "./supplierPayment.figures"

const d = (v: string) => new Prisma.Decimal(v)
const bdt = (total: string, outstanding: string) => ({ total: d(total), outstanding: d(outstanding), currency: "BDT" as const, fxRateToBdt: null })
const alloc = (billId: string, amount: string, amountUsd: string | null = null) => ({ billId, amount, amountUsd })

describe("savedFigures", () => {
  it("follows the owner's example: a 50k bill paid 20k, then 15k, then 15k", () => {
    const first = savedFigures([alloc("b1", "20000")], new Map([["b1", bdt("50000", "50000")]]))
    const second = savedFigures([alloc("b1", "15000")], new Map([["b1", bdt("50000", "30000")]]))
    const third = savedFigures([alloc("b1", "15000")], new Map([["b1", bdt("50000", "15000")]]))

    expect([first, second, third].map((r) => [r[0].billTotal.toFixed(2), r[0].balanceAfter.toFixed(2)])).toEqual([
      ["50000.00", "30000.00"],
      ["50000.00", "15000.00"],
      ["50000.00", "0.00"],
    ])
  })

  it("keeps the amount, and has no US dollar figures for a taka bill", () => {
    const [row] = savedFigures([alloc("b1", "20000")], new Map([["b1", bdt("50000", "50000")]]))

    expect(row.amount.toFixed(2)).toBe("20000.00")
    expect(row.amountUsd).toBeNull()
    expect(row.billTotalUsd).toBeNull()
    expect(row.balanceAfterUsd).toBeNull()
  })

  it("gives a US dollar bill its dollar figures too, at the bill's own rate", () => {
    // USD 10,000 at 122.5 is 1,225,000 taka. A payment of USD 4,000 clears 490,000.
    const before = new Map([["b2", { total: d("1225000"), outstanding: d("1225000"), currency: "USD" as const, fxRateToBdt: d("122.5") }]])

    const [row] = savedFigures([alloc("b2", "490000", "4000")], before)

    expect(row.billTotal.toFixed(2)).toBe("1225000.00")
    expect(row.balanceAfter.toFixed(2)).toBe("735000.00")
    expect(row.amountUsd?.toFixed(2)).toBe("4000.00")
    expect(row.billTotalUsd?.toFixed(2)).toBe("10000.00")
    expect(row.balanceAfterUsd?.toFixed(2)).toBe("6000.00")
  })

  it("gives each bill its own balance when one payment pays two", () => {
    const rows = savedFigures(
      [alloc("b1", "300"), alloc("b2", "200")],
      new Map([["b1", bdt("1000", "1000")], ["b2", bdt("500", "500")]])
    )

    expect(rows.map((r) => [r.billId, r.balanceAfter.toFixed(2)])).toEqual([["b1", "700.00"], ["b2", "300.00"]])
  })

  it("joins two lines for the same bill into one row with one balance", () => {
    const rows = savedFigures([alloc("b1", "300"), alloc("b1", "200")], new Map([["b1", bdt("1000", "1000")]]))

    expect(rows).toHaveLength(1)
    expect(rows[0].amount.toFixed(2)).toBe("500.00")
    expect(rows[0].balanceAfter.toFixed(2)).toBe("500.00")
  })

  it("adds money exactly, with no floating point drift", () => {
    const [row] = savedFigures([alloc("b1", "0.20")], new Map([["b1", bdt("0.30", "0.30")]]))

    expect(row.balanceAfter.toFixed(2)).toBe("0.10")
  })

  it("refuses a bill it has no figures for, instead of saving a wrong balance", () => {
    expect(() => savedFigures([alloc("gone", "1")], new Map())).toThrow("Bill not found")
  })
})

describe("loadBillFigures", () => {
  it("takes the total after approved credit notes, and what is still owed after approved payments", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "b1", currency: "BDT", fxRateToBdt: null,
        lines: [{ amount: d("870"), vatAmount: d("130") }],
        allocations: [{ amount: d("300") }],
        creditNotes: [{ lines: [{ amount: d("100"), vatAmount: d("0") }] }],
      },
    ])

    const figures = await loadBillFigures({ supplierBill: { findMany } } as any, ["b1"])

    expect(figures.get("b1")?.total.toFixed(2)).toBe("900.00")
    expect(figures.get("b1")?.outstanding.toFixed(2)).toBe("600.00")
    expect(figures.get("b1")?.currency).toBe("BDT")
  })

  it("asks only for the bills it was given, counting approved payments and credit notes only", async () => {
    const findMany = vi.fn().mockResolvedValue([])

    await loadBillFigures({ supplierBill: { findMany } } as any, ["b1", "b2"])

    const arg = findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ id: { in: ["b1", "b2"] } })
    expect(arg.select.allocations.where).toEqual({ payment: { status: "APPROVED" } })
    expect(arg.select.creditNotes.where).toEqual({ status: "APPROVED" })
  })
})
