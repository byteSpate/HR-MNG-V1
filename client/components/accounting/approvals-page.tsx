"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"

import { listWaitingForApproval } from "@/lib/api/dealMoney"
import { useSession } from "@/lib/auth/session-context"
import type { DealApprovalKind, WaitingForApprovalRow } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelTable } from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"

const KIND_LABEL: Record<DealApprovalKind, string> = {
  INVOICE: "Invoice",
  SUPPLIER_BILL: "Supplier bill",
  CUSTOMER_CREDIT_NOTE: "Credit note",
  SUPPLIER_CREDIT_NOTE: "Credit note",
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/**
 * Same per-cell-`Link` approach as `deals-page.tsx`'s `dealCell` — `PanelTable`
 * has no row-level `href`, so wrapping each cell's content makes the whole
 * row clickable without changing `record-kit.tsx`.
 */
function approvalCell(href: string, content: ReactNode): TableCell {
  return {
    node: (
      <Link href={href} className="block w-full cursor-pointer truncate">
        {content}
      </Link>
    ),
  }
}

/**
 * The deal money page lives at `<base>/accounting/deals/{dealId}`, a sibling
 * of this page's own `<base>/accounting/approvals`, not a child of it — so
 * the link is built by swapping the trailing segment rather than appending,
 * unlike `DealsPage`'s row links. This preserves whichever of
 * `/finance/accounting` or `/admin/accounting` this page is mounted under.
 */
function rowCells(dealsBase: string, row: WaitingForApprovalRow): TableCell[] {
  const href = `${dealsBase}/${row.dealId}?doc=${row.kind}:${row.id}`
  return [
    approvalCell(href, KIND_LABEL[row.kind]),
    approvalCell(href, row.number),
    approvalCell(href, row.dealSerial),
    approvalCell(href, row.party),
    approvalCell(href, formatMoney(row.amount, "BDT")),
    approvalCell(href, row.preparedBy),
    approvalCell(href, formatDate(row.preparedAt)),
  ]
}

/**
 * The waiting-for-approval queue (Finance/Super Admin,
 * `GET /api/deal-money/approvals`). Rows come back oldest-first from the
 * server and unpaginated — no search box, no pagination controls here.
 */
export function ApprovalsPage() {
  const { accessToken } = useSession()
  const pathname = usePathname()
  const dealsBase = pathname.replace(/\/approvals$/, "/deals")

  const approvals = useQuery({
    queryKey: ["approvals"],
    queryFn: () => listWaitingForApproval(accessToken!),
    enabled: Boolean(accessToken),
  })

  const rows = (approvals.data ?? []).map((row) => rowCells(dealsBase, row))

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Waiting for approval"
        sub="Invoices, supplier bills and credit notes that need a Super Admin."
      />

      <PanelTable
        cols="1fr 1.2fr 0.9fr 1.2fr 0.9fr 1.1fr 0.9fr"
        headers={["What", "Number", "Deal", "Customer or supplier", "Amount", "Prepared by", "Date"]}
        rows={rows}
        isLoading={approvals.isPending}
        isError={approvals.isError}
        onRetry={() => approvals.refetch()}
        emptyTitle="Nothing is waiting for approval."
        emptyBody="A draft invoice, supplier bill or credit note appears here as soon as someone submits it."
        onEmptyAction={() => undefined}
      />
    </div>
  )
}
