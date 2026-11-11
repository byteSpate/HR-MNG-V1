import { Router } from "express"

import { requireAuth } from "../../middleware/requireAuth"
import { countHandler, listHandler, markAllReadHandler, markReadHandler } from "./inbox.controller"

const router = Router()

// No `requireRole`: every role has its own notifications, and every read is
// scoped to the token's user. Literal paths before `/:id/read`.
router.get("/count", requireAuth, countHandler)
router.post("/read-all", requireAuth, markAllReadHandler)
router.get("/", requireAuth, listHandler)
router.patch("/:id/read", requireAuth, markReadHandler)

export default router
