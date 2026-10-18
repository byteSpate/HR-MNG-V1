import type { NextFunction, Request, Response } from "express"

import { parse } from "../heatmap/heatmap.controller"
import { listAllContacts } from "./contacts.service"
import { listContactsQuerySchema } from "./contacts.validators"

export async function listAllContactsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parse(listContactsQuerySchema, req.query)
    return res.status(200).json(await listAllContacts(query, req.user!))
  } catch (err) {
    return next(err)
  }
}
