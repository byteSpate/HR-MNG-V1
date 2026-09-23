import type { NextFunction, Request, Response } from "express"
import { createInvoice, getInvoice, listInvoiceablePos, listInvoices, updateInvoice } from "./invoice.service"
import { approveInvoice } from "./invoice.posting"
import { createInvoiceSchema, updateInvoiceSchema } from "./invoice.validators"

type RequestWithId = Request<{ id: string }>

export async function listInvoicesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, customerId } = req.query as { status?: "DRAFT" | "APPROVED"; customerId?: string }
    return res.status(200).json(await listInvoices({ status, customerId }))
  } catch (err) {
    return next(err)
  }
}

export async function listInvoiceablePosHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listInvoiceablePos())
  } catch (err) {
    return next(err)
  }
}

export async function getInvoiceHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getInvoice(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function createInvoiceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createInvoiceSchema.parse(req.body)
    return res.status(201).json(await createInvoice(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function updateInvoiceHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = updateInvoiceSchema.parse(req.body)
    return res.status(200).json(await updateInvoice(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function approveInvoiceHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await approveInvoice(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}
