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
 * A report about one person drops the two columns naming them on every row —
 * they are already in the header, and repeating a name 40 times crowds out the
 * description, which is the column an approver actually reads.
 */
function columnsFor(perPerson: boolean): Column[] {
  const who: Column[] = perPerson
    ? []
    : [
        { heading: "Code", numeric: false, width: "9%", nowrap: true },
        { heading: "Employee", numeric: false, width: "14%" },
      ]
  return [
    { heading: "Date", numeric: false, width: "8%", nowrap: true },
    ...who,
    { heading: "Category", numeric: false, width: perPerson ? "14%" : "11%" },
    { heading: "Description", numeric: false, width: perPerson ? "30%" : "20%" },
    { heading: "Route", numeric: false, width: perPerson ? "18%" : "12%" },
    { heading: "Amount", width: "10%", nowrap: true },
    { heading: "Status", numeric: false, width: "9%" },
    { heading: "Receipts", width: "7%" },
  ]
}

/** "Gulshan 1 → Motijheel", or blank for anything that is not a journey. */
function route(row: ExpenseReportRow): string {
  if (!row.travelFrom && !row.travelTo) return ""
  return `${row.travelFrom ?? "?"} → ${row.travelTo ?? "?"}`
}

function rowFor(row: ExpenseReportRow, perPerson: boolean): Cell[] {
  const who: Cell[] = perPerson ? [] : [t(row.employee.employeeCode), t(row.employee.fullName)]
  return [
    t(row.expenseDate),
    ...who,
    t(row.category.name),
    t(row.description ?? ""),
    t(route(row)),
    t(`${row.amount} ${row.currency}`),
    t(STATUS_LABEL[row.status] ?? row.status),
    // A claim with no receipt is the thing an approver is looking for, so it
    // says so in words rather than printing a nought to scan past.
    t(row.receipts === 0 ? "None" : String(row.receipts)),
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
    font-size: 8pt; line-height: 1.35; color: #1F2937;
    background: #FFFFFF; -webkit-print-color-adjust: exact;
  }
  header {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 24px;
    border-bottom: 1.5pt solid #17191C; padding-bottom: 10px; margin-bottom: 14px;
  }
  .logo { height: 38px; width: auto; display: block; }
  .company { font-size: 13pt; font-weight: 700; letter-spacing: 0.01em; }
  .tagline { margin-top: 5px; font-size: 9pt; font-weight: 600; color: #334155; }
  .meta { text-align: right; }
  .metatitle { margin-bottom: 4px; font-size: 11.5pt; font-weight: 700; }
  .v { font-size: 8.5pt; font-weight: 600; }
  .v + .v { margin-top: 2px; }
  .vmuted { font-weight: 500; color: #55627A; }
  .band { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .fig {
    flex: 1 1 92px; border: 0.75pt solid #E4E9EF; border-radius: 3px;
    padding: 6px 8px; background: #F8FAFC;
  }
  .figv { display: block; font-size: 12pt; font-weight: 700; line-height: 1.1; }
  .figl {
    display: block; margin-top: 1px; font-size: 6.5pt; color: #55627A;
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
  .empty { color: #55627A; font-style: italic; padding: 16px 0; }
  .note { font-size: 6.8pt; color: #8A94A2; margin-top: 14px; }
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
  <p class="note">Generated by ${escapeHtml(companyName)} HR. Amounts are shown in the currency claimed and are never added across currencies.</p>
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
  return `<div style="width:100%;font-size:7pt;color:#55627A;padding:0 10mm;display:flex;align-items:center;justify-content:space-between;">
  <div style="display:flex;align-items:center;gap:10px;">
    ${seal ? `<img src="${seal}" style="height:52px;width:auto;">` : ""}
    <span>${escapeHtml(caption)}</span>
  </div>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`
}

/**
 * Landscape whenever the employee columns are present — nine columns including
 * a free-text description do not fit A4 portrait without shrinking the type
 * past readable.
 */
export async function renderExpenseReportPdf(report: ExpenseReport): Promise<Buffer> {
  const [logo, seal] = await Promise.all([brandAsset("logo"), brandAsset("seal")])
  const html = renderExpenseReportHtml(report, new Date(), env.COMPANY_NAME, {
    logo,
    timeZone: env.APP_TIMEZONE,
  })

  return renderPdf(html, {
    landscape: report.employee === null,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: reportFooterHtml(report, env.COMPANY_NAME, seal, env.COMPANY_ADDRESS),
    margin: { top: "12mm", bottom: "22mm", left: "10mm", right: "10mm" },
  })
}
