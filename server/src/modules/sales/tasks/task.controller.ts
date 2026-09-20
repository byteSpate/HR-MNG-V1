import type { NextFunction, Request, Response } from "express"

import { changeTaskStatus, createTask, getTask, listTasks, updateTask } from "./task.service"
import { changeTaskStatusSchema, createTaskSchema, listTaskSchema, updateTaskSchema } from "./task.validators"

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
