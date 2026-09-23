import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  approveSupplierCreditNoteHandler,
  createSupplierCreditNoteHandler,
  getSupplierCreditNoteHandler,
  listSupplierCreditNotesHandler,
} from "./supplierCreditNote.controller"

const router = Router()
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, listSupplierCreditNotesHandler)
router.get("/:id", requireAuth, getSupplierCreditNoteHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createSupplierCreditNoteHandler)
router.post("/:id/approve", requireAuth, requireRole(Role.SUPER_ADMIN), approveSupplierCreditNoteHandler)

export default router
