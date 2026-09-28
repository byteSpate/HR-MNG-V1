import type { NextFunction, Request, Response } from "express"
import { createVatCode, listVatCodes, updateVatCode } from "./vatCode.service"
import { createVatCodeSchema, updateVatCodeSchema } from "./vatCode.validators"

type RequestWithId = Request<{ id: string }>

export async function listVatCodesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listVatCodes({ all: req.query.all === "true" }))
  } catch (err) {
    return next(err)
  }
}

export async function createVatCodeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createVatCodeSchema.parse(req.body)
    return res.status(201).json(await createVatCode(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function updateVatCodeHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = updateVatCodeSchema.parse(req.body)
    return res.status(200).json(await updateVatCode(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}
