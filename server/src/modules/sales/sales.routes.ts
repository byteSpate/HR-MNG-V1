/**
 * The Sales Hub's routes. Each feature folder owns its own router (accounts,
 * opportunities, comments, meetings, tasks, minutes, weekly, funnel, targets,
 * dashboard); this file only mounts them, in the order their routes were first
 * registered, so first-match order is unchanged. The routers are mounted at
 * `/` with full paths, except the funnel, which keeps `/funnel`.
 */

import { Router } from "express"

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

// Each folder owns its routes and this file only mounts them (§28). The order
// is the order the routes were registered in before the split, so first-match
// precedence is unchanged. The funnel (revision §27) alone sits under a prefix.
router.use("/funnel", funnelRouter)

router.use(targetRouter)

router.use(dashboardRouter)

export default router
