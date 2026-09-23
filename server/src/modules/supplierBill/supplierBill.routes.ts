import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  approveSupplierBillHandler,
  billableOpportunitiesHandler,
  createSupplierBillHandler,
  getSupplierBillHandler,
  listSupplierBillsHandler,
  supplierAgeingHandler,
  supplierTieOutHandler,
  updateSupplierBillHandler,
} from "./supplierBill.controller"

const router = Router()
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, requireRole(...WRITE_ROLES), listSupplierBillsHandler)
// Literal paths before "/:id", or Express reads "reports" as a bill id.
router.get("/reports/ageing", requireAuth, requireRole(...WRITE_ROLES), supplierAgeingHandler)
router.get("/reports/tie-out", requireAuth, requireRole(...WRITE_ROLES), supplierTieOutHandler)
router.get("/opportunities", requireAuth, requireRole(...WRITE_ROLES), billableOpportunitiesHandler)
router.get("/:id", requireAuth, requireRole(...WRITE_ROLES), getSupplierBillHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createSupplierBillHandler)
router.patch("/:id", requireAuth, requireRole(...WRITE_ROLES), updateSupplierBillHandler)
router.post("/:id/approve", requireAuth, requireRole(Role.SUPER_ADMIN), approveSupplierBillHandler)

export default router
