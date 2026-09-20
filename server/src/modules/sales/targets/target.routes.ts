import { Router } from "express"

import { SalesRole } from "../../../generated/prisma/client"
import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import { getTargetYearHandler, setSalesTargetHandler } from "./target.controller"

const router = Router()

// Targets and the dashboard. Reads are open to any hub member and narrowed by
// the service, which is where "your own, or anybody if you are an admin"
// lives. Setting a target is a Sales Admin act: a target somebody sets for
// themselves is not a target.
router.get("/targets", requireAuth, requireSales(), getTargetYearHandler)
router.put("/targets", requireAuth, requireSales(SalesRole.SALES_ADMIN), setSalesTargetHandler)

export default router
