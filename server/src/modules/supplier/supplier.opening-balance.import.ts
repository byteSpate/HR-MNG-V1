/**
 * The supplier opening-balance importer.
 *
 * Mirrors customer.opening-balance.import.ts exactly: one row per supplier,
 * what we owed on `SALES_GO_LIVE`, matched by `name` (already `@unique` on
 * Supplier, unlike Customer.legalName which needed a follow-up migration
 * to get the same property).
 */

import { env } from "../../config/env"
import prisma from "../../config/prisma"
import { writeAudit } from "../../utils/audit"
import { runCommit, runPreview } from "../../utils/import/import.run"
import type { ImportSpec } from "../../utils/import/import.run"
import type { ColumnSpec, ImportPreview, ParsedRow, RowIssue } from "../../utils/import/import.types"
import type { AccessTokenPayload } from "../auth/auth.types"

export const COLUMNS: ColumnSpec[] = [
  { header: "name", required: true, uniqueInFile: true },
  { header: "amount", required: true },
  { header: "contactName", required: false },
  { header: "contactPhone", required: false },
  { header: "contactEmail", required: false },
  { header: "bin", required: false },
  { header: "paymentDays", required: false },
]

interface SupplierOpeningBalanceRow {
  rowNumber: number
  name: string
  amount: number
  contactName?: string
  contactPhone?: string
  contactEmail?: string
  bin?: string
  paymentDays?: number
}

function validateRow(
  row: ParsedRow
): { ok: true; value: SupplierOpeningBalanceRow } | { ok: false; issues: RowIssue[] } {
  const issues: RowIssue[] = []
  const cell = (key: string) => (row.values[key] ?? "").trim()
  const flag = (column: string, message: string) => issues.push({ rowNumber: row.rowNumber, column, message })

  const name = cell("name")

  let amount: number | undefined
  const amountRaw = cell("amount")
  const amountN = Number(amountRaw)
  if (!Number.isFinite(amountN) || amountN < 0) {
    flag("amount", "amount must be a non-negative number")
  } else {
    amount = amountN
  }

  let paymentDays: number | undefined
  const paymentDaysRaw = cell("paymentdays")
  if (paymentDaysRaw) {
    const n = Number(paymentDaysRaw)
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      flag("paymentDays", "paymentDays must be an integer between 0 and 365")
    } else {
      paymentDays = n
    }
  }

  if (issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    value: {
      rowNumber: row.rowNumber,
      name,
      amount: amount!,
      contactName: cell("contactname") || undefined,
      contactPhone: cell("contactphone") || undefined,
      contactEmail: cell("contactemail") || undefined,
      bin: cell("bin") || undefined,
      paymentDays,
    },
  }
}

async function validateAgainstExisting(rows: SupplierOpeningBalanceRow[]): Promise<RowIssue[]> {
  const existing = await prisma.supplier.findMany({
    where: { name: { in: rows.map((r) => r.name) } },
    select: { name: true, openingBalance: { select: { id: true } } },
  })
  const alreadyHasOpeningBalance = new Set(
    existing.filter((s) => s.openingBalance).map((s) => s.name)
  )
  return rows
    .filter((r) => alreadyHasOpeningBalance.has(r.name))
    .map((r) => ({
      rowNumber: r.rowNumber,
      column: "name",
      message: `${r.name} already has an opening balance. This is a one-time import: correct it with a manual journal instead.`,
    }))
}

function summarise(rows: SupplierOpeningBalanceRow[]): Record<string, number> {
  return { suppliers: rows.length, totalAmount: rows.reduce((sum, r) => sum + r.amount, 0) }
}

function buildSpec(): ImportSpec<SupplierOpeningBalanceRow> {
  return { columns: COLUMNS, validateRow, validateAll: validateAgainstExisting, summarise }
}

export async function previewSupplierOpeningBalanceImport(
  buffer: Buffer,
  fileName: string
): Promise<ImportPreview<SupplierOpeningBalanceRow>> {
  return runPreview(buffer, fileName, buildSpec())
}

async function writeImport(
  rows: SupplierOpeningBalanceRow[],
  actor: AccessTokenPayload
): Promise<{ supplierCount: number; totalAmount: number }> {
  const asOf = new Date(`${env.SALES_GO_LIVE}T00:00:00.000Z`)

  return prisma.$transaction(async (tx) => {
    let totalAmount = 0

    for (const row of rows) {
      let supplier = await tx.supplier.findUnique({ where: { name: row.name } })
      if (!supplier) {
        supplier = await tx.supplier.create({
          data: {
            name: row.name,
            contactName: row.contactName ?? null,
            contactPhone: row.contactPhone ?? null,
            contactEmail: row.contactEmail ?? null,
            bin: row.bin ?? null,
            paymentDays: row.paymentDays ?? 30,
          },
        })
        await writeAudit(tx, {
          entity: "SUPPLIER",
          entityId: supplier.id,
          action: "CREATE",
          changedBy: actor.sub,
          after: { name: supplier.name },
        })
      }

      await tx.supplierOpeningBalance.create({
        data: { supplierId: supplier.id, amount: row.amount, asOf, importedBy: actor.sub },
      })
      totalAmount += row.amount

      await writeAudit(tx, {
        entity: "SUPPLIER",
        entityId: supplier.id,
        action: "IMPORT",
        changedBy: actor.sub,
        after: { openingBalance: row.amount, asOf: env.SALES_GO_LIVE },
      })
    }

    return { supplierCount: rows.length, totalAmount }
  })
}

export async function commitSupplierOpeningBalanceImport(
  buffer: Buffer,
  fileName: string,
  actor: AccessTokenPayload
): Promise<{ supplierCount: number; totalAmount: number }> {
  return runCommit(buffer, fileName, buildSpec(), (rows) => writeImport(rows, actor))
}
