import { Router } from "express"

import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  createSupplierHandler,
  deactivateSupplierHandler,
  getSupplierHandler,
  listSuppliersHandler,
  updateSupplierHandler,
} from "./supplier.controller"

const router = Router()

const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, listSuppliersHandler)
router.get("/:id", requireAuth, getSupplierHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createSupplierHandler)
router.patch("/:id", requireAuth, requireRole(...WRITE_ROLES), updateSupplierHandler)
router.post("/:id/deactivate", requireAuth, requireRole(...WRITE_ROLES), deactivateSupplierHandler)

export default router
