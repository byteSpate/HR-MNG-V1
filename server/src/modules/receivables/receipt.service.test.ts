import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    customer: { findUnique: vi.fn() },
    receipt: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("./receipt.allocation", () => ({ assertReceivable: vi.fn(), assertOpeningReceivable: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { assertOpeningReceivable, assertReceivable } from "./receipt.allocation"
import { createReceipt, listReceipts, receiptPosition, updateReceiptCertificates } from "./receipt.service"

const d = (v: string) => new Prisma.Decimal(v)
const FINANCE = { sub: "u-f", role: "FINANCE_OFFICER", salesRole: null, email: "f@b.co", mustChangePassword: false } as any

const BASE = {
  customerId: "c1", date: "2026-09-23", amount: "950000", vdsAmount: "150000", aitAmount: "50000",
  allocations: [{ invoiceId: "inv1", amount: "1150000" }],
} as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.customer.findUnique).mockResolvedValue({ id: "c1", legalName: "Bengal Group" } as any)
})

describe("createReceipt", () => {
  it("records the spec's worked receipt: 9,50,000 cash and 2,00,000 withheld, settling an 11,50,000 invoice", async () => {
    vi.mocked(prisma.receipt.create).mockResolvedValue({ id: "r1" } as any)

    await createReceipt(BASE, FINANCE)

    expect(assertReceivable).toHaveBeenCalledWith(expect.anything(), "c1", [{ invoiceId: "inv1", amount: d("1150000") }])
    expect(prisma.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        amount: "950000.00", vdsAmount: "150000.00", aitAmount: "50000.00", createdBy: FINANCE.sub,
        allocations: { create: [{ invoiceId: "inv1", amount: "1150000.00" }] },
      }),
    }))
  })

  it("refuses allocations above cash plus tax withheld", async () => {
    await expect(createReceipt({ ...BASE, allocations: [{ invoiceId: "inv1", amount: "1150000.01" }] }, FINANCE))
      .rejects.toThrow("Allocations cannot add up to more than this receipt settles, 1150000.00 with the tax withheld")
  })

  it("refuses tax withheld that is not allocated to an invoice", async () => {
    await expect(createReceipt({ ...BASE, allocations: [{ invoiceId: "inv1", amount: "100000" }] }, FINANCE))
      .rejects.toThrow("Tax withheld is always withheld from an invoice. Allocate at least 200000.00 of this receipt to invoices or the opening balance.")
  })

  it("keeps what is not allocated as an advance", async () => {
    vi.mocked(prisma.receipt.create).mockResolvedValue({ id: "r2" } as any)
    await createReceipt({ customerId: "c1", date: "2026-09-23", amount: "300000", allocations: [] } as any, FINANCE)
    expect(receiptPosition({ amount: d("300000"), vdsAmount: d("0"), aitAmount: d("0"), allocations: [], openingAllocations: [] }).advance.toFixed(2)).toBe("300000.00")
  })

  it("settles the opening balance rather than making an advance", async () => {
    vi.mocked(assertOpeningReceivable).mockResolvedValue({ openingBalanceId: "ob1" })
    vi.mocked(prisma.receipt.create).mockResolvedValue({ id: "r3" } as any)
    await createReceipt({ customerId: "c1", date: "2026-09-23", amount: "200000", allocations: [], openingAllocation: { amount: "200000" } } as any, FINANCE)
    expect(prisma.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ openingAllocations: { create: [{ openingBalanceId: "ob1", amount: "200000.00" }] } }),
    }))
  })

  it("refuses a certificate reference without its date, and the reverse", async () => {
    await expect(createReceipt({ ...BASE, vdsCertificateRef: "VDS-1" }, FINANCE))
      .rejects.toThrow("Give the VDS certificate's number and date together")
  })

  it("refuses a VDS certificate on a receipt with no VAT withheld", async () => {
    await expect(createReceipt({ ...BASE, vdsAmount: "0", vdsCertificateRef: "VDS-1", vdsCertificateDate: "2026-09-24" }, FINANCE))
      .rejects.toThrow("This receipt has no VAT withheld, so it has no VDS certificate")
  })
})

describe("listReceipts", () => {
  it("lists approved receipts whose tax withheld has no certificate yet", async () => {
    await listReceipts({ certificates: "missing" })
    expect(prisma.receipt.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: "APPROVED",
        OR: [
          { vdsAmount: { gt: 0 }, vdsCertificateRef: null },
          { aitAmount: { gt: 0 }, aitCertificateRef: null },
        ],
      },
    }))
  })
})

describe("updateReceiptCertificates", () => {
  it("records a certificate on an approved receipt, and audits it", async () => {
    vi.mocked(prisma.receipt.findUnique).mockResolvedValue({
      id: "r1", status: "APPROVED", vdsAmount: d("150000"), aitAmount: d("0"),
      vdsCertificateRef: null, vdsCertificateDate: null, aitCertificateRef: null, aitCertificateDate: null,
    } as any)

    await updateReceiptCertificates("r1", { vdsCertificateRef: "M6.6-0192", vdsCertificateDate: "2026-09-25" } as any, FINANCE)

    expect(prisma.receipt.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "r1" },
      data: { vdsCertificateRef: "M6.6-0192", vdsCertificateDate: new Date("2026-09-25") },
    }))
    expect(prisma.auditLog.create).toHaveBeenCalled()
  })

  it("refuses an AIT certificate where no income tax was withheld", async () => {
    vi.mocked(prisma.receipt.findUnique).mockResolvedValue({
      id: "r1", status: "APPROVED", vdsAmount: d("0"), aitAmount: d("0"),
      vdsCertificateRef: null, vdsCertificateDate: null, aitCertificateRef: null, aitCertificateDate: null,
    } as any)

    await expect(updateReceiptCertificates("r1", { aitCertificateRef: "A-1", aitCertificateDate: "2026-09-25" } as any, FINANCE))
      .rejects.toThrow("This receipt has no income tax withheld, so it has no AIT certificate")
  })

  it("clears a certificate when the field is sent as null", async () => {
    vi.mocked(prisma.receipt.findUnique).mockResolvedValue({
      id: "r1", status: "APPROVED", vdsAmount: d("150000"), aitAmount: d("0"),
      vdsCertificateRef: "M6.6-0192", vdsCertificateDate: new Date("2026-09-25"), aitCertificateRef: null, aitCertificateDate: null,
    } as any)

    await updateReceiptCertificates("r1", { vdsCertificateRef: null, vdsCertificateDate: null } as any, FINANCE)

    expect(prisma.receipt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { vdsCertificateRef: null, vdsCertificateDate: null },
    }))
  })
})
