import type { NextFunction, Request, Response } from "express"

import {
  approveClaim,
  createClaim,
  getClaim,
  getMyClaims,
  listClaims,
  rejectClaim,
} from "./expense.service"
import {
  approveClaimBody,
  claimQuery,
  createClaimBody,
  rejectClaimBody,
} from "./expense.validators"
import { createExpenseCategory, deleteExpenseCategory, listExpenseCategories, updateExpenseCategory } from "./expense.category.service"
import { deleteReceipt, getReceiptUrl, listReceipts, uploadReceipt } from "./expense.media"
import { getExpenseReport, reportFilename, reportToCsv } from "./expense.report"
import { renderExpenseReportPdf } from "./expense.report.pdf"
import { reportQuery } from "./expense.validators"
import { AppError } from "../../middleware/errorHandler"

type RequestWithId = Request<{ id: string }>

/** multer puts the parsed file here, matching cost.controller.ts's requireFile. */
function requireFile(req: Request): Express.Multer.File {
  if (!req.file) throw new AppError(400, "No file was uploaded")
  return req.file
}

/**
 * Date-range expense reports, in JSON, CSV or PDF. One handler, because the
 * three differ only in how the same report object is serialised.
 *
 * `requireAuth` alone: an employee gets their own claims and Finance can name
 * anybody, and that decision lives in `expense.report.ts` where the caller's
 * employee record is actually known.
 */
export async function getExpenseReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { format, ...query } = reportQuery.parse(req.query)
    const report = await getExpenseReport(req.user!, query)

    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${reportFilename(report, "pdf")}"`)
      return res.status(200).send(await renderExpenseReportPdf(report))
    }

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8")
      res.setHeader("Content-Disposition", `attachment; filename="${reportFilename(report, "csv")}"`)
      // A BOM, so Excel opens the file as UTF-8 — otherwise every Bengali name
      // arrives as mojibake on the Windows machines that will open this.
      return res.status(200).send(`﻿${reportToCsv(report)}`)
    }

    return res.status(200).json(report)
  } catch (err) {
    return next(err)
  }
}

// ── Receipts ────────────────────────────────────────────────────────────

export async function uploadClaimReceiptHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    const file = requireFile(req)
    res.status(201).json(await uploadReceipt(req.params.id, file, req.user!))
  } catch (err) {
    next(err)
  }
}

export async function listClaimReceiptsHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    res.json(await listReceipts(req.params.id, req.user!))
  } catch (err) {
    next(err)
  }
}

export async function getClaimReceiptUrlHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    res.json(await getReceiptUrl(req.params.id, req.user!))
  } catch (err) {
    next(err)
  }
}

export async function deleteClaimReceiptHandler(
  req: RequestWithId,
  res: Response,
  next: NextFunction
) {
  try {
    await deleteReceipt(req.params.id, req.user!)
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

export async function listExpenseCategoriesHandler(_req: Request, res: Response, next: NextFunction) { try { res.json(await listExpenseCategories()) } catch (err) { next(err) } }
export async function createExpenseCategoryHandler(req: Request, res: Response, next: NextFunction) { try { res.status(201).json(await createExpenseCategory(req.body, req.user!)) } catch (err) { next(err) } }
export async function updateExpenseCategoryHandler(req: RequestWithId, res: Response, next: NextFunction) { try { res.json(await updateExpenseCategory(req.params.id, req.body, req.user!)) } catch (err) { next(err) } }
export async function deleteExpenseCategoryHandler(req: RequestWithId, res: Response, next: NextFunction) { try { await deleteExpenseCategory(req.params.id, req.user!); res.status(204).send() } catch (err) { next(err) } }

export async function createClaimHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createClaimBody.parse(req.body)
    return res.status(201).json(await createClaim(req.user!, body))
  } catch (err) {
    return next(err)
  }
}

export async function getMyClaimsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getMyClaims(req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function listClaimsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listClaims(claimQuery.parse(req.query)))
  } catch (err) {
    return next(err)
  }
}

export async function getClaimHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getClaim(req.user!, req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function approveClaimHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = approveClaimBody.parse(req.body ?? {})
    return res.status(200).json(await approveClaim(req.params.id, req.user!.sub, body))
  } catch (err) {
    return next(err)
  }
}

export async function rejectClaimHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = rejectClaimBody.parse(req.body)
    return res.status(200).json(await rejectClaim(req.params.id, req.user!.sub, body))
  } catch (err) {
    return next(err)
  }
}
