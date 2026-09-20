import type { NextFunction, Request, Response } from "express"

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
import {
  changeOpportunityNextStepSchema,
  setSoftwareNeededSchema,
  changeOpportunityStageSchema,
  changeOpportunityStatusSchema,
  createOpportunityLineSchema,
  createOpportunitySchema,
  listOpportunitySchema,
  opportunitySuggestionSchema,
  reorderOpportunityLinesSchema,
  updateOpportunityLineSchema,
  updateOpportunitySchema,
} from "./opportunity.validators"

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
