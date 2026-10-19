/**
 * A product's Total price as the form shows it while you type (owner,
 * 2026-10-18): Quantity × Price per unit, to 2 decimals. The server works
 * out the same number and stores it; this is only so the form can show it.
 * Null until both numbers are typed, so an unpriced line never reads as ৳0.
 */
export function lineTotal(quantity: string, unitValue: string): number | null {
  if (quantity.trim() === "" || unitValue.trim() === "") return null
  const q = Number(quantity)
  const u = Number(unitValue)
  if (!Number.isFinite(q) || !Number.isFinite(u)) return null
  return Math.round(q * u * 100) / 100
}

/**
 * The quantity a save sends. A Software module has no quantity field, and the
 * server refuses one, so it sends none at all; the form's starting "1" belongs
 * to products only (review of PR #99). Empty on a product means no quantity.
 */
export function lineQuantity(isModule: boolean, quantity: string): number | null | undefined {
  if (isModule) return undefined
  return quantity.trim() ? Number(quantity) : null
}
