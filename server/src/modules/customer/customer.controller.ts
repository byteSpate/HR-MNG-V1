import type { NextFunction, Request, Response } from "express"

import { AppError } from "../../middleware/errorHandler"
import {
  commitCustomerOpeningBalanceImport,
  previewCustomerOpeningBalanceImport,
} from "./customer.opening-balance.import"
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "./customer.service"
import { createCustomerSchema, updateCustomerSchema } from "./customer.validators"

type RequestWithId = Request<{ id: string }>

/** multer puts the parsed file here, matching asset.controller.ts's requireFile. */
function requireFile(req: Request): Express.Multer.File {
  if (!req.file) throw new AppError(400, "No file was uploaded")
  return req.file
}

export async function listCustomersHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listCustomers())
  } catch (err) {
    return next(err)
  }
}

export async function getCustomerHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getCustomer(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function createCustomerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createCustomerSchema.parse(req.body)
    return res.status(201).json(await createCustomer(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function updateCustomerHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = updateCustomerSchema.parse(req.body)
    return res.json(await updateCustomer(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function previewCustomerOpeningBalancesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const file = requireFile(req)
    return res.json(await previewCustomerOpeningBalanceImport(file.buffer, file.originalname))
  } catch (err) {
    return next(err)
  }
}

export async function commitCustomerOpeningBalancesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const file = requireFile(req)
    return res.status(201).json(await commitCustomerOpeningBalanceImport(file.buffer, file.originalname, req.user!))
  } catch (err) {
    return next(err)
  }
}
