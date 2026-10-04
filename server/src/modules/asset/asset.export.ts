import type { NextFunction, Request, Response } from "express"

import { parseExportFormat, sendExport } from "../../utils/export/export.respond"
import type { ExportSpec } from "../../utils/export/export.types"
import type { AccessTokenPayload } from "../auth/auth.types"
import { listAssets } from "./asset.service"
import { listAssetsQuery, type ListAssetsQuery } from "./asset.validators"

function filterNote(filters: ListAssetsQuery): string | undefined {
  const parts: string[] = []
  if (filters.status) parts.push(`Status: ${filters.status}`)
  if (filters.categoryId) parts.push("One category only")
  if (filters.departmentId) parts.push("One department only")
  if (filters.q) parts.push(`Search: "${filters.q}"`)
  return parts.length > 0 ? parts.join(", ") : undefined
}

/** Cost and vendor are blank for a role that cannot see them (`listAssets` removes them). */
const money = (value: { toString(): string } | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value.toString())

export async function buildAssetExportSpec(viewer: AccessTokenPayload, filters: ListAssetsQuery): Promise<ExportSpec> {
  const assets = await listAssets(viewer, filters)
  return {
    title: "Asset register",
    filterNote: filterNote(filters),
    columns: [
      { header: "assetTag", pdfHeader: "Tag", type: "text", inPdf: true },
      { header: "categoryCode", pdfHeader: "Category", type: "text", inPdf: true },
      { header: "name", pdfHeader: "Name", type: "text", inPdf: true },
      { header: "serialNumber", pdfHeader: "Serial number", type: "text", inPdf: true },
      { header: "model", pdfHeader: "Model", type: "text" },
      { header: "purchaseDate", pdfHeader: "Bought on", type: "date" },
      { header: "purchaseCost", pdfHeader: "Cost", type: "decimal" },
      { header: "currency", pdfHeader: "Currency", type: "text" },
      { header: "vendor", pdfHeader: "Vendor", type: "text" },
      { header: "warrantyExpiry", pdfHeader: "Warranty ends", type: "date" },
      { header: "location", pdfHeader: "Location", type: "text", inPdf: true },
      { header: "notes", pdfHeader: "Notes", type: "text" },
      { header: "status", pdfHeader: "Status", type: "text", inPdf: true },
      { header: "assignedToEmployeeCode", pdfHeader: "Holder code", type: "text" },
      { header: "assignedAt", pdfHeader: "Held since", type: "date" },
      { header: "holder", pdfHeader: "Held by", type: "text", inPdf: true },
    ],
    rows: assets.map((a) => [
      a.assetTag,
      a.category.code,
      a.name,
      a.serialNumber,
      a.model,
      a.purchaseDate,
      money(a.purchaseCost),
      a.currency,
      a.vendor ?? null,
      a.warrantyExpiry,
      a.location,
      a.notes,
      a.status,
      a.heldBy?.employeeCode ?? null,
      a.heldBy?.assignedAt ?? null,
      a.heldBy?.fullName ?? null,
    ]),
  }
}

export async function exportAssetsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const format = parseExportFormat(req.query.format)
    const filters = listAssetsQuery.parse(req.query)
    await sendExport({
      res,
      spec: await buildAssetExportSpec(req.user!, filters),
      format,
      baseName: "assets",
      actor: req.user!,
      list: "ASSETS",
      filter: filters,
    })
  } catch (err) {
    next(err)
  }
}
