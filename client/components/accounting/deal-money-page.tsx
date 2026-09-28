"use client"

import { Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { RiArrowRightUpLine } from "@remixicon/react"

import { getDealMoney } from "@/lib/api/dealMoney"
import { useSession } from "@/lib/auth/session-context"
import type { DealApprovalKind } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert, toMessage } from "@/components/dashboard/record-kit"
import { MoneySection, type MoneyHighlight } from "@/components/money/money-section"
import { Skeleton } from "@/components/ui/skeleton"

const APPROVAL_KINDS: DealApprovalKind[] = [
  "INVOICE",
  "SUPPLIER_BILL",
  "CUSTOMER_CREDIT_NOTE",
  "SUPPLIER_CREDIT_NOTE",
]

/**
 * Reads the `?doc=<kind>:<id>` contract this page defines for the Money
 * section's highlight (see `MoneySection`'s `MoneyHighlight`). Nothing
 * upstream produces this link yet: the Waiting-for-approval queue is a later
 * task and will need to match this exact shape. A missing or malformed value
 * degrades to no highlight rather than an error, since a stale or hand-typed
 * link is not the user's fault.
 */
function parseHighlight(raw: string | null): MoneyHighlight | null {
  if (!raw) return null
  const sep = raw.indexOf(":")
  if (sep < 0) return null
  const kind = raw.slice(0, sep)
  const id = raw.slice(sep + 1)
  if (!id || !APPROVAL_KINDS.includes(kind as DealApprovalKind)) return null
  return { kind: kind as DealApprovalKind, id }
}

function DealMoneyPageSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2 pt-5 pb-4 sm:pt-7 sm:pb-5.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-3 w-48" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-md border border-[#E4E9EF] bg-white px-5 py-4">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="mt-2.5 h-6 w-24" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The standalone deal money page (finance/admin accounting, `deals/[id]`).
 * Reads the deal's own info for its title using the exact same query key
 * `MoneySection` uses internally for the same deal, so TanStack Query
 * dedupes the two into one request and one shared cache entry rather than
 * fetching twice.
 */
function DealMoneyPageInner({ opportunityId }: { opportunityId: string }) {
  const { accessToken } = useSession()
  const searchParams = useSearchParams()
  const highlight = parseHighlight(searchParams.get("doc"))

  const money = useQuery({
    queryKey: ["deal-money", opportunityId],
    queryFn: () => getDealMoney(accessToken!, opportunityId),
    enabled: Boolean(accessToken),
  })

  if (money.isPending) return <DealMoneyPageSkeleton />

  if (money.isError) return <PanelAlert>{toMessage(money.error)}</PanelAlert>

  const { deal } = money.data

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Accounting"
        title={`${deal.serial} · ${deal.name}`}
        sub="The deal's own money, in one place."
        aside={
          <Link
            href={`/sales/opportunities/${opportunityId}`}
            className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#5F6B7C] hover:text-[#1C2733] hover:underline"
          >
            Open in Sales Hub
            <RiArrowRightUpLine className="size-3.5" aria-hidden />
          </Link>
        }
      />

      <MoneySection opportunityId={opportunityId} highlight={highlight} />
    </div>
  )
}

export function DealMoneyPage({ opportunityId }: { opportunityId: string }) {
  // useSearchParams forces client rendering up to the nearest Suspense
  // boundary (Next.js 16) — same pattern as invoice-page.tsx's own `?po=`.
  return (
    <Suspense fallback={<DealMoneyPageSkeleton />}>
      <DealMoneyPageInner opportunityId={opportunityId} />
    </Suspense>
  )
}
