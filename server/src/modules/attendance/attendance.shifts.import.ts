/**
 * Shifts by file. Create only, checked with the same Zod schema as the Add
 * shift form. A new shift has no employees yet, so it cannot change any past
 * attendance day (only a change to weeklyOffDays on an existing shift can).
 *
 * `effectiveFrom` and `effectiveTo` are not columns: the Add shift form does
 * not take them either.
 */

import prisma from "../../config/prisma"
import { writeAudit } from "../../utils/audit"
import { cellText, parseWholeNumber, zodIssues } from "../../utils/import/import.cells"
import { runCommit, runPreview, type ImportSpec } from "../../utils/import/import.run"
import type { SampleRow } from "../../utils/import/import.template"
import type { ColumnSpec, ImportPreview, ParsedRow, RowIssue } from "../../utils/import/import.types"
import type { AccessTokenPayload } from "../auth/auth.types"
import { shiftSchema, type ShiftBody } from "./attendance.validators"

export const SHIFT_IMPORT_COLUMNS: ColumnSpec[] = [
  {
    header: "name",
    required: true,
    uniqueInFile: true,
    type: "text",
    maxLength: 100,
    description: "The shift name. It must not already be in the system.",
    example: "Morning",
  },
  { header: "startTime", required: true, type: "time", description: "When the shift starts, in 24-hour time, like 09:00.", example: "09:00" },
  { header: "endTime", required: true, type: "time", description: "When the shift ends, in 24-hour time, like 18:00.", example: "18:00" },
  {
    header: "breakMinutes",
    required: false,
    type: "integer",
    description: "Unpaid break time in minutes. A whole number from 0 to 480. Leave blank for 60.",
    example: "60",
  },
  {
    header: "graceMinutes",
    required: false,
    type: "integer",
    description:
      "Minutes after the start time before a person counts as late. A whole number from 0 to 240. Leave blank for 15.",
    example: "15",
  },
  {
    header: "weeklyOffDays",
    required: false,
    type: "list",
    description:
      "The weekly days off, as numbers. 0 is Sunday and 6 is Saturday. Separate them with ; like 5;6. Write none for no weekly off. Leave blank for 5 (Friday).",
    example: "5",
  },
]

export function shiftImportSampleRows(_today: Date): SampleRow[] {
  return [
    { name: "Morning", startTime: "08:00", endTime: "17:00", breakMinutes: "60", graceMinutes: "15", weeklyOffDays: "5" },
    { name: "Evening", startTime: "14:00", endTime: "23:00", breakMinutes: "45", graceMinutes: "10", weeklyOffDays: "5;6" },
  ]
}

export type ShiftImportRow = ShiftBody & { rowNumber: number }

const OFF_DAYS_MESSAGE =
  "Use numbers from 0 (Sunday) to 6 (Saturday), separated by ;. Write none for no weekly off."

/** Blank gives `undefined` so the form's default (Friday) applies. */
function parseOffDays(raw: string): { ok: true; value: number[] | undefined } | { ok: false } {
  if (raw === "") return { ok: true, value: undefined }
  if (raw.toLowerCase() === "none") return { ok: true, value: [] }
  const parts = raw.split(/[;,]/).map((part) => part.trim()).filter((part) => part !== "")
  const days = parts.map(parseWholeNumber)
  if (parts.length === 0 || days.some((day) => day === null || day < 0 || day > 6)) return { ok: false }
  return { ok: true, value: days as number[] }
}

function validateRow(row: ParsedRow): { ok: true; value: ShiftImportRow } | { ok: false; issues: RowIssue[] } {
  const issues: RowIssue[] = []

  const wholeNumber = (header: string): number | undefined => {
    const raw = cellText(row.values, header)
    if (raw === "") return undefined
    const value = parseWholeNumber(raw)
    if (value === null) {
      issues.push({ rowNumber: row.rowNumber, column: header, message: "Use a whole number like 60." })
      return undefined
    }
    return value
  }

  const breakMinutes = wholeNumber("breakMinutes")
  const graceMinutes = wholeNumber("graceMinutes")

  const offDays = parseOffDays(cellText(row.values, "weeklyOffDays"))
  if (!offDays.ok) issues.push({ rowNumber: row.rowNumber, column: "weeklyOffDays", message: OFF_DAYS_MESSAGE })

  const parsed = shiftSchema.safeParse({
    name: cellText(row.values, "name"),
    startTime: cellText(row.values, "startTime"),
    endTime: cellText(row.values, "endTime"),
    breakMinutes,
    graceMinutes,
    weeklyOffDays: offDays.ok ? offDays.value : undefined,
  })
  if (!parsed.success) issues.push(...zodIssues(row.rowNumber, parsed.error))
  if (issues.length > 0 || !parsed.success) return { ok: false, issues }

  return { ok: true, value: { rowNumber: row.rowNumber, ...parsed.data } }
}

const spec: ImportSpec<ShiftImportRow> = {
  columns: SHIFT_IMPORT_COLUMNS,
  validateRow,
  async validateAll(rows) {
    const existing = await prisma.shift.findMany({
      where: { name: { in: rows.map((r) => r.name) } },
      select: { name: true },
    })
    const taken = new Set(existing.map((s) => s.name))
    return rows
      .filter((r) => taken.has(r.name))
      .map((r) => ({
        rowNumber: r.rowNumber,
        column: "name",
        message: `The shift "${r.name}" is already in the system. Change it or remove the row.`,
      }))
  },
  summarise: (rows) => ({ shifts: rows.length }),
}

export function previewShiftImport(buffer: Buffer, fileName: string): Promise<ImportPreview<ShiftImportRow>> {
  return runPreview(buffer, fileName, spec)
}

async function writeImport(rows: ShiftImportRow[], actor: AccessTokenPayload): Promise<{ created: number }> {
  return prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const { rowNumber: _rowNumber, ...data } = row
      const shift = await tx.shift.create({ data })
      await writeAudit(tx, {
        entity: "SHIFT",
        entityId: shift.id,
        action: "IMPORT",
        changedBy: actor.sub,
        after: { name: row.name, startTime: row.startTime, endTime: row.endTime },
      })
    }
    return { created: rows.length }
  })
}

export function commitShiftImport(
  buffer: Buffer,
  fileName: string,
  actor: AccessTokenPayload
): Promise<{ created: number }> {
  return runCommit(buffer, fileName, spec, (rows) => writeImport(rows, actor))
}
