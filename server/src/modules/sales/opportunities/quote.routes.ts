import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { addQuoteHandler, deleteQuoteHandler, editQuoteHandler } from "./quote.controller"

const router = Router()

// Quotes on an Opportunity (owner, 2026-10-13). The write gate, the stage
// rule and the "latest only" rule are all checked inside the service.
router.post("/opportunities/:id/quotes", requireAuth, requireSales(), addQuoteHandler)
router.patch("/opportunities/:id/quotes/:quoteId", requireAuth, requireSales(), editQuoteHandler)
router.delete("/opportunities/:id/quotes/:quoteId", requireAuth, requireSales(), deleteQuoteHandler)

export default router
