/**
 * The Express handlers every importer shares, so a module's routes file only
 * says which columns it has and which function does the work.
 */

import type { Request, RequestHandler } from "express"

import { AppError } from "../../middleware/errorHandler"
import { officeToday } from "../../modules/attendance/attendance.time"
import type { AccessTokenPayload } from "../../modules/auth/auth.types"
import { buildImportGuide, buildTemplateCsv, buildTemplateXlsx, type SampleRow } from "./import.template"
import { MAX_IMPORT_ROWS, type ColumnSpec } from "./import.types"

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

export function guideHandler(columns: ColumnSpec[]): RequestHandler {
  return (_req, res) => {
    res.json({ columns: buildImportGuide(columns), maxRows: MAX_IMPORT_ROWS })
  }
}

export interface TemplateOptions {
  columns: ColumnSpec[]
  /** Takes today's office date, because some examples need dates from today onward. */
  sampleRows: (today: Date) => SampleRow[]
  /** `departments` gives `departments-example.xlsx`. */
  baseName: string
}

export function templateHandler(options: TemplateOptions): RequestHandler {
  return async (req, res, next) => {
    try {
      const format = req.query.format ?? "xlsx"
      if (format !== "xlsx" && format !== "csv") {
        throw new AppError(400, "Choose a file type: xlsx or csv.")
      }
      const rows = options.sampleRows(officeToday())
      res.setHeader("Content-Disposition", `attachment; filename="${options.baseName}-example.${format}"`)
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8")
        res.send(buildTemplateCsv(options.columns, rows))
        return
      }
      res.setHeader("Content-Type", XLSX_MIME)
      res.send(await buildTemplateXlsx(options.columns, rows))
    } catch (err) {
      next(err)
    }
  }
}

function requireFile(req: Request) {
  if (!req.file) throw new AppError(400, "Choose an Excel (.xlsx) or CSV file to import.")
  return req.file
}

/** Reads the uploaded sheet and answers with the per-row report. Writes nothing. */
export function previewHandler<T>(run: (buffer: Buffer, fileName: string) => Promise<T>): RequestHandler {
  return async (req, res, next) => {
    try {
      const file = requireFile(req)
      res.json(await run(file.buffer, file.originalname))
    } catch (err) {
      next(err)
    }
  }
}

/** Writes the whole file in one transaction, as the signed-in user. */
export function commitHandler<T>(
  run: (buffer: Buffer, fileName: string, actor: AccessTokenPayload) => Promise<T>
): RequestHandler {
  return async (req, res, next) => {
    try {
      const file = requireFile(req)
      res.status(201).json(await run(file.buffer, file.originalname, req.user!))
    } catch (err) {
      next(err)
    }
  }
}
