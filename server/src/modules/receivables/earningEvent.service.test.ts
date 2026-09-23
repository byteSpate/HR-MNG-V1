import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    customerPo: { findUnique: vi.fn() },
    earningEvent: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("./receivables.access", () => ({
  assertDealAccess: vi.fn(),
  isFinance: vi.fn(() => true),
}))

import { Prisma } from "../../generated/prisma/client"
import prisma from "../../config/prisma"
import { assertDealAccess } from "./receivables.access"
import { createEarningEvent, getEarningEvent, poLineEarnRemaining } from "./earningEvent.service"

const d = (v: string) => new Prisma.Decimal(v)
const FINANCE = { sub: "u-f", role: "FINANCE_OFFICER", salesRole: null, email: "f@b.co", mustChangePassword: false } as any

function arrangePo(over: { trackDelivery?: boolean; status?: string; lines?: Array<Record<string, unknown>> } = {}) {
  vi.mocked(assertDealAccess).mockResolvedValue({ id: "opp-1" } as any)
  vi.mocked(prisma.customerPo.findUnique).mockResolvedValue({
    id: "po1", serial: "BS-CPO-00001", opportunityId: "opp-1",
    trackDelivery: over.trackDelivery ?? true, status: over.status ?? "OPEN",
    lines: over.lines ?? [],
  } as any)
  vi.mocked(prisma.earningEvent.create).mockResolvedValue({ id: "ev1" } as any)
}

beforeEach(() => vi.clearAllMocks())

const DELIVERY_INPUT = { poId: "po1", kind: "DELIVERY" as const, date: "2026-09-23", evidenceRef: "CH-118", lines: [{ poLineId: "pl1", quantity: "4" }] }

describe("createEarningEvent", () => {
  it("404s when the PO does not exist", async () => {
    vi.mocked(prisma.customerPo.findUnique).mockResolvedValue(null)
    await expect(createEarningEvent(DELIVERY_INPUT as any, FINANCE)).rejects.toThrow("Customer PO not found")
  })

  it("refuses a caller with no access to the deal", async () => {
    arrangePo()
    vi.mocked(assertDealAccess).mockRejectedValue(new Error("You do not have access to this deal"))
    await expect(createEarningEvent(DELIVERY_INPUT as any, FINANCE)).rejects.toThrow("You do not have access to this deal")
  })

  it("refuses an untracked PO", async () => {
    arrangePo({ trackDelivery: false })
    await expect(createEarningEvent(DELIVERY_INPUT as any, FINANCE)).rejects.toThrow(
      "PO BS-CPO-00001 does not track delivery: its revenue is earned when invoiced"
    )
  })

  it("refuses a PO that is not open", async () => {
    arrangePo({ status: "CANCELLED" })
    await expect(createEarningEvent(DELIVERY_INPUT as any, FINANCE)).rejects.toThrow(
      "PO BS-CPO-00001 is cancelled, so nothing more can be earned on it"
    )
  })

  it("refuses a line from another PO", async () => {
    arrangePo({ lines: [{ id: "other-line", description: "X", earnKind: "DELIVERY", quantity: d("1"), unitPrice: d("1"), earningLines: [], monthlyEarnings: [] }] })
    await expect(createEarningEvent(DELIVERY_INPUT as any, FINANCE)).rejects.toThrow("A line on this record is not a line on PO BS-CPO-00001")
  })

  it("refuses a line of the other earning kind", async () => {
    arrangePo({ lines: [{ id: "pl1", description: "Firewall", earnKind: "DELIVERY", quantity: d("10"), unitPrice: d("80000"), earningLines: [], monthlyEarnings: [] }] })
    await expect(
      createEarningEvent({ ...DELIVERY_INPUT, kind: "ACCEPTANCE", lines: [{ poLineId: "pl1", amount: "1000" }] } as any, FINANCE)
    ).rejects.toThrow("Firewall is earned by delivery, not by acceptance")
  })

  it("refuses a monthly line", async () => {
    arrangePo({ lines: [{ id: "pl1", description: "Installation support", earnKind: "MONTHLY", quantity: d("1"), unitPrice: d("100000"), earningLines: [], monthlyEarnings: [] }] })
    await expect(createEarningEvent(DELIVERY_INPUT as any, FINANCE)).rejects.toThrow(
      "Installation support is earned by the monthly run, not recorded here"
    )
  })

  it("refuses a delivery line with no quantity", async () => {
    arrangePo({ lines: [{ id: "pl1", description: "Firewall", earnKind: "DELIVERY", quantity: d("10"), unitPrice: d("80000"), earningLines: [], monthlyEarnings: [] }] })
    await expect(
      createEarningEvent({ ...DELIVERY_INPUT, lines: [{ poLineId: "pl1" }] } as any, FINANCE)
    ).rejects.toThrow("Give the quantity delivered for Firewall")
  })

  it("refuses an acceptance line with no amount", async () => {
    arrangePo({ lines: [{ id: "pl1", description: "Installation", earnKind: "ACCEPTANCE", quantity: d("1"), unitPrice: d("150000"), earningLines: [], monthlyEarnings: [] }] })
    await expect(
      createEarningEvent({ ...DELIVERY_INPUT, kind: "ACCEPTANCE", lines: [{ poLineId: "pl1" }] } as any, FINANCE)
    ).rejects.toThrow("Give the amount accepted for Installation")
  })

  it("refuses more quantity than is left to deliver", async () => {
    arrangePo({ lines: [{ id: "pl1", description: "Firewall", earnKind: "DELIVERY", quantity: d("10"), unitPrice: d("80000"), earningLines: [{ amount: d("640000"), quantity: d("8") }], monthlyEarnings: [] }] })
    await expect(createEarningEvent(DELIVERY_INPUT as any, FINANCE)).rejects.toThrow("Only 2.00 of Firewall is left to deliver")
  })

  it("refuses more amount than is left to accept", async () => {
    arrangePo({ lines: [{ id: "pl1", description: "Installation", earnKind: "ACCEPTANCE", quantity: d("1"), unitPrice: d("150000"), amount: d("150000"), earningLines: [{ amount: d("100000"), quantity: null }], monthlyEarnings: [] }] })
    await expect(
      createEarningEvent({ ...DELIVERY_INPUT, kind: "ACCEPTANCE", lines: [{ poLineId: "pl1", amount: "150000" }] } as any, FINANCE)
    ).rejects.toThrow("Only 50000.00 of Installation is left to accept")
  })

  it("works out a delivery's amount from the PO's unit price", async () => {
    arrangePo({ lines: [{ id: "pl1", description: "Firewall", earnKind: "DELIVERY", quantity: d("10"), unitPrice: d("80000"), amount: d("800000"), earningLines: [], monthlyEarnings: [] }] })

    await createEarningEvent({ poId: "po1", kind: "DELIVERY", date: "2026-09-23", evidenceRef: "CH-118", lines: [{ poLineId: "pl1", quantity: "4" }] } as any, FINANCE)

    expect(prisma.earningEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      lines: { create: [{ poLineId: "pl1", quantity: "4.00", amount: "320000.00" }] },
    }) }))
  })

  it("earns exactly what is left on the last delivery of a line that does not divide evenly (Review Focus 2)", async () => {
    arrangePo({ lines: [{ id: "pl1", description: "Licence", earnKind: "DELIVERY", quantity: d("3"), unitPrice: d("333.33"), amount: d("1000.00"), earningLines: [{ quantity: d("2"), amount: d("666.66") }], monthlyEarnings: [] }] })

    await createEarningEvent({ poId: "po1", kind: "DELIVERY", date: "2026-09-23", evidenceRef: "CH-119", lines: [{ poLineId: "pl1", quantity: "1" }] } as any, FINANCE)

    expect(prisma.earningEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      lines: { create: [{ poLineId: "pl1", quantity: "1.00", amount: "333.34" }] },
    }) }))
  })

  it("works out an acceptance's amount and quantity from what is typed", async () => {
    arrangePo({ lines: [{ id: "pl1", description: "Installation", earnKind: "ACCEPTANCE", quantity: d("1"), unitPrice: d("150000"), amount: d("150000"), earningLines: [], monthlyEarnings: [] }] })

    await createEarningEvent({ poId: "po1", kind: "ACCEPTANCE", date: "2026-09-23", evidenceRef: "SIGNOFF-4", lines: [{ poLineId: "pl1", amount: "150000" }] } as any, FINANCE)

    expect(prisma.earningEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      lines: { create: [{ poLineId: "pl1", amount: "150000.00" }] },
    }) }))
  })
})

describe("getEarningEvent", () => {
  it("404s an event that does not exist", async () => {
    vi.mocked(prisma.earningEvent.findUnique).mockResolvedValue(null)
    await expect(getEarningEvent("nope", FINANCE)).rejects.toThrow("Delivery or acceptance not found")
  })

  it("checks the caller has access to the event's deal", async () => {
    vi.mocked(prisma.earningEvent.findUnique).mockResolvedValue({ id: "ev1", po: { opportunityId: "opp-1" } } as any)
    await getEarningEvent("ev1", FINANCE)
    expect(assertDealAccess).toHaveBeenCalledWith(prisma, FINANCE, "opp-1")
  })
})

describe("poLineEarnRemaining", () => {
  it("works out what is left from every draft or approved event line and every posted monthly earning", () => {
    const r = poLineEarnRemaining({
      amount: d("1000000"), quantity: d("10"),
      earningLines: [{ amount: d("320000"), quantity: d("4") }],
      monthlyEarnings: [{ amount: d("100000") }],
    })
    expect(r.amount.toFixed(2)).toBe("580000.00")
    expect(r.quantity.toFixed(2)).toBe("6.00")
  })
})
