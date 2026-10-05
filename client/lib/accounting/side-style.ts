import { fromPaisa, toPaisa } from "../../components/accounting/accounting-shared"

/**
 * Which side a screen calls Debit, and which it calls Credit.
 *
 * The database and the server keep the books the standard way: money into the
 * bank is a Debit to the Bank account. Management reads the accounts next to
 * the bank's own statement, which is written from the bank's side, where a
 * deposit is a Credit and a withdrawal is a Debit (owner decision, 2026-10-05).
 *
 * So with `"bank"`, every screen shows the opposite side of what is stored,
 * and what a person types is saved on the opposite side. Nothing stored
 * changes, nothing is migrated, and the statements and totals stay correct.
 * To go back to the standard wording, set SIDE_STYLE to `"books"`.
 *
 * The swap lives here, once, and the API files apply it at the edge. A screen
 * never swaps by hand, so two screens cannot disagree.
 */
export type SideStyle = "books" | "bank"

export const SIDE_STYLE: SideStyle = "bank"

type Pair = { debit?: unknown; credit?: unknown }

/** Green: money coming in. Red: money going out. Full class names, so Tailwind sees them. */
export const IN_TEXT = "text-emerald-700"
export const OUT_TEXT = "text-red-700"

export function createSideStyle(style: SideStyle) {
  const flip = style === "bank"

  /** The two sides of one line, exchanged. A side that was left out stays left out. */
  function pair<T extends Pair>(item: T): T {
    if (!flip) return item
    const { debit, credit, ...rest } = item
    const swapped: Pair = { ...rest }
    if (credit !== undefined) swapped.debit = credit
    if (debit !== undefined) swapped.credit = debit
    return swapped as T
  }

  /** What a person typed into an editor, as it must be saved. */
  function lineInput<T extends Pair>(item: T): T {
    return pair(item)
  }

  function journal<T extends { lines: Pair[] }>(item: T): T {
    return flip ? { ...item, lines: item.lines.map((line) => pair(line)) } : item
  }

  function journalPage<T extends { rows: Array<{ lines: Pair[] }> }>(page: T): T {
    return flip ? { ...page, rows: page.rows.map((row) => journal(row)) } : page
  }

  function ledger<T extends { rows: Pair[]; totalDebit: string; totalCredit: string }>(result: T): T {
    if (!flip) return result
    return {
      ...result,
      totalDebit: result.totalCredit,
      totalCredit: result.totalDebit,
      rows: result.rows.map((row) => pair(row)),
    }
  }

  /** The two totals of a "does not balance" message. */
  function totals<T extends { debitTotal: string; creditTotal: string }>(item: T): T {
    return flip ? { ...item, debitTotal: item.creditTotal, creditTotal: item.debitTotal } : item
  }

  /**
   * The colour of a column on screen. What is stored as a Debit is money
   * coming in, the way the Trial Balance's In column reads it, so the column
   * that shows it is green, whatever that column is called.
   */
  function sideText(column: "debit" | "credit"): string {
    const showsIncoming = flip ? column === "credit" : column === "debit"
    return showsIncoming ? IN_TEXT : OUT_TEXT
  }

  return { style, pair, lineInput, journal, journalPage, ledger, totals, sideText }
}

/** The one in use. */
export const sides = createSideStyle(SIDE_STYLE)

/**
 * Column names for the Bank Book. The bank's statement names the columns
 * "Withdrawal (Dr.)" and "Deposit (Cr.)", in that order, so the book to hold
 * beside it uses the same words.
 */
export function bankBookHeadings(style: SideStyle = SIDE_STYLE): { debit: string; credit: string } {
  return style === "bank" ? { debit: "Withdrawal (Dr)", credit: "Deposit (Cr)" } : { debit: "Debit", credit: "Credit" }
}

/** Shapes the API sends for the Trial Balance. */
export interface TrialBalanceApiRow {
  accountId: string
  code: string
  name: string
  type: string
  openingDebit: string
  openingCredit: string
  periodDebit: string
  periodCredit: string
  closingDebit: string
  closingCredit: string
}

export interface TrialBalanceInOutRow<T extends string = string> {
  accountId: string
  code: string
  name: string
  type: T
  /** Opening balance as one number: money in is positive, money owed is negative. */
  opening: string
  /** Added to the account in the period (stored as Debit). */
  in: string
  /** Taken from the account in the period (stored as Credit). */
  out: string
  closing: string
}

/** A balance as one signed number: Debit minus Credit, with no minus sign on zero. */
export function signedBalance(debit: string, credit: string): string {
  const net = toPaisa(debit) - toPaisa(credit)
  return fromPaisa(net === 0 ? 0 : net)
}

/**
 * One Trial Balance row as Opening, In, Out and Closing. In and Out are the
 * stored Debit and Credit movement, named without either word, so the same
 * table is right whichever way the screens call the sides.
 */
export function toInOut<T extends TrialBalanceApiRow>(row: T): TrialBalanceInOutRow<T["type"]> {
  return {
    accountId: row.accountId,
    code: row.code,
    name: row.name,
    type: row.type,
    opening: signedBalance(row.openingDebit, row.openingCredit),
    in: row.periodDebit,
    out: row.periodCredit,
    closing: signedBalance(row.closingDebit, row.closingCredit),
  }
}
