import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  approveCustomerCreditNoteHandler,
  createCustomerCreditNoteHandler,
  getCustomerCreditNoteHandler,
  listCustomerCreditNotesHandler,
} from "./customerCreditNote.controller"

const router = Router()
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, requireRole(...WRITE_ROLES), listCustomerCreditNotesHandler)
router.get("/:id", requireAuth, requireRole(...WRITE_ROLES), getCustomerCreditNoteHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createCustomerCreditNoteHandler)
router.post("/:id/approve", requireAuth, requireRole(Role.SUPER_ADMIN), approveCustomerCreditNoteHandler)

export default router
