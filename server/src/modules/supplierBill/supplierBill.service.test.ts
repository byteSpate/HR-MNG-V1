import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/env", () => ({ env: { SALES_GO_LIVE: "2026-11-01" } }))
vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierBill: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    supplierBillLine: { deleteMany: vi.fn() },
    vatCode: { findMany: vi.fn() },
    opportunity: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../payroll/payroll.fx", () => ({
  resolveRateOrThrow: vi.fn().mockResolvedValue({ toFixed: () => "122.500000" }),
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { createSupplierBill, getSupplierBill, updateSupplierBill } from "./supplierBill.service"

const ACTOR = { sub: "u1", role: "FINANCE_OFFICER", email: "f@byte.spate", mustChangePassword: false, salesRole: null } as any

const INPUT = {
  supplierId: "sup-1",
  billNumber: "INV-2201",
  date: "2026-10-05",
  dueDate: "2026-11-04",
  currency: "BDT" as const,
  opportunityId: "opp-1",
  lines: [
    { description: "Firewalls", kind: "GOODS" as const, amount: "800000", vatCodeId: "vat-std" },
  ],
}

// The one deal a bill names must exist, be Won, and have been Won on or
// after go-live before anything on the bill can be created or updated.
function arrangeWonDeal(opp: { id: string; serial: string; closedAt?: Date }) {
  vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({
    id: opp.id, status: "WON", serial: opp.serial, closedAt: opp.closedAt ?? new Date("2026-11-10"),
  } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.vatCode.findMany).mockResolvedValue([{ id: "vat-std", ratePercent: "15.00" }] as any)
  arrangeWonDeal({ id: "opp-1", serial: "BS-OPP-00001" })
})

describe("bill and deals", () => {
  it("refuses a bill tagged to a deal that is not Won", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({ id: "opp-1", status: "ONGOING", serial: "BS-OPP-00001", closedAt: null } as any)
    await expect(createSupplierBill(INPUT, ACTOR)).rejects.toThrow("BS-OPP-00001 is not won yet. Money can be recorded only on a won deal.")
  })

  it("refuses a bill tagged to a deal Won before go-live", async () => {
    arrangeWonDeal({ id: "opp-1", serial: "BS-OPP-00001", closedAt: new Date("2026-10-20") })
    await expect(createSupplierBill(INPUT, ACTOR)).rejects.toThrow(
      "BS-OPP-00001 was won before this app started (2026-11-01), so its money is not recorded here."
    )
  })

  it("refuses a bill tagged to a deal that does not exist", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue(null)
    await expect(createSupplierBill(INPUT, ACTOR)).rejects.toThrow("A bill names a deal that does not exist")
  })
})

describe("createSupplierBill", () => {
  it("creates a DRAFT bill with its lines in one transaction", async () => {
    vi.mocked(prisma.supplierBill.create).mockResolvedValue({ id: "b1", status: "DRAFT" } as any)

    const result = await createSupplierBill(INPUT, ACTOR)

    expect(prisma.supplierBill.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierId: "sup-1",
          billNumber: "INV-2201",
          status: "DRAFT",
          lines: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ description: "Firewalls", amount: "800000" }),
            ]),
          }),
        }),
      })
    )
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: "SUPPLIER_BILL", action: "CREATE" }) })
    )
    expect(result).toEqual({ id: "b1", status: "DRAFT" })
  })

  it("puts the deal on the bill, not on each line", async () => {
    arrangeWonDeal({ id: "opp-1", serial: "BS-OPP-00001" })
    vi.mocked(prisma.supplierBill.create).mockResolvedValue({ id: "b1", status: "DRAFT" } as any)

    await createSupplierBill(
      {
        ...INPUT,
        opportunityId: "opp-1",
        lines: [{ description: "Firewall", kind: "GOODS", amount: "800000", vatCodeId: "vat-std" }],
      } as any,
      ACTOR
    )

    expect(prisma.supplierBill.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ opportunityId: "opp-1" }) })
    )
    expect(prisma.supplierBill.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: expect.objectContaining({
            create: expect.arrayContaining([expect.not.objectContaining({ opportunityId: expect.anything() })]),
          }),
        }),
      })
    )
  })
})

describe("createSupplierBill VAT", () => {
  it("freezes each line's VAT from its VAT code's rate", async () => {
    vi.mocked(prisma.supplierBill.create).mockResolvedValue({ id: "b1" } as any)

    await createSupplierBill(INPUT, ACTOR)

    expect(prisma.supplierBill.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: { create: [expect.objectContaining({ amount: "800000", vatAmount: "120000.00" })] },
        }),
      })
    )
  })

  it("refuses a VAT code that does not exist or is inactive", async () => {
    vi.mocked(prisma.vatCode.findMany).mockResolvedValue([])
    await expect(createSupplierBill(INPUT, ACTOR)).rejects.toThrow("Unknown or inactive VAT code")
  })
})

describe("getSupplierBill", () => {
  it("throws 404 when missing", async () => {
    vi.mocked(prisma.supplierBill.findUnique).mockResolvedValue(null)
    await expect(getSupplierBill("missing")).rejects.toThrow(AppError)
  })
})

describe("updateSupplierBill", () => {
  it("refuses once the bill is no longer DRAFT", async () => {
    vi.mocked(prisma.supplierBill.findUnique).mockResolvedValue({ id: "b1", status: "APPROVED" } as any)
    await expect(updateSupplierBill("b1", INPUT, ACTOR)).rejects.toThrow(
      "Only a draft bill can be edited"
    )
  })

  it("clears the sent-back note when the draft is saved again", async () => {
    vi.mocked(prisma.supplierBill.findUnique).mockResolvedValue({ id: "b1", status: "DRAFT", rejectionNote: "Wrong amount", billNumber: "INV-2201" } as any)
    vi.mocked(prisma.supplierBill.update).mockResolvedValue({ id: "b1", billNumber: "INV-2201" } as any)
    await updateSupplierBill("b1", INPUT, ACTOR)
    expect(prisma.supplierBill.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ rejectionNote: null, sentBackBy: null, sentBackAt: null }),
    }))
  })
})
