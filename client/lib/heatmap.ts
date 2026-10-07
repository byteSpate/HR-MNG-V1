import type { HeatmapCardView, HeatmapColour, HeatmapItemBody, HeatmapItemView, HeatmapNeed } from "@/lib/api/types"

/**
 * The words and colours of a heatmap card. The colour itself is chosen by the
 * server (`heatmap.colour.ts`), which also writes the sentence that explains
 * it; this only says how each colour looks and what it is called.
 */
export const COLOUR: Record<HeatmapColour, { word: string; card: string; dot: string; text: string }> = {
  GREEN: { word: "Chance now", card: "border-[#9ED3B4] bg-[#EEF8F2]", dot: "bg-[#1F8A4C]", text: "text-[#17673A]" },
  YELLOW: { word: "Chance later", card: "border-[#EBCB7A] bg-[#FFF7E3]", dot: "bg-[#C98A0B]", text: "text-[#8A5E0C]" },
  RED: { word: "No chance", card: "border-[#E9B4B4] bg-[#FCEFEF]", dot: "bg-[#C24141]", text: "text-[#B03A3A]" },
  GREY: { word: "Not checked", card: "border-[#E4E9EF] bg-[#F6F8FA]", dot: "bg-[#8A94A2]", text: "text-[#5F6B7C]" },
}

export const COLOUR_ORDER: readonly HeatmapColour[] = ["GREEN", "YELLOW", "RED", "GREY"]

export const NEED_LABEL: Record<HeatmapNeed, string> = {
  NEED: "Need it",
  NO_NEED: "No need",
  NOT_ASKED: "Not asked yet",
}

/** Everything the item form holds, as the text in each box. */
export interface ItemDraft {
  brand: string
  model: string
  quantity: string
  site: string
  boughtFrom: string
  boughtOn: string
  supportEndsOn: string
  endOfLifeOn: string
  supportBy: string
  notes: string
  details: Record<string, string>
}

export function draftOfItem(item?: HeatmapItemView): ItemDraft {
  return {
    brand: item?.brand ?? "",
    model: item?.model ?? "",
    quantity: item ? String(item.quantity) : "1",
    site: item?.site ?? "",
    boughtFrom: item?.boughtFrom ?? "",
    boughtOn: item?.boughtOn ?? "",
    supportEndsOn: item?.supportEndsOn ?? "",
    endOfLifeOn: item?.endOfLifeOn ?? "",
    supportBy: item?.supportBy ?? "",
    notes: item?.notes ?? "",
    details: { ...(item?.details ?? {}) },
  }
}

const orNull = (s: string) => s.trim() || null

/**
 * What the form sends, or the first thing to fix. The server checks it all
 * again; this only catches the two things a person most often gets wrong, so
 * they see it before the round trip.
 */
export function itemBodyOf(draft: ItemDraft): { body: HeatmapItemBody } | { error: string } {
  if (!draft.brand.trim()) return { error: "Write the brand." }
  const quantity = draft.quantity.trim()
  if (!/^\d{1,7}$/.test(quantity) || Number(quantity) < 1) return { error: "How many must be a whole number, 1 or more." }
  const details: Record<string, string> = {}
  for (const [key, value] of Object.entries(draft.details)) if (value.trim()) details[key] = value.trim()
  return {
    body: {
      brand: draft.brand.trim(),
      model: orNull(draft.model),
      quantity: Number(quantity),
      site: orNull(draft.site),
      boughtFrom: orNull(draft.boughtFrom),
      boughtOn: orNull(draft.boughtOn),
      supportEndsOn: orNull(draft.supportEndsOn),
      endOfLifeOn: orNull(draft.endOfLifeOn),
      supportBy: orNull(draft.supportBy),
      notes: orNull(draft.notes),
      details,
    },
  }
}

export function itemTitle(item: Pick<HeatmapItemView, "brand" | "model">): string {
  return item.model ? `${item.brand} ${item.model}` : item.brand
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "3 Mar 2027", from "2027-03-03". Read as text, so no time zone can move the day. */
export function dayText(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number)
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`
}

/** The card's own fields on one item, as one line: "Ports on each switch: 24 · PoE: Yes". */
export function detailsLine(card: Pick<HeatmapCardView, "extras">, item: Pick<HeatmapItemView, "details">): string {
  return card.extras
    .filter((f) => item.details[f.key])
    .map((f) => {
      const v = item.details[f.key]
      const shown = f.type === "YES_NO" ? (v === "YES" ? "Yes" : "No") : f.type === "DATE" ? dayText(v) : v
      return `${f.label}: ${shown}`
    })
    .join(" · ")
}
