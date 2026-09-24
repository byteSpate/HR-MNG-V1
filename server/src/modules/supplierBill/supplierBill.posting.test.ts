import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierBill: { findUnique: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    auditLog: { create: vi.fn() },
    journal: { create: vi.fn() },
  },
}))
vi.mock("../receivables/costRelease", () => ({ releaseLateCost: vi.fn() }))
vi.mock("../posting/posting.rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../posting/posting.rules")>()),
  loadRules: vi.fn(),
}))
vi.mock("../accounting/accounting.posting", () => ({ postSystemJournal: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadRules } from "../posting/posting.rules"
import { releaseLateCost } from "../receivables/costRelease"
import { approveSupplierBill, buildSupplierBillLines } from "./supplierBill.posting"

const RULES = {
  event: "SUPPLIER_BILL" as const,
  byKey: new Map([
    ["GOODS", "1214"],
    ["SERVICE", "5129"],
    ["VAT", "1233"],
    ["PAYABLE", "2111"],
  ]),
}

const ADMIN = { sub: "admin-1", role: "SUPER_ADMIN", email: "a@b.com", mustChangePassword: false, salesRole: null } as any

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("buildSupplierBillLines", () => {
  it("debits 1214 for goods, credits 2111 for the gross total", () => {
    const bill = {
      id: "b1",
      supplierId: "sup-1",
      opportunityId: "opp-1",
      lines: [
        {
          id: "l1", kind: "GOODS" as const, amount: new Prisma.Decimal("800000"),
          vatAmount: new Prisma.Decimal("120000"),
        },
      ],
    }
    const lines = buildSupplierBillLines(bill, RULES)

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "1214", debit: "800000.00", opportunityId: "opp-1" }),
        expect.objectContaining({ accountCode: "1233", debit: "120000.00", opportunityId: "opp-1" }),
        expect.objectContaining({ accountCode: "2111", credit: "920000.00" }),
      ])
    )
  })

  it("debits 5129 for a service line", () => {
    const bill = {
      id: "b2",
      supplierId: "sup-1",
      opportunityId: "opp-2",
      lines: [
        {
          id: "l2", kind: "SERVICE" as const, amount: new Prisma.Decimal("50000"),
          vatAmount: new Prisma.Decimal("0"),
        },
      ],
    }
    const lines = buildSupplierBillLines(bill, RULES)

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "5129", debit: "50000.00", opportunityId: "opp-2" }),
        expect.objectContaining({ accountCode: "2111", credit: "50000.00" }),
      ])
    )
  })
})

describe("approveSupplierBill", () => {
  function arrangeDraftBill(over: { opportunityId: string; lines: Array<{ kind: "GOODS" | "SERVICE" }> }) {
    const bill = {
      id: "b1", supplierId: "sup-1", status: "DRAFT", createdBy: "finance-1", billNumber: "INV-1",
      opportunityId: over.opportunityId,
      lines: over.lines.map((l, i) => ({
        id: `l${i}`, kind: l.kind,
        amount: new Prisma.Decimal("1000"), vatAmount: new Prisma.Decimal("0"),
      })),
    }
    vi.mocked(prisma.supplierBill.findUnique).mockResolvedValue(bill as any)
    vi.mocked(prisma.supplierBill.update).mockResolvedValue(bill as any)
    vi.mocked(prisma.supplierBill.findUniqueOrThrow)
      .mockResolvedValueOnce(bill as any)
      .mockResolvedValueOnce({ billNumber: bill.billNumber, supplier: { name: "Star Tech" } } as any)
    vi.mocked(loadRules).mockResolvedValue(RULES)
  }

  it("offers the bill's deal to the late cost release when it has a goods line", async () => {
    arrangeDraftBill({
      opportunityId: "opp-1",
      lines: [{ kind: "GOODS" }, { kind: "GOODS" }, { kind: "SERVICE" }],
    })

    await approveSupplierBill("b1", ADMIN)

    expect(releaseLateCost).toHaveBeenCalledWith(expect.anything(), "b1", ["opp-1"], ADMIN.sub)
  })

  it("does not call the late cost release when the bill has no goods lines", async () => {
    arrangeDraftBill({ opportunityId: "opp-2", lines: [{ kind: "SERVICE" }] })

    await approveSupplierBill("b1", ADMIN)

    expect(releaseLateCost).not.toHaveBeenCalled()
  })
})
