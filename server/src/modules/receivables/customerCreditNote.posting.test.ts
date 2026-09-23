import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    customerCreditNote: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../posting/posting.rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../posting/posting.rules")>()),
  loadRules: vi.fn(),
}))
vi.mock("../accounting/accounting.posting", () => ({ postSystemJournal: vi.fn() }))
vi.mock("./receivables.position", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./receivables.position")>()),
  lockDeal: vi.fn(),
  contractPosition: vi.fn(),
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules } from "../posting/posting.rules"
import type { PostingEvent, ResolvedRules } from "../posting/posting.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { contractPosition, lockDeal } from "./receivables.position"
import { approveCustomerCreditNote, buildCustomerCreditNoteLines } from "./customerCreditNote.posting"

const d = (v: string) => new Prisma.Decimal(v)
const ADMIN = { sub: "admin-1", role: "SUPER_ADMIN", email: "a@b.com", mustChangePassword: false, salesRole: null } as any

function rulesOf(event: PostingEvent, map: Record<string, string>): ResolvedRules {
  return { event, byKey: new Map(Object.entries(map)) }
}
const RULES = rulesOf("CUSTOMER_CREDIT", { RECEIVABLE: "1220", GOODS: "4130", SERVICE: "4120", VAT: "2150", UNEARNED: "2170" })

function expectBalanced(lines: ReturnType<typeof buildCustomerCreditNoteLines>) {
  const debit = lines.reduce((s, l) => s.plus(l.debit ?? "0"), d("0"))
  const credit = lines.reduce((s, l) => s.plus(l.credit ?? "0"), d("0"))
  expect(debit.toFixed(2)).toBe(credit.toFixed(2))
}

const NO_POSITION = { unbilled: d("0"), unearned: d("0") }
const NOTE = { id: "cn1", customerId: "c1", opportunityId: "opp-1" }

describe("buildCustomerCreditNoteLines", () => {
  it("debits revenue and VAT per line and credits the receivable gross", () => {
    const lines = buildCustomerCreditNoteLines({
      ...NOTE, trackDelivery: false,
      lines: [{ amount: d("160000"), vatAmount: d("24000"), kind: "GOODS" }],
    }, RULES, NO_POSITION)

    expect(lines).toEqual([
      { accountCode: "4130", debit: "160000.00", opportunityId: "opp-1" },
      { accountCode: "2150", debit: "24000.00", opportunityId: "opp-1" },
      { accountCode: "1220", credit: "184000.00", customerId: "c1", opportunityId: "opp-1" },
    ])
    expectBalanced(lines)
  })

  it("debits 2170 first on a tracked PO invoiced ahead of delivery", () => {
    const lines = buildCustomerCreditNoteLines({
      ...NOTE, trackDelivery: true,
      lines: [{ amount: d("160000"), vatAmount: d("24000"), kind: "GOODS" }],
    }, RULES, { unbilled: d("0"), unearned: d("100000") })

    expect(lines).toEqual([
      { accountCode: "2170", debit: "100000.00", opportunityId: "opp-1" },
      { accountCode: "4130", debit: "60000.00", opportunityId: "opp-1" },
      { accountCode: "2150", debit: "24000.00", opportunityId: "opp-1" },
      { accountCode: "1220", credit: "184000.00", customerId: "c1", opportunityId: "opp-1" },
    ])
    expectBalanced(lines)
  })

  it("leaves an untracked PO's credit note as all revenue", () => {
    const lines = buildCustomerCreditNoteLines({
      ...NOTE, trackDelivery: false,
      lines: [{ amount: d("160000"), vatAmount: d("24000"), kind: "GOODS" }],
    }, RULES, { unbilled: d("0"), unearned: d("100000") })
    expect(lines.map((l) => l.accountCode)).not.toContain("2170")
  })
})

function arrangeDraftNote(over: Record<string, unknown> = {}) {
  const note = {
    id: "cn1", status: "DRAFT", createdBy: "finance-1", date: new Date("2026-09-22"), reason: "Two units returned",
    customerId: "c1", customer: { legalName: "Bengal Group" },
    invoice: {
      id: "inv1", invoiceNumber: "INV-1", customerId: "c1", status: "APPROVED",
      po: { opportunityId: "opp-1", trackDelivery: false },
      lines: [{ amount: d("1000000"), vatAmount: d("150000") }], allocations: [], creditNotes: [],
    },
    lines: [{ amount: d("160000"), vatAmount: d("24000"), invoiceLine: { poLine: { kind: "GOODS" } } }],
    ...over,
  }
  vi.mocked(prisma.customerCreditNote.findUnique).mockResolvedValue(note as any)
  vi.mocked(prisma.customerCreditNote.update).mockResolvedValue(note as any)
  vi.mocked(loadRules).mockResolvedValue(RULES)
  vi.mocked(contractPosition).mockResolvedValue(NO_POSITION)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("approveCustomerCreditNote", () => {
  it("refuses the person who prepared it", async () => {
    arrangeDraftNote({ createdBy: ADMIN.sub })
    await expect(approveCustomerCreditNote("cn1", ADMIN)).rejects.toThrow("You prepared this credit note and cannot also approve it")
    expect(postSystemJournal).not.toHaveBeenCalled()
  })

  it("re-checks it still fits within what the invoice owes, since a receipt may have been approved since", async () => {
    arrangeDraftNote({
      invoice: {
        id: "inv1", invoiceNumber: "INV-1", customerId: "c1", status: "APPROVED", po: { opportunityId: "opp-1" },
        lines: [{ amount: d("1000000"), vatAmount: d("150000") }], allocations: [{ amount: d("1100000") }], creditNotes: [],
      },
    })
    await expect(approveCustomerCreditNote("cn1", ADMIN)).rejects.toThrow(/only has 50000.00 left to collect/)
    expect(postSystemJournal).not.toHaveBeenCalled()
  })

  it("posts on the credit note's date, locking the deal first", async () => {
    arrangeDraftNote({})
    await approveCustomerCreditNote("cn1", ADMIN)
    expect(postSystemJournal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      date: new Date("2026-09-22"), source: { module: "CUSTOMER", refId: "cn1", event: "CREDIT_NOTE" },
    }))
    expect(lockDeal).toHaveBeenCalledWith(expect.anything(), "opp-1")
    const lockAt = vi.mocked(lockDeal).mock.invocationCallOrder[0]
    const postAt = vi.mocked(postSystemJournal).mock.invocationCallOrder[0]
    expect(lockAt).toBeLessThan(postAt)
  })
})
