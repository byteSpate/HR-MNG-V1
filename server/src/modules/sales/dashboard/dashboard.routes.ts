import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { getSalesDashboardHandler } from "./dashboard.controller"

const router = Router()

router.get("/dashboard", requireAuth, requireSales(), getSalesDashboardHandler)

export default router
