import { beforeEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "../../generated/prisma/client"

vi.mock("../../config/prisma", () => ({
  default: { expenseClaim: { findMany: vi.fn() } },
}))

import prisma from "../../config/prisma"
import { getOutstandingExpenseReimbursements } from "./expense.outstanding"

const D = (value: string) => new Prisma.Decimal(value)

function claim(overrides: Record<string, unknown> = {}) {
  return {
    id: "claim-1",
    name: "Client taxi",
    employee: { id: "emp-1", fullName: "Ayesha Rahman", employeeCode: "BS-EMP-001" },
    category: { code: "TRAVEL", name: "Travel and conveyance" },
    reviewedAt: new Date("2026-08-29T04:01:30.407Z"),
    amount: D("1200.00"),
    currency: "BDT",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getOutstandingExpenseReimbursements", () => {
  it("queries only approved claims linked to neither payroll nor a settlement, oldest first", async () => {
    vi.mocked(prisma.expenseClaim.findMany).mockResolvedValue([])

    await getOutstandingExpenseReimbursements(new Date("2026-09-01T12:00:00.000Z"))

    expect(prisma.expenseClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "APPROVED", payslipId: null, settlementId: null },
        orderBy: [{ reviewedAt: "asc" }, { id: "asc" }],
      })
    )
  })

  it("returns the employee, claim, approval date and elapsed whole-day age", async () => {
    vi.mocked(prisma.expenseClaim.findMany).mockResolvedValue([claim()] as never)

    const result = await getOutstandingExpenseReimbursements(
      new Date("2026-09-01T04:01:30.407Z")
    )

    expect(result.rows).toEqual([
      {
        id: "claim-1",
        employee: { id: "emp-1", fullName: "Ayesha Rahman", employeeCode: "BS-EMP-001" },
        name: "Client taxi",
        category: { code: "TRAVEL", name: "Travel and conveyance" },
        approvedAt: "2026-08-29T04:01:30.407Z",
        ageDays: 3,
        amount: "1200.00",
        currency: "BDT",
      },
    ])
  })

  it("keeps totals separate by currency and adds decimal money exactly", async () => {
    vi.mocked(prisma.expenseClaim.findMany).mockResolvedValue([
      claim({ id: "claim-1", amount: D("0.10") }),
      claim({ id: "claim-2", amount: D("0.20") }),
      claim({ id: "claim-3", currency: "USD", amount: D("15.75") }),
    ] as never)

    const result = await getOutstandingExpenseReimbursements(
      new Date("2026-09-01T12:00:00.000Z")
    )

    expect(result.totals).toEqual({
      claims: 3,
      byCurrency: [
        { currency: "BDT", claims: 2, amount: "0.30" },
        { currency: "USD", claims: 1, amount: "15.75" },
      ],
    })
  })
})
