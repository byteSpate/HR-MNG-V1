"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"

import { getDealMoney } from "@/lib/api/dealMoney"
import { useSession } from "@/lib/auth/session-context"
import type { DealApprovalKind, DealMoneyNotRecorded, DealMoneyRecorded } from "@/lib/api/types"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Skeleton } from "@/components/ui/skeleton"
import { BoughtPart } from "@/components/money/bought-part"
import { InvoicedPart } from "@/components/money/invoiced-part"
import { MoneyNumbers } from "@/components/money/money-numbers"
import { PaidPart } from "@/components/money/paid-part"
import { PoPart } from "@/components/money/po-part"

/**
 * A draft document to open and highlight, carried from the Waiting-for-
 * approval queue's link ("Each row opens the deal page with that draft
 * highlighted" — deal-money design doc). Not read yet: a Customer PO carries
 * no draft state, so nothing here can show a highlight for one. `InvoicedPart`
 * (Task 20) reads it for `"INVOICE"` and `"CUSTOMER_CREDIT_NOTE"`. Task 21's
 * `BoughtPart` will read it for `"SUPPLIER_BILL"` and `"SUPPLIER_CREDIT_NOTE"`.
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
function hasAnyDraft(data: DealMoneyRecorded): boolean {
  const draftInvoices = data.invoices.some(
    (inv) => inv.status === "DRAFT" || inv.creditNotes.some((cn) => cn.status === "DRAFT")
  )
  const draftBills = (data.bills ?? []).some(
    (bill) => bill.status === "DRAFT" || bill.creditNotes.some((cn) => cn.status === "DRAFT")
  )
  return draftInvoices || draftBills
}

/** A YYYY-MM-DD day, written the way the Money parts write a date. Read
 *  as UTC so the day never shifts in a time zone behind UTC. */
function formatDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  })
}

/**
 * A deal whose money this app does not record: one plain sentence, no
 * numbers and no buttons. Zeros would claim the deal sold nothing, and every
 * button would only be refused by the server (final review Fix 3).
 */
function MoneyNotRecorded({ data }: { data: DealMoneyNotRecorded }) {
  return (
    <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
      <h2 className="font-heading text-[15px] font-bold tracking-tight">Money</h2>
      <p className={`mt-1.5 text-[12.5px] leading-relaxed ${TONE.muted}`}>
        {data.notRecordedReason === "WON_BEFORE_GO_LIVE"
          ? `This deal was won before ${formatDay(data.goLiveDate)}. Its money is not recorded here.`
          : "This deal is not won. Money is recorded here only for a won deal."}
      </p>
    </div>
  )
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
 * Numbers, Customer PO, Invoiced and Paid exist (deal-money-simplify Tasks
 * 19-20). Task 21 adds `<BoughtPart />` below `<PaidPart />`, reading fields
 * already present on this same `money` payload — no second query.
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

  if (!data.moneyAllowed) return <MoneyNotRecorded data={data} />

  return (
    <div className="space-y-5">
      <MoneyNumbers numbers={data.numbers} canSeeCost={data.canSeeCost} hasDrafts={hasAnyDraft(data)} />
      <PoPart opportunityId={opportunityId} pos={data.pos} invalidate={invalidate} />
      <InvoicedPart
        invoices={data.invoices}
        pos={data.pos}
        customer={data.deal.customer}
        canEdit={data.canEdit}
        invalidate={invalidate}
        highlight={highlight}
      />
      <PaidPart
        opportunityId={opportunityId}
        receipts={data.receipts}
        invoices={data.invoices}
        canEdit={data.canEdit}
        invalidate={invalidate}
      />
      {data.canSeeCost ? (
        <BoughtPart
          opportunityId={opportunityId}
          // Non-null: `bills`/`supplierPayments` are only ever null when
          // `canSeeCost` is false (server doc comment on `DealMoney`), and
          // this branch only renders when it is true.
          bills={data.bills!}
          supplierPayments={data.supplierPayments!}
          productLines={data.productLines}
          canEdit={data.canEdit}
          invalidate={invalidate}
          highlight={highlight}
        />
      ) : null}
    </div>
  )
}
