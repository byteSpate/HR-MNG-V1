import type { NextFunction, Request, Response } from "express"
import {
  deleteEarningRun,
  draftEarningRun,
  getEarningRun,
  listEarningRuns,
  postEarningRun,
  reverseEarningRun,
} from "./earningRun.service"
import { draftEarningRunSchema, reverseEarningRunSchema } from "./earningRun.validators"

type RequestWithId = Request<{ id: string }>

export async function listEarningRunsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listEarningRuns())
  } catch (err) {
    next(err)
  }
}

export async function draftEarningRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = draftEarningRunSchema.parse(req.body)
    res.status(201).json(await draftEarningRun(body, req.user!))
  } catch (err) {
    next(err)
  }
}

export async function getEarningRunHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    res.json(await getEarningRun(req.params.id))
  } catch (err) {
    next(err)
  }
}

export async function postEarningRunHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    res.json(await postEarningRun(req.params.id, req.user!))
  } catch (err) {
    next(err)
  }
}

export async function reverseEarningRunHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const body = reverseEarningRunSchema.parse(req.body)
    res.json(await reverseEarningRun(req.params.id, body, req.user!))
  } catch (err) {
    next(err)
  }
}

export async function deleteEarningRunHandler(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    await deleteEarningRun(req.params.id, req.user!)
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}
