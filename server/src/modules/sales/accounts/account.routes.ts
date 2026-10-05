import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { requireSalesPermission } from "../../../middleware/requireSalesPermission"
import { cardUpload } from "../../media/media.upload"
import {
  addContactHandler,
  createSalesAccountHandler,
  getAccountHistoryHandler,
  getAccountMarginHandler,
  getAccountProfileHandler,
  getAccountTimelineHandler,
  getSalesAccountHandler,
  listContactsHandler,
  listSalesAccountsHandler,
  listSalesEligibleEmployeesHandler,
  logCommunicationHandler,
  removeVisitingCardHandler,
  setVisitingCardHandler,
  setContactStatusHandler,
  setPrimaryContactHandler,
  updateAccountProfileHandler,
  updateContactHandler,
  updateSalesAccountHandler,
} from "./account.controller"

const router = Router()

// Reads are open to anyone in the hub and narrowed by `accountScopeFor`, so
// the guard here answers "may you be in the Sales Hub at all" and the scope
// answers "which accounts". Creating one is a Sales Admin act, or a Sales
// User's own when a Sales Admin has turned on `account.create`.
router.get("/accounts", requireAuth, requireSales(), listSalesAccountsHandler)
router.get("/accounts/:id", requireAuth, requireSales(), getSalesAccountHandler)
router.post("/accounts", requireAuth, requireSales(), requireSalesPermission("account.create"), createSalesAccountHandler)
// Editing is requireSales() and not SALES_ADMIN: the write gate inside the
// service narrows it to the owner, the collaborators and admins. An owner
// fixing a typo on their own account should not need an admin.
router.patch("/accounts/:id", requireAuth, requireSales(), requireSalesPermission("account.edit"), updateSalesAccountHandler)
// The visiting card is set and removed on its own path, because a picture goes
// as a file upload and the account's other fields go as JSON. The same write
// gate as editing the account applies inside the service.
router.put("/accounts/:id/visiting-card", requireAuth, requireSales(), requireSalesPermission("account.edit"), cardUpload, setVisitingCardHandler)
router.delete("/accounts/:id/visiting-card", requireAuth, requireSales(), requireSalesPermission("account.edit"), removeVisitingCardHandler)

// The Company profile (spec 2026-09-30). Anyone who can see the account can
// read it. Changing it has the same write gate as editing the account, applied
// inside the service.
router.get("/accounts/:id/profile", requireAuth, requireSales(), getAccountProfileHandler)
router.patch("/accounts/:id/profile", requireAuth, requireSales(), requireSalesPermission("account.edit"), updateAccountProfileHandler)

// Who the owner/collaborator pickers on the create form may offer. Same
// switch as creating the account itself (`account.create`).
router.get(
  "/employees",
  requireAuth,
  requireSales(),
  requireSalesPermission("account.create"),
  listSalesEligibleEmployeesHandler
)

// Contacts are ordinary work on an account you already hold, so they need no
// Sales Admin. `requireAccountAccess` inside each service is what stops a
// Sales User reaching an account that is not theirs.
router.get("/accounts/:id/contacts", requireAuth, requireSales(), listContactsHandler)
router.post("/accounts/:id/contacts", requireAuth, requireSales(), addContactHandler)
router.patch("/contacts/:id", requireAuth, requireSales(), updateContactHandler)
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

export default router
