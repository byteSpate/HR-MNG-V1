import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    customer: { findUnique: vi.fn() },
    customerOpeningBalance: { findUnique: vi.fn() },
    invoice: { findMany: vi.fn() },
    receipt: { findMany: vi.fn() },
    customerCreditNote: { findMany: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { buildCustomerStatementHtml, getCustomerStatement } from "./receivables.statement"

function arrangeCustomer(o: {
  opening: { amount: string; asOf: string } | null
  invoices: Array<{ invoiceNumber: string; date: string; gross: string }>
  receipts: Array<{ reference: string; date: string; settled: string }>
  creditNotes: Array<{ invoiceNumber: string; date: string; gross: string }>
}) {
  vi.mocked(prisma.customer.findUnique).mockResolvedValue({
    id: "c1", legalName: "Bengal Group", billingAddress: null, bin: null,
  } as any)
  vi.mocked(prisma.customerOpeningBalance.findUnique).mockResolvedValue(
    o.opening ? { amount: o.opening.amount, asOf: new Date(o.opening.asOf) } : null
  )
  vi.mocked(prisma.invoice.findMany).mockResolvedValue(
    o.invoices.map((i, idx) => ({
      id: `inv${idx}`, invoiceNumber: i.invoiceNumber, date: new Date(i.date),
      lines: [{ amount: i.gross, vatAmount: "0" }],
    })) as any
  )
  vi.mocked(prisma.receipt.findMany).mockResolvedValue(
    o.receipts.map((r, idx) => ({ id: `r${idx}`, reference: r.reference, date: new Date(r.date), amount: r.settled, vdsAmount: "0", aitAmount: "0" })) as any
  )
  vi.mocked(prisma.customerCreditNote.findMany).mockResolvedValue(
    o.creditNotes.map((c, idx) => ({
      id: `cn${idx}`, date: new Date(c.date), invoice: { invoiceNumber: c.invoiceNumber },
      lines: [{ amount: c.gross, vatAmount: "0" }],
    })) as any
  )
}

beforeEach(() => vi.clearAllMocks())

describe("getCustomerStatement", () => {
  it("carries in what was owed before the range and runs a balance through it", async () => {
    arrangeCustomer({
      opening: { amount: "200000", asOf: "2026-07-01" },
      invoices: [
        { invoiceNumber: "INV-0", date: "2026-08-15", gross: "50000" },
        { invoiceNumber: "INV-1", date: "2026-09-05", gross: "1150000" },
      ],
      receipts: [{ reference: "TT-4471", date: "2026-09-20", settled: "1150000" }],
      creditNotes: [{ invoiceNumber: "INV-1", date: "2026-09-22", gross: "23000" }],
    })

    const s = await getCustomerStatement("c1", { from: new Date("2026-09-01"), to: new Date("2026-09-30") })

    expect(s.openingBalance).toBe("250000.00")
    expect(s.entries.map((e) => [e.kind, e.reference, e.debit, e.credit, e.balance])).toEqual([
      ["Invoice", "INV-1", "1150000.00", null, "1400000.00"],
      ["Receipt", "Receipt TT-4471", null, "1150000.00", "250000.00"],
      ["Credit note", "Credit note on INV-1", null, "23000.00", "227000.00"],
    ])
    expect(s.closingBalance).toBe("227000.00")
  })

  it("shows the opening balance as the first entry when go-live falls inside the range", async () => {
    arrangeCustomer({ opening: { amount: "200000", asOf: "2026-07-01" }, invoices: [], receipts: [], creditNotes: [] })

    const s = await getCustomerStatement("c1", { from: new Date("2026-07-01"), to: new Date("2026-07-31") })

    expect(s.openingBalance).toBe("0.00")
    expect(s.entries[0]).toMatchObject({ kind: "Opening balance", debit: "200000.00", balance: "200000.00" })
  })

  it("counts approved documents only", async () => {
    arrangeCustomer({ opening: null, invoices: [], receipts: [], creditNotes: [] })

    await getCustomerStatement("c1", { from: new Date("2026-09-01"), to: new Date("2026-09-30") })

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "APPROVED" }) }))
    expect(prisma.receipt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "APPROVED" }) }))
    expect(prisma.customerCreditNote.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "APPROVED" }) }))
  })

  it("404s a customer that does not exist", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null)
    await expect(getCustomerStatement("nope", { from: new Date("2026-09-01"), to: new Date("2026-09-30") }))
      .rejects.toThrow("Customer not found")
  })
})

describe("buildCustomerStatementHtml", () => {
  const S = {
    customer: { legalName: "Bengal <Group>", billingAddress: null, bin: null },
    from: new Date("2026-09-01"), to: new Date("2026-09-30"),
    openingBalance: "0.00", entries: [], closingBalance: "227000.00",
  }

  it("escapes the customer's name", () => {
    expect(buildCustomerStatementHtml(S, { name: "Byte Spate", address: "", logo: null })).toContain("Bengal &lt;Group&gt;")
  })

  it("prints money the way the company's statements do", () => {
    expect(buildCustomerStatementHtml(S, { name: "Byte Spate", address: "", logo: null })).toContain("2,27,000.00")
  })

  it("says so when nothing happened in the range, instead of an empty table", () => {
    expect(buildCustomerStatementHtml(S, { name: "Byte Spate", address: "", logo: null }))
      .toContain("No invoices, receipts or credit notes in this period.")
  })
})
