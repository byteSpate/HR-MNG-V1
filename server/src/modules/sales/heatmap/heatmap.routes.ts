import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { requireSalesPermission } from "../../../middleware/requireSalesPermission"
import { getHeatmapHandler, setPartScopeHandler, setProductColourHandler } from "./heatmap.controller"

const router = Router()

// The Heatmap tab (owner, 2026-10-13). Anyone who can see the account can
// read it. Changing it has the same write gate as editing the account (the
// owner, the collaborators and Sales Admins), applied inside the service.
// `products/...` and `parts/...` never meet.
router.get("/accounts/:id/heatmap", requireAuth, requireSales(), getHeatmapHandler)
router.put("/accounts/:id/heatmap/products/:productId/colour", requireAuth, requireSales(), requireSalesPermission("account.edit"), setProductColourHandler)
router.put("/accounts/:id/heatmap/parts/:partId/scope", requireAuth, requireSales(), requireSalesPermission("account.edit"), setPartScopeHandler)

export default router
