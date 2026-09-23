import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    idCounter: { upsert: vi.fn() },
    opportunityLine: { findMany: vi.fn() },
    customerPo: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    customerPoLine: { deleteMany: vi.fn() },
    billingScheduleRow: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("./receivables.access", () => ({
  assertDealAccess: vi.fn(),
  isFinance: vi.fn(() => true),
}))
vi.mock("../customer/customer.link", () => ({ ensureCustomerForAccount: vi.fn() }))
vi.mock("./receivables.vat", () => ({ loadActiveVatRates: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { assertDealAccess } from "./receivables.access"
import { ensureCustomerForAccount } from "../customer/customer.link"
import { loadActiveVatRates } from "./receivables.vat"
import {
  cancelCustomerPo,
  createCustomerPo,
  listCustomerPos,
  poLineRemaining,
  prefillPoLines,
  updateCustomerPo,
} from "./customerPo.service"

const d = (v: string) => new Prisma.Decimal(v)
const FINANCE = { sub: "u-f", role: "FINANCE_OFFICER", salesRole: null, email: "f@b.co", mustChangePassword: false } as any
const SALES_USER = { sub: "u-s", role: "EMPLOYEE", salesRole: "SALES_USER", email: "s@b.co", mustChangePassword: false } as any

const PO_INPUT = {
  opportunityId: "opp-1", customerPoNumber: "PO-778", date: "2026-09-23",
  lines: [{ description: "Firewall", kind: "GOODS" as const, quantity: "10", unitPrice: "80000", vatCodeId: "vat-15" }],
  schedule: [] as Array<{ plannedDate: string; amount: string; note?: string }>,
}

function arrangeDeal(over: Partial<{ status: string; serial: string }> = {}) {
  vi.mocked(assertDealAccess).mockResolvedValue({ id: "opp-1", serial: "BS-OPP-00002", status: "WON", salesAccountId: "acc-1", ...over } as any)
  vi.mocked(ensureCustomerForAccount).mockResolvedValue({ id: "c1", legalName: "Bengal Group" } as any)
  vi.mocked(loadActiveVatRates).mockResolvedValue(new Map([["vat-15", d("15")]]))
  vi.mocked(prisma.idCounter.upsert).mockResolvedValue({ id: "CPO", value: 1 } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
})

describe("prefillPoLines", () => {
  it("prefills lines from the deal's products and never invents a price", async () => {
    arrangeDeal()
    vi.mocked(prisma.opportunityLine.findMany).mockResolvedValue([
      { product: "Firewall", oemBrand: "Fortinet", model: "FG-100F", quantity: 10, unitValue: d("80000"), lineValue: d("800000") },
      { product: "Installation", oemBrand: null, model: null, quantity: null, unitValue: null, lineValue: null },
    ] as any)

    await expect(prefillPoLines("opp-1", FINANCE)).resolves.toEqual({
      lines: [
        { description: "Firewall Fortinet FG-100F", kind: "GOODS", quantity: "10", unitPrice: "80000.00" },
        { description: "Installation", kind: "GOODS", quantity: "1", unitPrice: null },
      ],
    })
  })
})

describe("createCustomerPo", () => {
  it("refuses a PO on a deal that is not Won", async () => {
    arrangeDeal({ status: "ONGOING", serial: "BS-OPP-00003" })
    await expect(createCustomerPo(PO_INPUT, FINANCE)).rejects.toThrow(
      "BS-OPP-00003 is not a Won deal, so it cannot have a customer PO yet"
    )
  })

  it("works out each line's amount as quantity times unit price, and issues a BS-CPO serial", async () => {
    arrangeDeal()
    vi.mocked(prisma.customerPo.create).mockResolvedValue({ id: "po1", serial: "BS-CPO-00001" } as any)

    await createCustomerPo(PO_INPUT, FINANCE)

    expect(prisma.customerPo.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        serial: "BS-CPO-00001", customerId: "c1", createdBy: FINANCE.sub,
        lines: { create: [expect.objectContaining({ quantity: "10.00", unitPrice: "80000.00", amount: "800000.00", order: 0 })] },
      }),
    }))
  })

  it("refuses a billing schedule that adds up to more than the PO", async () => {
    arrangeDeal()
    await expect(
      createCustomerPo({ ...PO_INPUT, schedule: [{ plannedDate: "2026-10-01", amount: "900000" }] }, FINANCE)
    ).rejects.toThrow("The billing schedule adds up to 900000.00, more than the PO's 800000.00 before VAT")
  })

  it("says plainly when the PO number is already taken for this customer", async () => {
    arrangeDeal()
    vi.mocked(prisma.customerPo.create).mockRejectedValue({ code: "P2002" })
    await expect(createCustomerPo(PO_INPUT, FINANCE)).rejects.toThrow("This customer already has a PO numbered PO-778")
  })

  it("stores trackDelivery and each line's earning kind and contract dates", async () => {
    arrangeDeal()
    vi.mocked(prisma.customerPo.create).mockResolvedValue({ id: "po1", serial: "BS-CPO-00001" } as any)

    await createCustomerPo({
      ...PO_INPUT,
      trackDelivery: true,
      lines: [
        { description: "Firewall", kind: "GOODS", quantity: "10", unitPrice: "80000", vatCodeId: "vat-15", earnKind: "DELIVERY" },
        {
          description: "Support", kind: "SERVICE", quantity: "1", unitPrice: "100000", vatCodeId: "vat-15",
          earnKind: "MONTHLY", contractStart: "2026-01-01", contractEnd: "2026-12-31",
        },
      ],
    } as any, FINANCE)

    expect(prisma.customerPo.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        trackDelivery: true,
        lines: {
          create: [
            expect.objectContaining({ earnKind: "DELIVERY", contractStart: null, contractEnd: null }),
            expect.objectContaining({ earnKind: "MONTHLY", contractStart: new Date("2026-01-01"), contractEnd: new Date("2026-12-31") }),
          ],
        },
      }),
    }))
  })
})

describe("updateCustomerPo / cancelCustomerPo", () => {
  it("refuses to edit or cancel a PO that already has an invoice", async () => {
    vi.mocked(prisma.customerPo.findUnique).mockResolvedValue({ id: "po1", opportunityId: "opp-1", status: "OPEN", _count: { invoices: 1 } } as any)
    arrangeDeal()
    const msg = "This PO already has an invoice, so it can no longer be edited or cancelled. Raise a credit note on the invoice instead."
    await expect(updateCustomerPo("po1", PO_INPUT, FINANCE)).rejects.toThrow(msg)
    await expect(cancelCustomerPo("po1", { reason: "x" }, FINANCE)).rejects.toThrow(msg)
  })

  it("refuses a line with no earning kind when the PO tracks delivery", async () => {
    vi.mocked(prisma.customerPo.findUnique).mockResolvedValue({
      id: "po1", opportunityId: "opp-1", status: "OPEN", trackDelivery: true, _count: { invoices: 0 },
    } as any)
    arrangeDeal()
    await expect(updateCustomerPo("po1", PO_INPUT, FINANCE)).rejects.toThrow(
      "Every line on a PO that tracks delivery needs to say how it is earned"
    )
  })

  it("cancels an uninvoiced PO with its reason", async () => {
    vi.mocked(prisma.customerPo.findUnique).mockResolvedValue({ id: "po1", opportunityId: "opp-1", status: "OPEN", _count: { invoices: 0 } } as any)
    arrangeDeal()
    await cancelCustomerPo("po1", { reason: "Customer withdrew" }, FINANCE)
    expect(prisma.customerPo.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "po1" }, data: { status: "CANCELLED", cancelReason: "Customer withdrew" },
    }))
  })
})

describe("listCustomerPos", () => {
  it("makes a sales user name the deal when listing", async () => {
    const { isFinance } = await import("./receivables.access")
    vi.mocked(isFinance).mockReturnValue(false)
    await expect(listCustomerPos({}, SALES_USER)).rejects.toThrow("Choose a deal to list its customer POs")
  })
})

describe("poLineRemaining", () => {
  it("works out what is left to invoice on a line from every draft or approved invoice line", () => {
    expect(poLineRemaining({ amount: d("800000"), invoiceLines: [{ amount: d("300000") }, { amount: d("100000") }] }).toFixed(2)).toBe("400000.00")
  })
})
