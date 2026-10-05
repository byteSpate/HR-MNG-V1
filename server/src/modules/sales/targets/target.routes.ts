import { Router } from "express"

import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { requireSalesPermission } from "../../../middleware/requireSalesPermission"
import { getTargetYearHandler, setSalesTargetHandler } from "./target.controller"

const router = Router()

// Targets and the dashboard. Reads are open to any hub member and narrowed by
// the service, which is where "your own, or somebody else's if you may" lives.
// Setting a target is a Sales Admin act, or a Sales User's when a Sales Admin
// turns on `target.set`. Never for their own Target: a target somebody sets
// for themselves is not a target (the service refuses that).
router.get("/targets", requireAuth, requireSales(), getTargetYearHandler)
router.put("/targets", requireAuth, requireSales(), requireSalesPermission("target.set"), setSalesTargetHandler)

export default router
