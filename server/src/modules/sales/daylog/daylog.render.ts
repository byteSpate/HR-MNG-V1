/**
 * The work log as a picture (owner, 2026-11-10). The team wrote their day by
 * hand and showed management a screenshot. This draws the same thing from what
 * the app already knows: the tasks the person finished, the meetings they went
 * to, and the Opportunities they closed.
 *
 * The same split as every renderer here: `renderDayLogHtml` is pure and is what
 * the tests read, and the service only drives the browser.
 */

import type { SalesTaskType } from "../../../generated/prisma/client"
import { longDate, parseDateOnly } from "../../../utils/dates"
import { escapeHtml } from "../../../utils/pdf"
import { BRAND_DOC_CSS, brandDocHeaderHtml } from "../../../utils/pdf.brand"

export interface DayLogTask {
  title: string
  type: SalesTaskType
  /** The account and the Opportunity number, when the task has them. */
  about: string | null
  /** The Details box: who they spoke to, what was agreed. Where "I did this" puts its notes. */
  detail: string | null
  /** What came of it, as written when a planned task was marked done. */
  outcome: string | null
}

export interface DayLogMeeting {
  /** "14:30", office time. */
  time: string
  title: string
  accountName: string
  opportunitySerial: string | null
  outcome: string | null
}

export interface DayLogClose {
  status: "WON" | "LOST" | "CANCELLED"
  serial: string
  name: string
  accountName: string
  /** Already written as "5,20,000.00", or null when the Opportunity has no value. */
  amount: string | null
  reason: string | null
}

export interface DayLogDay {
  /** YYYY-MM-DD. */
  date: string
  tasks: DayLogTask[]
  meetings: DayLogMeeting[]
  closed: DayLogClose[]
}

export interface DayLog {
  personName: string
  from: string
  to: string
  days: DayLogDay[]
}

export interface DayLogRenderOptions {
  companyName: string
  /** A data URI for the logo. Without it the company name is printed. */
  logo: string | null
  /** YYYY-MM-DD, the day the picture was made. */
  madeOn: string
}

/** The same words as the Tasks page (client `task-types.ts`). */
const TASK_TYPE_LABEL: Record<SalesTaskType, string> = {
  VISIT_FOLLOW_UP: "Visit follow-up",
  QUOTATION_SENT: "Quotation sent",
  REQUIREMENT_SENT: "Requirement sent",
  CALL_OR_EMAIL: "Call or email",
  LEARNING: "Learning",
  INTERNAL_WORK: "Internal work",
  OTHER: "Other",
}

const CLOSE_LABEL: Record<DayLogClose["status"], string> = {
  WON: "Won",
  LOST: "Lost",
  CANCELLED: "Cancelled",
}

const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** "Tuesday, 10 November 2026". */
export function dayLabel(date: string): string {
  const d = parseDateOnly(date)
  return `${DAY_NAME[d.getUTCDay()]}, ${longDate(d)}`
}

function eachDate(from: string, to: string): string[] {
  const out: string[] = []
  const cursor = parseDateOnly(from)
  const end = parseDateOnly(to)
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const isEmpty = (day: DayLogDay) => day.tasks.length + day.meetings.length + day.closed.length === 0

/**
 * Every day from `from` to `to`. For a week, Friday and Saturday show only when
 * something happened on them: the team works Sunday to Thursday, the same rule
 * as the Logs tab. A single day always shows, even when nothing is on it.
 */
export function buildDays(from: string, to: string, filled: Map<string, Omit<DayLogDay, "date">>): DayLogDay[] {
  const days = eachDate(from, to).map((date) => ({
    date,
    ...(filled.get(date) ?? { tasks: [], meetings: [], closed: [] }),
  }))
  if (from === to) return days
  return days.filter((day) => {
    const weekday = parseDateOnly(day.date).getUTCDay()
    return !(weekday === 5 || weekday === 6) || !isEmpty(day)
  })
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "3 tasks done, 1 meeting, 1 Opportunity won". Only what is there. */
export function summaryLine(days: DayLogDay[]): string {
  const tasks = days.reduce((n, d) => n + d.tasks.length, 0)
  const meetings = days.reduce((n, d) => n + d.meetings.length, 0)
  const closes = days.flatMap((d) => d.closed)
  const parts = [
    tasks ? plural(tasks, "task done", "tasks done") : null,
    meetings ? plural(meetings, "meeting", "meetings") : null,
    ...(["WON", "LOST", "CANCELLED"] as const).map((status) => {
      const n = closes.filter((c) => c.status === status).length
      return n ? `${plural(n, "Opportunity", "Opportunities")} ${CLOSE_LABEL[status].toLowerCase()}` : null
    }),
  ].filter(Boolean)
  return parts.length ? parts.join(", ") : "Nothing logged"
}

export function periodLabel(from: string, to: string): string {
  return from === to ? dayLabel(from) : `${longDate(parseDateOnly(from))} to ${longDate(parseDateOnly(to))}`
}

const t = (value: string) => escapeHtml(value)

function note(value: string | null): string {
  return value ? `<p class="note">${t(value)}</p>` : ""
}

function taskItem(task: DayLogTask): string {
  return `<li><div class="row"><span class="title">${t(task.title)}</span><span class="tag">${t(TASK_TYPE_LABEL[task.type])}</span></div>${
    task.about ? `<p class="about">${t(task.about)}</p>` : ""
  }${note(task.detail)}${note(task.outcome)}</li>`
}

function meetingItem(m: DayLogMeeting): string {
  const about = [m.accountName, m.opportunitySerial].filter(Boolean).join(" · ")
  return `<li><div class="row"><span class="title">${t(m.title)}</span><span class="tag">${t(m.time)}</span></div><p class="about">${t(about)}</p>${note(m.outcome)}</li>`
}

function closeItem(c: DayLogClose): string {
  const about = [c.accountName, c.amount ? `৳ ${c.amount}` : null].filter(Boolean).join(" · ")
  return `<li><div class="row"><span class="title">${t(c.serial)} ${t(c.name)}</span><span class="tag ${c.status.toLowerCase()}">${CLOSE_LABEL[c.status]}</span></div><p class="about">${t(about)}</p>${note(c.reason)}</li>`
}

function group(heading: string, items: string[], total: number): string {
  if (items.length === 0) return ""
  return `<div class="group"><h3>${t(heading)} (${total})</h3><ul>${items.join("")}</ul></div>`
}

function daySection(piece: DayPiece): string {
  const day = piece.day
  const body = isEmpty(day)
    ? '<p class="empty">Nothing logged on this day.</p>'
    : group("Tasks done", day.tasks.map(taskItem), piece.totals.tasks) +
      group("Meetings", day.meetings.map(meetingItem), piece.totals.meetings) +
      group("Opportunities closed", day.closed.map(closeItem), piece.totals.closed)
  const heading = `${dayLabel(day.date)}${piece.continued ? " (continued)" : ""}`
  return `<section><h2>${t(heading)}</h2>${body}</section>`
}

/**
 * The most entries one picture holds (owner, 2026-11-10: "if a day's log is
 * bigger, move it to multiple images"). Eight keeps a picture short enough to
 * read on a phone without zooming.
 */
export const PER_PICTURE = 8

/** One day, or the part of a day, that one picture shows. */
export interface DayPiece {
  day: DayLogDay
  /** True when the same day began on an earlier picture. */
  continued: boolean
  /** The whole day's counts, so a group heading never shows only the part on this picture. */
  totals: { tasks: number; meetings: number; closed: number }
}

/**
 * Splits the log into pictures of at most `per` entries. A day with nothing on
 * it stays on the current picture and takes no place. A long day is cut between entries and carries on, under
 * its own heading, on the next picture. Never returns an empty list.
 */
export function paginate(days: DayLogDay[], per: number = PER_PICTURE): DayPiece[][] {
  const pictures: DayPiece[][] = [[]]
  let used = 0
  const next = () => {
    pictures.push([])
    used = 0
  }
  const current = () => pictures[pictures.length - 1]

  for (const day of days) {
    const totals = { tasks: day.tasks.length, meetings: day.meetings.length, closed: day.closed.length }
    // An empty day is one short line, so it takes no place: the split is by
    // entries only, and a picture is never made just for "Nothing logged".
    if (isEmpty(day)) {
      current().push({ day, continued: false, totals })
      continue
    }
    const entries = [
      ...day.tasks.map((x) => ({ kind: "tasks" as const, x })),
      ...day.meetings.map((x) => ({ kind: "meetings" as const, x })),
      ...day.closed.map((x) => ({ kind: "closed" as const, x })),
    ]
    let first = true
    while (entries.length > 0) {
      if (used >= per) next()
      const taken = entries.splice(0, per - used)
      current().push({
        day: {
          date: day.date,
          tasks: taken.flatMap((e) => (e.kind === "tasks" ? [e.x as DayLogTask] : [])),
          meetings: taken.flatMap((e) => (e.kind === "meetings" ? [e.x as DayLogMeeting] : [])),
          closed: taken.flatMap((e) => (e.kind === "closed" ? [e.x as DayLogClose] : [])),
        },
        continued: !first,
        totals,
      })
      used += taken.length
      first = false
    }
  }
  return pictures
}

const STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0 0 20px; width: 820px; background: #FFFFFF; color: #17191C;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.5; }
  .wrap { padding: 0 14px; }
  .summary { margin: 0 0 16px; padding: 12px 16px; border-radius: 8px; background: #F3F5F8; font-size: 17px; font-weight: 700; }
  section { margin-bottom: 14px; border: 1px solid #DDE2E9; border-radius: 10px; padding: 14px 18px; }
  h2 { margin: 0 0 8px; font-size: 20px; }
  h3 { margin: 12px 0 4px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; color: #4A5565; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { padding: 9px 0; border-top: 1px solid #EEF1F5; }
  li:first-child { border-top: 0; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .title { font-weight: 600; overflow-wrap: anywhere; }
  .tag { flex-shrink: 0; padding: 1px 8px; border-radius: 999px; background: #EEF1F5; font-size: 13px; font-weight: 600; }
  .tag.won { background: #DFF3E4; color: #1E6B34; }
  .tag.lost { background: #FBE3E1; color: #9B2C22; }
  .tag.cancelled { background: #EEF1F5; color: #4A5565; }
  .about { margin: 3px 0 0; color: #4A5565; font-size: 15px; overflow-wrap: anywhere; }
  .note { margin: 4px 0 0; font-size: 15px; white-space: pre-line; overflow-wrap: anywhere; }
  .empty { margin: 0; color: #4A5565; }
  ${BRAND_DOC_CSS}
  /* Bigger than the PDF header: this is read on a screen or a phone (owner, 2026-11-10). */
  .bd-logo { height: 44px; }
  .bd-title { font-size: 24px; }
  .bd-sub { font-size: 16px; }
  .bd-stamp { font-size: 14px; }
`

/**
 * One picture of the log. `picture` counts from 1. The summary on every
 * picture is for the whole period, so any one of them can be shown alone.
 */
export function renderDayLogHtml(log: DayLog, options: DayLogRenderOptions, picture = 1): string {
  const pictures = paginate(log.days)
  const pieces = pictures[picture - 1] ?? []
  const header = brandDocHeaderHtml({
    logo: options.logo,
    company: options.companyName,
    title: "Work log",
    lines: [
      log.personName,
      periodLabel(log.from, log.to),
      ...(pictures.length > 1 ? [`Picture ${picture} of ${pictures.length}`] : []),
    ],
    stamp: `Made on ${longDate(parseDateOnly(options.madeOn))}`,
  })
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Work log</title><style>${STYLES}</style></head>
<body>
  ${header}
  <div class="wrap">
    <p class="summary">${t(summaryLine(log.days))}</p>
    ${pieces.map(daySection).join("")}
  </div>
</body></html>`
}
