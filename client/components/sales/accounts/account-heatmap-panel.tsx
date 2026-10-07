"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { getAccountHeatmap } from "@/lib/api/sales/heatmap"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { HeatmapCardView } from "@/lib/api/types"
import { COLOUR, COLOUR_ORDER, itemTitle } from "@/lib/heatmap"
import { TONE } from "@/components/dashboard/record-kit"
import { HeatmapCardDialog } from "@/components/sales/accounts/heatmap-card-dialog"
import { Panel, PanelError, PanelHeading, PanelSkeleton } from "@/components/sales/shared/panel"
import { cn } from "@/lib/utils"

/** What a card shows under its name: what they have, or why nothing is shown. */
function summaryOf(card: HeatmapCardView): string {
  if (card.items.length === 0) return card.need === "NO_NEED" ? "No need" : card.need === "NEED" ? "Needed, none yet" : "Nothing recorded"
  const total = card.items.reduce((n, i) => n + i.quantity, 0)
  const brands = [...new Set(card.items.map((i) => i.brand))]
  return `${total} · ${brands.length === 1 ? itemTitle(card.items[0]) : brands.slice(0, 2).join(", ") + (brands.length > 2 ? ` +${brands.length - 2}` : "")}`
}

function HeatmapCard({ card, onOpen }: { card: HeatmapCardView; onOpen: () => void }) {
  const tone = COLOUR[card.colour]
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-24 flex-col gap-1 rounded-md border p-3 text-left transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[#17191C]/25 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        tone.card,
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-bold [overflow-wrap:anywhere]">{card.title}</span>
        <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", tone.dot)} aria-hidden />
      </span>
      <span className={cn("text-[11.5px] font-bold", tone.text)}>{tone.word}</span>
      <span className="text-[12px] leading-snug [overflow-wrap:anywhere]">{summaryOf(card)}</span>
      <span className={`text-[11.5px] leading-snug ${TONE.muted}`}>{card.reason}</span>
    </button>
  )
}

/**
 * The Heatmap tab (owner, 2026-10-07): one card for each kind of IT system the
 * company may have, coloured by the sales chance on it. The server decides the
 * colour and says why in a sentence on each card, so this only draws it. Click
 * a card to see and change what is behind it.
 */
export function AccountHeatmapPanel({ accountId }: { accountId: string }) {
  const { accessToken } = useSession()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const query = useQuery({
    queryKey: salesKeys.accountHeatmap(accountId),
    queryFn: () => getAccountHeatmap(accessToken!, accountId),
    enabled: !!accessToken,
  })

  if (query.isPending) return <PanelSkeleton />
  if (query.isError) return <PanelError onRetry={() => query.refetch()} />
  const heatmap = query.data
  const openCard = heatmap.cards.find((c) => c.key === openKey) ?? null

  return (
    <div className="grid gap-4">
      <Panel>
        <PanelHeading title="Heatmap" />
        <p className={`-mt-1 mb-3 text-[12.5px] leading-relaxed ${TONE.muted}`}>
          Each card is one kind of IT system. The colour shows if we may sell there. Click a card to see what the
          company has and to change it.
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
        <Panel key={group.key}>
          <PanelHeading title={group.title} />
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {heatmap.cards
              .filter((c) => c.group === group.key)
              .map((card) => (
                <HeatmapCard key={card.key} card={card} onOpen={() => setOpenKey(card.key)} />
              ))}
          </div>
        </Panel>
      ))}

      {openCard ? (
        <HeatmapCardDialog
          accountId={accountId}
          card={openCard}
          canManage={heatmap.canManage}
          open
          onOpenChange={(next) => !next && setOpenKey(null)}
        />
      ) : null}
    </div>
  )
}
