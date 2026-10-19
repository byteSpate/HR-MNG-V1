"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RiArrowDownSLine, RiCheckLine, RiCloseLine } from "@remixicon/react"

import { setPartMark, setProductMarks, setProductNote, type HeatmapMarkBody } from "@/lib/api/sales/heatmap"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { AccountHeatmap, HeatmapProductView } from "@/lib/api/types"
import { allMarkTarget, closedLine, COLOUR, nextPartMark } from "@/lib/heatmap"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { HeatmapStartButton } from "@/components/sales/accounts/heatmap-start-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const onDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

const TICK_WORDS = "They do not have it, so we can offer it"
const CROSS_WORDS = "They have it, or we cannot go"

/** The tick or the cross on a part. Pressing the one that is already on clears it. */
function MarkButton({
  kind,
  pressed,
  disabled,
  label,
  onClick,
}: {
  kind: "GREEN" | "RED"
  pressed: boolean
  disabled: boolean
  label: string
  onClick: () => void
}) {
  const Icon = kind === "GREEN" ? RiCheckLine : RiCloseLine
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-[#17191C]/25 focus-visible:outline-none disabled:cursor-default motion-reduce:transition-none",
        kind === "GREEN"
          ? pressed
            ? "border-[#1F8A4C] bg-[#1F8A4C] text-white enabled:hover:bg-[#17673A]"
            : "border-[#9ED3B4] text-[#17673A] enabled:hover:bg-[#EEF8F2] disabled:opacity-50"
          : pressed
            ? "border-[#C24141] bg-[#C24141] text-white enabled:hover:bg-[#B03A3A]"
            : "border-[#E9B4B4] text-[#B03A3A] enabled:hover:bg-[#FCEFEF] disabled:opacity-50",
      )}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  )
}

/** The optional note on a Red product. Re-mounted by its parent when the saved note changes. */
function NoteForm({ note, pending, onSave }: { note: string | null; pending: boolean; onSave: (note: string | null) => void }) {
  const [value, setValue] = useState(note ?? "")
  const changed = value.trim() !== (note ?? "")
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(value.trim() || null)
      }}
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={300}
        aria-label="Note (optional)"
        placeholder="Note (optional). For example: they use another vendor."
        className="min-w-0 flex-1 basis-60 text-[12.5px]"
      />
      <Button
        type="submit"
        disabled={!changed || pending}
        className="h-auto rounded-md bg-[#17191C] px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
      >
        Save note
      </Button>
    </form>
  )
}

/**
 * One product in the list on the Heatmap tab (owner, 2026-10-18). Closed, it
 * shows its colour, its name and one line. Open, each part has a tick and a
 * cross. The product colour follows its parts and is never picked.
 */
export function HeatmapProductRow({
  accountId,
  product,
  canManage,
  open,
  onToggle,
}: {
  accountId: string
  product: HeatmapProductView
  canManage: boolean
  open: boolean
  onToggle: () => void
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const tone = COLOUR[product.colour]
  const store = (updated: AccountHeatmap) => {
    queryClient.setQueryData(salesKeys.accountHeatmap(accountId), updated)
    // The dashboard band counts these marks, and History lists the change.
    void queryClient.invalidateQueries({ queryKey: salesKeys.heatmapOverviewAll() })
    void queryClient.invalidateQueries({ queryKey: salesKeys.accountHistory(accountId) })
  }

  const part = useMutation({
    mutationFn: (v: { partId: string; mark: HeatmapMarkBody }) => setPartMark(accessToken!, accountId, v.partId, v.mark),
    onSuccess: store,
  })
  const all = useMutation({
    mutationFn: (mark: HeatmapMarkBody) => setProductMarks(accessToken!, accountId, product.id, mark),
    onSuccess: store,
  })
  const note = useMutation({
    mutationFn: (text: string | null) => setProductNote(accessToken!, accountId, product.id, text),
    onSuccess: store,
  })
  const error = part.error ?? all.error ?? note.error
  const busy = part.isPending || all.isPending || note.isPending
  const allTicked = allMarkTarget(product, "GREEN") === "NONE"
  const allCrossed = allMarkTarget(product, "RED") === "NONE"

  return (
    <li id={`heatmap-product-${product.id}`} className={cn("scroll-mt-24 overflow-hidden rounded-md border", tone.soft)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full min-w-0 items-stretch gap-3 text-left focus-visible:ring-2 focus-visible:ring-[#17191C]/25 focus-visible:outline-none"
      >
        <span className={cn("w-1.5 shrink-0", tone.stripe)} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[13.5px] font-bold [overflow-wrap:anywhere]">{product.title}</span>
            <span className={cn("text-[11.5px] font-bold", tone.text)}>{tone.word}</span>
          </span>
          <span className={`text-[12px] leading-snug [overflow-wrap:anywhere] ${TONE.muted}`}>{closedLine(product)}</span>
        </span>
        <RiArrowDownSLine
          className={cn("mr-3 size-5 shrink-0 self-center transition-transform motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="grid gap-3 border-t border-[#E4E9EF] bg-white px-4 py-3 animate-in fade-in-0 slide-in-from-top-1 fill-mode-backwards duration-300 motion-reduce:animate-none">
          {product.parts.length === 0 ? (
            <p className={`text-[12.5px] ${TONE.muted}`}>This product has no parts yet. A Sales Admin can add one in Sales Settings.</p>
          ) : (
            <>
              {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    aria-pressed={allTicked}
                    aria-label="Tick every part"
                    onClick={() => all.mutate(allMarkTarget(product, "GREEN"))}
                    className={cn(
                      "h-auto rounded-md border px-3 py-1.5 text-[12.5px] font-bold",
                      allTicked ? "border-[#1F8A4C] bg-[#1F8A4C] text-white hover:bg-[#17673A]" : "border-[#9ED3B4] text-[#17673A] hover:bg-[#EEF8F2]",
                    )}
                  >
                    All ✓
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    aria-pressed={allCrossed}
                    aria-label="Cross every part"
                    onClick={() => all.mutate(allMarkTarget(product, "RED"))}
                    className={cn(
                      "h-auto rounded-md border px-3 py-1.5 text-[12.5px] font-bold",
                      allCrossed ? "border-[#C24141] bg-[#C24141] text-white hover:bg-[#B03A3A]" : "border-[#E9B4B4] text-[#B03A3A] hover:bg-[#FCEFEF]",
                    )}
                  >
                    All ✗
                  </Button>
                  {product.markedByName && product.markedAt ? (
                    <span className={`text-[11.5px] ${TONE.muted}`}>
                      Last change: {product.markedByName}, {onDay(product.markedAt)}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <ul className="grid gap-1">
                {product.parts.map((p) => (
                  <li key={p.id} className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[12.5px] font-semibold [overflow-wrap:anywhere]">{p.title}</span>
                      {p.note ? <span className={`text-[11.5px] leading-snug ${TONE.muted}`}>{p.note}</span> : null}
                    </span>
                    <MarkButton
                      kind="GREEN"
                      pressed={p.mark === "GREEN"}
                      disabled={!canManage || busy}
                      label={`${p.title}: ${TICK_WORDS}`}
                      onClick={() => part.mutate({ partId: p.id, mark: nextPartMark(p.mark, "GREEN") })}
                    />
                    <MarkButton
                      kind="RED"
                      pressed={p.mark === "RED"}
                      disabled={!canManage || busy}
                      label={`${p.title}: ${CROSS_WORDS}`}
                      onClick={() => part.mutate({ partId: p.id, mark: nextPartMark(p.mark, "RED") })}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}

          {product.colour === "RED" ? (
            canManage ? (
              <NoteForm key={product.note ?? ""} note={product.note} pending={busy} onSave={(text) => note.mutate(text)} />
            ) : product.note ? (
              <p className="text-[12.5px] [overflow-wrap:anywhere]">Note: {product.note}</p>
            ) : null
          ) : null}

          {error ? <PanelAlert>{toMessage(error)}</PanelAlert> : null}

          {canManage && product.colour === "GREEN" ? (
            <div>
              <HeatmapStartButton accountId={accountId} productTitle={product.title} />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
