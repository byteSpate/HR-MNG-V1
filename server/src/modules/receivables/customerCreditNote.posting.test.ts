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

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules } from "../posting/posting.rules"
import type { PostingEvent, ResolvedRules } from "../posting/posting.types"
import { postSystemJournal } from "../accounting/accounting.posting"
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

describe("buildCustomerCreditNoteLines", () => {
  it("debits revenue and VAT per line and credits the receivable gross", () => {
    const lines = buildCustomerCreditNoteLines({
      id: "cn1", customerId: "c1", opportunityId: "opp-1",
      lines: [{ amount: d("160000"), vatAmount: d("24000"), kind: "GOODS" }],
    }, RULES)

    expect(lines).toEqual([
      { accountCode: "4130", debit: "160000.00", opportunityId: "opp-1" },
      { accountCode: "2150", debit: "24000.00", opportunityId: "opp-1" },
      { accountCode: "1220", credit: "184000.00", customerId: "c1", opportunityId: "opp-1" },
    ])
    expectBalanced(lines)
  })
})

function arrangeDraftNote(over: Record<string, unknown> = {}) {
  const note = {
    id: "cn1", status: "DRAFT", createdBy: "finance-1", rejectionNote: null, date: new Date("2026-09-22"), reason: "Two units returned",
    customerId: "c1", customer: { legalName: "Bengal Group" },
    invoice: {
      id: "inv1", invoiceNumber: "INV-1", customerId: "c1", status: "APPROVED",
      po: { opportunityId: "opp-1" },
      lines: [{ amount: d("1000000"), vatAmount: d("150000") }], allocations: [], creditNotes: [],
    },
    lines: [{ amount: d("160000"), vatAmount: d("24000"), invoiceLine: { poLine: { kind: "GOODS" } } }],
    ...over,
  }
  vi.mocked(prisma.customerCreditNote.findUnique).mockResolvedValue(note as any)
  vi.mocked(prisma.customerCreditNote.update).mockResolvedValue(note as any)
  vi.mocked(loadRules).mockResolvedValue(RULES)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("approveCustomerCreditNote", () => {
  it("refuses the person who prepared it", async () => {
    arrangeDraftNote({ createdBy: ADMIN.sub })
    await expect(approveCustomerCreditNote("cn1", ADMIN)).rejects.toThrow("You prepared this credit note, so someone else must approve it.")
    expect(postSystemJournal).not.toHaveBeenCalled()
  })

  it("refuses to approve a draft that was sent back and not saved again", async () => {
    arrangeDraftNote({ rejectionNote: "Wrong amount" })
    await expect(approveCustomerCreditNote("cn1", ADMIN)).rejects.toThrow(
      "This was sent back. The person who prepared it must save it again first."
    )
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

  it("posts on the credit note's date, locking the invoice's PO row first", async () => {
    arrangeDraftNote({})
    await approveCustomerCreditNote("cn1", ADMIN)
    expect(postSystemJournal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      date: new Date("2026-09-22"), source: { module: "CUSTOMER", refId: "cn1", event: "CREDIT_NOTE" },
    }))
    const lockAt = vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]
    const postAt = vi.mocked(postSystemJournal).mock.invocationCallOrder[0]
    expect(lockAt).toBeLessThan(postAt)
  })
})
