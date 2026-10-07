import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: { supplierPayment: { findUnique: vi.fn() } },
}))
vi.mock("../../utils/actors", () => ({ resolveActors: vi.fn() }))
vi.mock("../../utils/pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/pdf")>()),
  renderPdf: vi.fn(),
  brandAsset: vi.fn(),
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { resolveActors } from "../../utils/actors"
import { brandAsset, renderPdf } from "../../utils/pdf"
import { renderSupplierPaymentPdf } from "./supplierPayment.pdf"

const d = (v: string) => new Prisma.Decimal(v)

const ROW = {
  id: "p1", number: "PV-0007", date: new Date("2026-11-10"),
  amount: d("1000"), sourceAmount: null, currency: "BDT", fxRateToBdt: null, reference: null,
  paymentMethod: "CHEQUE", bankName: null, status: "APPROVED", reversedAt: null, reversalReason: null,
  createdBy: "u-f",
  supplier: { name: "Star Tech" },
  opportunity: { serial: "BS-OPP-00001", name: "Core banking" },
  allocations: [{
    amount: d("1000"), amountUsd: null, billTotal: d("1000"), balanceAfter: d("0"), billTotalUsd: null, balanceAfterUsd: null,
    bill: { billNumber: "SUP-INV-1", currency: "BDT" },
  }],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.supplierPayment.findUnique).mockResolvedValue(ROW as any)
  vi.mocked(resolveActors).mockResolvedValue({ "u-f": { id: "u-f", email: "f@b.co", fullName: "Rina Akter" } })
  vi.mocked(brandAsset).mockResolvedValue(null)
  vi.mocked(renderPdf).mockResolvedValue(Buffer.from("%PDF-1.4"))
})

describe("renderSupplierPaymentPdf", () => {
  it("says Supplier payment not found for an unknown id", async () => {
    vi.mocked(prisma.supplierPayment.findUnique).mockResolvedValue(null)

    await expect(renderSupplierPaymentPdf("nope")).rejects.toMatchObject({ statusCode: 404, message: "Supplier payment not found" })
    expect(renderPdf).not.toHaveBeenCalled()
  })

  it("returns the PDF and the voucher number, and prints the name of who recorded it", async () => {
    const out = await renderSupplierPaymentPdf("p1")

    expect(out.number).toBe("PV-0007")
    expect(out.pdf).toEqual(Buffer.from("%PDF-1.4"))
    expect(vi.mocked(renderPdf).mock.calls[0][0]).toContain("Rina Akter")
  })

  it("prints no name when the account that recorded it is gone", async () => {
    vi.mocked(resolveActors).mockResolvedValue({})

    await renderSupplierPaymentPdf("p1")

    expect(vi.mocked(renderPdf).mock.calls[0][0]).not.toContain("Recorded by")
  })
})
