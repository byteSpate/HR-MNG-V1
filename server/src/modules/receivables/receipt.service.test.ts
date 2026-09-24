import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    customer: { findUnique: vi.fn() },
    invoice: { findMany: vi.fn() },
    receipt: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("./receivables.access", () => ({ assertDealAccess: vi.fn() }))
vi.mock("./receipt.allocation", () => ({ assertReceivable: vi.fn() }))
vi.mock("../posting/posting.rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../posting/posting.rules")>()),
  loadRules: vi.fn(),
}))
vi.mock("../accounting/accounting.posting", () => ({ postSystemJournal: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { assertDealAccess } from "./receivables.access"
import { assertReceivable } from "./receipt.allocation"
import { loadRules } from "../posting/posting.rules"
import { postSystemJournal } from "../accounting/accounting.posting"
import { createReceipt, listReceipts, updateReceiptCertificates } from "./receipt.service"

const d = (v: string) => new Prisma.Decimal(v)
const FINANCE = { sub: "u-f", role: "FINANCE_OFFICER", salesRole: null, email: "f@b.co", mustChangePassword: false } as any

const RULES = { event: "RECEIPT" as const, byKey: new Map([["RECEIVABLE", "1220"], ["BANK", "1242"], ["VDS", "1234"], ["AIT", "1235"]]) }

let invoiceRows: Array<{ id: string; invoiceNumber: string; status: string; po: { opportunityId: string } }>

/** A deal, its customer, and one approved invoice on it — the baseline
 *  fixture every createReceipt test builds on. `outstanding` documents the
 *  scenario for a reader; the outstanding-balance arithmetic itself is
 *  assertReceivable's job and is mocked out here (receipt.allocation.test.ts
 *  covers it directly). */
function arrangeDealWithInvoice({
  opportunityId, invoiceId, outstanding,
}: { opportunityId: string; invoiceId: string; outstanding: Prisma.Decimal }) {
  void outstanding
  vi.mocked(assertDealAccess).mockResolvedValue({
    id: opportunityId, serial: "BS-OPP-00001", status: "WON", salesAccountId: "sa-1",
  } as any)
  vi.mocked(prisma.customer.findUnique).mockResolvedValue({ id: "c1", legalName: "Bengal Group" } as any)
  invoiceRows = [{ id: invoiceId, invoiceNumber: "INV-1", status: "APPROVED", po: { opportunityId } }]
  vi.mocked(prisma.invoice.findMany).mockImplementation((async () => invoiceRows) as any)
}

function arrangeInvoiceOnOtherDeal({
  invoiceId, invoiceNumber, opportunityId,
}: { invoiceId: string; invoiceNumber: string; opportunityId: string }) {
  invoiceRows.push({ id: invoiceId, invoiceNumber, status: "APPROVED", po: { opportunityId } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(loadRules).mockResolvedValue(RULES)
})

describe("createReceipt", () => {
  it("posts at once and is saved as approved", async () => {
    arrangeDealWithInvoice({ opportunityId: "opp-1", invoiceId: "inv-1", outstanding: d("1150000") })
    vi.mocked(prisma.receipt.create).mockResolvedValue({
      id: "r1", customerId: "c1", opportunityId: "opp-1", date: new Date("2026-11-10"),
      amount: d("950000"), vdsAmount: d("150000"), aitAmount: d("50000"), reference: null,
      status: "APPROVED", approvedBy: FINANCE.sub, approvedAt: new Date("2026-11-10"),
      customer: { id: "c1", legalName: "Bengal Group" },
      allocations: [{ invoiceId: "inv-1", amount: d("1150000"), invoice: { id: "inv-1", invoiceNumber: "INV-1" } }],
    } as any)

    const r = await createReceipt({
      opportunityId: "opp-1", date: "2026-11-10", amount: "950000", vdsAmount: "150000", aitAmount: "50000",
      allocations: [{ invoiceId: "inv-1", amount: "1150000" }],
    } as any, FINANCE)

    expect(r.status).toBe("APPROVED")
    expect(postSystemJournal).toHaveBeenCalledTimes(1)
    expect(assertReceivable).toHaveBeenCalledWith(expect.anything(), "c1", [{ invoiceId: "inv-1", amount: d("1150000") }])
    expect(prisma.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: "c1", opportunityId: "opp-1", status: "APPROVED", approvedBy: FINANCE.sub, approvedAt: expect.any(Date),
        amount: "950000.00", vdsAmount: "150000.00", aitAmount: "50000.00", createdBy: FINANCE.sub,
        allocations: { create: [{ invoiceId: "inv-1", amount: "1150000.00" }] },
      }),
    }))
  })

  it("refuses an invoice from another deal, even for the same customer (Review Focus 1)", async () => {
    arrangeDealWithInvoice({ opportunityId: "opp-1", invoiceId: "inv-1", outstanding: d("100") })
    arrangeInvoiceOnOtherDeal({ invoiceId: "inv-9", invoiceNumber: "INV-9", opportunityId: "opp-2" })

    await expect(createReceipt({
      opportunityId: "opp-1", date: "2026-11-10", amount: "100", allocations: [{ invoiceId: "inv-9", amount: "100" }],
    } as any, FINANCE)).rejects.toThrow("Invoice INV-9 is on a different deal. Record a separate receipt on that deal.")
  })

  it("refuses an invoice that is not approved", async () => {
    arrangeDealWithInvoice({ opportunityId: "opp-1", invoiceId: "inv-1", outstanding: d("100") })
    invoiceRows[0].status = "DRAFT"

    await expect(createReceipt({
      opportunityId: "opp-1", date: "2026-11-10", amount: "100", allocations: [{ invoiceId: "inv-1", amount: "100" }],
    } as any, FINANCE)).rejects.toThrow("Invoice INV-1 is not approved yet")
  })

  it("refuses money that is not paying an invoice (no advances)", async () => {
    arrangeDealWithInvoice({ opportunityId: "opp-1", invoiceId: "inv-1", outstanding: d("1000") })

    await expect(createReceipt({
      opportunityId: "opp-1", date: "2026-11-10", amount: "1500", allocations: [{ invoiceId: "inv-1", amount: "1000" }],
    } as any, FINANCE)).rejects.toThrow(
      "This receipt is 500.00 more than the invoices it pays. Money received before an invoice cannot be recorded. Create the invoice first."
    )
  })

  it("refuses allocations that add up to more than the receipt", async () => {
    arrangeDealWithInvoice({ opportunityId: "opp-1", invoiceId: "inv-1", outstanding: d("2000") })

    await expect(createReceipt({
      opportunityId: "opp-1", date: "2026-11-10", amount: "1000", allocations: [{ invoiceId: "inv-1", amount: "1500" }],
    } as any, FINANCE)).rejects.toThrow("The invoices you picked add up to more than this receipt. Lower an amount.")
  })

  it("refuses a certificate reference without its date, and the reverse", async () => {
    arrangeDealWithInvoice({ opportunityId: "opp-1", invoiceId: "inv-1", outstanding: d("1150000") })

    await expect(createReceipt({
      opportunityId: "opp-1", date: "2026-11-10", amount: "950000", vdsAmount: "150000", aitAmount: "50000",
      vdsCertificateRef: "VDS-1", allocations: [{ invoiceId: "inv-1", amount: "1150000" }],
    } as any, FINANCE)).rejects.toThrow("Give the VDS certificate's number and date together")
  })

  it("refuses a VDS certificate on a receipt with no VAT withheld", async () => {
    arrangeDealWithInvoice({ opportunityId: "opp-1", invoiceId: "inv-1", outstanding: d("1000000") })

    await expect(createReceipt({
      opportunityId: "opp-1", date: "2026-11-10", amount: "1000000", vdsAmount: "0", aitAmount: "0",
      vdsCertificateRef: "VDS-1", vdsCertificateDate: "2026-11-11", allocations: [{ invoiceId: "inv-1", amount: "1000000" }],
    } as any, FINANCE)).rejects.toThrow("This receipt has no VAT withheld, so it has no VDS certificate")
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
