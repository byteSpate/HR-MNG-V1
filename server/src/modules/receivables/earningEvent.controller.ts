import type { NextFunction, Request, Response } from "express"
import { createEarningEvent, getEarningEvent, listEarningEvents } from "./earningEvent.service"
import { approveEarningEvent } from "./earningEvent.posting"
import { createEarningEventSchema } from "./earningEvent.validators"

type RequestWithId = Request<{ id: string }>

export async function listEarningEventsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, poId, opportunityId } = req.query as { status?: "DRAFT" | "APPROVED"; poId?: string; opportunityId?: string }
    return res.status(200).json(await listEarningEvents({ status, poId, opportunityId }, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getEarningEventHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getEarningEvent(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function createEarningEventHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createEarningEventSchema.parse(req.body)
    return res.status(201).json(await createEarningEvent(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function approveEarningEventHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await approveEarningEvent(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}
