import type { NextFunction, Request, Response } from "express"

import { listDispatches } from "./notification.service"
import { dispatchQuerySchema } from "./notification.validators"

export async function listDispatchesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = dispatchQuerySchema.parse(req.query)
    return res.status(200).json(await listDispatches(query))
  } catch (err) {
    return next(err)
  }
}
