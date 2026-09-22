import { Router } from "express"

import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import { spreadsheetUpload } from "../media/media.upload"
import {
  commitCustomerOpeningBalancesHandler,
  createCustomerHandler,
  getCustomerHandler,
  listCustomersHandler,
  previewCustomerOpeningBalancesHandler,
  updateCustomerHandler,
} from "./customer.controller"

const router = Router()

// Finance owns customer records; Super Admin can act on Finance's behalf,
// same posture as every money-adjacent module in this codebase.
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, listCustomersHandler)
router.get("/:id", requireAuth, getCustomerHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createCustomerHandler)
router.patch("/:id", requireAuth, requireRole(...WRITE_ROLES), updateCustomerHandler)

// spreadsheetUpload is already a complete handler with .single("file")
// baked in, matching cost.routes.ts's import endpoints exactly.
router.post(
  "/opening-balances/preview",
  requireAuth,
  requireRole(...WRITE_ROLES),
  spreadsheetUpload,
  previewCustomerOpeningBalancesHandler
)
// Commit is Super Admin only, matching the design's "Finance Officer
// uploads, Super Admin approves" split — unlike cost's importer, which
// uses WRITE_ROLES for both, because this feature's approval workflow is
// a deliberate, stricter choice (design §6), not the general import
// kernel's own convention.
router.post(
  "/opening-balances/commit",
  requireAuth,
  requireRole(Role.SUPER_ADMIN),
  spreadsheetUpload,
  commitCustomerOpeningBalancesHandler
)

export default router
