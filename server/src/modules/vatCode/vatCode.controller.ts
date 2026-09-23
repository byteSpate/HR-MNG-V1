import type { NextFunction, Request, Response } from "express"
import { listVatCodes } from "./vatCode.service"

export async function listVatCodesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listVatCodes())
  } catch (err) {
    return next(err)
  }
}
