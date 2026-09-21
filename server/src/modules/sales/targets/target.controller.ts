import type { NextFunction, Request, Response } from "express"

import { getTargetYearSchema, setSalesTargetSchema } from "./target.validators"
import { getTargetYear, setSalesTarget } from "./target.service"

export async function getTargetYearHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = getTargetYearSchema.parse(req.query)
    return res.status(200).json(await getTargetYear(query, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setSalesTargetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = setSalesTargetSchema.parse(req.body)
    return res.status(200).json(await setSalesTarget(body, req.user!))
  } catch (err) {
    return next(err)
  }
}
