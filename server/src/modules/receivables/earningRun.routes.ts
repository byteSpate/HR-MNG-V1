import { Router } from "express"
import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  deleteEarningRunHandler,
  draftEarningRunHandler,
  getEarningRunHandler,
  listEarningRunsHandler,
  postEarningRunHandler,
  reverseEarningRunHandler,
} from "./earningRun.controller"

const router = Router()

// A ledger action, like depreciation's run — not a Sales Hub one, so the
// deal's own sales person has no access here.
const LEDGER_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, requireRole(...LEDGER_ROLES), listEarningRunsHandler)
router.post("/", requireAuth, requireRole(...LEDGER_ROLES), draftEarningRunHandler)
router.get("/:id", requireAuth, requireRole(...LEDGER_ROLES), getEarningRunHandler)
router.post("/:id/post", requireAuth, requireRole(...LEDGER_ROLES), postEarningRunHandler)
router.post("/:id/reverse", requireAuth, requireRole(...LEDGER_ROLES), reverseEarningRunHandler)
router.delete("/:id", requireAuth, requireRole(...LEDGER_ROLES), deleteEarningRunHandler)

export default router
