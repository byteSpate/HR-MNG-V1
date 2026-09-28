import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    invoice: { findMany: vi.fn() },
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
    customer: { legalName: "Bengal Group" }, po: { opportunity: { id: "deal-1", serial: "BS-OPP-00002" } },
    lines: [{ amount: d("800000"), vatAmount: d("120000") }],
    allocations: [], creditNotes: [],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getCustomerAgeing", () => {
  it("ages an invoice from its due date and skips a fully collected one", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoice(),
      invoice({ id: "inv2", lines: [{ amount: d("100"), vatAmount: d("0") }], allocations: [{ amount: d("100") }] }),
    ] as any)

    const rows = await getCustomerAgeing(new Date("2026-11-15"))

    expect(rows).toEqual([{
      invoiceId: "inv1", label: "Invoice INV-1",
      customerId: "c1", customerName: "Bengal Group", dealId: "deal-1", dealSerial: "BS-OPP-00002",
      dueDate: new Date("2026-10-20"), outstanding: "920000.00", bucket: "1-30",
    }])
  })
})

describe("getCustomerControlTieOut", () => {
  it("ties the subledger to 1220 as debit minus credit", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoice({ lines: [{ amount: d("300000"), vatAmount: d("50000") }] }),
    ] as any)
    vi.mocked(loadRules).mockResolvedValue({ event: "RECEIPT", byKey: new Map([["RECEIVABLE", "1220"]]) })
    vi.mocked(prisma.account.findUniqueOrThrow).mockResolvedValueOnce({ id: "acc-1220" } as any)
    vi.mocked(prisma.journalLine.aggregate).mockResolvedValueOnce({ _sum: { debit: d("350000"), credit: d("0") } } as any)

    await expect(getCustomerControlTieOut()).resolves.toEqual({
      subledgerTotal: "350000.00", glBalance: "350000.00", ties: true,
    })
  })
})
