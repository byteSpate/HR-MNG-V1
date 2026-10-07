"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RiAddLine, RiFlashlightLine } from "@remixicon/react"

import { addHeatmapItem, removeHeatmapItem, setHeatmapNeed, updateHeatmapItem } from "@/lib/api/sales/heatmap"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { AccountHeatmap, HeatmapCardView, HeatmapItemBody, HeatmapItemView, HeatmapNeed } from "@/lib/api/types"
import {
  COLOUR, dayText, detailsLine, draftOfItem, itemBodyOf, itemTitle, NEED_LABEL, type ItemDraft,
} from "@/lib/heatmap"
import { ConfirmDeleteDialog, DialogActions, FormError, RowActions, TONE, toMessage } from "@/components/dashboard/record-kit"
import { HeatmapItemForm } from "@/components/sales/accounts/heatmap-item-form"
import { OpportunityFormDialog } from "@/components/sales/opportunities/opportunity-form-dialog"
import { useSalesPermissions } from "@/components/sales/shared/use-sales-permissions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const NEEDS: HeatmapNeed[] = ["NEED", "NO_NEED", "NOT_ASKED"]

/** After any save: show the new heatmap at once, and refresh the History. */
function useAfterSave(accountId: string) {
  const queryClient = useQueryClient()
  return (updated: AccountHeatmap) => {
    queryClient.setQueryData(salesKeys.accountHeatmap(accountId), updated)
    queryClient.invalidateQueries({ queryKey: salesKeys.accountHistory(accountId) })
  }
}

/** "Do they need it?": three choices, and a reason when the answer is No need. */
function NeedPicker({ card, accountId, onError }: { card: HeatmapCardView; accountId: string; onError: (m: string | null) => void }) {
  const { accessToken } = useSession()
  const afterSave = useAfterSave(accountId)
  const [pick, setPick] = useState<HeatmapNeed>(card.need)
  const [reason, setReason] = useState(card.needReason ?? "")
  const save = useMutation({
    mutationFn: (body: { need: HeatmapNeed; reason: string | null }) => setHeatmapNeed(accessToken!, accountId, card.key, body),
    onSuccess: (updated) => {
      afterSave(updated)
      onError(null)
    },
    onError: (err) => onError(toMessage(err)),
  })
  const changed = pick !== card.need || (pick === "NO_NEED" && reason.trim() !== (card.needReason ?? ""))
  return (
    <div className="space-y-2">
      <div className="text-[13px] font-semibold" id={`need-${card.key}`}>Do they need it?</div>
      <div role="radiogroup" aria-labelledby={`need-${card.key}`} className="flex flex-wrap gap-1.5">
        {NEEDS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={pick === n}
            onClick={() => setPick(n)}
            className={cn(
              "h-8 rounded-md border px-3 text-[12.5px] font-semibold transition-colors motion-reduce:transition-none",
              pick === n ? "border-[#17191C] bg-[#17191C] text-white" : "border-[#E4E9EF] bg-white hover:border-[#8A94A2]",
            )}
          >
            {NEED_LABEL[n]}
          </button>
        ))}
      </div>
      {pick === "NO_NEED" ? (
        <Input
          aria-label="Why they do not need it"
          placeholder="Why they do not need it. For example, everything is in the cloud."
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
      ) : null}
      {changed ? (
        <Button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ need: pick, reason: pick === "NO_NEED" ? reason.trim() || null : null })}
          className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      ) : card.needByName && card.needAt ? (
        <p className={`text-[11.5px] ${TONE.muted}`}>
          {card.needByName} · {new Date(card.needAt).toLocaleDateString()}
        </p>
      ) : null}
    </div>
  )
}

function ItemRowView({ card, item, canManage, onEdit, onRemove }: {
  card: HeatmapCardView
  item: HeatmapItemView
  canManage: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  const extra = detailsLine(card, item)
  const facts = [
    item.site ? `Where: ${item.site}` : null,
    item.boughtFrom ? `Bought from: ${item.boughtFrom}` : null,
    item.boughtOn ? `Bought on: ${dayText(item.boughtOn)}` : null,
    item.supportEndsOn ? `${card.endsLabel}: ${dayText(item.supportEndsOn)}` : null,
    item.endOfLifeOn ? `End of life: ${dayText(item.endOfLifeOn)}` : null,
    item.supportBy ? `Support by: ${item.supportBy}` : null,
  ].filter(Boolean)
  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-[13px] font-semibold [overflow-wrap:anywhere]">
          {itemTitle(item)} <span className={`font-normal ${TONE.muted}`}>· {card.quantityLabel}: {item.quantity}</span>
        </div>
        {canManage ? (
          <RowActions
            actions={[
              { kind: "edit", label: "Edit", onClick: onEdit },
              { kind: "delete", label: "Remove", onClick: onRemove },
            ]}
          />
        ) : null}
      </div>
      {facts.length > 0 ? <p className={`text-[12px] leading-relaxed ${TONE.muted}`}>{facts.join(" · ")}</p> : null}
      {extra ? <p className={`text-[12px] leading-relaxed ${TONE.muted}`}>{extra}</p> : null}
      {item.notes ? <p className="text-[12px] leading-relaxed [overflow-wrap:anywhere]">{item.notes}</p> : null}
      {item.recordedByName ? (
        <p className={`text-[11.5px] ${TONE.muted}`}>
          {item.recordedByName} · {new Date(item.recordedAt).toLocaleDateString()}
        </p>
      ) : null}
    </li>
  )
}

/** The add or edit form for one item. */
function ItemEditor({ card, accountId, item, onDone }: {
  card: HeatmapCardView
  accountId: string
  item: HeatmapItemView | null
  onDone: () => void
}) {
  const { accessToken } = useSession()
  const afterSave = useAfterSave(accountId)
  const [draft, setDraft] = useState<ItemDraft>(() => draftOfItem(item ?? undefined))
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (body: HeatmapItemBody) =>
      item ? updateHeatmapItem(accessToken!, accountId, item.id, body) : addHeatmapItem(accessToken!, accountId, card.key, body),
    onSuccess: (updated) => {
      afterSave(updated)
      onDone()
    },
    // Verbatim: the server says what is wrong and what to do.
    onError: (err) => setError(toMessage(err)),
  })
  function submit() {
    setError(null)
    const result = itemBodyOf(draft)
    if ("error" in result) setError(result.error)
    else save.mutate(result.body)
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit() }} className="space-y-3">
      <div className="text-[13px] font-bold">{item ? `Edit ${itemTitle(item)}` : `Add to ${card.title}`}</div>
      <HeatmapItemForm card={card} draft={draft} onChange={setDraft} />
      {error ? <FormError>{error}</FormError> : null}
      {/* Not DialogFooter: its negative margins fit the dialog edge, and inside this scroller they push the form sideways. */}
      <div className="flex flex-wrap justify-end gap-2">
        <DialogActions pending={save.isPending} submitLabel="Save" disabled={false} onCancel={onDone} onSubmit={submit} />
      </div>
    </form>
  )
}

/**
 * One card opened up: the colour and why, the need, what the company has, and
 * the forms to change them. The card comes from the latest heatmap, so every
 * save shows at once.
 */
export function HeatmapCardDialog({ accountId, card, canManage, open, onOpenChange }: {
  accountId: string
  card: HeatmapCardView
  canManage: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { accessToken } = useSession()
  const afterSave = useAfterSave(accountId)
  const { can } = useSalesPermissions()
  const [editing, setEditing] = useState<HeatmapItemView | "new" | null>(null)
  const [removing, setRemoving] = useState<HeatmapItemView | null>(null)
  const [startOpen, setStartOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tone = COLOUR[card.colour]

  const remove = useMutation({
    mutationFn: (id: string) => removeHeatmapItem(accessToken!, accountId, id),
    onSuccess: (updated) => {
      afterSave(updated)
      setRemoving(null)
    },
    onError: (err) => {
      setRemoving(null)
      setError(toMessage(err))
    },
  })

  function close(next: boolean) {
    if (!next) {
      setEditing(null)
      setError(null)
    }
    onOpenChange(next)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{card.title}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={cn("inline-flex items-center gap-1.5 font-bold", tone.text)}>
                <span className={cn("size-2 rounded-full", tone.dot)} aria-hidden />
                {tone.word}
              </span>
              <span>{card.reason}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(85svh-12rem)] min-h-32 space-y-5 overflow-y-auto pr-1">
            {editing && canManage ? (
              <ItemEditor
                key={editing === "new" ? "new" : editing.id}
                card={card}
                accountId={accountId}
                item={editing === "new" ? null : editing}
                onDone={() => setEditing(null)}
              />
            ) : (
              <>
                {canManage ? (
                  <NeedPicker key={`${card.need}-${card.needReason}`} card={card} accountId={accountId} onError={setError} />
                ) : (
                  <p className="text-[13px]">
                    <span className="font-semibold">Do they need it? </span>
                    {NEED_LABEL[card.need]}
                    {card.needReason ? `: ${card.needReason}` : ""}
                  </p>
                )}

                <section>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>What they have</h3>
                    {canManage ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEditing("new")}
                        className="h-8 gap-1.5 px-2.5 text-[12px] font-bold"
                      >
                        <RiAddLine className="size-3.5" aria-hidden />
                        Add item
                      </Button>
                    ) : null}
                  </div>
                  {card.items.length === 0 ? (
                    <p className={`mt-2 text-[12.5px] leading-relaxed ${TONE.muted}`}>
                      Nothing recorded yet.{canManage ? " Add what the company has, with its brand and dates." : ""}
                    </p>
                  ) : (
                    <ul className="mt-1 divide-y divide-[#E4E9EF]">
                      {card.items.map((item) => (
                        <ItemRowView
                          key={item.id}
                          card={card}
                          item={item}
                          canManage={canManage}
                          onEdit={() => setEditing(item)}
                          onRemove={() => setRemoving(item)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>

          {error ? <FormError>{error}</FormError> : null}

          {!editing && canManage && card.colour === "GREEN" ? (
            <DialogFooter>
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
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!removing}
        what={removing ? itemTitle(removing) : "this item"}
        pending={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />

      {/* A green card is a chance, so the new Opportunity starts with its name. */}
      {canManage ? (
        <OpportunityFormDialog
          accountId={accountId}
          open={startOpen}
          onOpenChange={setStartOpen}
          suggestedName={card.items.length > 0 ? `${card.title} renewal` : `New ${card.title}`}
        />
      ) : null}
    </>
  )
}
