import type { DocumentLinkSummary } from "@/lib/api/types"

/**
 * The Costing and BOQ links of an Opportunity (owner, 2026-10-18), shown in
 * the stage box at Commercial Proposal & Negotiation and under each quote.
 * Pass a quote id to keep only that quote's links.
 */
export function costingLinks(links: DocumentLinkSummary[], quoteId?: string): DocumentLinkSummary[] {
  return links.filter((l) => l.kind === "COSTING_BOQ" && (quoteId === undefined || l.quoteId === quoteId))
}

/** What someone who is not an admin sees instead of the links they cannot open. */
export function lockedLine(count: number): string {
  return count === 1 ? "1 link (only admins can open it)" : `${count} links (only admins can open them)`
}
