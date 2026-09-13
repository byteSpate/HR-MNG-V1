/**
 * Margin: the profit on what we sell.
 *
 * Typed per **product**, as a percentage of that product's Total price, so the
 * margin in taka moves with the price instead of going stale. A deal's margin
 * is its products' margins added up. Nothing is stored in taka.
 *
 * A product with no Total price, or no percentage, has **no margin yet** —
 * never ৳0. Totals leave it out and say how many they left out, and a won deal
 * with no products at all is named too, since its margin cannot be known. A
 * negative percentage is a product sold at a loss, and it reduces the total.
 */

import { dec, round2, sum, toMoneyString, type Money, type MoneyInput } from "../payroll/payroll.money"

/** A product, as much of it as its margin needs. */
type ProductMargin = { lineValue: MoneyInput | null; marginPercent: MoneyInput | null }

const known = (margin: Money | null): margin is Money => margin !== null

/** `base` times `marginPercent`, to the paisa. Null when either is missing. */
export function marginAmount(
  base: MoneyInput | null | undefined,
  marginPercent: MoneyInput | null | undefined
): Money | null {
  if (base == null || marginPercent == null) return null
  return round2(dec(base).times(dec(marginPercent)).dividedBy(100))
}

const productMargins = (lines: ProductMargin[]) =>
  lines.map((line) => marginAmount(line.lineValue, line.marginPercent)).filter(known)

/** A deal's margin, from its products. `value` is null when no product carries one. */
export function linesMargin(lines: ProductMargin[]): { value: string | null; counted: number; missing: number } {
  const margins = productMargins(lines)
  return {
    value: margins.length === 0 ? null : toMoneyString(sum(margins)),
    counted: margins.length,
    missing: lines.length - margins.length,
  }
}

export interface MarginTotal {
  /** Sum of the product margins that could be worked out. */
  value: string
  /** Products in the sum. */
  counted: number
  /** Products left out because they have no Total price or no percentage. */
  missing: number
  /** Deals with no products at all, whose margin cannot be known. */
  dealsWithoutProducts: number
}

/** The margin across a set of deals — the won ones, wherever this is used. */
export function marginTotal(deals: { lines: ProductMargin[] }[]): MarginTotal {
  const lines = deals.flatMap((deal) => deal.lines)
  const margins = productMargins(lines)
  return {
    value: toMoneyString(sum(margins)),
    counted: margins.length,
    missing: lines.length - margins.length,
    dealsWithoutProducts: deals.filter((deal) => deal.lines.length === 0).length,
  }
}
