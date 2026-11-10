import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { dayLogCountHandler, dayLogImageHandler } from "./daylog.controller"

const router = Router()

// The work log picture on the Logs tab. Always the caller's own log, so any
// Sales user may ask for it and no permission switch is needed.
router.get("/day-log", requireAuth, requireSales(), dayLogCountHandler)
router.get("/day-log/image", requireAuth, requireSales(), dayLogImageHandler)

export default router
