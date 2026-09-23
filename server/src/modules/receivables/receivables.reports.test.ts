import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { getCustomerOpeningOutstanding, getInvoiceOutstanding } from "./receivables.reports"

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

describe("getCustomerOpeningOutstanding", () => {
  it("is the opening balance less approved receipts against it", () => {
    expect(getCustomerOpeningOutstanding({ amount: d("200000"), allocations: [{ amount: d("50000") }] }).toFixed(2)).toBe("150000.00")
  })
})
