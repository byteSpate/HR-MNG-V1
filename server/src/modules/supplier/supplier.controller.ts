import type { NextFunction, Request, Response } from "express"

import { AppError } from "../../middleware/errorHandler"
import {
  commitSupplierOpeningBalanceImport,
  previewSupplierOpeningBalanceImport,
} from "./supplier.opening-balance.import"
import {
  createSupplier,
  deactivateSupplier,
  getSupplier,
  listSuppliers,
  reactivateSupplier,
  updateSupplier,
} from "./supplier.service"
import { createSupplierSchema, updateSupplierSchema } from "./supplier.validators"

type RequestWithId = Request<{ id: string }>

/** multer puts the parsed file here, matching asset.controller.ts's requireFile. */
function requireFile(req: Request): Express.Multer.File {
  if (!req.file) throw new AppError(400, "No file was uploaded")
  return req.file
}

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

export async function reactivateSupplierHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.json(await reactivateSupplier(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function previewSupplierOpeningBalancesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const file = requireFile(req)
    return res.json(await previewSupplierOpeningBalanceImport(file.buffer, file.originalname))
  } catch (err) {
    return next(err)
  }
}

export async function commitSupplierOpeningBalancesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const file = requireFile(req)
    return res.status(201).json(await commitSupplierOpeningBalanceImport(file.buffer, file.originalname, req.user!))
  } catch (err) {
    return next(err)
  }
}
