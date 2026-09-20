import { Router } from "express"

import { SalesRole } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireSales } from "../../middleware/requireSales"
import accountRouter from "./accounts/account.routes"
import commentRouter from "./comments/comment.routes"
import dashboardRouter from "./dashboard/dashboard.routes"
import funnelRouter from "./funnel/funnel.routes"
import meetingRouter from "./meetings/meeting.routes"
import minutesRouter from "./minutes/minutes.routes"
import opportunityRouter from "./opportunities/opportunity.routes"
import targetRouter from "./targets/target.routes"
import taskRouter from "./tasks/task.routes"
import weeklyRouter from "./weekly/weekly.routes"

const router = Router()

router.use(accountRouter)

router.use(opportunityRouter)

router.use(commentRouter)

router.use(meetingRouter)

router.use(taskRouter)

router.use(minutesRouter)

router.use(weeklyRouter)

// The funnel (revision §27), mounted rather than spelled out. Phases 1 to 5
// each added their paths to this file and it now carries every route in the
// module; the funnel keeps its own router, which is the shape §28 will move
// the rest into.
router.use("/funnel", funnelRouter)

export default router

router.use(targetRouter)
router.use(dashboardRouter)
