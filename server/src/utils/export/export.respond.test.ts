import type { Response } from "express"
import { beforeEach, describe, expect, it, vi } from "vitest"

const auditCreate = vi.fn()
vi.mock("../../config/prisma", () => ({
  default: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ auditLog: { create: auditCreate } })) },
}))
vi.mock("./export.pdf", () => ({ toPdf: vi.fn(async () => Buffer.from("%PDF-1.7")) }))

import { MAX_EXPORT_ROWS, MAX_PDF_ROWS, parseExportFormat, sendExport } from "./export.respond"
import type { ExportSpec } from "./export.types"

const actor = { sub: "u1", role: "FINANCE_OFFICER" } as never

function fakeRes() {
  const headers: Record<string, string> = {}
  const res = {
    setHeader: vi.fn((key: string, value: string) => {
      headers[key] = value
    }),
    send: vi.fn(),
  }
  return { res: res as unknown as Response, send: res.send, headers }
}

const spec = (rows = 2): ExportSpec => ({
  title: "Suppliers",
  columns: [{ header: "name", type: "text" }],
  rows: Array.from({ length: rows }, (_, i) => [`S${i}`]),
})

beforeEach(() => vi.clearAllMocks())

describe("parseExportFormat", () => {
  it("accepts the three formats", () => {
    expect(parseExportFormat("xlsx")).toBe("xlsx")
    expect(parseExportFormat("csv")).toBe("csv")
    expect(parseExportFormat("pdf")).toBe("pdf")
  })

  it("refuses anything else with a plain message", () => {
    expect(() => parseExportFormat("docx")).toThrow("Choose a file type: xlsx, csv or pdf.")
    expect(() => parseExportFormat(undefined)).toThrow("Choose a file type")
  })
})

describe("sendExport", () => {
  it("sends the file with the right headers", async () => {
    const { res, send, headers } = fakeRes()
    await sendExport({ res, spec: spec(), format: "csv", baseName: "suppliers", actor, list: "SUPPLIERS" })

    expect(headers["Content-Type"]).toBe("text/csv; charset=utf-8")
    expect(headers["Content-Disposition"]).toMatch(/^attachment; filename="suppliers-\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("uses the Excel and PDF content types", async () => {
    const a = fakeRes()
    await sendExport({ res: a.res, spec: spec(), format: "xlsx", baseName: "x", actor, list: "X" })
    expect(a.headers["Content-Type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    const b = fakeRes()
    await sendExport({ res: b.res, spec: spec(), format: "pdf", baseName: "x", actor, list: "X" })
    expect(b.headers["Content-Type"]).toBe("application/pdf")
  })

  it("writes one audit row with the format, row count and filter", async () => {
    const { res } = fakeRes()
    await sendExport({
      res, spec: spec(3), format: "xlsx", baseName: "suppliers", actor, list: "SUPPLIERS",
      filter: { year: 2026, q: undefined },
    })

    expect(auditCreate).toHaveBeenCalledTimes(1)
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      entity: "DATA_EXPORT",
      entityId: "SUPPLIERS",
      action: "EXPORT",
      changedBy: "u1",
      after: { format: "xlsx", rows: 3, filter: { year: 2026 } },
    })
  })

  it("sends no file when the audit write fails", async () => {
    auditCreate.mockRejectedValueOnce(new Error("db down"))
    const { res, send } = fakeRes()
    await expect(
      sendExport({ res, spec: spec(), format: "csv", baseName: "x", actor, list: "X" })
    ).rejects.toThrow("db down")
    expect(send).not.toHaveBeenCalled()
  })

  it("refuses a list that is too long, and a PDF that is too long", async () => {
    const { res } = fakeRes()
    await expect(
      sendExport({ res, spec: spec(MAX_EXPORT_ROWS + 1), format: "csv", baseName: "x", actor, list: "X" })
    ).rejects.toThrow("This list has too many rows to export at once. Add a filter and try again.")
    await expect(
      sendExport({ res, spec: spec(MAX_PDF_ROWS + 1), format: "pdf", baseName: "x", actor, list: "X" })
    ).rejects.toThrow("This list is too long for a PDF. Choose Excel or CSV instead, or add a filter.")
  })

  it("sends a valid file for an empty list", async () => {
    const { res, send } = fakeRes()
    await sendExport({ res, spec: spec(0), format: "xlsx", baseName: "x", actor, list: "X" })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
