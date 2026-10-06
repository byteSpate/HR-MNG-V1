import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  createReceiptHandler,
  getReceiptHandler,
  listReceiptsHandler,
  receiptPdfHandler,
  reverseReceiptHandler,
  updateReceiptCertificatesHandler,
} from "./receipt.controller"

const router = Router()
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, requireRole(...WRITE_ROLES), listReceiptsHandler)
// Any signed-in user at the route. renderReceiptPdf checks access to the
// receipt's Opportunity, so a Sales user reaches only their own, and Finance
// reaches all. A different path depth from "/:id", so nothing shadows it.
router.get("/:id/pdf", requireAuth, receiptPdfHandler)
router.get("/:id", requireAuth, requireRole(...WRITE_ROLES), getReceiptHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createReceiptHandler)
router.patch("/:id/certificates", requireAuth, requireRole(...WRITE_ROLES), updateReceiptCertificatesHandler)
router.post("/:id/reverse", requireAuth, requireRole(Role.SUPER_ADMIN), reverseReceiptHandler)

export default router
