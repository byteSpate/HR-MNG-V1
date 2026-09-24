import { beforeEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "../../generated/prisma/client"

vi.mock("../../config/prisma", () => ({
  default: {
    supplierBill: { findMany: vi.fn() },
    account: { findUniqueOrThrow: vi.fn() },
    journalLine: { aggregate: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { getSupplierAgeing, getSupplierControlTieOut } from "./supplierBill.reports"

const d = (v: string) => new Prisma.Decimal(v)

function bill(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1", supplierId: "sup-1", supplier: { name: "Star Tech" }, dueDate: new Date("2026-10-20"),
    billNumber: "INV-1",
    lines: [{ amount: d("800000"), vatAmount: d("120000") }],
    allocations: [], creditNotes: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getSupplierAgeing", () => {
  it("buckets an overdue bill by days past due", async () => {
    vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([bill()] as any)

    const rows = await getSupplierAgeing(new Date("2026-11-15"))

    expect(rows).toEqual([
      expect.objectContaining({ supplierId: "sup-1", supplierName: "Star Tech", outstanding: "920000.00", bucket: "1-30" }),
    ])
  })

  it("puts a bill not yet due in Not due, and a very old one in Over 90", async () => {
    vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([
      bill({ id: "fresh", dueDate: new Date("2026-12-01") }),
      bill({ id: "old", dueDate: new Date("2026-06-01") }),
    ] as any)

    const rows = await getSupplierAgeing(new Date("2026-11-15"))

    expect(rows.find((r) => r.billId === "fresh")?.bucket).toBe("Not due")
    expect(rows.find((r) => r.billId === "old")?.bucket).toBe("Over 90")
  })

  it("excludes a bill with nothing outstanding", async () => {
    vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([
      bill({ lines: [{ amount: d("100000"), vatAmount: d("0") }], allocations: [{ amount: d("100000") }] }),
    ] as any)

    expect(await getSupplierAgeing(new Date("2026-11-15"))).toEqual([])
  })

  it("only counts allocations on approved payments and approved credit notes", async () => {
    vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([bill()] as any)

    await getSupplierAgeing(new Date("2026-11-15"))

    expect(prisma.supplierBill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "APPROVED" },
        select: expect.objectContaining({
          allocations: expect.objectContaining({ where: { payment: { status: "APPROVED" } } }),
          creditNotes: expect.objectContaining({ where: { status: "APPROVED" } }),
        }),
      })
    )
  })

  it("labels a bill row with its own bill number", async () => {
    vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([bill()] as any)

    const rows = await getSupplierAgeing(new Date("2026-11-15"))

    expect(rows).toEqual([expect.objectContaining({ billId: "b1", label: "Bill INV-1" })])
  })
})

describe("getSupplierControlTieOut", () => {
  it("flags a mismatch between the subledger and account 2111", async () => {
    vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([
      bill({ lines: [{ amount: d("800000"), vatAmount: d("0") }] }),
    ] as any)
    vi.mocked(prisma.account.findUniqueOrThrow).mockResolvedValue({ id: "acc-2111" } as any)
    vi.mocked(prisma.journalLine.aggregate).mockResolvedValue({ _sum: { debit: d("0"), credit: d("900000") } } as any)

    expect(await getSupplierControlTieOut()).toEqual({ subledgerTotal: "800000.00", glBalance: "900000.00", ties: false })
  })

  it("ties when both sides agree", async () => {
    vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([bill()] as any)
    vi.mocked(prisma.account.findUniqueOrThrow).mockResolvedValue({ id: "acc-2111" } as any)
    vi.mocked(prisma.journalLine.aggregate).mockResolvedValue({ _sum: { debit: d("0"), credit: d("920000") } } as any)

    expect(await getSupplierControlTieOut()).toEqual({ subledgerTotal: "920000.00", glBalance: "920000.00", ties: true })
  })
})
