import type { NextFunction, Request, Response } from "express"

import {
  createSupplier,
  deactivateSupplier,
  getSupplier,
  listSuppliers,
  reactivateSupplier,
  updateSupplier,
} from "./supplier.service"
import { findSimilarSuppliers, listSupplierOptions, quickAddSupplier } from "./supplier.quick"
import { createSupplierSchema, quickAddSupplierSchema, updateSupplierSchema } from "./supplier.validators"

type RequestWithId = Request<{ id: string }>

export async function listSuppliersHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listSuppliers())
  } catch (err) {
    return next(err)
  }
}

export async function quickAddSupplierHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = quickAddSupplierSchema.parse(req.body)
    return res.status(201).json(await quickAddSupplier(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function findSimilarSuppliersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await findSimilarSuppliers(String(req.query.q ?? "")))
  } catch (err) {
    return next(err)
  }
}

export async function listSupplierOptionsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listSupplierOptions())
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

export async function reactivateSupplierHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.json(await reactivateSupplier(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}
