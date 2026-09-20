import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { changeTaskStatusHandler, createTaskHandler, getTaskHandler, listTasksHandler, updateTaskHandler } from "./task.controller"

const router = Router()

// Tasks. Everyone makes tasks for themselves in this phase; the service
// decides who may read one and keeps changing it to its owner.
router.get("/tasks", requireAuth, requireSales(), listTasksHandler)
router.post("/tasks", requireAuth, requireSales(), createTaskHandler)
router.get("/tasks/:id", requireAuth, requireSales(), getTaskHandler)
router.patch("/tasks/:id", requireAuth, requireSales(), updateTaskHandler)
router.patch("/tasks/:id/status", requireAuth, requireSales(), changeTaskStatusHandler)

export default router
