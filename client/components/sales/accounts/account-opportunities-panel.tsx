"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"

import { getAccountMargin } from "@/lib/api/sales/accounts"
import { listOpportunities } from "@/lib/api/sales/opportunities"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { SalesAccountSummary } from "@/lib/api/types"
import { taka } from "@/components/sales/shared/sales-shared"
import { OPPORTUNITY_STATUS_LABEL, OPPORTUNITY_STATUS_TONE, stageSentence } from "@/components/sales/shared/sales-shared"
import { Tag } from "@/components/dashboard/tag"
import { Panel, PanelError, PanelHeading, PanelSkeleton } from "@/components/sales/shared/panel"
import { OpportunityFormDialog } from "@/components/sales/opportunities/opportunity-form-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * "Margin won": the profit on the account's won deals, added up by the
 * server. Loading, broken and "nothing won yet" each get their own line, so a
 * failed read never passes for an account that has made nothing.
 */
function MarginWon({ accountId }: { accountId: string }) {
  const { accessToken } = useSession()
  const marginQuery = useQuery({
    queryKey: salesKeys.accountMargin(accountId),
    queryFn: () => getAccountMargin(accessToken!, accountId),
    enabled: !!accessToken,
  })

  if (marginQuery.isPending) return <Skeleton className="mb-3 h-4 w-48" />
  if (marginQuery.isError) {
    return (
      <p className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-[#B03A3A]">
        Margin won could not be loaded.
        <button type="button" onClick={() => marginQuery.refetch()} className="font-bold underline">
          Try again
        </button>
      </p>
    )
  }

  const { value, counted, missing, dealsWithoutProducts } = marginQuery.data
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  const amount = Number(value) < 0 ? `a loss of ${taka(String(-Number(value)))}` : taka(value)
  // What could not be counted, named rather than folded in as zero.
  const gaps = [
    missing > 0 ? `${count(missing, "product")} with no margin yet` : null,
    dealsWithoutProducts > 0 ? `${count(dealsWithoutProducts, "won Opportunity")} with no products` : null,
  ]
    .filter(Boolean)
    .join(", and ")
  const nothingWon = counted === 0 && missing === 0 && dealsWithoutProducts === 0
  return (
    <p className="mb-3 text-[12.5px] leading-relaxed text-[#5F6B7C]">
      <span className="font-semibold text-[#1C2733]">Margin won: </span>
      {nothingWon
        ? "no Opportunities won on this account yet."
        : counted === 0
          ? `no margin yet — ${gaps}.`
          : `${amount} from ${count(counted, "product")} on won Opportunities${gaps ? `, not counting ${gaps}` : ""}.`}
    </p>
  )
}

/**
 * The account's deals, and the one place a new deal is started from.
 *
 * Deals are open only to the people who work the account. Asking the server
 * on behalf of anybody else returns an empty list, which would read as "this
 * account has no deals" — a claim nobody checked — so the list is not
 * requested for a read-only viewer at all, and the panel says why instead.
 */
export function AccountOpportunitiesPanel({ account }: { account: SalesAccountSummary }) {
  const { accessToken } = useSession()
  const [createOpen, setCreateOpen] = useState(false)

  const dealsQuery = useQuery({
    queryKey: salesKeys.opportunities({ salesAccountId: account.id }),
    queryFn: () => listOpportunities(accessToken!, { salesAccountId: account.id }),
    enabled: !!accessToken && account.canManage,
  })

  if (!account.canManage) {
    return (
      <Panel>
        <PanelHeading title="Opportunities" />
        <p className="text-[12.5px] leading-relaxed text-[#5F6B7C]">
          Only the owner, the collaborators and Sales Admins can open the Opportunities on this account.
        </p>
      </Panel>
    )
  }
  if (dealsQuery.isPending) return <PanelSkeleton />
  if (dealsQuery.isError) return <PanelError onRetry={() => dealsQuery.refetch()} />

  const deals = dealsQuery.data.items

  return (
    <Panel>
      <PanelHeading
        title="Opportunities"
        action={
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-auto rounded-md bg-[#17191C] px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
          >
            New opportunity
          </Button>
        }
      />
      {deals.length > 0 ? <MarginWon accountId={account.id} /> : null}
      {deals.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-[#5F6B7C]">
          No Opportunities on this account yet. An Opportunity is one thing we may sell here, like a
          firewall upgrade or a switching refresh. It has its own stage, value and next step.
        </p>
      ) : (
        <ul className="-mx-2 divide-y divide-[#EEF1F5]">
          {deals.map((deal) => (
            <li key={deal.id}>
              <Link
                href={`/sales/opportunities/${deal.id}`}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-[#F7F9FB] focus-visible:ring-2 focus-visible:ring-[#17191C]/25 focus-visible:outline-none"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-mono text-[11.5px] text-[#5F6B7C]">{deal.serial}</span>
                    <span className="truncate text-[13px] font-semibold">{deal.name}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-[#5F6B7C]">
                    {stageSentence(deal.status, deal.stage)} · {deal.ownerName}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  {/* No price yet, never ৳0. */}
                  <span className={deal.amount === null ? "text-[12.5px] text-[#5F6B7C]" : "text-[12.5px] font-semibold"}>
                    {taka(deal.amount)}
                  </span>
                  <Tag label={OPPORTUNITY_STATUS_LABEL[deal.status]} tone={OPPORTUNITY_STATUS_TONE[deal.status]} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {/* The list is one page. Said rather than implied, so a long-running
          account does not look like it has exactly fifty deals. */}
      {dealsQuery.data.nextCursor ? (
        <p className="mt-2 text-[11.5px] text-[#5F6B7C]">Showing the 50 newest Opportunities on this account.</p>
      ) : null}
      <OpportunityFormDialog accountId={account.id} open={createOpen} onOpenChange={setCreateOpen} />
    </Panel>
  )
}
