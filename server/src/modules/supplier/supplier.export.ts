import type { NextFunction, Request, Response } from "express"

import { parseExportFormat, sendExport } from "../../utils/export/export.respond"
import type { ExportSpec } from "../../utils/export/export.types"
import { listSuppliers } from "./supplier.service"

export async function buildSupplierExportSpec(): Promise<ExportSpec> {
  const suppliers = await listSuppliers()
  return {
    title: "Suppliers",
    columns: [
      { header: "name", pdfHeader: "Supplier", type: "text", inPdf: true },
      { header: "contactName", pdfHeader: "Contact", type: "text", inPdf: true },
      { header: "contactPhone", pdfHeader: "Phone", type: "text", inPdf: true },
      { header: "contactEmail", pdfHeader: "Email", type: "text" },
      { header: "bin", pdfHeader: "BIN", type: "text", inPdf: true },
      { header: "paymentDays", pdfHeader: "Payment days", type: "integer", inPdf: true },
      { header: "isActive", pdfHeader: "Active", type: "boolean", inPdf: true },
      { header: "createdAt", pdfHeader: "Added on", type: "date" },
    ],
    rows: suppliers.map((s) => [
      s.name, s.contactName, s.contactPhone, s.contactEmail, s.bin, s.paymentDays, s.isActive, s.createdAt,
    ]),
  }
}

export async function exportSuppliersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const format = parseExportFormat(req.query.format)
    await sendExport({
      res, spec: await buildSupplierExportSpec(), format, baseName: "suppliers", actor: req.user!, list: "SUPPLIERS",
    })
  } catch (err) {
    next(err)
  }
}
