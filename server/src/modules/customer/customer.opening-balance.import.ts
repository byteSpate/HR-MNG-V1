/**
 * The customer opening-balance importer.
 *
 * One row per customer: what they owed on `SALES_GO_LIVE`. A row whose
 * `legalName` matches no existing Customer creates one; a row whose name
 * matches an existing customer that already has an opening balance is
 * refused on preview, because re-importing a customer who already has one
 * is either a duplicate file or a correction that needs a reversing
 * journal, never a silent overwrite — `CustomerOpeningBalance.customerId`
 * is `@unique` for exactly this reason.
 *
 * Follows `cost.import.ts` exactly: parsing, per-row report and the
 * all-or-nothing transaction all live in `utils/import/`; this file
 * supplies the column spec, the row validator and the writer.
 */

import { env } from "../../config/env"
import prisma from "../../config/prisma"
import { writeAudit } from "../../utils/audit"
import { runCommit, runPreview } from "../../utils/import/import.run"
import type { ImportSpec } from "../../utils/import/import.run"
import type { ColumnSpec, ImportPreview, ParsedRow, RowIssue } from "../../utils/import/import.types"
import type { AccessTokenPayload } from "../auth/auth.types"

export const COLUMNS: ColumnSpec[] = [
  { header: "legalName", required: true, uniqueInFile: true },
  { header: "amount", required: true },
  { header: "billingAddress", required: false },
  { header: "bin", required: false },
  { header: "paymentDays", required: false },
]

interface CustomerOpeningBalanceRow {
  rowNumber: number
  legalName: string
  amount: number
  billingAddress?: string
  bin?: string
  paymentDays?: number
}

function validateRow(
  row: ParsedRow
): { ok: true; value: CustomerOpeningBalanceRow } | { ok: false; issues: RowIssue[] } {
  const issues: RowIssue[] = []
  const cell = (key: string) => (row.values[key] ?? "").trim()
  const flag = (column: string, message: string) => issues.push({ rowNumber: row.rowNumber, column, message })

  const legalName = cell("legalname")

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
      legalName,
      amount: amount!,
      billingAddress: cell("billingaddress") || undefined,
      bin: cell("bin") || undefined,
      paymentDays,
    },
  }
}

async function validateAgainstExisting(rows: CustomerOpeningBalanceRow[]): Promise<RowIssue[]> {
  const existing = await prisma.customer.findMany({
    where: { legalName: { in: rows.map((r) => r.legalName) } },
    select: { legalName: true, openingBalance: { select: { id: true } } },
  })
  const alreadyHasOpeningBalance = new Set(
    existing.filter((c) => c.openingBalance).map((c) => c.legalName)
  )
  return rows
    .filter((r) => alreadyHasOpeningBalance.has(r.legalName))
    .map((r) => ({
      rowNumber: r.rowNumber,
      column: "legalName",
      message: `${r.legalName} already has an opening balance. This is a one-time import: correct it with a manual journal instead.`,
    }))
}

function summarise(rows: CustomerOpeningBalanceRow[]): Record<string, number> {
  return { customers: rows.length, totalAmount: rows.reduce((sum, r) => sum + r.amount, 0) }
}

function buildSpec(): ImportSpec<CustomerOpeningBalanceRow> {
  return { columns: COLUMNS, validateRow, validateAll: validateAgainstExisting, summarise }
}

export async function previewCustomerOpeningBalanceImport(
  buffer: Buffer,
  fileName: string
): Promise<ImportPreview<CustomerOpeningBalanceRow>> {
  return runPreview(buffer, fileName, buildSpec())
}

async function writeImport(
  rows: CustomerOpeningBalanceRow[],
  actor: AccessTokenPayload
): Promise<{ customerCount: number; totalAmount: number }> {
  const asOf = new Date(`${env.SALES_GO_LIVE}T00:00:00.000Z`)

  return prisma.$transaction(async (tx) => {
    let totalAmount = 0

    for (const row of rows) {
      let customer = await tx.customer.findUnique({ where: { legalName: row.legalName } })
      if (!customer) {
        customer = await tx.customer.create({
          data: {
            legalName: row.legalName,
            billingAddress: row.billingAddress ?? null,
            bin: row.bin ?? null,
            paymentDays: row.paymentDays ?? 30,
          },
        })
        await writeAudit(tx, {
          entity: "CUSTOMER",
          entityId: customer.id,
          action: "CREATE",
          changedBy: actor.sub,
          after: { legalName: customer.legalName },
        })
      }

      await tx.customerOpeningBalance.create({
        data: { customerId: customer.id, amount: row.amount, asOf, importedBy: actor.sub },
      })
      totalAmount += row.amount

      await writeAudit(tx, {
        entity: "CUSTOMER",
        entityId: customer.id,
        action: "IMPORT",
        changedBy: actor.sub,
        after: { openingBalance: row.amount, asOf: env.SALES_GO_LIVE },
      })
    }

    return { customerCount: rows.length, totalAmount }
  })
}

export async function commitCustomerOpeningBalanceImport(
  buffer: Buffer,
  fileName: string,
  actor: AccessTokenPayload
): Promise<{ customerCount: number; totalAmount: number }> {
  return runCommit(buffer, fileName, buildSpec(), (rows) => writeImport(rows, actor))
}
