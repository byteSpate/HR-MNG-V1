"use client"

/**
 * What opens under a funnel row: every quote, the details that moved off
 * the grid (owner, 2026-10-13), the full product list, and the remarks
 * (revision §27.6, §27.8).
 *
 * The grid shows the first line and "+N more" because fifteen columns leave no
 * room for a three-product deal. This is where the rest actually is — every
 * line, product, brand, model and quantity — so "+2 more" points at something
 * a person can reach.
 */

import Link from "next/link"

import { useState } from "react"

import { RiArrowRightLine } from "@remixicon/react"

import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import type { FunnelCellField, FunnelRemark, FunnelRow } from "@/lib/api/types"
import { longDay, quoteTitle } from "@/lib/quotes"
import { taka } from "@/components/sales/shared/sales-shared"
import { FunnelCell } from "./funnel-cell"
import { cn } from "@/lib/utils"

const STAGE_LABEL: Record<string, string> = {
  REQUIREMENT_RECEIVED: "Requirement received",
  // The team's own funnel sheet calls Negotiation "Quotation Revision", and
  // that is deliberate, so it stays.
  NEGOTIATION: "Quotation Revision",
  AWAITING_DECISION: "Awaiting decision",
  // Software Development stages (spec §2.4).
  REQUIREMENT_GATHERING: "Requirement gathering",
  BRD_SENT: "BRD sent",
  SRS_SENT: "SRS sent",
  PROPOSAL_SUBMITTED: "Proposal submitted",
  PROPOSAL_REVISION: "Proposal revision",
  // Networking stages (spec 2026-09-30).
  ASSIGNED_QUALIFIED: "Opportunity Assigned & Qualified",
  DISCOVERY_DESIGN: "Discovery & Solution Design",
  TECHNICAL_VALIDATION: "Technical Validation & Approval",
  COMMERCIAL_NEGOTIATION: "Commercial Proposal & Negotiation",
  CUSTOMER_PROCUREMENT: "Customer Approval & Procurement",
  PO_RECEIVED: "PO Received / Closed Won",
}

const KIND_LABEL: Record<FunnelRemark["kind"], string> = {
  GENERAL: "Note",
  CUSTOMER_FEEDBACK: "Customer said",
  MANAGEMENT_NOTE: "Management",
}

const KIND_TONE: Record<FunnelRemark["kind"], string> = {
  GENERAL: "bg-slate-100 text-[#5F6B7C]",
  CUSTOMER_FEEDBACK: "bg-[#EAF2FB] text-[#1F4E79]",
  MANAGEMENT_NOTE: "bg-[#FDF3E2] text-[#8A5E0C]",
}

function when(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

export function FunnelRowDetail({
  row,
  editable,
  onEdit,
  canAddManagementNote,
  onAddManagementNote,
}: {
  row: FunnelRow
  editable: boolean
  onEdit: (opportunityId: string, field: FunnelCellField, value: string | null) => Promise<void>
  canAddManagementNote: boolean
  onAddManagementNote: (opportunityId: string, body: string) => Promise<void>
}) {
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function addNote() {
    const body = note.trim()
    if (!body) return
    setSaving(true)
    setError(null)
    try {
      await onAddManagementNote(row.opportunityId, body)
      setNote("")
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  const save = (field: FunnelCellField) => (value: string | null) => onEdit(row.opportunityId, field, value)
  const label = "text-xs font-medium uppercase tracking-wide text-[#5F6B7C]"

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h4 className={label}>Quotes</h4>
          {row.quotes.length === 0 ? (
            <p className={cn("mt-2 text-sm", TONE.muted)}>
              Quote missing. Add the quote on the Opportunity so the Funnel and targets show the right amount.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {row.quotes.map((q, i) => (
                <li key={q.id} className="rounded-md bg-white px-3 py-2 ring-1 ring-[#E4E9EF]">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium text-[#1B2733]">{quoteTitle(i, row.quotes.length)}</span>
                    <span className="tabular-nums">{taka(q.amount)}</span>
                    <span className={cn("text-xs", TONE.muted)}>
                      {[longDay(q.quotedOn), q.reference, STAGE_LABEL[q.stage] ?? q.stage].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {q.note ? <p className={cn("mt-1 text-xs", TONE.muted)}>{q.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <dl className="grid grid-cols-[8rem_1fr] items-start gap-x-3 gap-y-1.5 text-sm">
          <dt className={label}>Stage</dt>
          <dd>{STAGE_LABEL[row.stage] ?? row.stage}</dd>
          <dt className={label}>Use Case</dt>
          <dd><FunnelCell value={row.useCase} editable={editable} placeholder="Add" onSave={save("useCase")} /></dd>
          <dt className={label}>Next Step</dt>
          <dd><FunnelCell value={row.nextStep} editable={editable} placeholder="Add" onSave={save("nextStep")} /></dd>
          {/* Asked for only when the Opportunity is lost (§27.4). */}
          {row.status === "LOST" ? (
            <>
              <dt className={label}>Lost To</dt>
              <dd className="space-y-0.5">
                <FunnelCell value={row.lostTo.partner} editable={editable} placeholder="Who won it" onSave={save("lostToPartner")} />
                <FunnelCell
                  value={row.lostTo.amount}
                  display={row.lostTo.amount ? taka(row.lostTo.amount) : ""}
                  editable={editable}
                  type="money"
                  placeholder="At what price"
                  onSave={save("lostToAmount")}
                />
                <FunnelCell value={row.lostTo.product} editable={editable} placeholder="With what" onSave={save("lostToProduct")} />
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-[#5F6B7C]">
          Remarks on this Opportunity
        </h4>

        {/* Derived, never stored (§27.8). It sits above the remarks because it
            is the fact they are all about. */}
        {row.offerLine ? (
          <p className="mt-2 rounded-md bg-white px-3 py-2 text-sm text-[#1B2733] ring-1 ring-[#E4E9EF]">
            {row.offerLine}
          </p>
        ) : null}

        {row.remarks.length === 0 ? (
          <p className={cn("mt-2 text-sm", TONE.muted)}>
            Nothing written on this Opportunity yet. Remarks are the Opportunity&apos;s own comments.
            The funnel keeps no separate notes.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {row.remarks.map((remark) => (
              <li key={remark.id} className="rounded-md bg-white px-3 py-2 ring-1 ring-[#E4E9EF]">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      KIND_TONE[remark.kind]
                    )}
                  >
                    {KIND_LABEL[remark.kind]}
                  </span>
                  <span className={cn("text-xs", TONE.muted)}>
                    {remark.authorName} · {when(remark.createdAt)}
                  </span>
                  {/* Written during a Saturday review (§27.8). Worth saying:
                      it changes how the note should be read. */}
                  {remark.funnelMeetingId ? (
                    <span className={cn("text-xs", TONE.muted)}>· at a funnel meeting</span>
                  ) : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[#1B2733]">{remark.body}</p>
              </li>
            ))}
          </ul>
        )}

        {canAddManagementNote ? (
          <div className="mt-3 border-t border-[#E4E9EF] pt-3">
            <label htmlFor={`management-note-${row.opportunityId}`} className="text-xs font-medium uppercase tracking-wide text-[#5F6B7C]">
              Management note
            </label>
            <textarea
              id={`management-note-${row.opportunityId}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="What is blocking this Opportunity?"
              className="mt-2 w-full rounded-md border border-[#E4E9EF] px-3 py-2 text-sm outline-none focus:border-[#2D6CB5]"
            />
            {error ? <PanelAlert>{toMessage(error)}</PanelAlert> : null}
            <Button
              type="button"
              size="sm"
              className="mt-2"
              onClick={() => void addNote()}
              disabled={saving || note.trim() === ""}
            >
              {saving ? "Saving…" : "Add management note"}
            </Button>
          </div>
        ) : null}
      </div>

      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-[#5F6B7C]">
          Products on this Opportunity
        </h4>

        {row.lines.length === 0 ? (
          <p className={cn("mt-2 text-sm", TONE.muted)}>No products on this Opportunity yet.</p>
        ) : (
          // Every line, in the deal's own order: the grid's brand, model and
          // quantity cells are only the first of these.
          <ul className="mt-2 space-y-2">
            {row.lines.map((line, index) => (
              <li
                key={index}
                className="flex items-baseline justify-between gap-3 rounded-md bg-white px-3 py-2 ring-1 ring-[#E4E9EF]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#1B2733]">{line.product}</p>
                  <p className={cn("truncate text-xs", TONE.muted)}>
                    {[line.brand, line.model].filter(Boolean).join(" · ") || "No brand or model"}
                  </p>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-[#1B2733]">
                  {line.quantity === null ? (
                    <span className={cn("text-xs", TONE.muted)}>No quantity</span>
                  ) : (
                    <>Qty {line.quantity}</>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Products, and the deal's status, are changed on the deal itself.
            The funnel edits the fifteen columns and links to the rest, rather
            than growing a second half-copy of the deal page (§27.7). */}
        <Link
          href={`/sales/opportunities/${row.opportunityId}`}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#1F4E79] hover:underline"
        >
          Open the Opportunity
          <RiArrowRightLine className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
    </div>
  )
}
