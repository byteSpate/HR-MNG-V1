import { describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    account: { findUniqueOrThrow: vi.fn() },
    journalLine: { aggregate: vi.fn() },
  },
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { heldGoodsCost } from "./costRelease"

const d = (v: string) => new Prisma.Decimal(v)

describe("heldGoodsCost", () => {
  it("is posted debits minus credits on the goods account, for this deal only", async () => {
    vi.mocked(prisma.account.findUniqueOrThrow).mockResolvedValue({ id: "acc-1214" } as any)
    vi.mocked(prisma.journalLine.aggregate).mockResolvedValue({ _sum: { debit: d("800000"), credit: d("300000") } } as any)

    await expect(heldGoodsCost(prisma as any, "opp-1", "1214")).resolves.toEqual(d("500000"))

    expect(prisma.account.findUniqueOrThrow).toHaveBeenCalledWith({ where: { code: "1214" }, select: { id: true } })
    expect(prisma.journalLine.aggregate).toHaveBeenCalledWith({
      where: { accountId: "acc-1214", opportunityId: "opp-1", journal: { status: { in: ["POSTED", "REVERSED"] } } },
      _sum: { debit: true, credit: true },
    })
  })

  it("treats a deal with nothing posted as holding nothing", async () => {
    vi.mocked(prisma.account.findUniqueOrThrow).mockResolvedValue({ id: "acc-1214" } as any)
    vi.mocked(prisma.journalLine.aggregate).mockResolvedValue({ _sum: { debit: null, credit: null } } as any)

    await expect(heldGoodsCost(prisma as any, "opp-1", "1214")).resolves.toEqual(d("0"))
  })
})
