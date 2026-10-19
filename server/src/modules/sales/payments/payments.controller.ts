import type { NextFunction, Request, Response } from "express"

import { parse } from "../heatmap/heatmap.controller"
import { listPayments } from "./payments.service"
import { listPaymentsQuerySchema } from "./payments.validators"

export async function listPaymentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listPayments(parse(listPaymentsQuerySchema, req.query)))
  } catch (err) {
    return next(err)
  }
}
