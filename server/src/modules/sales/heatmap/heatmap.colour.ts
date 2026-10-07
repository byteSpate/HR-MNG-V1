import { formatDateOnly, parseDateOnly } from "../../../utils/dates"
import { longDate, monthYear, type HeatmapCardSpec } from "./heatmap.cards"

export { longDate }

/**
 * The colour of a heatmap card is the sales chance on it (owner, 2026-10-07):
 *
 *   GREEN   a chance now: they need it and have none, or support on what they
 *           have ends within CHANCE_WINDOW_MONTHS, or has ended
 *   YELLOW  a chance later: support has more time left; the card says when
 *   RED     no chance: a person marked "No need" and wrote why
 *   GREY    not checked, or they have it but no end date is known
 *
 * Red comes only from a person, with a reason. Green and yellow come from
 * dates, so a yellow card turns green by itself when its time comes. A card
 * with nothing known is grey, never green, so an empty card never looks like
 * good news.
 */

export type HeatmapColour = "GREEN" | "YELLOW" | "RED" | "GREY"
export type HeatmapNeed = "NEED" | "NO_NEED"

/** How long before support ends that a renewal counts as a chance now. */
export const CHANCE_WINDOW_MONTHS = 12

/** The same day, `months` earlier. A day that does not exist that month becomes its last day. */
export function monthsBefore(dateOnly: string, months: number): string {
  const d = parseDateOnly(dateOnly)
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() - months
  const year = Math.floor(total / 12)
  const month = total % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return formatDateOnly(new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay))))
}

/** The date that sets an item's colour: the earliest of its support end and any card date that counts. */
export function colourDateOf(
  card: HeatmapCardSpec,
  item: { supportEndsOn: string | null; details: Record<string, string> },
): string | null {
  const dates = [item.supportEndsOn, ...card.extras.filter((f) => f.setsColour).map((f) => item.details[f.key] ?? null)]
    .filter((d): d is string => !!d)
    .sort()
  return dates[0] ?? null
}

export function cardColour(
  input: { need: HeatmapNeed | null; needReason: string | null; dates: (string | null)[] },
  today: string,
): { colour: HeatmapColour; reason: string; chanceFrom: string | null } {
  if (input.need === "NO_NEED") {
    return { colour: "RED", reason: `No need: ${input.needReason ?? ""}`.trim(), chanceFrom: null }
  }
  if (input.dates.length === 0) {
    return input.need === "NEED"
      ? { colour: "GREEN", reason: "They need it and have none yet.", chanceFrom: null }
      : { colour: "GREY", reason: "Not checked yet. Ask if they need it.", chanceFrom: null }
  }

  const known = input.dates.filter((d): d is string => !!d).sort()
  if (known.length === 0) {
    return { colour: "GREY", reason: "They have it, but no end date is recorded. Add one to see the chance.", chanceFrom: null }
  }
  // Dates are YYYY-MM-DD, so comparing the text compares the days.
  const earliest = known[0]
  const chanceFrom = monthsBefore(earliest, CHANCE_WINDOW_MONTHS)
  if (earliest < today) return { colour: "GREEN", reason: `Ended on ${longDate(earliest)}.`, chanceFrom }
  if (chanceFrom <= today) return { colour: "GREEN", reason: `Ends on ${longDate(earliest)}.`, chanceFrom }

  const undated = input.dates.length - known.length
  const note = undated === 0 ? "" : undated === 1 ? " 1 item has no end date." : ` ${undated} items have no end date.`
  return { colour: "YELLOW", reason: `Chance from ${monthYear(chanceFrom)}.${note}`, chanceFrom }
}
