import type { NextFunction, Request, Response } from "express"

import { listPermissions, myPermissions, savePermissions } from "../sales.permissions"
import { savePermissionsSchema } from "./permission.validators"

export async function listPermissionsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json({ items: await listPermissions() })
  } catch (err) {
    return next(err)
  }
}

export async function myPermissionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json({ permissions: await myPermissions(req.user!) })
  } catch (err) {
    return next(err)
  }
}

export async function savePermissionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = savePermissionsSchema.parse(req.body)
    return res.status(200).json({ items: await savePermissions(body.changes, req.user!) })
  } catch (err) {
    return next(err)
  }
}
