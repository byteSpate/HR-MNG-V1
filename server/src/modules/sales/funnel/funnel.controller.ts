/**
 * The funnel's handlers (revision §27).
 *
 * Its own file in the funnel's own folder: every feature owns its controller
 * rather than adding handlers to a shared one (§27.18, §28).
 *
 * House style: parse, call the service, answer, and let the error middleware
 * say what went wrong.
 */

import type { NextFunction, Request, Response } from "express"

import { AppError } from "../../../middleware/errorHandler"
import { createFunnelAction, listMeetingActions } from "./funnel.actions"
import { editFunnelCell } from "./funnel.edit"
import {
  getFunnelMeeting,
  openFunnelMeeting,
  setMeetingAttendees,
  setMeetingNote,
  setMeetingStatus,
  setPersonReviewed,
} from "./funnel.meeting"
import { addManagementNote } from "./funnel.notes"
import { getFunnel, listFunnelTeam } from "./funnel.service"
import {
  editFunnelCellBodySchema,
  funnelActionSchema,
  funnelQuerySchema,
  managementNoteSchema,
  meetingAttendeesSchema,
  meetingQuerySchema,
  meetingNoteSchema,
  openMeetingSchema,
  reviewPersonSchema,
} from "./funnel.validators"

/**
 * One path parameter, as a string.
 *
 * Express 5 types a param as `string | string[]`, because a repeated segment
 * can arrive as a list. Every route here declares `:id` once, so a list means
 * a malformed request rather than a case to handle — and a 400 says that,
 * where a cast would quietly stringify `["a","b"]` into `"a,b"` and look up a
 * meeting that cannot exist.
 */
function pathParam(req: Request, name: string): string {
  const value = req.params[name]
  if (typeof value !== "string" || value === "") {
    throw new AppError(400, `Missing ${name} in the path`)
  }
  return value
}

export async function getFunnelHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await getFunnel(funnelQuerySchema.parse(req.query), req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function listFunnelTeamHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await listFunnelTeam(req.user!))
  } catch (err) {
    return next(err)
  }
}

/**
 * A cell edit answers with the row's new value rather than the whole grid.
 *
 * Deliberately unlike the weekly report, which answers with the whole week:
 * there, one write changes several things at once. Here it changes one cell,
 * and re-sending two hundred rows after every edit would be the funnel's own
 * version of the refetch problem the performance audit found on the client.
 */
export async function editFunnelCellHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = editFunnelCellBodySchema.parse(req.body)
    return res.status(200).json(await editFunnelCell(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

/**
 * A management note on a deal (§27.8, §27.12). Admin only; the rules live in
 * `funnel.notes.ts`, like every other write in this module.
 */
export async function addManagementNoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = managementNoteSchema.parse(req.body)
    return res.status(201).json(await addManagementNote(pathParam(req, "id"), body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function openFunnelMeetingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = openMeetingSchema.parse(req.body ?? {})
    return res.status(200).json(await openFunnelMeeting(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getFunnelMeetingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { weekStart } = meetingQuerySchema.parse(req.query)
    return res.status(200).json(await getFunnelMeeting(weekStart, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setMeetingAttendeesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = meetingAttendeesSchema.parse(req.body)
    return res.status(200).json(await setMeetingAttendees(pathParam(req, "id"), body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setPersonReviewedHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = reviewPersonSchema.parse(req.body)
    return res.status(200).json(await setPersonReviewed(pathParam(req, "id"), body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setMeetingNoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = meetingNoteSchema.parse(req.body)
    return res.status(200).json(await setMeetingNote(pathParam(req, "id"), body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function completeMeetingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await setMeetingStatus(pathParam(req, "id"), "COMPLETED", req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function reopenMeetingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json(await setMeetingStatus(pathParam(req, "id"), "SCHEDULED", req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function createFunnelActionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = funnelActionSchema.parse(req.body)
    return res.status(201).json(await createFunnelAction(pathParam(req, "id"), body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function listMeetingActionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(200).json({ items: await listMeetingActions(pathParam(req, "id"), req.user!) })
  } catch (err) {
    return next(err)
  }
}
