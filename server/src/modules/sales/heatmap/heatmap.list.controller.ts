import type { NextFunction, Request, Response } from "express"

import { parse, rowId } from "./heatmap.controller"
import { addListRow, deleteListRow, editListRow, getHeatmapList, moveListRow } from "./heatmap.list.service"
import { levelOf, listEditSchema, listRowSchema, moveSchema } from "./heatmap.validators"

/** Every list handler returns the whole list, so the page redraws from one answer. */
const wrap =
  <P>(fn: (req: Request<P>) => Promise<unknown>, status = 200) =>
  async (req: Request<P>, res: Response, next: NextFunction) => {
    try {
      return res.status(status).json(await fn(req))
    } catch (err) {
      return next(err)
    }
  }

type LevelParams = { level: string; id: string }

export const getHeatmapListHandler = wrap(() => getHeatmapList())
export const addGroupHandler = wrap((req) => addListRow("groups", null, parse(listRowSchema, req.body), req.user!), 201)
export const addProductHandler = wrap<{ id: string }>(
  (req) => addListRow("products", rowId(req.params.id), parse(listRowSchema, req.body), req.user!), 201)
export const addPartHandler = wrap<{ id: string }>(
  (req) => addListRow("parts", rowId(req.params.id), parse(listRowSchema, req.body), req.user!), 201)
export const editListRowHandler = wrap<LevelParams>(
  (req) => editListRow(levelOf(req.params.level), rowId(req.params.id), parse(listEditSchema, req.body), req.user!))
export const moveListRowHandler = wrap<LevelParams>(
  (req) => moveListRow(levelOf(req.params.level), rowId(req.params.id), parse(moveSchema, req.body).direction, req.user!))
export const deleteListRowHandler = wrap<LevelParams>(
  (req) => deleteListRow(levelOf(req.params.level), rowId(req.params.id), req.user!))
