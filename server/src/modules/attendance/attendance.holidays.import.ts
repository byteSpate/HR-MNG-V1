/**
 * Holidays by file, from today onward only.
 *
 * A holiday changes how past attendance days are labelled, because absence and
 * holidays are worked out when the day is read. So an import may only add
 * today and later days. The payroll lock still applies to every month in the
 * file, as it does for the Add holiday form.
 *
 * "Today" is the office date, not the UTC date: at 00:30 in Dhaka the UTC date
 * is still yesterday.
 */

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { addDays, formatDateOnly, parseDateOnly } from "../../utils/dates"
import { cellText, isValidIsoDate, zodIssues } from "../../utils/import/import.cells"
import { runCommit, runPreview, type ImportSpec } from "../../utils/import/import.run"
import type { SampleRow } from "../../utils/import/import.template"
import type { ColumnSpec, ImportPreview, ParsedRow, RowIssue } from "../../utils/import/import.types"
import { assertMonthNotLocked } from "../../utils/month-lock"
import type { AccessTokenPayload } from "../auth/auth.types"
import { officeDateOf } from "./attendance.time"
import { holidaySchema } from "./attendance.validators"

const TYPES = ["GENERAL", "EXECUTIVE_ORDER", "OPTIONAL", "WORKING_DAY"] as const
type HolidayType = (typeof TYPES)[number]

export const HOLIDAY_IMPORT_COLUMNS: ColumnSpec[] = [
  { header: "name", required: true, type: "text", maxLength: 200, description: "The name of the holiday.", example: "Victory Day" },
  {
    header: "date",
    required: true,
    type: "date",
    description:
      "The day of the holiday, written YYYY-MM-DD. It must be today or a later day. A day that has passed cannot be added here.",
    example: "2026-12-16",
  },
  {
    header: "type",
    required: false,
    type: "choice",
    allowed: [...TYPES],
    description:
      "GENERAL is a normal public holiday. WORKING_DAY turns a normal day off into a working day. Leave blank for GENERAL.",
    example: "GENERAL",
  },
]

/** Both example days are in the future, so the example always passes its own check. */
export function holidayImportSampleRows(today: Date): SampleRow[] {
  return [
    { name: "Example holiday one", date: formatDateOnly(addDays(today, 30)), type: "GENERAL" },
    { name: "Example holiday two", date: formatDateOnly(addDays(today, 60)), type: "OPTIONAL" },
  ]
}

export interface HolidayImportRow {
  rowNumber: number
  name: string
  date: string
  type: HolidayType
}

function makeValidateRow(today: Date) {
  return (row: ParsedRow): { ok: true; value: HolidayImportRow } | { ok: false; issues: RowIssue[] } => {
    const issues: RowIssue[] = []

    const date = cellText(row.values, "date")
    if (!isValidIsoDate(date)) {
      issues.push({ rowNumber: row.rowNumber, column: "date", message: "Write the date as YYYY-MM-DD, like 2026-12-16." })
    } else if (parseDateOnly(date).getTime() < today.getTime()) {
      issues.push({
        rowNumber: row.rowNumber,
        column: "date",
        message: "This date has passed. Holidays can only be added from today onward.",
      })
    }

    const typeRaw = cellText(row.values, "type").toUpperCase()
    let type: HolidayType | undefined
    if (typeRaw !== "") {
      if ((TYPES as readonly string[]).includes(typeRaw)) type = typeRaw as HolidayType
      else {
        issues.push({
          rowNumber: row.rowNumber,
          column: "type",
          message: "Write GENERAL, EXECUTIVE_ORDER, OPTIONAL or WORKING_DAY, or leave it blank.",
        })
      }
    }

    // The date was checked above with a clearer message, so only the name and
    // type go through the form's schema.
    const parsed = holidaySchema
      .pick({ name: true, type: true })
      .safeParse({ name: cellText(row.values, "name"), type })
    if (!parsed.success) issues.push(...zodIssues(row.rowNumber, parsed.error))
    if (issues.length > 0 || !parsed.success) return { ok: false, issues }

    return { ok: true, value: { rowNumber: row.rowNumber, name: parsed.data.name, date, type: parsed.data.type } }
  }
}

async function validateAll(rows: HolidayImportRow[]): Promise<RowIssue[]> {
  if (rows.length === 0) return []
  const issues: RowIssue[] = []

  // The same day and name twice in one file.
  const seen = new Map<string, HolidayImportRow[]>()
  for (const row of rows) {
    const key = `${row.date}|${row.name}`
    seen.set(key, [...(seen.get(key) ?? []), row])
  }
  for (const group of seen.values()) {
    if (group.length < 2) continue
    const rowNumbers = group.map((r) => r.rowNumber).join(", ")
    for (const row of group) {
      issues.push({
        rowNumber: row.rowNumber,
        column: "name",
        message: `"${row.name}" on ${row.date} appears more than once in this file (rows ${rowNumbers}). Keep one.`,
      })
    }
  }

  // Already in the calendar.
  const existing = await prisma.holiday.findMany({
    where: { OR: rows.map((r) => ({ date: parseDateOnly(r.date), name: r.name })) },
    select: { date: true, name: true },
  })
  const taken = new Set(existing.map((h) => `${formatDateOnly(h.date)}|${h.name}`))
  for (const row of rows) {
    if (taken.has(`${row.date}|${row.name}`)) {
      issues.push({
        rowNumber: row.rowNumber,
        column: "name",
        message: `"${row.name}" on ${row.date} is already in the calendar. Change it or remove the row.`,
      })
    }
  }

  // Payroll lock: one check per month in the file.
  const months = new Map<string, HolidayImportRow[]>()
  for (const row of rows) {
    const month = row.date.slice(0, 7)
    months.set(month, [...(months.get(month) ?? []), row])
  }
  for (const group of months.values()) {
    try {
      await assertMonthNotLocked(parseDateOnly(group[0].date))
    } catch (err) {
      if (!(err instanceof AppError)) throw err
      for (const row of group) {
        issues.push({ rowNumber: row.rowNumber, column: "date", message: err.message })
      }
    }
  }
  return issues
}

function buildSpec(today: Date): ImportSpec<HolidayImportRow> {
  return {
    columns: HOLIDAY_IMPORT_COLUMNS,
    validateRow: makeValidateRow(today),
    validateAll,
    summarise: (rows) => ({ holidays: rows.length }),
  }
}

/** `now` is a parameter so a test can pin the clock. */
export function previewHolidayImport(
  buffer: Buffer,
  fileName: string,
  now: Date = new Date()
): Promise<ImportPreview<HolidayImportRow>> {
  return runPreview(buffer, fileName, buildSpec(officeDateOf(now)))
}

async function writeImport(rows: HolidayImportRow[], actor: AccessTokenPayload): Promise<{ created: number }> {
  return prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const holiday = await tx.holiday.create({
        data: { name: row.name, date: parseDateOnly(row.date), type: row.type },
      })
      await writeAudit(tx, {
        entity: "HOLIDAY",
        entityId: holiday.id,
        action: "IMPORT",
        changedBy: actor.sub,
        after: { name: row.name, date: row.date, type: row.type },
      })
    }
    return { created: rows.length }
  })
}

export function commitHolidayImport(
  buffer: Buffer,
  fileName: string,
  actor: AccessTokenPayload,
  now: Date = new Date()
): Promise<{ created: number }> {
  return runCommit(buffer, fileName, buildSpec(officeDateOf(now)), (rows) => writeImport(rows, actor))
}
