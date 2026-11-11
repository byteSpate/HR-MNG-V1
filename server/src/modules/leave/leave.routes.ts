import { Router } from "express"

import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import { Role } from "../../generated/prisma/client"
import {
  applyForLeaveHandler,
  approveLeaveRequestHandler,
  cancelLeaveRequestHandler,
  createLeaveTypeHandler,
  deleteLeaveTypeHandler,
  getBalancesForHandler,
  getHalfDayWindowHandler,
  getMyBalancesHandler,
  getTeamStatusHandler,
  listLeaveRequestsHandler,
  listLeaveTypesHandler,
  rejectLeaveRequestHandler,
  revertLeaveRequestHandler,
  updateLeaveTypeHandler,
} from "./leave.controller"
import { leaveReportHandler } from "./leave.report"

const router = Router()

/** Roles that hold leave of their own — the only ones with an Employee profile. */
const STAFF_ROLES = [Role.EMPLOYEE, Role.REPORTING_MANAGER] as const

/** Roles that decide on leave. Reporting managers are read-only here. */
const REVIEWER_ROLES = [Role.HR_ADMIN, Role.SUPER_ADMIN] as const

/** Who may author the catalogue. Reading it stays open — every leave
 *  application form needs the list. */
const CATALOGUE_ROLES = [Role.HR_ADMIN, Role.SUPER_ADMIN] as const

router.get("/types", requireAuth, listLeaveTypesHandler)
router.post("/types", requireAuth, requireRole(...CATALOGUE_ROLES), createLeaveTypeHandler)
router.patch("/types/:id", requireAuth, requireRole(...CATALOGUE_ROLES), updateLeaveTypeHandler)
router.delete("/types/:id", requireAuth, requireRole(...CATALOGUE_ROLES), deleteLeaveTypeHandler)
// Above any `/requests/:id` route below — Express would otherwise match
// "half-day-window" as an id. Not role-gated beyond auth: it returns the
// caller's own shift window and nothing else.
router.get("/half-day-window", requireAuth, requireRole(...STAFF_ROLES), getHalfDayWindowHandler)
router.get("/balances/me", requireAuth, requireRole(...STAFF_ROLES), getMyBalancesHandler)
// No requireRole: access depends on the relationship between caller and
// subject, resolved through employee.access.ts.
router.get("/balances/:employeeId", requireAuth, getBalancesForHandler)
router.get("/requests", requireAuth, listLeaveRequestsHandler)
// The Leave report on the Reports page.
router.get("/report", requireAuth, requireRole(...REVIEWER_ROLES), leaveReportHandler)
router.get("/team-status", requireAuth, requireRole(Role.REPORTING_MANAGER), getTeamStatusHandler)
router.post("/requests", requireAuth, requireRole(...STAFF_ROLES), applyForLeaveHandler)

router.patch(
  "/requests/:id/approve",
  requireAuth,
  requireRole(...REVIEWER_ROLES),
  approveLeaveRequestHandler
)
router.patch(
  "/requests/:id/reject",
  requireAuth,
  requireRole(...REVIEWER_ROLES),
  rejectLeaveRequestHandler
)
router.patch(
  "/requests/:id/revert",
  requireAuth,
  requireRole(...REVIEWER_ROLES),
  revertLeaveRequestHandler
)
router.patch("/requests/:id/cancel", requireAuth, requireRole(...STAFF_ROLES), cancelLeaveRequestHandler)

export default router
