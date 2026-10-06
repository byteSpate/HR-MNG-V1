import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: { receipt: { findUnique: vi.fn() } },
}))
vi.mock("./receivables.access", () => ({ assertDealAccess: vi.fn() }))
vi.mock("../../utils/actors", () => ({ resolveActors: vi.fn() }))
vi.mock("../../utils/pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/pdf")>()),
  renderPdf: vi.fn(),
  brandAsset: vi.fn(),
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { resolveActors } from "../../utils/actors"
import { brandAsset, renderPdf } from "../../utils/pdf"
import { assertDealAccess } from "./receivables.access"
import { renderReceiptPdf } from "./receipt.pdf"

const d = (v: string) => new Prisma.Decimal(v)
const SALES = { sub: "u-s", role: "EMPLOYEE", salesRole: "SALES_USER", email: "s@b.co", mustChangePassword: false } as any

const RECEIPT_ROW = {
  id: "r1", number: "MR-0007", date: new Date("2026-11-10"), createdAt: new Date("2026-11-10T09:00:00Z"),
  amount: d("1000"), vdsAmount: d("0"), aitAmount: d("0"), reference: null,
  paymentMethod: "CASH", bankName: null, status: "APPROVED", reversedAt: null, reversalReason: null,
  createdBy: "u-f", opportunityId: "opp-1",
  customer: { legalName: "Bengal Group" },
  opportunity: { serial: "BS-OPP-00001", name: "Core banking" },
  allocations: [
    {
      amount: d("1000"),
      invoice: {
        invoiceNumber: "INV-1",
        lines: [{ amount: d("1000"), vatAmount: d("0") }],
        creditNotes: [],
        allocations: [{ amount: d("1000"), receipt: { id: "r1", createdAt: new Date("2026-11-10T09:00:00Z"), status: "APPROVED" } }],
      },
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.receipt.findUnique).mockResolvedValue(RECEIPT_ROW as any)
  vi.mocked(assertDealAccess).mockResolvedValue({ id: "opp-1" } as any)
  vi.mocked(resolveActors).mockResolvedValue({ "u-f": { id: "u-f", email: "f@b.co", fullName: "Rina Akter" } })
  vi.mocked(brandAsset).mockResolvedValue(null)
  vi.mocked(renderPdf).mockResolvedValue(Buffer.from("%PDF-1.4"))
})

describe("renderReceiptPdf", () => {
  it("checks access to the receipt's Opportunity before it renders anything", async () => {
    await renderReceiptPdf("r1", SALES)

    expect(assertDealAccess).toHaveBeenCalledWith(prisma, SALES, "opp-1")
  })

  it("refuses a Sales user who cannot see the Opportunity, and renders nothing", async () => {
    vi.mocked(assertDealAccess).mockRejectedValue(new AppError(403, "You do not have access to this Opportunity"))

    await expect(renderReceiptPdf("r1", SALES)).rejects.toMatchObject({ statusCode: 403 })

    expect(renderPdf).not.toHaveBeenCalled()
  })

  it("says Receipt not found for an unknown id", async () => {
    vi.mocked(prisma.receipt.findUnique).mockResolvedValue(null)

    await expect(renderReceiptPdf("nope", SALES)).rejects.toMatchObject({ statusCode: 404, message: "Receipt not found" })

    expect(assertDealAccess).not.toHaveBeenCalled()
  })

  it("returns the PDF and the receipt number, and prints the name of who recorded it", async () => {
    const out = await renderReceiptPdf("r1", SALES)

    expect(out.number).toBe("MR-0007")
    expect(out.pdf).toEqual(Buffer.from("%PDF-1.4"))
    expect(vi.mocked(renderPdf).mock.calls[0][0]).toContain("Rina Akter")
  })

  it("prints no name when the account that recorded it is gone", async () => {
    vi.mocked(resolveActors).mockResolvedValue({})

    await renderReceiptPdf("r1", SALES)

    expect(vi.mocked(renderPdf).mock.calls[0][0]).not.toContain("Recorded by")
  })
})
