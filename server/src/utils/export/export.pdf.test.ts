import { describe, expect, it } from "vitest"

import { exportFooterHtml, pdfColumns, renderExportHtml } from "./export.pdf"
import type { ExportSpec } from "./export.types"

const ctx = {
  generatedAt: new Date("2026-10-04T05:30:00.000Z"),
  timeZone: "Asia/Dhaka",
  company: "byteSpate",
  logo: "data:image/png;base64,AAAA",
}

const spec: ExportSpec = {
  title: "Suppliers",
  filterNote: "Active only",
  columns: [
    { header: "name", pdfHeader: "Supplier", type: "text", inPdf: true },
    { header: "paymentDays", pdfHeader: "Days to pay", type: "integer", inPdf: true },
    { header: "contactEmail", pdfHeader: "Email", type: "text" },
  ],
  rows: [["<b>Star</b> & Co", 30, "a@b.c"]],
}

describe("pdfColumns", () => {
  it("keeps only the main columns and says columns were left out", () => {
    const result = pdfColumns(spec)
    expect(result.columns.map((c) => c.header)).toEqual(["name", "paymentDays"])
    expect(result.omitted).toBe(true)
  })

  it("keeps every column when none is flagged", () => {
    const result = pdfColumns({ ...spec, columns: spec.columns.map((c) => ({ ...c, inPdf: undefined })) })
    expect(result.columns).toHaveLength(3)
    expect(result.omitted).toBe(false)
  })
})

describe("renderExportHtml", () => {
  const html = renderExportHtml(spec, ctx)

  it("shows the title, the filter note, the company and the date in office time", () => {
    expect(html).toContain("Suppliers")
    expect(html).toContain("Active only")
    expect(html).toContain("byteSpate")
    expect(html).toContain("4 October 2026")
  })

  it("uses the friendly headings and leaves out the other columns", () => {
    expect(html).toContain("Supplier")
    expect(html).toContain("Days to pay")
    expect(html).not.toContain("Email")
  })

  it("escapes cell text", () => {
    expect(html).not.toContain("<b>Star</b>")
    expect(html).toContain("&lt;b&gt;Star&lt;/b&gt; &amp; Co")
  })

  it("right-aligns numbers", () => {
    expect(html).toMatch(/<td class="num">30<\/td>/)
  })

  it("says so when there are no rows", () => {
    expect(renderExportHtml({ ...spec, rows: [] }, ctx)).toContain("There are no rows to show.")
  })
})

describe("exportFooterHtml", () => {
  it("points to the Excel file only when columns were left out", () => {
    expect(exportFooterHtml(true)).toContain("Open the Excel file to see every column.")
    expect(exportFooterHtml(false)).not.toContain("Open the Excel file")
  })
})
