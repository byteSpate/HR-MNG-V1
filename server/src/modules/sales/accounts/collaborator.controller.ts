import type { NextFunction, Request, Response } from "express"

import { approveRemoval, refuseRemoval } from "./removal.decide"
import { addCollaborator, listCollaboratorOptions, removeCollaboratorDirect } from "./collaborator.service"
import { cancelRemoval, listRemovals, requestRemoval } from "./removal.service"
import {
  addCollaboratorSchema,
  listRemovalsQuerySchema,
  refuseRemovalSchema,
  removalRequestSchema,
} from "./collaborator.validators"

export async function addCollaboratorHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try {
    const body = addCollaboratorSchema.parse(req.body)
    return res.status(201).json(await addCollaborator(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function listCollaboratorOptionsHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listCollaboratorOptions(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function removeCollaboratorHandler(
  req: Request<{ id: string; employeeId: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    await removeCollaboratorDirect(req.params.id, req.params.employeeId, req.user!)
    return res.status(204).send()
  } catch (err) {
    return next(err)
  }
}

export async function requestRemovalHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try {
    const body = removalRequestSchema.parse(req.body)
    return res.status(201).json(await requestRemoval(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function cancelRemovalHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await cancelRemoval(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function listRemovalsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listRemovalsQuerySchema.parse(req.query)
    return res.status(200).json({ items: await listRemovals(query, req.user!) })
  } catch (err) {
    return next(err)
  }
}

export async function approveRemovalHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await approveRemoval(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function refuseRemovalHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try {
    const body = refuseRemovalSchema.parse(req.body)
    return res.status(200).json(await refuseRemoval(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}
