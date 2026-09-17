import type { NextFunction, Request, Response } from "express"

import {
  createSalesAccount,
  updateSalesAccount,
  getAccountHistory,
  getAccountMargin,
  getSalesAccount,
  listAllSalesAccounts,
  listSalesAccounts,
  listSalesEligibleEmployees,
} from "./account.service"
import { addContact, listContacts, setContactStatus, setPrimaryContact } from "./contact.service"
import { getAccountTimeline, logCommunication } from "./communication.service"
import { getTargetYear, setSalesTarget } from "./target.service"
import { getSalesDashboard } from "./dashboard.service"
import {
  changeOpportunityNextStep,
  setSoftwareNeeded,
  changeOpportunityStage,
  changeOpportunityStatus,
  createOpportunity,
  getOpportunity,
  getOpportunityHistory,
  getOpportunityTimeline,
  listOpportunities,
  listOpportunityOwners,
  updateOpportunity,
} from "./opportunity.service"
import {
  addOpportunityLine,
  deleteOpportunityLine,
  reorderOpportunityLines,
  suggestOpportunityLineValues,
  updateOpportunityLine,
} from "./opportunity.line.service"
import { createSalesComment, listSalesComments, updateSalesComment } from "./comment.service"
import {
  changeMeetingStatus,
  createMeeting,
  getMeeting,
  listMeetingAttendeeOptions,
  listMeetings,
  listMeetingsWaitingForMinutes,
  updateMeeting,
} from "./meeting.service"
import {
  answerRequirement,
  deleteMinutes,
  getMinutes,
  listMinutes,
  saveMinutes,
  startMinutes,
} from "./minutes.service"
import { changeTaskStatus, createTask, getTask, listTasks, updateTask } from "./task.service"
import { getMinutesTemplate, saveMinutesTemplate } from "./minutes.template.service"
import { templateSchema } from "./minutes.content"
import { contentDisposition } from "./minutes.pdf"
import { getSentCopy, previewMinutes, sendMinutes, type MinutesFile } from "./minutes.send"
import {
  changeTaskStatusSchema,
  createTaskSchema,
  listTaskSchema,
  updateTaskSchema,
  changeOpportunityNextStepSchema,
  setSoftwareNeededSchema,
  changeOpportunityStageSchema,
  changeOpportunityStatusSchema,
  createOpportunityLineSchema,
  createOpportunitySchema,
  createSalesCommentSchema,
  createSalesAccountSchema,
  updateSalesAccountSchema,
  createSalesContactSchema,
  logCommunicationSchema,
  getTargetYearSchema,
  setSalesTargetSchema,
  salesDashboardSchema,
  listOpportunitySchema,
  listSalesCommentSchema,
  opportunitySuggestionSchema,
  reorderOpportunityLinesSchema,
  setContactStatusSchema,
  updateOpportunityLineSchema,
  updateOpportunitySchema,
  updateSalesCommentSchema,
  changeMeetingStatusSchema,
  createMeetingSchema,
  listMeetingSchema,
  updateMeetingSchema,
  answerRequirementSchema,
  listMinutesSchema,
  saveMinutesSchema,
  sendMinutesSchema,
  waitingForMinutesSchema,
} from "./sales.validators"

export async function listSalesAccountsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // ?scope=all is "All Accounts" — the shared, read-only directory. Its
    // default (no query, or anything else) is "My Accounts" — owner,
    // assignee, or admin — the behaviour this route always had.
    const unverified = req.query.unverified === "true"
    const items =
      req.query.scope === "all"
        ? await listAllSalesAccounts(
            req.user!,
            unverified,
            typeof req.query.ownerEmployeeId === "string" ? req.query.ownerEmployeeId : undefined
          )
        : await listSalesAccounts(req.user!, unverified)
    return res.status(200).json(items)
  } catch (err) {
    return next(err)
  }
}

export async function getSalesAccountHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await getSalesAccount(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function listSalesEligibleEmployeesHandler(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await listSalesEligibleEmployees())
  } catch (err) {
    return next(err)
  }
}

export async function createSalesAccountHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = createSalesAccountSchema.parse(req.body)
    return res.status(201).json(await createSalesAccount(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function listContactsHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await listContacts(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function addContactHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const body = createSalesContactSchema.parse(req.body)
    return res.status(201).json(await addContact(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setPrimaryContactHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await setPrimaryContact(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setContactStatusHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const body = setContactStatusSchema.parse(req.body)
    return res.status(200).json(await setContactStatus(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function logCommunicationHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const body = logCommunicationSchema.parse(req.body)
    return res.status(201).json(await logCommunication(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getAccountHistoryHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await getAccountHistory(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getAccountMarginHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await getAccountMargin(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getAccountTimelineHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    return res.status(200).json(await getAccountTimeline(req.params.id, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function updateSalesAccountHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
) {
  try {
    const body = updateSalesAccountSchema.parse(req.body)
    return res.status(200).json(await updateSalesAccount(req.params.id, body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function createOpportunityHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(201).json(await createOpportunity(createOpportunitySchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function listOpportunitiesHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await listOpportunities(listOpportunitySchema.parse(req.query), req.user!)) }
  catch (err) { return next(err) }
}

export async function listOpportunityOwnersHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await listOpportunityOwners(req.user!)) }
  catch (err) { return next(err) }
}

export async function getOpportunityHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await getOpportunity(req.params.id, req.user!)) }
  catch (err) { return next(err) }
}

export async function updateOpportunityHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await updateOpportunity(req.params.id, updateOpportunitySchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function changeOpportunityStageHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await changeOpportunityStage(req.params.id, changeOpportunityStageSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function changeOpportunityStatusHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await changeOpportunityStatus(req.params.id, changeOpportunityStatusSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function changeOpportunityNextStepHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await changeOpportunityNextStep(req.params.id, changeOpportunityNextStepSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

/** The weekly report's Application column, answered on the deal (§26.9). */
export async function setSoftwareNeededHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await setSoftwareNeeded(req.params.id, setSoftwareNeededSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function getOpportunityTimelineHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await getOpportunityTimeline(req.params.id, req.user!)) }
  catch (err) { return next(err) }
}

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

// ── tasks ───────────────────────────────────────────────────────────────────

export async function listTasksHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await listTasks(listTaskSchema.parse(req.query), req.user!)) }
  catch (err) { return next(err) }
}

export async function createTaskHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(201).json(await createTask(createTaskSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function getTaskHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await getTask(req.params.id, req.user!)) }
  catch (err) { return next(err) }
}

export async function updateTaskHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await updateTask(req.params.id, updateTaskSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function changeTaskStatusHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await changeTaskStatus(req.params.id, changeTaskStatusSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

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

export async function getOpportunityHistoryHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await getOpportunityHistory(req.params.id, req.user!)) }
  catch (err) { return next(err) }
}

export async function addOpportunityLineHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(201).json(await addOpportunityLine(req.params.id, createOpportunityLineSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function updateOpportunityLineHandler(req: Request<{ lineId: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await updateOpportunityLine(req.params.lineId, updateOpportunityLineSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function deleteOpportunityLineHandler(req: Request<{ lineId: string }>, res: Response, next: NextFunction) {
  try { await deleteOpportunityLine(req.params.lineId, req.user!); return res.status(204).send() }
  catch (err) { return next(err) }
}

export async function reorderOpportunityLinesHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await reorderOpportunityLines(req.params.id, reorderOpportunityLinesSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function suggestOpportunityLinesHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await suggestOpportunityLineValues(opportunitySuggestionSchema.parse(req.query), req.user!)) }
  catch (err) { return next(err) }
}

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

export async function getTargetYearHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = getTargetYearSchema.parse(req.query)
    return res.status(200).json(await getTargetYear(query, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function setSalesTargetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = setSalesTargetSchema.parse(req.body)
    return res.status(200).json(await setSalesTarget(body, req.user!))
  } catch (err) {
    return next(err)
  }
}

export async function getSalesDashboardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const query = salesDashboardSchema.parse(req.query)
    return res.status(200).json(await getSalesDashboard(query, req.user!))
  } catch (err) {
    return next(err)
  }
}
