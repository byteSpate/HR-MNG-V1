import type { HeatmapColour, HeatmapProductView } from "@/lib/api/types"

/**
 * The words and colours of a heatmap row (owner, 2026-10-13). A person picks
 * the colour; the server only stores it. Grey means "not picked yet". It is
 * never a choice.
 */
export const COLOUR: Record<HeatmapColour, { word: string; stripe: string; dot: string; text: string; soft: string }> = {
  GREEN: { word: "Can sell", stripe: "bg-[#1F8A4C]", dot: "bg-[#1F8A4C]", text: "text-[#17673A]", soft: "border-[#9ED3B4] bg-[#EEF8F2]" },
  RED: { word: "No chance", stripe: "bg-[#C24141]", dot: "bg-[#C24141]", text: "text-[#B03A3A]", soft: "border-[#E9B4B4] bg-[#FCEFEF]" },
  GREY: { word: "Not picked", stripe: "bg-[#C9D1DB]", dot: "bg-[#8A94A2]", text: "text-[#5F6B7C]", soft: "border-[#E4E9EF] bg-white" },
}

export const COLOUR_ORDER: readonly HeatmapColour[] = ["GREEN", "RED", "GREY"]

/** The line under a closed row's name. */
export function closedLine(product: HeatmapProductView): string {
  if (product.colour === "RED") return `No need: ${product.reason ?? ""}`.trim()
  if (product.parts.length === 0) return ""
  if (product.inScopeCount === 0) return "Nothing in scope yet"
  return `${product.inScopeCount} of ${product.parts.length} in scope`
}
