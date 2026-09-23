import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    receipt: { findUnique: vi.fn(), update: vi.fn() },
    receiptAllocation: { create: vi.fn() },
    receiptOpeningAllocation: { create: vi.fn() },
  },
}))
vi.mock("./receipt.allocation", () => ({ assertReceivable: vi.fn(), assertOpeningReceivable: vi.fn() }))
vi.mock("../posting/posting.rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../posting/posting.rules")>()),
  loadRules: vi.fn(),
}))
vi.mock("../accounting/accounting.posting", () => ({ postSystemJournal: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules } from "../posting/posting.rules"
import { postSystemJournal } from "../accounting/accounting.posting"
import { assertOpeningReceivable, assertReceivable } from "./receipt.allocation"
import { approveReceipt, buildReceiptLines, matchCustomerAdvance } from "./receipt.posting"

const d = (v: string) => new Prisma.Decimal(v)
const ADMIN = { sub: "admin-1", role: "SUPER_ADMIN", email: "a@b.com", mustChangePassword: false, salesRole: null } as any
const FINANCE = { sub: "finance-1", role: "FINANCE_OFFICER", email: "f@b.com", mustChangePassword: false, salesRole: null } as any

const RULES = { event: "RECEIPT" as const, byKey: new Map([["RECEIVABLE", "1220"], ["BANK", "1242"], ["ADVANCE", "2160"], ["VDS", "1234"], ["AIT", "1235"]]) }

function expectBalanced(lines: ReturnType<typeof buildReceiptLines>) {
  const debit = lines.reduce((s, l) => s.plus(l.debit ?? "0"), d("0"))
  const credit = lines.reduce((s, l) => s.plus(l.credit ?? "0"), d("0"))
  expect(debit.toFixed(2)).toBe(credit.toFixed(2))
}

describe("buildReceiptLines", () => {
  it("posts the spec's worked receipt (§3.3)", () => {
    const lines = buildReceiptLines({
      id: "r1", customerId: "c1", amount: d("950000"), vdsAmount: d("150000"), aitAmount: d("50000"),
      allocations: [{ amount: d("1150000"), matchedAt: null }], openingAllocations: [],
    }, RULES)

    expect(lines).toEqual([
      { accountCode: "1242", debit: "950000.00" },
      { accountCode: "1234", debit: "150000.00", customerId: "c1" },
      { accountCode: "1235", debit: "50000.00", customerId: "c1" },
      { accountCode: "1220", credit: "1150000.00", customerId: "c1" },
    ])
    expectBalanced(lines)
  })

  it("credits 2160 for an advance received before any invoice", () => {
    const lines = buildReceiptLines({
      id: "r1", customerId: "c1", amount: d("300000"), vdsAmount: d("0"), aitAmount: d("0"),
      allocations: [], openingAllocations: [],
    }, RULES)

    expect(lines).toEqual([
      { accountCode: "1242", debit: "300000.00" },
      { accountCode: "2160", credit: "300000.00", customerId: "c1" },
    ])
  })

  it("credits 1220 for an opening-balance allocation", () => {
    const lines = buildReceiptLines({
      id: "r1", customerId: "c1", amount: d("200000"), vdsAmount: d("0"), aitAmount: d("0"),
      allocations: [], openingAllocations: [{ amount: d("200000"), matchedAt: null }],
    }, RULES)

    expect(lines.map((l) => l.accountCode)).toEqual(["1242", "1220"])
  })
})

function arrangeReceipt(over: Record<string, unknown> = {}) {
  const receipt = {
    id: "r1", customerId: "c1", status: "DRAFT", createdBy: "finance-1",
    date: new Date("2026-09-21"), amount: d("950000"), vdsAmount: d("150000"), aitAmount: d("50000"), reference: null,
    allocations: [{ invoiceId: "inv1", amount: d("1150000"), matchedAt: null }], openingAllocations: [],
    customer: { legalName: "Bengal Group" },
    ...over,
  }
  vi.mocked(prisma.receipt.findUnique).mockResolvedValue(receipt as any)
  vi.mocked(prisma.receipt.update).mockResolvedValue(receipt as any)
  vi.mocked(loadRules).mockResolvedValue(RULES)
}

beforeEach(() => {
  vi.clearAllMocks()
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

describe("matchCustomerAdvance", () => {
  function arrangeApprovedAdvance(over: Record<string, unknown> = {}) {
    arrangeReceipt({
      status: "APPROVED", amount: d("300000"), vdsAmount: d("0"), aitAmount: d("0"),
      allocations: [], openingAllocations: [],
      ...over,
    })
  }

  it("moves the matched amount from 2160 to 1220", async () => {
    arrangeApprovedAdvance({})
    await matchCustomerAdvance("r1", { invoiceId: "inv1", amount: "250000" } as any, FINANCE)

    expect(prisma.receiptAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ receiptId: "r1", invoiceId: "inv1", amount: "250000.00", matchedAt: expect.any(Date) }),
    })
    expect(postSystemJournal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: { module: "CUSTOMER", refId: "r1:inv1", event: "ADVANCE_MATCH" },
      lines: [
        { accountCode: "2160", debit: "250000.00", customerId: "c1" },
        { accountCode: "1220", credit: "250000.00", customerId: "c1" },
      ],
    }))
  })

  it("refuses more than is left of the advance", async () => {
    arrangeApprovedAdvance({ allocations: [{ invoiceId: "x", amount: d("100000"), matchedAt: null }] })
    await expect(matchCustomerAdvance("r1", { invoiceId: "inv1", amount: "250000" } as any, FINANCE))
      .rejects.toThrow("Only 200000.00 of this advance is left to match")
  })

  it("refuses a draft receipt", async () => {
    arrangeReceipt({ status: "DRAFT" })
    await expect(matchCustomerAdvance("r1", { invoiceId: "inv1", amount: "1" } as any, FINANCE))
      .rejects.toThrow("Only an approved receipt's advance can be matched")
  })

  it("matches the opening balance when given an openingBalanceId instead", async () => {
    arrangeApprovedAdvance({})
    vi.mocked(assertOpeningReceivable).mockResolvedValue({ openingBalanceId: "ob1" })
    await matchCustomerAdvance("r1", { openingBalanceId: "ob1", amount: "100000" } as any, FINANCE)

    expect(prisma.receiptOpeningAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ receiptId: "r1", openingBalanceId: "ob1", amount: "100000.00", matchedAt: expect.any(Date) }),
    })
  })
})
