import { fromPaisa, toPaisa } from "../components/accounting/accounting-shared"
import type { SupplierPaymentMethod } from "./api/types"

/** The parts of a supplier bill on the Money section that the payment figures need. */
export interface BillMoneyInput {
  currency: "BDT" | "USD"
  fxRateToBdt: string | null
  lines: Array<{ amount: string; vatAmount: string }>
  /** Approved payments. `payment` is missing when the server is older than the client. */
  allocations: Array<{
    amount: string
    amountUsd: string | null
    payment?: { id: string; number: string; date: string; paymentMethod: SupplierPaymentMethod | null; currency: "BDT" | "USD" }
  }>
  creditNotes: Array<{ status: string; lines: Array<{ amount: string; vatAmount: string }> }>
}

export interface BillPayment {
  paymentId: string
  number: string
  date: string
  /** Taka cleared against the bill. */
  amount: string
  /** Dollars paid, only for a payment in US dollars. */
  amountUsd: string | null
  method: SupplierPaymentMethod | null
}

export interface BillPayments {
  gross: string
  credited: string
  paid: string
  /** What is still owed, in taka: gross, less approved credit notes, less payments. */
  balance: string
  /** The same in dollars, only for a bill in US dollars, at the bill's own rate. */
  usd: { total: string; paid: string; balance: string } | null
  payments: BillPayment[]
}

/** A half-typed or missing amount counts as nothing, never as NaN. */
const paisa = (value: string | null): number => {
  if (value === null) return 0
  const n = toPaisa(value)
  return Number.isNaN(n) ? 0 : n
}

/**
 * Paid so far, still owed and the list of payments for one supplier bill. The
 * one place the client works out "still owed" for a bill, in whole paisa so it
 * agrees with the server's Decimal figure. A payment with no voucher details
 * (an older server) counts toward what is paid but is not listed.
 */
export function billPayments(bill: BillMoneyInput): BillPayments {
  const gross = bill.lines.reduce((total, l) => total + paisa(l.amount) + paisa(l.vatAmount), 0)
  const credited = bill.creditNotes
    .filter((note) => note.status === "APPROVED")
    .reduce((total, note) => total + note.lines.reduce((s, l) => s + paisa(l.amount) + paisa(l.vatAmount), 0), 0)
  const paid = bill.allocations.reduce((total, a) => total + paisa(a.amount), 0)
  const balance = gross - credited - paid

  const rate = bill.currency === "USD" ? Number(bill.fxRateToBdt) : 0
  const toUsd = (taka: number) => fromPaisa(Math.round(taka / rate))
  const paidUsd = bill.allocations.reduce((total, a) => total + paisa(a.amountUsd), 0)

  return {
    gross: fromPaisa(gross),
    credited: fromPaisa(credited),
    paid: fromPaisa(paid),
    balance: fromPaisa(balance),
    usd: rate > 0 ? { total: toUsd(gross - credited), paid: fromPaisa(paidUsd), balance: toUsd(balance) } : null,
    payments: bill.allocations.flatMap((a) =>
      a.payment
        ? [{
            paymentId: a.payment.id,
            number: a.payment.number,
            date: a.payment.date,
            amount: fromPaisa(paisa(a.amount)),
            amountUsd: a.amountUsd === null ? null : fromPaisa(paisa(a.amountUsd)),
            method: a.payment.paymentMethod,
          }]
        : []
    ),
  }
}

/**
 * Paying from one bill's own row: everything paid goes to that bill, so nothing
 * is typed twice. `tooMuch` is true when it is more than the bill still owes.
 * Both figures are in the payment's currency.
 */
export function payOneBill(amount: string, balance: string): { amount: string; tooMuch: boolean } {
  const paid = paisa(amount)
  return { amount: fromPaisa(paid), tooMuch: paid > paisa(balance) }
}
