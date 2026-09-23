import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    invoice: { findMany: vi.fn() },
    customerOpeningBalance: { findMany: vi.fn() },
    account: { findUniqueOrThrow: vi.fn() },
    journalLine: { aggregate: vi.fn() },
  },
}))
vi.mock("../posting/posting.rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../posting/posting.rules")>()),
  loadRules: vi.fn(),
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules } from "../posting/posting.rules"
import { getCustomerAgeing, getCustomerControlTieOut } from "./receivables.reports"

const d = (v: string) => new Prisma.Decimal(v)

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: "inv1", invoiceNumber: "INV-1", customerId: "c1", dueDate: new Date("2026-10-20"),
    customer: { legalName: "Bengal Group" }, po: { opportunity: { serial: "BS-OPP-00002" } },
    lines: [{ amount: d("800000"), vatAmount: d("120000") }],
    allocations: [], creditNotes: [],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.customerOpeningBalance.findMany).mockResolvedValue([])
})

describe("getCustomerAgeing", () => {
  it("ages an invoice from its due date and skips a fully collected one", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoice(),
      invoice({ id: "inv2", lines: [{ amount: d("100"), vatAmount: d("0") }], allocations: [{ amount: d("100") }] }),
    ] as any)

    const rows = await getCustomerAgeing(new Date("2026-11-15"))

    expect(rows).toEqual([{
      invoiceId: "inv1", openingBalanceId: null, label: "Invoice INV-1",
      customerId: "c1", customerName: "Bengal Group", dealSerial: "BS-OPP-00002",
      dueDate: new Date("2026-10-20"), outstanding: "920000.00", bucket: "1-30",
    }])
  })

  it("includes what is still owed from before go-live", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([])
    vi.mocked(prisma.customerOpeningBalance.findMany).mockResolvedValue([
      { id: "ob1", customerId: "c1", amount: d("200000"), asOf: new Date("2026-07-01"),
        customer: { legalName: "Bengal Group" }, allocations: [{ amount: d("50000") }] },
    ] as any)

    const rows = await getCustomerAgeing(new Date("2026-09-23"))

    expect(rows).toEqual([expect.objectContaining({
      invoiceId: null, openingBalanceId: "ob1", label: "Opening balance", dealSerial: null,
      outstanding: "150000.00", bucket: "61-90",
    })])
  })
})

describe("getCustomerControlTieOut", () => {
  it("ties the subledger to 1220 as debit minus credit, and reports 2160 separately", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoice({ lines: [{ amount: d("300000"), vatAmount: d("50000") }] }),
    ] as any)
    vi.mocked(loadRules).mockResolvedValue({ event: "RECEIPT", byKey: new Map([["RECEIVABLE", "1220"], ["ADVANCE", "2160"]]) })
    vi.mocked(prisma.account.findUniqueOrThrow)
      .mockResolvedValueOnce({ id: "acc-1220" } as any)
      .mockResolvedValueOnce({ id: "acc-2160" } as any)
    vi.mocked(prisma.journalLine.aggregate)
      .mockResolvedValueOnce({ _sum: { debit: d("350000"), credit: d("0") } } as any)
      .mockResolvedValueOnce({ _sum: { debit: d("0"), credit: d("300000") } } as any)

    await expect(getCustomerControlTieOut()).resolves.toEqual({
      subledgerTotal: "350000.00", glBalance: "350000.00", ties: true, advancesHeld: "300000.00",
    })
  })
})
