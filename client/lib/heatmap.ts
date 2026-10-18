import type {
  HeatmapColour,
  HeatmapGroupView,
  HeatmapListLevel,
  HeatmapOverview,
  HeatmapOverviewProduct,
  HeatmapProductView,
} from "@/lib/api/types"
import type { HeatmapMarkBody } from "@/lib/api/sales/heatmap"

/**
 * The words and colours of the Heatmap (owner, 2026-10-18). Nobody picks a
 * colour. A part has a tick (they do not have it, so we can offer it), a
 * cross (they have it, or we cannot go) or nothing, and the server works the
 * product colour out from its parts. Grey means "not checked yet". It is never
 * a choice.
 */
export const COLOUR: Record<HeatmapColour, { word: string; lane: string; stripe: string; dot: string; text: string; soft: string }> = {
  GREEN: {
    word: "Can offer",
    lane: "We can start here",
    stripe: "bg-[#1F8A4C]",
    dot: "bg-[#1F8A4C]",
    text: "text-[#17673A]",
    soft: "border-[#9ED3B4] bg-[#EEF8F2]",
  },
  RED: {
    word: "Cannot offer",
    lane: "They have it, or we cannot go",
    stripe: "bg-[#C24141]",
    dot: "bg-[#C24141]",
    text: "text-[#B03A3A]",
    soft: "border-[#E9B4B4] bg-[#FCEFEF]",
  },
  GREY: {
    word: "Not checked",
    lane: "Not checked yet",
    stripe: "bg-[#C9D1DB]",
    dot: "bg-[#8A94A2]",
    text: "text-[#5F6B7C]",
    soft: "border-[#E4E9EF] bg-white",
  },
}

export const COLOUR_ORDER: readonly HeatmapColour[] = ["GREEN", "RED", "GREY"]

const partsWord = (n: number) => (n === 1 ? "part" : "parts")

/** The line under a product's name. */
export function closedLine(product: HeatmapProductView): string {
  const total = product.parts.length
  if (product.colour === "GREEN") return `${product.tickedCount} of ${total} ${partsWord(total)} ticked`
  if (product.colour === "RED") return product.note ?? "They have it, or we cannot go."
  if (total === 0) return "No parts yet"
  if (product.checkedCount === 0) return "Not checked yet"
  return `${product.checkedCount} of ${total} ${partsWord(total)} checked`
}

export interface BoardCard {
  product: HeatmapProductView
  groupTitle: string
}

/** The two sides of the board. Grey products are not on it. Order is the list's own order. */
export function boardLanes(groups: HeatmapGroupView[]): { green: BoardCard[]; red: BoardCard[] } {
  const lanes: { green: BoardCard[]; red: BoardCard[] } = { green: [], red: [] }
  for (const g of groups) {
    for (const product of g.products) {
      if (product.colour === "GREEN") lanes.green.push({ product, groupTitle: g.title })
      else if (product.colour === "RED") lanes.red.push({ product, groupTitle: g.title })
    }
  }
  return lanes
}

/** Pressing the button a part already has clears it. Any other press sets it. */
export function nextPartMark(current: "GREEN" | "RED" | null, pressed: "GREEN" | "RED"): HeatmapMarkBody {
  return current === pressed ? "NONE" : pressed
}

/** "All ticks" or "All crosses": clears when every part already has it, and sets it otherwise. */
export function allMarkTarget(product: HeatmapProductView, pressed: "GREEN" | "RED"): HeatmapMarkBody {
  return product.parts.length > 0 && product.parts.every((p) => p.mark === pressed) ? "NONE" : pressed
}

/**
 * The widths of a product's bar on the dashboard, as shares of all accounts in
 * scope. Null when there are no accounts: a bar for nobody would be a number
 * nobody measured.
 */
export function barShares(product: HeatmapOverviewProduct, accounts: number): { green: number; red: number; rest: number } | null {
  if (accounts <= 0) return null
  const green = (product.green / accounts) * 100
  const red = (product.red / accounts) * 100
  return { green, red, rest: 100 - green - red }
}

/** The top line of the dashboard band. */
export function checkedLine(overview: Pick<HeatmapOverview, "accounts" | "checkedAccounts">): string {
  if (overview.accounts === 0) return "There are no accounts yet."
  return `Accounts checked: ${overview.checkedAccounts} of ${overview.accounts}`
}

/** The list editor's note on a row some accounts use. Empty when none do. */
export function usedByText(n: number): string {
  if (n === 0) return ""
  return n === 1 ? "Used by 1 account" : `Used by ${n} accounts`
}

/** Deleting a group or product deletes what is inside it, so the confirm box says so. */
export function deleteWarning(level: HeatmapListLevel): string | null {
  return level === "parts" ? null : "This also deletes everything inside it."
}
