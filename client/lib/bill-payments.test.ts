import assert from "node:assert/strict"
import test from "node:test"

import { billPayments, payOneBill } from "./bill-payments"

type Input = Parameters<typeof billPayments>[0]

function bill(over: Partial<Input> = {}): Input {
  return {
    currency: "BDT",
    fxRateToBdt: null,
    lines: [{ amount: "43478.26", vatAmount: "6521.74" }],
    allocations: [],
    creditNotes: [],
    ...over,
  }
}

const pay = (amount: string, number: string, date = "2026-11-01T00:00:00.000Z") => ({
  amount,
  amountUsd: null,
  payment: { id: `p-${number}`, number, date, paymentMethod: "CHEQUE" as const, currency: "BDT" as const },
})

test("a bill with no payment owes all of it", () => {
  const r = billPayments(bill())

  assert.equal(r.gross, "50000.00")
  assert.equal(r.paid, "0.00")
  assert.equal(r.balance, "50000.00")
  assert.deepEqual(r.payments, [])
  assert.equal(r.usd, null)
})

test("the owner's example: a 50k supplier bill paid 20k, then 15k, then 15k", () => {
  const first = billPayments(bill({ allocations: [pay("20000.00", "PV-0001")] }))
  const second = billPayments(bill({ allocations: [pay("20000.00", "PV-0001"), pay("15000.00", "PV-0002")] }))
  const third = billPayments(bill({ allocations: [pay("20000.00", "PV-0001"), pay("15000.00", "PV-0002"), pay("15000.00", "PV-0003")] }))

  assert.deepEqual([first, second, third].map((r) => [r.paid, r.balance]), [
    ["20000.00", "30000.00"],
    ["35000.00", "15000.00"],
    ["50000.00", "0.00"],
  ])
})

test("lists each payment with its voucher number, date, amount and method, in the order given", () => {
  const r = billPayments(bill({ allocations: [pay("20000.00", "PV-0001"), pay("15000.00", "PV-0002", "2026-11-05T00:00:00.000Z")] }))

  assert.deepEqual(r.payments, [
    { paymentId: "p-PV-0001", number: "PV-0001", date: "2026-11-01T00:00:00.000Z", amount: "20000.00", amountUsd: null, method: "CHEQUE" },
    { paymentId: "p-PV-0002", number: "PV-0002", date: "2026-11-05T00:00:00.000Z", amount: "15000.00", amountUsd: null, method: "CHEQUE" },
  ])
})

test("an approved credit note lowers what is owed, and a draft one does not", () => {
  const r = billPayments(
    bill({
      allocations: [pay("20000.00", "PV-0001")],
      creditNotes: [
        { status: "APPROVED", lines: [{ amount: "5000.00", vatAmount: "0.00" }] },
        { status: "DRAFT", lines: [{ amount: "9000.00", vatAmount: "0.00" }] },
      ],
    })
  )

  assert.equal(r.credited, "5000.00")
  assert.equal(r.balance, "25000.00")
})

test("a payment from an older server, with no voucher details, still counts but is not listed", () => {
  const r = billPayments(bill({ allocations: [{ amount: "20000.00", amountUsd: null }, pay("15000.00", "PV-0002")] }))

  assert.equal(r.paid, "35000.00")
  assert.equal(r.balance, "15000.00")
  assert.deepEqual(r.payments.map((p) => p.number), ["PV-0002"])
})

test("adds money exactly, with no floating point drift", () => {
  const r = billPayments(bill({ lines: [{ amount: "0.30", vatAmount: "0.00" }], allocations: [pay("0.10", "PV-0001"), pay("0.20", "PV-0002")] }))

  assert.equal(r.balance, "0.00")
})

test("a bill in US dollars also gives paid and owed in dollars, at the bill's own rate", () => {
  // USD 10,000 at 122.5 is 1,225,000 taka. A payment of USD 4,000 clears 490,000.
  const r = billPayments(
    bill({
      currency: "USD",
      fxRateToBdt: "122.500000",
      lines: [{ amount: "1225000.00", vatAmount: "0.00" }],
      allocations: [{ amount: "490000.00", amountUsd: "4000.00", payment: { id: "p1", number: "PV-0001", date: "2026-11-01T00:00:00.000Z", paymentMethod: "BANK_TRANSFER", currency: "USD" } }],
    })
  )

  assert.equal(r.balance, "735000.00")
  assert.deepEqual(r.usd, { total: "10000.00", paid: "4000.00", balance: "6000.00" })
  assert.deepEqual(r.payments.map((p) => [p.amount, p.amountUsd]), [["490000.00", "4000.00"]])
})

test("a fully paid dollar bill owes zero dollars", () => {
  const r = billPayments(
    bill({
      currency: "USD",
      fxRateToBdt: "122.500000",
      lines: [{ amount: "1225000.00", vatAmount: "0.00" }],
      allocations: [{ amount: "1225000.00", amountUsd: "10000.00", payment: { id: "p1", number: "PV-0001", date: "2026-11-01T00:00:00.000Z", paymentMethod: "BANK_TRANSFER", currency: "USD" } }],
    })
  )

  assert.equal(r.balance, "0.00")
  assert.equal(r.usd?.balance, "0.00")
})

test("one payment from a bill's own row puts everything paid on that bill, and flags too much", () => {
  assert.deepEqual(payOneBill("15000.00", "30000.00"), { amount: "15000.00", tooMuch: false })
  assert.deepEqual(payOneBill("30000.00", "30000.00"), { amount: "30000.00", tooMuch: false })
  assert.deepEqual(payOneBill("30000.01", "30000.00"), { amount: "30000.01", tooMuch: true })
  assert.deepEqual(payOneBill("", "30000.00"), { amount: "0.00", tooMuch: false })
})
