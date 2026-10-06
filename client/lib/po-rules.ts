import { fromPaisa, toPaisa } from "../components/accounting/accounting-shared"
import type { CustomerPoStatus } from "./api/types"

/**
 * An Opportunity has one PO. A cancelled PO does not count, so a new one can
 * be recorded after a cancel. The server enforces this too. This only decides
 * whether to offer the button.
 */
export function canRecordPo(pos: Array<{ status: CustomerPoStatus }>): boolean {
  return pos.every((po) => po.status === "CANCELLED")
}

const paisa = (value: string): number => {
  const n = toPaisa(value)
  return Number.isNaN(n) ? 0 : n
}

export interface LineToBill {
  poLineId: string
  description: string
  /** All that is left on this PO line. */
  amount: string
}

/**
 * What one invoice must bill: every PO line that still has something left, in
 * full. On a new PO that is every line and its whole amount. An older PO that
 * was part billed before the one-invoice rule gets one last invoice for all
 * that remains. The server refuses anything else.
 */
export function linesToBill(po: {
  lines: Array<{ id: string; description: string; amount: string; invoiceLines: Array<{ amount: string }> }>
}): LineToBill[] {
  return po.lines.flatMap((l) => {
    const left = paisa(l.amount) - l.invoiceLines.reduce((sum, il) => sum + paisa(il.amount), 0)
    return left > 0 ? [{ poLineId: l.id, description: l.description, amount: fromPaisa(left) }] : []
  })
}
