import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import {
  answerRequirementHandler,
  deleteMinutesHandler,
  getMinutesHandler,
  getMinutesTemplateHandler,
  listMinutesHandler,
  listWaitingForMinutesHandler,
  previewMinutesHandler,
  saveMinutesHandler,
  saveMinutesTemplateHandler,
  sendMinutesHandler,
  sentCopyHandler,
  startMinutesHandler,
} from "./minutes.controller"

const router = Router()

// Meeting minutes (revision §25). Open to the hub at the route; the service
// narrows every read and write to the people who work the meeting's account
// and Sales Admins (§25.27).
router.post("/meetings/:id/minutes", requireAuth, requireSales(), startMinutesHandler)
router.get("/minutes", requireAuth, requireSales(), listMinutesHandler)
// Before /minutes/:id, or the path is read as an id.
router.get("/minutes/waiting", requireAuth, requireSales(), listWaitingForMinutesHandler)
router.get("/minutes/:id", requireAuth, requireSales(), getMinutesHandler)
router.put("/minutes/:id", requireAuth, requireSales(), saveMinutesHandler)
router.patch("/minutes/:id/requirement", requireAuth, requireSales(), answerRequirementHandler)
router.delete("/minutes/:id", requireAuth, requireSales(), deleteMinutesHandler)
// PDFs. The preview is DRAFT and keeps nothing. Sending is record-only
// (§25.22): it keeps the copy, marks the minutes sent, and answers with that
// same file. A kept copy downloads again, exactly as it went out.
router.get("/minutes/:id/preview", requireAuth, requireSales(), previewMinutesHandler)
router.post("/minutes/:id/send", requireAuth, requireSales(), sendMinutesHandler)
router.get("/minutes/sends/:sendId/file", requireAuth, requireSales(), sentCopyHandler)

// Sales Settings (revision §25.30). The minutes template is its first section,
// open to everyone in the hub since 2026-09-15 (§25.20): the format changes
// often, and waiting for an admin slowed people down. Later settings join it
// under the same prefix, each with its own guard.
router.get("/settings/minutes-template", requireAuth, requireSales(), getMinutesTemplateHandler)
router.put("/settings/minutes-template", requireAuth, requireSales(), saveMinutesTemplateHandler)

export default router
