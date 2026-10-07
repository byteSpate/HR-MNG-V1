import type { SupplierPaymentMethod } from "@/lib/api/types"

/** In the order Finance sees them. No Cash: every payment posts to the bank.
 *  Kept in step with the server by hand. */
export const SUPPLIER_PAYMENT_METHODS: readonly SupplierPaymentMethod[] = ["BANK_TRANSFER", "CHEQUE", "MOBILE_BANKING"]

const LABEL: Record<SupplierPaymentMethod, string> = {
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  MOBILE_BANKING: "Mobile banking",
}

/** A payment saved before the method existed has none. */
export function supplierMethodLabel(method: SupplierPaymentMethod | null): string {
  return method ? LABEL[method] : "Not recorded"
}
