import { Router } from "express"

import { SalesRole } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireSales } from "../../middleware/requireSales"
import accountRouter from "./accounts/account.routes"
import commentRouter from "./comments/comment.routes"
import funnelRouter from "./funnel/funnel.routes"
import meetingRouter from "./meetings/meeting.routes"
import minutesRouter from "./minutes/minutes.routes"
import opportunityRouter from "./opportunities/opportunity.routes"
import targetRouter from "./targets/target.routes"
import taskRouter from "./tasks/task.routes"
import {
  getSalesDashboardHandler,
} from "./sales.controller"
import {
  addOtherWorkHandler,
  getEmployeeWeekHandler,
  getMyWeekHandler,
  listTeamWeekHandler,
  removeOtherWorkHandler,
  saveWeeklyNoteHandler,
  previewMyWeekHandler,
  submitMyWeekHandler,
  weeklyCopyHandler,
} from "./weekly.controller"

const router = Router()

router.use(accountRouter)

router.use(opportunityRouter)

router.use(commentRouter)

router.use(meetingRouter)

router.use(taskRouter)

router.use(minutesRouter)

// The Weekly Report (revision §26). Open to the hub at the route; the service
// decides the rest: only a Sales User writes, and only their own week. All
// Reports is guarded here as well, because it is an admin screen end to end.
router.get("/weekly", requireAuth, requireSales(), getMyWeekHandler)
router.put("/weekly/notes", requireAuth, requireSales(), saveWeeklyNoteHandler)
router.post("/weekly/other-work", requireAuth, requireSales(), addOtherWorkHandler)
router.delete("/weekly/other-work/:id", requireAuth, requireSales(), removeOtherWorkHandler)
// Submitting keeps the copy and answers with that same file; a kept copy
// downloads again exactly as it was (§26.17).
// A look at the week as it would print, keeping nothing (the owner's ask,
// 2026-09-16). Before /weekly/submit, which is the one that records.
router.get("/weekly/preview", requireAuth, requireSales(), previewMyWeekHandler)
router.post("/weekly/submit", requireAuth, requireSales(), submitMyWeekHandler)
router.get("/weekly/copies/:id/file", requireAuth, requireSales(), weeklyCopyHandler)
// Before /weekly/all/:employeeId, or the path is read as an employee id.
router.get("/weekly/all", requireAuth, requireSales(SalesRole.SALES_ADMIN), listTeamWeekHandler)
router.get(
  "/weekly/all/:employeeId",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  getEmployeeWeekHandler
)

// The funnel (revision §27), mounted rather than spelled out. Phases 1 to 5
// each added their paths to this file and it now carries every route in the
// module; the funnel keeps its own router, which is the shape §28 will move
// the rest into.
router.use("/funnel", funnelRouter)

export default router

router.use(targetRouter)
router.get("/dashboard", requireAuth, requireSales(), getSalesDashboardHandler)
