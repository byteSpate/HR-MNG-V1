import type { NextFunction, Request, Response } from "express"
import { describe, expect, it, vi } from "vitest"

import { commitHandler, guideHandler, previewHandler, templateHandler } from "./import.http"
import type { ColumnSpec } from "./import.types"

const columns: ColumnSpec[] = [{ header: "name", required: true, type: "text", example: "Finance" }]

function fakeRes() {
  const headers: Record<string, string> = {}
  const res = {
    setHeader: vi.fn((k: string, v: string) => {
      headers[k] = v
    }),
    send: vi.fn(),
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  }
  return { res: res as unknown as Response, raw: res, headers }
}

const req = (extra: Record<string, unknown> = {}) => ({ query: {}, user: { sub: "u1" }, ...extra }) as unknown as Request

describe("guideHandler", () => {
  it("answers with the guide rows and the row limit", () => {
    const { res, raw } = fakeRes()
    guideHandler(columns)(req(), res, vi.fn())
    expect(raw.json).toHaveBeenCalledWith({
      columns: [expect.objectContaining({ header: "name", typeLabel: "Text", required: true })],
      maxRows: 2000,
    })
  })
})

describe("templateHandler", () => {
  const handler = templateHandler({ columns, sampleRows: () => [{ name: "Finance" }], baseName: "departments" })

  it("sends the Excel example by default", async () => {
    const { res, raw, headers } = fakeRes()
    await handler(req(), res, vi.fn())
    expect(headers["Content-Type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    expect(headers["Content-Disposition"]).toBe('attachment; filename="departments-example.xlsx"')
    expect(raw.send).toHaveBeenCalled()
  })

  it("sends the CSV example when asked", async () => {
    const { res, headers } = fakeRes()
    await handler(req({ query: { format: "csv" } }), res, vi.fn())
    expect(headers["Content-Type"]).toBe("text/csv; charset=utf-8")
    expect(headers["Content-Disposition"]).toBe('attachment; filename="departments-example.csv"')
  })

  it("passes today's office date to the sample rows", async () => {
    const sampleRows = vi.fn(() => [{ name: "x" }])
    const { res } = fakeRes()
    await templateHandler({ columns, sampleRows, baseName: "x" })(req(), res, vi.fn())
    expect(sampleRows).toHaveBeenCalledWith(expect.any(Date))
  })

  it("refuses any other type with a plain message", async () => {
    const { res } = fakeRes()
    const next = vi.fn() as unknown as NextFunction
    await handler(req({ query: { format: "pdf" } }), res, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: "Choose a file type: xlsx or csv." }))
  })
})

describe("previewHandler and commitHandler", () => {
  const file = { buffer: Buffer.from("x"), originalname: "a.csv" }

  it("ask for a file when none was sent", async () => {
    const next = vi.fn() as unknown as NextFunction
    await previewHandler(vi.fn())(req(), fakeRes().res, next)
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, message: "Choose an Excel (.xlsx) or CSV file to import." })
    )
  })

  it("preview runs the importer and answers 200 with its result", async () => {
    const run = vi.fn().mockResolvedValue({ rows: [] })
    const { res, raw } = fakeRes()
    await previewHandler(run)(req({ file }), res, vi.fn())
    expect(run).toHaveBeenCalledWith(file.buffer, "a.csv")
    expect(raw.json).toHaveBeenCalledWith({ rows: [] })
  })

  it("commit runs the importer as the signed-in user and answers 201", async () => {
    const run = vi.fn().mockResolvedValue({ created: 2 })
    const { res, raw } = fakeRes()
    await commitHandler(run)(req({ file }), res, vi.fn())
    expect(run).toHaveBeenCalledWith(file.buffer, "a.csv", { sub: "u1" })
    expect(raw.status).toHaveBeenCalledWith(201)
    expect(raw.json).toHaveBeenCalledWith({ created: 2 })
  })
})
