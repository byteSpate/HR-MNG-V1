"use client"

/**
 * What opens under a funnel row: the full product list the grid summarised,
 * and the deal's remarks (revision §27.6, §27.8).
 *
 * The grid shows the first line and "+N more" because fifteen columns leave no
 * room for a three-product deal. This is where the rest actually is — without
 * it, "+2 more" would be a count of something nobody can reach.
 */

import Link from "next/link"

import { RiArrowRightLine } from "@remixicon/react"

import { TONE } from "@/components/dashboard/record-kit"
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

export function FunnelRowDetail({ row }: { row: FunnelRow }) {
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
      </div>

      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-[#5F6B7C]">
          Products on this deal
        </h4>

        {row.lineCount === 0 ? (
          <p className={cn("mt-2 text-sm", TONE.muted)}>No products on this deal yet.</p>
        ) : (
          <p className="mt-2 text-sm text-[#1B2733]">
            {row.lineCount} {row.lineCount === 1 ? "product" : "products"}:{" "}
            {row.brand || "no brand"}
            {row.model ? `, ${row.model}` : ""}
            {row.quantity ? `, quantity ${row.quantity}` : ""}
          </p>
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
