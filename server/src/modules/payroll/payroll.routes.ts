import { Router } from "express"

import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  approveRunHandler,
  bankFileHandler,
  emailRunHandler,
  emailStatusHandler,
  bankFileSummaryHandler,
  createRateHandler,
  createAdjustmentHandler,
  createRunHandler,
  createStructureHandler,
  deleteAdjustmentHandler,
  deleteRunHandler,
  deleteStructureHandler,
  disburseRunHandler,
  getEmployeePayslipsHandler,
  getMyPayslipsHandler,
  getPayslipHandler,
  payslipPdfHandler,
  getRunHandler,
  getSettingsHandler,
  updateSettingsHandler,
  getRunPreflightHandler,
  listAdjustmentsHandler,
  listRatesHandler,
  listRunsHandler,
  listStructuresHandler,
  processRunHandler,
  rejectRunHandler,
  submitRunHandler,
  updateRateHandler,
  updateStructureHandler,
} from "./payroll.controller"

const router = Router()

const FINANCE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const
const READ_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN, Role.HR_ADMIN] as const
/** Roles that hold an Employee profile and therefore a payslip of their own. */
const STAFF_ROLES = [Role.EMPLOYEE, Role.REPORTING_MANAGER] as const

// Open to any authenticated role, not just READ_ROLES: an employee's own
// payslip quotes the rate, and a figure they cannot check is a figure they
// will dispute.
router.get("/exchange-rates", requireAuth, listRatesHandler)
router.post("/exchange-rates", requireAuth, requireRole(...FINANCE_ROLES), createRateHandler)
router.patch("/exchange-rates/:id", requireAuth, requireRole(...FINANCE_ROLES), updateRateHandler)

// Payroll rules. Finance and Super Admin switch them; HR may read.
router.get("/settings", requireAuth, requireRole(...READ_ROLES), getSettingsHandler)
router.patch("/settings", requireAuth, requireRole(...FINANCE_ROLES), updateSettingsHandler)

// Finance owns structures, not HR: HR owns adjustments (Task 10), but a
// salary structure is a treasury fact, not a benefit decision.
router.get("/salary-structures", requireAuth, requireRole(...READ_ROLES), listStructuresHandler)
router.post("/salary-structures", requireAuth, requireRole(...FINANCE_ROLES), createStructureHandler)
router.patch(
  "/salary-structures/:id",
  requireAuth,
  requireRole(...FINANCE_ROLES),
  updateStructureHandler
)
// A hard delete, not a soft one. Payslips freeze their own figures and hold
// no reference to a structure, so removing one cannot make a paid month
// unexplainable; the 409 guards the live assignments instead.
router.delete(
  "/salary-structures/:id",
  requireAuth,
  requireRole(...FINANCE_ROLES),
  deleteStructureHandler
)

// Finance, Super Admin and HR all read; only Finance/Super Admin write, and
// approve is Super Admin only — the plan's separation of duties, so nobody
// can move money alone.
router.get("/runs", requireAuth, requireRole(...READ_ROLES), listRunsHandler)
router.get("/runs/:id", requireAuth, requireRole(...READ_ROLES), getRunHandler)
router.get("/runs/:id/preflight", requireAuth, requireRole(...READ_ROLES), getRunPreflightHandler)
router.post("/runs", requireAuth, requireRole(...FINANCE_ROLES), createRunHandler)
router.post("/runs/:id/process", requireAuth, requireRole(...FINANCE_ROLES), processRunHandler)
// A draft run only; the service refuses any other status. Finance and Super Admin.
router.delete("/runs/:id", requireAuth, requireRole(...FINANCE_ROLES), deleteRunHandler)
router.post("/runs/:id/submit", requireAuth, requireRole(...FINANCE_ROLES), submitRunHandler)
router.post("/runs/:id/approve", requireAuth, requireRole(Role.SUPER_ADMIN), approveRunHandler)
router.post("/runs/:id/reject", requireAuth, requireRole(Role.SUPER_ADMIN), rejectRunHandler)
router.post("/runs/:id/disburse", requireAuth, requireRole(...FINANCE_ROLES), disburseRunHandler)

// GET, not POST: a pure read producing a file, with no side effects. POST
// would misrepresent it and break re-downloading.
router.get("/runs/:id/bank-file", requireAuth, requireRole(...FINANCE_ROLES), bankFileHandler)
router.get(
  "/runs/:id/bank-file/summary",
  requireAuth,
  requireRole(...FINANCE_ROLES),
  bankFileSummaryHandler
)

//  is a separate path rather than a "me" sentinel in a slot
// that otherwise holds a UUID — the same choice as /api/leave/balances/me
// and /api/attendance/me. It must be registered before /payslips/:id, or
// Express would match "me" as an id.
router.get("/payslips/me", requireAuth, requireRole(...STAFF_ROLES), getMyPayslipsHandler)
// Scoping is enforced in the service, not here: staff may read only
// themselves, and a manager may not read their reports' pay.
router.get("/payslips/employee/:employeeId", requireAuth, getEmployeePayslipsHandler)
router.get("/payslips/:id", requireAuth, getPayslipHandler)
router.get("/payslips/:id/pdf", requireAuth, payslipPdfHandler)

router.post("/runs/:id/email", requireAuth, requireRole(...FINANCE_ROLES), emailRunHandler)
router.get("/runs/:id/email-status", requireAuth, requireRole(...READ_ROLES), emailStatusHandler)

// HR creates adjustments; Finance cannot. A festival bonus is an HR decision
// that Finance pays. The matrix gives HR read-only on payroll precisely so
// they cannot move money alone - an adjustment still has to survive Finance
// processing and Super Admin approving. Giving HR the create right is what
// stops Finance approving its own inputs.
const HR_ROLES = [Role.HR_ADMIN, Role.SUPER_ADMIN] as const

router.get("/adjustments", requireAuth, requireRole(...READ_ROLES), listAdjustmentsHandler)
router.post("/adjustments", requireAuth, requireRole(...HR_ROLES), createAdjustmentHandler)
router.delete("/adjustments/:id", requireAuth, requireRole(...HR_ROLES), deleteAdjustmentHandler)

export default router
