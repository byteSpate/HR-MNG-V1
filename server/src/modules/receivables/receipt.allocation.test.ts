import { describe, expect, it, vi } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { assertReceivable } from "./receipt.allocation"

const d = (v: string) => new Prisma.Decimal(v)

function invClient(invoices: unknown[]) {
  return { invoice: { findMany: vi.fn().mockResolvedValue(invoices) } } as any
}

const INV = (over: Record<string, unknown> = {}) => ({
  id: "inv1", invoiceNumber: "INV-1", customerId: "c1", status: "APPROVED",
  lines: [{ amount: d("1000000"), vatAmount: d("150000") }], allocations: [], creditNotes: [],
  ...over,
})

describe("assertReceivable", () => {
  it("refuses an invoice that does not exist", async () => {
    await expect(assertReceivable(invClient([]), "c1", [{ invoiceId: "nope", amount: d("1") }]))
      .rejects.toThrow("One of the invoices you picked does not exist.")
  })

  it("refuses another customer's invoice", async () => {
    await expect(assertReceivable(invClient([INV({ customerId: "c2" })]), "c1", [{ invoiceId: "inv1", amount: d("1") }]))
      .rejects.toThrow("Invoice INV-1 belongs to a different customer")
  })

  it("refuses a draft invoice", async () => {
    await expect(assertReceivable(invClient([INV({ status: "DRAFT" })]), "c1", [{ invoiceId: "inv1", amount: d("1") }]))
      .rejects.toThrow("Invoice INV-1 is not approved yet. Approve it before recording a payment against it.")
  })

  it("refuses more than is left, adding duplicate lines together", async () => {
    const client = invClient([INV({ allocations: [{ amount: d("1000000") }] })])
    await expect(assertReceivable(client, "c1", [
      { invoiceId: "inv1", amount: d("100000") }, { invoiceId: "inv1", amount: d("60000") },
    ])).rejects.toThrow("Invoice INV-1 only has 150000.00 left to collect")
  })

  it("accepts an allocation up to what the invoice still owes", async () => {
    await expect(assertReceivable(invClient([INV()]), "c1", [{ invoiceId: "inv1", amount: d("1150000") }]))
      .resolves.toBeUndefined()
  })
})
