import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"

import { parseSheet } from "./import.parse"
import { runCommit, runPreview, type ImportSpec } from "./import.run"
import { MAX_IMPORT_ROWS } from "./import.types"

const spec: ImportSpec<string> = {
  columns: [{ header: "name", required: true }],
  validateRow: (row) => ({ ok: true, value: row.values.name }),
}

async function xlsxWith(rows: ExcelJS.CellValue[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Data")
  for (const row of rows) ws.addRow(row)
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer)
}

describe("parseSheet", () => {
  it("reads a CSV that starts with a byte order mark (our own example file does)", async () => {
    const rows = await parseSheet(Buffer.from("﻿name,costNature\r\nFinance,DIRECT\r\n", "utf8"), "x.csv")
    expect(rows).toEqual([{ rowNumber: 2, values: { name: "Finance", costnature: "DIRECT" } }])
  })

  it("reads an Excel time cell back as HH:MM, not as a date in 1899", async () => {
    const buffer = await xlsxWith([["name", "startTime"], ["Morning", new Date(Date.UTC(1899, 11, 30, 9, 5))]])
    const rows = await parseSheet(buffer, "x.xlsx")
    expect(rows[0].values.starttime).toBe("09:05")
  })

  it("still reads a real date cell as YYYY-MM-DD", async () => {
    const buffer = await xlsxWith([["name", "date"], ["Eid", new Date(Date.UTC(2026, 11, 16))]])
    const rows = await parseSheet(buffer, "x.xlsx")
    expect(rows[0].values.date).toBe("2026-12-16")
  })
})

describe("runPreview row limit", () => {
  const csv = (count: number) =>
    Buffer.from(["name", ...Array.from({ length: count }, (_, i) => `R${i}`)].join("\r\n"), "utf8")

  it("accepts a file with exactly the limit", async () => {
    const result = await runPreview(csv(MAX_IMPORT_ROWS), "ok.csv", spec)
    expect(result.rows).toHaveLength(MAX_IMPORT_ROWS)
  })

  it("refuses a file with one row more, in plain words", async () => {
    await expect(runPreview(csv(MAX_IMPORT_ROWS + 1), "big.csv", spec)).rejects.toMatchObject({
      statusCode: 400,
      message: "This file has too many rows. Split it into files of 2,000 rows or less.",
    })
  })
})

describe("runCommit", () => {
  const file = Buffer.from("name\r\nA\r\n", "utf8")

  it("turns a unique-key race into a plain 409", async () => {
    await expect(
      runCommit(file, "x.csv", spec, async () => {
        throw Object.assign(new Error("duplicate key"), { code: "P2002" })
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Someone added one of these records while you were importing. Run the preview again.",
    })
  })

  it("lets any other error through unchanged", async () => {
    await expect(
      runCommit(file, "x.csv", spec, async () => {
        throw new Error("boom")
      })
    ).rejects.toThrow("boom")
  })
})
