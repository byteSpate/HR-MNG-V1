import { Router } from "express"

import { requireAuth } from "../../middleware/requireAuth"
import { avatarUpload } from "../media/media.upload"
import {
  changePasswordHandler,
  clearOwnAvatarHandler,
  forgotPasswordHandler,
  listSessionsHandler,
  loginHandler,
  logoutEverywhereHandler,
  logoutHandler,
  refreshHandler,
  resetPasswordHandler,
  revokeSessionHandler,
  setDisplayNameHandler,
  staffLoginHandler,
  uploadOwnAvatarHandler,
  requestEmailChangeHandler,
  getPendingEmailChangeHandler,
  approveEmailChangeHandler,
  cancelEmailChangeHandler,
  confirmEmailChangeHandler,
} from "./auth.controller"

const router = Router()

router.post("/login", loginHandler)
router.post("/staff-login", staffLoginHandler)
router.post("/refresh", refreshHandler)
router.post("/logout", logoutHandler)
router.post("/logout-all", requireAuth, logoutEverywhereHandler)

// Every role, and no `requireRole`: the subject is the token, so this is
// self-scoped by construction and there is no id that could aim it elsewhere.
router.get("/sessions", requireAuth, listSessionsHandler)
router.delete("/sessions/:sessionId", requireAuth, revokeSessionHandler)

// The account's own name and face, for the three roles that have no employee
// record to carry them. The service refuses a staff caller — for them both
// live on the Employee row and belong to HR.
router.patch("/me", requireAuth, setDisplayNameHandler)
router.patch("/me/avatar", requireAuth, avatarUpload, uploadOwnAvatarHandler)
router.delete("/me/avatar", requireAuth, clearOwnAvatarHandler)
router.post("/forgot-password", forgotPasswordHandler)
router.post("/reset-password", resetPasswordHandler)
router.post("/change-password", requireAuth, changePasswordHandler)

// Changing the sign-in address. The first two need a session because they are
// the account acting on itself; the last three carry a token instead, and are
// deliberately open — see the note in the controller.
router.post("/email-change", requireAuth, requestEmailChangeHandler)
router.get("/email-change", requireAuth, getPendingEmailChangeHandler)
router.post("/email-change/approve", approveEmailChangeHandler)
router.post("/email-change/cancel", cancelEmailChangeHandler)
router.post("/email-change/confirm", confirmEmailChangeHandler)

export default router
