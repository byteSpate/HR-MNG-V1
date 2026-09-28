import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/env", () => ({ env: { SALES_GO_LIVE: "2026-11-01" } }))
vi.mock("../../config/prisma", () => ({
  default: {
    opportunity: { findMany: vi.fn(), count: vi.fn() },
    invoice: { findMany: vi.fn() },
    supplierBill: { groupBy: vi.fn() },
    customerCreditNote: { findMany: vi.fn() },
    supplierCreditNote: { findMany: vi.fn() },
    journalLine: { groupBy: vi.fn() },
  },
}))

vi.mock("../posting/posting.rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../posting/posting.rules")>()),
  loadRules: vi.fn(),
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules } from "../posting/posting.rules"
import { listDealMoney } from "./dealMoney.list"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.opportunity.findMany).mockResolvedValue([])
  vi.mocked(prisma.opportunity.count).mockResolvedValue(0)
  vi.mocked(prisma.invoice.findMany).mockResolvedValue([])
  vi.mocked(prisma.supplierBill.groupBy).mockResolvedValue([])
  vi.mocked(prisma.customerCreditNote.findMany).mockResolvedValue([])
  vi.mocked(prisma.supplierCreditNote.findMany).mockResolvedValue([])
  vi.mocked(prisma.journalLine.groupBy).mockResolvedValue([])
  vi.mocked(loadRules).mockResolvedValue({ event: "FX", byKey: new Map([["LOSS", "5320"], ["GAIN", "4220"]]) })
})

describe("listDealMoney search", () => {
  it("finds a deal by an invoice number on it", async () => {
    await listDealMoney({ search: "INV-4471" })
    const where = vi.mocked(prisma.opportunity.findMany).mock.calls[0][0]!.where as any
    expect(JSON.stringify(where)).toContain("INV-4471")
  })

  it.each([
    ["the deal serial", "BS-OPP-00099"],
    ["the deal name", "Network Refresh"],
    ["the customer's legal name", "Bengal Group"],
    ["a customer PO number", "PO-778"],
    ["a supplier bill number", "BILL-9001"],
  ])("also matches %s", async (_label, term) => {
    await listDealMoney({ search: term })
    const where = vi.mocked(prisma.opportunity.findMany).mock.calls[0][0]!.where as any
    expect(JSON.stringify(where)).toContain(term)
    expect(where.OR).toBeInstanceOf(Array)
  })

  it("leaves out a deal Won before go-live", async () => {
    await listDealMoney({})
    const where = vi.mocked(prisma.opportunity.findMany).mock.calls[0][0]!.where as any
    expect(where.status).toBe("WON")
    expect(where.closedAt).toEqual({ gte: new Date("2026-11-01T00:00:00.000Z") })
  })
})

describe("listDealMoney cost", () => {
  it("leaves exchange gains and losses out of a deal's Cost (final review Fix 4)", async () => {
    const d = (v: string) => new Prisma.Decimal(v)
    vi.mocked(prisma.opportunity.findMany).mockResolvedValue([
      { id: "opp-1", serial: "BS-OPP-00001", name: "Refresh", salesAccount: { customer: null } },
    ] as any)
    vi.mocked(prisma.opportunity.count).mockResolvedValue(1)
    const journal = [
      { opportunityId: "opp-1", code: "5129", type: "EXPENSE", debit: d("800000"), credit: d("0") },
      { opportunityId: "opp-1", code: "5320", type: "EXPENSE", debit: d("12000"), credit: d("0") },
    ]
    // Stands in for the database: groups only the lines the `where` lets through.
    vi.mocked(prisma.journalLine.groupBy).mockImplementation((async (args: any) => {
      const account = args.where.account ?? {}
      const kept = journal.filter(
        (l) => (!account.type || l.type === account.type) && !(account.code?.notIn ?? []).includes(l.code)
      )
      return [{
        opportunityId: "opp-1",
        _sum: { debit: kept.reduce((s, l) => s.plus(l.debit), d("0")), credit: kept.reduce((s, l) => s.plus(l.credit), d("0")) },
      }]
    }) as any)

    const { rows } = await listDealMoney({})

    expect(rows[0].cost).toBe("800000.00")
    expect(loadRules).toHaveBeenCalledWith(expect.anything(), "FX")
  })
})
