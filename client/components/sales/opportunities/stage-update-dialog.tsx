"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { changeOpportunityStage } from "@/lib/api/sales/opportunities"
import { useSession } from "@/lib/auth/session-context"
import type { OpportunityStage, OpportunitySummary, SalesStage } from "@/lib/api/types"
import { fitsPair, pickPair, salesStagesFor, type StagePair } from "@/lib/api/sales/sales-stages"
import { moveNote, SALES_STAGE_HELP, SALES_STAGE_LABEL } from "@/lib/api/sales/sales-stage-help"
import { quoteAskFor, stagesFor } from "@/lib/api/sales/stages"
import { Field, PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { STAGE_LABEL } from "@/components/sales/shared/sales-shared"
import { StageChangeDialog } from "@/components/sales/opportunities/stage-change-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const PRIMARY = "h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
const QUIET = "h-auto rounded-md px-3.5 py-2 text-[12.5px] font-bold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"
const OPTION =
  "flex w-full flex-wrap items-baseline gap-2 rounded-md border px-2.5 py-2 text-left text-[12.5px] transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#17191C]"
const OPTION_ON = "border-[#17191C] bg-[#F1F4F8] font-semibold"
const OPTION_OFF = "border-[#E4E9EF] bg-white hover:border-[#8A94A2]"
const TAG = "rounded bg-[#FFF1DC] px-1.5 py-px text-[11px] font-semibold text-[#8A4B00]"

/**
 * One box for both stages (spec 2026-11-05). Both lists start filled in. Picking
 * one stage leaves the other where it is when it still fits, and otherwise moves
 * it to the nearest allowed value, says so, and offers Undo. A real exception is
 * kept as picked, with a written reason.
 */
export function StageUpdateDialog({
  deal,
  canSkipQuote,
  onClose,
  onMoved,
}: {
  deal: OpportunitySummary
  canSkipQuote: boolean
  onClose: () => void
  onMoved: () => void
}) {
  const { accessToken } = useSession()
  const track = deal.track
  const start: StagePair = { work: deal.stage, sales: deal.salesStage }
  const [draft, setDraft] = useState<StagePair>(start)
  // What the box looked like before the last pick, for Undo.
  const [undo, setUndo] = useState<StagePair | null>(null)
  // What the user actually picked, before the other stage moved. Only kept when it moved.
  const [raw, setRaw] = useState<StagePair | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [exception, setException] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [quoteFor, setQuoteFor] = useState<{ stage: OpportunityStage; ask: "REQUIRED" | "OPTIONAL" } | null>(null)

  const workChanged = draft.work !== deal.stage
  const salesChanged = draft.sales !== null && draft.sales !== deal.salesStage
  const unchanged = !workChanged && !salesChanged

  const move = useMutation({
    mutationFn: (body: Parameters<typeof changeOpportunityStage>[2]) => changeOpportunityStage(accessToken!, deal.id, body),
    onSuccess: onMoved,
    onError: (err) => setError(toMessage(err)),
  })

  const pick = (change: { work: OpportunityStage } | { sales: SalesStage }) => {
    const next = pickPair(track, draft, change)
    setUndo(draft)
    setDraft({ work: next.work, sales: next.sales })
    setException(false)
    setError(null)
    if (next.moved) {
      const label = next.moved === "sales" ? SALES_STAGE_LABEL[next.sales!] : STAGE_LABEL[next.work]
      setNote(moveNote(next.moved, label))
      setRaw({
        work: "work" in change ? change.work : draft.work,
        sales: "sales" in change ? change.sales : draft.sales,
      })
    } else {
      setNote(null)
      setRaw(null)
    }
  }

  const undoPick = () => {
    if (!undo) return
    setDraft(undo)
    setUndo(null)
    setRaw(null)
    setNote(null)
    setException(false)
  }

  const keepAsPicked = () => {
    if (!raw) return
    setDraft(raw)
    setNote(null)
    setException(true)
  }

  const save = () => {
    setError(null)
    if (exception && !reason.trim()) return setError("Write why these two stages go together. The reason is kept in History.")
    const body: Parameters<typeof changeOpportunityStage>[2] = {
      ...(workChanged ? { stage: draft.work } : {}),
      ...(salesChanged ? { salesStage: draft.sales! } : {}),
      ...(exception ? { pairReason: reason.trim() } : {}),
    }
    const ask = workChanged ? quoteAskFor(draft.work, deal) : null
    // A quote stage asks for the quote first. This box waits. Nothing is saved
    // until that box saves, and cancelling it brings this box back.
    if (ask) return setQuoteFor({ stage: draft.work, ask })
    move.mutate(body)
  }

  if (quoteFor) {
    return (
      <StageChangeDialog
        deal={deal}
        stage={quoteFor.stage}
        ask={quoteFor.ask}
        canSkipQuote={canSkipQuote}
        salesStage={salesChanged ? draft.sales! : undefined}
        pairReason={exception ? reason.trim() : undefined}
        onClose={() => setQuoteFor(null)}
        onMoved={onMoved}
      />
    )
  }

  const salesHelp = draft.sales ? SALES_STAGE_HELP[draft.sales] : null

  return (
    <Dialog open onOpenChange={(next) => !next && !move.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Update stage</DialogTitle>
        </DialogHeader>

        {/* At the top, so the answer to a pick is seen without scrolling. */}
        {note ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[#E8F5EC] px-3 py-2 text-[12.5px] text-[#1B6B3A]" role="status">
            <span>{note}</span>
            <span className="flex gap-1">
              <Button type="button" variant="ghost" onClick={undoPick} className={QUIET}>Undo</Button>
              <Button type="button" variant="ghost" onClick={keepAsPicked} className={QUIET}>Keep both as I picked</Button>
            </span>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className={`mb-1.5 text-[11.5px] font-semibold ${TONE.muted}`}>Work stage (what we do)</div>
            <ul className="flex flex-col gap-1">
              {stagesFor(track).map((stage) => {
                const on = stage === draft.work
                const moves = !on && draft.sales !== null && !fitsPair(track, stage, draft.sales)
                return (
                  <li key={stage}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => pick({ work: stage })}
                      className={`${OPTION} ${on ? OPTION_ON : OPTION_OFF}`}
                    >
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{STAGE_LABEL[stage]}</span>
                      {moves ? <span className={TAG}>moves sales stage</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          <div>
            <div className={`mb-1.5 text-[11.5px] font-semibold ${TONE.muted}`}>Sales stage (where the customer is)</div>
            <ul className="flex flex-col gap-1">
              {draft.sales === null ? (
                <li>
                  <div className={`${OPTION} ${OPTION_ON}`} aria-current="true">
                    <span className="min-w-0 flex-1">Not set</span>
                  </div>
                </li>
              ) : null}
              {salesStagesFor(track).map((stage, index) => {
                const on = stage === draft.sales
                const moves = !on && !fitsPair(track, draft.work, stage)
                return (
                  <li key={stage}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => pick({ sales: stage })}
                      className={`${OPTION} ${on ? OPTION_ON : OPTION_OFF}`}
                    >
                      <span className={`w-5 font-mono text-[11px] ${TONE.muted}`}>{index + 1}</span>
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{SALES_STAGE_LABEL[stage]}</span>
                      {moves ? <span className={TAG}>moves work stage</span> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {salesHelp ? (
          <div className="rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 py-2 text-[12px] leading-relaxed" aria-live="polite">
            <div className="font-semibold">{SALES_STAGE_LABEL[draft.sales!]}</div>
            <div className={TONE.muted}>{salesHelp.meaning}</div>
            <div className={TONE.muted}>{salesHelp.example}</div>
          </div>
        ) : null}

        {exception ? (
          <Field label="Why do these two stages go together?" htmlFor="pair-reason" hint="These two stages do not usually fit. The reason is kept in History.">
            <Input id="pair-reason" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}

        {error ? <PanelAlert>{error}</PanelAlert> : null}

        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="ghost" disabled={move.isPending} onClick={onClose} className={QUIET}>
            Cancel
          </Button>
          <Button type="button" disabled={move.isPending || unchanged} onClick={save} className={PRIMARY}>
            {move.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
