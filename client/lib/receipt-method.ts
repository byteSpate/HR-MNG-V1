import type { ReceiptPaymentMethod } from "@/lib/api/types"

/** What Finance can pick for a new receipt, in this order. No Cash: every receipt posts
 *  to the bank account, so Cash is only a label on a receipt saved before this change.
 *  Kept in step with the server by hand. */
export const RECEIPT_PAYMENT_METHODS: readonly ReceiptPaymentMethod[] = ["BANK_TRANSFER", "CHEQUE", "MOBILE_BANKING"]

const LABEL: Record<ReceiptPaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  MOBILE_BANKING: "Mobile banking",
}

/** A receipt saved before the method existed has none. */
export function paymentMethodLabel(method: ReceiptPaymentMethod | null): string {
  return method ? LABEL[method] : "Not recorded"
}
