"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { getAccountHeatmap } from "@/lib/api/sales/heatmap"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import { COLOUR, COLOUR_ORDER } from "@/lib/heatmap"
import { TONE } from "@/components/dashboard/record-kit"
import { HeatmapBoard } from "@/components/sales/accounts/heatmap-board"
import { HeatmapProductRow } from "@/components/sales/accounts/heatmap-product-row"
import { Panel, PanelError, PanelHeading, PanelSkeleton } from "@/components/sales/shared/panel"
import { cn } from "@/lib/utils"

/**
 * The Heatmap tab (owner, 2026-10-18). At the top, a board: Green products on
 * the left, Red products on the right. Below it, every product in its group.
 * Open one to put a ✓ or a ✗ on each part. The colour follows the parts, so
 * nobody picks it. Grey means nobody has checked yet. Sales Admins change the
 * list in Sales Settings.
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
  // A card on the board opens its product in the list and brings it into view.
  const openFromBoard = (id: string) => {
    setOpenIds((prev) => new Set(prev).add(id))
    requestAnimationFrame(() => {
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      document.getElementById(`heatmap-product-${id}`)?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" })
    })
  }

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
          Open a product below. Press ✓ on a part when they do not have it, so we can offer it. Press ✗ when they have it,
          or we cannot go. The colour of the product follows its parts.
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

      <Panel>
        <PanelHeading title="Summary" />
        <HeatmapBoard accountId={accountId} groups={heatmap.groups} canManage={heatmap.canManage} onOpen={openFromBoard} />
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
