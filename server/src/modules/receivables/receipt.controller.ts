import type { NextFunction, Request, Response } from "express"
import { AppError } from "../../middleware/errorHandler"
import { createReceipt, getReceipt, listReceipts, updateReceiptCertificates } from "./receipt.service"
import { approveReceipt } from "./receipt.posting"
import { certificatesSchema, createReceiptSchema } from "./receipt.validators"

type RequestWithId = Request<{ id: string }>

export async function listReceiptsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, certificates } = req.query as { status?: "DRAFT" | "APPROVED"; certificates?: string }
    if (certificates !== undefined && certificates !== "missing") {
      throw new AppError(400, "certificates must be 'missing'")
    }
    return res.status(200).json(await listReceipts({ status, certificates: certificates as "missing" | undefined }))
  } catch (err) {
    return next(err)
  }
}

export async function getReceiptHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getReceipt(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function createReceiptHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createReceiptSchema.parse(req.body)
    return res.status(201).json(await createReceipt(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function updateReceiptCertificatesHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = certificatesSchema.parse(req.body)
    return res.status(200).json(await updateReceiptCertificates(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function approveReceiptHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await approveReceipt(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}
