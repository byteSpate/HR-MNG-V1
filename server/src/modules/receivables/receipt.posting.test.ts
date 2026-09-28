import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    receipt: { findUnique: vi.fn(), update: vi.fn() },
    journal: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../accounting/accounting.reversal", () => ({ postReversalNow: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { postReversalNow } from "../accounting/accounting.reversal"
import { buildReceiptLines, reverseReceipt } from "./receipt.posting"
import { OUTSTANDING_SELECT } from "./receivables.reports"

const d = (v: string) => new Prisma.Decimal(v)
const SUPER_ADMIN = { sub: "admin-1", role: "SUPER_ADMIN", email: "a@b.com", mustChangePassword: false, salesRole: null } as any

const RULES = { event: "RECEIPT" as const, byKey: new Map([["RECEIVABLE", "1220"], ["BANK", "1242"], ["VDS", "1234"], ["AIT", "1235"]]) }

function expectBalanced(lines: ReturnType<typeof buildReceiptLines>) {
  const debit = lines.reduce((s, l) => s.plus(l.debit ?? "0"), d("0"))
  const credit = lines.reduce((s, l) => s.plus(l.credit ?? "0"), d("0"))
  expect(debit.toFixed(2)).toBe(credit.toFixed(2))
}

describe("buildReceiptLines", () => {
  it("posts the spec's worked receipt (§3.3), every line carrying the deal", () => {
    const lines = buildReceiptLines({
      id: "r1", customerId: "c1", opportunityId: "opp-1", amount: d("950000"), vdsAmount: d("150000"), aitAmount: d("50000"),
      allocations: [{ amount: d("1150000") }],
    }, RULES)

    expect(lines).toEqual([
      { accountCode: "1242", debit: "950000.00", opportunityId: "opp-1" },
      { accountCode: "1234", debit: "150000.00", customerId: "c1", opportunityId: "opp-1" },
      { accountCode: "1235", debit: "50000.00", customerId: "c1", opportunityId: "opp-1" },
      { accountCode: "1220", credit: "1150000.00", customerId: "c1", opportunityId: "opp-1" },
    ])
    expectBalanced(lines)
  })

  it("has no ADVANCE line (Task 3 removed advances): just Bank debited and Receivable credited", () => {
    const lines = buildReceiptLines({
      id: "r1", customerId: "c1", opportunityId: "opp-1", amount: d("1000"), vdsAmount: d("0"), aitAmount: d("0"),
      allocations: [{ amount: d("1000") }],
    }, RULES)
    expect(lines).toEqual([
      { accountCode: "1242", debit: "1000.00", opportunityId: "opp-1" },
      { accountCode: "1220", credit: "1000.00", customerId: "c1", opportunityId: "opp-1" },
    ])
  })
})

function arrangePostedReceipt({ id, journalId }: { id: string; journalId: string }) {
  const receipt = { id, status: "APPROVED", customerId: "c1" }
  vi.mocked(prisma.receipt.findUnique).mockResolvedValue(receipt as any)
  vi.mocked(prisma.receipt.update).mockResolvedValue({ ...receipt, status: "REVERSED" } as any)
  vi.mocked(prisma.journal.findFirst).mockResolvedValue({ id: journalId } as any)
  vi.mocked(postReversalNow).mockResolvedValue({ id: journalId, journalNo: "BS-JV-00099" })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("reverseReceipt", () => {
  it("lets a Super Admin reverse a receipt, with a reason", async () => {
    arrangePostedReceipt({ id: "r1", journalId: "j1" })

    await reverseReceipt("r1", { reason: "Typed the wrong amount" }, SUPER_ADMIN)

    expect(postReversalNow).toHaveBeenCalledWith(expect.anything(), "j1", "Typed the wrong amount", SUPER_ADMIN.sub)
    expect(prisma.receipt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "REVERSED" }),
    }))
  })

  it("refuses a receipt that is not approved", async () => {
    vi.mocked(prisma.receipt.findUnique).mockResolvedValue({ id: "r1", status: "REVERSED" } as any)
    await expect(reverseReceipt("r1", { reason: "x" }, SUPER_ADMIN)).rejects.toThrow("This receipt is already reversed.")
    expect(postReversalNow).not.toHaveBeenCalled()
  })

  it("refuses a receipt that is still a draft", async () => {
    vi.mocked(prisma.receipt.findUnique).mockResolvedValue({ id: "r1", status: "DRAFT" } as any)
    await expect(reverseReceipt("r1", { reason: "x" }, SUPER_ADMIN)).rejects.toThrow(
      "This receipt is still a draft. There is nothing posted to reverse yet."
    )
    expect(postReversalNow).not.toHaveBeenCalled()
  })

  it("refuses when no posted journal can be found for the receipt", async () => {
    vi.mocked(prisma.receipt.findUnique).mockResolvedValue({ id: "r1", status: "APPROVED", customerId: "c1" } as any)
    vi.mocked(prisma.journal.findFirst).mockResolvedValue(null)
    await expect(reverseReceipt("r1", { reason: "x" }, SUPER_ADMIN)).rejects.toThrow("This receipt has no posted entry to reverse.")
  })
})

it("a reversed receipt no longer counts as paid", () => {
  // getInvoiceOutstanding reads only APPROVED receipts' allocations, so a
  // REVERSED receipt drops out by itself with zero new code here. Verified
  // against the real, current shape of OUTSTANDING_SELECT.
  expect(OUTSTANDING_SELECT.allocations.where).toEqual({ receipt: { status: "APPROVED" } })
})
