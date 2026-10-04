import type { NextFunction, Request, Response } from "express"

import { parseExportFormat, sendExport } from "../../utils/export/export.respond"
import type { ExportSpec } from "../../utils/export/export.types"
import { listCostsQuery, type ListCostsQuery } from "./cost.validators"
import { listCosts } from "./cost.service"

function filterNote(filters: ListCostsQuery): string | undefined {
  const parts: string[] = []
  if (filters.year !== undefined && filters.month !== undefined) parts.push(`Month ${filters.month}/${filters.year}`)
  else if (filters.year !== undefined) parts.push(`Year ${filters.year}`)
  else if (filters.month !== undefined) parts.push(`Month ${filters.month}`)
  if (filters.categoryId) parts.push("One category only")
  if (filters.status) parts.push(`Status: ${filters.status}`)
  return parts.length > 0 ? parts.join(", ") : undefined
}

export async function buildCostExportSpec(filters: ListCostsQuery): Promise<ExportSpec> {
  const bills = await listCosts(filters)
  return {
    title: "Operating costs",
    filterNote: filterNote(filters),
    columns: [
      { header: "categoryCode", pdfHeader: "Category", type: "text", inPdf: true },
      { header: "label", pdfHeader: "Bill", type: "text", inPdf: true },
      { header: "payee", pdfHeader: "Payee", type: "text", inPdf: true },
      { header: "periodMonth", pdfHeader: "Month", type: "integer", inPdf: true },
      { header: "periodYear", pdfHeader: "Year", type: "integer", inPdf: true },
      { header: "amount", pdfHeader: "Amount", type: "decimal", inPdf: true },
      { header: "currency", pdfHeader: "Currency", type: "text", inPdf: true },
      { header: "dueDate", pdfHeader: "Due", type: "date" },
      { header: "paidAt", pdfHeader: "Paid on", type: "date" },
      { header: "paymentRef", pdfHeader: "Payment reference", type: "text" },
      { header: "notes", pdfHeader: "Notes", type: "text" },
      { header: "status", pdfHeader: "Status", type: "text", inPdf: true },
      { header: "isOverdue", pdfHeader: "Overdue", type: "boolean", inPdf: true },
    ],
    rows: bills.map((b) => [
      b.category.code,
      b.label,
      b.payee,
      b.periodMonth,
      b.periodYear,
      Number(b.amount.toString()),
      b.currency,
      b.dueDate,
      b.paidAt,
      b.paymentRef,
      b.notes,
      b.status,
      b.isOverdue,
    ]),
  }
}

export async function exportCostsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const format = parseExportFormat(req.query.format)
    const filters = listCostsQuery.parse(req.query)
    await sendExport({
      res,
      spec: await buildCostExportSpec(filters),
      format,
      baseName: "operating-costs",
      actor: req.user!,
      list: "COSTS",
      filter: filters,
    })
  } catch (err) {
    next(err)
  }
}
