import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { resolveLineVat } from "./receivables.vat"
import { poLineSchema } from "./customerPo.validators"

const rates = new Map([["code-15", new Prisma.Decimal("15.00")]])
const amount = new Prisma.Decimal("1000.00")

describe("resolveLineVat", () => {
  it("uses the VAT code's rate and saves it on the line", () => {
    expect(resolveLineVat({ vatCodeId: "code-15", vatMethod: "CODE" }, rates, amount)).toEqual({
      vatCodeId: "code-15", vatMethod: "CODE", vatRatePercent: "15.00", vatAmount: "150.00",
    })
  })

  it("uses a typed rate and still keeps the VAT code", () => {
    expect(resolveLineVat({ vatCodeId: "code-15", vatMethod: "MANUAL", vatRatePercent: "7.5" }, rates, amount)).toEqual({
      vatCodeId: "code-15", vatMethod: "MANUAL", vatRatePercent: "7.50", vatAmount: "75.00",
    })
  })

  it("allows a typed rate of 0", () => {
    expect(resolveLineVat({ vatCodeId: "code-15", vatMethod: "MANUAL", vatRatePercent: "0" }, rates, amount).vatAmount).toBe("0.00")
  })

  it("rounds to the paisa like the code rate does", () => {
    const r = resolveLineVat({ vatCodeId: "code-15", vatMethod: "MANUAL", vatRatePercent: "7.25" }, rates, new Prisma.Decimal("333.33"))
    expect(r.vatAmount).toBe("24.17")
  })
})

describe("PO line VAT choice (Review Focus 1)", () => {
  const base = { description: "Firewall", kind: "GOODS", quantity: "1", unitPrice: "100", vatCodeId: "11111111-1111-4111-8111-111111111111" }

  it("defaults to the VAT code", () => {
    expect(poLineSchema.parse(base).vatMethod).toBe("CODE")
  })

  it("refuses a typed method with no rate", () => {
    const result = poLineSchema.safeParse({ ...base, vatMethod: "MANUAL" })
    expect(result.success).toBe(false)
    expect(result.error!.issues[0].message).toBe("Type the VAT %, or choose a VAT code.")
  })

  it("refuses a rate over 100 or with three decimals", () => {
    expect(poLineSchema.safeParse({ ...base, vatMethod: "MANUAL", vatRatePercent: "100.01" }).success).toBe(false)
    expect(poLineSchema.safeParse({ ...base, vatMethod: "MANUAL", vatRatePercent: "7.555" }).success).toBe(false)
  })
})
