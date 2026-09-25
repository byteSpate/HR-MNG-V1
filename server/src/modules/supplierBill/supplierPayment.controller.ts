import type { NextFunction, Request, Response } from "express"
import { reverseSupplierPayment } from "./supplierPayment.posting"
import { createSupplierPayment, getSupplierPayment, listSupplierPayments } from "./supplierPayment.service"
import { createSupplierPaymentSchema, reverseSupplierPaymentSchema } from "./supplierPayment.validators"

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

export async function reverseSupplierPaymentHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = reverseSupplierPaymentSchema.parse(req.body)
    return res.status(200).json(await reverseSupplierPayment(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}
