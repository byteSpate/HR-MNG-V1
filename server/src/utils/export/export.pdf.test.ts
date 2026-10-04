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

  it("right-aligns numbers, and the heading above them", () => {
    expect(html).toMatch(/<td class="num">30<\/td>/)
    expect(html).toMatch(/<th class="num">Days to pay<\/th>/)
    expect(html).toMatch(/<th>Supplier<\/th>/)
  })

  it("says so when there are no rows", () => {
    expect(renderExportHtml({ ...spec, rows: [] }, ctx)).toContain("There are no rows to show.")
  })

  it("prints rows at 8pt, headings at 7.5pt and the title at 14pt", () => {
    expect(html).toMatch(/body \{[^}]*font-size: 8pt/)
    expect(html).toMatch(/th \{[^}]*font-size: 7\.5pt/)
    expect(html).toMatch(/h1 \{[^}]*font-size: 14pt/)
  })

  describe("the same look as the emails", () => {
    it("starts with the red, blue and green stripe", () => {
      expect(html).toMatch(/class="stripe"/)
      expect(html).toContain("#E23B2E")
      expect(html).toContain("#3B63B8")
      expect(html).toContain("#3FAE5A")
    })

    it("puts the logo on a white strip, with the row count in a pill", () => {
      expect(html).toMatch(/<div class="brandbar">[\s\S]*<img class="logo" src="data:image\/png;base64,AAAA"/)
      expect(html).toMatch(/<span class="pill">1 row<\/span>/)
      expect(renderExportHtml({ ...spec, rows: [["a", 1, "b"], ["c", 2, "d"]] }, ctx)).toMatch(
        /<span class="pill">2 rows<\/span>/
      )
    })

    it("shows the title in a navy panel with the mint bar, and the notes under it", () => {
      expect(html).toMatch(/<div class="panel">[\s\S]*<h1>Suppliers<\/h1>[\s\S]*<div class="mint"><\/div>/)
      expect(html).toContain("#1B3A82")
      expect(html).toContain("#142C66")
      expect(html).toContain("#7AE3C8")
      expect(html).toMatch(/<p class="panel-sub">Active only<\/p>/)
    })

    it("prints the company name when there is no logo", () => {
      const plain = renderExportHtml(spec, { ...ctx, logo: null })
      expect(plain).toMatch(/<span class="wordmark">byteSpate<\/span>/)
      expect(plain).not.toContain("<img")
    })
  })
})

describe("exportFooterHtml", () => {
  it("points to the Excel file only when columns were left out", () => {
    expect(exportFooterHtml(true)).toContain("Open the Excel file to see every column.")
    expect(exportFooterHtml(false)).not.toContain("Open the Excel file")
  })
})
