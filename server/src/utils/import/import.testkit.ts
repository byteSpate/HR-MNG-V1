/**
 * The check every importer's test runs: its own example file must import
 * with zero problems, in both formats, and the example's headers must be the
 * column list in order. If a column rule changes and the example is not
 * updated, this fails, so the guide cannot drift from the real rules.
 *
 * Not named `.test.ts` so Vitest does not run it alone. `tsconfig.build.json`
 * excludes `*.testkit.ts` so it is not built.
 */

import ExcelJS from "exceljs"
import { expect } from "vitest"

import { buildTemplateCsv, buildTemplateXlsx, type SampleRow } from "./import.template"
import type { ColumnSpec, ImportPreview } from "./import.types"

export async function expectExampleImportsCleanly<T>(options: {
  columns: ColumnSpec[]
  sampleRows: SampleRow[]
  preview: (buffer: Buffer, fileName: string) => Promise<ImportPreview<T>>
}): Promise<void> {
  const { columns, sampleRows, preview } = options

  const xlsx = await buildTemplateXlsx(columns, sampleRows)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(xlsx as unknown as ArrayBuffer)
  expect(wb.worksheets[0].name).toBe("Data")
  expect((wb.worksheets[0].getRow(1).values as unknown[]).slice(1)).toEqual(columns.map((c) => c.header))

  const files: Array<[Buffer, string]> = [
    [buildTemplateCsv(columns, sampleRows), "example.csv"],
    [xlsx, "example.xlsx"],
  ]
  for (const [buffer, fileName] of files) {
    const result = await preview(buffer, fileName)
    expect(result.issues, fileName).toEqual([])
    expect(result.rows, fileName).toHaveLength(sampleRows.length)
  }
}
