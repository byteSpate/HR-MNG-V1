import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import {
  addMilestoneHandler, changeProjectStatusHandler, getProjectHandler, listProjectsHandler,
  removeMilestoneHandler, setProjectTeamHandler, startProjectHandler, tickLineHandler,
  untickLineHandler, updateMilestoneHandler, updateProjectHandler,
} from "./project.controller"

const router = Router()

// Projects (spec 2026-09-28 §1.7, §1.10). Literal paths before `:id`.
// Milestones use `/project-milestones/:milestoneId` rather than
// `/projects/milestones/:milestoneId`, so `/projects/:id` can never read
// "milestones" as an id.
router.post("/opportunities/:id/project", requireAuth, requireSales(), startProjectHandler)
router.get("/projects", requireAuth, requireSales(), listProjectsHandler)
router.patch("/project-milestones/:milestoneId", requireAuth, requireSales(), updateMilestoneHandler)
router.delete("/project-milestones/:milestoneId", requireAuth, requireSales(), removeMilestoneHandler)
router.get("/projects/:id", requireAuth, requireSales(), getProjectHandler)
router.patch("/projects/:id", requireAuth, requireSales(), updateProjectHandler)
router.put("/projects/:id/team", requireAuth, requireSales(), setProjectTeamHandler)
router.patch("/projects/:id/status", requireAuth, requireSales(), changeProjectStatusHandler)
router.post("/projects/:id/milestones", requireAuth, requireSales(), addMilestoneHandler)
router.put("/projects/:id/lines/:lineId/done", requireAuth, requireSales(), tickLineHandler)
router.delete("/projects/:id/lines/:lineId/done", requireAuth, requireSales(), untickLineHandler)

export default router
