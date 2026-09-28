import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  approveInvoiceHandler,
  createInvoiceHandler,
  getInvoiceHandler,
  listInvoiceablePosHandler,
  listInvoicesHandler,
  updateInvoiceHandler,
} from "./invoice.controller"

const router = Router()
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, requireRole(...WRITE_ROLES), listInvoicesHandler)
// Literal path before "/:id", or Express reads "pos" as an invoice id.
router.get("/pos", requireAuth, requireRole(...WRITE_ROLES), listInvoiceablePosHandler)
router.get("/:id", requireAuth, requireRole(...WRITE_ROLES), getInvoiceHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createInvoiceHandler)
router.patch("/:id", requireAuth, requireRole(...WRITE_ROLES), updateInvoiceHandler)
router.post("/:id/approve", requireAuth, requireRole(Role.SUPER_ADMIN), approveInvoiceHandler)

export default router
