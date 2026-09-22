import { Router } from "express"

import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import { spreadsheetUpload } from "../media/media.upload"
import {
  commitSupplierOpeningBalancesHandler,
  createSupplierHandler,
  deactivateSupplierHandler,
  getSupplierHandler,
  listSuppliersHandler,
  previewSupplierOpeningBalancesHandler,
  reactivateSupplierHandler,
  updateSupplierHandler,
} from "./supplier.controller"

const router = Router()

const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, listSuppliersHandler)
router.get("/:id", requireAuth, getSupplierHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createSupplierHandler)
router.patch("/:id", requireAuth, requireRole(...WRITE_ROLES), updateSupplierHandler)
router.post("/:id/deactivate", requireAuth, requireRole(...WRITE_ROLES), deactivateSupplierHandler)
router.post("/:id/reactivate", requireAuth, requireRole(...WRITE_ROLES), reactivateSupplierHandler)

router.post(
  "/opening-balances/preview",
  requireAuth,
  requireRole(...WRITE_ROLES),
  spreadsheetUpload,
  previewSupplierOpeningBalancesHandler
)
// Commit is Super Admin only, matching Customer's opening-balance import
// exactly (design §6's approval-workflow split).
router.post(
  "/opening-balances/commit",
  requireAuth,
  requireRole(Role.SUPER_ADMIN),
  spreadsheetUpload,
  commitSupplierOpeningBalancesHandler
)

export default router
