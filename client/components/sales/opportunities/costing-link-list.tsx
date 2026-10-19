"use client"

import { RiExternalLinkLine } from "@remixicon/react"

import type { DocumentLinkSummary, OpportunityQuoteView } from "@/lib/api/types"
import { lockedLine } from "@/lib/costing-links"
import { quoteTitle } from "@/lib/quotes"
import { TONE } from "@/components/dashboard/record-kit"

/**
 * Costing and BOQ links (owner, 2026-10-18). An admin sees each link and the
 * quote it belongs to. Everyone else sees only how many there are, because a
 * costing can show what we pay suppliers.
 */
export function CostingLinkList({
  links,
  quotes,
  showQuote = true,
}: {
  links: DocumentLinkSummary[]
  /** The Opportunity's quotes, newest first, to name the quote a link belongs to. */
  quotes: OpportunityQuoteView[]
  showQuote?: boolean
}) {
  const open = links.filter((l) => !l.locked && l.url)
  const locked = links.length - open.length
  const quoteName = (id: string | null) => {
    const i = quotes.findIndex((q) => q.id === id)
    return i < 0 ? null : quoteTitle(i, quotes.length)
  }

  return (
    <div className="grid gap-1">
      {open.length > 0 ? (
        <ul className="divide-y divide-[#E4E9EF]">
          {open.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <a
                href={d.url!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[13px] font-semibold hover:underline"
              >
                {d.name} <RiExternalLinkLine className="size-3.5" aria-hidden />
              </a>
              <span className={`text-[12px] ${TONE.muted}`}>
                {[showQuote ? (quoteName(d.quoteId) ?? "No quote") : null, d.createdByName ?? "Someone", new Date(d.createdAt).toLocaleDateString()]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {locked > 0 ? <p className={`text-[12px] ${TONE.muted}`}>{lockedLine(locked)}</p> : null}
    </div>
  )
}
