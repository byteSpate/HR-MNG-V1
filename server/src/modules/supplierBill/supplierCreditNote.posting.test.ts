import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierCreditNote: { findUnique: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    supplierBillLine: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../posting/posting.rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../posting/posting.rules")>()),
  loadRules: vi.fn(),
}))
vi.mock("../accounting/accounting.posting", () => ({ postSystemJournal: vi.fn() }))
vi.mock("../receivables/costRelease", () => ({ heldGoodsCost: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules } from "../posting/posting.rules"
import { approveSupplierCreditNote, buildSupplierCreditNoteLines } from "./supplierCreditNote.posting"

const RULES = {
  event: "SUPPLIER_CREDIT" as const,
  byKey: new Map([
    ["PAYABLE", "2111"],
    ["GOODS", "1214"],
    ["DELIVERED", "5121"],
    ["SERVICE", "5129"],
    ["VAT", "1233"],
  ]),
}

const d = (v: string) => new Prisma.Decimal(v)
const ADMIN = { sub: "admin-1", role: "SUPER_ADMIN", email: "a@b.com", mustChangePassword: false, salesRole: null } as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("buildSupplierCreditNoteLines", () => {
  it("credits 1214 for a GOODS line and debits 2111 for the gross", () => {
    const note = { id: "cn1", supplierId: "sup-1", opportunityId: "opp-1", lines: [{ billLineId: "l1", amount: new Prisma.Decimal("160000"), vatAmount: new Prisma.Decimal("24000") }] }
    const billLines = [{ id: "l1", kind: "GOODS" as const }]

    const lines = buildSupplierCreditNoteLines(note, billLines, RULES, new Map([["opp-1", d("160000")]]))

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "2111", debit: "184000.00", supplierId: "sup-1" }),
        expect.objectContaining({ accountCode: "1214", credit: "160000.00", opportunityId: "opp-1" }),
        expect.objectContaining({ accountCode: "1233", credit: "24000.00", opportunityId: "opp-1" }),
      ])
    )
  })

  it("credits 5129 for a SERVICE line", () => {
    const note = { id: "cn2", supplierId: "sup-1", opportunityId: "opp-2", lines: [{ billLineId: "l2", amount: new Prisma.Decimal("30000"), vatAmount: new Prisma.Decimal("0") }] }
    const billLines = [{ id: "l2", kind: "SERVICE" as const }]

    const lines = buildSupplierCreditNoteLines(note, billLines, RULES, new Map())

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "5129", credit: "30000.00", opportunityId: "opp-2" }),
        expect.objectContaining({ accountCode: "2111", debit: "30000.00" }),
      ])
    )
  })

  it("credits 1214 up to what the deal still holds and 5121 for the rest", () => {
    const note = { id: "cn3", supplierId: "sup-1", opportunityId: "opp-1", lines: [{ billLineId: "l1", amount: d("150000"), vatAmount: d("0") }] }
    const billLines = [{ id: "l1", kind: "GOODS" as const }]

    const lines = buildSupplierCreditNoteLines(note, billLines, RULES, new Map([["opp-1", d("100000")]]))

    expect(lines).toContainEqual({ accountCode: "1214", credit: "100000.00", opportunityId: "opp-1" })
    expect(lines).toContainEqual({ accountCode: "5121", credit: "50000.00", opportunityId: "opp-1" })
  })

  it("credits 1214 only, as before, while the deal still holds enough", () => {
    const note = { id: "cn4", supplierId: "sup-1", opportunityId: "opp-1", lines: [{ billLineId: "l1", amount: d("40000"), vatAmount: d("0") }] }
    const billLines = [{ id: "l1", kind: "GOODS" as const }]

    const lines = buildSupplierCreditNoteLines(note, billLines, RULES, new Map([["opp-1", d("100000")]]))

    expect(lines.filter((l) => l.accountCode === "5121")).toEqual([])
  })

  it("decrements the held map across two lines on the same deal, in order", () => {
    const note = {
      id: "cn5", supplierId: "sup-1", opportunityId: "opp-1",
      lines: [
        { billLineId: "l1", amount: d("60000"), vatAmount: d("0") },
        { billLineId: "l2", amount: d("60000"), vatAmount: d("0") },
      ],
    }
    const billLines = [
      { id: "l1", kind: "GOODS" as const },
      { id: "l2", kind: "GOODS" as const },
    ]

    const lines = buildSupplierCreditNoteLines(note, billLines, RULES, new Map([["opp-1", d("100000")]]))

    const goodsLines = lines.filter((l) => l.accountCode === "1214")
    const deliveredLines = lines.filter((l) => l.accountCode === "5121")
    expect(goodsLines.reduce((s, l) => s + Number(l.credit), 0)).toBe(100000)
    expect(deliveredLines.reduce((s, l) => s + Number(l.credit), 0)).toBe(20000)
  })
})

function arrangeDraftNote(over: { createdBy?: string; rejectionNote?: string | null } = {}) {
  const note = {
    id: "cn1", supplierId: "sup-1", billId: "b1", status: "DRAFT",
    createdBy: over.createdBy ?? "finance-1", rejectionNote: over.rejectionNote ?? null,
  }
  const full = {
    id: "cn1", supplierId: "sup-1", billId: "b1",
    lines: [{ billLineId: "l1", amount: d("30000"), vatAmount: d("0") }],
    supplier: { name: "Star Tech" },
    bill: { billNumber: "INV-1", opportunityId: "opp-1" },
  }
  vi.mocked(prisma.supplierCreditNote.findUnique).mockResolvedValue(note as any)
  vi.mocked(prisma.supplierCreditNote.update).mockResolvedValue(note as any)
  vi.mocked(prisma.supplierCreditNote.findUniqueOrThrow).mockResolvedValue(full as any)
  vi.mocked(prisma.supplierBillLine.findMany).mockResolvedValue([{ id: "l1", kind: "SERVICE" }] as any)
  vi.mocked(loadRules).mockResolvedValue(RULES)
}

describe("approveSupplierCreditNote", () => {
  it("refuses the person who prepared it", async () => {
    arrangeDraftNote({ createdBy: ADMIN.sub })
    await expect(approveSupplierCreditNote("cn1", ADMIN)).rejects.toThrow(
      "You prepared this credit note, so someone else must approve it."
    )
  })

  it("refuses to approve a draft that was sent back and not saved again", async () => {
    arrangeDraftNote({ rejectionNote: "Wrong amount" })
    await expect(approveSupplierCreditNote("cn1", ADMIN)).rejects.toThrow(
      "This was sent back. The person who prepared it must save it again first."
    )
  })
})
