import type { NextFunction, Request, Response } from "express"
import { approveSupplierBill } from "./supplierBill.posting"
import { getSupplierAgeing, getSupplierControlTieOut } from "./supplierBill.reports"
import {
  createSupplierBill,
  getSupplierBill,
  listBillableOpportunities,
  listSupplierBills,
  updateSupplierBill,
} from "./supplierBill.service"
import { createSupplierBillSchema, updateSupplierBillSchema } from "./supplierBill.validators"

type RequestWithId = Request<{ id: string }>

export async function listSupplierBillsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listSupplierBills())
  } catch (err) {
    return next(err)
  }
}

export async function getSupplierBillHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getSupplierBill(req.params.id))
  } catch (err) {
    return next(err)
  }
}

export async function createSupplierBillHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createSupplierBillSchema.parse(req.body)
    return res.status(201).json(await createSupplierBill(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function updateSupplierBillHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = updateSupplierBillSchema.parse(req.body)
    return res.json(await updateSupplierBill(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function billableOpportunitiesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listBillableOpportunities())
  } catch (err) {
    return next(err)
  }
}

export async function supplierAgeingHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getSupplierAgeing())
  } catch (err) {
    return next(err)
  }
}

export async function supplierTieOutHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getSupplierControlTieOut())
  } catch (err) {
    return next(err)
  }
}

export async function approveSupplierBillHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.json(await approveSupplierBill(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}
