import type { NextFunction, Request, Response } from "express"

import { resendInvite } from "./auth.invite"
import { createUserSchema, setUserRoleSchema, updateUserStatusSchema } from "./auth.validators"
import { createUser, listUsers, setUserRole, setUserStatus } from "./user.service"

export async function listUsersHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listUsers())
  } catch (err) {
    return next(err)
  }
}

export async function createUserHandler(req: Request, res: Response, next: NextFunction) {
  const parsed = createUserSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" })
  }
  try {
    return res.status(201).json(await createUser(parsed.data))
  } catch (err) {
    return next(err)
  }
}

export async function updateUserStatusHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  const parsed = updateUserStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" })
  }
  try {
    // The actor is passed through so the self-deactivation guard can fire;
    // the guards, the 404 and the token revoke all live in the service now.
    return res
      .status(200)
      .json(await setUserStatus(req.user!.sub, req.params.id, parsed.data.isActive))
  } catch (err) {
    return next(err)
  }
}

export async function setUserRoleHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  const parsed = setUserRoleSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" })
  }
  try {
    return res.status(200).json(await setUserRole(req.user!.sub, req.params.id, parsed.data.role))
  } catch (err) {
    return next(err)
  }
}

export async function resendUserInviteHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await resendInvite(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}
