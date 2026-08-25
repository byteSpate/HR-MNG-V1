import { Router } from "express"

import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import { Role } from "../../generated/prisma/client"
import {
  approveAttendanceHandler,
  bulkDecideHandler,
  checkInHandler,
  checkOutHandler,
  correctAttendanceHandler,
  createHolidayHandler,
  createManualAttendanceHandler,
  deleteHolidayHandler,
  getAuditTrailHandler,
  getDailySummaryHandler,
  getEmployeeAttendanceHandler,
  getMonthlySummaryHandler,
  getMyAttendanceHandler,
  getReportHandler,
  getTodayHandler,
  listApprovalsHandler,
  listHolidaysHandler,
  createShiftHandler,
  deleteShiftHandler,
  listShiftsHandler,
  updateShiftHandler,
  regulariseHandler,
  rejectAttendanceHandler,
  updateHolidayHandler,
} from "./attendance.controller"

const router = Router()

/** Roles with an Employee profile — the only ones who can hold attendance. */
export const STAFF_ROLES = [Role.EMPLOYEE, Role.REPORTING_MANAGER] as const

/** Roles that can decide on an attendance record. */
export const APPROVER_ROLES = [
  Role.REPORTING_MANAGER,
  Role.HR_ADMIN,
  Role.SUPER_ADMIN,
] as const

/** Roles that can correct a record or manage the holiday calendar. */
export const HR_ROLES = [Role.HR_ADMIN, Role.SUPER_ADMIN] as const

// Neither punch route reads a body: a client-supplied time is spoofable and
// wrong the moment somebody opens the app from another timezone.
router.post("/check-in", requireAuth, requireRole(...STAFF_ROLES), checkInHandler)
router.post("/check-out", requireAuth, requireRole(...STAFF_ROLES), checkOutHandler)

router.get("/today", requireAuth, requireRole(...STAFF_ROLES), getTodayHandler)
router.get("/me", requireAuth, requireRole(...STAFF_ROLES), getMyAttendanceHandler)

// A separate /me path rather than a "me" sentinel in a slot that otherwise
// holds a UUID — the same choice as /api/leave/balances/me.
//
// Only requireAuth here: visibility is scoped inside the service, because
// the rule differs per role rather than per route.
router.get("/history/:employeeId", requireAuth, getEmployeeAttendanceHandler)

// Rosters are scoped in the service too. An employee gets a one-row
// response rather than a 403, so the route shape stays uniform.
router.get("/summary/daily", requireAuth, getDailySummaryHandler)
router.get("/summary/monthly", requireAuth, getMonthlySummaryHandler)

// Daily, weekly and custom-range reports, JSON or CSV. Scoped in the service
// through the same roster as the summaries above, so an employee can export
// their own attendance and a manager only their team's — which is why this is
// requireAuth rather than requireRole.
router.get("/report", requireAuth, getReportHandler)

// The employee amending their own day. A separate path from HR's PATCH
// /:id on purpose: this one *requests* a change and cannot grant it.
router.patch("/me/:id/regularise", requireAuth, requireRole(...STAFF_ROLES), regulariseHandler)

// HR acting with authority.
router.post("/manual", requireAuth, requireRole(...HR_ROLES), createManualAttendanceHandler)

// Declared before the /:id routes for clarity. They do not actually
// collide — /:id/approve cannot match /approvals/bulk — but relying on that
// is a trap for the next person to add a route here.
router.patch("/approvals/bulk", requireAuth, requireRole(...APPROVER_ROLES), bulkDecideHandler)
router.get("/approvals", requireAuth, requireRole(...APPROVER_ROLES), listApprovalsHandler)

// Role alone is not enough: entitlement is re-checked per record in the
// service, because a manager may only decide their own reports.
router.patch("/:id/approve", requireAuth, requireRole(...APPROVER_ROLES), approveAttendanceHandler)
router.patch("/:id/reject", requireAuth, requireRole(...APPROVER_ROLES), rejectAttendanceHandler)

// The dispute trail. HR only — it names who changed what.
router.get("/:id/audit", requireAuth, requireRole(...HR_ROLES), getAuditTrailHandler)
router.patch("/:id", requireAuth, requireRole(...HR_ROLES), correctAttendanceHandler)

// The employee-create/edit forms' shift picker. Only HR assigns a shift.
// Ordering note: `PATCH "/:id"` is registered above. It does not shadow
// `PATCH /shifts/:id`, because `/:id` matches a single path segment and
// `/shifts/abc` has two — the holiday routes below rely on the same property.
// Do not move these above the `/:id` group; that is what would break them.
router.get("/shifts", requireAuth, requireRole(...HR_ROLES), listShiftsHandler)
router.post("/shifts", requireAuth, requireRole(...HR_ROLES), createShiftHandler)
router.patch("/shifts/:id", requireAuth, requireRole(...HR_ROLES), updateShiftHandler)
router.delete("/shifts/:id", requireAuth, requireRole(...HR_ROLES), deleteShiftHandler)

// Everyone reads the calendar; only HR writes it.
router.get("/holidays", requireAuth, listHolidaysHandler)
router.post("/holidays", requireAuth, requireRole(...HR_ROLES), createHolidayHandler)
router.patch("/holidays/:id", requireAuth, requireRole(...HR_ROLES), updateHolidayHandler)
router.delete("/holidays/:id", requireAuth, requireRole(...HR_ROLES), deleteHolidayHandler)

export default router
