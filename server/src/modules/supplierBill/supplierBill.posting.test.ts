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

  it("tags every deal line of the journal with the bill's deal", () => {
    const bill = {
      id: "b3",
      supplierId: "sup-1",
      opportunityId: "opp-1",
      lines: [
        { id: "l1", kind: "GOODS" as const, amount: new Prisma.Decimal("800000"), vatAmount: new Prisma.Decimal("120000") },
        { id: "l2", kind: "SERVICE" as const, amount: new Prisma.Decimal("50000"), vatAmount: new Prisma.Decimal("0") },
      ],
    }
    const lines = buildSupplierBillLines(bill, RULES)

    expect(lines.filter((l) => l.accountCode !== "2111").every((l) => l.opportunityId === "opp-1")).toBe(true)
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
  function arrangeDraftBill(over: {
    opportunityId: string
    lines: Array<{ kind: "GOODS" | "SERVICE" }>
    createdBy?: string
    updatedBy?: string | null
    rejectionNote?: string | null
  }) {
    const bill = {
      id: "b1", supplierId: "sup-1", status: "DRAFT", createdBy: over.createdBy ?? "finance-1", billNumber: "INV-1",
      updatedBy: over.updatedBy ?? null,
      rejectionNote: over.rejectionNote ?? null,
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

  it("refuses the person who prepared it", async () => {
    arrangeDraftBill({ opportunityId: "opp-1", lines: [{ kind: "SERVICE" }], createdBy: ADMIN.sub })
    await expect(approveSupplierBill("b1", ADMIN)).rejects.toThrow("You prepared this bill, so someone else must approve it.")
  })

  it("refuses a Super Admin who edited someone else's draft (final review Fix 1)", async () => {
    // Prepared by finance-1, then edited and saved by this Super Admin.
    arrangeDraftBill({ opportunityId: "opp-1", lines: [{ kind: "SERVICE" }], createdBy: "finance-1", updatedBy: ADMIN.sub })
    await expect(approveSupplierBill("b1", ADMIN)).rejects.toThrow("You edited this bill, so someone else must approve it.")
    expect(prisma.supplierBill.update).not.toHaveBeenCalled()
  })

  it("lets a Super Admin approve a draft its preparer saved again", async () => {
    arrangeDraftBill({ opportunityId: "opp-1", lines: [{ kind: "SERVICE" }], createdBy: "finance-1", updatedBy: "finance-1" })
    await approveSupplierBill("b1", ADMIN)
    expect(prisma.supplierBill.update).toHaveBeenCalled()
  })

  it("refuses to approve a draft that was sent back and not saved again", async () => {
    arrangeDraftBill({ opportunityId: "opp-1", lines: [{ kind: "SERVICE" }], rejectionNote: "Wrong amount" })
    await expect(approveSupplierBill("b1", ADMIN)).rejects.toThrow(
      "This was sent back. The person who prepared it must save it again first."
    )
  })
})
