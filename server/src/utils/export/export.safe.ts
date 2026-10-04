/**
 * Spreadsheet programs run a cell that starts with = + - or @ as a formula.
 * Text that people typed (a supplier name, an address) must never do that, so
 * it gets a leading apostrophe. Phone numbers and plain numbers start with +
 * or - on purpose, so those are left alone.
 */
const NUMBER_LIKE = /^[+-]?[\d\s().-]+$/

export function safeText(value: string): string {
  if (value === "") return value
  const first = value[0]
  if (first === "=" || first === "@" || first === "\t" || first === "\r") return `'${value}`
  if ((first === "+" || first === "-") && !NUMBER_LIKE.test(value)) return `'${value}`
  return value
}
