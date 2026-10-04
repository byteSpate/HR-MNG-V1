/**
 * Departments by file. Create only: a name that exists is a row error, and one
 * bad row stops the whole file. The record is checked with the same Zod schema
 * as the Add department form, so an imported department is the same as a typed one.
 */

import prisma from "../../config/prisma"
import { writeAudit } from "../../utils/audit"
import { cellText, zodIssues } from "../../utils/import/import.cells"
import { runCommit, runPreview, type ImportSpec } from "../../utils/import/import.run"
import type { SampleRow } from "../../utils/import/import.template"
import type { ColumnSpec, ImportPreview, ParsedRow, RowIssue } from "../../utils/import/import.types"
import type { AccessTokenPayload } from "../auth/auth.types"
import { createDepartmentSchema } from "./department.validators"

const COST_NATURES = ["DIRECT", "ADMINISTRATIVE"] as const
type CostNature = (typeof COST_NATURES)[number]

export const DEPARTMENT_IMPORT_COLUMNS: ColumnSpec[] = [
  {
    header: "name",
    required: true,
    uniqueInFile: true,
    type: "text",
    maxLength: 100,
    description: "The department name. It must not already be in the system.",
    example: "Finance",
  },
  {
    header: "costNature",
    required: false,
    type: "choice",
    allowed: [...COST_NATURES],
    description:
      "DIRECT if the work is billed to customers. ADMINISTRATIVE if it is not. Leave blank for ADMINISTRATIVE.",
    example: "ADMINISTRATIVE",
  },
]

export function departmentImportSampleRows(_today: Date): SampleRow[] {
  return [
    { name: "Finance", costNature: "ADMINISTRATIVE" },
    { name: "Field Service", costNature: "DIRECT" },
  ]
}

export interface DepartmentImportRow {
  rowNumber: number
  name: string
  costNature: CostNature
}

function validateRow(row: ParsedRow): { ok: true; value: DepartmentImportRow } | { ok: false; issues: RowIssue[] } {
  const issues: RowIssue[] = []

  const costNatureRaw = cellText(row.values, "costNature").toUpperCase()
  let costNature: CostNature | undefined
  if (costNatureRaw !== "") {
    if ((COST_NATURES as readonly string[]).includes(costNatureRaw)) costNature = costNatureRaw as CostNature
    else issues.push({ rowNumber: row.rowNumber, column: "costNature", message: "Write DIRECT or ADMINISTRATIVE, or leave it blank." })
  }

  const parsed = createDepartmentSchema.safeParse({ name: cellText(row.values, "name"), costNature })
  if (!parsed.success) issues.push(...zodIssues(row.rowNumber, parsed.error))
  if (issues.length > 0 || !parsed.success) return { ok: false, issues }

  return {
    ok: true,
    value: { rowNumber: row.rowNumber, name: parsed.data.name, costNature: parsed.data.costNature ?? "ADMINISTRATIVE" },
  }
}

const spec: ImportSpec<DepartmentImportRow> = {
  columns: DEPARTMENT_IMPORT_COLUMNS,
  validateRow,
  async validateAll(rows) {
    const existing = await prisma.department.findMany({
      where: { name: { in: rows.map((r) => r.name) } },
      select: { name: true },
    })
    const taken = new Set(existing.map((d) => d.name))
    return rows
      .filter((r) => taken.has(r.name))
      .map((r) => ({
        rowNumber: r.rowNumber,
        column: "name",
        message: `"${r.name}" is already in the system. Change it or remove the row.`,
      }))
  },
  summarise: (rows) => ({ departments: rows.length }),
}

export function previewDepartmentImport(buffer: Buffer, fileName: string): Promise<ImportPreview<DepartmentImportRow>> {
  return runPreview(buffer, fileName, spec)
}

async function writeImport(rows: DepartmentImportRow[], actor: AccessTokenPayload): Promise<{ created: number }> {
  return prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const department = await tx.department.create({ data: { name: row.name, costNature: row.costNature } })
      await writeAudit(tx, {
        entity: "DEPARTMENT",
        entityId: department.id,
        action: "IMPORT",
        changedBy: actor.sub,
        after: { name: row.name, costNature: row.costNature },
      })
    }
    return { created: rows.length }
  })
}

export function commitDepartmentImport(
  buffer: Buffer,
  fileName: string,
  actor: AccessTokenPayload
): Promise<{ created: number }> {
  return runCommit(buffer, fileName, spec, (rows) => writeImport(rows, actor))
}
