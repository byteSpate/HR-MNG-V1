/**
 * The guide and the example file, built from the same `ColumnSpec` list the
 * importer checks rows with. One list feeds the check, the guide on screen and
 * the example file, so they cannot disagree.
 */

import ExcelJS from "exceljs"

import { toCsv } from "../csv"
import type { ColumnSpec, ColumnType } from "./import.types"

/** One sample row. Keys are the column headers. */
export type SampleRow = Record<string, string>

const TYPE_LABEL: Record<ColumnType, string> = {
  text: "Text",
  integer: "Whole number",
  decimal: "Number with decimals",
  date: "Date (YYYY-MM-DD)",
  boolean: "Yes or No",
  email: "Email address",
  choice: "Choose one",
  time: "Time (HH:MM, 24 hours)",
  list: "List, separated by ;",
}

export interface GuideRow {
  header: string
  type: ColumnType
  typeLabel: string
  required: boolean
  description: string
  example: string
  allowed: string[]
}

function allowedFor(column: ColumnSpec): string[] {
  if (column.type === "boolean") return ["Yes", "No"]
  return column.allowed ?? []
}

export function buildImportGuide(columns: ColumnSpec[]): GuideRow[] {
  return columns.map((column) => {
    const type = column.type ?? "text"
    return {
      header: column.header,
      type,
      typeLabel: TYPE_LABEL[type],
      required: column.required,
      description: column.description ?? "",
      example: column.example ?? "",
      allowed: allowedFor(column),
    }
  })
}

function dataCell(column: ColumnSpec, value: string): ExcelJS.CellValue {
  if (value === "") return null
  if (column.type === "integer" || column.type === "decimal") {
    const number = Number(value)
    return Number.isNaN(number) ? value : number
  }
  return value
}

/**
 * Sheet "Data" is first on purpose: `parseSheet` reads only the first sheet, so
 * the example can be filled in and uploaded as it is. Sheet "Guide" explains
 * each column.
 */
export async function buildTemplateXlsx(columns: ColumnSpec[], sampleRows: SampleRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()

  const data = wb.addWorksheet("Data")
  data.addRow(columns.map((column) => column.header))
  for (const sample of sampleRows) {
    data.addRow(columns.map((column) => dataCell(column, sample[column.header] ?? "")))
  }

  columns.forEach((column, index) => {
    const sheetColumn = data.getColumn(index + 1)
    // Text format stops Excel from turning 09:00 into a time, or 2026-11-01 into
    // a date of its own, when somebody types into the sheet.
    if (column.type !== "integer" && column.type !== "decimal") sheetColumn.numFmt = "@"
    sheetColumn.width = Math.max(column.header.length + 4, 16)

    const head = data.getCell(1, index + 1)
    head.font = { bold: true }
    head.fill = {
      type: "pattern",
      pattern: "solid",
      // Required columns are yellow, optional ones grey. The Guide says so.
      fgColor: { argb: column.required ? "FFFFF2CC" : "FFE3E7EF" },
    }

    const list = allowedFor(column)
    if (list.length > 0) {
      for (let row = 2; row <= 201; row += 1) {
        data.getCell(row, index + 1).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`"${list.join(",")}"`],
        }
      }
    }
  })
  data.views = [{ state: "frozen", ySplit: 1 }]

  const guide = wb.addWorksheet("Guide")
  guide.addRow(["Column", "Type", "Required", "Example", "Allowed values", "What it means"])
  for (const row of buildImportGuide(columns)) {
    guide.addRow([
      row.header,
      row.typeLabel,
      row.required ? "Yes" : "No",
      row.example,
      row.allowed.join(", "),
      row.description,
    ])
  }
  guide.getRow(1).font = { bold: true }
  ;[22, 26, 10, 26, 34, 70].forEach((width, index) => {
    guide.getColumn(index + 1).width = width
  })
  guide.getColumn(6).alignment = { wrapText: true, vertical: "top" }

  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer)
}

export function buildTemplateCsv(columns: ColumnSpec[], sampleRows: SampleRow[]): Buffer {
  const rows = sampleRows.map((sample) => columns.map((column) => sample[column.header] ?? ""))
  return Buffer.from(`﻿${toCsv(columns.map((column) => column.header), rows)}`, "utf8")
}
