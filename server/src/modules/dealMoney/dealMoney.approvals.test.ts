import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    invoice: { findMany: vi.fn(), count: vi.fn() },
    supplierBill: { findMany: vi.fn(), count: vi.fn() },
    customerCreditNote: { findMany: vi.fn(), count: vi.fn() },
    supplierCreditNote: { findMany: vi.fn(), count: vi.fn() },
    user: { findMany: vi.fn() },
  },
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { countWaitingForApproval, listWaitingForApproval } from "./dealMoney.approvals"

const d = (v: string) => new Prisma.Decimal(v)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.invoice.findMany).mockResolvedValue([])
  vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([])
  vi.mocked(prisma.customerCreditNote.findMany).mockResolvedValue([])
  vi.mocked(prisma.supplierCreditNote.findMany).mockResolvedValue([])
  vi.mocked(prisma.user.findMany).mockResolvedValue([])
  vi.mocked(prisma.invoice.count).mockResolvedValue(0)
  vi.mocked(prisma.supplierBill.count).mockResolvedValue(0)
  vi.mocked(prisma.customerCreditNote.count).mockResolvedValue(0)
  vi.mocked(prisma.supplierCreditNote.count).mockResolvedValue(0)
})

describe("listWaitingForApproval", () => {
  it("reads only drafts with no rejection note, for all four kinds", async () => {
    await listWaitingForApproval()

    for (const model of [prisma.invoice, prisma.supplierBill, prisma.customerCreditNote, prisma.supplierCreditNote]) {
      expect(vi.mocked(model.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: "DRAFT", rejectionNote: null }) })
      )
    }
  })

  it("lists all four kinds, oldest first, and does not list a sent-back draft", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        id: "inv-1", invoiceNumber: "INV-1", createdBy: "u1", createdAt: new Date("2026-11-03"),
        customer: { legalName: "Bengal Group" },
        lines: [{ amount: d("1000000"), vatAmount: d("150000") }],
        po: { opportunity: { id: "opp-1", serial: "BS-OPP-00001" } },
      },
    ] as any)
    vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([
      {
        id: "b1", billNumber: "BILL-1", createdBy: "u2", createdAt: new Date("2026-11-01"),
        supplier: { name: "Star Tech" },
        lines: [{ amount: d("500000"), vatAmount: d("75000") }],
        opportunity: { id: "opp-1", serial: "BS-OPP-00001" },
      },
    ] as any)
    vi.mocked(prisma.customerCreditNote.findMany).mockResolvedValue([
      {
        id: "cn1", createdBy: "u1", createdAt: new Date("2026-11-04"),
        customer: { legalName: "Bengal Group" },
        lines: [{ amount: d("100000"), vatAmount: d("15000") }],
        invoice: { invoiceNumber: "INV-1", po: { opportunity: { id: "opp-1", serial: "BS-OPP-00001" } } },
      },
    ] as any)
    vi.mocked(prisma.supplierCreditNote.findMany).mockResolvedValue([
      {
        id: "scn1", createdBy: "u2", createdAt: new Date("2026-11-02"),
        supplier: { name: "Star Tech" },
        lines: [{ amount: d("50000"), vatAmount: d("7500") }],
        bill: { billNumber: "BILL-1", opportunity: { id: "opp-1", serial: "BS-OPP-00001" } },
      },
    ] as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", displayName: null, email: "f@b.co", employee: { fullName: "Farah Islam" } },
      { id: "u2", displayName: "Admin One", email: "a@b.co", employee: null },
    ] as any)

    const rows = await listWaitingForApproval()

    expect(rows.map((r) => r.kind)).toEqual(["SUPPLIER_BILL", "SUPPLIER_CREDIT_NOTE", "INVOICE", "CUSTOMER_CREDIT_NOTE"])
    expect(rows.every((r) => r.dealSerial === "BS-OPP-00001")).toBe(true)
    expect(rows[0]).toMatchObject({ number: "BILL-1", party: "Star Tech", amount: "575000.00", preparedBy: "Admin One" })
    expect(rows[2]).toMatchObject({ number: "INV-1", party: "Bengal Group", amount: "1150000.00", preparedBy: "Farah Islam" })
    expect(rows[3].number).toContain("INV-1")
  })
})

describe("countWaitingForApproval", () => {
  it("counts only DRAFT, not-sent-back rows, summed across all four kinds, without loading rows", async () => {
    vi.mocked(prisma.invoice.count).mockResolvedValue(2)
    vi.mocked(prisma.supplierBill.count).mockResolvedValue(1)
    vi.mocked(prisma.customerCreditNote.count).mockResolvedValue(3)
    vi.mocked(prisma.supplierCreditNote.count).mockResolvedValue(0)

    const count = await countWaitingForApproval()

    expect(count).toBe(6)
    expect(prisma.invoice.findMany).not.toHaveBeenCalled()
    for (const model of [prisma.invoice, prisma.supplierBill, prisma.customerCreditNote, prisma.supplierCreditNote]) {
      expect(vi.mocked(model.count)).toHaveBeenCalledWith({ where: { status: "DRAFT", rejectionNote: null } })
    }
  })
})
