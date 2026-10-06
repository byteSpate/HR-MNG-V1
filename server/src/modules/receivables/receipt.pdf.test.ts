import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { buildReceiptHtml, buildReceiptPdfData, type ReceiptPdfSource } from "./receipt.pdf"

const d = (v: string) => new Prisma.Decimal(v)
const COMPANY = { name: "ByteSpate Ltd", address: "Dhaka", logo: null }

type Sibling = { id: string; at: string; amount: string; status?: "APPROVED" | "REVERSED" }

/** One invoice of 1,000 paid by several receipts. `me` is the receipt being printed. */
function arrange(me: string, siblings: Sibling[], over: Partial<ReceiptPdfSource> = {}): ReceiptPdfSource {
  const mine = siblings.find((s) => s.id === me)!
  return {
    id: me,
    number: `MR-${me}`,
    date: new Date("2026-11-10"),
    createdAt: new Date(mine.at),
    amount: d(mine.amount),
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
    allocations: [
      {
        amount: d(mine.amount),
        invoice: {
          invoiceNumber: "INV-1",
          lines: [{ amount: d("870"), vatAmount: d("130") }],
          creditNotes: [],
          allocations: siblings.map((s) => ({
            amount: d(s.amount),
            receipt: { id: s.id, createdAt: new Date(s.at), status: s.status ?? "APPROVED" },
          })),
        },
      },
    ],
    ...over,
  }
}

const THREE: Sibling[] = [
  { id: "1", at: "2026-11-01T10:00:00Z", amount: "300" },
  { id: "2", at: "2026-11-05T10:00:00Z", amount: "400" },
  { id: "3", at: "2026-11-09T10:00:00Z", amount: "300" },
]
const FIRST_ONLY = THREE.slice(0, 1)

describe("balance after this payment", () => {
  it("gives 700, 300 and 0 for three payments on an invoice of 1,000", () => {
    expect(buildReceiptPdfData(arrange("1", THREE)).invoices[0].balanceAfter).toBe("700.00")
    expect(buildReceiptPdfData(arrange("2", THREE)).invoices[0].balanceAfter).toBe("300.00")
    expect(buildReceiptPdfData(arrange("3", THREE)).invoices[0].balanceAfter).toBe("0.00")
  })

  it("does not change on the first receipt when later payments arrive", () => {
    const onlyFirst = buildReceiptPdfData(arrange("1", FIRST_ONLY))
    const withLater = buildReceiptPdfData(arrange("1", THREE))

    expect(withLater.invoices[0].balanceAfter).toBe(onlyFirst.invoices[0].balanceAfter)
  })

  it("does not count an earlier receipt that was reversed", () => {
    const siblings: Sibling[] = [{ ...THREE[0], status: "REVERSED" }, THREE[1]]

    expect(buildReceiptPdfData(arrange("2", siblings)).invoices[0].balanceAfter).toBe("600.00")
  })

  it("breaks a tie on the saved time by receipt id, so the order is always the same", () => {
    const same = "2026-11-01T10:00:00Z"
    const siblings: Sibling[] = [
      { id: "a", at: same, amount: "100" },
      { id: "b", at: same, amount: "100" },
    ]

    expect(buildReceiptPdfData(arrange("a", siblings)).invoices[0].balanceAfter).toBe("900.00")
    expect(buildReceiptPdfData(arrange("b", siblings)).invoices[0].balanceAfter).toBe("800.00")
  })

  it("takes off a credit note approved before the receipt was saved", () => {
    const src = arrange("1", FIRST_ONLY)
    src.allocations[0].invoice.creditNotes = [
      { approvedAt: new Date("2026-10-30T10:00:00Z"), lines: [{ amount: d("100"), vatAmount: d("0") }] },
    ]

    const data = buildReceiptPdfData(src)

    expect(data.invoices[0].invoiceTotal).toBe("900.00")
    expect(data.invoices[0].balanceAfter).toBe("600.00")
  })

  it("ignores a credit note approved after the receipt was saved", () => {
    const src = arrange("1", FIRST_ONLY)
    src.allocations[0].invoice.creditNotes = [
      { approvedAt: new Date("2026-11-20T10:00:00Z"), lines: [{ amount: d("100"), vatAmount: d("0") }] },
    ]

    expect(buildReceiptPdfData(src).invoices[0].balanceAfter).toBe("700.00")
  })

  it("ignores a credit note that was never approved", () => {
    const src = arrange("1", FIRST_ONLY)
    src.allocations[0].invoice.creditNotes = [
      { approvedAt: null, lines: [{ amount: d("100"), vatAmount: d("0") }] },
    ]

    expect(buildReceiptPdfData(src).invoices[0].balanceAfter).toBe("700.00")
  })

  it("shows a balance for each invoice when one receipt pays two", () => {
    const src = arrange("1", FIRST_ONLY)
    src.allocations.push({
      amount: d("200"),
      invoice: {
        invoiceNumber: "INV-2",
        lines: [{ amount: d("500"), vatAmount: d("0") }],
        creditNotes: [],
        allocations: [{ amount: d("200"), receipt: { id: "1", createdAt: new Date(THREE[0].at), status: "APPROVED" } }],
      },
    })

    const data = buildReceiptPdfData(src)

    expect(data.invoices.map((i) => [i.invoiceNumber, i.thisPayment, i.balanceAfter])).toEqual([
      ["INV-1", "300.00", "700.00"],
      ["INV-2", "200.00", "300.00"],
    ])
  })

  it("adds money exactly, with no floating point drift", () => {
    const siblings: Sibling[] = [
      { id: "1", at: "2026-11-01T10:00:00Z", amount: "0.10" },
      { id: "2", at: "2026-11-02T10:00:00Z", amount: "0.20" },
    ]
    const src = arrange("2", siblings)
    src.allocations[0].invoice.lines = [{ amount: d("0.30"), vatAmount: d("0") }]

    expect(buildReceiptPdfData(src).invoices[0].balanceAfter).toBe("0.00")
  })
})

describe("the figures on a receipt", () => {
  it("carries the number, cash, tax kept back, method, bank and who recorded it", () => {
    const data = buildReceiptPdfData(arrange("1", FIRST_ONLY, { vdsAmount: d("20"), aitAmount: d("10"), reference: "TT-55" }))

    expect(data).toMatchObject({
      number: "MR-1",
      customerName: "Bengal Group",
      opportunityLabel: "BS-OPP-00001 Core banking",
      cash: "300.00",
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
    const data = buildReceiptPdfData(arrange("1", FIRST_ONLY, { paymentMethod: null, bankName: null }))

    expect(data.methodLabel).toBe("Not recorded")
    expect(data.bankName).toBeNull()
  })

  it.each([
    ["CASH", "Cash"],
    ["BANK_TRANSFER", "Bank transfer"],
    ["CHEQUE", "Cheque"],
    ["MOBILE_BANKING", "Mobile banking"],
  ] as const)("labels %s as %s", (paymentMethod, label) => {
    expect(buildReceiptPdfData(arrange("1", FIRST_ONLY, { paymentMethod })).methodLabel).toBe(label)
  })

  it("keeps the number and the amounts of a reversed receipt, and leaves out the balances", () => {
    const data = buildReceiptPdfData(
      arrange("1", FIRST_ONLY, { status: "REVERSED", reversedAt: new Date("2026-11-12"), reversalReason: "Cheque bounced" })
    )

    expect(data.number).toBe("MR-1")
    expect(data.cash).toBe("300.00")
    expect(data.invoices[0].thisPayment).toBe("300.00")
    expect(data.invoices[0].balanceAfter).toBeNull()
    expect(data.reversed).toEqual({ on: "12 Nov 2026", reason: "Cheque bounced" })
  })
})

describe("buildReceiptHtml", () => {
  it("prints the number, the invoices and the balance column", () => {
    const html = buildReceiptHtml(buildReceiptPdfData(arrange("1", FIRST_ONLY)), COMPANY)

    expect(html).toContain("Money Receipt")
    expect(html).toContain("MR-1")
    expect(html).toContain("INV-1")
    expect(html).toContain("Balance after this payment")
    expect(html).not.toContain("REVERSED")
  })

  it("escapes names, so markup in a customer name is not printed as markup", () => {
    const html = buildReceiptHtml(
      buildReceiptPdfData(arrange("1", FIRST_ONLY, { customer: { legalName: "<script>alert(1)</script>" } })),
      COMPANY
    )

    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("shows a REVERSED banner with the reason, and no balance column", () => {
    const html = buildReceiptHtml(
      buildReceiptPdfData(arrange("1", FIRST_ONLY, { status: "REVERSED", reversedAt: new Date("2026-11-12"), reversalReason: "Cheque bounced" })),
      COMPANY
    )

    expect(html).toContain("REVERSED")
    expect(html).toContain("Cheque bounced")
    expect(html).toContain("MR-1")
    expect(html).not.toContain("Balance after this payment")
  })

  it("shows tax kept back only when there is some, and the bank only when there is one", () => {
    const plain = buildReceiptHtml(buildReceiptPdfData(arrange("1", FIRST_ONLY, { bankName: null })), COMPANY)
    const withTax = buildReceiptHtml(buildReceiptPdfData(arrange("1", FIRST_ONLY, { vdsAmount: d("20") })), COMPANY)

    expect(plain).not.toContain("VAT kept back")
    expect(plain).not.toContain("Bank:")
    expect(withTax).toContain("VAT kept back")
  })

  it("has no em-dash anywhere on the page", () => {
    const html = buildReceiptHtml(buildReceiptPdfData(arrange("1", FIRST_ONLY, { paymentMethod: null, bankName: null })), COMPANY)

    expect(html).not.toContain("—")
  })
})
