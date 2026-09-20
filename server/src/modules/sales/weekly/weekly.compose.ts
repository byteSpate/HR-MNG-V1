/**
 * Composing one person's week out of what the Sales Hub already records
 * (revision §26.6, §26.7).
 *
 * The Weekly Report is mostly a view. Calls, meetings, deal changes and
 * finished tasks are read from where they live and grouped into one row per
 * account per day — the shape of the team's own sheets. Only Challenges, Gap
 * and a next step for an account with no deal are typed, and those arrive
 * here as notes.
 *
 * Pure: the loader reads the rows, this decides what the week looks like. So
 * the page, the PDF and the tests all see the same week.
 */

import { officeDateOf } from "../../attendance/attendance.time"
import {
  dayLabelOf,
  saturdayBefore,
  weekDays,
  type DayLabel,
  type LeaveWindow,
  type WeeklyHoliday,
} from "./weekly.dates"
import type { Shift } from "../../../generated/prisma/client"

// ── what the loader passes in ────────────────────────────────────────────────

export interface WeekAccount {
  id: string
  name: string
}

export interface WeekCommunication {
  id: string
  salesAccountId: string
  channel: string
  occurredAt: Date
  summary: string
}

export interface WeekMeeting {
  id: string
  salesAccountId: string
  title: string
  scheduledAt: Date
  status: string
  outcome: string | null
}

export interface WeekDealLine {
  product: string
  model: string | null
  quantity: number | null
}

export interface WeekDeal {
  id: string
  salesAccountId: string
  serial: string
  name: string
  status: string
  nextStep: string | null
  softwareNeeded: boolean | null
  lines: WeekDealLine[]
}

/** A deal event by this person: created, stage, next step, won or closed. */
export interface WeekDealChange {
  opportunityId: string
  salesAccountId: string
  at: Date
  title: string
}

export interface WeekTaskDone {
  id: string
  salesAccountId: string
  title: string
  completedAt: Date
}

export interface WeekOpenTask {
  id: string
  salesAccountId: string
  title: string
  dueOn: Date
}

export interface WeekNote {
  date: Date
  salesAccountId: string
  challenges: string | null
  gap: string | null
  nextStep: string | null
  taskId: string | null
}

export interface WeekOtherWork {
  id: string
  date: Date
  text: string
}

export interface ComposeInput {
  weekStart: Date
  person: {
    shift: Pick<Shift, "weeklyOffDays">
    joiningDate: Date
    lastWorkingDay: Date | null
  }
  holidays: WeeklyHoliday[]
  leaves: LeaveWindow[]
  accounts: WeekAccount[]
  communications: WeekCommunication[]
  meetings: WeekMeeting[]
  deals: WeekDeal[]
  dealChanges: WeekDealChange[]
  tasksDone: WeekTaskDone[]
  openTasks: WeekOpenTask[]
  notes: WeekNote[]
  otherWork: WeekOtherWork[]
}

// ── what it gives back ───────────────────────────────────────────────────────

export interface WeekRowDeal {
  id: string
  serial: string
  name: string
  /** The products, or the deal's name when it has no lines yet. */
  requirement: string
  softwareNeeded: boolean | null
  nextStep: string | null
}

export interface WeekAccountRow {
  salesAccountId: string
  accountName: string
  deals: WeekRowDeal[]
  /** The row's Requirement column: the deals' products, or that there is none. */
  requirement: string
  /** What was done that day, one line each. */
  visited: string[]
  pendingTasks: Array<{ id: string; title: string; dueOn: Date }>
  challenges: string | null
  gap: string | null
  /** Typed, and only where the account has no open deal (§26.7). */
  nextStep: string | null
  taskId: string | null
}

export interface WeekDayView {
  date: Date
  label: DayLabel | null
  accounts: WeekAccountRow[]
  otherWork: WeekOtherWork[]
}

export interface WeekCounts {
  accounts: number
  communications: number
  meetings: number
  dealChanges: number
  tasksDone: number
}

export interface WeekView {
  weekStart: Date
  days: WeekDayView[]
  counts: WeekCounts
}

const NO_REQUIREMENT = "No open requirement"

const CHANNEL_LABEL: Record<string, string> = {
  CALL: "Call",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  OTHER: "Other",
}

const MEETING_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
}

const label = (map: Record<string, string>, value: string) => map[value] ?? value
const key = (date: Date) => date.getTime()

/** "Cisco C9300 C9300-24T-4X × 2", the way the team writes a requirement. */
function requirementOf(deal: WeekDeal): string {
  if (deal.lines.length === 0) return deal.name
  return deal.lines
    .map((line) => {
      const name = [line.product, line.model].filter(Boolean).join(" ")
      return line.quantity === null ? name : `${name} × ${line.quantity}`
    })
    .join(", ")
}

/**
 * The week as the page and the PDF both read it.
 *
 * Days come from the week rules; the Saturday before is dropped unless it
 * carries something, because an empty sixth column is not a day anybody
 * worked (§26.2).
 */
export function composeWeek(input: ComposeInput): WeekView {
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]))
  const days = [saturdayBefore(input.weekStart), ...weekDays(input.weekStart)]
  const inWeek = new Set(days.map(key))

  /** day -> account -> the row being built. */
  const rows = new Map<number, Map<string, WeekAccountRow>>()
  const counts: WeekCounts = {
    accounts: 0,
    communications: 0,
    meetings: 0,
    dealChanges: 0,
    tasksDone: 0,
  }

  const rowFor = (date: Date, salesAccountId: string): WeekAccountRow | null => {
    const account = accountsById.get(salesAccountId)
    if (!account || !inWeek.has(key(date))) return null

    const forDay = rows.get(key(date)) ?? new Map<string, WeekAccountRow>()
    rows.set(key(date), forDay)

    const existing = forDay.get(salesAccountId)
    if (existing) return existing

    const open = input.deals.filter(
      (deal) => deal.salesAccountId === salesAccountId && deal.status === "ONGOING"
    )
    const dealRows = open.map((deal) => ({
      id: deal.id,
      serial: deal.serial,
      name: deal.name,
      requirement: requirementOf(deal),
      softwareNeeded: deal.softwareNeeded,
      nextStep: deal.nextStep,
    }))

    const row: WeekAccountRow = {
      salesAccountId,
      accountName: account.name,
      deals: dealRows,
      requirement:
        dealRows.length === 0 ? NO_REQUIREMENT : dealRows.map((deal) => deal.requirement).join("; "),
      visited: [],
      pendingTasks: input.openTasks
        .filter((task) => task.salesAccountId === salesAccountId)
        .map((task) => ({ id: task.id, title: task.title, dueOn: task.dueOn })),
      challenges: null,
      gap: null,
      nextStep: null,
      taskId: null,
    }
    forDay.set(salesAccountId, row)
    return row
  }

  for (const communication of input.communications) {
    const row = rowFor(officeDateOf(communication.occurredAt), communication.salesAccountId)
    if (!row) continue
    row.visited.push(`${label(CHANNEL_LABEL, communication.channel)}: ${communication.summary}`)
    counts.communications++
  }

  for (const meeting of input.meetings) {
    const row = rowFor(officeDateOf(meeting.scheduledAt), meeting.salesAccountId)
    if (!row) continue
    const head = `Meeting: ${meeting.title} (${label(MEETING_STATUS_LABEL, meeting.status)})`
    row.visited.push(meeting.outcome ? `${head} — ${meeting.outcome}` : head)
    counts.meetings++
  }

  for (const change of input.dealChanges) {
    const row = rowFor(officeDateOf(change.at), change.salesAccountId)
    if (!row) continue
    row.visited.push(`Deal: ${change.title}`)
    counts.dealChanges++
  }

  for (const task of input.tasksDone) {
    const row = rowFor(officeDateOf(task.completedAt), task.salesAccountId)
    if (!row) continue
    row.visited.push(`Task done: ${task.title}`)
    counts.tasksDone++
  }

  // Typed lines come last: a note stands on its own, so a note on a day the
  // hub knows nothing about still puts its account there.
  for (const note of input.notes) {
    const row = rowFor(note.date, note.salesAccountId)
    if (!row) continue
    row.challenges = note.challenges
    row.gap = note.gap
    row.taskId = note.taskId
    // Only where the account has no open deal, so a deal's own next step is
    // never shadowed by an older typed one.
    row.nextStep = row.deals.length === 0 ? note.nextStep : null
  }

  const otherByDay = new Map<number, WeekOtherWork[]>()
  for (const work of input.otherWork) {
    if (!inWeek.has(key(work.date))) continue
    otherByDay.set(key(work.date), [...(otherByDay.get(key(work.date)) ?? []), work])
  }

  const worked = new Set<string>()
  const view: WeekDayView[] = days.map((date) => {
    const forDay = rows.get(key(date))
    const accounts = input.accounts
      .map((account) => forDay?.get(account.id))
      .filter((row): row is WeekAccountRow => row !== undefined)
    for (const row of accounts) worked.add(row.salesAccountId)
    return {
      date,
      label: dayLabelOf(date, {
        shift: input.person.shift,
        holidays: input.holidays,
        leaves: input.leaves,
        joiningDate: input.person.joiningDate,
        lastWorkingDay: input.person.lastWorkingDay,
      }),
      accounts,
      otherWork: otherByDay.get(key(date)) ?? [],
    }
  })
  counts.accounts = worked.size

  const [saturday, ...rest] = view
  const keepSaturday = saturday.accounts.length > 0 || saturday.otherWork.length > 0
  return { weekStart: input.weekStart, days: keepSaturday ? view : rest, counts }
}
