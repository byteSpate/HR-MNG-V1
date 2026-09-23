import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    earningEvent: { findUnique: vi.fn(), update: vi.fn() },
    customerPoLine: { findMany: vi.fn() },
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
vi.mock("./costRelease", () => ({ releaseCostForProgress: vi.fn() }))
vi.mock("./receivables.poStatus", () => ({ refreshPoStatus: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules } from "../posting/posting.rules"
import type { PostingEvent, ResolvedRules } from "../posting/posting.types"
import { postSystemJournal } from "../accounting/accounting.posting"
import { contractPosition, lockDeal } from "./receivables.position"
import { releaseCostForProgress } from "./costRelease"
import { refreshPoStatus } from "./receivables.poStatus"
import { approveEarningEvent, buildEarnedLines } from "./earningEvent.posting"

const d = (v: string) => new Prisma.Decimal(v)
const ADMIN = { sub: "admin-1", role: "SUPER_ADMIN", email: "a@b.com", mustChangePassword: false, salesRole: null } as any

function rulesOf(event: PostingEvent, map: Record<string, string>): ResolvedRules {
  return { event, byKey: new Map(Object.entries(map)) }
}
const EARNED_RULES = rulesOf("EARNED", { GOODS: "4130", SERVICE: "4120", UNBILLED: "1221", UNEARNED: "2170" })
const NO_POSITION = { unbilled: d("0"), unearned: d("0") }

describe("buildEarnedLines", () => {
  it("posts the spec's worked example, delivered before invoiced (§3.2 step 1)", () => {
    const lines = buildEarnedLines("opp-1", [{ amount: d("1000000"), kind: "GOODS" }], EARNED_RULES, NO_POSITION)
    expect(lines).toEqual([
      { accountCode: "1221", debit: "1000000.00", opportunityId: "opp-1" },
      { accountCode: "4130", credit: "1000000.00", opportunityId: "opp-1" },
    ])
  })

  it("uses up unearned first when the invoice came first", () => {
    const lines = buildEarnedLines("opp-1", [{ amount: d("1000000"), kind: "GOODS" }], EARNED_RULES, { unbilled: d("0"), unearned: d("1000000") })
    expect(lines[0]).toEqual({ accountCode: "2170", debit: "1000000.00", opportunityId: "opp-1" })
    expect(lines.map((l) => l.accountCode)).not.toContain("1221")
  })

  it("splits across both when only part of it was invoiced already", () => {
    const lines = buildEarnedLines("opp-1", [{ amount: d("1000000"), kind: "GOODS" }], EARNED_RULES, { unbilled: d("0"), unearned: d("600000") })
    expect(lines).toContainEqual({ accountCode: "2170", debit: "600000.00", opportunityId: "opp-1" })
    expect(lines).toContainEqual({ accountCode: "1221", debit: "400000.00", opportunityId: "opp-1" })
  })
})

function arrangeDraftEvent(over: { createdBy?: string; date?: Date; kind?: "DELIVERY" | "ACCEPTANCE"; lines?: Array<{ amount: Prisma.Decimal; kind: "GOODS" | "SERVICE" }> } = {}) {
  const lockHead = { po: { id: "po1", opportunityId: "opp-1" } }
  const lines = over.lines ?? [{ amount: d("1000000"), kind: "GOODS" as const }]
  const full = {
    id: "ev1", poId: "po1", status: "DRAFT", createdBy: over.createdBy ?? "finance-1",
    kind: over.kind ?? "DELIVERY", date: over.date ?? new Date("2026-09-22"), evidenceRef: "CH-118",
    po: { id: "po1", serial: "BS-CPO-00001", opportunityId: "opp-1" },
    lines: lines.map((l, i) => ({ poLineId: `pl${i + 1}`, amount: l.amount, quantity: d("1"), poLine: { id: `pl${i + 1}`, description: "Firewall", kind: l.kind } })),
  }
  vi.mocked(prisma.earningEvent.findUnique).mockResolvedValueOnce(lockHead as any).mockResolvedValueOnce(full as any)
  vi.mocked(prisma.earningEvent.update).mockResolvedValue({ id: "ev1" } as any)
  vi.mocked(prisma.customerPoLine.findMany).mockResolvedValue(
    full.lines.map((l) => ({ id: l.poLineId, description: l.poLine.description, amount: d("1000000"), quantity: d("1"), earningLines: [], monthlyEarnings: [] })) as any
  )
  vi.mocked(loadRules).mockResolvedValue(EARNED_RULES)
  vi.mocked(contractPosition).mockResolvedValue(NO_POSITION)
  vi.mocked(releaseCostForProgress).mockResolvedValue(d("0"))
  vi.mocked(refreshPoStatus).mockResolvedValue("OPEN")
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("approveEarningEvent", () => {
  it("refuses the person who recorded it", async () => {
    arrangeDraftEvent({ createdBy: ADMIN.sub })
    await expect(approveEarningEvent("ev1", ADMIN)).rejects.toThrow("You prepared this record and cannot also approve it")
    expect(postSystemJournal).not.toHaveBeenCalled()
  })

  it("locks the deal before reading anything it will decide on", async () => {
    arrangeDraftEvent({})
    await approveEarningEvent("ev1", ADMIN)
    expect(lockDeal).toHaveBeenCalledWith(expect.anything(), "opp-1")
  })

  it("releases the delivered share of held cost, on the delivery's date", async () => {
    arrangeDraftEvent({ date: new Date("2026-09-22"), lines: [{ amount: d("1000000"), kind: "GOODS" }] })
    await approveEarningEvent("ev1", ADMIN)
    expect(releaseCostForProgress).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      opportunityId: "opp-1", progressNow: d("1000000"), exclude: { eventId: "ev1" }, refId: "ev1", date: new Date("2026-09-22"),
    }))
  })

  it("posts EARNED, naming the kind and the evidence reference", async () => {
    arrangeDraftEvent({ kind: "DELIVERY" })
    await approveEarningEvent("ev1", ADMIN)
    expect(postSystemJournal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      narration: "Delivery CH-118 on BS-CPO-00001",
      source: { module: "CUSTOMER", refId: "ev1", event: "EARNED" },
    }))
  })

  it("refreshes the PO's status after posting", async () => {
    arrangeDraftEvent({})
    await approveEarningEvent("ev1", ADMIN)
    expect(refreshPoStatus).toHaveBeenCalledWith(expect.anything(), "po1")
    expect(prisma.auditLog.create).toHaveBeenCalled()
  })
})
