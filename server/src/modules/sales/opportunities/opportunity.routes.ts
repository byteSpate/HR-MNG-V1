import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import {
  addOpportunityLineHandler,
  changeOpportunityNextStepHandler,
  changeOpportunityStageHandler,
  changeOpportunityStatusHandler,
  createOpportunityHandler,
  deleteOpportunityLineHandler,
  getOpportunityHandler,
  getOpportunityHistoryHandler,
  getOpportunityTimelineHandler,
  listOpportunitiesHandler,
  listOpportunityOwnersHandler,
  reorderOpportunityLinesHandler,
  setSoftwareNeededHandler,
  suggestOpportunityLinesHandler,
  updateOpportunityHandler,
  updateOpportunityLineHandler,
} from "./opportunity.controller"

const router = Router()

router.get("/opportunities", requireAuth, requireSales(), listOpportunitiesHandler)
router.post("/opportunities", requireAuth, requireSales(), createOpportunityHandler)
router.get("/opportunities/owners", requireAuth, requireSales(), listOpportunityOwnersHandler)
router.get("/opportunities/:id", requireAuth, requireSales(), getOpportunityHandler)
router.patch("/opportunities/:id", requireAuth, requireSales(), updateOpportunityHandler)
router.patch("/opportunities/:id/stage", requireAuth, requireSales(), changeOpportunityStageHandler)
router.patch("/opportunities/:id/status", requireAuth, requireSales(), changeOpportunityStatusHandler)
router.patch("/opportunities/:id/next-step", requireAuth, requireSales(), changeOpportunityNextStepHandler)
// The weekly report Application column, answered on the deal (§26.9).
router.patch("/opportunities/:id/software-needed", requireAuth, requireSales(), setSoftwareNeededHandler)
router.get("/opportunities/:id/timeline", requireAuth, requireSales(), getOpportunityTimelineHandler)
router.get("/opportunities/:id/history", requireAuth, requireSales(), getOpportunityHistoryHandler)

router.post("/opportunities/:id/lines", requireAuth, requireSales(), addOpportunityLineHandler)
router.put("/opportunities/:id/lines/reorder", requireAuth, requireSales(), reorderOpportunityLinesHandler)
router.patch("/lines/:lineId", requireAuth, requireSales(), updateOpportunityLineHandler)
router.delete("/lines/:lineId", requireAuth, requireSales(), deleteOpportunityLineHandler)
router.get("/suggestions/oem", requireAuth, requireSales(), suggestOpportunityLinesHandler)

export default router
