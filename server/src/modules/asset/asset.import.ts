/**
 * The register importer.
 *
 * Thin by design: the parsing, the per-row report and the all-or-nothing
 * transaction all live in `src/utils/import/`, shared with operating costs
 * and historical expenses. This file supplies three things — a column spec, a
 * row validator and a writer.
 *
 * **The import must carry current custody, or the register is worse than
 * useless.** Without `assignedToEmployeeCode`, day one of go-live reports
 * every laptop as available and the first thing HR does is hand out one that
 * is already on somebody's desk. An imported assignment gets `assignedBy` set
 * to the importing user, `acknowledgedAt: null` and an `IMPORT` audit row, so
 * migrated custody is visibly migrated rather than passing as a witnessed
 * handover.
 */

import prisma from "../../config/prisma"
import type { AccessTokenPayload } from "../auth/auth.types"
import { emitEvent } from "../event/event.emit"
import { dec } from "../payroll/payroll.money"
import { writeAudit } from "../../utils/audit"
import { runCommit, runPreview } from "../../utils/import/import.run"
import type { ColumnSpec, ImportPreview, RowIssue } from "../../utils/import/import.types"
import type { ImportSpec } from "../../utils/import/import.run"
import type { ParsedRow } from "../../utils/import/import.types"
import type { SampleRow } from "../../utils/import/import.template"
import { nextAssetTag } from "./asset.service"
import { assetImportedEvent } from "./asset.events"

export const ASSET_IMPORT_COLUMNS: ColumnSpec[] = [
  {
    header: "assetTag",
    required: false,
    uniqueInFile: true,
    type: "text",
    description: "The asset tag, like BS-AST-0042. Leave it blank and the system makes one. It must not already be in use.",
    example: "BS-AST-0101",
  },
  {
    header: "categoryCode",
    required: true,
    type: "text",
    description: "The code of an asset category, like LAPTOP. The category must already exist in Asset categories.",
    example: "LAPTOP",
  },
  { header: "name", required: true, type: "text", description: "What the asset is called.", example: "Dell Latitude 5440" },
  {
    header: "serialNumber",
    required: false,
    uniqueInFile: true,
    type: "text",
    description:
      "The maker's serial number. It is required for categories that track serial numbers. It must be different for every asset.",
    example: "SN-0001",
  },
  { header: "model", required: false, type: "text", description: "The model name.", example: "Latitude 5440" },
  { header: "purchaseDate", required: false, type: "date", description: "The day it was bought, written YYYY-MM-DD.", example: "2026-01-15" },
  {
    header: "purchaseCost",
    required: false,
    type: "decimal",
    description: "The price paid, as a number with no currency sign, like 95000 or 95000.50.",
    example: "95000",
  },
  { header: "currency", required: false, type: "choice", allowed: ["BDT", "USD"], description: "The currency of the price. Leave blank for BDT.", example: "BDT" },
  { header: "vendor", required: false, type: "text", description: "The company it was bought from.", example: "Star Tech Ltd" },
  { header: "warrantyExpiry", required: false, type: "date", description: "The last day of the warranty, written YYYY-MM-DD.", example: "2029-01-14" },
  {
    header: "departmentName",
    required: false,
    type: "text",
    description: "The department that has the asset. If the name is not in the system yet, the system adds that department.",
    example: "Finance",
  },
  { header: "location", required: false, type: "text", description: "Where the asset is kept.", example: "Head office" },
  { header: "notes", required: false, type: "text", description: "Any other note.", example: "" },
  {
    header: "assignedToEmployeeCode",
    required: false,
    type: "text",
    description:
      "The employee code of the person who holds the asset now. Fill assignedAt too. The employee must be active.",
    example: "E-001",
  },
  {
    header: "assignedAt",
    required: false,
    type: "date",
    description: "The day that person got the asset, written YYYY-MM-DD. It cannot be in the future.",
    example: "2026-02-01",
  },
  {
    header: "conditionOut",
    required: false,
    type: "choice",
    allowed: ["NEW", "GOOD", "FAIR", "DAMAGED"],
    description: "The condition of the asset when it was handed over.",
    example: "GOOD",
  },
]

/** Two rows that pass the importer's own checks when the categories LAPTOP and CHAIR and the department Finance exist. */
export function assetImportSampleRows(_today: Date): SampleRow[] {
  return [
    {
      assetTag: "", categoryCode: "LAPTOP", name: "Dell Latitude 5440", serialNumber: "SN-0001", model: "Latitude 5440",
      purchaseDate: "2026-01-15", purchaseCost: "95000", currency: "BDT", vendor: "Star Tech Ltd", warrantyExpiry: "2029-01-14",
      departmentName: "Finance", location: "Head office", notes: "", assignedToEmployeeCode: "", assignedAt: "", conditionOut: "",
    },
    {
      assetTag: "", categoryCode: "CHAIR", name: "Office chair", serialNumber: "", model: "",
      purchaseDate: "2026-02-10", purchaseCost: "12000", currency: "BDT", vendor: "", warrantyExpiry: "",
      departmentName: "Finance", location: "Head office", notes: "", assignedToEmployeeCode: "", assignedAt: "", conditionOut: "",
    },
  ]
}

const CONDITIONS = ["NEW", "GOOD", "FAIR", "DAMAGED"] as const
const CURRENCIES = ["BDT", "USD"] as const
type ImportCondition = (typeof CONDITIONS)[number]
type ImportCurrency = (typeof CURRENCIES)[number]

interface AssetImportRow {
  rowNumber: number
  assetTag?: string
  categoryId: string
  name: string
  serialNumber?: string
  model?: string
  purchaseDate?: string
  purchaseCost?: number
  currency?: ImportCurrency
  vendor?: string
  warrantyExpiry?: string
  /** Resolved against an existing department. */
  departmentId?: string
  /** Set instead of `departmentId` when the name did not resolve — created
   *  at commit, the user's explicit confirmation. */
  departmentName?: string
  location?: string
  notes?: string
  assignedToEmployeeId?: string
  assignedAt?: string
  conditionOut?: ImportCondition
}

interface ImportContext {
  categoriesByCode: Map<string, { id: string; name: string; requiresSerial: boolean }>
  employeesByCode: Map<string, { id: string }>
  departmentsByName: Map<string, string>
}

async function loadImportContext(): Promise<ImportContext> {
  const [categories, employees, departments] = await Promise.all([
    prisma.assetCategory.findMany(),
    // Only ACTIVE employees can receive custody — a resigned or terminated
    // employee's code resolves to nobody, exactly like an unknown one.
    prisma.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      select: { id: true, employeeCode: true },
    }),
    prisma.department.findMany({ select: { id: true, name: true } }),
  ])

  return {
    categoriesByCode: new Map(categories.map((c) => [c.code.toUpperCase(), c])),
    employeesByCode: new Map(employees.map((e) => [e.employeeCode.toUpperCase(), e])),
    departmentsByName: new Map(departments.map((d) => [d.name.toLowerCase(), d.id])),
  }
}

/** Strict YYYY-MM-DD, matching every other date column in this codebase. */
function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function makeValidateRow(ctx: ImportContext) {
  return (
    row: ParsedRow
  ): { ok: true; value: AssetImportRow } | { ok: false; issues: RowIssue[] } => {
    const issues: RowIssue[] = []
    const cell = (key: string) => (row.values[key] ?? "").trim()
    const flag = (column: string, message: string) =>
      issues.push({ rowNumber: row.rowNumber, column, message })

    const categoryCodeRaw = cell("categorycode")
    const category = ctx.categoriesByCode.get(categoryCodeRaw.toUpperCase())
    if (!category) {
      flag("categoryCode", `Unknown category code "${categoryCodeRaw}"`)
    }

    const serialNumber = cell("serialnumber") || undefined
    if (category && category.requiresSerial && !serialNumber) {
      flag("serialNumber", `A serial number is required for ${category.name}`)
    }

    let purchaseCost: number | undefined
    const purchaseCostRaw = cell("purchasecost")
    if (purchaseCostRaw) {
      const n = Number(purchaseCostRaw)
      if (Number.isNaN(n) || n < 0) flag("purchaseCost", "purchaseCost must be a non-negative number")
      else purchaseCost = n
    }

    let currency: ImportCurrency | undefined
    const currencyRaw = cell("currency").toUpperCase()
    if (currencyRaw) {
      if (!(CURRENCIES as readonly string[]).includes(currencyRaw)) {
        flag("currency", `Unknown currency "${currencyRaw}"`)
      } else {
        currency = currencyRaw as ImportCurrency
      }
    }

    let conditionOut: ImportCondition | undefined
    const conditionRaw = cell("conditionout").toUpperCase()
    if (conditionRaw) {
      if (!(CONDITIONS as readonly string[]).includes(conditionRaw)) {
        flag("conditionOut", `Unknown condition "${conditionRaw}"`)
      } else {
        conditionOut = conditionRaw as ImportCondition
      }
    }

    let purchaseDate: string | undefined
    const purchaseDateRaw = cell("purchasedate")
    if (purchaseDateRaw) {
      if (!parseIsoDate(purchaseDateRaw)) flag("purchaseDate", "Expected a YYYY-MM-DD date")
      else purchaseDate = purchaseDateRaw
    }

    let warrantyExpiry: string | undefined
    const warrantyExpiryRaw = cell("warrantyexpiry")
    if (warrantyExpiryRaw) {
      if (!parseIsoDate(warrantyExpiryRaw)) flag("warrantyExpiry", "Expected a YYYY-MM-DD date")
      else warrantyExpiry = warrantyExpiryRaw
    }

    let departmentId: string | undefined
    let departmentName: string | undefined
    const departmentNameRaw = cell("departmentname")
    if (departmentNameRaw) {
      const existing = ctx.departmentsByName.get(departmentNameRaw.toLowerCase())
      if (existing) departmentId = existing
      // Not resolving is not an error: reported in the preview summary as
      // departmentsToCreate, and created at commit.
      else departmentName = departmentNameRaw
    }

    let assignedToEmployeeId: string | undefined
    let assignedAt: string | undefined
    const employeeCodeRaw = cell("assignedtoemployeecode")
    const assignedAtRaw = cell("assignedat")

    if (employeeCodeRaw && !assignedAtRaw) {
      flag("assignedAt", "assignedAt is required when assignedToEmployeeCode is set")
    } else if (assignedAtRaw && !employeeCodeRaw) {
      flag("assignedToEmployeeCode", "assignedToEmployeeCode is required when assignedAt is set")
    } else if (employeeCodeRaw && assignedAtRaw) {
      const employee = ctx.employeesByCode.get(employeeCodeRaw.toUpperCase())
      if (!employee) {
        flag("assignedToEmployeeCode", `Unknown or inactive employee code "${employeeCodeRaw}"`)
      } else {
        assignedToEmployeeId = employee.id
      }

      const parsedAssignedAt = parseIsoDate(assignedAtRaw)
      if (!parsedAssignedAt) {
        flag("assignedAt", "Expected a YYYY-MM-DD date")
      } else if (parsedAssignedAt.getTime() > Date.now()) {
        flag("assignedAt", "assignedAt cannot be in the future")
      } else if (purchaseDate && parsedAssignedAt.getTime() < new Date(`${purchaseDate}T00:00:00.000Z`).getTime()) {
        flag("assignedAt", "assignedAt cannot be before purchaseDate")
      } else {
        assignedAt = assignedAtRaw
      }
    }

    if (issues.length > 0) return { ok: false, issues }

    return {
      ok: true,
      value: {
        rowNumber: row.rowNumber,
        assetTag: cell("assettag") || undefined,
        // Safe: any unresolved category already returned above.
        categoryId: category!.id,
        name: cell("name"),
        serialNumber,
        model: cell("model") || undefined,
        purchaseDate,
        purchaseCost,
        currency,
        vendor: cell("vendor") || undefined,
        warrantyExpiry,
        departmentId,
        departmentName,
        location: cell("location") || undefined,
        notes: cell("notes") || undefined,
        assignedToEmployeeId,
        assignedAt,
        conditionOut,
      },
    }
  }
}

/** Cross-row and database checks the row-by-row pass cannot see: an asset tag
 *  or serial that already exists is a duplicate whether or not it repeats
 *  inside this file. */
async function validateAllRows(rows: AssetImportRow[]): Promise<RowIssue[]> {
  const tags = rows.map((r) => r.assetTag).filter((t): t is string => Boolean(t))
  const serials = rows.map((r) => r.serialNumber).filter((s): s is string => Boolean(s))
  if (tags.length === 0 && serials.length === 0) return []

  const existing = await prisma.asset.findMany({
    where: {
      OR: [
        ...(tags.length ? [{ assetTag: { in: tags } }] : []),
        ...(serials.length ? [{ serialNumber: { in: serials } }] : []),
      ],
    },
    select: { assetTag: true, serialNumber: true },
  })
  const existingTags = new Set(existing.map((a) => a.assetTag))
  const existingSerials = new Set(existing.map((a) => a.serialNumber).filter((s): s is string => Boolean(s)))

  const issues: RowIssue[] = []
  for (const row of rows) {
    if (row.assetTag && existingTags.has(row.assetTag)) {
      issues.push({
        rowNumber: row.rowNumber,
        column: "assetTag",
        message: `Asset tag "${row.assetTag}" already exists`,
      })
    }
    if (row.serialNumber && existingSerials.has(row.serialNumber)) {
      issues.push({
        rowNumber: row.rowNumber,
        column: "serialNumber",
        message: `Serial number "${row.serialNumber}" already exists`,
      })
    }
  }
  return issues
}

function summariseRows(rows: AssetImportRow[]): Record<string, number> {
  const assignments = rows.filter((r) => r.assignedToEmployeeId).length
  const departmentsToCreate = new Set(
    rows.filter((r) => r.departmentName).map((r) => (r.departmentName as string).toLowerCase())
  ).size
  return { assets: rows.length, assignments, departmentsToCreate }
}

function buildSpec(ctx: ImportContext): ImportSpec<AssetImportRow> {
  return {
    columns: ASSET_IMPORT_COLUMNS,
    validateRow: makeValidateRow(ctx),
    validateAll: validateAllRows,
    summarise: summariseRows,
  }
}

export async function previewAssetImport(
  buffer: Buffer,
  fileName: string
): Promise<ImportPreview<AssetImportRow>> {
  const ctx = await loadImportContext()
  return runPreview(buffer, fileName, buildSpec(ctx))
}

/**
 * Two passes inside one transaction: every `Asset` first, then every
 * `AssetAssignment` — a referenced row routinely appears below the row
 * referencing it, so assignments cannot be created in the same pass.
 */
async function writeImport(
  rows: AssetImportRow[],
  actor: AccessTokenPayload
): Promise<{ assetCount: number; assignmentCount: number }> {
  return prisma.$transaction(async (tx) => {
    // Bump the counter past the highest explicitly imported tag BEFORE
    // generating any auto tag in this same transaction, so an auto-generated
    // tag can never collide with an explicit one from the same file.
    const maxImportedTag = rows.reduce((max, r) => {
      const match = r.assetTag?.match(/^BS-AST-(\d+)$/i)
      return match ? Math.max(max, Number(match[1])) : max
    }, 0)
    if (maxImportedTag > 0) {
      const current = await tx.idCounter.findUnique({ where: { id: "AST" } })
      const next = Math.max(current?.value ?? 0, maxImportedTag)
      await tx.idCounter.upsert({
        where: { id: "AST" },
        update: { value: next },
        create: { id: "AST", value: next },
      })
    }

    // Departments referenced by name but not already in the database are
    // created here — the commit itself is the user's explicit confirmation,
    // not a second prompt.
    const createdDepartments = new Map<string, string>()
    async function departmentIdFor(name: string): Promise<string> {
      const key = name.toLowerCase()
      const cached = createdDepartments.get(key)
      if (cached) return cached
      const created = await tx.department.create({ data: { name } })
      createdDepartments.set(key, created.id)
      return created.id
    }

    // Pass 1: every Asset, in file order.
    const createdAssets: { id: string; assetTag: string }[] = []
    for (const row of rows) {
      const departmentId = row.departmentId
        ? row.departmentId
        : row.departmentName
          ? await departmentIdFor(row.departmentName)
          : null

      const assetTag = row.assetTag ?? (await nextAssetTag(tx))

      const asset = await tx.asset.create({
        data: {
          assetTag,
          categoryId: row.categoryId,
          name: row.name,
          serialNumber: row.serialNumber ?? null,
          model: row.model ?? null,
          notes: row.notes ?? null,
          purchaseDate: row.purchaseDate ? new Date(`${row.purchaseDate}T00:00:00.000Z`) : null,
          purchaseCost: row.purchaseCost !== undefined ? dec(row.purchaseCost) : null,
          currency: row.currency ?? "BDT",
          vendor: row.vendor ?? null,
          warrantyExpiry: row.warrantyExpiry
            ? new Date(`${row.warrantyExpiry}T00:00:00.000Z`)
            : null,
          departmentId,
          location: row.location ?? null,
        },
      })

      await writeAudit(tx, {
        entity: "ASSET",
        entityId: asset.id,
        action: "IMPORT",
        changedBy: actor.sub,
        after: { assetTag: asset.assetTag, name: row.name, categoryId: row.categoryId },
      })

      createdAssets.push({ id: asset.id, assetTag: asset.assetTag })
    }

    // Pass 2: assignments, now that every referenced asset row exists.
    let assignmentCount = 0
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      if (!row.assignedToEmployeeId || !row.assignedAt) continue

      const asset = createdAssets[i]
      const assignment = await tx.assetAssignment.create({
        data: {
          assetId: asset.id,
          employeeId: row.assignedToEmployeeId,
          assignedAt: new Date(`${row.assignedAt}T00:00:00.000Z`),
          assignedBy: actor.sub,
          conditionOut: row.conditionOut ?? "GOOD",
          issueNote: null,
          // A migrated custody record is visibly migrated rather than
          // passing as a witnessed handover.
          acknowledgedAt: null,
        },
      })

      await writeAudit(tx, {
        entity: "ASSET_ASSIGNMENT",
        entityId: assignment.id,
        action: "IMPORT",
        changedBy: actor.sub,
        after: { assetId: asset.id, employeeId: row.assignedToEmployeeId },
      })

      assignmentCount += 1
    }

    // Exactly one event for the whole file, never one per row.
    await emitEvent(
      tx,
      assetImportedEvent({
        assetCount: createdAssets.length,
        assignmentCount,
        actorUserId: actor.sub,
      })
    )

    return { assetCount: createdAssets.length, assignmentCount }
  })
}

export async function commitAssetImport(
  buffer: Buffer,
  fileName: string,
  actor: AccessTokenPayload
): Promise<{ assetCount: number; assignmentCount: number }> {
  const ctx = await loadImportContext()
  return runCommit(buffer, fileName, buildSpec(ctx), (rows) => writeImport(rows, actor))
}
