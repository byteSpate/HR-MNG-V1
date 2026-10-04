import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { renderStatementsHtml, type StatementSet } from "./statements.pdf"

// Note what this file does NOT do: launch a browser. Puppeteer is imported
// lazily inside browser(), so nothing here starts Chromium — a leaked browser
// handle hangs vitest exactly as a leaked cron handle does. The template
// rendering is the part worth asserting anyway; the PDF bytes are puppeteer's
// output, not ours.

const TEMPLATE = `<h1>{{COMPANY_NAME}}</h1><div>{{PERIOD}}</div>{{CONTENT}}`
const period = { from: "2025-07-01", to: "2026-06-30", label: "Jul 2025 – Jun 2026" }
const GENERATED = new Date(Date.UTC(2026, 7, 13))

function set(over: Partial<StatementSet> = {}): StatementSet {
  return {
    pnl: {
      period,
      comparative: period,
      lines: [
        { key: "REVENUE", label: "Revenue", code: "4100", current: "1000000.00", comparative: "0.00", kind: "LINE", breakdown: [] },
        { key: "GROSS_PROFIT", label: "Gross Profit/(Loss)", code: null, current: "1000000.00", comparative: "0.00", kind: "SUBTOTAL", breakdown: [] },
      ],
      netProfit: { current: "1000000.00", comparative: "0.00" },
    },
    position: {
      period,
      comparative: period,
      assets: [
        {
          heading: "Non-Current Assets",
          lines: [{ key: "ppe", label: "Property, Plant & Equipment", code: "1110", current: "126350.00", comparative: "0.00", kind: "LINE", breakdown: [] }],
          subtotal: { current: "126350.00", comparative: "0.00" },
        },
      ],
      totalAssets: { current: "126350.00", comparative: "0.00" },
      equityAndLiabilities: [
        {
          heading: "Shareholders' Equity",
          lines: [{ key: "cap", label: "Share Capital", code: "3100", current: "126350.00", comparative: "0.00", kind: "LINE", breakdown: [] }],
          subtotal: { current: "126350.00", comparative: "0.00" },
        },
      ],
      totalEquityAndLiabilities: { current: "126350.00", comparative: "0.00" },
      balances: true,
    },
    equity: {
      period,
      columns: [{ accountId: "cap", code: "3100", name: "Share Capital" }],
      rows: [{ label: "Balance at 1 Jul 2025", kind: "OPENING", values: { cap: "0.00" }, total: "0.00" }],
    },
    cash: {
      period,
      comparativePeriod: period,
      operating: [{ key: "NET_PROFIT", label: "Net Profit/(Loss) After Tax", current: "-256935.00", comparative: "0.00" }],
      investing: [],
      financing: [],
      summary: [{ key: "CLOSING_CASH", label: "Cash at the end of the year", current: "693715.00", comparative: "0.00", isSubtotal: true }],
    },
    notes: {
      period,
      comparativePeriod: period,
      notes: [
        { ref: "2.08", title: "Statement of Cash Flows", body: "Prepared under the <indirect> method.\n\nCash comprises cash in hand.", rows: [], total: null, totalComparative: null },
        {
          ref: "17.00",
          title: "Administrative & Selling Expenses",
          body: null,
          rows: [{ accountId: "rent", code: "5206", name: "Office Rent", current: "70500.00", comparative: "0.00" }],
          total: "70500.00",
          totalComparative: "0.00",
        },
      ],
    },
    annexure: {
      period,
      rows: [
        {
          accountId: "comp", particulars: "Computer / Laptop", rate: "20.00",
          costOpening: "0.00", costAddition: "95500.00", costClosing: "95500.00",
          depOpening: "0.00", depCharged: "23600.00", depClosing: "23600.00",
          writtenDownValue: "71900.00",
        },
      ],
      total: {
        costOpening: "0.00", costAddition: "95500.00", costClosing: "95500.00",
        depOpening: "0.00", depCharged: "23600.00", depClosing: "23600.00",
        writtenDownValue: "71900.00",
      },
    },
    ...over,
  }
}

const render = (over: Partial<StatementSet> = {}) =>
  renderStatementsHtml(TEMPLATE, set(over), GENERATED, "BYTESPATE LIMITED")

describe("renderStatementsHtml", () => {
  it("opens with the brand header: stripe, logo, and a navy panel titled Financial statements with the period", () => {
    const html = renderStatementsHtml(
      "<style>{{BRAND_CSS}}</style>{{BRAND_HEADER}}{{CONTENT}}",
      set(),
      GENERATED,
      "BYTESPATE LIMITED",
      "data:image/png;base64,LOGO"
    )
    expect(html).toContain('<div class="bd-stripe"></div>')
    expect(html).toContain('src="data:image/png;base64,LOGO"')
    expect(html).toContain('<h1 class="bd-title">Financial statements</h1>')
    expect(html).toContain('<p class="bd-sub">BYTESPATE LIMITED</p>')
    expect(html).toContain(`<p class="bd-sub">${set().pnl.period.label}</p>`)
    expect(html).not.toMatch(/\{\{\w+\}\}/)
  })

  it("the real statements template is black and white: black heading rows, black text", () => {
    const file = readFileSync(path.join(__dirname, "../../templates/statements.html"), "utf8")
    expect(file).toMatch(/th \{[^}]*background: #17191C/)
    expect(file).toMatch(/th \{[^}]*color: #FFFFFF/)
    expect(file).toMatch(/\.statements-footer \{[^}]*color: #17191C/)
    for (const grey of ["#52525b", "#a1a1aa"]) expect(file).not.toContain(grey)
  })

  it("the real statements template has a place for the brand header and its style", () => {
    const file = readFileSync(path.join(__dirname, "../../templates/statements.html"), "utf8")
    expect(file).toContain("{{BRAND_CSS}}")
    expect(file).toContain("{{BRAND_HEADER}}")
  })

  it("carries the company name and the period into the template", () => {
    const html = render()
    expect(html).toContain("BYTESPATE LIMITED")
    expect(html).toContain("Jul 2025 – Jun 2026")
  })

  it("renders all six statements, not a subset", () => {
    const html = render()
    for (const heading of [
      "Statement of Profit or Loss",
      "Statement of Financial Position",
      "Statement of Changes in Equity",
      "Statement of Cash Flows",
      "Notes to the Financial Statements",
      "Annexure-A",
    ]) {
      expect(html).toContain(heading)
    }
  })

  it("prints a note's narrative paragraphs, split on blank lines", () => {
    const html = render()
    expect(html).toContain("<p>Prepared under the &lt;indirect&gt; method.</p>")
    expect(html).toContain("<p>Cash comprises cash in hand.</p>")
  })

  it("escapes a note body rather than letting markup reach the rendering browser", () => {
    // 2b Decision 14. This is the one part of the document a human types, and
    // it lands inside a puppeteer-rendered page.
    const html = render()
    expect(html).not.toContain("<indirect>")
  })

  it("prints a note's breakdown rows and its total", () => {
    const html = render()
    expect(html).toContain("5206 Office Rent")
    expect(html).toContain("70500.00")
  })

  it("gives a prose-only note no table at all", () => {
    const html = renderStatementsHtml(
      TEMPLATE,
      set({
        notes: {
          period, comparativePeriod: period,
          notes: [{ ref: "1.00", title: "Corporate Information", body: "Incorporated in Bangladesh.", rows: [], total: null, totalComparative: null }],
        },
      }),
      GENERATED,
      "BYTESPATE LIMITED"
    )
    // Bounded at the next section, or this reads on into Annexure-A's table.
    const notesSection = html.slice(
      html.indexOf("Notes to the Financial Statements"),
      html.indexOf("Annexure-A")
    )
    expect(notesSection).toContain("Incorporated in Bangladesh.")
    expect(notesSection).not.toContain("<table")
  })

  it("prints all nine Annexure-A columns", () => {
    const html = render()
    for (const heading of ["Particulars", "Rate", "Addition", "Charged", "WDV"]) {
      expect(html).toContain(heading)
    }
    expect(html).toContain("20.00%")
    expect(html).toContain("71900.00")
  })

  it("stamps the generation date, not the reporting period", () => {
    // 2b Decision 17. This document will look very like the one the auditor
    // signed, and the two must not be confusable. A footer reading
    // "Generated Jul 2025 – Jun 2026" carries no information at all.
    const html = render()
    expect(html).toContain("Generated 13 August 2026")
  })

  it("puts the generation stamp in a running footer, so it lands on every page", () => {
    expect(render()).toContain("statements-footer")
  })

  it("renders an equity column per account plus a total", () => {
    const html = render()
    expect(html).toContain("Share Capital")
    expect(html).toContain("Balance at 1 Jul 2025")
  })

  it("escapes an account name, which Finance can edit freely", () => {
    const html = renderStatementsHtml(
      TEMPLATE,
      set({
        annexure: {
          period,
          rows: [{ accountId: "x", particulars: "Plant <b>", rate: null, costOpening: "0.00", costAddition: "0.00", costClosing: "0.00", depOpening: "0.00", depCharged: "0.00", depClosing: "0.00", writtenDownValue: "0.00" }],
          total: { costOpening: "0.00", costAddition: "0.00", costClosing: "0.00", depOpening: "0.00", depCharged: "0.00", depClosing: "0.00", writtenDownValue: "0.00" },
        },
      }),
      GENERATED,
      "BYTESPATE LIMITED"
    )
    expect(html).toContain("Plant &lt;b&gt;")
  })

  it("shows an em dash for an asset class with no disclosed rate", () => {
    const html = renderStatementsHtml(
      TEMPLATE,
      set({
        annexure: {
          period,
          rows: [{ accountId: "x", particulars: "Land", rate: null, costOpening: "0.00", costAddition: "0.00", costClosing: "0.00", depOpening: "0.00", depCharged: "0.00", depClosing: "0.00", writtenDownValue: "0.00" }],
          total: { costOpening: "0.00", costAddition: "0.00", costClosing: "0.00", depOpening: "0.00", depCharged: "0.00", depClosing: "0.00", writtenDownValue: "0.00" },
        },
      }),
      GENERATED,
      "BYTESPATE LIMITED"
    )
    expect(html).toContain("—")
  })
})
