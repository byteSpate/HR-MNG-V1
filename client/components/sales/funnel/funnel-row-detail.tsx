"use client"

/**
 * What opens under a funnel row: the full product list the grid summarised,
 * and the deal's remarks (revision §27.6, §27.8).
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
import type { FunnelRemark, FunnelRow } from "@/lib/api/types"
import { cn } from "@/lib/utils"

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
  canAddManagementNote,
  onAddManagementNote,
}: {
  row: FunnelRow
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

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-[#5F6B7C]">
          Remarks on this deal
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
            Nothing written on this deal yet. Remarks are the deal&apos;s own comments — the funnel
            keeps no separate notes.
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
              placeholder="What is blocking this deal?"
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
          Products on this deal
        </h4>

        {row.lines.length === 0 ? (
          <p className={cn("mt-2 text-sm", TONE.muted)}>No products on this deal yet.</p>
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
          Open the deal
          <RiArrowRightLine className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
  )
}
