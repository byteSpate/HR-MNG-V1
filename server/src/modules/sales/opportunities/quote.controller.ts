import type { NextFunction, Request, Response } from "express"
import { z } from "zod"

import { AppError } from "../../../middleware/errorHandler"
import { addQuote, deleteLatestQuote, editLatestQuote, NO_SUCH_QUOTE } from "./quote.service"
import { quoteSchema } from "./quote.validators"

/** The refusal is the sentence alone, without the field path the shared handler adds. */
function parseQuote(body: unknown) {
  const parsed = quoteSchema.safeParse(body)
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message ?? "Check the quote and try again.")
  return parsed.data
}

/** An id that is not an id means the page is out of date. */
function quoteId(raw: string): string {
  if (!z.uuid().safeParse(raw).success) throw new AppError(404, NO_SUCH_QUOTE)
  return raw
}

type QuoteParams = { id: string; quoteId: string }

export async function addQuoteHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(201).json(await addQuote(req.params.id, parseQuote(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function editQuoteHandler(req: Request<QuoteParams>, res: Response, next: NextFunction) {
  try {
    const id = quoteId(req.params.quoteId)
    return res.status(200).json(await editLatestQuote(req.params.id, id, parseQuote(req.body), req.user!))
  } catch (err) { return next(err) }
}

export async function deleteQuoteHandler(req: Request<QuoteParams>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await deleteLatestQuote(req.params.id, quoteId(req.params.quoteId), req.user!)) }
  catch (err) { return next(err) }
}
