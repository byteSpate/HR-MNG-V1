import type { NextFunction, Request, Response } from "express"

import { countDayLogPictures, renderDayLogPng } from "./daylog.service"
import { dayLogPictureSchema, dayLogQuerySchema } from "./daylog.validators"

/**
 * The work log picture. Never cached: someone who finishes one more task and
 * presses Preview again must see it.
 */
export async function dayLogImageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = dayLogQuerySchema.parse(req.query)
    const { picture } = dayLogPictureSchema.parse(req.query)
    const png = await renderDayLogPng(query, req.user!, picture)
    const base = query.from === query.to ? `work-log-${query.from}` : `work-log-${query.from}-to-${query.to}`
    const name = `${base}-${picture}.png`
    res.setHeader("Content-Type", "image/png")
    res.setHeader("Content-Disposition", `inline; filename="${name}"`)
    res.setHeader("Cache-Control", "no-store")
    return res.status(200).send(png)
  } catch (err) {
    return next(err)
  }
}

/** How many pictures a log needs, so the page knows how many to ask for. */
export async function dayLogCountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader("Cache-Control", "no-store")
    return res.status(200).json(await countDayLogPictures(dayLogQuerySchema.parse(req.query), req.user!))
  } catch (err) {
    return next(err)
  }
}
