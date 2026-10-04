/**
 * The expense report as a printable document.
 *
 * Same split and the same page furniture as `attendance.report.pdf.ts`: a pure
 * `renderExpenseReportHtml` that can be asserted without starting Chromium, a
 * thin wrapper that loads the artwork and drives the browser, the logo and
 * tagline top left, the document's facts top right, and the seal in the
 * running foot on every page.
 *
 * The one structural difference is the totals band. Attendance counts days,
 * which add up. Money does not add up across currencies, so this prints **one
 * tile per currency** rather than a single figure — a BDT total quietly
 * containing a USD claim is a number nobody can spot and nobody can use.
 */

import { env } from "../../config/env"
import { brandAsset, escapeHtml, renderPdf } from "../../utils/pdf"
import { BRAND_HEADER_CSS, BRAND_STRIPE_HTML } from "../../utils/pdf.brand"
import type { ExpenseReport, ExpenseReportRow } from "./expense.report"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`
}

function rangeLabel(from: string, to: string): string {
  if (from === to) return longDate(from)
  return `${longDate(from)} to ${longDate(to)}`
}

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

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  REIMBURSED: "Reimbursed",
}

interface Column {
  heading: string
  numeric?: boolean
  width?: string
  nowrap?: boolean
}

interface Cell {
  text: string
  html?: boolean
}

const t = (text: string): Cell => ({ text })

function table(columns: Column[], body: Cell[][]): string {
  const cols = columns.map((c) => `<col${c.width ? ` style="width:${c.width}"` : ""}>`).join("")
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

/**
 * A report about one person drops the column naming them on every row — they
 * are already in the header, and repeating a name 40 times crowds out the
 * details, which is the column an approver actually reads.
 *
 * Every field of a claim is here, so an employee who downloads their own
 * claims gets the whole record: when it was spent and sent, what it was, the
 * route, the amount and its BDT value, who decided and when, the note, the
 * receipts and the payslip that paid it. Related facts share a cell (a date
 * with its second date underneath) so eleven facts fit ten columns.
 */
function columnsFor(perPerson: boolean): Column[] {
  const who: Column[] = perPerson ? [] : [{ heading: "Employee", numeric: false, width: "11%" }]
  return [
    { heading: "Date spent", numeric: false, width: perPerson ? "9%" : "8%", nowrap: true },
    ...who,
    // Expense first, category under it. A reader scanning a printed page is
    // looking for "the water jar", not for "Other" — the category groups rows,
    // it does not identify them.
    { heading: "Expense", numeric: false, width: perPerson ? "18%" : "14%" },
    { heading: "Details", numeric: false, width: perPerson ? "14%" : "11%" },
    { heading: "Route", numeric: false, width: perPerson ? "13%" : "11%" },
    { heading: "Amount", numeric: false, width: "13%" },
    { heading: "Status", numeric: false, width: "9%" },
    { heading: "Note from reviewer", numeric: false, width: perPerson ? "11%" : "10%" },
    { heading: "Receipts", width: "5%" },
    { heading: "Payslip", numeric: false, width: "8%", nowrap: true },
  ]
}

/** "Gulshan 1 → Motijheel", or blank for anything that is not a journey. */
function route(row: ExpenseReportRow): string {
  if (!row.travelFrom && !row.travelTo) return ""
  return `${row.travelFrom ?? "?"} → ${row.travelTo ?? "?"}`
}

/** A main line with a smaller line under it. Both are escaped here. */
function stacked(top: string, under: string | null): Cell {
  return {
    text: `<div class="nm">${escapeHtml(top)}</div>${under ? `<div class="ds">${escapeHtml(under)}</div>` : ""}`,
    html: true,
  }
}

function amountCell(row: ExpenseReportRow): Cell {
  const main = `${row.amount} ${row.currency}`
  if (row.amountBdt && row.fxRateToBdt) {
    return stacked(main, `${row.amountBdt} BDT at ${row.fxRateToBdt}`)
  }
  // A foreign claim gets its rate when it is approved. Say so, so a blank is
  // not read as a missing number.
  if (row.currency !== "BDT") return stacked(main, "BDT value is set when approved")
  return stacked(main, null)
}

function rowFor(row: ExpenseReportRow, perPerson: boolean): Cell[] {
  const who: Cell[] = perPerson ? [] : [stacked(row.employee.fullName, row.employee.employeeCode)]
  return [
    stacked(row.expenseDate, `Sent ${row.submittedOn}`),
    ...who,
    // A claim filed before the name field existed falls back to its category,
    // so the cell is never blank — an unnamed row is still a row somebody has
    // to identify.
    stacked(row.name ?? row.category.name, row.category.name),
    t(row.description ?? ""),
    t(route(row)),
    amountCell(row),
    stacked(STATUS_LABEL[row.status] ?? row.status, row.reviewedOn ? `on ${row.reviewedOn}` : null),
    t(row.reviewNote ?? ""),
    // A claim with no receipt is the thing an approver is looking for, so it
    // says so in words rather than printing a nought to scan past.
    t(row.receipts === 0 ? "None" : String(row.receipts)),
    t(row.paidOn ?? ""),
  ]
}

function totalsBand(report: ExpenseReport): string {
  const figures: [string, string][] = [["Claims", String(report.totals.claims)]]
  for (const c of report.totals.byCurrency) {
    figures.push([`Total ${c.currency}`, c.amount])
  }
  for (const s of report.totals.byStatus) {
    figures.push([STATUS_LABEL[s.status] ?? s.status, String(s.claims)])
  }
  return figures
    .map(
      ([label, value]) =>
        `<div class="fig"><span class="figv">${escapeHtml(value)}</span><span class="figl">${escapeHtml(label)}</span></div>`
    )
    .join("")
}

function emptyNote(report: ExpenseReport): string {
  const who = report.employee ? `${report.employee.fullName} has` : "Nobody has"
  const status = report.status ? ` with the status ${STATUS_LABEL[report.status]}` : ""
  return `<p class="empty">${escapeHtml(who)} no expense claims dated between ${escapeHtml(longDate(report.from))} and ${escapeHtml(longDate(report.to))}${escapeHtml(status)}.</p>`
}

const STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 7.5pt; line-height: 1.35; color: #17191C;
    background: #FFFFFF; -webkit-print-color-adjust: exact;
  }
  ${BRAND_HEADER_CSS}
  .band { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .fig {
    flex: 1 1 92px; border: 0.75pt solid #E4E9EF; border-radius: 3px;
    padding: 6px 8px; background: #F8FAFC;
  }
  .figv { display: block; font-size: 10.5pt; font-weight: 700; line-height: 1.1; }
  .figl {
    display: block; margin-top: 1px; font-size: 6.5pt; color: #17191C;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td {
    padding: 6px 7px; text-align: right; vertical-align: top;
    border-bottom: 0.5pt solid #E9EDF2; word-break: break-word;
  }
  th.l, td.l { text-align: left; }
  td.nw, th.nw { white-space: nowrap; }
  thead th {
    background: #17191C; color: #FFFFFF; border-bottom: none;
    font-size: 6.5pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.04em; vertical-align: bottom;
    word-break: normal; overflow-wrap: normal;
  }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #FBFCFD; }
  .nm { font-weight: 600; color: #17191C; }
  .ds { font-size: 6.5pt; color: #17191C; margin-top: 1px; }
  .empty { color: #17191C; font-style: italic; padding: 16px 0; }
  .note { font-size: 6.8pt; color: #17191C; margin-top: 14px; }
`

export function renderExpenseReportHtml(
  report: ExpenseReport,
  generatedAt: Date,
  companyName: string,
  options: { logo?: string | null; timeZone?: string } = {}
): string {
  const { logo = null, timeZone = "Asia/Dhaka" } = options
  const perPerson = report.employee !== null
  const columns = columnsFor(perPerson)
  const body = report.rows.length
    ? table(columns, report.rows.map((r) => rowFor(r, perPerson)))
    : emptyNote(report)

  const subject = perPerson
    ? `${report.employee!.fullName} (${report.employee!.employeeCode})`
    : "All employees"

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Expense report</title><style>${STYLES}</style></head>
<body>
  ${BRAND_STRIPE_HTML}
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
      <div class="metatitle">Employee Expense Report</div>
      <div class="v">${escapeHtml(subject)}</div>
      <div class="v">${escapeHtml(rangeLabel(report.from, report.to))}</div>
      ${report.status ? `<div class="v">${escapeHtml(STATUS_LABEL[report.status] ?? report.status)} only</div>` : ""}
      <div class="v vmuted">${escapeHtml(generatedStamp(generatedAt, timeZone))}</div>
    </div>
  </header>
  <div class="band">${totalsBand(report)}</div>
  ${body}
  <p class="note">Generated by ${escapeHtml(companyName)} HR. Amounts are shown in the currency claimed and are never added across currencies. A BDT value uses the rate saved when the claim was approved.</p>
</body></html>`
}

/** The running foot: seal, provenance, page numbers. Same shape as attendance. */
export function reportFooterHtml(
  report: ExpenseReport,
  companyName: string,
  seal: string | null,
  companyAddress = ""
): string {
  const who = companyAddress ? `${companyName}, ${companyAddress}` : companyName
  const caption = `${who} · expenses ${report.from} to ${report.to}`
  return `<div style="width:100%;font-size:7pt;color:#17191C;padding:0 10mm;display:flex;align-items:center;justify-content:space-between;">
  <div style="display:flex;align-items:center;gap:10px;">
    ${seal ? `<img src="${seal}" style="height:52px;width:auto;">` : ""}
    <span>${escapeHtml(caption)}</span>
  </div>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`
}

/**
 * Always landscape. Ten columns, two of them free text, do not fit A4 portrait
 * without shrinking the type past readable.
 */
export async function renderExpenseReportPdf(report: ExpenseReport): Promise<Buffer> {
  const [logo, seal] = await Promise.all([brandAsset("logo"), brandAsset("seal")])
  const html = renderExpenseReportHtml(report, new Date(), env.COMPANY_NAME, {
    logo,
    timeZone: env.APP_TIMEZONE,
  })

  return renderPdf(html, {
    landscape: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: reportFooterHtml(report, env.COMPANY_NAME, seal, env.COMPANY_ADDRESS),
    margin: { top: "12mm", bottom: "22mm", left: "10mm", right: "10mm" },
  })
}
