import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { getHeatmapOverviewHandler, getSalesDashboardHandler } from "./dashboard.controller"

const router = Router()

router.get("/dashboard", requireAuth, requireSales(), getSalesDashboardHandler)
// The Heatmap band (owner, 2026-10-18). Same scope rules as the dashboard.
router.get("/dashboard/heatmap", requireAuth, requireSales(), getHeatmapOverviewHandler)

export default router
