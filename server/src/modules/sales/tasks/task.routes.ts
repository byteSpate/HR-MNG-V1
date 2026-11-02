import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { requireSalesPermission } from "../../../middleware/requireSalesPermission"
import {
  changeTaskStatusHandler, createTaskHandler, getTaskHandler, listTasksHandler, logDoneTaskHandler, updateTaskHandler,
} from "./task.controller"

const router = Router()

// Tasks. Everyone makes tasks for themselves in this phase; the service
// decides who may read one and keeps changing it to its owner.
router.get("/tasks", requireAuth, requireSales(), listTasksHandler)
router.post("/tasks", requireAuth, requireSales(), requireSalesPermission("task.create"), createTaskHandler)
// "I did this": a literal path, so it sits before any /tasks/:id.
router.post("/tasks/done", requireAuth, requireSales(), requireSalesPermission("task.create"), logDoneTaskHandler)
router.get("/tasks/:id", requireAuth, requireSales(), getTaskHandler)
router.patch("/tasks/:id", requireAuth, requireSales(), updateTaskHandler)
router.patch("/tasks/:id/status", requireAuth, requireSales(), changeTaskStatusHandler)

export default router
