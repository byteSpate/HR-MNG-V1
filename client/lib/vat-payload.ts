/**
 * The VAT fields a money line sends to the server. A typed rate goes only
 * with the typed method: the server refuses a rate that is empty or is not a
 * number, and a line changed back from "Type a VAT %" to a VAT code still
 * holds the old text in state.
 */
export function vatFieldsFor(line: { vatCodeId: string; vatMethod: "CODE" | "MANUAL"; vatRatePercent: string }) {
  return line.vatMethod === "MANUAL"
    ? { vatCodeId: line.vatCodeId, vatMethod: line.vatMethod, vatRatePercent: line.vatRatePercent }
    : { vatCodeId: line.vatCodeId, vatMethod: line.vatMethod }
}
