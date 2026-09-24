import { Router } from "express"

import { Role } from "../../generated/prisma/client"
import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import {
  createCustomerHandler,
  getCustomerHandler,
  listCustomersHandler,
  updateCustomerHandler,
} from "./customer.controller"

const router = Router()

// Finance owns customer records; Super Admin can act on Finance's behalf,
// same posture as every money-adjacent module in this codebase.
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

router.get("/", requireAuth, listCustomersHandler)
router.get("/:id", requireAuth, getCustomerHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createCustomerHandler)
router.patch("/:id", requireAuth, requireRole(...WRITE_ROLES), updateCustomerHandler)

export default router
