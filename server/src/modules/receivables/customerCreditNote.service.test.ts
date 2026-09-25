import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    invoice: { findUnique: vi.fn() },
    customerCreditNote: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { assertWithinOutstanding, createCustomerCreditNote } from "./customerCreditNote.service"

const d = (v: string) => new Prisma.Decimal(v)
const FINANCE = { sub: "u-f", role: "FINANCE_OFFICER", salesRole: null, email: "f@b.co", mustChangePassword: false } as any

const INVOICE = {
  id: "inv1", invoiceNumber: "INV-1", customerId: "c1", status: "APPROVED",
  lines: [{
    id: "il1", description: "Firewall", amount: d("1000000"), vatAmount: d("150000"),
    vatCode: { ratePercent: d("15") }, creditNoteLines: [{ amount: d("100000"), vatAmount: d("15000") }],
  }],
  allocations: [], creditNotes: [],
}

const VALID = { invoiceId: "inv1", date: "2026-09-23", reason: "Price corrected", lines: [{ invoiceLineId: "il1", amount: "10000" }] } as any

function arrangeInvoice(over: Record<string, unknown> = {}) {
  vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ ...INVOICE, ...over } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("createCustomerCreditNote", () => {
  it("works out VAT from the invoice line's rate", async () => {
    arrangeInvoice()
    vi.mocked(prisma.customerCreditNote.create).mockResolvedValue({ id: "cn1" } as any)

    await createCustomerCreditNote({
      invoiceId: "inv1", date: "2026-09-23", reason: "Two units returned",
      lines: [{ invoiceLineId: "il1", amount: "160000" }],
    } as any, FINANCE)

    expect(prisma.customerCreditNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: "c1", reason: "Two units returned",
        lines: { create: [{ invoiceLineId: "il1", amount: "160000.00", vatAmount: "24000.00" }] },
      }),
    }))
  })

  it("keeps the invoice's own VAT rate after the VAT code's rate is changed (final review Fix 2)", async () => {
    // Invoiced at 15%: 1,000,000 + 150,000 VAT. The code's rate has since
    // been changed to 7.5% in Settings.
    arrangeInvoice({
      lines: [{
        id: "il1", description: "Firewall", amount: d("1000000"), vatAmount: d("150000"),
        vatCode: { ratePercent: d("7.5") }, creditNoteLines: [],
      }],
    })
    vi.mocked(prisma.customerCreditNote.create).mockResolvedValue({ id: "cn1" } as any)

    await createCustomerCreditNote({
      invoiceId: "inv1", date: "2026-09-23", reason: "Price corrected",
      lines: [{ invoiceLineId: "il1", amount: "200000" }],
    } as any, FINANCE)

    // 15% of 200,000, the rate the invoice charged. Not 15,000 (7.5%).
    expect(prisma.customerCreditNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lines: { create: [{ invoiceLineId: "il1", amount: "200000.00", vatAmount: "30000.00" }] },
      }),
    }))
  })

  it("credits no VAT on a line the invoice charged no VAT on", async () => {
    arrangeInvoice({
      lines: [{ id: "il1", description: "Service", amount: d("50000"), vatAmount: d("0"), vatCode: { ratePercent: d("15") }, creditNoteLines: [] }],
    })
    vi.mocked(prisma.customerCreditNote.create).mockResolvedValue({ id: "cn1" } as any)

    await createCustomerCreditNote({
      invoiceId: "inv1", date: "2026-09-23", reason: "Price corrected",
      lines: [{ invoiceLineId: "il1", amount: "10000" }],
    } as any, FINANCE)

    expect(prisma.customerCreditNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lines: { create: [{ invoiceLineId: "il1", amount: "10000.00", vatAmount: "0.00" }] },
      }),
    }))
  })

  it("credits exactly the VAT left when crediting everything left on a line", async () => {
    arrangeInvoice({
      lines: [{ id: "il1", description: "Licence", amount: d("333.33"), vatAmount: d("50.00"), vatCode: { ratePercent: d("15") }, creditNoteLines: [] }],
    })
    await createCustomerCreditNote({ invoiceId: "inv1", date: "2026-09-23", reason: "x", lines: [{ invoiceLineId: "il1", amount: "333.33" }] } as any, FINANCE)

    expect(prisma.customerCreditNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lines: { create: [expect.objectContaining({ vatAmount: "50.00" })] } }),
    }))
  })

  it("refuses a draft invoice", async () => {
    arrangeInvoice({ status: "DRAFT" })
    await expect(createCustomerCreditNote(VALID, FINANCE)).rejects.toThrow("Only an approved invoice can be credited. Edit the draft instead.")
  })

  it("refuses a line from another invoice", async () => {
    arrangeInvoice()
    await expect(createCustomerCreditNote({ ...VALID, lines: [{ invoiceLineId: "other", amount: "1" }] }, FINANCE))
      .rejects.toThrow("A line on this credit note is not a line on invoice INV-1")
  })

  it("refuses more than is left to credit on a line, counting drafts", async () => {
    arrangeInvoice()
    await expect(createCustomerCreditNote({ ...VALID, lines: [{ invoiceLineId: "il1", amount: "900000.01" }] }, FINANCE))
      .rejects.toThrow("Only 900000.00 is left to credit on Firewall")
  })

  it("refuses to put the customer in credit, since refunds are not built", async () => {
    arrangeInvoice({ allocations: [{ amount: d("1100000") }], creditNotes: [] })
    await expect(createCustomerCreditNote({ ...VALID, lines: [{ invoiceLineId: "il1", amount: "100000" }] }, FINANCE))
      .rejects.toThrow("Invoice INV-1 only has 50000.00 left to collect. Crediting 115000.00 would leave the customer in credit, and refunds are not recorded in this system yet.")
  })
})

describe("assertWithinOutstanding", () => {
  it("passes when the credit note's gross fits within what is owed", () => {
    expect(() => assertWithinOutstanding(
      { invoiceNumber: "INV-1", lines: [{ amount: d("1000000"), vatAmount: d("150000") }], allocations: [], creditNotes: [] },
      d("100000")
    )).not.toThrow()
  })
})
