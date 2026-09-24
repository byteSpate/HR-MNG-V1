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

import prisma from "../../config/prisma"
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
