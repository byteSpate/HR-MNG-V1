import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  approveReceiptHandler,
  createReceiptHandler,
  getReceiptHandler,
  listReceiptsHandler,
  matchCustomerAdvanceHandler,
  updateReceiptCertificatesHandler,
} from "./receipt.controller"

const router = Router()
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, requireRole(...WRITE_ROLES), listReceiptsHandler)
router.get("/:id", requireAuth, requireRole(...WRITE_ROLES), getReceiptHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createReceiptHandler)
router.patch("/:id/certificates", requireAuth, requireRole(...WRITE_ROLES), updateReceiptCertificatesHandler)
router.post("/:id/approve", requireAuth, requireRole(Role.SUPER_ADMIN), approveReceiptHandler)
router.post("/:id/match-advance", requireAuth, requireRole(...WRITE_ROLES), matchCustomerAdvanceHandler)

export default router
