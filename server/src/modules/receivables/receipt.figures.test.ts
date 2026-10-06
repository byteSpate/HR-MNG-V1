import { describe, expect, it, vi } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { loadInvoiceFigures, savedFigures } from "./receipt.figures"

const d = (v: string) => new Prisma.Decimal(v)

describe("savedFigures", () => {
  it("follows the owner's example: 50k invoice, paid 20k, then 15k, then 15k", () => {
    const first = savedFigures([{ invoiceId: "i1", amount: d("20000") }], new Map([["i1", { total: d("50000"), outstanding: d("50000") }]]))
    const second = savedFigures([{ invoiceId: "i1", amount: d("15000") }], new Map([["i1", { total: d("50000"), outstanding: d("30000") }]]))
    const third = savedFigures([{ invoiceId: "i1", amount: d("15000") }], new Map([["i1", { total: d("50000"), outstanding: d("15000") }]]))

    expect([first, second, third].map((r) => [r[0].invoiceTotal.toFixed(2), r[0].balanceAfter.toFixed(2)])).toEqual([
      ["50000.00", "30000.00"],
      ["50000.00", "15000.00"],
      ["50000.00", "0.00"],
    ])
  })

  it("keeps the amount it was given", () => {
    const [row] = savedFigures([{ invoiceId: "i1", amount: d("20000") }], new Map([["i1", { total: d("50000"), outstanding: d("50000") }]]))

    expect(row.invoiceId).toBe("i1")
    expect(row.amount.toFixed(2)).toBe("20000.00")
  })

  it("gives each invoice its own balance when one receipt pays two", () => {
    const rows = savedFigures(
      [{ invoiceId: "i1", amount: d("300") }, { invoiceId: "i2", amount: d("200") }],
      new Map([
        ["i1", { total: d("1000"), outstanding: d("1000") }],
        ["i2", { total: d("500"), outstanding: d("500") }],
      ])
    )

    expect(rows.map((r) => [r.invoiceId, r.balanceAfter.toFixed(2)])).toEqual([["i1", "700.00"], ["i2", "300.00"]])
  })

  it("joins two lines for the same invoice into one row with one balance", () => {
    const rows = savedFigures(
      [{ invoiceId: "i1", amount: d("300") }, { invoiceId: "i1", amount: d("200") }],
      new Map([["i1", { total: d("1000"), outstanding: d("1000") }]])
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].amount.toFixed(2)).toBe("500.00")
    expect(rows[0].balanceAfter.toFixed(2)).toBe("500.00")
  })

  it("adds money exactly, with no floating point drift", () => {
    const [row] = savedFigures([{ invoiceId: "i1", amount: d("0.20") }], new Map([["i1", { total: d("0.30"), outstanding: d("0.30") }]]))

    expect(row.balanceAfter.toFixed(2)).toBe("0.10")
  })

  it("refuses an invoice it has no figures for, instead of saving a wrong balance", () => {
    expect(() => savedFigures([{ invoiceId: "gone", amount: d("1") }], new Map())).toThrow("Invoice not found")
  })
})

describe("loadInvoiceFigures", () => {
  it("takes the total after approved credit notes, and what is still owed after approved payments", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "i1",
        lines: [{ amount: d("870"), vatAmount: d("130") }],
        allocations: [{ amount: d("300") }],
        creditNotes: [{ lines: [{ amount: d("100"), vatAmount: d("0") }] }],
      },
    ])

    const figures = await loadInvoiceFigures({ invoice: { findMany } } as any, ["i1"])

    expect(figures.get("i1")?.total.toFixed(2)).toBe("900.00")
    expect(figures.get("i1")?.outstanding.toFixed(2)).toBe("600.00")
  })

  it("asks only for the invoices it was given", async () => {
    const findMany = vi.fn().mockResolvedValue([])

    await loadInvoiceFigures({ invoice: { findMany } } as any, ["i1", "i2"])

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["i1", "i2"] } } }))
  })
})
