import type { Response } from "express"
import { beforeEach, describe, expect, it, vi } from "vitest"

const auditCreate = vi.fn()
vi.mock("../../config/prisma", () => ({
  default: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ auditLog: { create: auditCreate } })) },
}))

import { parseReportFormat, resolveReportRange, resolveMonthRange, sendReport } from "./export.report"
import type { ExportSpec } from "./export.types"

const actor = { sub: "u1", role: "HR_ADMIN" } as never

function fakeRes() {
  const headers: Record<string, string> = {}
  const res = {
    setHeader: vi.fn((key: string, value: string) => {
      headers[key] = value
    }),
    send: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  }
  res.status.mockReturnValue(res)
  return { res: res as unknown as Response, raw: res, headers }
}

const spec: ExportSpec = {
  title: "Leave",
  filterNote: "1 Jan 2026 to 31 Jan 2026",
  columns: [{ header: "name", pdfHeader: "Name", type: "text" }],
  rows: [["Rahim"]],
}

beforeEach(() => vi.clearAllMocks())

describe("parseReportFormat", () => {
  it("is json when no format is asked for", () => {
    expect(parseReportFormat(undefined)).toBe("json")
    expect(parseReportFormat("json")).toBe("json")
  })

  it("accepts the three file types and refuses others in plain words", () => {
    expect(parseReportFormat("pdf")).toBe("pdf")
    expect(parseReportFormat("xlsx")).toBe("xlsx")
    expect(parseReportFormat("csv")).toBe("csv")
    expect(() => parseReportFormat("docx")).toThrow("Choose a file type: xlsx, csv or pdf.")
  })
})

describe("sendReport", () => {
  it("sends the rows and the summary as JSON, with no audit row", async () => {
    const { res, raw } = fakeRes()
    await sendReport({
      res, spec, format: "json", baseName: "leave", actor, list: "LEAVE_REPORT",
      summary: [{ label: "Requests", value: "1" }],
    })
    expect(raw.json).toHaveBeenCalledWith({
      title: "Leave",
      filterNote: "1 Jan 2026 to 31 Jan 2026",
      columns: spec.columns,
      rows: [["Rahim"]],
      summary: [{ label: "Requests", value: "1" }],
    })
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it("sends a file through the export kit, which writes the audit row", async () => {
    const { res, raw, headers } = fakeRes()
    await sendReport({ res, spec, format: "csv", baseName: "leave", actor, list: "LEAVE_REPORT", summary: [] })
    expect(headers["Content-Type"]).toBe("text/csv; charset=utf-8")
    expect(raw.send).toHaveBeenCalledTimes(1)
    expect(auditCreate).toHaveBeenCalledTimes(1)
  })
})

describe("resolveReportRange", () => {
  it("returns the two dates", () => {
    const r = resolveReportRange("2026-01-01", "2026-01-31")
    expect(r.start.toISOString()).toBe("2026-01-01T00:00:00.000Z")
    expect(r.end.toISOString()).toBe("2026-01-31T00:00:00.000Z")
  })

  it("refuses a date that is not on the calendar", () => {
    expect(() => resolveReportRange("2026-02-30", "2026-03-01")).toThrow(
      "Pick a real date for From and To."
    )
  })

  it("refuses an end before the start, and says what to do", () => {
    expect(() => resolveReportRange("2026-02-01", "2026-01-01")).toThrow(
      "The To date is before the From date. Pick a later To date."
    )
  })

  it("refuses a range over two years", () => {
    expect(() => resolveReportRange("2024-01-01", "2026-12-31")).toThrow(
      "A report can cover at most 2 years. Pick a shorter range."
    )
  })
})

describe("resolveMonthRange", () => {
  it("reads YYYY-MM months", () => {
    expect(resolveMonthRange("2025-11", "2026-02")).toEqual({
      from: { year: 2025, month: 11 },
      to: { year: 2026, month: 2 },
    })
  })

  it("refuses a bad month, a backwards range, and more than 3 years", () => {
    expect(() => resolveMonthRange("2026-13", "2026-12")).toThrow("Pick a real month for From and To.")
    expect(() => resolveMonthRange("2026-05", "2026-04")).toThrow(
      "The To month is before the From month. Pick a later To month."
    )
    expect(() => resolveMonthRange("2022-01", "2026-01")).toThrow(
      "A payroll report can cover at most 36 months. Pick a shorter range."
    )
  })
})
