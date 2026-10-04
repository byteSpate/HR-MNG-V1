import type { NextFunction, Request, Response } from "express"

import { parseExportFormat, sendExport } from "../../utils/export/export.respond"
import type { ExportSpec } from "../../utils/export/export.types"
import { listVatCodes } from "./vatCode.service"

export async function buildVatCodeExportSpec(): Promise<ExportSpec> {
  // Every code, including turned-off ones: an old document may still use them.
  const codes = await listVatCodes({ all: true })
  return {
    title: "VAT codes",
    columns: [
      { header: "code", pdfHeader: "Code", type: "text", inPdf: true },
      { header: "name", pdfHeader: "Name", type: "text", inPdf: true },
      { header: "ratePercent", pdfHeader: "Rate (%)", type: "decimal", inPdf: true },
      { header: "isActive", pdfHeader: "Active", type: "boolean", inPdf: true },
    ],
    rows: codes.map((c) => [c.code, c.name, Number(c.ratePercent.toString()), c.isActive]),
  }
}

export async function exportVatCodesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const format = parseExportFormat(req.query.format)
    await sendExport({
      res, spec: await buildVatCodeExportSpec(), format, baseName: "vat-codes", actor: req.user!, list: "VAT_CODES",
    })
  } catch (err) {
    next(err)
  }
}
