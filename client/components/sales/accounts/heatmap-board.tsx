"use client"

import { boardLanes, COLOUR, type BoardCard } from "@/lib/heatmap"
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
  const { product, part, groupTitle, first } = card
  // The side the part is on, not the colour of its product: a half crossed
  // product is Grey, but its crossed part is still a red card here.
  const tone = COLOUR[part.mark === "RED" ? "RED" : "GREEN"]
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
          <span className="block text-[13.5px] font-bold [overflow-wrap:anywhere] hover:underline">{part.title}</span>
          <span className={`block text-[11.5px] ${TONE.muted}`}>
            {product.title}, {groupTitle}
          </span>
        </button>
        {part.note ? <span className={`text-[12px] leading-snug [overflow-wrap:anywhere] ${TONE.muted}`}>{part.note}</span> : null}
        {first && part.mark === "RED" && product.colour === "RED" && product.note ? (
          <span className="text-[12px] leading-snug [overflow-wrap:anywhere]">{product.note}</span>
        ) : null}
        {first && product.markedByName && product.markedAt ? (
          <span className={`text-[11.5px] ${TONE.muted}`}>
            Last change: {product.markedByName}, {onDay(product.markedAt)}
          </span>
        ) : null}
        {first && canManage && part.mark === "GREEN" ? (
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
            <Card key={card.part.id} card={card} index={i} accountId={accountId} canManage={canManage} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * The board at the top of the Heatmap tab (owner, 2026-11-01): every part with
 * a tick on the left, every part with a cross on the right, whatever colour
 * its product has. Parts with no mark are in the list below, where they are
 * checked. A click on a card opens its product in the list.
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
        empty="No part has a tick yet. Open a product below and press ✓ on a part."
        accountId={accountId}
        canManage={canManage}
        onOpen={onOpen}
      />
      <Lane
        colour="RED"
        cards={lanes.red}
        empty="No part has a cross yet. Open a product below and press ✗ on a part."
        accountId={accountId}
        canManage={canManage}
        onOpen={onOpen}
      />
    </div>
  )
}
