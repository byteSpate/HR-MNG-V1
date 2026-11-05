/**
 * Helpers for edit forms that must be able to CLEAR a field.
 *
 * On an edit the server reads a missing key as "keep this" and `null` as
 * "clear this". A form that sends `undefined` for an empty box can never
 * clear anything. These helpers return the right one of the three answers.
 */

/** A trimmed string, or `null` when the box is empty. */
export function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

/**
 * The value to send for a text box on an edit.
 * `undefined` = unchanged (leave the key out), `null` = cleared, string = new text.
 */
export function editText(value: string, original: string | null | undefined): string | null | undefined {
  const next = blankToNull(value)
  const before = blankToNull(original ?? "")
  if (next === before) return undefined
  return next
}

/** Same as `editText`, for a `YYYY-MM-DD` date box. */
export function editDate(value: string, original: string | null | undefined): string | null | undefined {
  const next = value === "" ? null : value
  const before = original ? original : null
  if (next === before) return undefined
  return next
}
