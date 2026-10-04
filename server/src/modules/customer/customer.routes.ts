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
import { exportCustomersHandler } from "./customer.export"

const router = Router()

// Finance owns customer records; Super Admin can act on Finance's behalf,
// same posture as every money-adjacent module in this codebase.
const WRITE_ROLES = [Role.FINANCE_OFFICER, Role.SUPER_ADMIN] as const

// File export. Customers come from Won Sales Accounts, so there is no import.
// The literal path sits above `/:id`.
router.get("/export", requireAuth, requireRole(...WRITE_ROLES), exportCustomersHandler)

router.get("/", requireAuth, listCustomersHandler)
router.get("/:id", requireAuth, getCustomerHandler)
router.post("/", requireAuth, requireRole(...WRITE_ROLES), createCustomerHandler)
router.patch("/:id", requireAuth, requireRole(...WRITE_ROLES), updateCustomerHandler)

export default router
