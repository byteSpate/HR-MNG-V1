import type { NextFunction, Request, Response } from "express"

import { parseExportFormat, sendExport } from "../../../utils/export/export.respond"
import type { ExportSpec } from "../../../utils/export/export.types"
import { officeToday } from "../../attendance/attendance.time"
import { parse } from "../heatmap/heatmap.controller"
import { listPayments } from "./payments.service"
import { listPaymentsQuerySchema, type ListPaymentsQuery } from "./payments.validators"

const STATUS_WORD = { PAID: "Paid", PART_PAID: "Part paid", UNPAID: "Unpaid", OVERDUE: "Overdue" } as const

/** A Payments table as a file: the same rows the page shows. */
export async function buildPaymentsExportSpec(query: ListPaymentsQuery, today: Date = officeToday()): Promise<ExportSpec> {
  const { rows } = await listPayments(query, today)
  const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
  return {
    title: "Payments",
    filterNote: query.open ? "Open invoices only" : undefined,
    columns: [
      { header: "Invoice", type: "text", inPdf: true },
      { header: "Invoice date", type: "date", inPdf: true },
      { header: "Due date", type: "date", inPdf: true },
      { header: "Account", type: "text", inPdf: true },
      { header: "Opportunity", type: "text", inPdf: true },
      { header: "Invoice total", type: "decimal", inPdf: true },
      { header: "Received", type: "decimal", inPdf: true },
      { header: "% paid", type: "decimal", decimals: 1, inPdf: true },
      { header: "Balance", type: "decimal", inPdf: true },
      { header: "Status", type: "text", inPdf: true },
    ],
    rows: rows.map((r) => [
      r.invoiceNumber, at(r.date), at(r.dueDate), r.accountName, r.opportunityName,
      Number(r.invoiceTotal), Number(r.received), r.percentPaid, Number(r.balance), STATUS_WORD[r.status],
    ]),
  }
}

export async function exportPaymentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const format = parseExportFormat(req.query.format)
    const query = parse(listPaymentsQuerySchema, req.query)
    await sendExport({
      res, spec: await buildPaymentsExportSpec(query), format, baseName: "payments",
      actor: req.user!, list: "SALES_PAYMENTS", filter: { ...query },
    })
  } catch (err) {
    next(err)
  }
}
