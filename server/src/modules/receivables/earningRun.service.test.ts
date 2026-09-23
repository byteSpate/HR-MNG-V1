import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    earningRun: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    customerPoLine: { findMany: vi.fn() },
    journal: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../accounting/accounting.posting", () => ({ postSystemJournal: vi.fn() }))
vi.mock("../accounting/accounting.period.service", () => ({ resolveOpenPeriod: vi.fn() }))
vi.mock("../accounting/accounting.reversal", () => ({ draftReversal: vi.fn() }))
vi.mock("../posting/posting.rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../posting/posting.rules")>()),
  loadRules: vi.fn(),
}))
vi.mock("./receivables.position", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./receivables.position")>()),
  lockDeals: vi.fn(),
  contractPosition: vi.fn(),
}))
vi.mock("./costRelease", () => ({ releaseCostForProgress: vi.fn() }))
vi.mock("./receivables.poStatus", () => ({ refreshPoStatus: vi.fn() }))
vi.mock("../depreciation/depreciation.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../depreciation/depreciation.service")>()),
  fyForMonth: vi.fn(),
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { postSystemJournal } from "../accounting/accounting.posting"
import { draftReversal } from "../accounting/accounting.reversal"
import { loadRules } from "../posting/posting.rules"
import type { PostingEvent, ResolvedRules } from "../posting/posting.types"
import { contractPosition, lockDeals } from "./receivables.position"
import { releaseCostForProgress } from "./costRelease"
import { refreshPoStatus } from "./receivables.poStatus"
import { fyForMonth } from "../depreciation/depreciation.service"
import {
  deleteEarningRun,
  draftEarningRun,
  postEarningRun,
  reverseEarningRun,
} from "./earningRun.service"

const d = (v: string) => new Prisma.Decimal(v)
const ADMIN = { sub: "admin-1", role: "SUPER_ADMIN", email: "a@b.com", mustChangePassword: false, salesRole: null } as any

function rulesOf(event: PostingEvent, map: Record<string, string>): ResolvedRules {
  return { event, byKey: new Map(Object.entries(map)) }
}
const EARNED_RULES = rulesOf("EARNED", { GOODS: "4130", SERVICE: "4120", UNBILLED: "1221", UNEARNED: "2170" })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(loadRules).mockResolvedValue(EARNED_RULES)
  vi.mocked(fyForMonth).mockResolvedValue({ startDate: new Date("2026-07-01") } as any)
  vi.mocked(releaseCostForProgress).mockResolvedValue(d("0"))
  vi.mocked(refreshPoStatus).mockResolvedValue("OPEN")
})

describe("draftEarningRun", () => {
  it("refuses a month that already has a run", async () => {
    vi.mocked(prisma.earningRun.findUnique).mockResolvedValue({ id: "run-1", runNo: "BS-ER-2026-09", status: "POSTED" } as any)
    await expect(draftEarningRun({ year: 2026, month: 9 }, ADMIN)).rejects.toThrow(
      "September 2026 already has an earnings run (BS-ER-2026-09, posted). Reversing it frees the month."
    )
  })

  it("refuses a month no financial year covers", async () => {
    vi.mocked(prisma.earningRun.findUnique).mockResolvedValue(null)
    vi.mocked(fyForMonth).mockResolvedValue(null)
    await expect(draftEarningRun({ year: 2026, month: 9 }, ADMIN)).rejects.toThrow("No financial year covers September 2026. Create one first.")
  })

  it("stores only non-zero charges", async () => {
    vi.mocked(prisma.earningRun.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.customerPoLine.findMany).mockResolvedValue([
      { id: "pl1", amount: d("365000"), contractStart: new Date("2026-01-01"), contractEnd: new Date("2026-12-31"), monthlyEarnings: [] },
      { id: "pl2", amount: d("100000"), contractStart: new Date("2026-01-01"), contractEnd: new Date("2026-01-31"), monthlyEarnings: [{ amount: d("100000") }] },
    ] as any)
    vi.mocked(prisma.earningRun.create).mockResolvedValue({ id: "run-1", runNo: "BS-ER-2026-01", charges: [] } as any)

    await draftEarningRun({ year: 2026, month: 1 }, ADMIN)

    expect(prisma.earningRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        runNo: "BS-ER-2026-01",
        charges: { create: [expect.objectContaining({ poLineId: "pl1" })] },
      }),
    }))
  })
})

function arrangeDraftRun(charges: Array<{ poLineId: string; amount: Prisma.Decimal; kind: "GOODS" | "SERVICE"; poId: string; opportunityId: string }>) {
  const run = {
    id: "run-1", runNo: "BS-ER-2026-09", year: 2026, month: 9, status: "DRAFT", journalId: null,
    charges: charges.map((c) => ({
      poLineId: c.poLineId, amount: c.amount,
      poLine: { id: c.poLineId, kind: c.kind, po: { id: c.poId, opportunityId: c.opportunityId } },
    })),
  }
  vi.mocked(prisma.earningRun.findUnique).mockResolvedValue(run as any)
  vi.mocked(prisma.earningRun.update).mockResolvedValue({ id: "run-1" } as any)
  vi.mocked(postSystemJournal).mockResolvedValue({ id: "j1", journalNo: "BS-JV-00099" } as any)
  vi.mocked(contractPosition).mockResolvedValue({ unbilled: d("0"), unearned: d("0") })
}

describe("postEarningRun", () => {
  it("refuses a run with no charges", async () => {
    arrangeDraftRun([])
    await expect(postEarningRun("run-1", ADMIN)).rejects.toThrow("BS-ER-2026-09 has nothing to post. Delete the draft instead.")
    expect(postSystemJournal).not.toHaveBeenCalled()
  })

  it("locks deals in ascending order before reading any position", async () => {
    arrangeDraftRun([
      { poLineId: "pl1", amount: d("10000"), kind: "SERVICE", poId: "poB", opportunityId: "opp-b" },
      { poLineId: "pl2", amount: d("20000"), kind: "SERVICE", poId: "poA", opportunityId: "opp-a" },
    ])
    await postEarningRun("run-1", ADMIN)
    expect(lockDeals).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(["opp-a", "opp-b"]))
    expect(vi.mocked(lockDeals).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(contractPosition).mock.invocationCallOrder[0])
  })

  it("writes one EARNED journal whose lines split each deal against that deal's own position", async () => {
    arrangeDraftRun([
      { poLineId: "pl1", amount: d("10000"), kind: "SERVICE", poId: "poA", opportunityId: "opp-a" },
      { poLineId: "pl2", amount: d("20000"), kind: "SERVICE", poId: "poB", opportunityId: "opp-b" },
    ])
    vi.mocked(contractPosition).mockImplementation(async (_tx: any, opportunityId: string) =>
      opportunityId === "opp-b" ? { unbilled: d("0"), unearned: d("20000") } : { unbilled: d("0"), unearned: d("0") }
    )

    await postEarningRun("run-1", ADMIN)

    expect(postSystemJournal).toHaveBeenCalledTimes(1)
    const call = vi.mocked(postSystemJournal).mock.calls[0][1]
    expect(call.source).toEqual({ module: "CUSTOMER", refId: "run-1", event: "EARNED:2026-09" })
    expect(call.narration).toBe("Monthly contract earnings, September 2026")
    expect(call.lines).toContainEqual({ accountCode: "1221", debit: "10000.00", opportunityId: "opp-a" })
    expect(call.lines).toContainEqual({ accountCode: "2170", debit: "20000.00", opportunityId: "opp-b" })
  })

  it("releases each deal's share of held cost and refreshes every PO touched", async () => {
    arrangeDraftRun([{ poLineId: "pl1", amount: d("10000"), kind: "SERVICE", poId: "poA", opportunityId: "opp-a" }])
    await postEarningRun("run-1", ADMIN)
    expect(releaseCostForProgress).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      opportunityId: "opp-a", progressNow: d("10000"), exclude: { runId: "run-1" },
    }))
    expect(refreshPoStatus).toHaveBeenCalledWith(expect.anything(), "poA")
  })

  it("refuses a run that is not a draft", async () => {
    arrangeDraftRun([{ poLineId: "pl1", amount: d("10000"), kind: "SERVICE", poId: "poA", opportunityId: "opp-a" }])
    vi.mocked(prisma.earningRun.findUnique).mockResolvedValue({
      id: "run-1", runNo: "BS-ER-2026-09", year: 2026, month: 9, status: "POSTED", journalId: "j1", charges: [],
    } as any)
    await expect(postEarningRun("run-1", ADMIN)).rejects.toThrow(/BS-ER-2026-09 is POSTED/)
  })
})

describe("reverseEarningRun", () => {
  it("requires a reason", async () => {
    await expect(reverseEarningRun("run-1", { reason: "" }, ADMIN)).rejects.toThrow("Give a reason for the reversal")
    expect(draftReversal).not.toHaveBeenCalled()
  })

  it("refuses a draft run", async () => {
    vi.mocked(prisma.earningRun.findUnique).mockResolvedValue({ id: "run-1", runNo: "BS-ER-2026-09", status: "DRAFT", journalId: null } as any)
    await expect(reverseEarningRun("run-1", { reason: "Wrong month" }, ADMIN)).rejects.toThrow(
      /BS-ER-2026-09 is draft; only a POSTED run with a journal can be reversed\./
    )
  })

  it("drafts reversals for the earnings journal and its cost-release journal", async () => {
    vi.mocked(prisma.earningRun.findUnique).mockResolvedValue({ id: "run-1", runNo: "BS-ER-2026-09", status: "POSTED", journalId: "j1" } as any)
    vi.mocked(prisma.journal.findMany).mockResolvedValue([{ id: "j2" }] as any)
    vi.mocked(draftReversal).mockResolvedValue({ id: "rev1", journalNo: "BS-JV-00100" } as any)
    vi.mocked(prisma.earningRun.update).mockResolvedValue({ id: "run-1" } as any)

    await reverseEarningRun("run-1", { reason: "Wrong contract dates" }, ADMIN)

    expect(draftReversal).toHaveBeenCalledWith(expect.anything(), "j1", "Wrong contract dates", ADMIN.sub)
    expect(draftReversal).toHaveBeenCalledWith(expect.anything(), "j2", "Wrong contract dates", ADMIN.sub)
    expect(prisma.earningRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-1" }, data: expect.objectContaining({ status: "REVERSED" }),
    }))
  })
})

describe("deleteEarningRun", () => {
  it("refuses a posted run", async () => {
    vi.mocked(prisma.earningRun.findUnique).mockResolvedValue({ id: "run-1", runNo: "BS-ER-2026-09", status: "POSTED" } as any)
    await expect(deleteEarningRun("run-1", ADMIN)).rejects.toThrow(/BS-ER-2026-09 is posted/)
    expect(prisma.earningRun.delete).not.toHaveBeenCalled()
  })
})
