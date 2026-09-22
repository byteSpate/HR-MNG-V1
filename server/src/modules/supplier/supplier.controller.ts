import type { NextFunction, Request, Response } from "express"

import {
  createSupplier,
  deactivateSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
} from "./supplier.service"
import { createSupplierSchema, updateSupplierSchema } from "./supplier.validators"

type RequestWithId = Request<{ id: string }>

export async function listSuppliersHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listSuppliers())
  } catch (err) {
    return next(err)
  }
}

export async function getSupplierHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getSupplier(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function createSupplierHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createSupplierSchema.parse(req.body)
    return res.status(201).json(await createSupplier(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function updateSupplierHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = updateSupplierSchema.parse(req.body)
    return res.json(await updateSupplier(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function deactivateSupplierHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.json(await deactivateSupplier(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}
