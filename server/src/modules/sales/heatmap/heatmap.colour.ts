import type { HeatmapColour } from "../sales.types"

/**
 * How a product gets its colour (owner, 2026-10-18). Nobody picks it. Each
 * part has a tick (GREEN), a cross (RED) or nothing (null), and the product
 * follows its parts. One function, so the Heatmap tab and the dashboard can
 * never disagree about what a product is.
 */
export type PartMark = "GREEN" | "RED" | null

/**
 * Green: at least one part has a tick, so there is something to sell.
 * Red: every part has a cross. Anything else is Grey, so a product that is
 * half crossed never says "no chance" by mistake.
 */
export function productColour(marks: readonly PartMark[]): HeatmapColour {
  if (marks.some((m) => m === "GREEN")) return "GREEN"
  if (marks.length > 0 && marks.every((m) => m === "RED")) return "RED"
  return "GREY"
}

/** A part's mark in words, for History. */
export const markText = (mark: PartMark): string => (mark === "GREEN" ? "Tick" : mark === "RED" ? "Cross" : "Not checked")

/** A product's marks in words, for History. */
export function productText(marks: readonly PartMark[]): string {
  const ticked = marks.filter((m) => m === "GREEN").length
  const crossed = marks.filter((m) => m === "RED").length
  return `${ticked} ticked, ${crossed} crossed, ${marks.length - ticked - crossed} not checked`
}
