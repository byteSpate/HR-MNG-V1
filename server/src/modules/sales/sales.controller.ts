import type { NextFunction, Request, Response } from "express"

import { getSalesDashboard } from "./dashboard.service"
import { listMeetingsWaitingForMinutes } from "./meetings/meeting.service"
import {
  answerRequirement,
  deleteMinutes,
  getMinutes,
  listMinutes,
  saveMinutes,
  startMinutes,
} from "./minutes.service"
import { getMinutesTemplate, saveMinutesTemplate } from "./minutes.template.service"
import { templateSchema } from "./minutes.content"
import { contentDisposition } from "./minutes.pdf"
import { getSentCopy, previewMinutes, sendMinutes, type MinutesFile } from "./minutes.send"
import {
  salesDashboardSchema,
  answerRequirementSchema,
  listMinutesSchema,
  saveMinutesSchema,
  sendMinutesSchema,
  waitingForMinutesSchema,
} from "./sales.validators"

// ── Sales Settings ──────────────────────────────────────────────────────────

export async function getMinutesTemplateHandler(_req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await getMinutesTemplate()) }
  catch (err) { return next(err) }
}

export async function saveMinutesTemplateHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await saveMinutesTemplate(templateSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

// ── meeting minutes ─────────────────────────────────────────────────────────

/** 201 when this made the document, 200 when it already existed: both answer with its id. */
export async function startMinutesHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try {
    const { id, created } = await startMinutes(req.params.id, req.user!)
    return res.status(created ? 201 : 200).json({ id })
  } catch (err) {
    return next(err)
  }
}

export async function listMinutesHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await listMinutes(listMinutesSchema.parse(req.query), req.user!)) }
  catch (err) { return next(err) }
}

export async function listWaitingForMinutesHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await listMeetingsWaitingForMinutes(waitingForMinutesSchema.parse(req.query), req.user!)) }
  catch (err) { return next(err) }
}

export async function getMinutesHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await getMinutes(req.params.id, req.user!)) }
  catch (err) { return next(err) }
}

export async function saveMinutesHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await saveMinutes(req.params.id, saveMinutesSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function answerRequirementHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await answerRequirement(req.params.id, answerRequirementSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function deleteMinutesHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { await deleteMinutes(req.params.id, req.user!); return res.status(204).send() }
  catch (err) { return next(err) }
}

/**
 * A minutes PDF. Never cached: a preview is a draft of something still being
 * written, and a browser that kept one could show it in place of a later copy.
 */
function sendMinutesFile(res: Response, kind: "inline" | "attachment", file: MinutesFile) {
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", contentDisposition(kind, file.fileName))
  res.setHeader("Cache-Control", "no-store")
  return res.status(200).send(file.pdf)
}

export async function previewMinutesHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return sendMinutesFile(res, "inline", await previewMinutes(req.params.id, req.user!)) }
  catch (err) { return next(err) }
}

export async function sendMinutesHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return sendMinutesFile(res, "attachment", await sendMinutes(req.params.id, sendMinutesSchema.parse(req.body ?? {}), req.user!)) }
  catch (err) { return next(err) }
}

export async function sentCopyHandler(req: Request<{ sendId: string }>, res: Response, next: NextFunction) {
  try { return sendMinutesFile(res, "attachment", await getSentCopy(req.params.sendId, req.user!)) }
  catch (err) { return next(err) }
}

export async function getSalesDashboardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = salesDashboardSchema.parse(req.query)
    return res.status(200).json(await getSalesDashboard(query, req.user!))
  } catch (err) {
    return next(err)
  }
}
