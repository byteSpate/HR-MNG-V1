import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    customer: { findUnique: vi.fn() },
    customerPo: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    receipt: { findMany: vi.fn() },
    opportunityLine: { findMany: vi.fn() },
    supplierBill: { findMany: vi.fn() },
    supplierPayment: { findMany: vi.fn() },
    journalLine: { aggregate: vi.fn() },
  },
}))
vi.mock("../receivables/receivables.access", () => ({ assertDealAccess: vi.fn(), isFinance: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import prisma from "../../config/prisma"
import { assertDealAccess, isFinance } from "../receivables/receivables.access"
import { getDealMoney } from "./dealMoney.service"

const d = (v: string) => new Prisma.Decimal(v)
const SALES = { sub: "u-s", role: "EMPLOYEE", salesRole: "SALES_USER", email: "s@b.co", mustChangePassword: false } as any
const FINANCE = { sub: "u-f", role: "FINANCE_OFFICER", salesRole: null, email: "f@b.co", mustChangePassword: false } as any

const INVOICE_1M_APPROVED = {
  id: "inv-1", invoiceNumber: "INV-1", status: "APPROVED",
  date: new Date("2026-11-01"), dueDate: new Date("2026-12-01"),
  createdBy: "u-f", rejectionNote: null, sentBackBy: null, sentBackAt: null,
  customerId: "c1",
  lines: [{ amount: d("1000000"), vatAmount: d("150000") }],
  allocations: [] as Array<{ amount: Prisma.Decimal }>,
  creditNotes: [] as Array<{ status: string; lines: Array<{ amount: Prisma.Decimal; vatAmount: Prisma.Decimal }> }>,
}

const CN_100K_APPROVED = {
  id: "cn-1", status: "APPROVED",
  lines: [{ amount: d("100000"), vatAmount: d("15000") }],
}

function arrangeDeal({
  invoices = [] as Array<typeof INVOICE_1M_APPROVED>,
  creditNotes = [] as Array<typeof CN_100K_APPROVED>,
  costLines = { debit: d("0"), credit: d("0") },
}) {
  vi.mocked(assertDealAccess).mockResolvedValue({
    id: "opp-1", serial: "BS-OPP-00001", name: "ACME network refresh", status: "WON",
    salesAccountId: "sa-1", closedAt: new Date("2026-10-15"),
  } as any)
  vi.mocked(isFinance).mockImplementation((actor: any) => actor.role === "FINANCE_OFFICER" || actor.role === "SUPER_ADMIN")

  vi.mocked(prisma.customer.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.customerPo.findMany).mockResolvedValue([])
  vi.mocked(prisma.invoice.findMany).mockResolvedValue(
    invoices.map((inv) => ({ ...inv, creditNotes })) as any
  )
  vi.mocked(prisma.receipt.findMany).mockResolvedValue([])
  vi.mocked(prisma.opportunityLine.findMany).mockResolvedValue([])
  vi.mocked(prisma.supplierBill.findMany).mockResolvedValue([])
  vi.mocked(prisma.supplierPayment.findMany).mockResolvedValue([])
  vi.mocked(prisma.journalLine.aggregate).mockResolvedValue({ _sum: costLines } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getDealMoney", () => {
  it("refuses a sales user who cannot see the deal, before reading any money (Review Focus 5)", async () => {
    vi.mocked(assertDealAccess).mockRejectedValue(new AppError(403, "You do not have access to this deal"))

    await expect(getDealMoney("opp-1", SALES)).rejects.toThrow("You do not have access to this deal")
    expect(prisma.invoice.findMany).not.toHaveBeenCalled()
    expect(prisma.journalLine.aggregate).not.toHaveBeenCalled()
  })

  it("gives a sales user no cost, profit, bills or payments", async () => {
    arrangeDeal({ invoices: [INVOICE_1M_APPROVED], costLines: { debit: d("800000"), credit: d("0") } })

    const m = await getDealMoney("opp-1", SALES)

    expect(m.numbers).toEqual({ sold: "1000000.00", stillOwed: "1150000.00", cost: null, profit: null })
    expect(m.bills).toBeNull()
    expect(m.supplierPayments).toBeNull()
    expect(prisma.supplierBill.findMany).not.toHaveBeenCalled()
    expect(prisma.journalLine.aggregate).not.toHaveBeenCalled()
  })

  it("works out Sold, Cost, Profit and Still owed for Finance", async () => {
    arrangeDeal({
      invoices: [INVOICE_1M_APPROVED],
      creditNotes: [CN_100K_APPROVED],
      costLines: { debit: d("800000"), credit: d("0") },
    })

    const m = await getDealMoney("opp-1", FINANCE)

    expect(m.numbers).toEqual({ sold: "900000.00", stillOwed: "1035000.00", cost: "800000.00", profit: "100000.00" })
  })

  it("ignores drafts in every number", async () => {
    arrangeDeal({ invoices: [{ ...INVOICE_1M_APPROVED, status: "DRAFT" }] })

    const m = await getDealMoney("opp-1", FINANCE)

    expect(m.numbers.sold).toBe("0.00")
  })
})
