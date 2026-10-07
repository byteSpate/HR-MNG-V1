import { describe, expect, it } from "vitest"
import { createSupplierPaymentSchema } from "./supplierPayment.validators"

const BASE = {
  opportunityId: "11111111-1111-4111-8111-111111111111",
  supplierId: "33333333-3333-4333-8333-333333333333",
  date: "2026-11-10",
  amount: "1000",
  allocations: [{ billId: "22222222-2222-4222-8222-222222222222", amount: "1000" }],
}

describe("createSupplierPaymentSchema payment method", () => {
  it("refuses a payment with no method, and says what to do", () => {
    const r = createSupplierPaymentSchema.safeParse(BASE)

    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.find((i) => i.path[0] === "paymentMethod")?.message).toBe("Pick how the money was paid.")
    }
  })

  it.each(["BANK_TRANSFER", "CHEQUE", "MOBILE_BANKING"])("accepts %s", (paymentMethod) => {
    expect(createSupplierPaymentSchema.safeParse({ ...BASE, paymentMethod }).success).toBe(true)
  })

  it("refuses Cash, because the books post every payment to the bank", () => {
    expect(createSupplierPaymentSchema.safeParse({ ...BASE, paymentMethod: "CASH" }).success).toBe(false)
  })
})

describe("createSupplierPaymentSchema bank name", () => {
  it("is optional", () => {
    expect(createSupplierPaymentSchema.safeParse({ ...BASE, paymentMethod: "CHEQUE" }).success).toBe(true)
  })

  it("is trimmed", () => {
    expect(createSupplierPaymentSchema.parse({ ...BASE, paymentMethod: "CHEQUE", bankName: "  MTB  " }).bankName).toBe("MTB")
  })

  it("refuses more than 100 characters", () => {
    expect(createSupplierPaymentSchema.safeParse({ ...BASE, paymentMethod: "CHEQUE", bankName: "x".repeat(101) }).success).toBe(false)
  })
})
