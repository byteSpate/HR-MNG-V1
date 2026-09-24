import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    customerPo: { findUnique: vi.fn(), findMany: vi.fn() },
    invoice: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    invoiceLine: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("./receivables.vat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./receivables.vat")>()),
  loadActiveVatRates: vi.fn(),
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { loadActiveVatRates } from "./receivables.vat"
import { createInvoice, listInvoiceablePos, updateInvoice } from "./invoice.service"

const d = (v: string) => new Prisma.Decimal(v)
const FINANCE = { sub: "u-f", role: "FINANCE_OFFICER", salesRole: null, email: "f@b.co", mustChangePassword: false } as any

const PO = {
  id: "po1", serial: "BS-CPO-00001", status: "OPEN", customerId: "c1",
  customer: { id: "c1", legalName: "Bengal Group", paymentDays: 30, billingAddress: "House 12, Road 5, Gulshan, Dhaka" },
  lines: [
    { id: "pl1", description: "Firewall", kind: "GOODS", amount: d("800000"), vatCodeId: "vat-15", invoiceLines: [{ amount: d("300000") }] },
    { id: "pl2", description: "Installation", kind: "SERVICE", amount: d("100000"), vatCodeId: "vat-15", invoiceLines: [] },
  ],
}

const INPUT = {
  poId: "po1", invoiceNumber: "INV-2026-041", date: "2026-09-23",
  lines: [{ poLineId: "pl1", amount: "500000" }],
} as any

function uniqueViolation() {
  return { code: "P2002" }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.customerPo.findUnique).mockResolvedValue(PO as any)
  vi.mocked(loadActiveVatRates).mockResolvedValue(new Map([["vat-15", d("15")], ["vat-0", d("0")]]))
})

describe("createInvoice", () => {
  it("computes VAT per line from its code and defaults the due date from the customer's payment days", async () => {
    vi.mocked(prisma.invoice.create).mockResolvedValue({ id: "inv1" } as any)

    await createInvoice(INPUT, FINANCE)

    expect(prisma.invoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        invoiceNumber: "INV-2026-041", customerId: "c1", poId: "po1", createdBy: FINANCE.sub,
        dueDate: new Date("2026-10-23"),
        lines: { create: [{ poLineId: "pl1", description: "Firewall", amount: "500000.00", vatCodeId: "vat-15", vatAmount: "75000.00" }] },
      }),
    }))
  })

  it("refuses more than is left to invoice on a PO line, counting drafts", async () => {
    await expect(createInvoice({ ...INPUT, lines: [{ poLineId: "pl1", amount: "500000.01" }] }, FINANCE))
      .rejects.toThrow("Only 500000.00 is left to invoice on Firewall")
  })

  it("adds two lines on the same PO line together before checking", async () => {
    await expect(
      createInvoice({ ...INPUT, lines: [{ poLineId: "pl1", amount: "300000" }, { poLineId: "pl1", amount: "300000" }] }, FINANCE)
    ).rejects.toThrow("Only 500000.00 is left to invoice on Firewall")
  })

  it("refuses a line from another PO", async () => {
    await expect(createInvoice({ ...INPUT, lines: [{ poLineId: "other", amount: "1" }] }, FINANCE))
      .rejects.toThrow("A line on this invoice is not a line on PO BS-CPO-00001")
  })

  it("refuses a PO that is not open", async () => {
    vi.mocked(prisma.customerPo.findUnique).mockResolvedValue({ ...PO, status: "CANCELLED" } as any)
    await expect(createInvoice(INPUT, FINANCE)).rejects.toThrow("PO BS-CPO-00001 is cancelled, so it cannot be invoiced")
  })

  it("says plainly when the invoice number is already taken", async () => {
    vi.mocked(prisma.invoice.create).mockRejectedValue(uniqueViolation())
    await expect(createInvoice(INPUT, FINANCE)).rejects.toThrow("An invoice numbered INV-2026-041 is already recorded")
  })

  it("computes VAT at the code's current rate, 7.5%, on a new draft (Review Focus 3)", async () => {
    vi.mocked(loadActiveVatRates).mockResolvedValue(new Map([["vat-15", d("7.5")]]))
    vi.mocked(prisma.customerPo.findUnique).mockResolvedValue({
      ...PO, lines: [{ ...PO.lines[0], amount: d("2000000"), invoiceLines: [] }],
    } as any)
    vi.mocked(prisma.invoice.create).mockResolvedValue({ id: "inv2" } as any)

    await createInvoice({ ...INPUT, lines: [{ poLineId: "pl1", amount: "1000000" }] }, FINANCE)

    expect(prisma.invoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lines: { create: [expect.objectContaining({ amount: "1000000.00", vatAmount: "75000.00" })] },
      }),
    }))
  })

  it("refuses an invoice while the customer has no billing address", async () => {
    vi.mocked(prisma.customerPo.findUnique).mockResolvedValue({
      ...PO, customer: { ...PO.customer, billingAddress: null },
    } as any)
    await expect(createInvoice(INPUT, FINANCE)).rejects.toThrow(
      "Add Bengal Group's billing address first. It is printed on the invoice."
    )
  })
})

describe("updateInvoice", () => {
  it("edits a draft, checking what is left without counting its own old lines", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: "inv1", poId: "po1", status: "DRAFT" } as any)
    await updateInvoice("inv1", { invoiceNumber: "INV-2026-041", date: "2026-09-23", lines: [{ poLineId: "pl1", amount: "500000" }] } as any, FINANCE)
    expect(prisma.invoiceLine.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: "inv1" } })
    expect(prisma.invoice.update).toHaveBeenCalled()
    const deleteOrder = vi.mocked(prisma.invoiceLine.deleteMany).mock.invocationCallOrder[0]
    const reloadOrder = vi.mocked(prisma.customerPo.findUnique).mock.invocationCallOrder.at(-1)!
    expect(deleteOrder).toBeLessThan(reloadOrder)
  })

  it("refuses to edit an approved invoice", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: "inv1", poId: "po1", status: "APPROVED" } as any)
    await expect(updateInvoice("inv1", INPUT, FINANCE)).rejects.toThrow("Only a draft invoice can be edited")
  })

  it("clears the sent-back note when the draft is saved again", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: "inv1", poId: "po1", status: "DRAFT", rejectionNote: "Wrong number" } as any)
    await updateInvoice("inv1", { invoiceNumber: "INV-2026-041", date: "2026-09-23", lines: [{ poLineId: "pl1", amount: "500000" }] } as any, FINANCE)
    expect(prisma.invoice.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ rejectionNote: null, sentBackBy: null, sentBackAt: null }),
    }))
  })
})

describe("listInvoiceablePos", () => {
  it("lists open POs with what is left per line", async () => {
    vi.mocked(prisma.customerPo.findMany).mockResolvedValue([PO] as any)
    const result = await listInvoiceablePos()
    expect(result).toEqual([expect.objectContaining({
      id: "po1", serial: "BS-CPO-00001",
      lines: expect.arrayContaining([expect.objectContaining({ id: "pl1", remaining: "500000.00" })]),
    })])
  })
})
