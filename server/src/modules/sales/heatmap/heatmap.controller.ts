import type { NextFunction, Request, Response } from "express"
import { z } from "zod"

import { AppError } from "../../../middleware/errorHandler"
import { addHeatmapItem, getHeatmap, removeHeatmapItem, setCardNeed, updateHeatmapItem } from "./heatmap.service"
import { heatmapItemSchema, NO_SUCH_ITEM, setNeedSchema } from "./heatmap.validators"

/**
 * The refusal is the sentence alone. The shared error handler prefixes a Zod
 * failure with its field path ("details.ports: ..."), which is not easy
 * English for the person who reads it on the form.
 */
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message ?? "Check the form and try again.")
  return parsed.data
}

/** An id that is not an id means the page is out of date, so it says so instead of "Invalid UUID". */
function itemId(raw: string): string {
  if (!z.uuid().safeParse(raw).success) throw new AppError(404, NO_SUCH_ITEM)
  return raw
}

type AccountParams = { id: string }
type CardParams = { id: string; card: string }
type ItemParams = { id: string; itemId: string }

export async function getHeatmapHandler(req: Request<AccountParams>, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getHeatmap(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setCardNeedHandler(req: Request<CardParams>, res: Response, next: NextFunction) {
  try {
    const body = parse(setNeedSchema, req.body)
    return res.status(200).json(await setCardNeed(req.params.id, req.params.card, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function addHeatmapItemHandler(req: Request<CardParams>, res: Response, next: NextFunction) {
  try {
    const body = parse(heatmapItemSchema, req.body)
    return res.status(201).json(await addHeatmapItem(req.params.id, req.params.card, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function updateHeatmapItemHandler(req: Request<ItemParams>, res: Response, next: NextFunction) {
  try {
    const id = itemId(req.params.itemId)
    const body = parse(heatmapItemSchema, req.body)
    return res.status(200).json(await updateHeatmapItem(req.params.id, id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function removeHeatmapItemHandler(req: Request<ItemParams>, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await removeHeatmapItem(req.params.id, itemId(req.params.itemId), req.user!))
  } catch (err) {
    return next(err)
  }
}
