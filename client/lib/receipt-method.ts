import type { ReceiptPaymentMethod } from "@/lib/api/types"

/** In the order Finance sees them. Kept in step with the server by hand. */
export const RECEIPT_PAYMENT_METHODS: readonly ReceiptPaymentMethod[] = ["CASH", "BANK_TRANSFER", "CHEQUE", "MOBILE_BANKING"]

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
