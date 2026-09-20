/**
 * The Weekly Report as the PDF management reads (revision §26.17, §26.18).
 *
 * The rows copy the team's own sheets — Account, Project, Visited,
 * Requirement, Pending Task, Challenges, Gap, Application and Next step — and
 * the page is landscape, because nine columns are not a portrait page.
 *
 * The owner asked for something eye-catching rather than plain, so the colours
 * are the logo's: a red header band, green counts, black text on white.
 * Holiday and leave days take their own colour, so an empty day reads as
 * explained rather than idle.
 *
 * The same split as every renderer here: `renderWeeklyHtml` is pure and is
 * what the tests read, and `renderWeeklyPdf` only drives the browser.
 */

import { brandAsset, escapeHtml, renderPdf } from "../../../utils/pdf"
import type { DayLabel } from "./weekly.dates"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/**
 * The logo's green, so the page belongs to the company (§26.18). The owner
 * asked for the header in green rather than the logo's red (2026-09-16), so
 * red is not used anywhere here.
 */
const GREEN = "#12A150"
const DEEP_GREEN = "#0B7A3B"
const INK = "#17191C"
const MUTED = "#5F6B7C"
const LINE = "#E4E9EF"
const OFF_DAY = "#FDF8EE"
const OFF_INK = "#8A5E0C"

export interface WeeklyRowDeal {
  id: string
  serial: string
  name: string
  requirement: string
  softwareNeeded: boolean | null
  nextStep: string | null
}

export interface WeeklyRow {
  salesAccountId: string
  accountName: string
  deals: WeeklyRowDeal[]
  requirement: string
  visited: string[]
  pendingTasks: Array<{ id: string; title: string; dueOn: Date }>
  challenges: string | null
  gap: string | null
  nextStep: string | null
  taskId: string | null
}

export interface WeeklyDay {
  date: Date
  label: DayLabel | null
  accounts: WeeklyRow[]
  otherWork: Array<{ id: string; date: Date; text: string }>
}

export interface WeeklyDocument {
  fullName: string
  designation: string
  weekStart: Date
  weekEnd: Date
  status: string
  submittedLate: boolean
  submittedAt: Date | null
  /** Set when a submitted week was added to and submitted again (§26.4). */
  updatedAt: Date | null
  counts: {
    accounts: number
    communications: number
    meetings: number
    dealChanges: number
    tasksDone: number
  }
  days: WeeklyDay[]
  /** A data URI, or null when the logo file is missing. */
  logo: string | null
  companyName: string
  timeZone: string
}

const text = (value: string) => escapeHtml(value)
/** Typed text keeps its line breaks, and nothing else. */
const prose = (value: string) => escapeHtml(value).replace(/\r?\n/g, "<br>")

/** "13 Sep 2026", read in UTC because every date here is date-only. */
export function dayLabel(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** "Sunday 13 Sep", the band at the head of each day. */
function bandLabel(date: Date): string {
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/** "13–17 Sep 2026", and "27 Sep–1 Oct 2026" when the week crosses a month. */
export function weekLabel(weekStart: Date, weekEnd: Date): string {
  const sameMonth = weekStart.getUTCMonth() === weekEnd.getUTCMonth()
  const head = sameMonth
    ? `${weekStart.getUTCDate()}`
    : `${weekStart.getUTCDate()} ${MONTHS[weekStart.getUTCMonth()]}`
  return `${head}–${weekEnd.getUTCDate()} ${MONTHS[weekEnd.getUTCMonth()]} ${weekEnd.getUTCFullYear()}`
}

/** An instant in office time: "17 Sep 2026, 17:42" for the footer. */
function stamp(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return `${Number(part("day"))} ${MONTHS[Number(part("month")) - 1]} ${part("year")}, ${part("hour")}:${part("minute")}`
}

/** *Weekly Report – Rahim – 13–17 Sep 2026.pdf*, with nothing a file name cannot hold. */
export function weeklyFileName(
  fullName: string,
  weekStart: Date,
  weekEnd: Date,
  _timeZone: string
): string {
  const safe = fullName.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim()
  return `Weekly Report – ${safe} – ${weekLabel(weekStart, weekEnd)}.pdf`
}

function countsStrip(document: WeeklyDocument): string {
  const cells: Array<[number, string]> = [
    [document.counts.accounts, "Accounts worked on"],
    [document.counts.communications, "Calls and messages"],
    [document.counts.meetings, "Meetings"],
    [document.counts.dealChanges, "Deals changed"],
    [document.counts.tasksDone, "Tasks done"],
  ]
  return `<section class="counts">${cells
    .map(
      ([figure, caption]) =>
        `<div class="cell"><div class="count">${figure}</div><div class="caption">${text(caption)}</div></div>`
    )
    .join("")}</section>`
}

/** Yes, No, or nothing at all when nobody has answered yet (§26.9). */
function badge(softwareNeeded: boolean | null): string {
  if (softwareNeeded === null) return ""
  return softwareNeeded ? '<span class="badge yes">Yes</span>' : '<span class="badge no">No</span>'
}

function rowCells(row: WeeklyRow): string {
  const project = row.deals.map((deal) => `<strong>${text(deal.name)}</strong>`).join("<br>")
  const application = row.deals.map((deal) => badge(deal.softwareNeeded)).join(" ").trim()
  const nextStep =
    row.deals.length === 0
      ? row.nextStep
        ? prose(row.nextStep)
        : ""
      : row.deals
          .map((deal) => (deal.nextStep ? prose(deal.nextStep) : ""))
          .filter(Boolean)
          .join("<br>")

  return `<tr>
    <td class="account">${text(row.accountName)}</td>
    <td>${project}</td>
    <td>${row.visited.map((line) => prose(line)).join("<br>")}</td>
    <td>${text(row.requirement)}</td>
    <td>${row.pendingTasks.map((task) => text(task.title)).join("<br>")}</td>
    <td>${row.challenges ? prose(row.challenges) : ""}</td>
    <td>${row.gap ? prose(row.gap) : ""}</td>
    <td class="middle">${application}</td>
    <td>${nextStep}</td>
  </tr>`
}

function dayBlock(day: WeeklyDay): string {
  const off = day.label ? "off" : ""
  const label = day.label ? `<span class="label">${text(day.label.text)}</span>` : ""
  const head = `<div class="day ${off}"><span>${text(bandLabel(day.date))}</span>${label}</div>`

  const table =
    day.accounts.length === 0
      ? ""
      : `<table>
          <thead>
            <tr>
              <th>Account</th><th>Project</th><th>Visited</th><th>Requirement</th>
              <th>Pending Task</th><th>Challenges</th><th>Gap</th><th>Application</th><th>Next step</th>
            </tr>
          </thead>
          <tbody>${day.accounts.map(rowCells).join("")}</tbody>
        </table>`

  const other =
    day.otherWork.length === 0
      ? ""
      : `<div class="other"><span class="other-head">Other work</span><ul>${day.otherWork
          .map((work) => `<li>${prose(work.text)}</li>`)
          .join("")}</ul></div>`

  // Only for a working day with nothing on it: a labelled day already says why.
  const nothing =
    day.accounts.length === 0 && day.otherWork.length === 0 && !day.label
      ? '<p class="nothing">Nothing recorded on this day.</p>'
      : ""

  return `<section class="block">${head}${table}${other}${nothing}</section>`
}

/** The whole document, as one self-contained HTML string. */
export function renderWeeklyHtml(document: WeeklyDocument): string {
  const status = document.submittedLate
    ? "Submitted late"
    : document.status === "SUBMITTED"
      ? "Submitted"
      : "Draft"
  const submitted = document.submittedAt
    ? `Submitted ${stamp(document.submittedAt, document.timeZone)}`
    : "Not submitted"
  const updated = document.updatedAt
    ? `<span class="updated">Updated ${dayLabel(document.updatedAt)}</span>`
    : ""
  const logo = document.logo ? `<img class="logo" src="${document.logo}" alt="">` : ""

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${text(`Weekly Report – ${document.fullName}`)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10px; color: ${INK}; margin: 0; }
      header { display: flex; align-items: center; gap: 18px; background: ${GREEN}; color: #fff; padding: 16px 18px; }
      .logo { height: 36px; background: #fff; padding: 4px 8px; border-radius: 4px; }
      .who { flex: 1; }
      .title { font-size: 23px; font-weight: 800; letter-spacing: .01em; line-height: 1.1; }
      .who .name { font-size: 14px; font-weight: 700; margin-top: 2px; }
      .week { text-align: right; font-size: 14px; font-weight: 700; }
      .status { display: inline-block; margin-top: 5px; padding: 3px 10px; border-radius: 999px;
                background: #fff; color: ${DEEP_GREEN}; font-weight: 800; font-size: 11px; }
      .updated { display: block; margin-top: 4px; font-size: 10px; font-weight: 600; }
      .counts { display: flex; gap: 8px; padding: 10px 18px; background: #F7F9FB; border-bottom: 1px solid ${LINE}; }
      .cell { flex: 1; border-left: 3px solid ${GREEN}; padding: 5px 9px; background: #fff; }
      .count { font-size: 17px; font-weight: 800; color: ${DEEP_GREEN}; }
      .caption { font-size: 8.5px; color: ${MUTED}; text-transform: uppercase; letter-spacing: .04em; }
      main { padding: 10px 16px 16px; }
      .block { margin-bottom: 12px; break-inside: avoid; }
      .day { display: flex; justify-content: space-between; align-items: center;
             background: ${INK}; color: #fff; font-weight: 700; padding: 5px 10px; border-radius: 3px 3px 0 0; }
      .day.off { background: ${OFF_DAY}; color: ${OFF_INK}; border: 1px solid #F5E0BE; }
      .day .label { font-weight: 600; font-size: 9.5px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #F1F4F8; color: ${MUTED}; text-align: left; font-size: 8.5px;
           text-transform: uppercase; letter-spacing: .03em; padding: 5px 6px; border: 1px solid ${LINE}; }
      td { padding: 5px 6px; border: 1px solid ${LINE}; vertical-align: top; }
      tbody tr:nth-child(even) td { background: #FAFBFD; }
      td.account { font-weight: 700; }
      td.middle { text-align: center; }
      .badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 8.5px; font-weight: 700; }
      .badge.yes { background: #E7F7EE; color: ${GREEN}; }
      .badge.no { background: #F1F4F8; color: ${MUTED}; }
      .other { border: 1px solid ${LINE}; border-top: 0; padding: 5px 8px; }
      .other-head { font-weight: 700; color: ${MUTED}; text-transform: uppercase; font-size: 8.5px; }
      .other ul { margin: 3px 0 0; padding-left: 16px; }
      .nothing { margin: 0; padding: 6px 8px; color: ${MUTED}; border: 1px solid ${LINE}; border-top: 0; }
      footer { padding: 8px 16px; border-top: 1px solid ${LINE}; color: ${MUTED}; font-size: 8.5px;
               display: flex; justify-content: space-between; }
    </style>
  </head>
  <body>
    <header>
      ${logo}
      <div class="who">
        <div class="title">Weekly Report</div>
        <div class="name">${text(document.fullName)} · ${text(document.designation)}</div>
      </div>
      <div class="week">
        ${text(weekLabel(document.weekStart, document.weekEnd))}
        <span class="status">${text(status)}</span>
        ${updated}
      </div>
    </header>
    ${countsStrip(document)}
    <main>${document.days.map(dayBlock).join("")}</main>
    <footer><span>${text(document.companyName)}</span><span>${text(submitted)}</span></footer>
  </body>
</html>`
}

/** The PDF itself. Landscape, and the bands run to the paper's edge. */
export async function renderWeeklyPdf(document: Omit<WeeklyDocument, "logo">): Promise<Buffer> {
  const logo = await brandAsset("logo")
  return renderPdf(renderWeeklyHtml({ ...document, logo }), {
    landscape: true,
    margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
  })
}
