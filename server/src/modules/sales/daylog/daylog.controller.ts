import type { NextFunction, Request, Response } from "express"

import { renderDayLogPng } from "./daylog.service"
import { dayLogQuerySchema } from "./daylog.validators"

/**
 * The work log picture. Never cached: someone who finishes one more task and
 * presses Preview again must see it.
 */
export async function dayLogImageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = dayLogQuerySchema.parse(req.query)
    const png = await renderDayLogPng(query, req.user!)
    const name = query.from === query.to ? `work-log-${query.from}.png` : `work-log-${query.from}-to-${query.to}.png`
    res.setHeader("Content-Type", "image/png")
    res.setHeader("Content-Disposition", `inline; filename="${name}"`)
    res.setHeader("Cache-Control", "no-store")
    return res.status(200).send(png)
  } catch (err) {
    return next(err)
  }
}
