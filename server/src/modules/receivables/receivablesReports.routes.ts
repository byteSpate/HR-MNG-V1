import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  customerAgeingHandler,
  customerStatementHandler,
  customerStatementPdfHandler,
  customerTieOutHandler,
} from "./receivablesReports.controller"

const router = Router()
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/reports/ageing", requireAuth, requireRole(...WRITE_ROLES), customerAgeingHandler)
router.get("/reports/tie-out", requireAuth, requireRole(...WRITE_ROLES), customerTieOutHandler)
// .pdf variant first: Express would otherwise treat "statement.pdf" as
// matching the plain "statement" path only by accident of no conflict, but
// keeping the more specific route first is the same defensive ordering the
// rest of this codebase uses for literal-before-:id routes.
router.get("/customers/:id/statement.pdf", requireAuth, requireRole(...WRITE_ROLES), customerStatementPdfHandler)
router.get("/customers/:id/statement", requireAuth, requireRole(...WRITE_ROLES), customerStatementHandler)

export default router
