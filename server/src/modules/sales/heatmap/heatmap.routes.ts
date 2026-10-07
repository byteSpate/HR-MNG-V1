import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { requireSalesPermission } from "../../../middleware/requireSalesPermission"
import {
  addHeatmapItemHandler,
  getHeatmapHandler,
  removeHeatmapItemHandler,
  setCardNeedHandler,
  updateHeatmapItemHandler,
} from "./heatmap.controller"

const router = Router()

// The Heatmap tab (owner, 2026-10-07). Anyone who can see the account can
// read it. Changing it has the same write gate as editing the account (the
// owner, the collaborators and Sales Admins), applied inside the service.
// `/heatmap/items/:itemId` and `/heatmap/:card/...` never meet: a card path
// always ends in `/need` or `/items`, and an item path has no tail.
router.get("/accounts/:id/heatmap", requireAuth, requireSales(), getHeatmapHandler)
router.put("/accounts/:id/heatmap/:card/need", requireAuth, requireSales(), requireSalesPermission("account.edit"), setCardNeedHandler)
router.post("/accounts/:id/heatmap/:card/items", requireAuth, requireSales(), requireSalesPermission("account.edit"), addHeatmapItemHandler)
router.patch("/accounts/:id/heatmap/items/:itemId", requireAuth, requireSales(), requireSalesPermission("account.edit"), updateHeatmapItemHandler)
router.delete("/accounts/:id/heatmap/items/:itemId", requireAuth, requireSales(), requireSalesPermission("account.edit"), removeHeatmapItemHandler)

export default router
