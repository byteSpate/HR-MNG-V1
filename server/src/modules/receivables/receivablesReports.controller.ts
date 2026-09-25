import type { NextFunction, Request, Response } from "express"
import { AppError } from "../../middleware/errorHandler"
import { getCustomerAgeing, getCustomerControlTieOut } from "./receivables.reports"
import { getCustomerStatement, renderCustomerStatementPdf } from "./receivables.statement"

export async function customerAgeingHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getCustomerAgeing())
  } catch (err) {
    return next(err)
  }
}

export async function customerTieOutHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getCustomerControlTieOut())
  } catch (err) {
    return next(err)
  }
}

type RequestWithCustomerId = Request<{ id: string }>

function parseRange(query: Request["query"]): { from: Date; to: Date } {
  const from = new Date(String(query.from))
  const to = new Date(String(query.to))
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) {
    throw new AppError(400, "Choose a from date on or before the to date")
  }
  return { from, to }
}

export async function customerStatementHandler(req: RequestWithCustomerId, res: Response, next: NextFunction) {
  try {
    const range = parseRange(req.query)
    return res.status(200).json(await getCustomerStatement(req.params.id, range))
  } catch (err) {
    return next(err)
  }
}

export async function customerStatementPdfHandler(req: RequestWithCustomerId, res: Response, next: NextFunction) {
  try {
    const range = parseRange(req.query)
    const pdf = await renderCustomerStatementPdf(req.params.id, range)
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename="statement-${req.params.id}-${req.query.to}.pdf"`)
    return res.status(200).send(pdf)
  } catch (err) {
    return next(err)
  }
}
