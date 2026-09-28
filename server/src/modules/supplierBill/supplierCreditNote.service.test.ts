import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierBill: { findUnique: vi.fn() },
    supplierCreditNote: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { createSupplierCreditNote } from "./supplierCreditNote.service"

const APPROVED_BILL = {
  id: "b1", supplierId: "sup-1", status: "APPROVED",
  lines: [{
    id: "l1", description: "Firewalls", amount: new Prisma.Decimal("800000"), vatAmount: new Prisma.Decimal("120000"),
    creditNoteLines: [],
  }],
}

const ACTOR = { sub: "u1", role: "FINANCE_OFFICER", email: "f@byte.spate", mustChangePassword: false, salesRole: null } as any
const INPUT = { billId: "b1", date: "2026-10-20", reason: "Two firewalls returned, faulty", lines: [{ billLineId: "l1", amount: "160000", vatAmount: "24000" }] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("createSupplierCreditNote", () => {
  it("refuses against a bill that is not approved", async () => {
    vi.mocked(prisma.supplierBill.findUnique).mockResolvedValue({ id: "b1", supplierId: "sup-1", status: "DRAFT" } as any)
    await expect(createSupplierCreditNote(INPUT, ACTOR)).rejects.toThrow(AppError)
  })

  it("refuses a line that does not belong to this bill", async () => {
    vi.mocked(prisma.supplierBill.findUnique).mockResolvedValue({ ...APPROVED_BILL, lines: [] } as any)
    await expect(createSupplierCreditNote(INPUT, ACTOR)).rejects.toThrow("is not a line on this bill")
  })

  it("refuses crediting more than is left on a line after earlier credit notes", async () => {
    vi.mocked(prisma.supplierBill.findUnique).mockResolvedValue({
      ...APPROVED_BILL,
      lines: [{
        id: "l1", description: "Firewalls", amount: new Prisma.Decimal("800000"), vatAmount: new Prisma.Decimal("120000"),
        creditNoteLines: [{ amount: new Prisma.Decimal("700000"), vatAmount: new Prisma.Decimal("105000") }],
      }],
    } as any)
    await expect(createSupplierCreditNote(INPUT, ACTOR)).rejects.toThrow("Only 100000.00 is left to credit on Firewalls")
  })

  it("creates a DRAFT credit note against an approved bill", async () => {
    vi.mocked(prisma.supplierBill.findUnique).mockResolvedValue(APPROVED_BILL as any)
    vi.mocked(prisma.supplierCreditNote.create).mockResolvedValue({ id: "cn1", status: "DRAFT" } as any)

    const result = await createSupplierCreditNote(INPUT, ACTOR)

    expect(prisma.supplierCreditNote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ billId: "b1", supplierId: "sup-1", reason: INPUT.reason }) })
    )
    expect(result).toEqual({ id: "cn1", status: "DRAFT" })
  })
})
