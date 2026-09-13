import { Router } from "express"

import { SalesRole } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireSales } from "../../middleware/requireSales"
import {
  addContactHandler,
  createSalesAccountHandler,
  getAccountHistoryHandler,
  getAccountMarginHandler,
  getAccountTimelineHandler,
  getSalesAccountHandler,
  logCommunicationHandler,
  listContactsHandler,
  listSalesAccountsHandler,
  listSalesEligibleEmployeesHandler,
  setContactStatusHandler,
  setPrimaryContactHandler,
  getTargetYearHandler,
  setSalesTargetHandler,
  getSalesDashboardHandler,
  updateSalesAccountHandler,
  addOpportunityLineHandler,
  changeOpportunityNextStepHandler,
  changeOpportunityStageHandler,
  changeOpportunityStatusHandler,
  createOpportunityHandler,
  createSalesCommentHandler,
  deleteOpportunityLineHandler,
  getOpportunityHandler,
  getOpportunityTimelineHandler,
  getOpportunityHistoryHandler,
  listOpportunitiesHandler,
  listOpportunityOwnersHandler,
  listSalesCommentsHandler,
  reorderOpportunityLinesHandler,
  suggestOpportunityLinesHandler,
  updateOpportunityHandler,
  updateOpportunityLineHandler,
  updateSalesCommentHandler,
  changeMeetingStatusHandler,
  createMeetingHandler,
  getMeetingHandler,
  listMeetingsHandler,
  updateMeetingHandler,
} from "./sales.controller"

const router = Router()

// Reads are open to anyone in the hub and narrowed by `accountScopeFor`, so
// the guard here answers "may you be in the Sales Hub at all" and the scope
// answers "which accounts". Creating one is a Sales Admin act.
router.get("/accounts", requireAuth, requireSales(), listSalesAccountsHandler)
router.get("/accounts/:id", requireAuth, requireSales(), getSalesAccountHandler)
router.post("/accounts", requireAuth, requireSales(SalesRole.SALES_ADMIN), createSalesAccountHandler)
// Editing is requireSales() and not SALES_ADMIN: the write gate inside the
// service narrows it to the owner, the collaborators and admins. An owner
// fixing a typo on their own account should not need an admin.
router.patch("/accounts/:id", requireAuth, requireSales(), updateSalesAccountHandler)

// Who the owner/collaborator pickers on the create form may offer — Sales
// Admin only, same guard as creating the account itself.
router.get(
  "/employees",
  requireAuth,
  requireSales(SalesRole.SALES_ADMIN),
  listSalesEligibleEmployeesHandler
)

// Contacts are ordinary work on an account you already hold, so they need no
// Sales Admin. `requireAccountAccess` inside each service is what stops a
// Sales User reaching an account that is not theirs.
router.get("/accounts/:id/contacts", requireAuth, requireSales(), listContactsHandler)
router.post("/accounts/:id/contacts", requireAuth, requireSales(), addContactHandler)
router.patch("/contacts/:id/primary", requireAuth, requireSales(), setPrimaryContactHandler)
router.patch("/contacts/:id/status", requireAuth, requireSales(), setContactStatusHandler)

// The Timeline and the History are both reads of the account, so both are
// guarded exactly as the account is. Logging a call is ordinary work on
// one, like a contact.
router.get("/accounts/:id/timeline", requireAuth, requireSales(), getAccountTimelineHandler)
router.get("/accounts/:id/history", requireAuth, requireSales(), getAccountHistoryHandler)
// What the company made on the account. Narrower than the two reads above:
// the service shows it only to the people who work the account.
router.get("/accounts/:id/margin", requireAuth, requireSales(), getAccountMarginHandler)
router.post(
  "/accounts/:id/communications",
  requireAuth,
  requireSales(),
  logCommunicationHandler
)

router.get("/opportunities", requireAuth, requireSales(), listOpportunitiesHandler)
router.post("/opportunities", requireAuth, requireSales(), createOpportunityHandler)
router.get("/opportunities/owners", requireAuth, requireSales(), listOpportunityOwnersHandler)
router.get("/opportunities/:id", requireAuth, requireSales(), getOpportunityHandler)
router.patch("/opportunities/:id", requireAuth, requireSales(), updateOpportunityHandler)
router.patch("/opportunities/:id/stage", requireAuth, requireSales(), changeOpportunityStageHandler)
router.patch("/opportunities/:id/status", requireAuth, requireSales(), changeOpportunityStatusHandler)
router.patch("/opportunities/:id/next-step", requireAuth, requireSales(), changeOpportunityNextStepHandler)
router.get("/opportunities/:id/timeline", requireAuth, requireSales(), getOpportunityTimelineHandler)
router.get("/opportunities/:id/history", requireAuth, requireSales(), getOpportunityHistoryHandler)

router.post("/opportunities/:id/lines", requireAuth, requireSales(), addOpportunityLineHandler)
router.put("/opportunities/:id/lines/reorder", requireAuth, requireSales(), reorderOpportunityLinesHandler)
router.patch("/lines/:lineId", requireAuth, requireSales(), updateOpportunityLineHandler)
router.delete("/lines/:lineId", requireAuth, requireSales(), deleteOpportunityLineHandler)
router.get("/suggestions/oem", requireAuth, requireSales(), suggestOpportunityLinesHandler)

router.get("/comments", requireAuth, requireSales(), listSalesCommentsHandler)
router.post("/comments", requireAuth, requireSales(), createSalesCommentHandler)
router.patch("/comments/:id", requireAuth, requireSales(), updateSalesCommentHandler)

// Meetings. Reads are open to the hub, like the account they belong to; the
// service narrows every write to the people who work that account.
router.get("/meetings", requireAuth, requireSales(), listMeetingsHandler)
router.post("/meetings", requireAuth, requireSales(), createMeetingHandler)
router.get("/meetings/:id", requireAuth, requireSales(), getMeetingHandler)
router.patch("/meetings/:id", requireAuth, requireSales(), updateMeetingHandler)
router.patch("/meetings/:id/status", requireAuth, requireSales(), changeMeetingStatusHandler)

export default router

// Targets and the dashboard. Reads are open to any hub member and narrowed by
// the service, which is where "your own, or anybody if you are an admin"
// lives. Setting a target is a Sales Admin act: a target somebody sets for
// themselves is not a target.
router.get("/targets", requireAuth, requireSales(), getTargetYearHandler)
router.put("/targets", requireAuth, requireSales(SalesRole.SALES_ADMIN), setSalesTargetHandler)
router.get("/dashboard", requireAuth, requireSales(), getSalesDashboardHandler)
