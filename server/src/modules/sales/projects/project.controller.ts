import type { NextFunction, Request, Response } from "express"

import { changeProjectStatus, getProject, listProjects, setProjectTeam, startProject, updateProject } from "./project.service"
import { addMilestone, removeMilestone, tickLine, untickLine, updateMilestone } from "./project.milestone.service"
import {
  addMilestoneSchema,
  changeProjectStatusSchema,
  listProjectSchema,
  setProjectTeamSchema,
  updateMilestoneSchema,
  updateProjectSchema,
} from "./project.validators"

export async function startProjectHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(201).json(await startProject(req.params.id, req.user!)) }
  catch (err) { return next(err) }
}

export async function listProjectsHandler(req: Request, res: Response, next: NextFunction) {
  try { return res.status(200).json(await listProjects(listProjectSchema.parse(req.query), req.user!)) }
  catch (err) { return next(err) }
}

export async function getProjectHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await getProject(req.params.id, req.user!)) }
  catch (err) { return next(err) }
}

export async function updateProjectHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await updateProject(req.params.id, updateProjectSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function setProjectTeamHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await setProjectTeam(req.params.id, setProjectTeamSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function changeProjectStatusHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await changeProjectStatus(req.params.id, changeProjectStatusSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function addMilestoneHandler(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  try { return res.status(201).json(await addMilestone(req.params.id, addMilestoneSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function updateMilestoneHandler(req: Request<{ milestoneId: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await updateMilestone(req.params.milestoneId, updateMilestoneSchema.parse(req.body), req.user!)) }
  catch (err) { return next(err) }
}

export async function removeMilestoneHandler(req: Request<{ milestoneId: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await removeMilestone(req.params.milestoneId, req.user!)) }
  catch (err) { return next(err) }
}

export async function tickLineHandler(req: Request<{ id: string; lineId: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await tickLine(req.params.id, req.params.lineId, req.user!)) }
  catch (err) { return next(err) }
}

export async function untickLineHandler(req: Request<{ id: string; lineId: string }>, res: Response, next: NextFunction) {
  try { return res.status(200).json(await untickLine(req.params.id, req.params.lineId, req.user!)) }
  catch (err) { return next(err) }
}
