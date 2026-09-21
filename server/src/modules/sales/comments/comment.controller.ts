import type { NextFunction, Request, Response } from "express"

import { createSalesComment, listSalesComments, updateSalesComment } from "./comment.service"
import { createSalesCommentSchema, listSalesCommentSchema, updateSalesCommentSchema } from "./comment.validators"

export async function createSalesCommentHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(201).json(await createSalesComment(createSalesCommentSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function listSalesCommentsHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await listSalesComments(listSalesCommentSchema.parse(req.query), req.user!)) }
  catch (err) { return next(err) }
}

export async function updateSalesCommentHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await updateSalesComment(req.params.id, updateSalesCommentSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}
