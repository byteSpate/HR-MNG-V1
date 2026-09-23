import { describe, expect, it, vi } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { assertAllocatable, assertOpeningPayable } from "./supplierBill.allocation"

const d = (v: string) => new Prisma.Decimal(v)

function clientWith(bills: unknown[]) {
  return { supplierBill: { findMany: vi.fn().mockResolvedValue(bills) } } as any
}

function openingClientWith(openingBalance: unknown) {
  return { supplierOpeningBalance: { findUnique: vi.fn().mockResolvedValue(openingBalance) } } as any
}

const OPEN_BILL = {
  id: "b1", supplierId: "sup-1", status: "APPROVED", billNumber: "INV-1",
  lines: [{ amount: d("100000"), vatAmount: d("15000") }],
  allocations: [{ amount: d("15000") }],
  creditNotes: [],
}

describe("assertAllocatable", () => {
  it("accepts an allocation up to what the bill still owes", async () => {
    await expect(assertAllocatable(clientWith([OPEN_BILL]), "sup-1", [{ billId: "b1", amount: "100000" }])).resolves.toBeUndefined()
  })

  it("refuses more than the bill still owes", async () => {
    await expect(
      assertAllocatable(clientWith([OPEN_BILL]), "sup-1", [{ billId: "b1", amount: "100000.01" }])
    ).rejects.toThrow("Bill INV-1 only has 100000.00 left to pay")
  })

  it("refuses a bill belonging to another supplier", async () => {
    await expect(
      assertAllocatable(clientWith([{ ...OPEN_BILL, supplierId: "sup-2" }]), "sup-1", [{ billId: "b1", amount: "1" }])
    ).rejects.toThrow("Bill INV-1 belongs to a different supplier")
  })

  it("refuses a bill that is not approved yet", async () => {
    await expect(
      assertAllocatable(clientWith([{ ...OPEN_BILL, status: "DRAFT" }]), "sup-1", [{ billId: "b1", amount: "1" }])
    ).rejects.toThrow("Bill INV-1 is not approved yet")
  })

  it("refuses a bill that does not exist", async () => {
    await expect(assertAllocatable(clientWith([]), "sup-1", [{ billId: "b1", amount: "1" }])).rejects.toThrow(
      "A bill being paid does not exist"
    )
  })

  it("adds up two allocations against the same bill before comparing", async () => {
    await expect(
      assertAllocatable(clientWith([OPEN_BILL]), "sup-1", [
        { billId: "b1", amount: "60000" },
        { billId: "b1", amount: "60000" },
      ])
    ).rejects.toThrow("only has 100000.00 left to pay")
  })
})

describe("assertOpeningPayable", () => {
  it("refuses a supplier with no opening balance", async () => {
    const client = openingClientWith(null)
    await expect(assertOpeningPayable(client, "sup-1", d("100"))).rejects.toThrow("This supplier has no opening balance")
  })

  it("refuses more than is left on it, counting approved payments only", async () => {
    const client = openingClientWith({ id: "ob1", amount: d("50000"), allocations: [{ amount: d("30000") }] })
    await expect(assertOpeningPayable(client, "sup-1", d("25000"))).rejects.toThrow(
      "The opening balance only has 20000.00 left to pay"
    )
    expect(client.supplierOpeningBalance.findUnique).toHaveBeenCalledWith({
      where: { supplierId: "sup-1" },
      include: { allocations: { where: { payment: { status: "APPROVED" } }, select: { amount: true } } },
    })
  })

  it("returns the opening balance id when the amount fits", async () => {
    const client = openingClientWith({ id: "ob1", amount: d("50000"), allocations: [] })
    await expect(assertOpeningPayable(client, "sup-1", d("50000"))).resolves.toEqual({ openingBalanceId: "ob1" })
  })
})
