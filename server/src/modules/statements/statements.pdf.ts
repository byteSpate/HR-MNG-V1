/**
 * The complete statement set as a PDF.
 *
 * Split the way `payroll.pdf.ts` is: `renderStatementsHtml` is pure and takes
 * everything it needs as arguments — including the clock — so the document
 * can be asserted without starting Chromium. `renderStatementsPdf` is the
 * thin wrapper that computes the statements and drives the browser.
 *
 * Nothing is cached and nothing is stored (2b Decision 15). A statement set
 * is generated a handful of times a year and its figures change the moment a
 * journal posts, so a cache is either wrong or needs invalidating on every
 * posting.
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Browser } from "puppeteer"

import { env } from "../../config/env"
import { AppError } from "../../middleware/errorHandler"
import { brandAsset } from "../../utils/pdf"
import { BRAND_DOC_CSS, brandDocHeaderHtml } from "../../utils/pdf.brand"
import { loadChart } from "./statements.balances"
import { buildPnl } from "./statements.pnl"
import { buildPosition } from "./statements.position"
import { buildEquity } from "./statements.equity"
import { cashFlowStatement } from "./statements.cashflow"
import { statementNotes } from "./statements.notes"
import { annexureA, assertAnnexureTiesToPosition, positionPpe } from "./statements.annexure"
import type { DateRange } from "./statements.period"
import type {
  AnnexureResult,
  CashFlowResult,
  EquityResult,
  NotesResult,
  PnlResult,
  PositionResult,
} from "./statements.types"

export interface StatementSet {
  pnl: PnlResult
  position: PositionResult
  equity: EquityResult
  cash: CashFlowResult
  notes: NotesResult
  annexure: AnnexureResult
}

let browserPromise: Promise<Browser> | null = null

// Lazily, never at import — see payroll.pdf.ts. A browser launched at import
// hangs vitest exactly as a leaked cron handle does, and a browser per
// request exhausts memory.
async function browser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = import("puppeteer").then((p) =>
      p.default.launch({
        // The chrome-for-testing buildpack exports only PATH, and
        // PUPPETEER_SKIP_DOWNLOAD=true leaves no bundled Chromium to fall
        // back to, so without this every render throws on Heroku.
        executablePath: process.env.CHROME_PATH,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      })
    )
  }
  return browserPromise
}

export async function closeStatementsBrowser(): Promise<void> {
  if (!browserPromise) return
  const b = await browserPromise.catch(() => null)
  browserPromise = null
  await b?.close().catch(() => undefined)
}

// Closed on exit, so a shutdown does not leave an orphaned Chromium. The same
// three signals payroll.pdf.ts registers, for the same reason.
for (const signal of ["SIGINT", "SIGTERM", "beforeExit"] as const) {
  process.once(signal, () => {
    void closeStatementsBrowser()
  })
}

/**
 * Account names are editable from the chart of accounts and note bodies are
 * typed by hand, so both are user data landing in a template. An unescaped
 * `<script>` in a note body executes in the rendering browser.
 */
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const longDate = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`

interface Column {
  heading: string
  /** Right-aligned unless false. Money is; a name is not. */
  numeric?: boolean
}

function table(columns: Column[], body: string[][], klass = ""): string {
  const head = columns
    .map((c) => `<th${c.numeric === false ? ' class="l"' : ""}>${escape(c.heading)}</th>`)
    .join("")
  const rows = body
    .map(
      (r) =>
        `<tr>${r
          .map((cell, i) => `<td${columns[i]?.numeric === false ? ' class="l"' : ""}>${escape(cell)}</td>`)
          .join("")}</tr>`
    )
    .join("")
  return `<table${klass ? ` class="${klass}"` : ""}><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
}

const MONEY: Column[] = [
  { heading: "Particulars", numeric: false },
  { heading: "Current" },
  { heading: "Comparative" },
]

const section = (title: string, body: string) =>
  `<section><h2>${escape(title)}</h2>${body}</section>`

function flatSection(
  title: string,
  lines: Array<{ label: string; current: string; comparative?: string }>
): string {
  return section(title, table(MONEY, lines.map((l) => [l.label, l.current, l.comparative ?? ""])))
}

function positionSection(position: PositionResult): string {
  const blocks = [...position.assets, ...position.equityAndLiabilities]
    .map(
      (s) =>
        `<h3>${escape(s.heading)}</h3>` +
        table(MONEY, [
          ...s.lines.map((l) => [l.label, l.current, l.comparative]),
          [`Total ${s.heading}`, s.subtotal.current, s.subtotal.comparative],
        ])
    )
    .join("")

  return section(
    "Statement of Financial Position",
    blocks +
      table(MONEY, [
        ["Total Assets", position.totalAssets.current, position.totalAssets.comparative],
        [
          "Total Equity and Liabilities",
          position.totalEquityAndLiabilities.current,
          position.totalEquityAndLiabilities.comparative,
        ],
      ])
  )
}

function equitySection(equity: EquityResult): string {
  const columns: Column[] = [
    { heading: "Particulars", numeric: false },
    ...equity.columns.map((c) => ({ heading: c.name })),
    { heading: "Total" },
  ]
  const body = equity.rows.map((r) => [
    r.label,
    ...equity.columns.map((c) => r.values[c.accountId] ?? "—"),
    r.total,
  ])
  return section("Statement of Changes in Equity", table(columns, body))
}

/**
 * The notes in full: narrative paragraphs and breakdown table, both optional.
 *
 * 2b Decision 2 — a note may be prose only, table only, or both, and the
 * renderer never branches on which kind it holds beyond skipping what is
 * absent. Blank lines separate paragraphs and nothing else is markup
 * (Decision 14).
 */
function notesSection(notes: NotesResult): string {
  const body = notes.notes
    .map((n) => {
      const prose = n.body
        ? n.body
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter((p) => p !== "")
            .map((p) => `<p>${escape(p)}</p>`)
            .join("")
        : ""
      const rows = n.rows.length
        ? table(MONEY, [
            ...n.rows.map((r) => [`${r.code} ${r.name}`, r.current, r.comparative]),
            ["Total", n.total ?? "", n.totalComparative ?? ""],
          ])
        : ""
      return `<article class="note"><h3>${escape(n.ref)}&nbsp;&nbsp;${escape(n.title)}</h3>${prose}${rows}</article>`
    })
    .join("")
  return section("Notes to the Financial Statements", body)
}

/** All nine columns of the filed schedule, not the two the placeholder had. */
function annexureSection(annexure: AnnexureResult): string {
  const columns: Column[] = [
    { heading: "Particulars", numeric: false },
    { heading: "Rate" },
    { heading: "Cost — Opening" },
    { heading: "Addition" },
    { heading: "Cost — Closing" },
    { heading: "Dep. — Opening" },
    { heading: "Charged" },
    { heading: "Dep. — Closing" },
    { heading: "WDV" },
  ]
  const t = annexure.total
  const body = [
    ...annexure.rows.map((r) => [
      r.particulars,
      r.rate ? `${r.rate}%` : "—",
      r.costOpening, r.costAddition, r.costClosing,
      r.depOpening, r.depCharged, r.depClosing,
      r.writtenDownValue,
    ]),
    ["Total", "", t.costOpening, t.costAddition, t.costClosing, t.depOpening, t.depCharged, t.depClosing, t.writtenDownValue],
  ]
  return section("Annexure-A — Schedule of Property, Plant & Equipment", table(columns, body, "annexure"))
}

export function renderStatementsHtml(
  template: string,
  set: StatementSet,
  generatedAt: Date,
  companyName: string,
  logo: string | null = null
): string {
  const generated = longDate(generatedAt)
  const content = [
    flatSection("Statement of Profit or Loss", set.pnl.lines),
    positionSection(set.position),
    equitySection(set.equity),
    flatSection("Statement of Cash Flows", [
      ...set.cash.operating,
      ...set.cash.investing,
      ...set.cash.financing,
      ...set.cash.summary,
    ]),
    notesSection(set.notes),
    annexureSection(set.annexure),
  ].join("")

  // 2b Decision 17. Deliberately not a loud UNAUDITED watermark — these are
  // also perfectly good management accounts, and a watermark makes them
  // awkward to circulate internally. The date and the period are enough to
  // tell this copy and the auditor's apart, but only if the date is real:
  // the placeholder printed the reporting period in this field.
  const footer =
    `<div class="statements-footer">Generated ${escape(generated)} · ${escape(set.pnl.period.label)}</div>`

  const header = brandDocHeaderHtml({
    logo,
    company: companyName,
    title: "Financial statements",
    lines: [companyName, set.pnl.period.label],
  })

  return template
    .replace("{{BRAND_CSS}}", () => BRAND_DOC_CSS)
    .replace("{{BRAND_HEADER}}", () => header)
    .replace(/{{COMPANY_NAME}}/g, escape(companyName))
    .replace(/{{PERIOD}}/g, escape(set.pnl.period.label))
    .replace(/{{GENERATED}}/g, escape(generated))
    .replace("{{CONTENT}}", content + footer)
}

/**
 * Two candidates, matching `payroll.pdf.ts`. The build is `tsc` alone and
 * copies nothing, so on Heroku the second one is what resolves — but only
 * while the process is started from the app root. The first covers a layout
 * where the templates sit beside `dist`, and neither assumes a cwd.
 */
async function loadTemplate(): Promise<string> {
  const candidates = [
    path.join(__dirname, "../../templates/statements.html"),
    path.join(process.cwd(), "src/templates/statements.html"),
  ]
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8")
    } catch {
      continue
    }
  }
  throw new AppError(500, "Statements template not found")
}

export async function renderStatementsPdf(range: DateRange): Promise<Buffer> {
  const [chart, pnl, position, equity, cash, notes, annexure] = await Promise.all([
    loadChart(),
    buildPnl(range),
    buildPosition(range),
    buildEquity(range),
    cashFlowStatement(range),
    statementNotes(range),
    annexureA(range),
  ])

  // The same tie-back the JSON endpoint runs. This is the filed document; it
  // is the last place that should be willing to print a schedule which does
  // not agree with the balance sheet three pages earlier.
  assertAnnexureTiesToPosition(annexure, positionPpe(chart, position))

  const template = await loadTemplate()
  const html = renderStatementsHtml(
    template,
    { pnl, position, equity, cash, notes, annexure },
    new Date(),
    env.COMPANY_NAME,
    await brandAsset("logo")
  )

  const page = await (await browser()).newPage()
  try {
    await page.setContent(html, { waitUntil: "load" })
    return Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-size:7px;width:100%;text-align:center;color:#17191C;padding:0 15mm">${escape(env.COMPANY_NAME)}</div>`,
        footerTemplate: `<div style="font-size:7px;width:100%;padding:0 15mm;color:#17191C;display:flex;justify-content:space-between"><span>Generated ${escape(longDate(new Date()))} · ${escape(pnl.period.label)}</span><span class="pageNumber"></span></div>`,
        margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      })
    )
  } finally {
    await page.close()
  }
}
