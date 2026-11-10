import type { NextFunction, Request, Response } from "express"

import { listInbox, markAllRead, markRead, unreadCount } from "./inbox.service"
import { inboxQuery } from "./inbox.validators"

// The person is always the token. No route here takes a user id.

export async function countHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json({ unread: await unreadCount(req.user!.sub) })
  } catch (err) {
    return next(err)
  }
}

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listInbox(req.user!, inboxQuery.parse(req.query)))
  } catch (err) {
    return next(err)
  }
}

export async function markReadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await markRead(req.user!.sub, String(req.params.id))
    return res.status(204).end()
  } catch (err) {
    return next(err)
  }
}

export async function markAllReadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json({ marked: await markAllRead(req.user!.sub) })
  } catch (err) {
    return next(err)
  }
}
