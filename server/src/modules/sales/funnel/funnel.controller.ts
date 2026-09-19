/**
 * The funnel's handlers (revision §27).
 *
 * Its own file, and nothing is added to `sales.controller.ts` — that one is
 * already 531 lines and grows with every phase because it belongs to no
 * feature (§27.18, §28).
 *
 * House style: parse, call the service, answer, and let the error middleware
 * say what went wrong.
 */

import type { NextFunction, Request, Response } from "express"

import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { isSalesAdmin } from "../sales.access"
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
import { getFunnel, listFunnelTeam } from "./funnel.service"
import {
  editFunnelCellBodySchema,
  funnelActionSchema,
  funnelQuerySchema,
  managementNoteSchema,
  meetingAttendeesSchema,
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
 * A management note on a deal (§27.8, §27.12). Admin only, and it lands as an
 * ordinary SalesComment carrying the meeting, so it shows in the deal's
 * remarks and on its Timeline without a second store.
 */
export async function addManagementNoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const actor = req.user!
    if (!isSalesAdmin(actor)) {
      throw new AppError(403, "Only a Sales Admin can write a management note")
    }
    const body = managementNoteSchema.parse(req.body)
    const meetingId = pathParam(req, "id")

    const meeting = await prisma.funnelMeeting.findUnique({
      where: { id: meetingId },
      select: { id: true, status: true },
    })
    if (!meeting) throw new AppError(404, "That funnel meeting does not exist")
    if (meeting.status === "COMPLETED") {
      throw new AppError(409, "That funnel meeting is completed. Reopen it to make changes")
    }

    const deal = await prisma.opportunity.findUnique({
      where: { id: body.opportunityId },
      select: { id: true },
    })
    if (!deal) throw new AppError(404, "That Opportunity does not exist, or is not yours")

    const created = await prisma.salesComment.create({
      data: {
        entity: "OPPORTUNITY",
        entityId: body.opportunityId,
        kind: "MANAGEMENT_NOTE",
        body: body.body,
        authorUserId: actor.sub,
        funnelMeetingId: meetingId,
      },
      select: { id: true, createdAt: true },
    })

    return res.status(201).json({ id: created.id, createdAt: created.createdAt.toISOString() })
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
    const weekStart = typeof req.query.weekStart === "string" ? req.query.weekStart : undefined
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
