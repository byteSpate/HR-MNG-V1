import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    receipt: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("./receipt.allocation", () => ({ assertReceivable: vi.fn() }))
vi.mock("../posting/posting.rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../posting/posting.rules")>()),
  loadRules: vi.fn(),
}))
vi.mock("../accounting/accounting.posting", () => ({ postSystemJournal: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules } from "../posting/posting.rules"
import { postSystemJournal } from "../accounting/accounting.posting"
import { assertReceivable } from "./receipt.allocation"
import { approveReceipt, buildReceiptLines } from "./receipt.posting"

const d = (v: string) => new Prisma.Decimal(v)
const ADMIN = { sub: "admin-1", role: "SUPER_ADMIN", email: "a@b.com", mustChangePassword: false, salesRole: null } as any

const RULES = { event: "RECEIPT" as const, byKey: new Map([["RECEIVABLE", "1220"], ["BANK", "1242"], ["VDS", "1234"], ["AIT", "1235"]]) }

function expectBalanced(lines: ReturnType<typeof buildReceiptLines>) {
  const debit = lines.reduce((s, l) => s.plus(l.debit ?? "0"), d("0"))
  const credit = lines.reduce((s, l) => s.plus(l.credit ?? "0"), d("0"))
  expect(debit.toFixed(2)).toBe(credit.toFixed(2))
}

describe("buildReceiptLines", () => {
  it("posts the spec's worked receipt (§3.3)", () => {
    const lines = buildReceiptLines({
      id: "r1", customerId: "c1", amount: d("950000"), vdsAmount: d("150000"), aitAmount: d("50000"),
      allocations: [{ amount: d("1150000") }],
    }, RULES)

    expect(lines).toEqual([
      { accountCode: "1242", debit: "950000.00" },
      { accountCode: "1234", debit: "150000.00", customerId: "c1" },
      { accountCode: "1235", debit: "50000.00", customerId: "c1" },
      { accountCode: "1220", credit: "1150000.00", customerId: "c1" },
    ])
    expectBalanced(lines)
  })
})

function arrangeReceipt(over: Record<string, unknown> = {}) {
  const receipt = {
    id: "r1", customerId: "c1", status: "DRAFT", createdBy: "finance-1",
    date: new Date("2026-09-21"), amount: d("950000"), vdsAmount: d("150000"), aitAmount: d("50000"), reference: null,
    allocations: [{ invoiceId: "inv1", amount: d("1150000") }],
    customer: { legalName: "Bengal Group" },
    ...over,
  }
  vi.mocked(prisma.receipt.findUnique).mockResolvedValue(receipt as any)
  vi.mocked(prisma.receipt.update).mockResolvedValue(receipt as any)
  vi.mocked(loadRules).mockResolvedValue(RULES)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("approveReceipt", () => {
  it("refuses the person who prepared it", async () => {
    arrangeReceipt({ createdBy: ADMIN.sub })
    await expect(approveReceipt("r1", ADMIN)).rejects.toThrow("You prepared this receipt and cannot also approve it")
  })

  it("re-checks every allocation inside the transaction", async () => {
    arrangeReceipt({})
    vi.mocked(assertReceivable).mockRejectedValue(new Error("Invoice INV-1 only has 10.00 left to collect"))
    await expect(approveReceipt("r1", ADMIN)).rejects.toThrow("Invoice INV-1 only has 10.00 left to collect")
    expect(postSystemJournal).not.toHaveBeenCalled()
  })

  it("posts on the receipt's own date", async () => {
    arrangeReceipt({ date: new Date("2026-09-21") })
    await approveReceipt("r1", ADMIN)
    expect(postSystemJournal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      date: new Date("2026-09-21"), source: { module: "CUSTOMER", refId: "r1", event: "RECEIPT" },
    }))
  })
})
