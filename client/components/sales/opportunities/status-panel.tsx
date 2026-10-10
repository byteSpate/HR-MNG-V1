"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { changeOpportunityStatus, correctOpportunityStatus } from "@/lib/api/sales/opportunities"
import { opportunityWriteKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { OpportunityStatus, OpportunitySummary } from "@/lib/api/types"
import { ConfirmDialog, Field, PanelAlert, PanelNotice, TONE, toMessage } from "@/components/dashboard/record-kit"
import { OPPORTUNITY_STATUS_LABEL, stageSentence } from "@/components/sales/shared/sales-shared"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Closing = Exclude<OpportunityStatus, "ONGOING">
const CLOSING: Closing[] = ["WON", "LOST", "CANCELLED"]

const REASON_HELP: Record<Closing, string> = {
  WON: "",
  LOST: "A competitor won. Say who, or why.",
  CANCELLED: "The customer dropped it. Say why.",
}

/**
 * Won, Lost and Cancelled, and the reason (spec 2026-09-28 §1.2, §1.4). They
 * are final: a confirm dialog comes first, and only a Sales Admin sees the
 * way to correct a mistake.
 */
export function StatusPanel({ deal, canManage, isSalesAdmin }: { deal: OpportunitySummary; canManage: boolean; isSalesAdmin: boolean }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [closing, setClosing] = useState<Closing | null>(null)
  const [reason, setReason] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [correcting, setCorrecting] = useState<OpportunityStatus | null>(null)
  const [correctReason, setCorrectReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const invalidate = () => {
    for (const key of opportunityWriteKeys(deal.id)) queryClient.invalidateQueries({ queryKey: key })
  }

  const mark = useMutation({
    mutationFn: (status: Closing) =>
      changeOpportunityStatus(accessToken!, deal.id, { status, ...(status === "WON" ? {} : { statusReason: reason.trim() }) }),
    onSuccess: (_d, status) => {
      setDone(`Marked as ${OPPORTUNITY_STATUS_LABEL[status]}.`)
      setClosing(null); setReason(""); setConfirming(false); setError(null)
      invalidate()
    },
    onError: (err) => { setConfirming(false); setError(toMessage(err)) },
  })

  const correct = useMutation({
    mutationFn: (status: OpportunityStatus) => correctOpportunityStatus(accessToken!, deal.id, { status, reason: correctReason.trim() }),
    onSuccess: (_d, status) => {
      setDone(`Corrected to ${OPPORTUNITY_STATUS_LABEL[status]}.`)
      setCorrecting(null); setCorrectReason(""); setError(null)
      invalidate()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const isOpen = deal.status === "ONGOING"

  return (
    <Panel>
      <PanelHeading title="Status" />
      {error ? <PanelAlert>{error}</PanelAlert> : null}
      {done ? <PanelNotice>{done}</PanelNotice> : null}

      <p className="text-[13px]">
        {stageSentence(deal.status, deal.stage)}
        {deal.statusReason ? `. Reason: ${deal.statusReason}` : ""}
      </p>

      {isOpen && canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {CLOSING.map((s) => (
            <Button key={s} type="button" variant="outline" onClick={() => { setClosing(s); setReason(""); setDone(null) }} className="h-8 text-[12px] font-bold">
              Mark {OPPORTUNITY_STATUS_LABEL[s]}
            </Button>
          ))}
        </div>
      ) : null}

      {closing ? (
        <div className="mt-3 space-y-2 rounded-md border border-[#E4E9EF] bg-[#F7F9FB] p-3">
          {closing !== "WON" ? (
            <Field label="Reason" htmlFor="close-reason" help={REASON_HELP[closing]}>
              <Input id="close-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" disabled={closing !== "WON" && !reason.trim()} onClick={() => setConfirming(true)} className="h-8 bg-[#17191C] text-[12px] font-bold text-white hover:bg-[#0E1012]">
              Mark {OPPORTUNITY_STATUS_LABEL[closing]}
            </Button>
            <Button type="button" variant="link" onClick={() => setClosing(null)} className="h-8 p-0 text-[12px] font-bold text-[#5F6B7C]">
              Go back
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming && closing !== null}
        title={closing ? `Mark as ${OPPORTUNITY_STATUS_LABEL[closing]}?` : ""}
        body="This cannot be undone. Only a Sales Admin can correct it later."
        confirmLabel={closing ? `Mark as ${OPPORTUNITY_STATUS_LABEL[closing]}` : ""}
        pending={mark.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => closing && mark.mutate(closing)}
      />

      {!isOpen && isSalesAdmin ? (
        <div className="mt-4 border-t border-[#E4E9EF] pt-4">
          <p className={`text-[12px] ${TONE.muted}`}>
            Was this status a mistake? You can correct it. It is refused if the Opportunity has money or a Project on it.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["ONGOING", ...CLOSING] as OpportunityStatus[]).filter((s) => s !== deal.status).map((s) => (
              <Button key={s} type="button" variant="outline" onClick={() => { setCorrecting(s); setCorrectReason(""); setDone(null) }} className="h-8 text-[12px] font-bold">
                Correct to {OPPORTUNITY_STATUS_LABEL[s]}
              </Button>
            ))}
          </div>
          {correcting ? (
            <div className="mt-3 space-y-2 rounded-md border border-[#E4E9EF] bg-[#F7F9FB] p-3">
              <Field label="Why is this being corrected?" htmlFor="correct-reason">
                <Input id="correct-reason" value={correctReason} onChange={(e) => setCorrectReason(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button type="button" disabled={correctReason.trim().length < 2 || correct.isPending} onClick={() => correct.mutate(correcting)} className="h-8 bg-[#17191C] text-[12px] font-bold text-white hover:bg-[#0E1012]">
                  {correct.isPending ? "Saving…" : `Correct to ${OPPORTUNITY_STATUS_LABEL[correcting]}`}
                </Button>
                <Button type="button" variant="link" onClick={() => setCorrecting(null)} className="h-8 p-0 text-[12px] font-bold text-[#5F6B7C]">
                  Go back
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}
