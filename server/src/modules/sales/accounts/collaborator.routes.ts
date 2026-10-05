import { Router } from "express"

import { SalesRole } from "../../../generated/prisma/client"
import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { requireSalesPermission } from "../../../middleware/requireSalesPermission"
import {
  addCollaboratorHandler,
  approveRemovalHandler,
  cancelRemovalHandler,
  listCollaboratorOptionsHandler,
  listRemovalsHandler,
  refuseRemovalHandler,
  removeCollaboratorHandler,
  requestRemovalHandler,
} from "./collaborator.controller"

const router = Router()

// Collaborators after the Sales Account exists. The Owner (or a Sales Admin)
// adds directly. A Sales User also needs `account.edit`, which a Sales Admin
// can switch off. The service checks who the Owner is.
router.get("/accounts/:id/collaborator-options", requireAuth, requireSales(), requireSalesPermission("account.edit"), listCollaboratorOptionsHandler)
router.post("/accounts/:id/collaborators", requireAuth, requireSales(), requireSalesPermission("account.edit"), addCollaboratorHandler)

// A Sales Admin removes at once. An Owner asks instead (removal-requests below).
router.delete(
  "/accounts/:id/collaborators/:employeeId",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  removeCollaboratorHandler
)

// An Owner asks. `account.edit` can be switched off for Sales Users. A Sales
// Admin does not ask: they remove directly (above).
router.post("/accounts/:id/removal-requests", requireAuth, requireSales(), requireSalesPermission("account.edit"), requestRemovalHandler)
router.patch("/removal-requests/:id/cancel", requireAuth, requireSales(), requireSalesPermission("account.edit"), cancelRemovalHandler)
// Open to the hub: the service narrows a Sales User to their own Sales Accounts.
router.get("/removal-requests", requireAuth, requireSales(), listRemovalsHandler)

// Deciding is a Sales Admin act, with no switch, so nobody approves their own ask.
router.patch("/removal-requests/:id/approve", requireAuth, requireSales(SalesRole.SALES_ADMIN), approveRemovalHandler)
router.patch("/removal-requests/:id/refuse", requireAuth, requireSales(SalesRole.SALES_ADMIN), refuseRemovalHandler)

export default router
