import assert from "node:assert/strict"
import test from "node:test"

import { formatReportCell, getReport, monthOptions, screenColumns, type ReportPayload } from "./reports"

const payload: ReportPayload = {
  title: "Leave report",
  filterNote: "All",
  columns: [
    { header: "code", pdfHeader: "Code", type: "text", inPdf: true },
    { header: "secret", type: "text" },
    { header: "from", pdfHeader: "From", type: "date", inPdf: true },
    { header: "days", pdfHeader: "Days", type: "decimal", decimals: 1, inPdf: true },
  ],
  rows: [["E-1", "x", "2026-02-01T00:00:00.000Z", 1.5]],
  summary: [],
}

test("the screen shows the main columns only, like the PDF", () => {
  assert.deepEqual(
    screenColumns(payload).map((c) => c.label),
    ["Code", "From", "Days"]
  )
  assert.deepEqual(screenColumns(payload).map((c) => c.index), [0, 2, 3])
})

test("with no main column flagged, the screen shows every column", () => {
  const all = { ...payload, columns: payload.columns.map((c) => ({ ...c, inPdf: undefined })) }
  assert.equal(screenColumns(all).length, 4)
  assert.equal(screenColumns(all)[1].label, "secret")
})

test("cells read the way people write them", () => {
  assert.equal(formatReportCell("2026-02-01T00:00:00.000Z", { type: "date" }), "2026-02-01")
  assert.equal(formatReportCell(48500, { type: "decimal" }), "48,500.00")
  assert.equal(formatReportCell(1.5, { type: "decimal", decimals: 1 }), "1.5")
  assert.equal(formatReportCell(null, { type: "text" }), "")
  assert.equal(formatReportCell(true, { type: "boolean" }), "Yes")
})

test("month options run newest first, as YYYY-MM", () => {
  const months = monthOptions(new Date(2026, 1, 15), 3)
  assert.deepEqual(months, [
    { value: "2026-02", label: "February 2026" },
    { value: "2026-01", label: "January 2026" },
    { value: "2025-12", label: "December 2025" },
  ])
})

test("getReport calls the report path with the filters and no empty ones", async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  let requested = ""
  globalThis.fetch = async (input) => {
    requested = String(input)
    return Response.json(payload)
  }
  await getReport("token", "/api/leave/report", { from: "2026-02-01", to: "2026-02-28", status: "" })
  assert.match(requested, /\/api\/leave\/report\?from=2026-02-01&to=2026-02-28$/)
})
