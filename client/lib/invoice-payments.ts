import { fromPaisa, toPaisa } from "../components/accounting/accounting-shared"
import type { ReceiptPaymentMethod } from "./api/types"

interface Lines {
  lines: Array<{ amount: string; vatAmount: string }>
}

/** The parts of an invoice on the Money section that the payment figures need. */
export interface InvoiceMoneyInput {
  lines: Lines["lines"]
  /** Approved payments. `receipt` is missing when the server is older than the client. */
  allocations: Array<{
    amount: string
    receipt?: { id: string; number: string; date: string; paymentMethod: ReceiptPaymentMethod | null }
  }>
  creditNotes: Array<Lines & { status: string }>
}

export interface InvoicePayment {
  receiptId: string
  number: string
  date: string
  amount: string
  method: ReceiptPaymentMethod | null
}

export interface InvoicePayments {
  gross: string
  credited: string
  paid: string
  /** What is still owed: gross, less approved credit notes, less payments. */
  balance: string
  payments: InvoicePayment[]
}

/** A half-typed or missing amount counts as nothing, never as NaN. */
const paisa = (value: string): number => {
  const n = toPaisa(value)
  return Number.isNaN(n) ? 0 : n
}

const sum = (values: string[]): number => values.reduce((total, v) => total + paisa(v), 0)

/**
 * Paid so far, still owed and the list of payments for one invoice. The one
 * place the client works out "still owed", in whole paisa so it agrees with
 * the server's Decimal figure. A payment with no receipt details (an older
 * server) counts toward what is paid but is not listed.
 */
export function invoicePayments(inv: InvoiceMoneyInput): InvoicePayments {
  const gross = inv.lines.reduce((total, l) => total + paisa(l.amount) + paisa(l.vatAmount), 0)
  const credited = inv.creditNotes
    .filter((note) => note.status === "APPROVED")
    .reduce((total, note) => total + note.lines.reduce((s, l) => s + paisa(l.amount) + paisa(l.vatAmount), 0), 0)
  const paid = sum(inv.allocations.map((a) => a.amount))

  return {
    gross: fromPaisa(gross),
    credited: fromPaisa(credited),
    paid: fromPaisa(paid),
    balance: fromPaisa(gross - credited - paid),
    payments: inv.allocations.flatMap((a) =>
      a.receipt
        ? [{ receiptId: a.receipt.id, number: a.receipt.number, date: a.receipt.date, amount: fromPaisa(paisa(a.amount)), method: a.receipt.paymentMethod }]
        : []
    ),
  }
}

/**
 * Recording a payment from one invoice's own row: everything received (cash
 * plus tax the customer kept back) goes to that invoice, so nothing is typed
 * twice. `tooMuch` is true when it is more than the invoice still owes.
 */
export function payOneInvoice(settled: string, balance: string): { amount: string; tooMuch: boolean } {
  const amount = paisa(settled)
  return { amount: fromPaisa(amount), tooMuch: amount > paisa(balance) }
}
