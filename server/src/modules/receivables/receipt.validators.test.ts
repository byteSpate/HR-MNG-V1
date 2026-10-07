import { describe, expect, it } from "vitest"
import { createReceiptSchema } from "./receipt.validators"

const BASE = {
  opportunityId: "11111111-1111-4111-8111-111111111111",
  date: "2026-11-10",
  amount: "1000",
  allocations: [{ invoiceId: "22222222-2222-4222-8222-222222222222", amount: "1000" }],
}

describe("createReceiptSchema payment method", () => {
  it("refuses a receipt with no payment method, and says what to do", () => {
    const r = createReceiptSchema.safeParse(BASE)

    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === "paymentMethod")
      expect(issue?.message).toBe("Pick how the money was paid.")
    }
  })

  it.each(["BANK_TRANSFER", "CHEQUE", "MOBILE_BANKING"])("accepts %s", (paymentMethod) => {
    expect(createReceiptSchema.safeParse({ ...BASE, paymentMethod }).success).toBe(true)
  })

  it("refuses Cash, because the books post every receipt to the bank", () => {
    const r = createReceiptSchema.safeParse({ ...BASE, paymentMethod: "CASH" })

    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.find((i) => i.path[0] === "paymentMethod")?.message).toBe("Pick how the money was paid.")
    }
  })

  it("refuses a method that is not on the list", () => {
    const r = createReceiptSchema.safeParse({ ...BASE, paymentMethod: "BITCOIN" })

    expect(r.success).toBe(false)
  })
})

describe("createReceiptSchema bank name", () => {
  it("is optional", () => {
    expect(createReceiptSchema.safeParse({ ...BASE, paymentMethod: "CHEQUE" }).success).toBe(true)
  })

  it("is trimmed", () => {
    const r = createReceiptSchema.parse({ ...BASE, paymentMethod: "BANK_TRANSFER", bankName: "  MTB  " })

    expect(r.bankName).toBe("MTB")
  })

  it("refuses more than 100 characters", () => {
    const r = createReceiptSchema.safeParse({ ...BASE, paymentMethod: "BANK_TRANSFER", bankName: "x".repeat(101) })

    expect(r.success).toBe(false)
  })
})
