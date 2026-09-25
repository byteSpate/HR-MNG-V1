"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import { getDealMoney } from "@/lib/api/dealMoney"
import { useSession } from "@/lib/auth/session-context"
import type { DealApprovalKind, DealMoney } from "@/lib/api/types"
import { PanelAlert, toMessage } from "@/components/dashboard/record-kit"
import { Skeleton } from "@/components/ui/skeleton"
import { MoneyNumbers } from "@/components/money/money-numbers"
import { PoPart } from "@/components/money/po-part"

/**
 * A draft document to open and highlight, carried from the Waiting-for-
 * approval queue's link ("Each row opens the deal page with that draft
 * highlighted" — deal-money design doc). Not read yet: a Customer PO carries
 * no draft state, so nothing in this task's parts can show a highlight.
 * Tasks 20 and 21 read it once Invoiced and Bought (the parts that hold
 * drafts) exist.
 */
export interface MoneyHighlight {
  kind: DealApprovalKind
  id: string
}

/**
 * The one invalidation every write anywhere in the Money section must run,
 * kept in one place so Tasks 20 and 21's parts call the exact same thing
 * rather than re-deriving the key list:
 * - `deal-money` — this section's own numbers and documents.
 * - `deals` — the Deals list's Sold/Cost/Profit/Still-owed columns and its
 *   Waiting count for this deal.
 * - `approvals` — the Waiting-for-approval queue and its dashboard badge.
 */
export function useDealMoneyInvalidate(opportunityId: string): () => void {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ["deal-money", opportunityId] })
    queryClient.invalidateQueries({ queryKey: ["deals"] })
    queryClient.invalidateQueries({ queryKey: ["approvals"] })
  }
}

/**
 * Any draft anywhere in the payload. Customer POs carry no draft state (a PO
 * needs no approval — design doc, "The documents"), so this only ever looks
 * at invoices, bills and their credit notes.
 *
 * `bills` is `null`, not an empty array, for a viewer who cannot see cost —
 * `?? []` there correctly leaves their draft count to invoices only, since
 * they never see supplier documents at all.
 */
function hasAnyDraft(data: DealMoney): boolean {
  const draftInvoices = data.invoices.some(
    (inv) => inv.status === "DRAFT" || inv.creditNotes.some((cn) => cn.status === "DRAFT")
  )
  const draftBills = (data.bills ?? []).some(
    (bill) => bill.status === "DRAFT" || bill.creditNotes.some((cn) => cn.status === "DRAFT")
  )
  return draftInvoices || draftBills
}

function MoneySkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-md border border-[#E4E9EF] bg-white px-5 py-4">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="mt-2.5 h-6 w-24" />
          </div>
        ))}
      </div>
      <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-16 w-full" />
      </div>
    </div>
  )
}

/**
 * The deal's whole Money section: one query, every part stacked top to
 * bottom. The same component mounts in two places (the Sales Hub deal page,
 * and the standalone deal money page — Task 22), so both show the same
 * thing from the same fetch.
 *
 * Only Numbers and Customer PO exist yet (deal-money-simplify Task 19).
 * Tasks 20 and 21 add `<InvoicedPart />`, `<PaidPart />` and `<BoughtPart />`
 * below `<PoPart />`, each reading fields already present on this same
 * `money` payload — no second query.
 */
export function MoneySection({
  opportunityId,
  highlight,
}: {
  opportunityId: string
  /** From the Waiting-for-approval queue's link. See `MoneyHighlight`. */
  highlight?: MoneyHighlight | null
}) {
  const { accessToken } = useSession()
  // Plumbed through for Tasks 20/21, which read it once they have a draft to
  // scroll to and open. Nothing in this task's parts consumes it.
  void highlight

  const invalidate = useDealMoneyInvalidate(opportunityId)

  const money = useQuery({
    queryKey: ["deal-money", opportunityId],
    queryFn: () => getDealMoney(accessToken!, opportunityId),
    enabled: Boolean(accessToken),
  })

  // Loading, error and "here is the data" are three different screens: a
  // skeleton shaped like the real layout, the server's own refusal sentence,
  // and only then the actual numbers and parts.
  if (money.isPending) return <MoneySkeleton />

  if (money.isError) return <PanelAlert>{toMessage(money.error)}</PanelAlert>

  const data = money.data

  return (
    <div className="space-y-5">
      <MoneyNumbers numbers={data.numbers} canSeeCost={data.canSeeCost} hasDrafts={hasAnyDraft(data)} />
      <PoPart opportunityId={opportunityId} pos={data.pos} invalidate={invalidate} />
    </div>
  )
}
