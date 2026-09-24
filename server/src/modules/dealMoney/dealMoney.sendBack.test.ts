import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    invoice: { findUnique: vi.fn(), update: vi.fn() },
    supplierBill: { findUnique: vi.fn(), update: vi.fn() },
    customerCreditNote: { findUnique: vi.fn(), update: vi.fn() },
    supplierCreditNote: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { sendBack, type ApprovalKind } from "./dealMoney.sendBack"

const SUPER_ADMIN = { sub: "admin-1", role: "SUPER_ADMIN", email: "a@b.com", mustChangePassword: false, salesRole: null } as any
const FINANCE = { sub: "u-finance", role: "FINANCE_OFFICER", email: "f@b.com", mustChangePassword: false, salesRole: null } as any

const MODEL = {
  INVOICE: "invoice",
  SUPPLIER_BILL: "supplierBill",
  CUSTOMER_CREDIT_NOTE: "customerCreditNote",
  SUPPLIER_CREDIT_NOTE: "supplierCreditNote",
} as const satisfies Record<ApprovalKind, keyof typeof prisma>

function arrangeDraft(kind: ApprovalKind, draft: Record<string, unknown> | null) {
  const model = prisma[MODEL[kind]] as any
  model.findUnique.mockResolvedValue(draft)
  model.update.mockResolvedValue(draft ? { ...draft, status: "DRAFT" } : null)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("sendBack", () => {
  it("sets the note and takes the draft off the list", async () => {
    arrangeDraft("INVOICE", { id: "inv-1", status: "DRAFT", createdBy: "u-finance", rejectionNote: null })

    await sendBack("INVOICE", "inv-1", { note: "Wrong invoice number" }, SUPER_ADMIN)

    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rejectionNote: "Wrong invoice number", sentBackBy: SUPER_ADMIN.sub }) })
    )
  })

  it("needs a note", async () => {
    await expect(sendBack("INVOICE", "inv-1", { note: "  " }, SUPER_ADMIN)).rejects.toThrow(
      "Write a note so the person knows what to fix."
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("only a Super Admin can send back", async () => {
    await expect(sendBack("INVOICE", "inv-1", { note: "x" }, FINANCE)).rejects.toThrow(
      "Only a Super Admin can send this back."
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("refuses a draft that does not exist", async () => {
    arrangeDraft("INVOICE", null)
    await expect(sendBack("INVOICE", "inv-1", { note: "x" }, SUPER_ADMIN)).rejects.toThrow("Invoice not found")
  })

  it("refuses something that is not a draft", async () => {
    arrangeDraft("SUPPLIER_BILL", { id: "b1", status: "APPROVED", createdBy: "u-finance" })
    await expect(sendBack("SUPPLIER_BILL", "b1", { note: "x" }, SUPER_ADMIN)).rejects.toThrow(
      "This bill is already approved"
    )
  })

  it("sends back a customer credit note", async () => {
    arrangeDraft("CUSTOMER_CREDIT_NOTE", { id: "cn1", status: "DRAFT", createdBy: "u-finance" })
    await sendBack("CUSTOMER_CREDIT_NOTE", "cn1", { note: "Wrong amount" }, SUPER_ADMIN)
    expect(prisma.customerCreditNote.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rejectionNote: "Wrong amount" }) })
    )
  })

  it("sends back a supplier credit note", async () => {
    arrangeDraft("SUPPLIER_CREDIT_NOTE", { id: "cn2", status: "DRAFT", createdBy: "u-finance" })
    await sendBack("SUPPLIER_CREDIT_NOTE", "cn2", { note: "Wrong amount" }, SUPER_ADMIN)
    expect(prisma.supplierCreditNote.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rejectionNote: "Wrong amount" }) })
    )
  })

  it("writes an audit row with the note", async () => {
    arrangeDraft("INVOICE", { id: "inv-1", status: "DRAFT", createdBy: "u-finance" })
    await sendBack("INVOICE", "inv-1", { note: "Wrong invoice number" }, SUPER_ADMIN)
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: "INVOICE", entityId: "inv-1", action: "REJECT", note: "Wrong invoice number" }),
      })
    )
  })
})
