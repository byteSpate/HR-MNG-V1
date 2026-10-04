import type { NextFunction, Request, Response } from "express"

import { parseExportFormat, sendExport } from "../../utils/export/export.respond"
import type { ExportSpec } from "../../utils/export/export.types"
import { listCustomers } from "./customer.service"

export async function buildCustomerExportSpec(): Promise<ExportSpec> {
  const customers = await listCustomers()
  return {
    title: "Customers",
    columns: [
      { header: "legalName", pdfHeader: "Legal name", type: "text", inPdf: true },
      { header: "billingAddress", pdfHeader: "Billing address", type: "text", inPdf: true },
      { header: "bin", pdfHeader: "BIN", type: "text", inPdf: true },
      { header: "paymentDays", pdfHeader: "Payment days", type: "integer", inPdf: true },
      { header: "linkedToSalesAccount", pdfHeader: "From Sales", type: "boolean", inPdf: true },
      { header: "createdAt", pdfHeader: "Added on", type: "date" },
    ],
    rows: customers.map((c) => [
      c.legalName, c.billingAddress, c.bin, c.paymentDays, c.salesAccountId !== null, c.createdAt,
    ]),
  }
}

export async function exportCustomersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const format = parseExportFormat(req.query.format)
    await sendExport({
      res, spec: await buildCustomerExportSpec(), format, baseName: "customers", actor: req.user!, list: "CUSTOMERS",
    })
  } catch (err) {
    next(err)
  }
}
