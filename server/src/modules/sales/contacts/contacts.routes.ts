import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { listAllContactsHandler } from "./contacts.controller"
import { exportContactsHandler } from "./contacts.export"

const router = Router()

// The Contacts page (owner, 2026-10-18). Anyone in the Sales Hub; the service
// limits the rows to the accounts the viewer may see. These GETs never meet
// the account router's `PATCH /contacts/:id` routes.
router.get("/contacts/export", requireAuth, requireSales(), exportContactsHandler)
router.get("/contacts", requireAuth, requireSales(), listAllContactsHandler)

export default router
