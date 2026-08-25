import { Router } from "express"

import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import { listDispatchesHandler } from "./notification.controller"

const router = Router()

// SUPER_ADMIN only. This log carries every recipient address in the company,
// which Finance has no reason to hold.
router.get("/", requireAuth, requireRole(Role.SUPER_ADMIN), listDispatchesHandler)

export default router
