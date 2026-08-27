import { Router } from "express"

import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  approveClaimHandler,
  createClaimHandler,
  getClaimHandler,
  getMyClaimsHandler,
  listClaimsHandler,
  rejectClaimHandler,
  listExpenseCategoriesHandler, createExpenseCategoryHandler, updateExpenseCategoryHandler, deleteExpenseCategoryHandler,
  uploadClaimReceiptHandler,
  listClaimReceiptsHandler,
  getClaimReceiptUrlHandler,
  deleteClaimReceiptHandler,
  getExpenseReportHandler,
  updateClaimHandler,
  deleteClaimHandler,
} from "./expense.controller"
import { expenseUpload } from "../media/media.upload"

const router = Router()

/** Roles with an Employee profile, and therefore expenses of their own. */
const STAFF_ROLES = [Role.EMPLOYEE, Role.REPORTING_MANAGER] as const
const FINANCE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const
const READ_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN, Role.HR_ADMIN] as const

router.post("/", requireAuth, requireRole(...STAFF_ROLES), createClaimHandler)
router.get("/categories", requireAuth, requireRole(...STAFF_ROLES, ...READ_ROLES), listExpenseCategoriesHandler)
router.post("/categories", requireAuth, requireRole(...FINANCE_ROLES), createExpenseCategoryHandler)
router.patch("/categories/:id", requireAuth, requireRole(...FINANCE_ROLES), updateExpenseCategoryHandler)
router.delete("/categories/:id", requireAuth, requireRole(...FINANCE_ROLES), deleteExpenseCategoryHandler)
// Reports. Before `/:id` in the file for readability; Express matches the
// longer literal path first regardless. `requireAuth` alone because the scope
// is decided from the caller inside `expense.report.ts` — see the note there.
router.get("/report", requireAuth, getExpenseReportHandler)

// Before /:id, or Express would match "me" as a claim id.
router.get("/me", requireAuth, requireRole(...STAFF_ROLES), getMyClaimsHandler)
router.get("/", requireAuth, requireRole(...READ_ROLES), listClaimsHandler)
// Receipts. Before `/:id` would be wrong — these are longer paths, so Express
// matches them first regardless — but they sit here to read in claim order.
//
// Every one is `requireAuth` alone rather than `requireRole`: an employee
// attaches to their own claim and Finance reads anybody's, and that split is
// decided per claim inside `expense.media.ts`, which is the only place that
// knows whose claim it is. A route-level role list could only say "staff or
// finance", which is both roles and therefore no check at all.
// `expenseUpload` is already a complete handler with .single("file") baked in
// — calling .single() on it again throws at request time. Same as costUpload.
router.post("/:id/receipts", requireAuth, expenseUpload, uploadClaimReceiptHandler)
router.get("/:id/receipts", requireAuth, listClaimReceiptsHandler)
router.get("/receipts/:id/url", requireAuth, getClaimReceiptUrlHandler)
router.delete("/receipts/:id", requireAuth, deleteClaimReceiptHandler)

router.get("/:id", requireAuth, getClaimHandler)

// REIMBURSED has no route. It is set by a run being disbursed or a
// settlement being paid — a status the system reaches, not one a human
// types. That is the difference between a workflow and a status field.
// Amending and withdrawing your own claim. `requireAuth` alone: the rule is
// owner-and-PENDING, which only the service can check — a role list here could
// say no more than "staff", and every claimant is staff.
//
// Finance has no edit. Their answer to a wrong claim is reject-with-a-note,
// which leaves a record of the disagreement; silently correcting somebody's
// figures and then approving them does not.
router.patch("/:id", requireAuth, requireRole(...STAFF_ROLES), updateClaimHandler)
router.delete("/:id", requireAuth, requireRole(...STAFF_ROLES), deleteClaimHandler)

router.patch("/:id/approve", requireAuth, requireRole(...FINANCE_ROLES), approveClaimHandler)
router.patch("/:id/reject", requireAuth, requireRole(...FINANCE_ROLES), rejectClaimHandler)

export default router
