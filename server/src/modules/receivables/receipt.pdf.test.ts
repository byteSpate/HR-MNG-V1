import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { buildReceiptHtml, buildReceiptPdfData, type ReceiptPdfSource } from "./receipt.pdf"

const d = (v: string) => new Prisma.Decimal(v)
const COMPANY = { name: "ByteSpate Ltd", address: "Dhaka", logo: null }

/** A 50k invoice, and the second payment on it: 15k, leaving 15k. */
function arrange(over: Partial<ReceiptPdfSource> = {}): ReceiptPdfSource {
  return {
    id: "r2",
    number: "MR-0002",
    date: new Date("2026-11-10"),
    amount: d("15000"),
    vdsAmount: d("0"),
    aitAmount: d("0"),
    reference: null,
    paymentMethod: "BANK_TRANSFER",
    bankName: "MTB",
    status: "APPROVED",
    reversedAt: null,
    reversalReason: null,
    customer: { legalName: "Bengal Group" },
    opportunity: { serial: "BS-OPP-00001", name: "Core banking" },
    recordedBy: "Rina Akter",
    allocations: [{ amount: d("15000"), invoiceTotal: d("50000"), balanceAfter: d("15000"), invoice: { invoiceNumber: "INV-1" } }],
    ...over,
  }
}

describe("the figures on a receipt", () => {
  it("prints the invoice total and balance that were saved with the payment", () => {
    const data = buildReceiptPdfData(arrange())

    expect(data.invoices).toEqual([
      { invoiceNumber: "INV-1", invoiceTotal: "50000.00", thisPayment: "15000.00", balanceAfter: "15000.00" },
    ])
  })

  it("prints one row for each invoice the receipt pays", () => {
    const data = buildReceiptPdfData(
      arrange({
        allocations: [
          { amount: d("300"), invoiceTotal: d("1000"), balanceAfter: d("700"), invoice: { invoiceNumber: "INV-1" } },
          { amount: d("200"), invoiceTotal: d("500"), balanceAfter: d("300"), invoice: { invoiceNumber: "INV-2" } },
        ],
      })
    )

    expect(data.invoices.map((i) => [i.invoiceNumber, i.thisPayment, i.balanceAfter])).toEqual([
      ["INV-1", "300.00", "700.00"],
      ["INV-2", "200.00", "300.00"],
    ])
  })

  it("carries the number, cash, tax kept back, method, bank and who recorded it", () => {
    const data = buildReceiptPdfData(arrange({ vdsAmount: d("20"), aitAmount: d("10"), reference: "TT-55" }))

    expect(data).toMatchObject({
      number: "MR-0002",
      customerName: "Bengal Group",
      opportunityLabel: "BS-OPP-00001 Core banking",
      cash: "15000.00",
      vds: "20.00",
      ait: "10.00",
      methodLabel: "Bank transfer",
      bankName: "MTB",
      reference: "TT-55",
      recordedBy: "Rina Akter",
      reversed: null,
    })
  })

  it("says Not recorded for an old receipt with no method", () => {
    const data = buildReceiptPdfData(arrange({ paymentMethod: null, bankName: null }))

    expect(data.methodLabel).toBe("Not recorded")
    expect(data.bankName).toBeNull()
  })

  it.each([
    ["CASH", "Cash"],
    ["BANK_TRANSFER", "Bank transfer"],
    ["CHEQUE", "Cheque"],
    ["MOBILE_BANKING", "Mobile banking"],
  ] as const)("labels %s as %s", (paymentMethod, label) => {
    expect(buildReceiptPdfData(arrange({ paymentMethod })).methodLabel).toBe(label)
  })

  it("keeps the number, the amounts and the saved balance of a reversed receipt", () => {
    const data = buildReceiptPdfData(arrange({ status: "REVERSED", reversedAt: new Date("2026-11-12"), reversalReason: "Cheque bounced" }))

    expect(data.number).toBe("MR-0002")
    expect(data.cash).toBe("15000.00")
    expect(data.invoices[0].balanceAfter).toBe("15000.00")
    expect(data.reversed).toEqual({ on: "12 Nov 2026", reason: "Cheque bounced" })
  })
})

describe("buildReceiptHtml", () => {
  it("prints the number, the invoices and the balance column", () => {
    const html = buildReceiptHtml(buildReceiptPdfData(arrange()), COMPANY)

    expect(html).toContain("Money Receipt")
    expect(html).toContain("MR-0002")
    expect(html).toContain("INV-1")
    expect(html).toContain("Balance after this payment")
    expect(html).not.toContain("REVERSED")
  })

  it("escapes names, so markup in a customer name is not printed as markup", () => {
    const html = buildReceiptHtml(buildReceiptPdfData(arrange({ customer: { legalName: "<script>alert(1)</script>" } })), COMPANY)

    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("shows a REVERSED banner with the reason, and still shows the saved balance", () => {
    const html = buildReceiptHtml(
      buildReceiptPdfData(arrange({ status: "REVERSED", reversedAt: new Date("2026-11-12"), reversalReason: "Cheque bounced" })),
      COMPANY
    )

    expect(html).toContain("REVERSED")
    expect(html).toContain("Cheque bounced")
    expect(html).toContain("MR-0002")
    expect(html).toContain("Balance after this payment")
  })

  it("shows tax kept back only when there is some, and the bank only when there is one", () => {
    const plain = buildReceiptHtml(buildReceiptPdfData(arrange({ bankName: null })), COMPANY)
    const withTax = buildReceiptHtml(buildReceiptPdfData(arrange({ vdsAmount: d("20") })), COMPANY)

    expect(plain).not.toContain("VAT kept back")
    expect(plain).not.toContain("Bank name")
    expect(withTax).toContain("VAT kept back")
  })

  it("has no em-dash anywhere on the page", () => {
    const html = buildReceiptHtml(buildReceiptPdfData(arrange({ paymentMethod: null, bankName: null })), COMPANY)

    expect(html).not.toContain("—")
  })
})
