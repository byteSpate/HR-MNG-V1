import { Router } from "express"

import { SalesRole } from "../../../generated/prisma/client"
import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { requireSalesPermission } from "../../../middleware/requireSalesPermission"
import { getHeatmapHandler, setPartMarkHandler, setProductMarksHandler, setProductNoteHandler } from "./heatmap.controller"
import {
  addGroupHandler,
  addPartHandler,
  addProductHandler,
  deleteListRowHandler,
  editListRowHandler,
  getHeatmapListHandler,
  moveListRowHandler,
} from "./heatmap.list.controller"

const router = Router()

// The Heatmap tab (owner, 2026-10-18). Anyone who can see the account can
// read it. Changing it has the same write gate as editing the account (the
// owner, the collaborators and Sales Admins), applied inside the service.
// `products/...` and `parts/...` never meet. A tick or cross is on a part;
// `marks` on a product sets every part at once ("All ticks", "All crosses").
router.get("/accounts/:id/heatmap", requireAuth, requireSales(), getHeatmapHandler)
router.put("/accounts/:id/heatmap/parts/:partId/mark", requireAuth, requireSales(), requireSalesPermission("account.edit"), setPartMarkHandler)
router.put("/accounts/:id/heatmap/products/:productId/marks", requireAuth, requireSales(), requireSalesPermission("account.edit"), setProductMarksHandler)
router.put("/accounts/:id/heatmap/products/:productId/note", requireAuth, requireSales(), requireSalesPermission("account.edit"), setProductNoteHandler)

// The list behind the Heatmap, in Sales Settings (owner, 2026-10-13). Sales
// Admins only. The three literal POST paths come before `:level/:id/move`;
// `levelOf` refuses anything that is not groups, products or parts.
const admin = [requireAuth, requireSales(SalesRole.SALES_ADMIN)]
router.get("/settings/heatmap-list", ...admin, getHeatmapListHandler)
router.post("/settings/heatmap-list/groups", ...admin, addGroupHandler)
router.post("/settings/heatmap-list/groups/:id/products", ...admin, addProductHandler)
router.post("/settings/heatmap-list/products/:id/parts", ...admin, addPartHandler)
router.patch("/settings/heatmap-list/:level/:id", ...admin, editListRowHandler)
router.post("/settings/heatmap-list/:level/:id/move", ...admin, moveListRowHandler)
router.delete("/settings/heatmap-list/:level/:id", ...admin, deleteListRowHandler)

export default router
