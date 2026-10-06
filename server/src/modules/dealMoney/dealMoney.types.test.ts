import { describe, expect, it } from "vitest"
import { DEAL_INVOICE_INCLUDE } from "./dealMoney.types"

describe("DEAL_INVOICE_INCLUDE.allocations", () => {
  const allocations = DEAL_INVOICE_INCLUDE.allocations as any

  it("counts only payments from approved receipts, so a reversed one never lowers what is owed", () => {
    expect(allocations.where).toEqual({ receipt: { status: "APPROVED" } })
  })

  it("sends the amount with the number, date and method of the receipt behind it", () => {
    expect(allocations.select.amount).toBe(true)
    expect(allocations.select.receipt.select).toEqual({ id: true, number: true, date: true, paymentMethod: true })
  })

  it("lists the payments oldest first, with the id as a tie-break, so the order never moves", () => {
    expect(allocations.orderBy).toEqual([{ receipt: { createdAt: "asc" } }, { id: "asc" }])
  })
})
