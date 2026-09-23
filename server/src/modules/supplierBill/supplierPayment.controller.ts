import type { NextFunction, Request, Response } from "express"
import { approveSupplierPayment, matchAdvance } from "./supplierPayment.posting"
import { createSupplierPayment, getSupplierPayment, listSupplierPayments } from "./supplierPayment.service"
import { createSupplierPaymentSchema, matchAdvanceSchema } from "./supplierPayment.validators"

type RequestWithId = Request<{ id: string }>

export async function listSupplierPaymentsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listSupplierPayments())
  } catch (err) {
    return next(err)
  }
}

export async function getSupplierPaymentHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getSupplierPayment(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function createSupplierPaymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createSupplierPaymentSchema.parse(req.body)
    return res.status(201).json(await createSupplierPayment(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function approveSupplierPaymentHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.json(await approveSupplierPayment(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function matchAdvanceHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = matchAdvanceSchema.parse(req.body)
    return res.status(201).json(await matchAdvance(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}
