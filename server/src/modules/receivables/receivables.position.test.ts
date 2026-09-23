import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
    account: { findUniqueOrThrow: vi.fn() },
    journalLine: { aggregate: vi.fn() },
  },
}))
vi.mock("../posting/posting.rules", () => ({ loadRules: vi.fn(), resolveAccountCode: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"
import { balanceOn, contractPosition, lockDeal, lockDeals, splitAgainst } from "./receivables.position"

const d = (v: string) => new Prisma.Decimal(v)

function arrangeRules(map: Record<string, string>) {
  vi.mocked(loadRules).mockResolvedValue({ event: "EARNED", byKey: new Map(Object.entries(map)) })
  vi.mocked(resolveAccountCode).mockImplementation((rules: any, key: string) => rules.byKey.get(key))
}

function arrangeBalances(byCode: Record<string, { debit: string; credit: string }>) {
  vi.mocked(prisma.account.findUniqueOrThrow).mockImplementation(async ({ where }: any) => ({ id: `acc-${where.code}` }) as any)
  vi.mocked(prisma.journalLine.aggregate).mockImplementation(async ({ where }: any) => {
    const code = String(where.accountId).replace(/^acc-/, "")
    const bal = byCode[code] ?? { debit: "0", credit: "0" }
    return { _sum: { debit: d(bal.debit), credit: d(bal.credit) } } as any
  })
}

beforeEach(() => vi.clearAllMocks())

describe("splitAgainst", () => {
  it("takes from what is available first", () => {
    const r = splitAgainst(d("1000000"), d("600000"))
    expect([r.fromAvailable.toFixed(2), r.rest.toFixed(2)]).toEqual(["600000.00", "400000.00"])
  })
  it("takes everything from available when it covers the amount", () => {
    const r = splitAgainst(d("100"), d("600000"))
    expect([r.fromAvailable.toFixed(2), r.rest.toFixed(2)]).toEqual(["100.00", "0.00"])
  })
  it("treats a negative available as nothing", () => {
    expect(splitAgainst(d("100"), d("-5")).rest.toFixed(2)).toBe("100.00")
  })
})

describe("balanceOn", () => {
  it("is posted debits minus credits on the account, for this deal only", async () => {
    arrangeBalances({ "1214": { debit: "800000", credit: "300000" } })
    await expect(balanceOn(prisma as any, "1214", "opp-1")).resolves.toEqual(d("500000"))
    expect(prisma.journalLine.aggregate).toHaveBeenCalledWith({
      where: { accountId: "acc-1214", opportunityId: "opp-1", journal: { status: { in: ["POSTED", "REVERSED"] } } },
      _sum: { debit: true, credit: true },
    })
  })
})

describe("contractPosition", () => {
  it("reads 1221 as debit minus credit and 2170 as credit minus debit, for this deal", async () => {
    arrangeRules({ UNBILLED: "1221", UNEARNED: "2170" })
    arrangeBalances({ "1221": { debit: "1000000", credit: "1000000" }, "2170": { debit: "0", credit: "250000" } })
    await expect(contractPosition(prisma as any, "opp-1")).resolves.toEqual({ unbilled: d("0"), unearned: d("250000") })
  })

  it("floors a debit-balance 2170 or a credit-balance 1221 at zero rather than showing a negative", async () => {
    arrangeRules({ UNBILLED: "1221", UNEARNED: "2170" })
    arrangeBalances({ "1221": { debit: "0", credit: "500000" }, "2170": { debit: "500000", credit: "0" } })
    await expect(contractPosition(prisma as any, "opp-1")).resolves.toEqual({ unbilled: d("0"), unearned: d("0") })
  })
})

describe("lockDeal", () => {
  it("locks the one deal row", async () => {
    await lockDeal(prisma as any, "opp-1")
    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect(vi.mocked(prisma.$queryRaw).mock.calls[0][1]).toBe("opp-1")
  })
})

describe("lockDeals", () => {
  it("locks in ascending id order, once each", async () => {
    await lockDeals(prisma as any, ["opp-b", "opp-a", "opp-b"])
    expect(vi.mocked(prisma.$queryRaw).mock.calls.map((c) => c[1])).toEqual(["opp-a", "opp-b"])
  })
})
