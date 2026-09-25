import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  createSupplierPaymentHandler,
  getSupplierPaymentHandler,
  listSupplierPaymentsHandler,
  reverseSupplierPaymentHandler,
} from "./supplierPayment.controller"

const router = Router()
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, requireRole(...WRITE_ROLES), listSupplierPaymentsHandler)
router.get("/:id", requireAuth, requireRole(...WRITE_ROLES), getSupplierPaymentHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createSupplierPaymentHandler)
router.post("/:id/reverse", requireAuth, requireRole(Role.SUPER_ADMIN), reverseSupplierPaymentHandler)

export default router
