import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"

import { toXlsx } from "./export.xlsx"
import type { ExportSpec } from "./export.types"

const spec: ExportSpec = {
  title: "Suppliers / 2026",
  columns: [
    { header: "name", type: "text" },
    { header: "paymentDays", type: "integer" },
    { header: "rate", type: "decimal" },
    { header: "createdAt", type: "date" },
    { header: "isActive", type: "boolean" },
  ],
  rows: [
    ["Star Tech", 30, 7.5, new Date("2026-10-04T00:00:00.000Z"), true],
    ["=SUM(A1)", null, null, null, false],
  ],
}

async function open(s: ExportSpec) {
  const buffer = await toXlsx(s)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  return wb.worksheets[0]
}

describe("toXlsx", () => {
  it("names the sheet from the title, without characters Excel refuses", async () => {
    const ws = await open(spec)
    expect(ws.name).toBe("Suppliers   2026")
  })

  it("writes the headers, freezes the first row and adds a filter", async () => {
    const ws = await open(spec)
    expect(ws.getRow(1).values).toEqual([undefined, "name", "paymentDays", "rate", "createdAt", "isActive"])
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 })
    expect(ws.autoFilter).toBeTruthy()
  })

  it("keeps numbers as numbers and dates as dates", async () => {
    const ws = await open(spec)
    expect(ws.getCell(2, 2).value).toBe(30)
    expect(ws.getCell(2, 3).value).toBe(7.5)
    expect(ws.getCell(2, 4).value).toBeInstanceOf(Date)
    expect(ws.getCell(2, 5).value).toBe("Yes")
  })

  it("makes formula-looking text safe and leaves null cells empty", async () => {
    const ws = await open(spec)
    expect(ws.getCell(3, 1).value).toBe("'=SUM(A1)")
    expect(ws.getCell(3, 2).value).toBeNull()
  })

  it("writes only the header row for an empty list", async () => {
    const ws = await open({ ...spec, rows: [] })
    expect(ws.rowCount).toBe(1)
  })
})
