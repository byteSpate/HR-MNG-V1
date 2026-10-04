/**
 * VAT codes by file. Create only, checked with the same Zod schema as the
 * New VAT code form. A rate change never touches old documents, and an import
 * cannot change an existing code at all, so no old invoice or bill can move.
 */

import prisma from "../../config/prisma"
import { writeAudit } from "../../utils/audit"
import { cellText, parseYesNo, zodIssues } from "../../utils/import/import.cells"
import { runCommit, runPreview, type ImportSpec } from "../../utils/import/import.run"
import type { SampleRow } from "../../utils/import/import.template"
import type { ColumnSpec, ImportPreview, ParsedRow, RowIssue } from "../../utils/import/import.types"
import type { AccessTokenPayload } from "../auth/auth.types"
import { createVatCodeSchema } from "./vatCode.validators"

export const VAT_CODE_IMPORT_COLUMNS: ColumnSpec[] = [
  {
    header: "code",
    required: true,
    uniqueInFile: true,
    type: "text",
    maxLength: 20,
    description: "A short code. Use capital letters, numbers and _ only. It must not already be in the system.",
    example: "VAT15",
  },
  { header: "name", required: true, type: "text", maxLength: 80, description: "What people see in the list.", example: "Standard VAT 15%" },
  {
    header: "ratePercent",
    required: true,
    type: "decimal",
    description: "The rate in percent. A number from 0 to 100 with up to 2 digits after the point, like 15 or 7.5.",
    example: "15",
  },
  {
    header: "isActive",
    required: false,
    type: "boolean",
    description: "Yes if people can pick this code on new lines. Leave blank for Yes.",
    example: "Yes",
  },
]

export function vatCodeImportSampleRows(_today: Date): SampleRow[] {
  return [
    { code: "VAT15", name: "Standard VAT 15%", ratePercent: "15", isActive: "Yes" },
    { code: "VAT0", name: "Zero rated", ratePercent: "0", isActive: "Yes" },
  ]
}

export interface VatCodeImportRow {
  rowNumber: number
  code: string
  name: string
  ratePercent: string
  isActive: boolean
}

function validateRow(row: ParsedRow): { ok: true; value: VatCodeImportRow } | { ok: false; issues: RowIssue[] } {
  const issues: RowIssue[] = []

  let isActive = true
  const activeRaw = cellText(row.values, "isActive")
  if (activeRaw !== "") {
    const answer = parseYesNo(activeRaw)
    if (!answer.ok) issues.push({ rowNumber: row.rowNumber, column: "isActive", message: "Write Yes or No." })
    else isActive = answer.value
  }

  const parsed = createVatCodeSchema.safeParse({
    code: cellText(row.values, "code"),
    name: cellText(row.values, "name"),
    ratePercent: cellText(row.values, "ratePercent"),
  })
  if (!parsed.success) issues.push(...zodIssues(row.rowNumber, parsed.error))
  if (issues.length > 0 || !parsed.success) return { ok: false, issues }

  return { ok: true, value: { rowNumber: row.rowNumber, ...parsed.data, isActive } }
}

const spec: ImportSpec<VatCodeImportRow> = {
  columns: VAT_CODE_IMPORT_COLUMNS,
  validateRow,
  async validateAll(rows) {
    const existing = await prisma.vatCode.findMany({
      where: { code: { in: rows.map((r) => r.code) } },
      select: { code: true },
    })
    const taken = new Set(existing.map((c) => c.code))
    return rows
      .filter((r) => taken.has(r.code))
      .map((r) => ({
        rowNumber: r.rowNumber,
        column: "code",
        message: `The code "${r.code}" is already in the system. Change it or remove the row.`,
      }))
  },
  summarise: (rows) => ({ vatCodes: rows.length }),
}

export function previewVatCodeImport(buffer: Buffer, fileName: string): Promise<ImportPreview<VatCodeImportRow>> {
  return runPreview(buffer, fileName, spec)
}

async function writeImport(rows: VatCodeImportRow[], actor: AccessTokenPayload): Promise<{ created: number }> {
  return prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const created = await tx.vatCode.create({
        data: { code: row.code, name: row.name, ratePercent: row.ratePercent, isActive: row.isActive },
      })
      await writeAudit(tx, {
        entity: "VAT_CODE",
        entityId: created.id,
        action: "IMPORT",
        changedBy: actor.sub,
        after: { code: row.code, name: row.name, ratePercent: row.ratePercent },
      })
    }
    return { created: rows.length }
  })
}

export function commitVatCodeImport(
  buffer: Buffer,
  fileName: string,
  actor: AccessTokenPayload
): Promise<{ created: number }> {
  return runCommit(buffer, fileName, spec, (rows) => writeImport(rows, actor))
}
