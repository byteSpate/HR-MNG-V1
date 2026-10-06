import assert from "node:assert/strict"
import test from "node:test"

import { invoicePayments, payOneInvoice } from "./invoice-payments"

type Input = Parameters<typeof invoicePayments>[0]

function invoice(over: Partial<Input> = {}): Input {
  return {
    lines: [{ amount: "43478.26", vatAmount: "6521.74" }],
    allocations: [],
    creditNotes: [],
    ...over,
  }
}

const pay = (amount: string, number: string, date = "2026-11-01T00:00:00.000Z") => ({
  amount,
  receipt: { id: `r-${number}`, number, date, paymentMethod: "BANK_TRANSFER" as const },
})

test("an invoice with no payment owes all of it", () => {
  const r = invoicePayments(invoice())

  assert.equal(r.gross, "50000.00")
  assert.equal(r.paid, "0.00")
  assert.equal(r.balance, "50000.00")
  assert.deepEqual(r.payments, [])
})

test("the owner's example: 50k invoice, paid 20k, then 15k, then 15k", () => {
  const first = invoicePayments(invoice({ allocations: [pay("20000.00", "MR-0001")] }))
  const second = invoicePayments(invoice({ allocations: [pay("20000.00", "MR-0001"), pay("15000.00", "MR-0002")] }))
  const third = invoicePayments(invoice({ allocations: [pay("20000.00", "MR-0001"), pay("15000.00", "MR-0002"), pay("15000.00", "MR-0003")] }))

  assert.deepEqual([first, second, third].map((r) => [r.paid, r.balance]), [
    ["20000.00", "30000.00"],
    ["35000.00", "15000.00"],
    ["50000.00", "0.00"],
  ])
})

test("lists each payment with its number, date, amount and method, in the order given", () => {
  const r = invoicePayments(invoice({ allocations: [pay("20000.00", "MR-0001", "2026-11-01T00:00:00.000Z"), pay("15000.00", "MR-0002", "2026-11-05T00:00:00.000Z")] }))

  assert.deepEqual(r.payments, [
    { receiptId: "r-MR-0001", number: "MR-0001", date: "2026-11-01T00:00:00.000Z", amount: "20000.00", method: "BANK_TRANSFER" },
    { receiptId: "r-MR-0002", number: "MR-0002", date: "2026-11-05T00:00:00.000Z", amount: "15000.00", method: "BANK_TRANSFER" },
  ])
})

test("an approved credit note lowers what is owed, and a draft one does not", () => {
  const r = invoicePayments(
    invoice({
      allocations: [pay("20000.00", "MR-0001")],
      creditNotes: [
        { status: "APPROVED", lines: [{ amount: "5000.00", vatAmount: "0.00" }] },
        { status: "DRAFT", lines: [{ amount: "9000.00", vatAmount: "0.00" }] },
      ],
    })
  )

  assert.equal(r.credited, "5000.00")
  assert.equal(r.balance, "25000.00")
})

test("a payment from an older server, with no receipt details, still counts but is not listed", () => {
  const r = invoicePayments(invoice({ allocations: [{ amount: "20000.00" }, pay("15000.00", "MR-0002")] }))

  assert.equal(r.paid, "35000.00")
  assert.equal(r.balance, "15000.00")
  assert.deepEqual(r.payments.map((p) => p.number), ["MR-0002"])
})

test("adds money exactly, with no floating point drift", () => {
  const r = invoicePayments(
    invoice({ lines: [{ amount: "0.30", vatAmount: "0.00" }], allocations: [pay("0.10", "MR-0001"), pay("0.20", "MR-0002")] })
  )

  assert.equal(r.balance, "0.00")
})

test("a fully paid invoice has a zero balance, never a negative one from rounding", () => {
  const r = invoicePayments(invoice({ allocations: [pay("50000.00", "MR-0001")] }))

  assert.equal(r.balance, "0.00")
})

test("one payment on a single invoice settles exactly what was received plus tax kept back", () => {
  assert.deepEqual(payOneInvoice("15000.00", "30000.00"), { amount: "15000.00", tooMuch: false })
  assert.deepEqual(payOneInvoice("30000.00", "30000.00"), { amount: "30000.00", tooMuch: false })
})

test("a payment bigger than what is owed is flagged, so Save stays off", () => {
  assert.deepEqual(payOneInvoice("30000.01", "30000.00"), { amount: "30000.01", tooMuch: true })
})

test("nothing typed yet settles nothing and is not too much", () => {
  assert.deepEqual(payOneInvoice("", "30000.00"), { amount: "0.00", tooMuch: false })
})
