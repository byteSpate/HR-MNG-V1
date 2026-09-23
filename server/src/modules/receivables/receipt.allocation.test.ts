import { describe, expect, it, vi } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { assertOpeningReceivable, assertReceivable } from "./receipt.allocation"

const d = (v: string) => new Prisma.Decimal(v)

function invClient(invoices: unknown[]) {
  return { invoice: { findMany: vi.fn().mockResolvedValue(invoices) } } as any
}
function obClient(ob: unknown) {
  return { customerOpeningBalance: { findUnique: vi.fn().mockResolvedValue(ob) } } as any
}

const INV = (over: Record<string, unknown> = {}) => ({
  id: "inv1", invoiceNumber: "INV-1", customerId: "c1", status: "APPROVED",
  lines: [{ amount: d("1000000"), vatAmount: d("150000") }], allocations: [], creditNotes: [],
  ...over,
})

describe("assertReceivable", () => {
  it("refuses an invoice that does not exist", async () => {
    await expect(assertReceivable(invClient([]), "c1", [{ invoiceId: "nope", amount: d("1") }]))
      .rejects.toThrow("An invoice being collected does not exist")
  })

  it("refuses another customer's invoice", async () => {
    await expect(assertReceivable(invClient([INV({ customerId: "c2" })]), "c1", [{ invoiceId: "inv1", amount: d("1") }]))
      .rejects.toThrow("Invoice INV-1 belongs to a different customer")
  })

  it("refuses a draft invoice", async () => {
    await expect(assertReceivable(invClient([INV({ status: "DRAFT" })]), "c1", [{ invoiceId: "inv1", amount: d("1") }]))
      .rejects.toThrow("Invoice INV-1 is not approved yet")
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

describe("assertOpeningReceivable", () => {
  it("refuses the opening balance of a customer who has none", async () => {
    await expect(assertOpeningReceivable(obClient(null), "c1", d("1"))).rejects.toThrow("This customer has no opening balance")
  })

  it("refuses more than is left on the opening balance", async () => {
    const client = obClient({ id: "ob1", amount: d("200000"), allocations: [{ amount: d("150000") }] })
    await expect(assertOpeningReceivable(client, "c1", d("60000"))).rejects.toThrow("The opening balance only has 50000.00 left to collect")
  })

  it("returns the opening balance id when the amount fits", async () => {
    const client = obClient({ id: "ob1", amount: d("200000"), allocations: [] })
    await expect(assertOpeningReceivable(client, "c1", d("200000"))).resolves.toEqual({ openingBalanceId: "ob1" })
  })
})
