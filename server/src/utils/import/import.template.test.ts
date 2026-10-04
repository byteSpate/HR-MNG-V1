import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"

import { buildImportGuide, buildTemplateCsv, buildTemplateXlsx } from "./import.template"
import type { ColumnSpec } from "./import.types"

const columns: ColumnSpec[] = [
  { header: "name", required: true, type: "text", description: "The name.", example: "Finance" },
  { header: "costNature", required: false, type: "choice", allowed: ["DIRECT", "ADMINISTRATIVE"], description: "Cost type.", example: "DIRECT" },
  { header: "startTime", required: true, type: "time", description: "Start.", example: "09:00" },
  { header: "paymentDays", required: false, type: "integer", description: "Days.", example: "30" },
  { header: "isActive", required: false, type: "boolean", description: "Active?", example: "Yes" },
  { header: "notes", required: false },
]

const sample = [
  { name: "Finance", costNature: "DIRECT", startTime: "09:00", paymentDays: "30", isActive: "Yes", notes: "" },
  { name: "Ops, North", costNature: "", startTime: "08:30", paymentDays: "", isActive: "No", notes: "" },
]

async function open(buffer: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  return wb
}

describe("buildImportGuide", () => {
  const guide = buildImportGuide(columns)

  it("gives plain labels for each type, and text when no type is set", () => {
    expect(guide.map((g) => g.typeLabel)).toEqual([
      "Text", "Choose one", "Time (HH:MM, 24 hours)", "Whole number", "Yes or No", "Text",
    ])
  })

  it("lists the allowed values, and Yes or No for a yes/no column", () => {
    expect(guide[1].allowed).toEqual(["DIRECT", "ADMINISTRATIVE"])
    expect(guide[4].allowed).toEqual(["Yes", "No"])
    expect(guide[0].allowed).toEqual([])
  })

  it("carries required, description and example", () => {
    expect(guide[0]).toMatchObject({ header: "name", required: true, description: "The name.", example: "Finance" })
    expect(guide[5]).toMatchObject({ required: false, description: "", example: "" })
  })
})

describe("buildTemplateXlsx", () => {
  it("puts the Data sheet first with the exact headers and the sample rows", async () => {
    const wb = await open(await buildTemplateXlsx(columns, sample))
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Data", "Guide"])
    const data = wb.worksheets[0]
    expect((data.getRow(1).values as unknown[]).slice(1)).toEqual(columns.map((c) => c.header))
    expect(data.getCell(2, 1).value).toBe("Finance")
    expect(data.getCell(2, 4).value).toBe(30)
    expect(data.getCell(3, 4).value).toBeNull()
  })

  it("keeps time and text columns as text so Excel does not turn 09:00 into a time", async () => {
    const data = (await open(await buildTemplateXlsx(columns, sample))).worksheets[0]
    expect(data.getCell(2, 3).value).toBe("09:00")
    expect(data.getCell(2, 3).numFmt).toBe("@")
    expect(data.getCell(2, 4).numFmt).not.toBe("@")
  })

  it("adds a drop-down for choice and yes/no columns", async () => {
    const data = (await open(await buildTemplateXlsx(columns, sample))).worksheets[0]
    expect(data.getCell(2, 2).dataValidation).toMatchObject({ type: "list", formulae: ['"DIRECT,ADMINISTRATIVE"'] })
    expect(data.getCell(2, 5).dataValidation).toMatchObject({ type: "list", formulae: ['"Yes,No"'] })
  })

  it("writes the Guide sheet as a table of the same columns", async () => {
    const guide = (await open(await buildTemplateXlsx(columns, sample))).worksheets[1]
    expect((guide.getRow(1).values as unknown[]).slice(1)).toEqual([
      "Column", "Type", "Required", "Example", "Allowed values", "What it means",
    ])
    expect((guide.getRow(2).values as unknown[]).slice(1)).toEqual(["name", "Text", "Yes", "Finance", "", "The name."])
  })
})

describe("buildTemplateCsv", () => {
  const text = buildTemplateCsv(columns, sample).toString("utf8")

  it("starts with a byte order mark, then the headers", () => {
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text.slice(1).split("\r\n")[0]).toBe("name,costNature,startTime,paymentDays,isActive,notes")
  })

  it("quotes values that hold a comma", () => {
    expect(text.split("\r\n")[2]).toBe('"Ops, North",,08:30,,No,')
  })
})
