/**
 * Suppliers by file. Create only. The record is checked with the same Zod
 * schema as the New supplier form. Two names that differ only by capitals,
 * spaces or punctuation are the same supplier (`supplierNameKey`), so that is
 * how a duplicate is found, in the file and in the database.
 */

import prisma from "../../config/prisma"
import { writeAudit } from "../../utils/audit"
import { cellText, parseWholeNumber, parseYesNo, zodIssues } from "../../utils/import/import.cells"
import { runCommit, runPreview, type ImportSpec } from "../../utils/import/import.run"
import type { SampleRow } from "../../utils/import/import.template"
import type { ColumnSpec, ImportPreview, ParsedRow, RowIssue } from "../../utils/import/import.types"
import type { AccessTokenPayload } from "../auth/auth.types"
import { supplierNameKey } from "./supplier.quick"
import { createSupplierSchema, type CreateSupplierInput } from "./supplier.validators"

export const SUPPLIER_IMPORT_COLUMNS: ColumnSpec[] = [
  {
    header: "name",
    required: true,
    uniqueInFile: true,
    type: "text",
    maxLength: 200,
    description:
      "The supplier name. Two names that differ only by capitals, spaces or punctuation count as the same supplier.",
    example: "Star Tech Ltd",
  },
  { header: "contactName", required: false, type: "text", maxLength: 100, description: "The person we speak to.", example: "Rahim Uddin" },
  { header: "contactPhone", required: false, type: "text", maxLength: 30, description: "A phone number.", example: "+8801711000000" },
  { header: "contactEmail", required: false, type: "email", description: "An email address.", example: "sales@startech.example" },
  { header: "bin", required: false, type: "text", maxLength: 20, description: "The supplier's BIN, which is its tax number.", example: "123456789" },
  {
    header: "paymentDays",
    required: false,
    type: "integer",
    description: "How many days we have to pay a bill. A whole number from 0 to 365. Leave blank for 30.",
    example: "30",
  },
  {
    header: "isActive",
    required: false,
    type: "boolean",
    description: "Yes if we can use this supplier on new bills. Leave blank for Yes.",
    example: "Yes",
  },
]

export function supplierImportSampleRows(_today: Date): SampleRow[] {
  return [
    {
      name: "Star Tech Ltd", contactName: "Rahim Uddin", contactPhone: "+8801711000000",
      contactEmail: "sales@startech.example", bin: "123456789", paymentDays: "30", isActive: "Yes",
    },
    {
      name: "Smart Technologies", contactName: "Karim Hossain", contactPhone: "+8801811000000",
      contactEmail: "info@smart.example", bin: "", paymentDays: "45", isActive: "Yes",
    },
  ]
}

export type SupplierImportRow = CreateSupplierInput & { rowNumber: number; name: string; isActive: boolean }

function validateRow(row: ParsedRow): { ok: true; value: SupplierImportRow } | { ok: false; issues: RowIssue[] } {
  const issues: RowIssue[] = []
  const text = (header: string) => cellText(row.values, header) || undefined

  let paymentDays: number | undefined
  const paymentRaw = cellText(row.values, "paymentDays")
  if (paymentRaw !== "") {
    const days = parseWholeNumber(paymentRaw)
    if (days === null) issues.push({ rowNumber: row.rowNumber, column: "paymentDays", message: "Use a whole number like 30." })
    else paymentDays = days
  }

  let isActive = true
  const activeRaw = cellText(row.values, "isActive")
  if (activeRaw !== "") {
    const answer = parseYesNo(activeRaw)
    if (!answer.ok) issues.push({ rowNumber: row.rowNumber, column: "isActive", message: "Write Yes or No." })
    else isActive = answer.value
  }

  const name = cellText(row.values, "name")
  if (name !== "" && supplierNameKey(name) === "") {
    issues.push({ rowNumber: row.rowNumber, column: "name", message: "Use at least one letter or number in the name." })
  }

  const parsed = createSupplierSchema.safeParse({
    name,
    contactName: text("contactName"),
    contactPhone: text("contactPhone"),
    contactEmail: text("contactEmail"),
    bin: text("bin"),
    paymentDays,
  })
  if (!parsed.success) issues.push(...zodIssues(row.rowNumber, parsed.error))
  if (issues.length > 0 || !parsed.success) return { ok: false, issues }

  return { ok: true, value: { rowNumber: row.rowNumber, ...parsed.data, isActive } }
}

const spec: ImportSpec<SupplierImportRow> = {
  columns: SUPPLIER_IMPORT_COLUMNS,
  validateRow,
  async validateAll(rows) {
    const issues: RowIssue[] = []

    const byKey = new Map<string, SupplierImportRow[]>()
    for (const row of rows) {
      const key = supplierNameKey(row.name)
      byKey.set(key, [...(byKey.get(key) ?? []), row])
    }
    for (const group of byKey.values()) {
      if (group.length < 2) continue
      const rowNumbers = group.map((r) => r.rowNumber).join(", ")
      for (const row of group) {
        issues.push({
          rowNumber: row.rowNumber,
          column: "name",
          message: `"${row.name}" looks the same as another name in this file (rows ${rowNumbers}). Keep one of them.`,
        })
      }
    }

    const existing = await prisma.supplier.findMany({
      where: { nameKey: { in: [...byKey.keys()] } },
      select: { name: true, nameKey: true },
    })
    const taken = new Map(existing.map((s) => [s.nameKey, s.name]))
    for (const row of rows) {
      const found = taken.get(supplierNameKey(row.name))
      if (found) {
        issues.push({
          rowNumber: row.rowNumber,
          column: "name",
          message: `"${row.name}" is already in the system as "${found}". Change it or remove the row.`,
        })
      }
    }
    return issues
  },
  summarise: (rows) => ({ suppliers: rows.length }),
}

export function previewSupplierImport(buffer: Buffer, fileName: string): Promise<ImportPreview<SupplierImportRow>> {
  return runPreview(buffer, fileName, spec)
}

async function writeImport(rows: SupplierImportRow[], actor: AccessTokenPayload): Promise<{ created: number }> {
  return prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const paymentDays = row.paymentDays ?? 30
      const supplier = await tx.supplier.create({
        data: {
          name: row.name,
          nameKey: supplierNameKey(row.name),
          contactName: row.contactName ?? null,
          contactPhone: row.contactPhone ?? null,
          contactEmail: row.contactEmail ?? null,
          bin: row.bin ?? null,
          paymentDays,
          isActive: row.isActive,
        },
      })
      await writeAudit(tx, {
        entity: "SUPPLIER",
        entityId: supplier.id,
        action: "IMPORT",
        changedBy: actor.sub,
        after: { name: row.name, bin: row.bin ?? null, paymentDays },
      })
    }
    return { created: rows.length }
  })
}

export function commitSupplierImport(
  buffer: Buffer,
  fileName: string,
  actor: AccessTokenPayload
): Promise<{ created: number }> {
  return runCommit(buffer, fileName, spec, (rows) => writeImport(rows, actor))
}
