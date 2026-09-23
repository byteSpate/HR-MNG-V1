import type { NextFunction, Request, Response } from "express"
import { getCustomerAgeing, getCustomerControlTieOut } from "./receivables.reports"

export async function customerAgeingHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getCustomerAgeing())
  } catch (err) {
    return next(err)
  }
}

export async function customerTieOutHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getCustomerControlTieOut())
  } catch (err) {
    return next(err)
  }
}
