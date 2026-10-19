import type { PaymentRow } from "@/lib/api/types"

/** The words for an invoice's payment status (owner, 2026-10-18). */
export const STATUS_WORD: Record<PaymentRow["status"], string> = {
  PAID: "Paid",
  PART_PAID: "Part paid",
  UNPAID: "Unpaid",
  OVERDUE: "Overdue",
}

/** "40%", "33.3%", or a dash when the invoice total is 0, never NaN% or 0%. */
export function percentText(percent: number | null): string {
  return percent === null ? "-" : `${percent}%`
}
