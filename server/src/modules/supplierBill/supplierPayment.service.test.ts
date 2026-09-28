import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    supplierPayment: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    supplierBill: { findMany: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("../payroll/payroll.fx", () => ({
  resolveRateOrThrow: vi.fn(),
}))
vi.mock("../receivables/receivables.access", () => ({ assertDealAccess: vi.fn() }))
vi.mock("../posting/posting.rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../posting/posting.rules")>()),
  loadRules: vi.fn(),
}))
vi.mock("../accounting/accounting.posting", () => ({ postSystemJournal: vi.fn() }))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { resolveRateOrThrow } from "../payroll/payroll.fx"
import { assertDealAccess } from "../receivables/receivables.access"
import { loadRules } from "../posting/posting.rules"
import { postSystemJournal } from "../accounting/accounting.posting"
import { createSupplierPayment } from "./supplierPayment.service"

const ACTOR = { sub: "u1", role: "FINANCE_OFFICER", email: "f@byte.spate", mustChangePassword: false, salesRole: null } as any
const d = (v: string) => new Prisma.Decimal(v)

const RULES = { event: "SUPPLIER_PAYMENT" as const, byKey: new Map([["PAYABLE", "2111"], ["BANK", "1242"]]) }
const FX_RULES = { event: "FX" as const, byKey: new Map([["LOSS", "5320"], ["GAIN", "4220"]]) }

const BDT_BILL = {
  id: "b1", supplierId: "sup-1", opportunityId: "opp-1", status: "APPROVED", billNumber: "INV-1",
  currency: "BDT", fxRateToBdt: null,
  lines: [{ amount: d("500000"), vatAmount: d("0") }],
  allocations: [], creditNotes: [],
}

// USD 10,000 billed at 122.5, recorded as 12,25,000 taka.
const USD_BILL = {
  id: "b2", supplierId: "sup-1", opportunityId: "opp-1", status: "APPROVED", billNumber: "INV-2",
  currency: "USD", fxRateToBdt: d("122.5"),
  lines: [{ amount: d("1225000"), vatAmount: d("0") }],
  allocations: [], creditNotes: [],
}

/** A Won deal, its allowed access, and one approved bill on it — the
 *  baseline fixture every createSupplierPayment test builds on. */
function arrangeWonDeal({ opportunityId, bills }: { opportunityId: string; bills: Array<Record<string, unknown>> }) {
  vi.mocked(assertDealAccess).mockResolvedValue({
    id: opportunityId, serial: "BS-OPP-00001", status: "WON", salesAccountId: "sa-1",
  } as any)
  vi.mocked(prisma.supplierBill.findMany).mockResolvedValue(bills as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(loadRules).mockImplementation(async (_tx, event) => (event === "FX" ? FX_RULES : RULES) as any)
  arrangeWonDeal({ opportunityId: "opp-1", bills: [BDT_BILL] })
})

describe("createSupplierPayment", () => {
  it("posts at once and is saved as approved", async () => {
    vi.mocked(prisma.supplierPayment.create).mockResolvedValue({
      id: "p1", supplierId: "sup-1", opportunityId: "opp-1", date: new Date("2026-10-10"),
      amount: d("500000"), sourceAmount: null, currency: "BDT", fxRateToBdt: null,
      status: "APPROVED", approvedBy: ACTOR.sub, approvedAt: new Date("2026-10-10"),
      supplier: { name: "Star Tech" },
      allocations: [{ billId: "b1", amount: d("500000"), amountUsd: null }],
    } as any)

    const p = await createSupplierPayment(
      { opportunityId: "opp-1", supplierId: "sup-1", date: "2026-10-10", amount: "500000", currency: "BDT", allocations: [{ billId: "b1", amount: "500000" }] } as any,
      ACTOR
    )

    expect(p.status).toBe("APPROVED")
    expect(postSystemJournal).toHaveBeenCalledTimes(1)
    expect(prisma.supplierPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplierId: "sup-1", opportunityId: "opp-1",
          status: "APPROVED", approvedBy: ACTOR.sub, approvedAt: expect.any(Date),
          amount: "500000.00",
          allocations: { create: [expect.objectContaining({ billId: "b1", amount: "500000.00", amountUsd: null })] },
        }),
      })
    )
  })

  it("refuses a bill on a different deal (Review Focus 1, supplier side)", async () => {
    arrangeWonDeal({ opportunityId: "opp-1", bills: [{ ...BDT_BILL, opportunityId: "opp-9" }] })

    await expect(
      createSupplierPayment(
        { opportunityId: "opp-1", supplierId: "sup-1", date: "2026-10-10", amount: "500000", currency: "BDT", allocations: [{ billId: "b1", amount: "500000" }] } as any,
        ACTOR
      )
    ).rejects.toThrow("Bill INV-1 is on a different deal. Record a separate payment on that deal.")
  })

  it("refuses a bill from a different supplier", async () => {
    arrangeWonDeal({ opportunityId: "opp-1", bills: [{ ...BDT_BILL, supplierId: "sup-2" }] })

    await expect(
      createSupplierPayment(
        { opportunityId: "opp-1", supplierId: "sup-1", date: "2026-10-10", amount: "500000", currency: "BDT", allocations: [{ billId: "b1", amount: "500000" }] } as any,
        ACTOR
      )
    ).rejects.toThrow("Bill INV-1 is from a different supplier.")
  })

  it("refuses an allocation larger than what the bill still owes", async () => {
    await expect(
      createSupplierPayment(
        { opportunityId: "opp-1", supplierId: "sup-1", date: "2026-10-10", amount: "600000", currency: "BDT", allocations: [{ billId: "b1", amount: "600000" }] } as any,
        ACTOR
      )
    ).rejects.toThrow("Bill INV-1 only has 500000.00 left to pay")
  })

  it("refuses a payment more than the bills it pays (Review Focus, no advances)", async () => {
    await expect(
      createSupplierPayment(
        { opportunityId: "opp-1", supplierId: "sup-1", date: "2026-10-10", amount: "1500", currency: "BDT", allocations: [{ billId: "b1", amount: "1000" }] } as any,
        ACTOR
      )
    ).rejects.toThrow("This payment is 500.00 more than the bills it pays. Money paid before a bill cannot be recorded. Add the bill first.")
  })

  it("refuses allocations that add up to more than the payment amount", async () => {
    await expect(
      createSupplierPayment(
        { opportunityId: "opp-1", supplierId: "sup-1", date: "2026-10-10", amount: "100000", currency: "BDT", allocations: [{ billId: "b1", amount: "150000" }] } as any,
        ACTOR
      )
    ).rejects.toThrow("The bills you picked add up to more than this payment. Lower an amount.")
  })
})

describe("createSupplierPayment in USD", () => {
  it("converts at the payment-date rate, and clears each USD bill at that bill's own rate", async () => {
    arrangeWonDeal({ opportunityId: "opp-1", bills: [USD_BILL] })
    vi.mocked(resolveRateOrThrow).mockResolvedValue(d("125") as any)
    vi.mocked(prisma.supplierPayment.create).mockResolvedValue({
      id: "p3", supplierId: "sup-1", opportunityId: "opp-1", date: new Date("2026-11-01"),
      amount: d("1250000"), sourceAmount: d("10000"), currency: "USD", fxRateToBdt: d("125"),
      status: "APPROVED", approvedBy: ACTOR.sub, approvedAt: new Date("2026-11-01"),
      supplier: { name: "Star Tech" },
      allocations: [{ billId: "b2", amount: d("1225000"), amountUsd: d("10000") }],
    } as any)

    await createSupplierPayment(
      { opportunityId: "opp-1", supplierId: "sup-1", date: "2026-11-01", amount: "10000", currency: "USD", allocations: [{ billId: "b2", amount: "10000" }] } as any,
      ACTOR
    )

    expect(prisma.supplierPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currency: "USD",
          amount: "1250000.00",
          sourceAmount: "10000",
          fxRateToBdt: "125.000000",
          allocations: {
            create: [expect.objectContaining({ billId: "b2", amount: "1225000.00", amountUsd: "10000" })],
          },
        }),
      })
    )
  })

  it("refuses a USD payment against a taka bill, in easy English", async () => {
    arrangeWonDeal({ opportunityId: "opp-1", bills: [BDT_BILL] })
    vi.mocked(resolveRateOrThrow).mockResolvedValue(d("125") as any)

    await expect(
      createSupplierPayment(
        { opportunityId: "opp-1", supplierId: "sup-1", date: "2026-11-01", amount: "1000", currency: "USD", allocations: [{ billId: "b1", amount: "1000" }] } as any,
        ACTOR
      )
    ).rejects.toThrow("A payment in US dollars can only pay a bill in US dollars. Bill INV-1 is in taka.")
  })

  it("refuses a taka payment against a US dollar bill, in easy English", async () => {
    arrangeWonDeal({ opportunityId: "opp-1", bills: [USD_BILL] })

    await expect(
      createSupplierPayment(
        { opportunityId: "opp-1", supplierId: "sup-1", date: "2026-11-01", amount: "1000000", currency: "BDT", allocations: [{ billId: "b2", amount: "1000000" }] } as any,
        ACTOR
      )
    ).rejects.toThrow("Bill INV-2 is in US dollars. Pay it in US dollars, not taka.")
  })
})
