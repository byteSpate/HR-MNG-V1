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
vi.mock("./receivables.position", () => ({ lockDeal: vi.fn(), contractPosition: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"
import type { PostingEvent, ResolvedRules } from "../posting/posting.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { releaseCostForInvoice } from "./costRelease"
import { contractPosition, lockDeal } from "./receivables.position"
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

const NO_POSITION = { unbilled: d("0"), unearned: d("0") }

describe("buildInvoiceLines", () => {
  beforeEach(() => {
    vi.mocked(resolveAccountCode).mockImplementation((rules: any, key: string) => rules.byKey.get(key))
  })

  it("debits the receivable gross and credits revenue and VAT per line, tagged with the deal", () => {
    const lines = buildInvoiceLines({
      id: "inv1", customerId: "c1", opportunityId: "opp-1", trackDelivery: false,
      lines: [
        { amount: d("1000000"), vatAmount: d("150000"), kind: "GOODS" },
        { amount: d("100000"), vatAmount: d("0"), kind: "SERVICE" },
      ],
    }, INVOICE_RULES, EARNED_RULES, NO_POSITION)

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
      id: "inv1", customerId: "c1", opportunityId: "opp-1", trackDelivery: false,
      lines: [{ amount: d("10"), vatAmount: d("1.50"), kind: "GOODS" }],
    }, INVOICE_RULES, EARNED_RULES, { unbilled: d("600000"), unearned: d("0") })
    expect(lines.map((l) => l.accountCode)).not.toContain("1221")
    expect(lines.map((l) => l.accountCode)).not.toContain("2170")
  })

  const TRACKED = { id: "inv1", customerId: "c1", opportunityId: "opp-1", trackDelivery: true }

  it("credits 2170 when nothing has been earned yet (invoiced first)", () => {
    const lines = buildInvoiceLines(
      { ...TRACKED, lines: [{ amount: d("1000000"), vatAmount: d("150000"), kind: "GOODS" }] },
      INVOICE_RULES, EARNED_RULES, { unbilled: d("0"), unearned: d("0") }
    )
    expect(lines).toEqual([
      { accountCode: "1220", debit: "1150000.00", customerId: "c1", opportunityId: "opp-1" },
      { accountCode: "2150", credit: "150000.00", opportunityId: "opp-1" },
      { accountCode: "2170", credit: "1000000.00", opportunityId: "opp-1" },
    ])
    expectBalanced(lines)
  })

  it("clears 1221 when the goods were delivered first (spec §3.2 worked example, step 2)", () => {
    const lines = buildInvoiceLines(
      { ...TRACKED, lines: [{ amount: d("1000000"), vatAmount: d("150000"), kind: "GOODS" }] },
      INVOICE_RULES, EARNED_RULES, { unbilled: d("1000000"), unearned: d("0") }
    )
    expect(lines).toContainEqual({ accountCode: "1221", credit: "1000000.00", opportunityId: "opp-1" })
    expect(lines.map((l) => l.accountCode)).not.toContain("2170")
  })

  it("splits across both when the invoice is bigger than what was earned", () => {
    const lines = buildInvoiceLines(
      { ...TRACKED, lines: [{ amount: d("1000000"), vatAmount: d("0"), kind: "GOODS" }] },
      INVOICE_RULES, EARNED_RULES, { unbilled: d("600000"), unearned: d("0") }
    )
    expect(lines).toContainEqual({ accountCode: "1221", credit: "600000.00", opportunityId: "opp-1" })
    expect(lines).toContainEqual({ accountCode: "2170", credit: "400000.00", opportunityId: "opp-1" })
  })

  it("leaves an untracked PO earning on the invoice, even when the deal has an unbilled balance (Review Focus 4)", () => {
    const lines = buildInvoiceLines(
      { ...TRACKED, trackDelivery: false, lines: [{ amount: d("100"), vatAmount: d("0"), kind: "GOODS" }] },
      INVOICE_RULES, EARNED_RULES, { unbilled: d("600000"), unearned: d("0") }
    )
    expect(lines.map((l) => l.accountCode)).toEqual(["1220", "4130"])
  })
})

function arrangeDraft(over: {
  createdBy?: string
  date?: Date
  poLineAlreadyInvoicedByOthers?: string
  completesPo?: boolean
  trackDelivery?: boolean
} = {}) {
  const lockHead = { poId: "po1", po: { opportunityId: "opp-1" } }
  const full = {
    id: "inv1", poId: "po1", status: "DRAFT", createdBy: over.createdBy ?? "finance-1",
    customerId: "c1", invoiceNumber: "INV-1", date: over.date ?? new Date("2026-09-23"),
    po: { id: "po1", serial: "BS-CPO-00001", opportunityId: "opp-1", trackDelivery: over.trackDelivery ?? false },
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
  vi.mocked(contractPosition).mockResolvedValue(NO_POSITION)
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

  it("locks the deal before reading anything it will decide on", async () => {
    arrangeDraft({})
    await approveInvoice("inv1", ADMIN)
    expect(lockDeal).toHaveBeenCalledWith(expect.anything(), "opp-1")
    expect(vi.mocked(lockDeal).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(prisma.invoice.findUnique).mock.invocationCallOrder.at(-1)!)
  })

  it("reads the position after taking the deal lock", async () => {
    arrangeDraft({ trackDelivery: true })
    await approveInvoice("inv1", ADMIN)
    expect(vi.mocked(lockDeal).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(contractPosition).mock.invocationCallOrder[0])
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
