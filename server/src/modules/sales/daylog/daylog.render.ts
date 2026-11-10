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
  /** What came of it, as written when it was marked done. */
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
  }${note(task.outcome)}</li>`
}

function meetingItem(m: DayLogMeeting): string {
  const about = [m.accountName, m.opportunitySerial].filter(Boolean).join(" · ")
  return `<li><div class="row"><span class="title">${t(m.title)}</span><span class="tag">${t(m.time)}</span></div><p class="about">${t(about)}</p>${note(m.outcome)}</li>`
}

function closeItem(c: DayLogClose): string {
  const about = [c.accountName, c.amount ? `৳ ${c.amount}` : null].filter(Boolean).join(" · ")
  return `<li><div class="row"><span class="title">${t(c.serial)} ${t(c.name)}</span><span class="tag ${c.status.toLowerCase()}">${CLOSE_LABEL[c.status]}</span></div><p class="about">${t(about)}</p>${note(c.reason)}</li>`
}

function group(heading: string, items: string[]): string {
  if (items.length === 0) return ""
  return `<div class="group"><h3>${t(heading)} (${items.length})</h3><ul>${items.join("")}</ul></div>`
}

function daySection(day: DayLogDay): string {
  const body = isEmpty(day)
    ? '<p class="empty">Nothing logged on this day.</p>'
    : group("Tasks done", day.tasks.map(taskItem)) +
      group("Meetings", day.meetings.map(meetingItem)) +
      group("Opportunities closed", day.closed.map(closeItem))
  return `<section><h2>${t(dayLabel(day.date))}</h2>${body}</section>`
}

const STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0 0 20px; width: 820px; background: #FFFFFF; color: #17191C;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.45; }
  .wrap { padding: 0 14px; }
  .summary { margin: 0 0 16px; padding: 10px 14px; border-radius: 8px; background: #F3F5F8; font-weight: 600; }
  section { margin-bottom: 14px; border: 1px solid #DDE2E9; border-radius: 10px; padding: 12px 16px; }
  h2 { margin: 0 0 8px; font-size: 15px; }
  h3 { margin: 10px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #4A5565; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { padding: 7px 0; border-top: 1px solid #EEF1F5; }
  li:first-child { border-top: 0; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .title { font-weight: 600; overflow-wrap: anywhere; }
  .tag { flex-shrink: 0; padding: 1px 8px; border-radius: 999px; background: #EEF1F5; font-size: 11px; font-weight: 600; }
  .tag.won { background: #DFF3E4; color: #1E6B34; }
  .tag.lost { background: #FBE3E1; color: #9B2C22; }
  .tag.cancelled { background: #EEF1F5; color: #4A5565; }
  .about { margin: 2px 0 0; color: #4A5565; font-size: 12px; overflow-wrap: anywhere; }
  .note { margin: 3px 0 0; font-size: 12px; white-space: pre-line; overflow-wrap: anywhere; }
  .empty { margin: 0; color: #4A5565; }
  ${BRAND_DOC_CSS}
`

export function renderDayLogHtml(log: DayLog, options: DayLogRenderOptions): string {
  const header = brandDocHeaderHtml({
    logo: options.logo,
    company: options.companyName,
    title: "Work log",
    lines: [log.personName, periodLabel(log.from, log.to)],
    stamp: `Made on ${longDate(parseDateOnly(options.madeOn))}`,
  })
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Work log</title><style>${STYLES}</style></head>
<body>
  ${header}
  <div class="wrap">
    <p class="summary">${t(summaryLine(log.days))}</p>
    ${log.days.map(daySection).join("")}
  </div>
</body></html>`
}
