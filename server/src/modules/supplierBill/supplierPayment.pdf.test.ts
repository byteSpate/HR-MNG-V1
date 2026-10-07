import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { buildPaymentVoucherData, buildPaymentVoucherHtml, type PaymentVoucherSource } from "./supplierPayment.pdf"

const d = (v: string) => new Prisma.Decimal(v)
const COMPANY = { name: "ByteSpate Ltd", address: "Dhaka", logo: null }

/** A 50k supplier bill, and the second payment on it: 15k, leaving 15k. */
function arrange(over: Partial<PaymentVoucherSource> = {}): PaymentVoucherSource {
  return {
    id: "p2",
    number: "PV-0002",
    date: new Date("2026-11-10"),
    amount: d("15000"),
    sourceAmount: null,
    currency: "BDT",
    fxRateToBdt: null,
    reference: null,
    paymentMethod: "BANK_TRANSFER",
    bankName: "MTB",
    status: "APPROVED",
    reversedAt: null,
    reversalReason: null,
    supplier: { name: "Star Tech" },
    opportunity: { serial: "BS-OPP-00001", name: "Core banking" },
    recordedBy: "Rina Akter",
    allocations: [
      {
        amount: d("15000"), amountUsd: null,
        billTotal: d("50000"), balanceAfter: d("15000"), billTotalUsd: null, balanceAfterUsd: null,
        bill: { billNumber: "SUP-INV-77", currency: "BDT" },
      },
    ],
    ...over,
  }
}

const USD = arrange({
  amount: d("490000"), sourceAmount: d("4000"), currency: "USD", fxRateToBdt: d("122.5"),
  allocations: [
    {
      amount: d("490000"), amountUsd: d("4000"),
      billTotal: d("1225000"), balanceAfter: d("735000"), billTotalUsd: d("10000"), balanceAfterUsd: d("6000"),
      bill: { billNumber: "SUP-INV-90", currency: "USD" },
    },
  ],
})

describe("the figures on a payment voucher", () => {
  it("prints the bill total and balance that were saved with the payment, under the supplier's own bill number", () => {
    expect(buildPaymentVoucherData(arrange()).bills).toEqual([
      { billNumber: "SUP-INV-77", billTotal: "50000.00", thisPayment: "15000.00", balanceAfter: "15000.00" },
    ])
  })

  it("carries the number, supplier, method, bank, reference and who recorded it", () => {
    const data = buildPaymentVoucherData(arrange({ reference: "CHQ-5521" }))

    expect(data).toMatchObject({
      number: "PV-0002",
      supplierName: "Star Tech",
      opportunityLabel: "BS-OPP-00001 Core banking",
      currency: "BDT",
      paidFromBank: "15000.00",
      methodLabel: "Bank transfer",
      bankName: "MTB",
      reference: "CHQ-5521",
      recordedBy: "Rina Akter",
      reversed: null,
      usd: null,
    })
  })

  it("for a US dollar payment, prints the dollars, the payment rate and the taka that left the bank, and the bill figures in dollars", () => {
    const data = buildPaymentVoucherData(USD)

    expect(data.currency).toBe("USD")
    expect(data.usd).toEqual({ paid: "4000.00", rate: "122.500000" })
    expect(data.paidFromBank).toBe("490000.00")
    expect(data.bills).toEqual([
      { billNumber: "SUP-INV-90", billTotal: "10000.00", thisPayment: "4000.00", balanceAfter: "6000.00" },
    ])
  })

  it("says Not recorded for an old payment with no method", () => {
    const data = buildPaymentVoucherData(arrange({ paymentMethod: null, bankName: null }))

    expect(data.methodLabel).toBe("Not recorded")
    expect(data.bankName).toBeNull()
  })

  it.each([
    ["BANK_TRANSFER", "Bank transfer"],
    ["CHEQUE", "Cheque"],
    ["MOBILE_BANKING", "Mobile banking"],
  ] as const)("labels %s as %s", (paymentMethod, label) => {
    expect(buildPaymentVoucherData(arrange({ paymentMethod })).methodLabel).toBe(label)
  })

  it("keeps the number, the amounts and the saved balance of a reversed payment", () => {
    const data = buildPaymentVoucherData(arrange({ status: "REVERSED", reversedAt: new Date("2026-11-12"), reversalReason: "Paid twice" }))

    expect(data.number).toBe("PV-0002")
    expect(data.bills[0].balanceAfter).toBe("15000.00")
    expect(data.reversed).toEqual({ on: "12 Nov 2026", reason: "Paid twice" })
  })
})

describe("buildPaymentVoucherHtml", () => {
  it("prints the heading, the number, the bill number and the balance column", () => {
    const html = buildPaymentVoucherHtml(buildPaymentVoucherData(arrange()), COMPANY)

    expect(html).toContain("Payment Voucher")
    expect(html).toContain("PV-0002")
    expect(html).toContain("SUP-INV-77")
    expect(html).toContain("Balance after this payment")
    expect(html).toContain("All amounts are in BDT.")
    expect(html).not.toContain("REVERSED")
  })

  it("for a US dollar payment, says so and shows the rate", () => {
    const html = buildPaymentVoucherHtml(buildPaymentVoucherData(USD), COMPANY)

    expect(html).toContain("All amounts are in USD.")
    expect(html).toContain("122.50")
    expect(html).toContain("Paid from the bank")
  })

  it("escapes names, so markup in a supplier name is not printed as markup", () => {
    const html = buildPaymentVoucherHtml(buildPaymentVoucherData(arrange({ supplier: { name: "<script>alert(1)</script>" } })), COMPANY)

    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("shows a REVERSED banner with the reason, and still shows the saved balance", () => {
    const html = buildPaymentVoucherHtml(
      buildPaymentVoucherData(arrange({ status: "REVERSED", reversedAt: new Date("2026-11-12"), reversalReason: "Paid twice" })),
      COMPANY
    )

    expect(html).toContain("REVERSED")
    expect(html).toContain("Paid twice")
    expect(html).toContain("PV-0002")
    expect(html).toContain("Balance after this payment")
  })

  it("shows the bank and the reference only when there is one", () => {
    const plain = buildPaymentVoucherHtml(buildPaymentVoucherData(arrange({ bankName: null })), COMPANY)
    const withRef = buildPaymentVoucherHtml(buildPaymentVoucherData(arrange({ reference: "CHQ-5521" })), COMPANY)

    expect(plain).not.toContain("Bank name")
    expect(plain).not.toContain("Reference")
    expect(withRef).toContain("CHQ-5521")
  })

  it("has no em-dash anywhere on the page", () => {
    const html = buildPaymentVoucherHtml(buildPaymentVoucherData(arrange({ paymentMethod: null, bankName: null })), COMPANY)

    expect(html).not.toContain("—")
  })
})
