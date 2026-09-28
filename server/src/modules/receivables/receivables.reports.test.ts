import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { getInvoiceOutstanding } from "./receivables.reports"

const d = (v: string) => new Prisma.Decimal(v)

describe("getInvoiceOutstanding", () => {
  it("is gross less approved receipts less approved credit notes", () => {
    expect(getInvoiceOutstanding({
      lines: [{ amount: d("1000000"), vatAmount: d("150000") }],
      allocations: [{ amount: d("950000") }],
      creditNotes: [{ lines: [{ amount: d("100000"), vatAmount: d("15000") }] }],
    }).toFixed(2)).toBe("85000.00")
  })
})
