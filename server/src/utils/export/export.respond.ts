import type { Response } from "express"

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { officeToday } from "../../modules/attendance/attendance.time"
import type { AccessTokenPayload } from "../../modules/auth/auth.types"
import { writeAudit } from "../audit"
import { formatDateOnly } from "../dates"
import { toCsvFile } from "./export.csv"
import { toPdf } from "./export.pdf"
import type { ExportFormat, ExportSpec } from "./export.types"
import { toXlsx } from "./export.xlsx"

export const MAX_EXPORT_ROWS = 20_000
export const MAX_PDF_ROWS = 2_000

const FORMATS: readonly ExportFormat[] = ["xlsx", "csv", "pdf"]

export function parseExportFormat(value: unknown): ExportFormat {
  if (typeof value === "string" && (FORMATS as readonly string[]).includes(value)) {
    return value as ExportFormat
  }
  throw new AppError(400, "Choose a file type: xlsx, csv or pdf.")
}

const MIME: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
}

async function build(spec: ExportSpec, format: ExportFormat): Promise<Buffer> {
  if (format === "xlsx") return toXlsx(spec)
  if (format === "csv") return toCsvFile(spec)
  return toPdf(spec)
}

export interface SendExportArgs {
  res: Response
  spec: ExportSpec
  format: ExportFormat
  /** `suppliers` gives `suppliers-2026-10-04.xlsx`. */
  baseName: string
  actor: AccessTokenPayload
  /** The audit row's entityId, for example `SUPPLIERS`. */
  list: string
  /** The filters that produced the rows. Stored in the audit row. */
  filter?: Record<string, unknown>
}

/**
 * Builds the file, writes the audit row, then sends. The audit row comes
 * first on purpose: no file leaves the system without a trace of who took it.
 */
export async function sendExport(args: SendExportArgs): Promise<void> {
  const { res, spec, format, baseName, actor, list, filter } = args

  if (spec.rows.length > MAX_EXPORT_ROWS) {
    throw new AppError(400, "This list has too many rows to export at once. Add a filter and try again.")
  }
  if (format === "pdf" && spec.rows.length > MAX_PDF_ROWS) {
    throw new AppError(400, "This list is too long for a PDF. Choose Excel or CSV instead, or add a filter.")
  }

  const body = await build(spec, format)

  await prisma.$transaction((tx) =>
    writeAudit(tx, {
      entity: "DATA_EXPORT",
      entityId: list,
      action: "EXPORT",
      changedBy: actor.sub,
      // JSON round trip drops `undefined` values, which Prisma's JSON type rejects.
      after: JSON.parse(JSON.stringify({ format, rows: spec.rows.length, filter: filter ?? {} })),
    })
  )

  res.setHeader("Content-Type", MIME[format])
  res.setHeader("Content-Disposition", `attachment; filename="${baseName}-${formatDateOnly(officeToday())}.${format}"`)
  res.send(body)
}
