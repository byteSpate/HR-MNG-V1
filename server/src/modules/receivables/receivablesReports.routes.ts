import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import { customerAgeingHandler, customerTieOutHandler } from "./receivablesReports.controller"

const router = Router()
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/reports/ageing", requireAuth, requireRole(...WRITE_ROLES), customerAgeingHandler)
router.get("/reports/tie-out", requireAuth, requireRole(...WRITE_ROLES), customerTieOutHandler)

export default router
