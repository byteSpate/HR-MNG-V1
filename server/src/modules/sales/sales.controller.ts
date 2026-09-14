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
  listMeetings,
  updateMeeting,
} from "./meeting.service"
import { changeTaskStatus, createTask, getTask, listTasks, updateTask } from "./task.service"
import {
  changeTaskStatusSchema,
  createTaskSchema,
  listTaskSchema,
  updateTaskSchema,
  changeOpportunityNextStepSchema,
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
