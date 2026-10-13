import type { NextFunction, Request, Response } from "express"
import { z } from "zod"

import { AppError } from "../../../middleware/errorHandler"
import { getHeatmap, setPartScope, setProductColour } from "./heatmap.service"
import { NOT_ON_HEATMAP, setColourSchema, setScopeSchema } from "./heatmap.validators"

/**
 * The refusal is the sentence alone. The shared error handler prefixes a Zod
 * failure with its field path, which is not easy English for the reader.
 */
export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message ?? "Check the form and try again.")
  return parsed.data
}

/** An id that is not an id means the page is out of date. */
export function rowId(raw: string): string {
  if (!z.uuid().safeParse(raw).success) throw new AppError(404, NOT_ON_HEATMAP)
  return raw
}

type AccountParams = { id: string }
type ProductParams = { id: string; productId: string }
type PartParams = { id: string; partId: string }

export async function getHeatmapHandler(req: Request<AccountParams>, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getHeatmap(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setProductColourHandler(req: Request<ProductParams>, res: Response, next: NextFunction) {
  try {
    const id = rowId(req.params.productId)
    const body = parse(setColourSchema, req.body)
    return res.status(200).json(await setProductColour(req.params.id, id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setPartScopeHandler(req: Request<PartParams>, res: Response, next: NextFunction) {
  try {
    const id = rowId(req.params.partId)
    const body = parse(setScopeSchema, req.body)
    return res.status(200).json(await setPartScope(req.params.id, id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}
