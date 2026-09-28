import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  getDealHandler,
  listApprovalsHandler,
  listDealsHandler,
  sendBackHandler,
  vatSummaryHandler,
} from "./dealMoney.controller"

const router = Router()
const FINANCE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

// Literal paths before :param paths.
router.get("/deals", requireAuth, requireRole(...FINANCE_ROLES), listDealsHandler)
router.get("/approvals", requireAuth, requireRole(...FINANCE_ROLES), listApprovalsHandler)
router.post("/approvals/:kind/:id/send-back", requireAuth, requireRole(Role.SUPER_ADMIN), sendBackHandler)
router.get("/vat-summary", requireAuth, requireRole(...FINANCE_ROLES), vatSummaryHandler)
// Anyone signed in; getDealMoney itself checks deal access (assertDealAccess),
// so a sales user with no access is refused before any figure is read.
router.get("/deals/:opportunityId", requireAuth, getDealHandler)

export default router
