import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import {
  addDocumentLinkHandler,
  addOpportunityLineHandler,
  changeOpportunityNextStepHandler,
  changeOpportunityStageHandler,
  changeOpportunityStatusHandler,
  correctOpportunityStatusHandler,
  createOpportunityHandler,
  deleteOpportunityLineHandler,
  getOpportunityHandler,
  getOpportunityHistoryHandler,
  getOpportunityTimelineHandler,
  handOverHandler,
  listHandOverOwnersHandler,
  listDocumentLinksHandler,
  listOpportunitiesHandler,
  listOpportunityOwnersHandler,
  removeDocumentLinkHandler,
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
// The Hand-over (spec §2.5). Both sit under `/opportunities/:id`, so they are
// declared with the rest of that family, above the `/opportunities/:id` read.
router.get("/opportunities/:id/handover-owners", requireAuth, requireSales(), listHandOverOwnersHandler)
router.post("/opportunities/:id/handover", requireAuth, requireSales(), handOverHandler)
// Document links (spec 2026-09-28 §1.5). `/documents/:linkId` rather than
// `/opportunities/:id/documents/:linkId`, so the path can never be read as
// `/opportunities/:id`; it matches how `/lines/:lineId` is routed today.
router.get("/opportunities/:id/documents", requireAuth, requireSales(), listDocumentLinksHandler)
router.post("/opportunities/:id/documents", requireAuth, requireSales(), addDocumentLinkHandler)
router.delete("/documents/:linkId", requireAuth, requireSales(), removeDocumentLinkHandler)
// Won, Lost and Cancelled are final; a Sales Admin corrects a mistake here (spec 2026-09-28 §1.4).
router.post("/opportunities/:id/correct-status", requireAuth, requireSales(), correctOpportunityStatusHandler)
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
