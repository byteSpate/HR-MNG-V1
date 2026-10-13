"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RiArrowDownSLine, RiFlashlightLine } from "@remixicon/react"

import { setHeatmapColour, setHeatmapScope } from "@/lib/api/sales/heatmap"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { AccountHeatmap, HeatmapProductView } from "@/lib/api/types"
import { closedLine, COLOUR } from "@/lib/heatmap"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { OpportunityFormDialog } from "@/components/sales/opportunities/opportunity-form-dialog"
import { useSalesPermissions } from "@/components/sales/shared/use-sales-permissions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const CHOICE = "h-auto rounded-md border px-3 py-1.5 text-[12.5px] font-bold transition-colors motion-reduce:transition-none"

/**
 * One product on the Heatmap tab (owner, 2026-10-13). Closed, it shows its
 * colour, its name and one line. Open, it shows Green and Red and, unless it
 * is Red, the parts to tick as "in our working scope". Ticking never changes
 * the colour: a person picks that.
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
  const { can } = useSalesPermissions()
  const [askingReason, setAskingReason] = useState(false)
  const [reason, setReason] = useState("")
  const [startOpen, setStartOpen] = useState(false)
  const tone = COLOUR[product.colour]
  const line = closedLine(product)
  const store = (updated: AccountHeatmap) => queryClient.setQueryData(salesKeys.accountHeatmap(accountId), updated)

  const colour = useMutation({
    mutationFn: (body: { colour: "GREEN" | "RED" | "NONE"; reason: string | null }) =>
      setHeatmapColour(accessToken!, accountId, product.id, body),
    onSuccess: (updated) => {
      store(updated)
      setAskingReason(false)
    },
  })
  const scope = useMutation({
    mutationFn: (v: { partId: string; inScope: boolean }) => setHeatmapScope(accessToken!, accountId, v.partId, v.inScope),
    onSuccess: store,
  })
  const error = colour.error ?? scope.error

  return (
    <li className={cn("overflow-hidden rounded-md border", tone.soft)}>
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
          {line ? <span className={`text-[12px] leading-snug [overflow-wrap:anywhere] ${TONE.muted}`}>{line}</span> : null}
        </span>
        <RiArrowDownSLine
          className={cn("mr-3 size-5 shrink-0 self-center transition-transform motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="grid gap-3 border-t border-[#E4E9EF] bg-white px-4 py-3 animate-in fade-in-0 slide-in-from-top-1 fill-mode-backwards duration-300 motion-reduce:animate-none">
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={colour.isPending}
                aria-pressed={product.colour === "GREEN"}
                onClick={() => colour.mutate({ colour: product.colour === "GREEN" ? "NONE" : "GREEN", reason: null })}
                className={cn(
                  CHOICE,
                  product.colour === "GREEN"
                    ? "border-[#1F8A4C] bg-[#1F8A4C] text-white hover:bg-[#17673A]"
                    : "border-[#9ED3B4] text-[#17673A] hover:bg-[#EEF8F2]",
                )}
              >
                Green: we can sell here
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={colour.isPending}
                aria-pressed={product.colour === "RED"}
                onClick={() => {
                  if (product.colour === "RED") colour.mutate({ colour: "NONE", reason: null })
                  else {
                    setReason("")
                    setAskingReason(true)
                  }
                }}
                className={cn(
                  CHOICE,
                  product.colour === "RED"
                    ? "border-[#C24141] bg-[#C24141] text-white hover:bg-[#B03A3A]"
                    : "border-[#E9B4B4] text-[#B03A3A] hover:bg-[#FCEFEF]",
                )}
              >
                Red: no chance
              </Button>
              {product.pickedByName ? <span className={`text-[11.5px] ${TONE.muted}`}>Picked by {product.pickedByName}</span> : null}
            </div>
          ) : null}

          {askingReason ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                colour.mutate({ colour: "RED", reason: reason.trim() || null })
              }}
            >
              <Input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                aria-label="Why is there no chance?"
                placeholder="Why is there no chance? For example: they use another vendor."
                className="min-w-0 flex-1 basis-60 text-[12.5px]"
              />
              <Button type="submit" disabled={colour.isPending} className="h-auto rounded-md bg-[#17191C] px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-[#0E1012]">
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAskingReason(false)} className="h-auto px-3 py-1.5 text-[12.5px]">
                Cancel
              </Button>
            </form>
          ) : null}

          {product.colour === "RED" ? (
            <p className="text-[12.5px] [overflow-wrap:anywhere]">No need: {product.reason}</p>
          ) : product.parts.length === 0 ? (
            <p className={`text-[12.5px] ${TONE.muted}`}>This product has no parts to tick.</p>
          ) : (
            <ul className="grid gap-1">
              {product.parts.map((part) => (
                <li key={part.id}>
                  <label className={cn("flex min-w-0 items-start gap-2.5 rounded-md px-2 py-1.5", canManage && "cursor-pointer hover:bg-[#F6F8FA]")}>
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-[#1F8A4C]"
                      checked={part.inScope}
                      disabled={!canManage || scope.isPending}
                      onChange={(e) => scope.mutate({ partId: part.id, inScope: e.target.checked })}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[12.5px] font-semibold [overflow-wrap:anywhere]">{part.title}</span>
                      {part.note ? <span className={`text-[11.5px] leading-snug ${TONE.muted}`}>{part.note}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {error ? <PanelAlert>{toMessage(error)}</PanelAlert> : null}

          {canManage && product.colour === "GREEN" ? (
            <div>
              <Button
                type="button"
                disabled={!can("opportunity.create")}
                title={can("opportunity.create") ? undefined : "A Sales Admin has turned this off for Sales Users."}
                onClick={() => setStartOpen(true)}
                className="h-auto gap-1.5 rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
              >
                <RiFlashlightLine className="size-3.5" aria-hidden />
                Start an Opportunity
              </Button>
              <OpportunityFormDialog accountId={accountId} open={startOpen} onOpenChange={setStartOpen} suggestedName={`New ${product.title}`} />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
