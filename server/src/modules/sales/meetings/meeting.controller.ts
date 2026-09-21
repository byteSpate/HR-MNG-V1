import type { NextFunction, Request, Response } from "express"

import {
  changeMeetingStatus,
  createMeeting,
  getMeeting,
  listMeetingAttendeeOptions,
  listMeetings,
  updateMeeting,
} from "./meeting.service"
import {
  changeMeetingStatusSchema,
  createMeetingSchema,
  listMeetingSchema,
  updateMeetingSchema,
} from "./meeting.validators"

// ── meetings ────────────────────────────────────────────────────────────────

export async function listMeetingsHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await listMeetings(listMeetingSchema.parse(req.query), req.user!)) }
  catch (err) { return next(err) }
}

export async function createMeetingHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(201).json(await createMeeting(createMeetingSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function getMeetingHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await getMeeting(req.params.id, req.user!)) }
  catch (err) { return next(err) }
}

export async function updateMeetingHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await updateMeeting(req.params.id, updateMeetingSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function changeMeetingStatusHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await changeMeetingStatus(req.params.id, changeMeetingStatusSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function listMeetingAttendeeOptionsHandler(_req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await listMeetingAttendeeOptions()) }
  catch (err) { return next(err) }
}
