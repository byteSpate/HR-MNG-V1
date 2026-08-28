import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const tx = {
    expenseClaim: { update: vi.fn(), delete: vi.fn() },
    expenseCategory: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  }
  return {
    default: {
      expenseClaim: { findUnique: vi.fn() },
      expenseAttachment: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  }
})

vi.mock("../attendance/attendance.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../attendance/attendance.service")>()),
  requireEmployeeForUser: vi.fn(async () => ({ id: "emp-self" })),
}))
vi.mock("../attendance/attendance.time", () => ({
  officeToday: () => new Date("2026-08-15T00:00:00.000Z"),
}))
vi.mock("../media/media.service", () => ({ destroyAsset: vi.fn() }))
vi.mock("./expense.posting", () => ({ postExpenseAccrual: vi.fn() }))
vi.mock("../notification/notification.mailer", () => ({ sendExpenseDecidedEmail: vi.fn() }))

import prisma from "../../config/prisma"
import { destroyAsset } from "../media/media.service"
import { dec } from "../payroll/payroll.money"
import { deleteClaim, updateClaim } from "./expense.service"
import type { AccessTokenPayload } from "../auth/auth.types"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tx = (prisma as any).__tx as {
  expenseClaim: { update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
  expenseCategory: { findUnique: ReturnType<typeof vi.fn> }
}

const OWNER = { sub: "user-1", role: "EMPLOYEE", email: "a@b.com", mustChangePassword: false } as AccessTokenPayload

/** `emp-self` is what the mocked `requireEmployeeForUser` returns. */
function claim(over: Record<string, unknown> = {}) {
  vi.mocked(prisma.expenseClaim.findUnique).mockResolvedValue({
    id: "claim-1",
    employeeId: "emp-self",
    status: "PENDING",
    name: "Water jar",
    amount: dec(1200),
    currency: "BDT",
    categoryId: "cat-other",
    expenseDate: new Date("2026-08-03T00:00:00.000Z"),
    travelFrom: null,
    travelTo: null,
    ...over,
  } as never)
}

const category = (code: string) =>
  tx.expenseCategory.findUnique.mockResolvedValue({ id: "cat-x", code, name: code } as never)

beforeEach(() => {
  vi.clearAllMocks()
  category("OTHER")
  tx.expenseClaim.update.mockResolvedValue({
    id: "claim-1",
    name: "Water jar",
    amount: dec(1200),
    currency: "BDT",
    categoryId: "cat-x",
    expenseDate: new Date("2026-08-03T00:00:00.000Z"),
  } as never)
  vi.mocked(prisma.expenseAttachment.findMany).mockResolvedValue([] as never)
})

describe("who may change a claim", () => {
  it("lets the owner edit their own pending claim", async () => {
    claim()
    await expect(updateClaim(OWNER, "claim-1", { name: "Water jar x2" })).resolves.toBeTruthy()
  })

  it("refuses somebody else's claim", async () => {
    claim({ employeeId: "emp-other" })
    await expect(updateClaim(OWNER, "claim-1", { name: "x" })).rejects.toThrow(
      "your own expense claims"
    )
  })

  /**
   * The rule that matters. An approved claim's figures are the basis of a
   * decision somebody made, and a REIMBURSED one is joined to a payslip that
   * already paid the amount — editing either rewrites history.
   */
  it.each(["APPROVED", "REJECTED", "REIMBURSED"])("refuses a %s claim", async (status) => {
    claim({ status })
    await expect(updateClaim(OWNER, "claim-1", { name: "x" })).rejects.toThrow(
      `already been ${status.toLowerCase()}`
    )
    expect(tx.expenseClaim.update).not.toHaveBeenCalled()
  })
})

describe("editing", () => {
  // Without this an edit is a way round the limits creation enforces.
  it("re-applies the future-date rule", async () => {
    claim()
    await expect(
      updateClaim(OWNER, "claim-1", { expenseDate: "2026-09-01" })
    ).rejects.toThrow("cannot be dated in the future")
  })

  it("re-applies the 90-day age limit", async () => {
    claim()
    await expect(
      updateClaim(OWNER, "claim-1", { expenseDate: "2026-05-16" })
    ).rejects.toThrow("must be submitted within")
  })

  it("leaves untouched fields alone", async () => {
    claim()
    await updateClaim(OWNER, "claim-1", { name: "New name" })

    const data = tx.expenseClaim.update.mock.calls[0][0].data as Record<string, unknown>
    expect(data.name).toBe("New name")
    expect(data.amount).toBeUndefined()
    expect(data.currency).toBeUndefined()
  })

  // An omitted key means "leave it", so clearing needs an explicit null.
  it("treats an explicit null description as a clear", async () => {
    claim()
    await updateClaim(OWNER, "claim-1", { description: null })

    const data = tx.expenseClaim.update.mock.calls[0][0].data as Record<string, unknown>
    expect(data).toHaveProperty("description", null)
  })

  // Otherwise the report prints a journey against a stationery bill.
  it("drops the route when the claim moves off a travel category", async () => {
    claim({ travelFrom: "Gulshan 1", travelTo: "Motijheel" })
    category("STATIONERY")

    await updateClaim(OWNER, "claim-1", { categoryId: "11111111-1111-4111-8111-111111111111" })

    const data = tx.expenseClaim.update.mock.calls[0][0].data as Record<string, unknown>
    expect(data.travelFrom).toBeNull()
    expect(data.travelTo).toBeNull()
  })

  it("keeps the route when the category still carries one", async () => {
    claim({ travelFrom: "Gulshan 1", travelTo: "Motijheel" })
    category("TRAVEL")

    await updateClaim(OWNER, "claim-1", { name: "Client visit" })

    const data = tx.expenseClaim.update.mock.calls[0][0].data as Record<string, unknown>
    expect(data.travelFrom).toBe("Gulshan 1")
  })
})

describe("withdrawing", () => {
  it("deletes the claim", async () => {
    claim()
    await deleteClaim(OWNER, "claim-1")
    expect(tx.expenseClaim.delete).toHaveBeenCalledWith({ where: { id: "claim-1" } })
  })

  /**
   * `ExpenseAttachment` cascades, so dropping the claim takes the rows and
   * would leave the Cloudinary files behind with nothing pointing at them.
   */
  it("destroys the receipt blobs first, so none is orphaned", async () => {
    claim()
    vi.mocked(prisma.expenseAttachment.findMany).mockResolvedValue([
      { publicId: "hr/expenses/claim-1/a" },
      { publicId: "hr/expenses/claim-1/b" },
    ] as never)

    await deleteClaim(OWNER, "claim-1")

    expect(destroyAsset).toHaveBeenCalledWith("hr/expenses/claim-1/a")
    expect(destroyAsset).toHaveBeenCalledWith("hr/expenses/claim-1/b")
  })

  it("refuses a decided claim, and destroys nothing", async () => {
    claim({ status: "APPROVED" })
    await expect(deleteClaim(OWNER, "claim-1")).rejects.toThrow("already been approved")
    expect(destroyAsset).not.toHaveBeenCalled()
    expect(tx.expenseClaim.delete).not.toHaveBeenCalled()
  })

  it("refuses somebody else's", async () => {
    claim({ employeeId: "emp-other" })
    await expect(deleteClaim(OWNER, "claim-1")).rejects.toThrow("your own expense claims")
  })
})
