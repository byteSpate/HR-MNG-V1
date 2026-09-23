import { describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    account: { findUniqueOrThrow: vi.fn() },
    journalLine: { aggregate: vi.fn() },
    customerPoLine: { findMany: vi.fn() },
    invoiceLine: { findMany: vi.fn() },
  },
}))
vi.mock("../posting/posting.rules", () => ({ loadRules: vi.fn(), resolveAccountCode: vi.fn() }))
vi.mock("../accounting/accounting.posting", () => ({ postSystemJournal: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules, resolveAccountCode } from "../posting/posting.rules"
import { postSystemJournal } from "../accounting/accounting.posting"
import { computeCostRelease, dealInvoicing, heldGoodsCost, releaseLateCost } from "./costRelease"

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

describe("computeCostRelease", () => {
  const input = (o: Partial<Record<"held" | "basis" | "invoicedBefore" | "invoicedNow", string>> = {}) => ({
    held: d(o.held ?? "800000"),
    basis: d(o.basis ?? "1000000"),
    invoicedBefore: d(o.invoicedBefore ?? "0"),
    invoicedNow: d(o.invoicedNow ?? "0"),
  })

  it("releases the invoiced share of what is held", () => {
    expect(computeCostRelease(input({ invoicedNow: "400000" })).toFixed(2)).toBe("320000.00")
  })

  it("releases the rest against the rest of the basis on a later invoice", () => {
    expect(computeCostRelease(input({ held: "480000", invoicedBefore: "400000", invoicedNow: "300000" })).toFixed(2)).toBe("240000.00")
  })

  it("clears everything held on the invoice that completes the basis, so no residue is left", () => {
    expect(computeCostRelease(input({ held: "240000.01", invoicedBefore: "700000", invoicedNow: "300000" })).toFixed(2)).toBe("240000.01")
  })

  it("releases nothing when nothing is held", () => {
    expect(computeCostRelease(input({ held: "0", invoicedNow: "400000" })).toFixed(2)).toBe("0.00")
  })

  it("releases nothing when the invoice adds nothing to the basis", () => {
    expect(computeCostRelease(input({ invoicedNow: "0" })).toFixed(2)).toBe("0.00")
  })

  it("never releases a negative held balance", () => {
    expect(computeCostRelease(input({ held: "-5000", invoicedNow: "1000000" })).toFixed(2)).toBe("0.00")
  })
})

describe("dealInvoicing", () => {
  it("uses goods lines as the basis when the deal has any", async () => {
    vi.mocked(prisma.customerPoLine.findMany).mockResolvedValue([
      { kind: "GOODS", amount: d("800000") }, { kind: "SERVICE", amount: d("100000") },
    ] as any)
    vi.mocked(prisma.invoiceLine.findMany).mockResolvedValue([
      { amount: d("300000"), poLine: { kind: "GOODS" } }, { amount: d("100000"), poLine: { kind: "SERVICE" } },
    ] as any)

    await expect(dealInvoicing(prisma as any, "opp-1")).resolves.toEqual({
      basis: d("800000"), invoiced: d("300000"), basisKinds: ["GOODS"],
    })
    expect(prisma.customerPoLine.findMany).toHaveBeenCalledWith({
      where: { po: { opportunityId: "opp-1", status: { in: ["OPEN", "COMPLETE"] } } },
      select: { kind: true, amount: true },
    })
  })

  it("falls back to every line when the PO lists only services (Review Focus 2)", async () => {
    vi.mocked(prisma.customerPoLine.findMany).mockResolvedValue([{ kind: "SERVICE", amount: d("500000") }] as any)
    vi.mocked(prisma.invoiceLine.findMany).mockResolvedValue([{ amount: d("200000"), poLine: { kind: "SERVICE" } }] as any)

    await expect(dealInvoicing(prisma as any, "opp-1")).resolves.toEqual({
      basis: d("500000"), invoiced: d("200000"), basisKinds: ["GOODS", "SERVICE"],
    })
  })

  it("excludes one invoice's lines when asked to, for the approval that is about to add them back", async () => {
    vi.mocked(prisma.customerPoLine.findMany).mockResolvedValue([{ kind: "GOODS", amount: d("800000") }] as any)
    vi.mocked(prisma.invoiceLine.findMany).mockResolvedValue([{ amount: d("300000"), poLine: { kind: "GOODS" } }] as any)

    await dealInvoicing(prisma as any, "opp-1", "inv-being-approved")

    expect(prisma.invoiceLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        invoice: expect.objectContaining({ id: { not: "inv-being-approved" } }),
      }),
    }))
  })
})

describe("releaseLateCost", () => {
  const RULES = { event: "COST_RELEASE" as const, byKey: new Map([["GOODS", "1214"], ["DELIVERED", "5121"]]) }

  function arrangeDealPosition(o: { basis: string; invoiced: string; held: string }) {
    vi.mocked(prisma.customerPoLine.findMany).mockResolvedValue([{ kind: "GOODS", amount: d(o.basis) }] as any)
    vi.mocked(prisma.invoiceLine.findMany).mockResolvedValue(
      o.invoiced === "0" ? [] : ([{ amount: d(o.invoiced), poLine: { kind: "GOODS" } }] as any)
    )
    vi.mocked(prisma.account.findUniqueOrThrow).mockResolvedValue({ id: "acc-1214" } as any)
    vi.mocked(prisma.journalLine.aggregate).mockResolvedValue({ _sum: { debit: d(o.held), credit: d("0") } } as any)
    vi.mocked(loadRules).mockResolvedValue(RULES)
    vi.mocked(resolveAccountCode).mockImplementation((rules: any, key: string) => rules.byKey.get(key))
  }

  it("releases everything held for a deal that is already fully invoiced", async () => {
    arrangeDealPosition({ basis: "1000000", invoiced: "1000000", held: "80000" })

    const total = await releaseLateCost(prisma as any, "bill-9", ["opp-1"], "admin-1")

    expect(total.toFixed(2)).toBe("80000.00")
    expect(postSystemJournal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: { module: "CUSTOMER", refId: "bill:bill-9", event: "COST_RELEASE" },
      lines: [
        { accountCode: "5121", debit: "80000.00", opportunityId: "opp-1" },
        { accountCode: "1214", credit: "80000.00", opportunityId: "opp-1" },
      ],
    }))
  })

  it("leaves a deal that is still being invoiced for its next invoice", async () => {
    arrangeDealPosition({ basis: "1000000", invoiced: "400000", held: "80000" })

    await releaseLateCost(prisma as any, "bill-9", ["opp-1"], "admin-1")

    expect(postSystemJournal).not.toHaveBeenCalled()
  })

  it("leaves a deal with no PO yet", async () => {
    arrangeDealPosition({ basis: "0", invoiced: "0", held: "80000" })

    await releaseLateCost(prisma as any, "bill-9", ["opp-1"], "admin-1")

    expect(postSystemJournal).not.toHaveBeenCalled()
  })
})
