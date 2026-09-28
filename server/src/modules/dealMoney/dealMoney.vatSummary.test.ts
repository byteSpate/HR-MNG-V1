import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
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
import { getVatSummary } from "./dealMoney.vatSummary"

const d = (v: string) => new Prisma.Decimal(v)

const INVOICE_RULES = { event: "INVOICE" as const, byKey: new Map([["VAT", "2150"]]) }
const SUPPLIER_BILL_RULES = { event: "SUPPLIER_BILL" as const, byKey: new Map([["VAT", "1233"]]) }
const RECEIPT_RULES = { event: "RECEIPT" as const, byKey: new Map([["VDS", "1234"]]) }

const ACCOUNT_ID: Record<string, string> = { "2150": "acc-2150", "1233": "acc-1233", "1234": "acc-1234" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadRules).mockImplementation(async (_tx, event) => {
    if (event === "INVOICE") return INVOICE_RULES as any
    if (event === "SUPPLIER_BILL") return SUPPLIER_BILL_RULES as any
    return RECEIPT_RULES as any
  })
  vi.mocked(prisma.account.findUniqueOrThrow).mockImplementation(
    (async ({ where }: any) => ({ id: ACCOUNT_ID[where.code] })) as any
  )
})

describe("getVatSummary", () => {
  it("works out VAT on invoices, on bills, the difference, and what customers withheld", async () => {
    vi.mocked(prisma.journalLine.aggregate).mockImplementation((async ({ where }: any) => {
      const accountId = where.accountId
      if (accountId === "acc-2150") return { _sum: { debit: d("0"), credit: d("150000") } }
      if (accountId === "acc-1233") return { _sum: { debit: d("120000"), credit: d("0") } }
      if (accountId === "acc-1234") return { _sum: { debit: d("30000"), credit: d("0") } }
      return { _sum: { debit: d("0"), credit: d("0") } }
    }) as any)

    const summary = await getVatSummary("2026-11-01", "2026-11-30")

    expect(summary).toEqual({ onInvoices: "150000.00", onBills: "120000.00", difference: "30000.00", withheldByCustomers: "30000.00" })
  })

  it("counts a journal dated on the end day itself", async () => {
    vi.mocked(prisma.journalLine.aggregate).mockResolvedValue({ _sum: { debit: d("0"), credit: d("0") } } as any)

    await getVatSummary("2026-11-01", "2026-11-30")

    const call = vi.mocked(prisma.journalLine.aggregate).mock.calls[0][0] as any
    expect(call.where.journal.date).toEqual({ gte: new Date("2026-11-01T00:00:00.000Z"), lt: new Date("2026-12-01T00:00:00.000Z") })
  })

  it("only counts CUSTOMER and SUPPLIER sourced journals, not a hand-typed VAT settlement, and also their reversal journals", async () => {
    vi.mocked(prisma.journalLine.aggregate).mockResolvedValue({ _sum: { debit: d("0"), credit: d("0") } } as any)

    await getVatSummary("2026-11-01", "2026-11-30")

    const call = vi.mocked(prisma.journalLine.aggregate).mock.calls[0][0] as any
    // A reversal journal (postReversalNow) carries no sourceModule of its
    // own, so it is picked up through the journal it reverses instead —
    // otherwise the offsetting entry drops out and a reversed amount never
    // nets to zero (Critical 2).
    expect(call.where.journal.OR).toEqual([
      { sourceModule: { in: ["CUSTOMER", "SUPPLIER"] } },
      { reverses: { sourceModule: { in: ["CUSTOMER", "SUPPLIER"] } } },
    ])
  })

  it("nets a reversed receipt's withheld VAT to zero (Critical 2)", async () => {
    // A receipt withheld 30,000 in VDS (account 1234, a debit) and was
    // later reversed. The reversal journal has no sourceModule of its own,
    // but the widened filter reaches it through `reverses`, so a real
    // query's aggregate sums the original debit and the reversal's
    // offsetting credit together.
    vi.mocked(prisma.journalLine.aggregate).mockImplementation((async ({ where }: any) => {
      const accountId = where.accountId
      if (accountId === "acc-1234") return { _sum: { debit: d("30000"), credit: d("30000") } }
      return { _sum: { debit: d("0"), credit: d("0") } }
    }) as any)

    const summary = await getVatSummary("2026-11-01", "2026-11-30")

    expect(summary.withheldByCustomers).toBe("0.00")
  })
})
