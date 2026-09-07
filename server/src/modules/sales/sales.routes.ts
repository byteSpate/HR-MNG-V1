import { Router } from "express"

import { SalesRole } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireSales } from "../../middleware/requireSales"
import {
  addContactHandler,
  createSalesAccountHandler,
  getSalesAccountHandler,
  listContactsHandler,
  listSalesAccountsHandler,
  setContactStatusHandler,
  setPrimaryContactHandler,
} from "./sales.controller"

const router = Router()

// Reads are open to anyone in the hub and narrowed by `accountScopeFor`, so
// the guard here answers "may you be in the Sales Hub at all" and the scope
// answers "which accounts". Creating one is a Sales Admin act.
router.get("/accounts", requireAuth, requireSales(), listSalesAccountsHandler)
router.get("/accounts/:id", requireAuth, requireSales(), getSalesAccountHandler)
router.post("/accounts", requireAuth, requireSales(SalesRole.SALES_ADMIN), createSalesAccountHandler)

// Contacts are ordinary work on an account you already hold, so they need no
// Sales Admin. `requireAccountAccess` inside each service is what stops a
// Sales User reaching an account that is not theirs.
router.get("/accounts/:id/contacts", requireAuth, requireSales(), listContactsHandler)
router.post("/accounts/:id/contacts", requireAuth, requireSales(), addContactHandler)
router.patch("/contacts/:id/primary", requireAuth, requireSales(), setPrimaryContactHandler)
router.patch("/contacts/:id/status", requireAuth, requireSales(), setContactStatusHandler)

export default router
