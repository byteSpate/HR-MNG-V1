import { Router } from "express"

import { SalesRole } from "../../../generated/prisma/client"
import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { listPaymentsHandler } from "./payments.controller"
import { exportPaymentsHandler } from "./payments.export"

const router = Router()

// Payments (owner, 2026-10-18): Sales Admins only. `requireSales` treats a
// Super Admin as a Sales Admin, so they pass too. Finance has its own pages.
const admin = [requireAuth, requireSales(SalesRole.SALES_ADMIN)]
router.get("/payments/export", ...admin, exportPaymentsHandler)
router.get("/payments", ...admin, listPaymentsHandler)

export default router
