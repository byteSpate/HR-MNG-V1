import type { NextFunction, Request, Response } from "express"
import {
  cancelCustomerPo,
  createCustomerPo,
  getCustomerPo,
  listCustomerPos,
  prefillPoLines,
  updateCustomerPo,
} from "./customerPo.service"
import { cancelCustomerPoSchema, createCustomerPoSchema, updateCustomerPoSchema } from "./customerPo.validators"

type RequestWithId = Request<{ id: string }>

export async function listCustomerPosHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { opportunityId, status } = req.query as { opportunityId?: string; status?: "OPEN" | "COMPLETE" | "CANCELLED" }
    return res.status(200).json(await listCustomerPos({ opportunityId, status }, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function prefillPoLinesHandler(req: Request<{ opportunityId: string }>, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await prefillPoLines(req.params.opportunityId, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getCustomerPoHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getCustomerPo(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function createCustomerPoHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createCustomerPoSchema.parse(req.body)
    return res.status(201).json(await createCustomerPo(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function updateCustomerPoHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = updateCustomerPoSchema.parse(req.body)
    return res.status(200).json(await updateCustomerPo(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function cancelCustomerPoHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = cancelCustomerPoSchema.parse(req.body)
    return res.status(200).json(await cancelCustomerPo(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}
