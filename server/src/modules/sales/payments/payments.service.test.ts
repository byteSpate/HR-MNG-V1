import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: { invoice: { findMany: vi.fn() } },
}))

import prisma from "../../../config/prisma"
import { Prisma } from "../../../generated/prisma/client"
import { buildPaymentsExportSpec } from "./payments.export"
import { listPayments, paymentRows } from "./payments.service"
import { listPaymentsQuerySchema } from "./payments.validators"

const d = (v: string) => new Prisma.Decimal(v)
const TODAY = new Date("2026-10-18T00:00:00.000Z")
const ACC = "11111111-1111-4111-8111-111111111111"
const OPP = "22222222-2222-4222-8222-222222222222"

const invoice = (o: Record<string, unknown> = {}) => ({
  id: "inv-1", invoiceNumber: "INV-101",
  date: new Date("2026-09-01T00:00:00.000Z"), dueDate: new Date("2026-10-30T00:00:00.000Z"),
  po: { opportunity: { id: "opp-1", serial: "BS-OPP-00001", name: "Core refresh", salesAccount: { id: "acc-1", name: "Alpha Ltd" } } },
  // 9,000 + 1,000 VAT = 10,000
  lines: [{ amount: d("9000"), vatAmount: d("1000") }],
  allocations: [{ amount: d("4000"), receipt: { id: "r-1", number: "MR-0001", date: new Date("2026-09-10T00:00:00.000Z"), paymentMethod: "BANK_TRANSFER" } }],
  creditNotes: [],
  ...o,
})
const where = () => (vi.mocked(prisma.invoice.findMany).mock.calls[0][0] as any).where

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.invoice.findMany).mockResolvedValue([invoice()] as any)
})

describe("payments (owner, 2026-10-18)", () => {
  it("part paid: total 10,000 and received 4,000 is 40%, balance 6,000, Part paid", async () => {
    const [row] = await paymentRows({}, TODAY)
    expect(row).toMatchObject({
      invoiceId: "inv-1", invoiceNumber: "INV-101", date: "2026-09-01", dueDate: "2026-10-30",
      opportunityId: "opp-1", opportunityName: "Core refresh", accountId: "acc-1", accountName: "Alpha Ltd",
      invoiceTotal: "10000.00", received: "4000.00", balance: "6000.00", percentPaid: 40, status: "PART_PAID",
    })
    expect(row.receipts).toEqual([{ number: "MR-0001", date: "2026-09-10", method: "BANK_TRANSFER", amount: "4000.00" }])
  })

  it("rounds the percent to one decimal", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([invoice({
      lines: [{ amount: d("3000"), vatAmount: d("0") }],
      allocations: [{ amount: d("1000"), receipt: { id: "r", number: "MR-2", date: TODAY, paymentMethod: "CASH" } }],
    })] as any)
    expect((await paymentRows({}, TODAY))[0].percentPaid).toBe(33.3)
  })

  it("an invoice cancelled by credit notes has total 0, no percent, and is Paid", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([invoice({
      allocations: [], creditNotes: [{ lines: [{ amount: d("9000"), vatAmount: d("1000") }] }],
    })] as any)
    expect((await paymentRows({}, TODAY))[0]).toMatchObject({ invoiceTotal: "0.00", percentPaid: null, balance: "0.00", status: "PAID" })
  })

  it("is Overdue only after the due date, by the office date", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoice({ id: "due-today", dueDate: TODAY }),
      invoice({ id: "due-yesterday", dueDate: new Date("2026-10-17T00:00:00.000Z") }),
      invoice({ id: "unpaid", allocations: [] }),
    ] as any)
    const rows = await paymentRows({}, TODAY)
    expect(rows.find((r) => r.invoiceId === "due-today")!.status).toBe("PART_PAID")
    expect(rows.find((r) => r.invoiceId === "due-yesterday")!.status).toBe("OVERDUE")
    expect(rows.find((r) => r.invoiceId === "unpaid")!.status).toBe("UNPAID")
  })

  it("counts approved invoices, approved receipts and approved credit notes only", async () => {
    await paymentRows({}, TODAY)
    const args = vi.mocked(prisma.invoice.findMany).mock.calls[0][0] as any
    expect(args.where).toMatchObject({ status: "APPROVED" })
    expect(args.include.allocations.where).toEqual({ receipt: { status: "APPROVED" } })
    expect(args.include.creditNotes.where).toEqual({ status: "APPROVED" })
  })

  it("filters by account or by Opportunity", async () => {
    await listPayments({ accountId: ACC }, TODAY)
    expect(where()).toEqual({ status: "APPROVED", po: { opportunity: { salesAccountId: ACC } } })
    vi.clearAllMocks()
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as any)
    await listPayments({ opportunityId: OPP }, TODAY)
    expect(where()).toEqual({ status: "APPROVED", po: { opportunityId: OPP } })
  })

  it("open drops paid invoices, and the totals add the rows", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoice({ id: "a" }),
      invoice({ id: "paid", allocations: [{ amount: d("10000"), receipt: { id: "r", number: "MR-9", date: TODAY, paymentMethod: "CASH" } }] }),
    ] as any)
    const all = await listPayments({}, TODAY)
    expect(all.totals).toEqual({ invoiceTotal: "20000.00", received: "14000.00", balance: "6000.00" })
    const open = await listPayments({ open: true }, TODAY)
    expect(open.rows.map((r) => r.invoiceId)).toEqual(["a"])
    expect(open.totals).toEqual({ invoiceTotal: "10000.00", received: "4000.00", balance: "6000.00" })
  })

  it("sorts by due date, oldest first", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as any)
    await listPayments({}, TODAY)
    expect((vi.mocked(prisma.invoice.findMany).mock.calls[0][0] as any).orderBy).toEqual([{ dueDate: "asc" }, { id: "asc" }])
  })

  it("reads the query: open as true or false, and ids as uuids only", () => {
    expect(listPaymentsQuerySchema.parse({ open: "true", accountId: ACC })).toEqual({ open: true, accountId: ACC })
    expect(listPaymentsQuerySchema.parse({ open: "false" })).toEqual({ open: false })
    expect(listPaymentsQuerySchema.safeParse({ accountId: "nope" }).success).toBe(false)
  })

  it("downloads the same rows as a file called Payments", async () => {
    const spec = await buildPaymentsExportSpec({}, TODAY)
    expect(spec.title).toBe("Payments")
    expect(spec.rows[0]).toEqual(["INV-101", new Date("2026-09-01T00:00:00.000Z"), new Date("2026-10-30T00:00:00.000Z"),
      "Alpha Ltd", "Core refresh", 10000, 4000, 40, 6000, "Part paid"])
  })
})
