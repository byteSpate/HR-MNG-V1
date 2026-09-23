import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierBill: { findUnique: vi.fn() },
    supplierCreditNote: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { createSupplierCreditNote } from "./supplierCreditNote.service"

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

  it("creates a DRAFT credit note against an approved bill", async () => {
    vi.mocked(prisma.supplierBill.findUnique).mockResolvedValue({ id: "b1", supplierId: "sup-1", status: "APPROVED" } as any)
    vi.mocked(prisma.supplierCreditNote.create).mockResolvedValue({ id: "cn1", status: "DRAFT" } as any)

    const result = await createSupplierCreditNote(INPUT, ACTOR)

    expect(prisma.supplierCreditNote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ billId: "b1", supplierId: "sup-1", reason: INPUT.reason }) })
    )
    expect(result).toEqual({ id: "cn1", status: "DRAFT" })
  })
})
