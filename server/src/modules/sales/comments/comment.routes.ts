import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { createSalesCommentHandler, listSalesCommentsHandler, updateSalesCommentHandler } from "./comment.controller"

const router = Router()

router.get("/comments", requireAuth, requireSales(), listSalesCommentsHandler)
router.post("/comments", requireAuth, requireSales(), createSalesCommentHandler)
router.patch("/comments/:id", requireAuth, requireSales(), updateSalesCommentHandler)

export default router
