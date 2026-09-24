import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import { createVatCodeHandler, listVatCodesHandler, updateVatCodeHandler } from "./vatCode.controller"

const router = Router()
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, listVatCodesHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createVatCodeHandler)
router.patch("/:id", requireAuth, requireRole(...WRITE_ROLES), updateVatCodeHandler)

export default router
