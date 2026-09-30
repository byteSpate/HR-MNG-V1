/**
 * The numbers on the small stat tiles at the top of a Sales list.
 *
 * Every one is counted from the rows the page already loaded, so a tile can
 * never disagree with the table under it and never needs a request of its own.
 * A value that cannot be worked out is `null`, not zero: "no price yet" and
 * "a price of nothing" are different facts (UI rule 1, never fake a number).
 */

export function accountStats(accounts: Array<{ status: string; ownerActive: boolean }>) {
  const active = accounts.filter((a) => a.status === "ACTIVE").length
  return {
    total: accounts.length,
    active,
    notActive: accounts.length - active,
    needsOwner: accounts.filter((a) => !a.ownerActive).length,
  }
}

/** Money is added in paisa, as whole numbers, so float noise never reaches a tile. */
function toPaisa(value: string): number {
  return Math.round(Number(value) * 100)
}

function fromPaisa(paisa: number): string {
  const whole = Math.trunc(paisa / 100)
  const rest = Math.abs(paisa % 100)
  return `${whole}.${String(rest).padStart(2, "0")}`
}

export function opportunityStats(list: Array<{ status: string; amount: string | null }>) {
  const ongoing = list.filter((o) => o.status === "ONGOING")
  const priced = ongoing.filter((o) => o.amount !== null && o.amount !== "" && Number.isFinite(Number(o.amount)))
  return {
    ongoing: ongoing.length,
    won: list.filter((o) => o.status === "WON").length,
    closedOther: list.filter((o) => o.status === "LOST" || o.status === "CANCELLED").length,
    // Null when nothing is priced: "no value" is not "a value of nothing".
    ongoingValue: priced.length === 0 ? null : fromPaisa(priced.reduce((sum, o) => sum + toPaisa(o.amount as string), 0)),
    ongoingUnpriced: ongoing.length - priced.length,
  }
}

export function taskStats(
  list: Array<{ status: string; dueOn: string; overdue: boolean; origin: string }>,
  today: string,
) {
  const pending = list.filter((t) => t.status === "PENDING")
  return {
    pending: pending.length,
    overdue: pending.filter((t) => t.overdue).length,
    dueToday: pending.filter((t) => t.dueOn === today).length,
    done: list.filter((t) => t.status === "DONE").length,
    // Work handed out on a Project, still to do.
    fromProject: pending.filter((t) => t.origin === "PROJECT").length,
  }
}
