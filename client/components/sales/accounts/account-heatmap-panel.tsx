"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { getAccountHeatmap } from "@/lib/api/sales/heatmap"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import { COLOUR, COLOUR_ORDER } from "@/lib/heatmap"
import { TONE } from "@/components/dashboard/record-kit"
import { HeatmapProductRow } from "@/components/sales/accounts/heatmap-product-row"
import { Panel, PanelError, PanelHeading, PanelSkeleton } from "@/components/sales/shared/panel"
import { cn } from "@/lib/utils"

/**
 * The Heatmap tab (owner, 2026-10-13): each product the company may buy is a
 * row. Green means we can sell there, Red means no chance, Grey means nobody
 * has picked yet. Open a row to pick the colour and tick the parts that are
 * in our working scope. Sales Admins change the list in Sales Settings.
 */
export function AccountHeatmapPanel({ accountId }: { accountId: string }) {
  const { accessToken } = useSession()
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const query = useQuery({
    queryKey: salesKeys.accountHeatmap(accountId),
    queryFn: () => getAccountHeatmap(accessToken!, accountId),
    enabled: !!accessToken,
  })

  if (query.isPending) return <PanelSkeleton />
  if (query.isError) return <PanelError onRetry={() => query.refetch()} />
  const heatmap = query.data
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (heatmap.groups.length === 0) {
    return (
      <Panel>
        <PanelHeading title="Heatmap" />
        <p className={`text-[12.5px] ${TONE.muted}`}>The heatmap list is empty. A Sales Admin can add products in Sales Settings.</p>
      </Panel>
    )
  }

  return (
    <div className="grid gap-4">
      <Panel>
        <PanelHeading title="Heatmap" />
        <p className={`-mt-1 mb-3 text-[12.5px] leading-relaxed ${TONE.muted}`}>
          Each row is one product. Green means we can sell there. Red means no chance. Click a row to pick a colour and
          tick what is in our work.
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
          {COLOUR_ORDER.map((c) => (
            <li key={c} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-full", COLOUR[c].dot)} aria-hidden />
              <span className="font-semibold">{heatmap.counts[c]}</span>
              <span className={TONE.muted}>{COLOUR[c].word}</span>
            </li>
          ))}
        </ul>
      </Panel>

      {heatmap.groups.map((group) => (
        <Panel key={group.id}>
          <PanelHeading title={group.title} />
          {group.products.length === 0 ? (
            <p className={`text-[12.5px] ${TONE.muted}`}>No products in this group yet.</p>
          ) : (
            <ul className="grid gap-2">
              {group.products.map((product) => (
                <HeatmapProductRow
                  key={product.id}
                  accountId={accountId}
                  product={product}
                  canManage={heatmap.canManage}
                  open={openIds.has(product.id)}
                  onToggle={() => toggle(product.id)}
                />
              ))}
            </ul>
          )}
        </Panel>
      ))}
    </div>
  )
}
