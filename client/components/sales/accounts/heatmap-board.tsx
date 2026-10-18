"use client"

import { boardLanes, closedLine, COLOUR, type BoardCard } from "@/lib/heatmap"
import type { HeatmapGroupView } from "@/lib/api/types"
import { TONE } from "@/components/dashboard/record-kit"
import { HeatmapStartButton } from "@/components/sales/accounts/heatmap-start-button"
import { cn } from "@/lib/utils"

const onDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

/** Capped at six, as the house motion rule requires: card forty must not wait. */
const stagger = (i: number) => ({ animationDelay: `${Math.min(i, 6) * 40}ms` })

function Card({
  card,
  index,
  accountId,
  canManage,
  onOpen,
}: {
  card: BoardCard
  index: number
  accountId: string
  canManage: boolean
  onOpen: (productId: string) => void
}) {
  const { product, groupTitle } = card
  const tone = COLOUR[product.colour]
  return (
    <li
      className={cn(
        "flex overflow-hidden rounded-md border animate-in fade-in-0 fill-mode-backwards duration-300 motion-reduce:animate-none",
        tone.soft,
      )}
      style={stagger(index)}
    >
      <span className={cn("w-1.5 shrink-0", tone.stripe)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5">
        <button
          type="button"
          onClick={() => onOpen(product.id)}
          className="min-w-0 text-left focus-visible:ring-2 focus-visible:ring-[#17191C]/25 focus-visible:outline-none"
        >
          <span className="block text-[13.5px] font-bold [overflow-wrap:anywhere] hover:underline">{product.title}</span>
          <span className={`block text-[11.5px] ${TONE.muted}`}>{groupTitle}</span>
        </button>
        <span className="text-[12px] leading-snug [overflow-wrap:anywhere]">{closedLine(product)}</span>
        {product.markedByName && product.markedAt ? (
          <span className={`text-[11.5px] ${TONE.muted}`}>
            {product.markedByName}, {onDay(product.markedAt)}
          </span>
        ) : null}
        {canManage && product.colour === "GREEN" ? (
          <div className="pt-0.5">
            <HeatmapStartButton accountId={accountId} productTitle={product.title} />
          </div>
        ) : null}
      </div>
    </li>
  )
}

function Lane({
  colour,
  cards,
  empty,
  accountId,
  canManage,
  onOpen,
}: {
  colour: "GREEN" | "RED"
  cards: BoardCard[]
  empty: string
  accountId: string
  canManage: boolean
  onOpen: (productId: string) => void
}) {
  const tone = COLOUR[colour]
  return (
    <section aria-label={tone.lane} className="min-w-0">
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-bold">
        <span className={cn("size-2.5 rounded-full", tone.dot)} aria-hidden />
        <span className={tone.text}>{tone.lane}</span>
        <span className={`font-semibold ${TONE.muted}`}>{cards.length}</span>
      </h3>
      {cards.length === 0 ? (
        <p className={`rounded-md border border-dashed border-[#E4E9EF] px-3 py-4 text-[12.5px] ${TONE.muted}`}>{empty}</p>
      ) : (
        <ul className="grid gap-2">
          {cards.map((card, i) => (
            <Card key={card.product.id} card={card} index={i} accountId={accountId} canManage={canManage} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * The board at the top of the Heatmap tab (owner, 2026-10-18): every Green
 * product on the left, every Red product on the right. Grey products are not
 * here; they are in the list below, where they are checked. A click on a card
 * opens that product in the list.
 */
export function HeatmapBoard({
  accountId,
  groups,
  canManage,
  onOpen,
}: {
  accountId: string
  groups: HeatmapGroupView[]
  canManage: boolean
  onOpen: (productId: string) => void
}) {
  const lanes = boardLanes(groups)
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Lane
        colour="GREEN"
        cards={lanes.green}
        empty="No product is Green yet. Open a product below and press ✓ on a part."
        accountId={accountId}
        canManage={canManage}
        onOpen={onOpen}
      />
      <Lane
        colour="RED"
        cards={lanes.red}
        empty="No product is Red yet. Press ✗ on every part of a product below."
        accountId={accountId}
        canManage={canManage}
        onOpen={onOpen}
      />
    </div>
  )
}
