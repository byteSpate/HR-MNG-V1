"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiAddLine } from "@remixicon/react"

import { addQuote, deleteQuote, editQuote, listDocumentLinks } from "@/lib/api/sales/opportunities"
import { funnelKeys } from "@/lib/api/sales/funnel-keys"
import { opportunityWriteKeys, salesKeys } from "@/lib/api/sales/keys"
import { costingLinks } from "@/lib/costing-links"
import { QUOTED_STAGES } from "@/lib/api/sales/stages"
import { useSession } from "@/lib/auth/session-context"
import type { OpportunityQuoteView, OpportunitySummary, QuoteBody } from "@/lib/api/types"
import { emptyQuoteDraft, longDay, quoteBodyOf, quoteTitle, todayIso, type QuoteDraft } from "@/lib/quotes"
import { ConfirmDeleteDialog, PanelAlert, PanelNotice, TONE, toMessage } from "@/components/dashboard/record-kit"
import { STAGE_LABEL, taka } from "@/components/sales/shared/sales-shared"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { QuoteFields } from "@/components/sales/opportunities/quote-fields"
import { CostingLinkList } from "@/components/sales/opportunities/costing-link-list"
import { Button } from "@/components/ui/button"

const PRIMARY = "h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
const QUIET = "h-auto rounded-md px-3 py-1.5 text-[12px] font-bold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"

const draftOf = (q: OpportunityQuoteView): QuoteDraft => ({
  amount: q.amount, quotedOn: q.quotedOn, reference: q.reference ?? "", note: q.note ?? "",
})

/**
 * Every price sent on this Opportunity, newest first (owner, 2026-10-13). The
 * Opportunity's value is the latest quote. Only the latest can be edited or
 * deleted, by the owner or a Sales Admin; older quotes are history.
 */
export function QuotesPanel({ deal, canManage }: { deal: OpportunitySummary; canManage: boolean }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<{ mode: "add" } | { mode: "edit"; id: string } | null>(null)
  const [draft, setDraft] = useState<QuoteDraft>(emptyQuoteDraft)
  const [removing, setRemoving] = useState<OpportunityQuoteView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = deal.status === "ONGOING"
  // Each quote shows its Costing and BOQ links (owner, 2026-10-18). The same
  // list the Documents tab reads, so they stay in step.
  const documents = useQuery({
    queryKey: salesKeys.opportunityDocuments(deal.id),
    queryFn: () => listDocumentLinks(accessToken!, deal.id),
    enabled: !!accessToken && deal.quotes.length > 0,
  })
  const inQuoteStage = QUOTED_STAGES.has(deal.stage) || deal.offeredOn !== null
  const done = () => {
    for (const key of opportunityWriteKeys(deal.id)) queryClient.invalidateQueries({ queryKey: key })
    queryClient.invalidateQueries({ queryKey: funnelKeys.all })
    setForm(null)
    setRemoving(null)
    setError(null)
  }
  const save = useMutation({
    mutationFn: (body: QuoteBody) =>
      form?.mode === "edit" ? editQuote(accessToken!, deal.id, form.id, body) : addQuote(accessToken!, deal.id, body),
    onSuccess: done,
    onError: (err) => setError(toMessage(err)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteQuote(accessToken!, deal.id, id),
    onSuccess: done,
    onError: (err) => {
      setRemoving(null)
      setError(toMessage(err))
    },
  })

  if (!inQuoteStage) return null

  const submit = () => {
    const result = quoteBodyOf(draft, todayIso())
    if ("error" in result) return setError(result.error)
    setError(null)
    save.mutate(result.body)
  }

  const formBlock = (
    <div className="mt-3 grid gap-3 rounded-md border border-[#E4E9EF] bg-[#F9FAFB] p-3">
      <QuoteFields draft={draft} onChange={setDraft} idPrefix="quote" />
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={save.isPending} onClick={submit} className={PRIMARY}>
          {save.isPending ? "Saving…" : form?.mode === "edit" ? "Save quote" : "Add quote"}
        </Button>
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => setForm(null)} className={QUIET}>
          Cancel
        </Button>
      </div>
    </div>
  )

  return (
    <Panel>
      <PanelHeading title="Quotes" />
      <p className={`-mt-1 mb-3 text-[12.5px] leading-relaxed ${TONE.muted}`}>
        Every price we sent. The Opportunity value is the latest quote.
      </p>
      {error ? <PanelAlert>{error}</PanelAlert> : null}

      {deal.quotes.length === 0 ? (
        <PanelNotice>Quote missing. Add the quote so the Funnel and targets show the right amount.</PanelNotice>
      ) : (
        <ul className="grid gap-2">
          {deal.quotes.map((q, i) => (
            <li key={q.id} className="rounded-md border border-[#E4E9EF] px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                <span className="font-bold">{quoteTitle(i, deal.quotes.length)}</span>
                <span className="font-semibold">{taka(q.amount)}</span>
                <span className={TONE.muted}>{longDay(q.quotedOn)}</span>
                {q.reference ? <span className={TONE.muted}>{q.reference}</span> : null}
                <span className={TONE.muted}>{STAGE_LABEL[q.stage]}</span>
                {i === 0 && open && deal.canEditQuotes && !form ? (
                  <span className="ml-auto flex gap-1">
                    <Button type="button" variant="ghost" className={QUIET} onClick={() => { setDraft(draftOf(q)); setError(null); setForm({ mode: "edit", id: q.id }) }}>
                      Edit
                    </Button>
                    <Button type="button" variant="ghost" className={QUIET} onClick={() => setRemoving(q)}>
                      Delete
                    </Button>
                  </span>
                ) : null}
              </div>
              {q.note ? <p className={`mt-1 text-[12px] [overflow-wrap:anywhere] ${TONE.muted}`}>{q.note}</p> : null}
              {costingLinks(documents.data ?? [], q.id).length > 0 ? (
                <div className="mt-1.5 border-t border-[#EEF1F5] pt-1.5">
                  <div className={`text-[11.5px] font-bold ${TONE.muted}`}>Costing and BOQ</div>
                  <CostingLinkList links={costingLinks(documents.data ?? [], q.id)} quotes={deal.quotes} showQuote={false} />
                </div>
              ) : null}
              {form?.mode === "edit" && form.id === q.id ? formBlock : null}
            </li>
          ))}
        </ul>
      )}

      {open && canManage && !form ? (
        <Button type="button" onClick={() => { setDraft(emptyQuoteDraft()); setError(null); setForm({ mode: "add" }) }} className={`mt-3 gap-1.5 ${PRIMARY}`}>
          <RiAddLine className="size-4" aria-hidden />
          Add quote
        </Button>
      ) : null}
      {form?.mode === "add" ? formBlock : null}

      <ConfirmDeleteDialog
        open={!!removing}
        what={removing ? `${quoteTitle(0, deal.quotes.length)}, ${taka(removing.amount)}` : "this quote"}
        detail={deal.quotes.length > 1
          ? "The Opportunity value goes back to the quote before it."
          : "The Opportunity value stays as it is, and the Funnel shows Quote missing."}
        pending={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Panel>
  )
}
