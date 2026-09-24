import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    invoice: { findUnique: vi.fn(), update: vi.fn() },
    customerPoLine: { findMany: vi.fn() },
    customerPo: { update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../posting/posting.rules", () => ({ loadRules: vi.fn(), resolveAccountCode: vi.fn() }))
vi.mock("../accounting/accounting.posting", () => ({ postSystemJournal: vi.fn() }))
vi.mock("./costRelease", () => ({ releaseCostForInvoice: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"
import type { PostingEvent, ResolvedRules } from "../posting/posting.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { releaseCostForInvoice } from "./costRelease"
import { approveInvoice, buildInvoiceLines } from "./invoice.posting"

const d = (v: string) => new Prisma.Decimal(v)
const ADMIN = { sub: "admin-1", role: "SUPER_ADMIN", email: "a@b.com", mustChangePassword: false, salesRole: null } as any

function rulesOf(event: PostingEvent, map: Record<string, string>): ResolvedRules {
  return { event, byKey: new Map(Object.entries(map)) }
}
const INVOICE_RULES = rulesOf("INVOICE", { RECEIVABLE: "1220", VAT: "2150", UNBILLED: "1221", UNEARNED: "2170" })
const EARNED_RULES = rulesOf("EARNED", { GOODS: "4130", SERVICE: "4120", UNBILLED: "1221", UNEARNED: "2170" })

function expectBalanced(lines: ReturnType<typeof buildInvoiceLines>) {
  const debit = lines.reduce((s, l) => s.plus(l.debit ?? "0"), d("0"))
  const credit = lines.reduce((s, l) => s.plus(l.credit ?? "0"), d("0"))
  expect(debit.toFixed(2)).toBe(credit.toFixed(2))
}

describe("buildInvoiceLines", () => {
  beforeEach(() => {
    vi.mocked(resolveAccountCode).mockImplementation((rules: any, key: string) => rules.byKey.get(key))
  })

  it("debits the receivable gross and credits revenue and VAT per line, tagged with the deal", () => {
    const lines = buildInvoiceLines({
      id: "inv1", customerId: "c1", opportunityId: "opp-1",
      lines: [
        { amount: d("1000000"), vatAmount: d("150000"), kind: "GOODS" },
        { amount: d("100000"), vatAmount: d("0"), kind: "SERVICE" },
      ],
    }, INVOICE_RULES, EARNED_RULES)

    expect(lines).toEqual([
      { accountCode: "1220", debit: "1250000.00", customerId: "c1", opportunityId: "opp-1" },
      { accountCode: "4130", credit: "1000000.00", opportunityId: "opp-1" },
      { accountCode: "2150", credit: "150000.00", opportunityId: "opp-1" },
      { accountCode: "4120", credit: "100000.00", opportunityId: "opp-1" },
    ])
    expectBalanced(lines)
  })

  it("never touches Unbilled or Unearned while delivery is not tracked", () => {
    const lines = buildInvoiceLines({
      id: "inv1", customerId: "c1", opportunityId: "opp-1",
      lines: [{ amount: d("10"), vatAmount: d("1.50"), kind: "GOODS" }],
    }, INVOICE_RULES, EARNED_RULES)
    expect(lines.map((l) => l.accountCode)).not.toContain("1221")
    expect(lines.map((l) => l.accountCode)).not.toContain("2170")
  })
})

function arrangeDraft(over: {
  createdBy?: string
  date?: Date
  poLineAlreadyInvoicedByOthers?: string
  completesPo?: boolean
} = {}) {
  const lockHead = { poId: "po1" }
  const full = {
    id: "inv1", poId: "po1", status: "DRAFT", createdBy: over.createdBy ?? "finance-1",
    customerId: "c1", invoiceNumber: "INV-1", date: over.date ?? new Date("2026-09-23"),
    po: { id: "po1", serial: "BS-CPO-00001", opportunityId: "opp-1" },
    lines: [{ poLineId: "pl1", amount: d("500000"), vatAmount: d("75000"), poLine: { id: "pl1", description: "Firewall", kind: "GOODS" } }],
  }
  vi.mocked(prisma.invoice.findUnique)
    .mockResolvedValueOnce(lockHead as any)
    .mockResolvedValueOnce(full as any)
  vi.mocked(prisma.invoice.update).mockResolvedValue({ id: "inv1", customer: { legalName: "Bengal Group" } } as any)

  const otherAmount = over.poLineAlreadyInvoicedByOthers ?? "0"
  const poLine = {
    id: "pl1", description: "Firewall", amount: d("800000"),
    invoiceLines: otherAmount === "0" ? [] : [{ amount: d(otherAmount) }],
  }
  vi.mocked(prisma.customerPoLine.findMany)
    .mockResolvedValueOnce([poLine] as any)
    .mockResolvedValueOnce([{ ...poLine, invoiceLines: over.completesPo ? [{ amount: d("800000") }] : [{ amount: d("500000") }] }] as any)

  vi.mocked(loadRules).mockImplementation(async (_tx: any, event: PostingEvent) =>
    event === "INVOICE" ? INVOICE_RULES : EARNED_RULES
  )
  vi.mocked(releaseCostForInvoice).mockResolvedValue(d("0"))
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: arrangeDraft queues two
  // mockResolvedValueOnce values on customerPoLine.findMany, and a test
  // that throws before consuming both must not leave them queued for the
  // next test to pick up out of order.
  vi.resetAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(resolveAccountCode).mockImplementation((rules: any, key: string) => rules.byKey.get(key))
})

describe("approveInvoice", () => {
  it("refuses the person who prepared it", async () => {
    arrangeDraft({ createdBy: ADMIN.sub })
    await expect(approveInvoice("inv1", ADMIN)).rejects.toThrow("You prepared this invoice and cannot also approve it")
    expect(postSystemJournal).not.toHaveBeenCalled()
  })

  it("locks the PO row before reading anything it will decide on", async () => {
    arrangeDraft({})
    await approveInvoice("inv1", ADMIN)
    const lockAt = vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]
    const reloadAt = vi.mocked(prisma.invoice.findUnique).mock.invocationCallOrder.at(-1)!
    expect(lockAt).toBeLessThan(reloadAt)
  })

  it("re-checks what is left on each PO line at approval, since two drafts may have been created at once", async () => {
    arrangeDraft({ poLineAlreadyInvoicedByOthers: "600000" })
    await expect(approveInvoice("inv1", ADMIN)).rejects.toThrow("Only 200000.00 is left to invoice on Firewall")
  })

  it("posts the invoice on its own date, releases cost, and audits the approval", async () => {
    arrangeDraft({ date: new Date("2026-09-20") })
    await approveInvoice("inv1", ADMIN)
    expect(postSystemJournal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      date: new Date("2026-09-20"), source: { module: "CUSTOMER", refId: "inv1", event: "INVOICE" },
    }))
    expect(releaseCostForInvoice).toHaveBeenCalledWith(expect.anything(), "inv1", ADMIN.sub)
    expect(prisma.auditLog.create).toHaveBeenCalled()
  })

  it("marks the PO complete when every line is fully invoiced by approved invoices", async () => {
    arrangeDraft({ completesPo: true })
    await approveInvoice("inv1", ADMIN)
    expect(prisma.customerPo.update).toHaveBeenCalledWith({ where: { id: "po1" }, data: { status: "COMPLETE" } })
  })

  it("leaves the PO open while something is still to invoice", async () => {
    arrangeDraft({ completesPo: false })
    await approveInvoice("inv1", ADMIN)
    expect(prisma.customerPo.update).not.toHaveBeenCalled()
  })
})
