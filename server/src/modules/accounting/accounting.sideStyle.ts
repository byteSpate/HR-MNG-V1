/**
 * Which side a screen or a printout calls Debit, and which Credit.
 *
 * The database keeps the books the standard way: money into the bank is a
 * Debit to the Bank account. Management reads the accounts next to the bank's
 * own statement, where a deposit is a Credit (owner decision, 2026-10-05), so
 * what people read is the opposite of what is stored. Nothing stored changes.
 *
 * The client applies the same rule to what it shows and sends
 * (`client/lib/accounting/side-style.ts`). The two constants are kept in step
 * by hand, as the other mirrored types are. This file covers what the server
 * writes itself: error messages and the customer statement PDF.
 */
export type SideStyle = "books" | "bank"

export const SIDE_STYLE: SideStyle = "bank"

/** The two stored sides, in the order a person reads them: Debit first, then Credit. */
export function shownSides<T>(debit: T, credit: T, style: SideStyle = SIDE_STYLE): { debit: T; credit: T } {
  return style === "bank" ? { debit: credit, credit: debit } : { debit, credit }
}
