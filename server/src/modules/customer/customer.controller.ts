import type { NextFunction, Request, Response } from "express"

import { createCustomer, getCustomer, listCustomers, updateCustomer } from "./customer.service"
import { createCustomerSchema, updateCustomerSchema } from "./customer.validators"

type RequestWithId = Request<{ id: string }>

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
