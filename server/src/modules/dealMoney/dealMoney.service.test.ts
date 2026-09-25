import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/env", () => ({ env: { SALES_GO_LIVE: "2026-11-01" } }))
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
vi.mock("../posting/posting.rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../posting/posting.rules")>()),
  loadRules: vi.fn(),
}))

import { Prisma } from "../../generated/prisma/client"
import { AppError } from "../../middleware/errorHandler"
import prisma from "../../config/prisma"
import { assertDealAccess, isFinance } from "../receivables/receivables.access"
import { loadRules } from "../posting/posting.rules"
import { getDealMoney } from "./dealMoney.service"
import type { DealMoney, DealMoneyRecorded } from "./dealMoney.types"

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

// The FX rules as seeded (posting.rules.seed.ts): a US-dollar supplier
// payment posts its exchange difference to one of these, tagged to the deal.
const FX_RULES = { event: "FX" as const, byKey: new Map([["LOSS", "5320"], ["GAIN", "4220"]]) }

interface FakeJournalLine { code: string; type: "EXPENSE" | "INCOME"; debit: Prisma.Decimal; credit: Prisma.Decimal }

/** Stands in for the database: sums only the lines the query's `where`
 *  lets through, so a test can check what Cost really counts. */
function fakeAggregate(lines: FakeJournalLine[]) {
  return async (args: any) => {
    const account = args.where.account ?? {}
    const kept = lines.filter(
      (l) => (!account.type || l.type === account.type) && !(account.code?.notIn ?? []).includes(l.code)
    )
    return {
      _sum: {
        debit: kept.reduce((s, l) => s.plus(l.debit), d("0")),
        credit: kept.reduce((s, l) => s.plus(l.credit), d("0")),
      },
    }
  }
}

function arrangeDeal({
  invoices = [] as Array<typeof INVOICE_1M_APPROVED>,
  creditNotes = [] as Array<typeof CN_100K_APPROVED>,
  costLines = { debit: d("0"), credit: d("0") },
  journalLines = null as FakeJournalLine[] | null,
  closedAt = new Date("2026-11-15"),
}) {
  vi.mocked(assertDealAccess).mockResolvedValue({
    id: "opp-1", serial: "BS-OPP-00001", name: "ACME network refresh", status: "WON",
    salesAccountId: "sa-1", closedAt,
  } as any)
  vi.mocked(loadRules).mockResolvedValue(FX_RULES)
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
  if (journalLines) vi.mocked(prisma.journalLine.aggregate).mockImplementation(fakeAggregate(journalLines) as any)
  else vi.mocked(prisma.journalLine.aggregate).mockResolvedValue({ _sum: costLines } as any)
}

function recorded(m: DealMoney): DealMoneyRecorded {
  if (!m.moneyAllowed) throw new Error("expected a deal whose money is recorded here")
  return m
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

    const m = recorded(await getDealMoney("opp-1", SALES))

    expect(m.numbers).toEqual({ sold: "1000000.00", stillOwed: "1150000.00", cost: null, profit: null })
    expect(m.bills).toBeNull()
    expect(m.supplierPayments).toBeNull()
    expect(prisma.supplierBill.findMany).not.toHaveBeenCalled()
    expect(prisma.supplierPayment.findMany).not.toHaveBeenCalled()
    expect(prisma.journalLine.aggregate).not.toHaveBeenCalled()
  })

  it("works out Sold, Cost, Profit and Still owed for Finance", async () => {
    arrangeDeal({
      invoices: [INVOICE_1M_APPROVED],
      creditNotes: [CN_100K_APPROVED],
      costLines: { debit: d("800000"), credit: d("0") },
    })

    const m = recorded(await getDealMoney("opp-1", FINANCE))

    expect(m.numbers).toEqual({ sold: "900000.00", stillOwed: "1035000.00", cost: "800000.00", profit: "100000.00" })
  })

  it("ignores drafts in every number", async () => {
    arrangeDeal({ invoices: [{ ...INVOICE_1M_APPROVED, status: "DRAFT" }] })

    const m = recorded(await getDealMoney("opp-1", FINANCE))

    expect(m.numbers.sold).toBe("0.00")
  })

  it("counts a bill's cost but not an exchange loss on paying for it (final review Fix 4)", async () => {
    arrangeDeal({
      invoices: [INVOICE_1M_APPROVED],
      journalLines: [
        // The supplier bill's service line, 5129.
        { code: "5129", type: "EXPENSE", debit: d("800000"), credit: d("0") },
        // A US-dollar payment for it, paid at a worse rate than the bill's.
        { code: "5320", type: "EXPENSE", debit: d("12000"), credit: d("0") },
      ],
    })

    const m = recorded(await getDealMoney("opp-1", FINANCE))

    expect(m.numbers.cost).toBe("800000.00")
    expect(m.numbers.profit).toBe("200000.00")
    expect(loadRules).toHaveBeenCalledWith(expect.anything(), "FX")
  })

  it("does not read or show any money for a deal won before go-live (final review Fix 3)", async () => {
    arrangeDeal({ closedAt: new Date("2026-10-15") })

    const m = await getDealMoney("opp-1", FINANCE)

    expect(m).toEqual({
      moneyAllowed: false,
      notRecordedReason: "WON_BEFORE_GO_LIVE",
      goLiveDate: "2026-11-01",
      deal: { id: "opp-1", serial: "BS-OPP-00001", name: "ACME network refresh" },
    })
    // No numbers at all, not zeros, and no money query ran.
    expect(m).not.toHaveProperty("numbers")
    expect(prisma.invoice.findMany).not.toHaveBeenCalled()
    expect(prisma.customerPo.findMany).not.toHaveBeenCalled()
    expect(prisma.journalLine.aggregate).not.toHaveBeenCalled()
  })

  it("says money is recorded for a deal won on or after go-live", async () => {
    arrangeDeal({ closedAt: new Date("2026-11-01T00:00:00Z") })

    const m = await getDealMoney("opp-1", FINANCE)

    expect(m.moneyAllowed).toBe(true)
  })
})
