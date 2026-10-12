import { Router } from "express"

import { requireAuth } from "../../middleware/requireAuth"
import { requireRole } from "../../middleware/requireRole"
import { Role } from "../../generated/prisma/client"
import {
  createUserHandler,
  listUsersHandler,
  resendUserInviteHandler,
  setUserRoleHandler,
  updateUserStatusHandler,
} from "./user.controller"

const router = Router()

// Every route here is SUPER_ADMIN. Account administration — who exists, what
// role they hold, whether they can log in — is the one surface HR does not
// own; see the comment on employee.routes' /:id/account.
router.get("/", requireAuth, requireRole(Role.SUPER_ADMIN), listUsersHandler)
router.post("/", requireAuth, requireRole(Role.SUPER_ADMIN), createUserHandler)
router.patch("/:id/status", requireAuth, requireRole(Role.SUPER_ADMIN), updateUserStatusHandler)
router.post("/:id/resend-invite", requireAuth, requireRole(Role.SUPER_ADMIN), resendUserInviteHandler)
router.patch("/:id/role", requireAuth, requireRole(Role.SUPER_ADMIN), setUserRoleHandler)

export default router
