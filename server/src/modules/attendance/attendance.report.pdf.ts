/**
 * The attendance report as a printable document.
 *
 * Split the way `payroll.pdf.ts` and `statements.pdf.ts` are:
 * `renderAttendanceReportHtml` is pure and takes the clock and the artwork as
 * arguments, so the document can be asserted without starting Chromium;
 * `renderAttendanceReportPdf` is the thin wrapper that loads the assets and
 * drives the browser.
 *
 * **Three documents, not one.** A single day and a range are different
 * questions and get different tables:
 *
 * - `single day` — one row per employee: what they did that day. Per-employee
 *   totals over one day ("working days 1, present 1") say less than "in 09:14,
 *   out 18:02", so a one-day range never prints the totals table.
 * - `range summary` — one row per employee, totalled. This is the weekly and
 *   monthly report, and it is the only one that carries Holidays and Early
 *   out, because those are counts that need more than a day to mean anything.
 * - `day by day` — one row per employee per day, over a range.
 *
 * A PDF is also not the CSV with a border. The CSV carries every column
 * because a spreadsheet is where you go to slice them; a printed page carries
 * the ones a person reads. Printing all of them gives 5pt type nobody can use.
 *
 * Nothing is recalculated here. Every figure comes off the report the JSON and
 * CSV responses were built from, so the three cannot disagree.
 */

import { env } from "../../config/env"
import { brandAsset, escapeHtml, renderPdf } from "../../utils/pdf"
import {
  clock,
  type AttendanceReport,
  type AttendanceReportDay,
  type AttendanceReportRow,
} from "./attendance.report"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** `25 August 2026` — the date on a printed page should not need parsing. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`
}

/**
 * When the document was produced, in office time.
 *
 * Office time, not UTC. Everybody reading this report is in one place, the
 * table's own check-in and check-out columns are already office-local, and a
 * header stamped in UTC next to a 09:14 check-in invites the reader to assume
 * the two are on the same clock when they are six hours apart.
 */
function generatedStamp(at: Date, timeZone: string): string {
  return at.toLocaleString("en-GB", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

/**
 * A one-day report says "Tuesday, 25 August 2026", not "25 August 2026 to 25
 * August 2026", which reads as a bug on the most-printed of the four reports.
 */
function rangeLabel(from: string, to: string): string {
  if (from === to) {
    const weekday = new Date(`${from}T00:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "long",
      timeZone: "UTC",
    })
    return `${weekday}, ${longDate(from)}`
  }
  return `${longDate(from)} to ${longDate(to)}`
}

const STATUS_LABEL: Record<string, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  ON_LEAVE: "On leave",
  HOLIDAY: "Holiday",
  WEEKLY_OFF: "Weekly off",
  NOT_CHECKED_IN: "No check-in",
  NOT_JOINED: "Not joined",
  LEFT: "Left",
  HALF_DAY: "Half day",
}

/**
 * Hours as `8h 42m`, the way the screen already shows them.
 *
 * This used to print `8.7`, which is the same number and tells a reader
 * nothing: nobody converts `0.3` to eighteen minutes in their head. Worse, the
 * client's `formatHours` has always produced `8h 42m`, so one report read two
 * different ways depending on whether you looked at it or printed it.
 *
 * **The CSV deliberately does not use this.** `reportToCsv` writes the bare
 * decimal, because a spreadsheet is where somebody sums a column and `8h 42m`
 * is text that cannot be summed, averaged or charted. The three outputs are
 * supposed to disagree here, and a test in `attendance.report.test.ts` holds
 * the CSV to a number.
 *
 * Minutes are derived from a single rounded total rather than from the
 * fractional part. Rounding the fraction on its own turns 7.999 into
 * "7h 60m" — currently unreachable because the service rounds to two
 * decimals first, but the correct form costs nothing and does not depend on
 * that staying true.
 *
 * `null` is "—" for no data. A real measured zero prints `0h 00m`: somebody
 * who worked nothing is a different fact from somebody with no record, and
 * collapsing the two is how an absence starts looking like a gap in the data.
 */
const hours = (value: number | null): string => {
  if (value === null) return "—"
  const totalMinutes = Math.round(value * 60)
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, "0")}m`
}

/**
 * The flags that would otherwise be five Yes/No columns nobody scans. On a
 * page, "Late, auto-closed" in one column gets read; five columns of "No" do
 * not.
 */
function dayNotes(day: AttendanceReportDay): string {
  const notes: string[] = []
  if (day.isLate) notes.push("Late")
  if (day.isEarlyOut) notes.push("Early out")
  if (day.autoCheckOut) notes.push("Auto-closed")
  if (day.regularised) notes.push("Regularised")
  if (day.approval === "PENDING") notes.push("Awaiting approval")
  if (day.detail) notes.push(day.detail)
  return notes.join(", ")
}

/**
 * A cell that carries the person: name on top, designation under it.
 *
 * Designation moved here so Department could have the column. Both still
 * print, and the row got shorter rather than longer — a designation like
 * "Network engineer and Technical Pre-sales" was wrapping a narrow column
 * onto four lines and dragging every other cell down with it.
 */
function personCell(name: string, designation: string): string {
  return `<div class="nm">${escapeHtml(name)}</div><div class="ds">${escapeHtml(designation)}</div>`
}

/**
 * `raw: false` marks a cell whose content is already HTML — the person cell is
 * the only one — so every other cell is still escaped on the way in.
 */
interface Cell {
  text: string
  html?: boolean
}

const t = (text: string): Cell => ({ text })

interface Column {
  heading: string
  /** Right-aligned unless false. A count is; a name is not. */
  numeric?: boolean
  /** A CSS width. Given explicitly so the browser stops guessing, which is
   *  what produced a code column three lines tall. */
  width?: string
  /** Never wraps. Codes and times are unreadable broken across lines. */
  nowrap?: boolean
}

function table(columns: Column[], body: Cell[][]): string {
  const cols = columns
    .map((c) => `<col${c.width ? ` style="width:${c.width}"` : ""}>`)
    .join("")
  const head = columns
    .map((c) => `<th${c.numeric === false ? ' class="l"' : ""}>${escapeHtml(c.heading)}</th>`)
    .join("")
  const rows = body
    .map((row) => {
      const cells = row
        .map((cell, i) => {
          const col = columns[i]
          const classes = [col?.numeric === false ? "l" : "", col?.nowrap ? "nw" : ""]
            .filter(Boolean)
            .join(" ")
          const content = cell.html ? cell.text : escapeHtml(cell.text)
          return `<td${classes ? ` class="${classes}"` : ""}>${content}</td>`
        })
        .join("")
      return `<tr>${cells}</tr>`
    })
    .join("")
  return `<table><colgroup>${cols}</colgroup><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
}

// ── The three tables ──────────────────────────

/**
 * Weekly, monthly and custom ranges. Holidays and Early out are here and
 * nowhere else: both are counts, and a count over one day is a checkbox.
 *
 * There is no No check-in column on any of these. It counts working days that
 * have not happened yet, which is a live-dashboard fact — on a document dated
 * and filed it just reads as a second kind of absence.
 */
// Widths rebalanced when hours became `253h 12m` instead of `253.2`. The
// values grew by about three characters and the headings lost "hrs", so the
// three hour columns take the width back from Employee and Department, which
// wrap gracefully where a time cannot.
const RANGE_COLUMNS: Column[] = [
  { heading: "Code", numeric: false, width: "9%", nowrap: true },
  { heading: "Employee", numeric: false, width: "16%" },
  { heading: "Department", numeric: false, width: "10%" },
  { heading: "Working days", width: "6%" },
  { heading: "Present", width: "6%" },
  { heading: "Absent", width: "5%" },
  { heading: "On leave", width: "6%" },
  { heading: "Holidays", width: "6%" },
  { heading: "Late", width: "5%" },
  { heading: "Early out", width: "6%" },
  { heading: "Worked", width: "8%", nowrap: true },
  { heading: "Expected", width: "8%", nowrap: true },
  { heading: "Shortfall", width: "9%", nowrap: true },
]

const rangeRow = (r: AttendanceReportRow): Cell[] => [
  t(r.employee.employeeCode),
  { text: personCell(r.employee.fullName, r.employee.designation), html: true },
  t(r.department),
  t(String(r.workingDays)),
  t(String(r.present)),
  t(String(r.absent)),
  t(String(r.onLeave)),
  t(String(r.holidays)),
  t(String(r.late)),
  t(String(r.earlyOut)),
  t(hours(r.workedHours)),
  t(hours(r.expectedHours)),
  t(hours(r.shortfallHours)),
]

/** One day, one row per person: a register, not a rollup. */
const SINGLE_DAY_COLUMNS: Column[] = [
  { heading: "Code", numeric: false, width: "12%", nowrap: true },
  { heading: "Employee", numeric: false, width: "24%" },
  { heading: "Department", numeric: false, width: "16%" },
  { heading: "Status", numeric: false, width: "11%" },
  { heading: "In", width: "8%", nowrap: true },
  { heading: "Out", width: "8%", nowrap: true },
  { heading: "Worked", width: "10%", nowrap: true },
  { heading: "Notes", numeric: false, width: "11%" },
]

const singleDayRow = (d: AttendanceReportDay): Cell[] => [
  t(d.employee.employeeCode),
  { text: personCell(d.employee.fullName, d.employee.designation), html: true },
  t(d.department),
  t(STATUS_LABEL[d.status] ?? d.status),
  t(clock(d.checkIn) || "—"),
  t(clock(d.checkOut) || "—"),
  t(hours(d.workedHours)),
  t(dayNotes(d)),
]

/** A range, one row per person per day. Date leads, because that is how it
 *  reads: a register per day rather than one history interleaved with another. */
const DAY_BY_DAY_COLUMNS: Column[] = [
  { heading: "Date", numeric: false, width: "8%", nowrap: true },
  { heading: "Code", numeric: false, width: "10%", nowrap: true },
  { heading: "Employee", numeric: false, width: "20%" },
  { heading: "Department", numeric: false, width: "13%" },
  { heading: "Status", numeric: false, width: "10%" },
  { heading: "In", width: "6%", nowrap: true },
  { heading: "Out", width: "6%", nowrap: true },
  { heading: "Worked", width: "8%", nowrap: true },
  { heading: "Expected", width: "8%", nowrap: true },
  { heading: "Notes", numeric: false, width: "11%" },
]

const dayByDayRow = (d: AttendanceReportDay): Cell[] => [
  t(d.date),
  t(d.employee.employeeCode),
  { text: personCell(d.employee.fullName, d.employee.designation), html: true },
  t(d.department),
  t(STATUS_LABEL[d.status] ?? d.status),
  t(clock(d.checkIn) || "—"),
  t(clock(d.checkOut) || "—"),
  t(hours(d.workedHours)),
  t(hours(d.expectedHours)),
  t(dayNotes(d)),
]

// ── Document ──────────────────────────────────

/** Which of the three documents this report is. */
export type ReportShape = "single-day" | "range-summary" | "day-by-day"

export function shapeOf(report: AttendanceReport): ReportShape {
  if (report.from === report.to) return "single-day"
  return report.granularity === "daily" ? "day-by-day" : "range-summary"
}

/**
 * What the header's "Type" line says.
 *
 * Derived from the range rather than passed in, because the client's preset
 * buttons are a UI convenience the server never sees — and a document that
 * printed "Monthly" because a button said so, over a range that is not a
 * month, would be lying. A span of one day is Daily, seven is Weekly, a whole
 * calendar month is Monthly, and everything else says what it actually is.
 */
export function reportTypeLabel(report: AttendanceReport): string {
  const start = new Date(`${report.from}T00:00:00Z`)
  const end = new Date(`${report.to}T00:00:00Z`)
  const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1

  const firstOfMonth = start.getUTCDate() === 1
  const lastOfMonth =
    end.getUTCDate() === new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()
  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()

  let period: string
  if (span === 1) period = "Daily"
  else if (span === 7) period = "Weekly"
  else if (sameMonth && firstOfMonth && lastOfMonth) period = "Monthly"
  else period = `Custom range (${span} days)`

  const shape = shapeOf(report)
  if (shape === "single-day") return period
  return `${period} — ${shape === "day-by-day" ? "day by day" : "per employee"}`
}

/**
 * The band under the title.
 *
 * A one-day report drops Working days: over one day it is 0 or 1 per person
 * and adds nothing a status column does not already say. Holidays is not here
 * on any of them — `totals` sums per employee, so it would print headcount ×
 * holidays, which is a number that means nothing. It stays a column.
 */
function totalsBand(report: AttendanceReport, shape: ReportShape): string {
  const totals = report.totals
  const figures: [string, string][] = [["Employees", String(report.headcount)]]
  if (shape !== "single-day") figures.push(["Working days", String(totals.workingDays)])
  figures.push(
    ["Present", String(totals.present)],
    ["Absent", String(totals.absent)],
    ["On leave", String(totals.onLeave)],
    ["Late", String(totals.late)],
    ["Early out", String(totals.earlyOut)],
    ["Worked", hours(totals.workedHours)],
    ["Shortfall", hours(totals.shortfallHours)]
  )
  return figures
    .map(
      ([label, value]) =>
        `<div class="fig"><span class="figv">${escapeHtml(value)}</span><span class="figl">${escapeHtml(label)}</span></div>`
    )
    .join("")
}

/**
 * An empty roster and an empty range are different facts, and a printed page
 * showing only an empty table lets the reader assume whichever one suits them.
 * Both are said in words.
 */
function emptyNote(report: AttendanceReport): string {
  if (report.headcount === 0) {
    return `<p class="empty">No employees were on the roster for this range, so there is nothing to report.</p>`
  }
  return `<p class="empty">No attendance was recorded for the ${report.headcount} employee(s) on this roster between ${escapeHtml(longDate(report.from))} and ${escapeHtml(longDate(report.to))}.</p>`
}

const STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 8pt;
    line-height: 1.35;
    color: #1F2937;
    /* Explicit, not inherited. Only the even rows carry a background, so
       without this the odd ones are transparent and take whatever the renderer
       paints behind the page. */
    background: #FFFFFF;
    -webkit-print-color-adjust: exact;
  }
  /* Branding left, what-this-document-is right. */
  header {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 24px;
    border-bottom: 1.5pt solid #17191C; padding-bottom: 10px; margin-bottom: 14px;
  }
  .logo { height: 38px; width: auto; display: block; }
  /* The fallback when the artwork is missing. The logo *is* the company name,
     so printing both would say it twice. */
  .company { font-size: 13pt; font-weight: 700; letter-spacing: 0.01em; }
  .tagline {
    margin-top: 5px; font-size: 9pt; font-weight: 600; color: #334155;
    letter-spacing: 0.01em;
  }
  /* Values only, no labels. "Monthly — per employee", a date range and a
     timestamp each say what they are; a Type/Date/Generated column beside them
     was three words of furniture per line. */
  .meta { text-align: right; }
  .metatitle { margin-bottom: 4px; font-size: 11.5pt; font-weight: 700; }
  .v { font-size: 8.5pt; font-weight: 600; }
  .v + .v { margin-top: 2px; }
  .vmuted { font-weight: 500; color: #55627A; }
  .band { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .fig {
    /* A real flex basis, not zero. At zero the eight tiles all squeezed onto
       one row of a portrait page and the last label ran off the edge; with a
       basis they wrap onto a second row instead. */
    flex: 1 1 92px; border: 0.75pt solid #E4E9EF;
    border-radius: 3px; padding: 6px 8px; background: #F8FAFC;
  }
  .figv { display: block; font-size: 12pt; font-weight: 700; line-height: 1.1; }
  .figl {
    display: block; margin-top: 1px; font-size: 6.5pt; color: #55627A;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  /* Fixed layout plus explicit widths: without both, the browser sizes columns
     from content and a long designation squeezes the code column until
     "BS-EMP-00001" stacks three lines tall. */
  th, td {
    padding: 6px 7px; text-align: right; vertical-align: top;
    border-bottom: 0.5pt solid #E9EDF2; word-break: break-word;
  }
  th.l, td.l { text-align: left; }
  td.nw, th.nw { white-space: nowrap; }
  thead th {
    /* The same near-black the app uses for a selected control (#17191C), so a
       printed report and the screen it came from read as one system. */
    background: #17191C; color: #FFFFFF; border-bottom: none;
    font-size: 6.5pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.04em; vertical-align: bottom;
    /* Headings wrap between words, never inside one. The cells inherit
       break-word so a long designation cannot overflow; a heading doing the
       same printed "SHORTFALL HRS" as "SHORTFAL L HRS". */
    word-break: normal; overflow-wrap: normal;
  }
  /* Repeats the header on every page. A twelve-page daily report is unreadable
     without it. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #FBFCFD; }
  .nm { font-weight: 600; color: #17191C; }
  .ds { font-size: 6.8pt; color: #6B7688; margin-top: 1px; }
  .empty { color: #55627A; font-style: italic; padding: 16px 0; }
  .note { font-size: 6.8pt; color: #8A94A2; margin-top: 14px; }
`

/**
 * Pure: takes the report, the clock and the artwork, returns a complete HTML
 * document. Everything worth asserting lives here — a PDF is the one output a
 * test cannot really check.
 */
export function renderAttendanceReportHtml(
  report: AttendanceReport,
  generatedAt: Date,
  companyName: string,
  options: { logo?: string | null; timeZone?: string } = {}
): string {
  // Passed in rather than read from `env` here, so this stays pure and the
  // stamp is assertable without a fixed deployment timezone.
  const { logo = null, timeZone = "Asia/Dhaka" } = options
  const shape = shapeOf(report)

  const rows: Cell[][] =
    shape === "range-summary"
      ? report.rows.map(rangeRow)
      : shape === "single-day"
        ? report.days.map(singleDayRow)
        : report.days.map(dayByDayRow)

  const columns =
    shape === "range-summary"
      ? RANGE_COLUMNS
      : shape === "single-day"
        ? SINGLE_DAY_COLUMNS
        : DAY_BY_DAY_COLUMNS

  const body = rows.length ? table(columns, rows) : emptyNote(report)

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Attendance report</title><style>${STYLES}</style></head>
<body>
  <header>
    <div>
      ${
        logo
          ? `<img class="logo" src="${logo}" alt="${escapeHtml(companyName)}">`
          : `<div class="company">${escapeHtml(companyName)}</div>`
      }
      <div class="tagline">HR and Payroll</div>
    </div>
    <div class="meta">
      <div class="metatitle">Attendance Report</div>
      <div class="v">${escapeHtml(reportTypeLabel(report))}</div>
      <div class="v">${escapeHtml(rangeLabel(report.from, report.to))}</div>
      <div class="v vmuted">${escapeHtml(generatedStamp(generatedAt, timeZone))}</div>
    </div>
  </header>
  <div class="band">${totalsBand(report, shape)}</div>
  ${body}
  <p class="note">Generated by ${escapeHtml(companyName)} HR. All times are ${escapeHtml(timeZone)} local.</p>
</body></html>`
}

/**
 * The running foot: seal, provenance line, page numbers.
 *
 * This is a Chrome header/footer template, not part of the document — which is
 * the whole point. The seal used to sit after the last table row, so on a
 * one-page report it floated wherever the content happened to stop. Here it is
 * pinned to the bottom margin of *every* page, whatever the range.
 *
 * Two things that template has to do differently from the document: it
 * inherits no styles at all, so every rule is inline, and it needs its own
 * `font-size` or Chrome renders it at zero. `pageNumber` and `totalPages` are
 * Chrome's own classes and are filled in per page.
 *
 * Exported so the markup can be asserted without rendering a PDF.
 */
export function reportFooterHtml(
  report: AttendanceReport,
  companyName: string,
  seal: string | null,
  companyAddress = ""
): string {
  // The address rides here rather than in the header. The header follows the
  // agreed layout — logo and tagline left, document facts right — and there is
  // no third place in it for a postal address; a company document should still
  // carry one.
  const who = companyAddress ? `${companyName}, ${companyAddress}` : companyName
  const caption = `${who} · attendance ${report.from} to ${report.to}`
  return `<div style="width:100%;font-size:7pt;color:#55627A;padding:0 10mm;display:flex;align-items:center;justify-content:space-between;">
  <div style="display:flex;align-items:center;gap:10px;">
    ${seal ? `<img src="${seal}" style="height:52px;width:auto;">` : ""}
    <span>${escapeHtml(caption)}</span>
  </div>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`
}

/**
 * Landscape for both range reports: thirteen and ten columns do not fit A4
 * portrait without shrinking the type past readable. A single day has eight
 * and stays portrait, which is also the shape people file.
 */
export async function renderAttendanceReportPdf(report: AttendanceReport): Promise<Buffer> {
  const [logo, seal] = await Promise.all([brandAsset("logo"), brandAsset("seal")])
  const html = renderAttendanceReportHtml(report, new Date(), env.COMPANY_NAME, {
    logo,
    timeZone: env.APP_TIMEZONE,
  })

  return renderPdf(html, {
    landscape: shapeOf(report) !== "single-day",
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: reportFooterHtml(report, env.COMPANY_NAME, seal, env.COMPANY_ADDRESS),
    // The bottom margin *is* the footer's height, so it has to clear the
    // 52px seal — about 14mm — or Chrome crops the running foot.
    margin: { top: "12mm", bottom: "22mm", left: "10mm", right: "10mm" },
  })
}
