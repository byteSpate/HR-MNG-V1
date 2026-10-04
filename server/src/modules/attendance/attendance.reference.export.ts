/**
 * File exports for the two attendance reference lists, Shifts and Holidays.
 * The handler sits beside the spec builder, as in the other export files.
 */

import type { NextFunction, Request, Response } from "express"

import { AppError } from "../../middleware/errorHandler"
import { parseExportFormat, sendExport } from "../../utils/export/export.respond"
import type { ExportSpec } from "../../utils/export/export.types"
import { listHolidays } from "./attendance.holidays"
import { listShifts } from "./attendance.shifts"

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export async function buildShiftExportSpec(): Promise<ExportSpec> {
  const shifts = await listShifts()
  return {
    title: "Shifts",
    columns: [
      { header: "name", pdfHeader: "Shift", type: "text", inPdf: true },
      { header: "startTime", pdfHeader: "Start", type: "text", inPdf: true },
      { header: "endTime", pdfHeader: "End", type: "text", inPdf: true },
      { header: "breakMinutes", pdfHeader: "Break (min)", type: "integer", inPdf: true },
      { header: "graceMinutes", pdfHeader: "Grace (min)", type: "integer", inPdf: true },
      { header: "weeklyOffDays", pdfHeader: "Weekly off (numbers)", type: "text" },
      { header: "weeklyOff", pdfHeader: "Weekly off", type: "text", inPdf: true },
      { header: "effectiveFrom", pdfHeader: "Effective from", type: "date" },
      { header: "effectiveTo", pdfHeader: "Effective to", type: "date" },
    ],
    rows: shifts.map((s) => [
      s.name,
      s.startTime,
      s.endTime,
      s.breakMinutes,
      s.graceMinutes,
      s.weeklyOffDays.join(";"),
      s.weeklyOffDays.map((day) => DAY_NAMES[day]).join(", "),
      s.effectiveFrom,
      s.effectiveTo,
    ]),
  }
}

export async function exportShiftsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const format = parseExportFormat(req.query.format)
    await sendExport({
      res, spec: await buildShiftExportSpec(), format, baseName: "shifts", actor: req.user!, list: "SHIFTS",
    })
  } catch (err) {
    next(err)
  }
}

export async function buildHolidayExportSpec(year?: number): Promise<ExportSpec> {
  const holidays = await listHolidays(year)
  return {
    title: "Holidays",
    filterNote: year === undefined ? "All years" : `Year ${year}`,
    columns: [
      { header: "name", pdfHeader: "Holiday", type: "text", inPdf: true },
      { header: "date", pdfHeader: "Date", type: "date", inPdf: true },
      { header: "type", pdfHeader: "Type", type: "text", inPdf: true },
    ],
    rows: holidays.map((h) => [h.name, new Date(`${h.date}T00:00:00.000Z`), h.type]),
  }
}

export async function exportHolidaysHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const format = parseExportFormat(req.query.format)
    let year: number | undefined
    if (req.query.year !== undefined && req.query.year !== "") {
      year = Number(req.query.year)
      if (!Number.isInteger(year)) throw new AppError(400, "Year must be a whole number like 2026.")
    }
    await sendExport({
      res,
      spec: await buildHolidayExportSpec(year),
      format,
      baseName: year === undefined ? "holidays" : `holidays-${year}`,
      actor: req.user!,
      list: "HOLIDAYS",
      filter: { year },
    })
  } catch (err) {
    next(err)
  }
}
