"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { changeOpportunityStage } from "@/lib/api/sales/opportunities"
import { useSession } from "@/lib/auth/session-context"
import type { OpportunityStage, OpportunitySummary } from "@/lib/api/types"
import { emptyQuoteDraft, quoteBodyOf, todayIso } from "@/lib/quotes"
import { Field, PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { STAGE_LABEL } from "@/components/sales/shared/sales-shared"
import { QuoteFields } from "@/components/sales/opportunities/quote-fields"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const PRIMARY = "h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
const QUIET = "h-auto rounded-md px-3.5 py-2 text-[12.5px] font-bold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"

/**
 * The stage change box for a quote stage (owner, 2026-10-13). REQUIRED: the
 * first move into a quote stage needs Quote 1, or "Move without a quote" with
 * a reason (when a Sales Admin allows it). OPTIONAL: a revision stage offers a
 * new quote, or "Skip, just move".
 */
export function StageChangeDialog({
  deal,
  stage,
  ask,
  canSkipQuote,
  onClose,
  onMoved,
}: {
  deal: OpportunitySummary
  stage: OpportunityStage
  ask: "REQUIRED" | "OPTIONAL"
  canSkipQuote: boolean
  onClose: () => void
  onMoved: () => void
}) {
  const { accessToken } = useSession()
  const [draft, setDraft] = useState(emptyQuoteDraft)
  const [skipping, setSkipping] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const move = useMutation({
    mutationFn: (extra: Parameters<typeof changeOpportunityStage>[3]) =>
      changeOpportunityStage(accessToken!, deal.id, stage, extra),
    onSuccess: onMoved,
    onError: (err) => setError(toMessage(err)),
  })

  const saveWithQuote = () => {
    const result = quoteBodyOf(draft, todayIso())
    if ("error" in result) return setError(result.error)
    setError(null)
    move.mutate({ quote: result.body })
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !move.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to {STAGE_LABEL[stage]}</DialogTitle>
        </DialogHeader>

        {skipping ? (
          <Field label="Why is there no quote yet?" htmlFor="skip-reason">
            <Input
              id="skip-reason"
              autoFocus
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: the OEM price comes next week."
            />
          </Field>
        ) : (
          <>
            <p className={`text-[12.5px] leading-relaxed ${TONE.muted}`}>
              {ask === "REQUIRED"
                ? "This is a quote stage. Write the price you sent. The Funnel and targets use it."
                : "Did the price change? Save the new quote. If only the terms changed, just move."}
            </p>
            <QuoteFields draft={draft} onChange={setDraft} idPrefix="stage-quote" />
            {ask === "REQUIRED" && !canSkipQuote ? (
              <p className={`text-[11.5px] ${TONE.muted}`}>A Sales Admin has turned off moving without a quote.</p>
            ) : null}
          </>
        )}

        {error ? <PanelAlert>{error}</PanelAlert> : null}

        <DialogFooter className="flex-wrap gap-2">
          {skipping ? (
            <>
              <Button type="button" variant="ghost" disabled={move.isPending} onClick={() => setSkipping(false)} className={QUIET}>
                Back to the quote
              </Button>
              <Button
                type="button"
                disabled={move.isPending || !reason.trim()}
                onClick={() => move.mutate({ skipQuoteReason: reason.trim() })}
                className={PRIMARY}
              >
                {move.isPending ? "Moving…" : "Move without a quote"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" disabled={move.isPending} onClick={onClose} className={QUIET}>
                Cancel
              </Button>
              {ask === "REQUIRED" && canSkipQuote ? (
                <Button type="button" variant="ghost" disabled={move.isPending} onClick={() => setSkipping(true)} className={QUIET}>
                  Move without a quote
                </Button>
              ) : null}
              {ask === "OPTIONAL" ? (
                <Button type="button" variant="ghost" disabled={move.isPending} onClick={() => move.mutate(undefined)} className={QUIET}>
                  Skip, just move
                </Button>
              ) : null}
              <Button type="button" disabled={move.isPending} onClick={saveWithQuote} className={PRIMARY}>
                {move.isPending ? "Moving…" : "Move and save quote"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
