"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"

import { listDealMoney } from "@/lib/api/dealMoney"
import { useSession } from "@/lib/auth/session-context"
import type { DealMoneyListRow } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelTable } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import type { TableCell } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** `dealMoney.list.ts`'s `PAGE_SIZE` — fixed server-side, not sent in the response. */
const PAGE_SIZE = 50

/**
 * `PanelTable`/`DataTable` has no row-level `href` today (checked: it flattens
 * a row's cells into one grid on desktop and only wraps a row on the mobile
 * card view, neither of which a caller can attach a click to). Wrapping every
 * cell's own content in a `Link` gets the same result — click anywhere in the
 * row and it navigates — without changing `record-kit.tsx`.
 */
function dealCell(href: string, content: ReactNode): TableCell {
  return {
    node: (
      <Link href={href} className="block w-full cursor-pointer truncate pointer-coarse:min-h-10 pointer-coarse:min-w-10 pointer-coarse:py-3">
        {content}
      </Link>
    ),
  }
}

function rowCells(pathname: string, row: DealMoneyListRow): TableCell[] {
  const href = `${pathname}/${row.id}`
  return [
    dealCell(
      href,
      <>
        <div className="truncate text-body-sm font-semibold text-ink-body">{row.serial}</div>
        <div className="mt-0.5 truncate text-caption text-ink-muted">{row.name}</div>
      </>
    ),
    dealCell(href, row.customerName ?? "No customer"),
    dealCell(href, formatMoney(row.sold, "BDT")),
    dealCell(href, formatMoney(row.cost, "BDT")),
    dealCell(href, formatMoney(row.profit, "BDT")),
    dealCell(href, formatMoney(row.stillOwed, "BDT")),
    dealCell(href, row.waiting > 0 ? <Tag label={`${row.waiting} waiting`} tone="yellow" /> : null),
  ]
}

/**
 * The Deals list (Finance/Super Admin, `GET /api/deal-money/deals`). No
 * `canSeeCost` gating here, unlike the Money section itself: the whole route
 * is Finance-or-Super-Admin only server-side, so `cost`/`profit` are always
 * present.
 */
export function DealsPage() {
  const { accessToken } = useSession()
  const pathname = usePathname()
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  const deals = useQuery({
    queryKey: ["deals", search, page],
    queryFn: () => listDealMoney(accessToken!, { search: search || undefined, page }),
    enabled: Boolean(accessToken),
  })

  const rows = (deals.data?.rows ?? []).map((row) => rowCells(pathname, row))
  const total = deals.data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4">
      <PageHeader kicker="Accounting" title="Opportunities" sub="Every Opportunity won since go-live, and its money." />

      {/* Hidden while the first page loads: a count beside a skeleton reads
          as an answer, and a search box over nothing loaded yet invites a
          query that will just restart once real data lands. Once the user
          has typed, the box stays even through a background refetch. */}
      {deals.isSuccess || Boolean(search) ? (
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Search by Opportunity, customer, PO, invoice or bill number"
          className="max-w-md"
        />
      ) : null}

      <PanelTable
        cols="1.6fr 1.2fr 0.9fr 0.9fr 0.9fr 0.9fr 1fr"
        headers={["Opportunity", "Customer", "Sold", "Cost", "Profit", "Still owed", "Waiting"]}
        rows={rows}
        isLoading={deals.isPending}
        isError={deals.isError}
        onRetry={() => deals.refetch()}
        emptyTitle={search ? `No Opportunity matches '${search}'.` : "No Opportunities won since go-live yet."}
        emptyBody={
          search
            ? "Try a different Opportunity, customer, PO, invoice or bill number."
            : "An Opportunity appears here as soon as it is marked Won."
        }
        onEmptyAction={() => undefined}
      />

      {total > 0 ? (
        <div className="flex items-center justify-between text-caption text-ink-muted">
          <span>
            Page {page} of {lastPage}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
