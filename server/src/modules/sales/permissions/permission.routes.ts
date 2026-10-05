import { Router } from "express"

import { SalesRole } from "../../../generated/prisma/client"
import { requireAuth } from "../../../middleware/requireAuth"
import { requireSales } from "../../../middleware/requireSales"
import {
  listPermissionsHandler,
  myPermissionsHandler,
  savePermissionsHandler,
} from "./permission.controller"

const router = Router()

// Reading is open to the whole hub: the screen shows everyone what is on, and
// `/me` lets the client hide a button that would be refused. Changing a
// switch is a Sales Admin act and has no switch of its own, so nobody can lock
// themselves out.
router.get("/permissions/me", requireAuth, requireSales(), myPermissionsHandler)
router.get("/permissions", requireAuth, requireSales(), listPermissionsHandler)
router.put("/permissions", requireAuth, requireSales(SalesRole.SALES_ADMIN), savePermissionsHandler)

export default router
