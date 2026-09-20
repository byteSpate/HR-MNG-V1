/**
 * The Weekly Report's handlers (revision §26).
 *
 * Its own file rather than more lines in `sales.controller.ts`, which is
 * already the longest file in the module. The style is the house one: parse,
 * call the service, answer, and let the error middleware say what went wrong.
 */

import type { NextFunction, Request, Response } from "express"

import {
  addOtherWork,
  getEmployeeWeek,
  getMyWeek,
  listTeamWeek,
  removeOtherWork,
  saveAccountNote,
} from "./weekly.service"
import { getWeeklyCopy, previewMyWeek, submitMyWeek, type WeeklyFile } from "./weekly.submit"
import { contentDisposition } from "../minutes/minutes.pdf"
import { addOtherWorkSchema, saveWeeklyNoteSchema, weekQuerySchema } from "./weekly.validators"

/**
 * A weekly report PDF. Never cached: a copy is downloaded by name, and a
 * browser holding an older one would hand back last week's file.
 */
function sendPdf(res: Response, file: WeeklyFile) {
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", contentDisposition("attachment", file.fileName))
  res.setHeader("Cache-Control", "no-store")
  return res.status(200).send(file.pdf)
}

export async function getMyWeekHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await getMyWeek(weekQuerySchema.parse(req.query), req.user!)) }
  catch (err) { return next(err) }
}

/**
 * A saved note answers with the whole week again, so the page never has to
 * work out what the write changed — the next step it now shows, the task it
 * made, the week going back to Draft.
 */
export async function saveWeeklyNoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = saveWeeklyNoteSchema.parse(req.body)
    await saveAccountNote(body, req.user!)
    return res.status(200).json(await getMyWeek({ week: body.date }, req.user!))
  } catch (err) { return next(err) }
}

export async function addOtherWorkHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = addOtherWorkSchema.parse(req.body)
    await addOtherWork(body, req.user!)
    return res.status(200).json(await getMyWeek({ week: body.date }, req.user!))
  } catch (err) { return next(err) }
}

export async function removeOtherWorkHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try { await removeOtherWork(req.params.id, req.user!); return res.status(204).send() }
  catch (err) { return next(err) }
}

/**
 * The week as it would print, kept nowhere. Opened in a tab rather than
 * downloaded, so checking the layout leaves nothing on anybody's disk.
 */
export async function previewMyWeekHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const file = await previewMyWeek(weekQuerySchema.parse(req.query), req.user!)
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", contentDisposition("inline", file.fileName))
    res.setHeader("Cache-Control", "no-store")
    return res.status(200).send(file.pdf)
  } catch (err) { return next(err) }
}
/** Submit keeps the copy and answers with that same file (§26.17). */
export async function submitMyWeekHandler(req: Request, res: Response, next: NextFunction) {
  try { return sendPdf(res, await submitMyWeek(weekQuerySchema.parse(req.query), req.user!)) }
  catch (err) { return next(err) }
}

export async function weeklyCopyHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return sendPdf(res, await getWeeklyCopy(req.params.id, req.user!)) }
  catch (err) { return next(err) }
}

export async function listTeamWeekHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await listTeamWeek(weekQuerySchema.parse(req.query), req.user!)) }
  catch (err) { return next(err) }
}

export async function getEmployeeWeekHandler(
  req: Request<{ employeeId: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res
      .status(200)
      .json(await getEmployeeWeek(req.params.employeeId, weekQuerySchema.parse(req.query), req.user!))
  } catch (err) { return next(err) }
}
