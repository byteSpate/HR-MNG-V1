import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  approveSupplierPaymentHandler,
  createSupplierPaymentHandler,
  getSupplierPaymentHandler,
  listSupplierPaymentsHandler,
} from "./supplierPayment.controller"

const router = Router()
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, requireRole(...WRITE_ROLES), listSupplierPaymentsHandler)
router.get("/:id", requireAuth, requireRole(...WRITE_ROLES), getSupplierPaymentHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createSupplierPaymentHandler)
router.post("/:id/approve", requireAuth, requireRole(Role.SUPER_ADMIN), approveSupplierPaymentHandler)

export default router
